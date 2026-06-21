// Shared types for the agent decision pipeline.

export type AgentName =
  | 'sender_auth'
  | 'receiver_auth'
  | 'recovery'
  | 'adaptation'
  | 'guardrail'
  | 'orchestrator';

export type DecisionVerdict = 'allow' | 'block' | 'escalate' | 'route_alternative' | 'pending';

export interface AgentOutput {
  decision: DecisionVerdict;
  confidence: number; // 0-1
  signals_used: string[]; // categories only, never raw biometric/content
  reason: string; // plain language, required, dignity-framed
}

export type EventType =
  | 'incoming_call'
  | 'incoming_text'
  | 'login_attempt'
  | 'recovery_attempt'
  | 'softlock'
  | 'step_up_action';

export interface EventInput {
  user_id: string;
  event_type: EventType;
  step?: string;
  session_id?: string;
  device_signal?: string;
  raw_metadata?: Record<string, unknown>;
}

export interface ProfileSnapshot {
  declared_needs: unknown[];
  observed_interaction_flags: { flag: string; routed_to?: string; set_at: string }[];
  heightened_flags: { flag: string; set_at: string }[];
}
