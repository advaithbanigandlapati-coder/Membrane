import { useState, useEffect } from 'react';
import { supabase, sendEvent } from '../../lib/api';
import { authenticateWithPasskey } from '../../lib/webauthn';
import { captureSpokenPhrase, verifyPassphrase } from '../../lib/voicePassphrase';
import type { AuthMethod } from '../../lib/methodSelection';

interface AdaptiveLoginProps {
  userId: string;
  onSuccess: () => void;
}

export function AdaptiveLogin({ userId, onSuccess }: AdaptiveLoginProps) {
  const [method, setMethod] = useState<AuthMethod | null>(null);
  const [status, setStatus] = useState<'idle' | 'working' | 'failed'>('idle');
  const [softlockCount, setSoftlockCount] = useState(0);

  useEffect(() => {
    // The method actually used is whatever's stored from onboarding's
    // resolved plan — never re-decided here. Receiver-auth agent reads the
    // RESULT of a softlock pattern (observed_interaction_flags), which may
    // override this on a later load — that's the adaptation loop closing.
    supabase
      .from('users')
      .select('primary_auth_method')
      .eq('id', userId)
      .single()
      .then(({ data }) => setMethod((data?.primary_auth_method as AuthMethod) ?? 'passkey'));
  }, [userId]);

  async function recordSoftlockIfNeeded(success: boolean, step: string) {
    if (success) return;
    const sessionId = crypto.randomUUID();
    await sendEvent({
      user_id: userId,
      event_type: 'softlock',
      step,
      session_id: sessionId,
      device_signal: navigator.userAgent,
    });
    setSoftlockCount((c) => c + 1);
  }

  async function handlePasskey() {
    setStatus('working');
    const ok = await authenticateWithPasskey(userId);
    if (ok) {
      onSuccess();
    } else {
      await recordSoftlockIfNeeded(false, 'passkey');
      setStatus('failed');
    }
  }

  async function handleVoice() {
    setStatus('working');
    try {
      const { data: user } = await supabase
        .from('users')
        .select('voice_passphrase_hash, voice_passphrase_sample')
        .eq('id', userId)
        .single();
      const attempt = await captureSpokenPhrase();
      const ok = user && (await verifyPassphrase(attempt, user.voice_passphrase_hash, user.voice_passphrase_sample));
      if (ok) {
        onSuccess();
      } else {
        await recordSoftlockIfNeeded(false, 'voice-passphrase');
        setStatus('failed');
      }
    } catch {
      await recordSoftlockIfNeeded(false, 'voice-passphrase');
      setStatus('failed');
    }
  }

  async function handleTrustedContactRequest() {
    setStatus('working');
    await sendEvent({
      user_id: userId,
      event_type: 'login_attempt',
      step: 'trusted-contact-assisted',
      session_id: crypto.randomUUID(),
    });
    // The actual approval round-trip is async (contact responds via SMS
    // link) — UI here just confirms the request went out.
    setStatus('idle');
  }

  if (!method) return <p>Loading…</p>;

  if (softlockCount >= 2) {
    return (
      <section style={{ maxWidth: 480 }}>
        <h2>Having trouble?</h2>
        <p>This step hasn't been working well. We've noted that — try again, or get help from a trusted contact.</p>
        <button type="button" onClick={() => setSoftlockCount(0)}>
          Try again
        </button>
        <button type="button" onClick={handleTrustedContactRequest}>
          Ask a trusted contact to help instead
        </button>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 480 }}>
      <h2>Sign in</h2>
      {status === 'failed' && <p role="alert">That didn't work. Try again.</p>}
      {method === 'passkey' && (
        <button type="button" onClick={handlePasskey} disabled={status === 'working'}>
          {status === 'working' ? 'Checking…' : 'Sign in with Face ID / Touch ID'}
        </button>
      )}
      {method === 'voice-passphrase' && (
        <button type="button" onClick={handleVoice} disabled={status === 'working'}>
          {status === 'working' ? 'Listening…' : 'Say your phrase'}
        </button>
      )}
      {method === 'trusted-contact-assisted' && (
        <button type="button" onClick={handleTrustedContactRequest} disabled={status === 'working'}>
          {status === 'working' ? 'Sending request…' : 'Ask my trusted contact to confirm it\'s me'}
        </button>
      )}
    </section>
  );
}
