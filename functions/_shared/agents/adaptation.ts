// Adaptation agent: the actual adaptability engine. Two jobs, kept
// structurally separate:
//   1. Softlock correction — proposes a routing fix for THIS user, gated by
//      a two-part safety check that runs BEFORE the LLM is ever called.
//   2. Threat-pattern learning — observes ATTACKER behavior, never the user.
//
// HARD RULE, enforced here AND at the DB trigger level (see migration):
// this agent never writes to declared_needs, and never produces
// diagnosis-like language. The guardrail re-checks this independently —
// this prompt is the first line of defense, not the only one.

import { callAgent } from '../claude.ts';
import type { AgentOutput, EventInput, ProfileSnapshot } from '../types.ts';

const SOFTLOCK_PATTERN_THRESHOLD = 3; // minimum occurrences across distinct sessions

const SYSTEM_PROMPT = `
You are the adaptation agent. You will only ever be called with softlock
data that has ALREADY passed a two-part safety check (pattern threshold +
identity confidence) — your job is to phrase the correction, not decide
whether it's warranted, that gate already happened.

Propose a behavioral ROUTING correction, e.g. "stop offering the visual
step, route to voice-alt instead." decision = "route_alternative".

You must NEVER, under any circumstance, write a medical condition,
disability type, or cognitive/mental state for the user. Describe only what
was OBSERVED (a step failed N times across sessions) — never WHY the user
struggled. If you don't know why, don't guess.
`;

export interface SoftlockHistory {
  step: string;
  occurrences: number;
  distinctSessions: number;
  identityConfidenceHigh: boolean;
}

export async function evaluateAdaptation(
  event: EventInput,
  profile: ProfileSnapshot,
  softlockHistory: SoftlockHistory,
): Promise<AgentOutput> {
  return callAgent(SYSTEM_PROMPT, {
    event_type: event.event_type,
    softlock_history: softlockHistory,
    current_flags: profile.observed_interaction_flags,
  });
}

// Deterministic pre-check — the REAL two-part safety check, run before the
// LLM is ever invoked. This is a hard gate in code, not a prompt suggestion.
export function meetsSoftlockSafetyCheck(history: SoftlockHistory | null): boolean {
  if (!history) return false;
  return history.distinctSessions >= SOFTLOCK_PATTERN_THRESHOLD && history.identityConfidenceHigh;
}
