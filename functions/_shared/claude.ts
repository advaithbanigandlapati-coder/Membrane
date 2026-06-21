// Thin wrapper around the Anthropic API. Every agent call MUST return the
// AgentOutput shape — enforced via a strict system-prompt contract here,
// then independently re-checked by the guardrail before anything acts on it.

import type { AgentOutput } from './types.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-4-6';

const SCHEMA_CONTRACT = `
Respond with ONLY a JSON object, no other text, matching exactly:
{
  "decision": "allow" | "block" | "escalate" | "route_alternative" | "pending",
  "confidence": <number 0 to 1>,
  "signals_used": [<short signal category strings, e.g. "number-reputation", "device-match" — NEVER raw biometric data, NEVER raw call/text content>],
  "reason": "<1-2 plain-language sentences for the affected person to read. Calm, dignity-preserving, never a verdict on their competence.>"
}

CRITICAL CONSTRAINT: Never infer, guess, name, or imply a medical condition,
disability diagnosis, cognitive state, or mental health status for the user,
even if behavior seems consistent with one. Describe OBSERVED BEHAVIOR only
(e.g. "repeated failures on this step"), never a CAUSE (e.g. "may have low
vision" or "appears to be experiencing cognitive decline"). If unsure, omit
the speculation and lower confidence instead.
`;

export async function callAgent(
  agentSystemPrompt: string,
  userContext: Record<string, unknown>,
): Promise<AgentOutput> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: `${agentSystemPrompt}\n\n${SCHEMA_CONTRACT}`,
      messages: [{ role: 'user', content: JSON.stringify(userContext) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';

  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // Malformed output: fail safe to escalate rather than let bad JSON propagate.
    return {
      decision: 'escalate',
      confidence: 0,
      signals_used: ['parse-failure'],
      reason: 'This needed a closer look, so a person is reviewing it.',
    };
  }
}
