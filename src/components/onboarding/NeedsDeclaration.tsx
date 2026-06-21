import { useState } from 'react';
import { resolveMethodPlan, type DeclaredNeed, type MethodPlan } from '../../lib/methodSelection';

interface NeedOption {
  value: DeclaredNeed;
  label: string;
}

const NEED_OPTIONS: NeedOption[] = [
  { value: 'blind-low-vision', label: 'I\'m blind or have low vision' },
  { value: 'deaf-hard-of-hearing', label: 'I\'m deaf or hard of hearing' },
  { value: 'motor-impaired', label: 'Precise taps or gestures are hard for me' },
  { value: 'cognitive-accessibility', label: 'I\'d like simpler, slower-paced screens' },
  { value: 'no-device-biometric', label: 'My device doesn\'t have Face ID or Touch ID set up' },
];

interface NeedsDeclarationProps {
  onResolved: (needs: DeclaredNeed[], plan: MethodPlan) => void;
}

export function NeedsDeclaration({ onResolved }: NeedsDeclarationProps) {
  const [selected, setSelected] = useState<Set<DeclaredNeed>>(new Set());
  const [showPlan, setShowPlan] = useState(false);
  const [plan, setPlan] = useState<MethodPlan | null>(null);

  function toggle(need: DeclaredNeed) {
    const next = new Set(selected);
    if (next.has(need)) next.delete(need);
    else next.add(need);
    setSelected(next);
  }

  function handleContinue() {
    const declared = selected.size > 0 ? Array.from(selected) : (['none-declared'] as DeclaredNeed[]);
    const resolvedPlan = resolveMethodPlan(declared);
    setPlan(resolvedPlan);
    setShowPlan(true);
  }

  function handleConfirm() {
    if (!plan) return;
    const declared = selected.size > 0 ? Array.from(selected) : (['none-declared'] as DeclaredNeed[]);
    onResolved(declared, plan);
  }

  if (showPlan && plan) {
    return (
      <section aria-labelledby="plan-heading" style={{ maxWidth: 480 }}>
        <h2 id="plan-heading">Here's how you'll sign in</h2>
        <p>{plan.reasonForPerson}</p>
        <p>
          <strong>If that ever doesn't work,</strong> we'll automatically offer{' '}
          {plan.fallbackChain.map((m) => methodLabel(m)).join(', then ')} instead — you won't be stuck.
        </p>
        <button type="button" onClick={handleConfirm}>
          This sounds right, continue
        </button>
        <button type="button" onClick={() => setShowPlan(false)}>
          Go back and change my answers
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="needs-heading" style={{ maxWidth: 480 }}>
      <h2 id="needs-heading">A few quick questions</h2>
      <p>Select anything that applies to you. You can select more than one, or none at all.</p>
      <fieldset style={{ border: 'none', padding: 0 }}>
        <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          Accessibility needs
        </legend>
        {NEED_OPTIONS.map((opt) => (
          <label key={opt.value} style={{ display: 'block', padding: '8px 0' }}>
            <input
              type="checkbox"
              checked={selected.has(opt.value)}
              onChange={() => toggle(opt.value)}
            />{' '}
            {opt.label}
          </label>
        ))}
      </fieldset>
      <button type="button" onClick={handleContinue}>
        Continue
      </button>
    </section>
  );
}

function methodLabel(method: MethodPlan['primary']): string {
  switch (method) {
    case 'passkey':
      return 'your device\'s built-in sign-in';
    case 'voice-passphrase':
      return 'a spoken phrase';
    case 'trusted-contact-assisted':
      return 'a trusted contact confirming it\'s you';
  }
}
