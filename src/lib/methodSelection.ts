// The adaptive engine. This is the "not one-size-fits-all" piece: the
// primary login method is SELECTED per person at onboarding based on what
// they declare, not defaulted to one method with patches bolted on after
// something fails. Adding a new need/method pair is a new row in
// METHOD_RULES, not new branching logic scattered through the app.
//
// This table is the only place declared_needs ever gets read to make a
// decision — receiver-auth (backend) reads the RESULT of this, never raw
// needs directly, keeping the same "summarized, not raw" boundary used
// everywhere else in this system.

export type DeclaredNeed =
  | 'blind-low-vision'
  | 'deaf-hard-of-hearing'
  | 'motor-impaired'
  | 'cognitive-accessibility'
  | 'no-device-biometric'
  | 'none-declared';

export type AuthMethod = 'passkey' | 'voice-passphrase' | 'trusted-contact-assisted';

export interface MethodPlan {
  primary: AuthMethod;
  fallbackChain: AuthMethod[]; // tried in order if primary genuinely can't be used
  uiMode: 'standard' | 'simplified'; // drives timeout length, copy density, step count
  reasonForPerson: string; // shown during onboarding so the choice is explained, not silent
}

// The actual adaptive table. Order matters within fallbackChain — never put
// voice-passphrase as a fallback for deaf-hard-of-hearing, never put
// passkey as a sole option for someone who declared no-device-biometric.
const METHOD_RULES: Record<DeclaredNeed, MethodPlan> = {
  'blind-low-vision': {
    primary: 'passkey',
    fallbackChain: ['voice-passphrase', 'trusted-contact-assisted'],
    uiMode: 'standard',
    reasonForPerson:
      'Your device\'s built-in sign-in (Face ID, Touch ID, or a PIN) works well with screen readers since it\'s your phone\'s own prompt, not something we build ourselves.',
  },
  'deaf-hard-of-hearing': {
    primary: 'passkey',
    fallbackChain: ['trusted-contact-assisted'], // voice-passphrase deliberately excluded here
    uiMode: 'standard',
    reasonForPerson:
      'Your device\'s built-in sign-in works fully without sound, so that\'s what we\'ll use first.',
  },
  'motor-impaired': {
    primary: 'trusted-contact-assisted',
    fallbackChain: ['passkey'],
    uiMode: 'simplified',
    reasonForPerson:
      'If a single tap or gesture is hard to do reliably, we\'ll start by letting a trusted contact confirm it\'s you, instead of requiring a precise gesture every time.',
  },
  'cognitive-accessibility': {
    primary: 'passkey',
    fallbackChain: ['trusted-contact-assisted'],
    uiMode: 'simplified',
    reasonForPerson:
      'We\'ll use your device\'s built-in sign-in with a simpler, slower-paced screen — no countdowns, no multi-step puzzles.',
  },
  'no-device-biometric': {
    primary: 'voice-passphrase',
    fallbackChain: ['trusted-contact-assisted'],
    uiMode: 'standard',
    reasonForPerson:
      'Since your device doesn\'t have Face ID or Touch ID set up, we\'ll use a spoken phrase only you know instead.',
  },
  'none-declared': {
    primary: 'passkey',
    fallbackChain: ['voice-passphrase', 'trusted-contact-assisted'],
    uiMode: 'standard',
    reasonForPerson: 'We\'ll use your device\'s built-in sign-in (Face ID, Touch ID, or a PIN).',
  },
};

// A person can declare more than one need. When they do, we don't silently
// pick one — we resolve by a clear, statable priority instead of guessing.
// Priority: anything that EXCLUDES a method (deaf -> never voice) wins over
// anything that just prefers one, and trusted-contact-assisted (the most
// supported, least self-reliant option) is the safe fallback when rules conflict.
const PRIORITY_ORDER: DeclaredNeed[] = [
  'deaf-hard-of-hearing', // exclusion rule, must be respected first
  'no-device-biometric', // hard hardware constraint
  'motor-impaired',
  'cognitive-accessibility',
  'blind-low-vision',
  'none-declared',
];

export function resolveMethodPlan(declaredNeeds: DeclaredNeed[]): MethodPlan {
  if (declaredNeeds.length === 0) return METHOD_RULES['none-declared'];

  const highestPriority = PRIORITY_ORDER.find((need) => declaredNeeds.includes(need));
  const base = METHOD_RULES[highestPriority ?? 'none-declared'];

  // If multiple needs were declared, merge fallback chains from all of them
  // so a real alternative still exists even when the top-priority need's
  // chain runs out — but never re-introduce an excluded method (e.g. never
  // add voice-passphrase back in if deaf-hard-of-hearing was declared).
  const excludedMethods = new Set<AuthMethod>();
  if (declaredNeeds.includes('deaf-hard-of-hearing')) excludedMethods.add('voice-passphrase');

  const mergedFallback = Array.from(
    new Set(
      declaredNeeds
        .flatMap((need) => METHOD_RULES[need].fallbackChain)
        .filter((m) => m !== base.primary && !excludedMethods.has(m)),
    ),
  );

  return { ...base, fallbackChain: mergedFallback.length > 0 ? mergedFallback : base.fallbackChain };
}
