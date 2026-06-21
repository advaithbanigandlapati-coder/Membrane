export interface TrustedContact {
  name: string;
  relationship: string;
  channel: 'sms' | 'email';
  channelValue: string;
}

export interface OnboardingState {
  userId: string | null;
  declaredNeeds: string[];
  trustedContacts: TrustedContact[];
  caretakerPresent: boolean;
  methodEnrolled: boolean;
}

export interface AgentDecisionRecord {
  id: string;
  agent: string;
  decision: string;
  confidence: number;
  reason: string;
  created_at: string;
}
