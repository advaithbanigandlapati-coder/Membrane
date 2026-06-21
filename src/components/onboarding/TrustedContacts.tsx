import { useState } from 'react';
import type { TrustedContact } from '../../lib/types';

interface TrustedContactsProps {
  required: boolean; // true when the resolved method plan needs at least one contact to function
  onComplete: (contacts: TrustedContact[]) => void;
}

const EMPTY: TrustedContact = { name: '', relationship: '', channel: 'sms', channelValue: '' };

export function TrustedContacts({ required, onComplete }: TrustedContactsProps) {
  const [contacts, setContacts] = useState<TrustedContact[]>([{ ...EMPTY }]);
  const [skipped, setSkipped] = useState(false);

  function updateContact(index: number, patch: Partial<TrustedContact>) {
    const next = [...contacts];
    next[index] = { ...next[index], ...patch };
    setContacts(next);
  }

  function addContact() {
    if (contacts.length >= 3) return; // 2-of-3 threshold caps usefulness above 3
    setContacts([...contacts, { ...EMPTY }]);
  }

  function removeContact(index: number) {
    setContacts(contacts.filter((_, i) => i !== index));
  }

  const validContacts = contacts.filter((c) => c.name.trim() && c.channelValue.trim());

  // This is the dossier's "not everyone has a Priya" case, made into a real
  // UI path instead of an assumption — institutional fallback covers this,
  // it isn't a dead end, but a method requiring a contact can't proceed
  // without at least one.
  if (skipped) {
    return (
      <section style={{ maxWidth: 480 }}>
        <h2>No trusted contact added</h2>
        <p>
          That's okay. If your account ever needs human verification, it will route to your
          institution's support team instead of a personal contact.
        </p>
        {required && (
          <p>
            <strong>One thing to know:</strong> the sign-in method we picked for you works better
            with at least one trusted contact. You can add one later from settings, or continue
            without one now.
          </p>
        )}
        <button type="button" onClick={() => onComplete([])}>
          Continue without a trusted contact
        </button>
        <button type="button" onClick={() => setSkipped(false)}>
          Actually, let me add one
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="contacts-heading" style={{ maxWidth: 480 }}>
      <h2 id="contacts-heading">Trusted contacts</h2>
      <p>
        Add up to 3 people who can help confirm it's really you, or step in if something looks
        wrong. {required && 'The sign-in method we picked for you uses this.'}
      </p>
      {contacts.map((contact, i) => (
        <fieldset key={i} style={{ marginBottom: 16 }}>
          <legend>Contact {i + 1}</legend>
          <label>
            Name
            <input
              type="text"
              value={contact.name}
              onChange={(e) => updateContact(i, { name: e.target.value })}
            />
          </label>
          <label>
            Relationship
            <input
              type="text"
              value={contact.relationship}
              onChange={(e) => updateContact(i, { relationship: e.target.value })}
            />
          </label>
          <label>
            How should we reach them?
            <select
              value={contact.channel}
              onChange={(e) => updateContact(i, { channel: e.target.value as 'sms' | 'email' })}
            >
              <option value="sms">Text message</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label>
            {contact.channel === 'sms' ? 'Phone number' : 'Email address'}
            <input
              type={contact.channel === 'sms' ? 'tel' : 'email'}
              value={contact.channelValue}
              onChange={(e) => updateContact(i, { channelValue: e.target.value })}
            />
          </label>
          {contacts.length > 1 && (
            <button type="button" onClick={() => removeContact(i)}>
              Remove this contact
            </button>
          )}
        </fieldset>
      ))}
      {contacts.length < 3 && (
        <button type="button" onClick={addContact}>
          Add another contact
        </button>
      )}
      <div style={{ marginTop: 16 }}>
        <button type="button" disabled={validContacts.length === 0} onClick={() => onComplete(validContacts)}>
          Continue with {validContacts.length} contact{validContacts.length === 1 ? '' : 's'}
        </button>
        <button type="button" onClick={() => setSkipped(true)}>
          I don't have anyone to add
        </button>
      </div>
    </section>
  );
}
