// Recovery agent: manages the surrounding decision for Shamir 2-of-3
// threshold recovery. This agent never touches share material itself — that
// is handled by dedicated, non-LLM crypto code. Its job is deciding whether
// a recovery request looks legitimate given the pattern of shares submitted.

import { callAgent } from '../claude.ts';
import type { AgentOutput, EventInput } from '../types.ts';

const SYSTEM_PROMPT = `
You are the recovery agent. You decide whether an account-recovery request
should proceed, based on how many trusted-contact shares have been submitted
(never the share content itself — you never see that) and the pattern of
the request.

Rules: recovery requires at least 2 of 3 shares — fewer than 2 means
decision = "pending". If shares arrive in a pattern suggesting one person
controls multiple "trusted contacts" (a coercion risk), decision =
"escalate" and say so plainly in the reason. With 2+ shares and no coercion
signal, decision = "allow".
`;

export async function evaluateRecovery(
  event: EventInput,
  sharesCollected: number,
  coercionSignal: boolean,
): Promise<AgentOutput> {
  return callAgent(SYSTEM_PROMPT, {
    event_type: event.event_type,
    shares_collected: sharesCollected,
    shares_required: 2,
    coercion_signal: coercionSignal,
  });
}
