import { split, combine } from 'shamir-secret-sharing';

// 2-of-3 threshold. Split happens client-side at enrollment so the raw
// secret never transits the network whole; only encrypted shares do.
// Reconstruction (combine) only ever happens transiently during an active
// recovery, never stored.

export async function splitRecoverySecret(secret: string): Promise<Uint8Array[]> {
  const encoded = new TextEncoder().encode(secret);
  return split(encoded, 3, 2);
}

export async function reconstructFromShares(shares: Uint8Array[]): Promise<string> {
  if (shares.length < 2) throw new Error('At least 2 shares are required to reconstruct');
  const combined = await combine(shares);
  return new TextDecoder().decode(combined);
}

// A device-bound recovery key is generated at enrollment and split — this
// is what trusted contacts hold shares of, not the user's actual passkey.
export function generateRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
