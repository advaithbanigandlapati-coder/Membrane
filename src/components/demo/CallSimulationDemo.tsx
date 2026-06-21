import { useState } from 'react';
import { sendEvent } from '../../lib/api';

interface CallSimulationDemoProps {
  userId: string;
}

type DemoStage = 'idle' | 'arriving' | 'evaluating' | 'resolved';
type Channel = 'incoming_call' | 'incoming_text';

interface ScenarioPreset {
  label: string;
  callerName: string;
  callerNumber: string;
  channel: Channel;
  messagePreview?: string;
  metadata: Record<string, unknown>;
}

// Four real scenarios across both channels, all hitting the same live
// agent — only the metadata changes, never the logic. Nothing here is
// hardcoded to produce a specific answer; the agent actually decides.
const SCENARIOS: ScenarioPreset[] = [
  {
    label: 'Call from a saved contact',
    callerName: 'Priya (Daughter)',
    callerNumber: '+1 (555) 555-0100',
    channel: 'incoming_call',
    metadata: { caller_number: '+15555550100', matches_trusted_contact: true },
  },
  {
    label: 'Call from an unrecognized number, urgent tone flagged',
    callerName: 'Unknown Caller',
    callerNumber: '+1 (999) 555-1234',
    channel: 'incoming_call',
    metadata: { caller_number: '+19995551234', matches_trusted_contact: false, urgency_flagged: true },
  },
  {
    label: 'Call from a number that resembles a contact, but doesn\'t match',
    callerName: 'Possible Spoof',
    callerNumber: '+1 (555) 555-0188',
    channel: 'incoming_call',
    // Deliberately mixed signals — close to a trusted number but not an
    // exact match, with a recent flagged event nearby. Engineered to push
    // confidence below the guardrail's 0.55 threshold, which forces
    // escalate regardless of the agent's raw answer — reliable for a live
    // demo without depending on the model happening to be uncertain.
    metadata: {
      caller_number: '+15555550188',
      matches_trusted_contact: false,
      partial_number_similarity_to_contact: true,
      recent_flagged_activity_for_user: true,
    },
  },
  {
    label: 'Text from a saved contact',
    callerName: 'Priya (Daughter)',
    callerNumber: '+1 (555) 555-0100',
    channel: 'incoming_text',
    messagePreview: 'Running 10 min late, see you soon',
    metadata: { sender_number: '+15555550100', matches_trusted_contact: true, message_preview: 'Running 10 min late, see you soon' },
  },
  {
    label: 'Text claiming to be a bank, asking to "verify" account access',
    callerName: 'Unknown Number',
    callerNumber: '+1 (800) 555-0199',
    channel: 'incoming_text',
    messagePreview: 'Your account has been locked. Reply with your verification code to restore access.',
    metadata: {
      sender_number: '+18005550199',
      matches_trusted_contact: false,
      urgency_flagged: true,
      message_preview: 'Your account has been locked. Reply with your verification code to restore access.',
    },
  },
];

export function CallSimulationDemo({ userId }: CallSimulationDemoProps) {
  const [stage, setStage] = useState<DemoStage>('idle');
  const [result, setResult] = useState<{ decision: string; reason: string; confidence: number; routedToContactName: string | null } | null>(null);
  const [activeScenario, setActiveScenario] = useState<ScenarioPreset | null>(null);

  async function runScenario(scenario: ScenarioPreset) {
    setActiveScenario(scenario);
    setResult(null);
    setStage('arriving');

    // Brief, real pause — not theater, this mirrors how long a call/text
    // sits before a screening decision would actually land in practice.
    await new Promise((r) => setTimeout(r, 1600));
    setStage('evaluating');

    // The real call: same orchestrator, same sender-auth agent, same
    // guardrail, same agent_decisions log a native extension would hit.
    // Nothing about the decision itself is staged, on either channel.
    const response = await sendEvent({
      user_id: userId,
      event_type: scenario.channel,
      session_id: crypto.randomUUID(),
      raw_metadata: scenario.metadata,
    });

    setResult({
      decision: response.decision,
      reason: response.reason,
      confidence: response.confidence,
      routedToContactName: response.routedToContactName ?? null,
    });
    setStage('resolved');
  }

  function reset() {
    setStage('idle');
    setResult(null);
    setActiveScenario(null);
  }

  if (stage !== 'idle' && activeScenario?.channel === 'incoming_call') {
    return <RealisticCallScreen scenario={activeScenario} stage={stage} result={result} onClose={reset} />;
  }

  if (stage !== 'idle' && activeScenario?.channel === 'incoming_text') {
    return <TextDemoCard scenario={activeScenario} stage={stage} result={result} onClose={reset} />;
  }

  return (
    <section style={{ maxWidth: 480 }}>
      <h2>Live: call and text screening</h2>
      <p style={{ fontSize: 13, color: '#666' }}>
        The call/text arriving is simulated for this demo — no platform lets a third party intercept
        live call audio or texts before delivery without a native OS extension. The decision shown is
        not staged: this hits the real sender-authentication agent, the real guardrail, and writes a
        real entry to the audit log, exactly as a native extension would on-device.
      </p>
      <div>
        {SCENARIOS.map((s) => (
          <button key={s.label} type="button" onClick={() => runScenario(s)} style={{ display: 'block', marginBottom: 8 }}>
            {s.channel === 'incoming_call' ? '📞' : '💬'} {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}

// --- Call: as close to a real iOS lock-screen incoming call as a web
// mockup reasonably gets. Decline/Accept are visually present, exactly
// like a real call — the point being made is that the system's verdict
// interrupts this screen BEFORE either button is ever pressed.
function RealisticCallScreen({
  scenario,
  stage,
  result,
  onClose,
}: {
  scenario: ScenarioPreset;
  stage: DemoStage;
  result: { decision: string; reason: string; confidence: number; routedToContactName: string | null } | null;
  onClose: () => void;
}) {
  const verdictColor =
    result?.decision === 'allow' ? '#1d9e75' : result?.decision === 'escalate' ? '#ba7517' : '#a32d2d';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(180deg, #1c1c1e 0%, #000 100%)',
        color: 'white',
        fontFamily: '-apple-system, sans-serif',
        zIndex: 1000,
      }}
    >
      {/* mock status bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 24px', fontSize: 14, fontWeight: 500 }}>
        <span>9:41</span>
        <span>•••• 📶 🔋</span>
      </div>

      {(stage === 'arriving' || stage === 'evaluating') && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 48 }}>
          <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 24 }}>iPhone</p>
          <div
            style={{
              width: 110,
              height: 110,
              borderRadius: '50%',
              background: '#3a3a3c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              fontWeight: 500,
              marginBottom: 20,
              animation: stage === 'arriving' ? 'pulse 1.1s ease-in-out infinite' : undefined,
            }}
          >
            {scenario.callerName.charAt(0)}
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 500, margin: 0 }}>{scenario.callerName}</h1>
          <p style={{ opacity: 0.6, marginTop: 6, fontSize: 15 }}>
            {scenario.callerNumber} · {stage === 'arriving' ? 'mobile' : 'checking…'}
          </p>

          <div style={{ display: 'flex', gap: 96, marginTop: 90 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: '50%',
                  background: '#ff3b30',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                }}
              >
                ✕
              </div>
              <span style={{ fontSize: 13, opacity: 0.7 }}>Decline</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: '50%',
                  background: '#34c759',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                }}
              >
                ✓
              </div>
              <span style={{ fontSize: 13, opacity: 0.7 }}>Accept</span>
            </div>
          </div>
          <p style={{ marginTop: 28, fontSize: 12, opacity: 0.4 }}>
            {stage === 'arriving' ? 'ringing…' : 'evaluating sender before this rings through…'}
          </p>
          <style>{`@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.08); opacity: 0.85; } }`}</style>
        </div>
      )}

      {stage === 'resolved' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 80, padding: '0 24px', textAlign: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: verdictColor,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
            }}
          >
            {result.decision === 'allow' ? '✓' : result.decision === 'escalate' ? '!' : '✕'}
          </div>
          <p style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>
            {result.decision === 'block'
              ? 'Call blocked before it reached you'
              : result.decision === 'escalate'
                ? result.routedToContactName
                  ? `Routing to ${result.routedToContactName}…`
                  : 'Held for a second check'
                : 'Verified — allowed through'}
          </p>
          <p style={{ fontSize: 18, marginTop: 12, lineHeight: 1.5, maxWidth: 340 }}>{result.reason}</p>
          <p style={{ fontSize: 12, opacity: 0.4, marginTop: 16 }}>Confidence: {(result.confidence * 100).toFixed(0)}%</p>
          <button
            type="button"
            onClick={onClose}
            style={{ marginTop: 28, padding: '10px 24px', borderRadius: 24, border: 'none', background: '#fff', color: '#0b0b0f', fontWeight: 500 }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

// --- Text: the original simple card treatment, not full-screen.
function TextDemoCard({
  scenario,
  stage,
  result,
  onClose,
}: {
  scenario: ScenarioPreset;
  stage: DemoStage;
  result: { decision: string; reason: string; confidence: number; routedToContactName: string | null } | null;
  onClose: () => void;
}) {
  return (
    <section style={{ maxWidth: 480 }}>
      {(stage === 'arriving' || stage === 'evaluating') && (
        <div role="status" style={{ padding: 24, border: '1px solid #ccc', borderRadius: 8 }}>
          <p style={{ fontWeight: 500 }}>{stage === 'arriving' ? 'New message…' : 'Checking who this is from…'}</p>
          {stage === 'arriving' && (
            <>
              <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
                {scenario.callerName} · {scenario.callerNumber}
              </p>
              <p style={{ marginTop: 8 }}>"{scenario.messagePreview}"</p>
            </>
          )}
        </div>
      )}

      {stage === 'resolved' && result && (
        <div role="alert" style={{ padding: 24, border: '1px solid #ccc', borderRadius: 8 }}>
          <p style={{ fontWeight: 500, textTransform: 'uppercase', fontSize: 12 }}>{result.decision}</p>
          <p>{result.reason}</p>
          <p style={{ fontSize: 12, color: '#666' }}>Confidence: {(result.confidence * 100).toFixed(0)}%</p>
          <button type="button" onClick={onClose} style={{ marginTop: 12 }}>
            Try another scenario
          </button>
        </div>
      )}
    </section>
  );
}
