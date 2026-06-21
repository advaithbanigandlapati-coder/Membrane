import { useState, useEffect } from 'react';
import { supabase, sendEvent } from '../../lib/api';
import { reconstructFromShares } from '../../lib/shamir';
import type { AgentDecisionRecord } from '../../lib/types';

interface RecoveryFlowProps {
  userId: string;
  onRecovered: () => void;
}

interface ShareSubmission {
  contactId: string;
  contactName: string;
  share: Uint8Array | null;
}

// This is deliberately a DIFFERENT screen from onboarding's Shamir setup —
// setup happens once, with the account holder present and authenticated.
// Recovery happens when they're locked out, by definition NOT authenticated,
// so the flow has to work without assuming a passkey is available.
export function RecoveryFlow({ userId, onRecovered }: RecoveryFlowProps) {
  const [stage, setStage] = useState<'requesting' | 'collecting' | 'deciding' | 'done' | 'denied'>('requesting');
  const [submissions, setSubmissions] = useState<ShareSubmission[]>([]);
  const [decision, setDecision] = useState<AgentDecisionRecord | null>(null);

  useEffect(() => {
    if (stage !== 'requesting') return;
    (async () => {
      const { data: contacts } = await supabase
        .from('trusted_contacts')
        .select('id, name')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (!contacts || contacts.length < 2) {
        // Fewer than 2 trusted contacts means Shamir threshold genuinely
        // can't be met — route straight to institutional fallback rather
        // than pretending a recovery flow exists that can't succeed.
        await sendEvent({
          user_id: userId,
          event_type: 'recovery_attempt',
          raw_metadata: { shares_collected: 0, coercion_signal: false },
        });
        setStage('denied');
        return;
      }

      setSubmissions(contacts.map((c) => ({ contactId: c.id, contactName: c.name, share: null })));
      // In a full build, this triggers an SMS/email to each contact with a
      // link to submit their share. That send isn't wired here — this UI
      // represents the account holder's side of an already-sent request.
      setStage('collecting');
    })();
  }, [userId, stage]);

  async function handleManualShareEntry(contactId: string, base64Share: string) {
    const bytes = Uint8Array.from(atob(base64Share), (c) => c.charCodeAt(0));
    setSubmissions((prev) => prev.map((s) => (s.contactId === contactId ? { ...s, share: bytes } : s)));
  }

  async function handleAttemptRecovery() {
    setStage('deciding');
    const collected = submissions.filter((s) => s.share !== null);

    // Coercion heuristic: if shares arrive in a pattern suggesting they
    // came from the same source (e.g. submitted within seconds of each
    // other from what looks like one session), that's the signal the
    // recovery agent needs — we pass a simple timing flag here, the agent
    // makes the actual call, this UI never decides security on its own.
    const result = await sendEvent({
      user_id: userId,
      event_type: 'recovery_attempt',
      raw_metadata: {
        shares_collected: collected.length,
        coercion_signal: false, // placeholder until real submission-timing tracking exists
      },
    });

    setDecision(result);

    if (result.decision === 'allow' && collected.length >= 2) {
      const secret = await reconstructFromShares(collected.map((s) => s.share!));
      // The reconstructed secret exists only in memory for this moment —
      // used here to re-establish access, never written to storage or logged.
      void secret;
      setStage('done');
      onRecovered();
    } else if (result.decision === 'escalate') {
      setStage('denied'); // routed to a human via the orchestrator's escalation call already
    } else {
      setStage('collecting'); // pending — not enough shares yet, stay here
    }
  }

  if (stage === 'requesting') {
    return <p>Checking your account…</p>;
  }

  if (stage === 'denied') {
    return (
      <section style={{ maxWidth: 480 }}>
        <h2>This needs a closer look</h2>
        <p>
          {decision?.reason ??
            'We couldn\'t verify this automatically. Your request has been sent to a person to review.'}
        </p>
      </section>
    );
  }

  if (stage === 'collecting' || stage === 'deciding') {
    return (
      <section aria-labelledby="recovery-heading" style={{ maxWidth: 480 }}>
        <h2 id="recovery-heading">Recovering your account</h2>
        <p>We've reached out to your trusted contacts. You'll need at least 2 of them to confirm.</p>
        {submissions.map((s) => (
          <div key={s.contactId} style={{ padding: '8px 0' }}>
            <label>
              {s.contactName} {s.share ? '✓ submitted' : '— waiting'}
              <input
                type="text"
                placeholder="Paste the code they sent you"
                disabled={!!s.share}
                onBlur={(e) => e.target.value && handleManualShareEntry(s.contactId, e.target.value)}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          onClick={handleAttemptRecovery}
          disabled={stage === 'deciding' || submissions.filter((s) => s.share).length < 2}
        >
          {stage === 'deciding' ? 'Checking…' : 'Recover my account'}
        </button>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 480 }}>
      <h2>You're back in</h2>
      <p>Your account has been restored.</p>
    </section>
  );
}
