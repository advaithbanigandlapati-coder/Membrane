// Guardrail: validates every agent output before anything downstream acts on
// it. Catches malformed output, low-confidence-but-acted-on decisions, and
// the one non-negotiable rule: no diagnosis-like language, ever.

import type { AgentOutput, DecisionVerdict } from './types.ts';

const DIAGNOSIS_PATTERN =
  /\b(diagnos|dementia|alzheimer|cognitive (decline|impairment)|disab(led|ility)|autis|blind(ness)?|deaf(ness)?|adhd|depression|anxiety disorder|mental (illness|health condition)|condition (is|suggests))\b/i;

const MIN_CONFIDENCE_TO_ACT = 0.55;
const VALID_DECISIONS: DecisionVerdict[] = ['allow', 'block', 'escalate', 'route_alternative', 'pending'];

export interface GuardrailResult {
  passed: boolean;
  reasons: string[]; // internal audit trail, never shown to the end user
  sanitized: AgentOutput;
}

export function runGuardrail(output: AgentOutput): GuardrailResult {
  const failReasons: string[] = [];

  if (!VALID_DECISIONS.includes(output.decision)) failReasons.push('invalid decision value');
  if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
    failReasons.push('confidence out of range');
  }
  if (!output.reason || output.reason.trim().length === 0) failReasons.push('missing reason');
  if (!Array.isArray(output.signals_used)) failReasons.push('signals_used not an array');

  const textToScan = `${output.reason ?? ''} ${(output.signals_used ?? []).join(' ')}`;
  if (DIAGNOSIS_PATTERN.test(textToScan)) {
    failReasons.push('diagnosis-like language detected — rejected per no-self-diagnose rule');
  }

  const passed = failReasons.length === 0;

  if (!passed) {
    return {
      passed: false,
      reasons: failReasons,
      sanitized: {
        decision: 'escalate',
        confidence: 0,
        signals_used: ['guardrail-rejection'],
        reason: 'This needed a closer look, so a person is reviewing it.',
      },
    };
  }

  // Confidence-vs-action consistency: a high-stakes decision made with low
  // confidence should not be silently acted on — route to a human instead.
  if (output.confidence < MIN_CONFIDENCE_TO_ACT && (output.decision === 'allow' || output.decision === 'block')) {
    return {
      passed: true,
      reasons: [],
      sanitized: {
        ...output,
        decision: 'escalate',
        reason: `${output.reason} (Confidence was too low to act on automatically, so a person is reviewing this instead.)`,
      },
    };
  }

  return { passed: true, reasons: [], sanitized: output };
}
