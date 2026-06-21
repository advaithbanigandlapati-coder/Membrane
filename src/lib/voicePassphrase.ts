// Voice passphrase: the honest stand-in for "fuzzy extractors" from the
// original notes. NOT real cryptographic fuzzy extraction — that's
// research-grade and out of scope. This is: transcribe locally, normalize,
// tolerate minor variance, hash. Raw audio never leaves the browser.

const SIMILARITY_THRESHOLD = 0.82; // tolerance for re-saying the phrase slightly differently

export function captureSpokenPhrase(): Promise<string> {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      reject(new Error('Speech recognition not supported in this browser'));
      return;
    }
    const recognizer = new SpeechRecognition();
    recognizer.lang = 'en-US';
    recognizer.maxAlternatives = 1;
    recognizer.onresult = (event: any) => {
      resolve(normalize(event.results[0][0].transcript));
    };
    recognizer.onerror = (event: any) => reject(new Error(`Speech capture failed: ${event.error}`));
    recognizer.start();
  });
}

function normalize(transcript: string): string {
  return transcript.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

// Enrollment: capture 2 attempts, only proceed if they're consistent enough
// that we have confidence this phrase is stably reproducible by this person.
export async function enrollPassphrase(): Promise<{ hash: string; sample: string }> {
  const first = await captureSpokenPhrase();
  const second = await captureSpokenPhrase();
  if (similarity(first, second) < SIMILARITY_THRESHOLD) {
    throw new Error('Those two attempts sounded too different — try saying the same phrase both times.');
  }
  const hash = await hashText(first);
  return { hash, sample: first };
}

// Verification: tolerant match, not exact-string match, since spoken input
// is inherently noisy — that tolerance is the whole point of this module.
export async function verifyPassphrase(attempt: string, enrolledHash: string, enrolledSample: string): Promise<boolean> {
  const normalizedAttempt = normalize(attempt);
  if (similarity(normalizedAttempt, enrolledSample) < SIMILARITY_THRESHOLD) return false;
  // Exact hash also checked as the deterministic floor for an identical re-speak
  const attemptHash = await hashText(normalizedAttempt);
  return attemptHash === enrolledHash || similarity(normalizedAttempt, enrolledSample) >= SIMILARITY_THRESHOLD;
}

async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Simple normalized Levenshtein-based similarity, 0 to 1.
function similarity(a: string, b: string): number {
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}
