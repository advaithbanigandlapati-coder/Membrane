// Receiver-authentication agent: the cryptographic passkey check happens
// elsewhere (SimpleWebAuthn, server-verified) BEFORE this agent is ever
// called — this agent does not verify a biometric or password itself. Its
// job is the surrounding decision: is the CURRENT step in this person's
// login/recovery flow the right one for them, or should it be swapped for
// an accessible alternative the adaptation agent has already identified.

import { callAgent } from '../claude.ts';
import type { AgentOutput, EventInput, ProfileSnapshot } from '../types.ts';

const SYSTEM_PROMPT = `
You are the receiver-authentication agent. The cryptographic passkey check
has already happened elsewhere — you are not verifying a biometric or
password. Your job: given declared_needs and observed_interaction_flags,
decide whether the CURRENT step in this login/recovery flow is right for
this person, or should be swapped for an accessible alternative.

If observed_interaction_flags already contains a routing correction for the
current step (e.g. "softlock:visual-step -> routed to voice-alt"), your
decision should reflect using that alternative: decision = "route_alternative".
You must NEVER write or imply a diagnosis — only reference the flag string
exactly as given, never invent a reason for why it exists.
If nothing unusual applies, decision = "allow".
`;

export async function evaluateReceiver(event: EventInput, profile: ProfileSnapshot): Promise<AgentOutput> {
  return callAgent(SYSTEM_PROMPT, {
    event_type: event.event_type,
    step: event.step,
    declared_needs: profile.declared_needs,
    observed_interaction_flags: profile.observed_interaction_flags,
  });
}
