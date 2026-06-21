// Step 1 of passkey enrollment: generate a registration challenge,
// store it server-side (never trust a challenge the client sends back),
// return options for the browser's navigator.credentials.create().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateRegistrationOptions } from 'https://esm.sh/@simplewebauthn/server@13';
import { RP_NAME, RP_ID } from '../_shared/webauthnConfig.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  try {
    const { user_id } = await req.json();
    if (!user_id) return new Response(JSON.stringify({ error: 'user_id required' }), { status: 400 });

    const { data: user } = await supabase.from('users').select('display_name').eq('id', user_id).single();
    if (!user) return new Response(JSON.stringify({ error: 'user not found' }), { status: 404 });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: user.display_name,
      attestationType: 'none', // we don't need device attestation, just a working credential
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred', // accommodates devices without biometric hardware too
      },
    });

    // Store the challenge tied to this user so register-verify can check it
    // matches — without this, anyone could submit a forged attestation.
    await supabase
      .from('user_security_profile')
      .update({ pending_webauthn_challenge: options.challenge })
      .eq('user_id', user_id);

    return new Response(JSON.stringify(options), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
