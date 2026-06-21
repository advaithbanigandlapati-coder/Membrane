import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

const FUNCTIONS_URL = (import.meta.env.VITE_SUPABASE_URL || 'https://hifbxgpgnlsrkyvhgboj.supabase.co').replace(
  '.supabase.co',
  '.functions.supabase.co',
);

export async function registerPasskey(userId: string) {
  const optionsRes = await fetch(`${FUNCTIONS_URL}/webauthn-register-options`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const options = await optionsRes.json();
  const attestation = await startRegistration(options);
  const verifyRes = await fetch(`${FUNCTIONS_URL}/webauthn-register-verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId, attestation }),
  });
  if (!verifyRes.ok) throw new Error('Passkey registration could not be verified');
  return verifyRes.json();
}

export async function authenticateWithPasskey(userId: string) {
  const optionsRes = await fetch(`${FUNCTIONS_URL}/webauthn-auth-options`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const options = await optionsRes.json();
  const assertion = await startAuthentication(options);
  const verifyRes = await fetch(`${FUNCTIONS_URL}/webauthn-auth-verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId, assertion }),
  });
  if (!verifyRes.ok) return false;
  const result = await verifyRes.json();
  return result.verified === true;
}
