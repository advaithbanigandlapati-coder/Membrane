// Step 1 of passkey login: look up this user's registered credentials,
// generate an authentication challenge, store it, return options for the
// browser's navigator.credentials.get().

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateAuthenticationOptions } from 'https://esm.sh/@simplewebauthn/server@13';
import { RP_ID } from '../_shared/webauthnConfig.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  try {
    const { user_id } = await req.json();

    const { data: credentials } = await supabase
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('user_id', user_id);

    if (!credentials || credentials.length === 0) {
      return new Response(JSON.stringify({ error: 'no passkey registered for this user' }), { status: 404 });
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: credentials.map((c) => ({ id: c.credential_id })),
      userVerification: 'preferred',
    });

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
