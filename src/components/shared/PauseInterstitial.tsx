import { useEffect, useState } from 'react';

interface PauseInterstitialProps {
  actionLabel: string; // e.g. "Send $500 to this number"
  reason: string; // from the triggering agent_decision, plain language
  onConfirm: () => void;
  onCancel: () => void;
}

const PAUSE_SECONDS = 10;

// This isn't just an anti-urgency UX nicety — it's also the coercion
// mitigation discussed for biometric unlock: a forced window wide enough
// for an escalation to land even if the device check itself was coerced.
export function PauseInterstitial({ actionLabel, reason, onConfirm, onCancel }: PauseInterstitialProps) {
  const [remaining, setRemaining] = useState(PAUSE_SECONDS);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  return (
    <div
      role="alertdialog"
      aria-labelledby="pause-heading"
      style={{ maxWidth: 480, border: '1px solid #ccc', borderRadius: 8, padding: 24 }}
    >
      <h2 id="pause-heading">Before this happens</h2>
      <p>{reason}</p>
      <p style={{ fontWeight: 500 }}>{actionLabel}</p>
      <button type="button" onClick={onConfirm} disabled={remaining > 0}>
        {remaining > 0 ? `Confirm (${remaining}s)` : 'Confirm'}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <p style={{ fontSize: 12, color: '#666' }}>
        This short wait gives your trusted contact a chance to step in if something's wrong.
      </p>
    </div>
  );
}
