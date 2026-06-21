// Escalation — pages the trusted contact via Twilio, falls back to the
// institutional queue if none exists. Called by the orchestrator, never
// directly by a client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_FROM = Deno.env.get('TWILIO_FROM_NUMBER');

Deno.serve(async (req) => {
  try {
    const { user_id, agent_decision_id } = await req.json();

    const { data: decision } = await supabase
      .from('agent_decisions')
      .select('*')
      .eq('id', agent_decision_id)
      .single();

    const { data: contacts } = await supabase
      .from('trusted_contacts')
      .select('*')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .eq('channel', 'sms')
      .limit(1);

    const contact = contacts?.[0];

    if (!contact) {
      // No personal trusted contact — institutional fallback, not a dead end
      const { data: escalation } = await supabase
        .from('escalations')
        .insert({
          user_id,
          agent_decision_id,
          escalation_type: 'institutional',
          status: 'institutional_fallback',
        })
        .select()
        .single();

      return new Response(JSON.stringify({ routed: 'institutional', escalation }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    const { data: escalationRow } = await supabase
      .from('escalations')
      .insert({
        user_id,
        agent_decision_id,
        escalation_type: 'personal',
        trusted_contact_id: contact.id,
        status: 'pending',
      })
      .select()
      .single();

    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) {
      const body = `This is a security check on behalf of someone you're a trusted contact for. ${decision?.reason ?? 'A request needs a second look.'} Reply YES if this is expected, or call them directly.`;

      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
        },
        body: new URLSearchParams({
          To: contact.channel_value,
          From: TWILIO_FROM,
          Body: body,
        }),
      });
    }

    return new Response(JSON.stringify({ routed: 'personal', escalation: escalationRow }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
