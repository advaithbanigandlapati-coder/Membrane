import { useState } from 'react';
import type { MethodPlan } from '../../lib/methodSelection';
import { registerPasskey } from '../../lib/webauthn';
import { enrollPassphrase } from '../../lib/voicePassphrase';
import { supabase } from '../../lib/api';

interface MethodEnrollmentProps {
  userId: string;
  plan: MethodPlan;
  hasTrustedContacts: boolean;
  onComplete: () => void;
}

export function MethodEnrollment({ userId, plan, hasTrustedContacts, onComplete }: MethodEnrollmentProps) {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handlePasskeyEnroll() {
    setStatus('working');
    try {
      await registerPasskey(userId);
      setStatus('idle');
      onComplete();
    } catch (e) {
      setError('Your device\'s built-in sign-in could not be set up. You can try again.');
      setStatus('error');
    }
  }

  async function handleVoiceEnroll() {
    setStatus('working');
    try {
      const { hash, sample } = await enrollPassphrase();
      await supabase.from('users').update({ voice_passphrase_hash: hash, voice_passphrase_sample: sample }).eq('id', userId);
      setStatus('idle');
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record your phrase. Try again somewhere quiet.');
      setStatus('error');
    }
  }

  if (plan.primary === 'trusted-contact-assisted') {
    return (
      <section style={{ maxWidth: 480 }}>
        <h2>You're set up</h2>
        <p>
          When you need to sign in, we'll send a request to your trusted contact{hasTrustedContacts ? '' : ' (once you add one)'}{' '}
          to confirm it's you — no gesture or phrase to remember.
        </p>
        <button type="button" onClick={onComplete}>
          Continue
        </button>
      </section>
    );
  }

  if (plan.primary === 'voice-passphrase') {
    return (
      <section style={{ maxWidth: 480 }}>
        <h2>Set up your spoken phrase</h2>
        <p>Choose a short phrase only you would say, like "blue lighthouse seven." You'll say it twice.</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={handleVoiceEnroll} disabled={status === 'working'}>
          {status === 'working' ? 'Listening…' : 'Start recording'}
        </button>
      </section>
    );
  }

  // default: passkey
  return (
    <section style={{ maxWidth: 480 }}>
      <h2>Set up your device sign-in</h2>
      <p>This uses Face ID, Touch ID, or your device PIN — it never leaves your device.</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={handlePasskeyEnroll} disabled={status === 'working'}>
        {status === 'working' ? 'Setting up…' : 'Set up now'}
      </button>
    </section>
  );
}
