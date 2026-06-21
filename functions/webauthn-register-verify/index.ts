// Step 2 of passkey enrollment: verify the attestation the browser produced
// against the challenge we stored, then save the credential. This server
// check is what makes WebAuthn real — a client that only ran startRegistration
// without this verification step could be tricked by a forged response.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyRegistrationResponse } from 'https://esm.sh/@simplewebauthn/server@13';
import { RP_ID, ORIGIN } from '../_shared/webauthnConfig.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  try {
    const { user_id, attestation } = await req.json();

    const { data: profile } = await supabase
      .from('user_security_profile')
      .select('pending_webauthn_challenge')
      .eq('user_id', user_id)
      .single();

    if (!profile?.pending_webauthn_challenge) {
      return new Response(JSON.stringify({ error: 'no pending challenge for this user' }), { status: 400 });
    }

    const verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge: profile.pending_webauthn_challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return new Response(JSON.stringify({ verified: false }), { status: 200 });
    }

    const { credential } = verification.registrationInfo;

    await supabase.from('webauthn_credentials').insert({
      user_id,
      credential_id: credential.id,
      public_key: btoa(String.fromCharCode(...credential.publicKey)),
      counter: credential.counter,
      device_type: verification.registrationInfo.credentialDeviceType,
    });

    // Challenge is single-use — clear it immediately so it can never be replayed
    await supabase
      .from('user_security_profile')
      .update({ pending_webauthn_challenge: null })
      .eq('user_id', user_id);

    await supabase.from('users').update({ primary_auth_method: 'passkey' }).eq('id', user_id);

    return new Response(JSON.stringify({ verified: true }), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
