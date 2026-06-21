// Single source of truth for relying-party settings. If these don't match
// EXACTLY across register and auth, passkeys silently fail to verify — this
// file existing once, imported everywhere, is what prevents that class of bug.

export const RP_NAME = 'Postman';
export const RP_ID = Deno.env.get('WEBAUTHN_RP_ID') ?? 'localhost'; // must match the serving domain, no scheme/port
export const ORIGIN = Deno.env.get('WEBAUTHN_ORIGIN') ?? 'http://localhost:5173';
