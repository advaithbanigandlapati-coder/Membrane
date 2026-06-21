import { useEffect, useState } from 'react';
import { supabase } from '../../lib/api';
import type { AgentDecisionRecord } from '../../lib/types';

// Deterministic templating, no LLM call here on purpose — the agent already
// wrote the reason in plain language; this only adjusts framing per
// audience so there's exactly one source of truth, never two explanations
// that could drift apart.

const AGENT_DISPLAY_NAME: Record<string, string> = {
  sender_auth: 'Checking who contacted you',
  receiver_auth: 'Checking it was you',
  recovery: 'Account recovery',
  adaptation: 'Making this easier for you',
};

export function ExplainabilityView({ userId }: { userId: string }) {
  const [decisions, setDecisions] = useState<AgentDecisionRecord[]>([]);

  useEffect(() => {
    supabase
      .from('agent_decisions')
      .select('id, agent, decision, confidence, reason, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setDecisions(data ?? []));
  }, [userId]);

  return (
    <section aria-labelledby="explain-heading" style={{ maxWidth: 560 }}>
      <h2 id="explain-heading">What's happened on your account</h2>
      {decisions.length === 0 && <p>Nothing to show yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {decisions.map((d) => (
          <li key={d.id} style={{ padding: '12px 0', borderBottom: '1px solid #ddd' }}>
            <p style={{ fontWeight: 500 }}>{AGENT_DISPLAY_NAME[d.agent] ?? d.agent}</p>
            <p>{renderDignityFramed(d)}</p>
            <p style={{ fontSize: 12, color: '#666' }}>{new Date(d.created_at).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function renderDignityFramed(d: AgentDecisionRecord): string {
  // Never "you failed" / "you were blocked because you" — protective
  // framing per the dossier's shame/self-blame finding, same source data,
  // different sentence shape than the compliance view below.
  const prefix =
    d.decision === 'block' || d.decision === 'escalate'
      ? 'We stepped in to help: '
      : d.decision === 'route_alternative'
        ? 'We adjusted this for you: '
        : '';
  return `${prefix}${d.reason}`;
}

// Institution-facing render — same record, compliance framing, used in a
// separate staff-only view gated by institution_staff RLS, not exposed here.
export function renderComplianceFramed(d: AgentDecisionRecord): string {
  return `[${d.agent}] decision=${d.decision} confidence=${d.confidence.toFixed(2)} — ${d.reason}`;
}
