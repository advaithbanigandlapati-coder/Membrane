// Step 2 of passkey login: verify the signed assertion against the stored
// public key and challenge. This IS the login — everything in AdaptiveLogin
// on the client is UI around this one cryptographic check.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuthenticationResponse } from 'https://esm.sh/@simplewebauthn/server@13';
import { RP_ID, ORIGIN } from '../_shared/webauthnConfig.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  try {
    const { user_id, assertion } = await req.json();

    const { data: profile } = await supabase
      .from('user_security_profile')
      .select('pending_webauthn_challenge')
      .eq('user_id', user_id)
      .single();

    if (!profile?.pending_webauthn_challenge) {
      return new Response(JSON.stringify({ verified: false, error: 'no pending challenge' }), { status: 400 });
    }

    const { data: cred } = await supabase
      .from('webauthn_credentials')
      .select('*')
      .eq('credential_id', assertion.id)
      .eq('user_id', user_id)
      .single();

    if (!cred) {
      return new Response(JSON.stringify({ verified: false, error: 'credential not recognized' }), { status: 404 });
    }

    const publicKeyBytes = Uint8Array.from(atob(cred.public_key), (c) => c.charCodeAt(0));

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: profile.pending_webauthn_challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: cred.credential_id,
        publicKey: publicKeyBytes,
        counter: cred.counter,
      },
    });

    await supabase
      .from('user_security_profile')
      .update({ pending_webauthn_challenge: null })
      .eq('user_id', user_id);

    if (verification.verified) {
      // Counter must always move forward — a non-increasing counter on a
      // verified response is a real signal of a cloned authenticator.
      await supabase
        .from('webauthn_credentials')
        .update({ counter: verification.authenticationInfo.newCounter })
        .eq('id', cred.id);
    }

    return new Response(JSON.stringify({ verified: verification.verified }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
