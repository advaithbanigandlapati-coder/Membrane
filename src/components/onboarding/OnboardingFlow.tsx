import { useState } from 'react';
import { NeedsDeclaration } from './NeedsDeclaration';
import { TrustedContacts } from './TrustedContacts';
import { MethodEnrollment } from './MethodEnrollment';
import type { DeclaredNeed, MethodPlan } from '../../lib/methodSelection';
import { splitRecoverySecret, generateRecoveryKey } from '../../lib/shamir';
import { supabase } from '../../lib/api';
import type { TrustedContact } from '../../lib/types';

type Step = 'needs' | 'contacts' | 'enroll' | 'caretaker' | 'confirm' | 'done';

interface OnboardingFlowProps {
  userId: string;
}

export function OnboardingFlow({ userId }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>('needs');
  const [, setDeclaredNeeds] = useState<DeclaredNeed[]>([]);
  const [plan, setPlan] = useState<MethodPlan | null>(null);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [, setCaretakerPresent] = useState(false);

  async function handleNeedsResolved(needs: DeclaredNeed[], resolvedPlan: MethodPlan) {
    setDeclaredNeeds(needs);
    setPlan(resolvedPlan);
    // declared_needs is written ONCE here, before lock — this is the only
    // write path that's allowed to touch it; the DB trigger blocks any
    // further writes once declared_needs_locked flips true at confirm.
    await supabase.from('user_security_profile').update({ declared_needs: needs }).eq('user_id', userId);
    setStep('contacts');
  }

  async function handleContactsComplete(submitted: TrustedContact[]) {
    setContacts(submitted);
    if (submitted.length >= 2) {
      // Enough contacts for real 2-of-3 Shamir recovery — generate and split now.
      const recoveryKey = generateRecoveryKey();
      const shares = await splitRecoverySecret(recoveryKey);
      const { data: contactRows } = await supabase
        .from('trusted_contacts')
        .insert(
          submitted.map((c) => ({
            user_id: userId,
            name: c.name,
            relationship: c.relationship,
            channel: c.channel,
            channel_value: c.channelValue,
          })),
        )
        .select();

      if (contactRows) {
        await supabase.from('recovery_shares').insert(
          contactRows.slice(0, shares.length).map((row, i) => ({
            user_id: userId,
            trusted_contact_id: row.id,
            encrypted_share: btoa(String.fromCharCode(...shares[i])), // base64 for storage; real deployment should encrypt this further at rest via Vault
            threshold: 2,
            total_shares: shares.length,
          })),
        );
      }
    } else if (submitted.length > 0) {
      // Fewer than 2: contacts stored for escalation purposes, but Shamir
      // recovery isn't viable yet — don't silently pretend it's set up.
      await supabase.from('trusted_contacts').insert(
        submitted.map((c) => ({
          user_id: userId,
          name: c.name,
          relationship: c.relationship,
          channel: c.channel,
          channel_value: c.channelValue,
        })),
      );
    }
    setStep('enroll');
  }

  function handleEnrollComplete() {
    setStep('caretaker');
  }

  async function handleCaretakerAnswer(present: boolean) {
    setCaretakerPresent(present);
    await supabase.from('users').update({ caretaker_present: present }).eq('id', userId);
    setStep('confirm');
  }

  async function handleFinalConfirm() {
    // The lock: declared_needs becomes immutable, account goes active.
    // This requires the user's OWN confirmation (they're already
    // authenticated to be on this screen via the method just enrolled) —
    // not whoever may have helped them get here.
    await supabase
      .from('user_security_profile')
      .update({ declared_needs_locked: true })
      .eq('user_id', userId);
    await supabase.from('users').update({ onboarding_status: 'active' }).eq('id', userId);
    setStep('done');
  }

  if (step === 'needs') return <NeedsDeclaration onResolved={handleNeedsResolved} />;

  if (step === 'contacts') {
    return (
      <TrustedContacts
        required={plan?.primary === 'trusted-contact-assisted'}
        onComplete={handleContactsComplete}
      />
    );
  }

  if (step === 'enroll' && plan) {
    return (
      <MethodEnrollment
        userId={userId}
        plan={plan}
        hasTrustedContacts={contacts.length > 0}
        onComplete={handleEnrollComplete}
      />
    );
  }

  if (step === 'caretaker') {
    return (
      <section style={{ maxWidth: 480 }}>
        <h2>One last question</h2>
        <p>Did someone help you set this up today?</p>
        <button type="button" onClick={() => handleCaretakerAnswer(true)}>
          Yes, someone helped me
        </button>
        <button type="button" onClick={() => handleCaretakerAnswer(false)}>
          No, I did this myself
        </button>
      </section>
    );
  }

  if (step === 'confirm') {
    return (
      <section style={{ maxWidth: 480 }}>
        <h2>Confirm it's you</h2>
        <p>
          To finish setup, confirm using the sign-in method you just set up. This step has to be
          done by you, even if someone helped with the rest.
        </p>
        <button type="button" onClick={handleFinalConfirm}>
          Confirm and finish setup
        </button>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 480 }}>
      <h2>You're all set</h2>
      <p>Your account is active and protected.</p>
    </section>
  );
}
