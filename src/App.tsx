import { useState } from 'react';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { AdaptiveLogin } from './components/auth/AdaptiveLogin';
import { ExplainabilityView } from './components/explainability/ExplainabilityView';
import { RecoveryFlow } from './components/recovery/RecoveryFlow';
import { CallSimulationDemo } from './components/demo/CallSimulationDemo';
import { supabase } from './lib/api';

type Screen = 'landing' | 'onboarding' | 'login' | 'recovery' | 'dashboard';

export default function App() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [userId, setUserId] = useState<string | null>(null);

  async function handleStartOnboarding() {
    // Real account creation happens via Supabase Auth elsewhere in a full
    // build (email/magic-link signup screen) — for now this creates the
    // `users` row directly so onboarding has something to attach to.
    const {
      data: { user: authUser },
    } = await supabase.auth.signInAnonymously();
    if (!authUser) return;

    const { data: userRow } = await supabase
      .from('users')
      .insert({ auth_user_id: authUser.id, display_name: 'New user' })
      .select()
      .single();

    if (userRow) {
      await supabase.from('user_security_profile').insert({ user_id: userRow.id });
      setUserId(userRow.id);
      setScreen('onboarding');
    }
  }

  if (screen === 'landing') {
    return (
      <main style={{ maxWidth: 480, margin: '40px auto', fontFamily: 'sans-serif' }}>
        <h1>A shield that adapts to you</h1>
        <p>Protection against scams and lockouts, built around what you actually need.</p>
        <button type="button" onClick={handleStartOnboarding}>
          Get started
        </button>
        <button
          type="button"
          onClick={() => {
            const id = prompt('Enter your user id to sign in (dev only)');
            if (id) {
              setUserId(id);
              setScreen('login');
            }
          }}
        >
          I already have an account
        </button>
      </main>
    );
  }

  if (screen === 'onboarding' && userId) {
    return (
      <main style={{ maxWidth: 480, margin: '40px auto', fontFamily: 'sans-serif' }}>
        <OnboardingFlow userId={userId} />
        <button type="button" onClick={() => setScreen('dashboard')} style={{ marginTop: 24 }}>
          Skip to dashboard (dev only)
        </button>
      </main>
    );
  }

  if (screen === 'login' && userId) {
    return (
      <main style={{ maxWidth: 480, margin: '40px auto', fontFamily: 'sans-serif' }}>
        <AdaptiveLogin userId={userId} onSuccess={() => setScreen('dashboard')} />
        <button type="button" onClick={() => setScreen('recovery')} style={{ marginTop: 24 }}>
          I'm locked out, help me recover my account
        </button>
      </main>
    );
  }

  if (screen === 'recovery' && userId) {
    return (
      <main style={{ maxWidth: 480, margin: '40px auto', fontFamily: 'sans-serif' }}>
        <RecoveryFlow userId={userId} onRecovered={() => setScreen('dashboard')} />
      </main>
    );
  }

  if (screen === 'dashboard' && userId) {
    return (
      <main style={{ maxWidth: 560, margin: '40px auto', fontFamily: 'sans-serif' }}>
        <h1>Your account</h1>
        <CallSimulationDemo userId={userId} />
        <hr style={{ margin: '32px 0' }} />
        <ExplainabilityView userId={userId} />
      </main>
    );
  }

  return null;
}
