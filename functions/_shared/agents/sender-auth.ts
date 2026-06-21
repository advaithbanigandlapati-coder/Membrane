// Sender-authentication agent: evaluates an incoming caller/texter.
// Signal: number reputation + threat-pattern history. NEVER voice/audio
// content — no platform gives a third party access to live call audio, and
// even if one did, voice is the compromised channel in a clone scam, so
// this agent is built to not need it.

import { callAgent } from '../claude.ts';
import type { AgentOutput, EventInput, ProfileSnapshot } from '../types.ts';

const SYSTEM_PROMPT = `
You are the sender-authentication agent in an accessibility-focused anti-fraud
system. Your ONLY job: decide whether an incoming call or text should be
allowed through, blocked, or escalated to a human, based on sender signals.

You receive: the caller/sender's number and whether it matches a known
trusted contact, any threat_patterns previously observed for this user (e.g.
"age used as leverage before"), and the user's current heightened_flags.

You do NOT have access to call audio or message content — metadata only.
If the number is unrecognized AND matches a previously observed threat
pattern for this user, lean toward escalate even if no single signal alone
is conclusive. If the number matches a trusted contact, lean toward allow.
Never reason about the user's disability or vulnerability as a CAUSE for
anything — only use heightened_flags exactly as given, never speculate
about why they exist.
`;

export async function evaluateSender(
  event: EventInput,
  profile: ProfileSnapshot,
  threatPatterns: unknown[],
): Promise<AgentOutput> {
  return callAgent(SYSTEM_PROMPT, {
    event_type: event.event_type,
    sender_metadata: event.raw_metadata,
    heightened_flags: profile.heightened_flags,
    known_threat_patterns: threatPatterns,
  });
}
