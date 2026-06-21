// Orchestrator — the "postman." Single HTTP entrypoint for every client
// (web app, iOS extension). Routes an event to the right base agent, runs
// guardrail validation, logs the decision, and triggers escalation when
// needed. Base agents always run first and independently.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { evaluateSender } from '../_shared/agents/sender-auth.ts';
import { evaluateReceiver } from '../_shared/agents/receiver-auth.ts';
import { evaluateRecovery } from '../_shared/agents/recovery.ts';
import {
  evaluateAdaptation,
  meetsSoftlockSafetyCheck,
  type SoftlockHistory,
} from '../_shared/agents/adaptation.ts';
import { runGuardrail } from '../_shared/guardrail.ts';
import type { AgentName, AgentOutput, EventInput, ProfileSnapshot } from '../_shared/types.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // server-side only — never shipped to any client
);

Deno.serve(async (req) => {
  try {
    const event: EventInput = await req.json();

    // 1. Persist the raw event first — every event logged regardless of outcome
    const { data: eventRow, error: eventErr } = await supabase
      .from('events')
      .insert({
        user_id: event.user_id,
        event_type: event.event_type,
        step: event.step ?? null,
        session_id: event.session_id ?? null,
        device_signal: event.device_signal ?? null,
        raw_metadata: event.raw_metadata ?? {},
      })
      .select()
      .single();
    if (eventErr) throw eventErr;

    // 2. Load this user's current profile snapshot
    const { data: profileRow } = await supabase
      .from('user_security_profile')
      .select('*')
      .eq('user_id', event.user_id)
      .single();

    const profile: ProfileSnapshot = {
      declared_needs: profileRow?.declared_needs ?? [],
      observed_interaction_flags: profileRow?.observed_interaction_flags ?? [],
      heightened_flags: profileRow?.heightened_flags ?? [],
    };

    // 3. Route to the right base agent. It always runs first, independently.
    let agentName: AgentName;
    let rawOutput: AgentOutput;

    if (event.event_type === 'incoming_call' || event.event_type === 'incoming_text') {
      agentName = 'sender_auth';
      const { data: patterns } = await supabase
        .from('threat_patterns')
        .select('*')
        .eq('user_id', event.user_id);
      rawOutput = await evaluateSender(event, profile, patterns ?? []);
    } else if (event.event_type === 'login_attempt' || event.event_type === 'step_up_action') {
      agentName = 'receiver_auth';
      rawOutput = await evaluateReceiver(event, profile);
    } else if (event.event_type === 'recovery_attempt') {
      agentName = 'recovery';
      const sharesCollected = (event.raw_metadata?.shares_collected as number) ?? 0;
      const coercionSignal = (event.raw_metadata?.coercion_signal as boolean) ?? false;
      rawOutput = await evaluateRecovery(event, sharesCollected, coercionSignal);
    } else if (event.event_type === 'softlock') {
      agentName = 'adaptation';
      const history = await computeSoftlockHistory(event);
      const safeToConsider = meetsSoftlockSafetyCheck(history);
      rawOutput = safeToConsider
        ? await evaluateAdaptation(event, profile, history as SoftlockHistory)
        : {
            decision: 'pending',
            confidence: 1,
            signals_used: ['below-safety-threshold'],
            reason: 'Logged. Not enough of a pattern yet to change anything.',
          };
    } else {
      throw new Error(`Unhandled event type: ${event.event_type}`);
    }

    // 4. Guardrail validates EVERY output before anything acts on it
    const guardrailResult = runGuardrail(rawOutput);
    const finalOutput = guardrailResult.sanitized;

    // 5. Log the decision — explainability source of truth
    const { data: decisionRow, error: decisionErr } = await supabase
      .from('agent_decisions')
      .insert({
        user_id: event.user_id,
        event_id: eventRow.id,
        agent: agentName,
        decision: finalOutput.decision,
        confidence: finalOutput.confidence,
        signals_used: finalOutput.signals_used,
        reason: finalOutput.reason,
        guardrail_passed: guardrailResult.passed,
      })
      .select()
      .single();
    if (decisionErr) throw decisionErr;

    // 6. A successful, safety-checked adaptation correction writes ONLY the
    //    routing flag — nothing else
    if (agentName === 'adaptation' && finalOutput.decision === 'route_alternative' && guardrailResult.passed) {
      await appendInteractionFlag(event.user_id, event.step ?? 'unknown-step');
    }

    // 7. Escalate if called for — and tell the client WHO it's routing to,
    //    using real data, not a placeholder, so the demo can show it.
    let routedToContactName: string | null = null;
    if (finalOutput.decision === 'escalate') {
      const { data: contacts } = await supabase
        .from('trusted_contacts')
        .select('name')
        .eq('user_id', event.user_id)
        .eq('is_active', true)
        .limit(1);
      routedToContactName = contacts?.[0]?.name ?? null;

      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/escalate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ user_id: event.user_id, agent_decision_id: decisionRow.id }),
      });
    }

    return new Response(JSON.stringify({ ...finalOutput, routedToContactName }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});

async function computeSoftlockHistory(event: EventInput): Promise<SoftlockHistory | null> {
  const { data: priorSoftlocks } = await supabase
    .from('events')
    .select('session_id, device_signal')
    .eq('user_id', event.user_id)
    .eq('event_type', 'softlock')
    .eq('step', event.step ?? '');

  if (!priorSoftlocks || priorSoftlocks.length === 0) return null;

  const distinctSessions = new Set(priorSoftlocks.map((r) => r.session_id)).size;
  const distinctDevices = new Set(priorSoftlocks.map((r) => r.device_signal)).size;

  return {
    step: event.step ?? 'unknown-step',
    occurrences: priorSoftlocks.length,
    distinctSessions,
    // Crude but real heuristic: same device recurring = likely the actual
    // account holder. Scattered across many devices = looks like probing.
    identityConfidenceHigh: distinctDevices <= 2 && distinctSessions >= 2,
  };
}

async function appendInteractionFlag(userId: string, step: string) {
  const { data: profileRow } = await supabase
    .from('user_security_profile')
    .select('observed_interaction_flags')
    .eq('user_id', userId)
    .single();

  const existing = profileRow?.observed_interaction_flags ?? [];
  const updated = [
    ...existing,
    { flag: `softlock:${step}`, routed_to: 'accessible-alternative', set_at: new Date().toISOString() },
  ];

  await supabase
    .from('user_security_profile')
    .update({ observed_interaction_flags: updated, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}
