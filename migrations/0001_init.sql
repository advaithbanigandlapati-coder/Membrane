-- ============================================================================
-- Postman / Guardian — initial schema + RLS
-- Build order step 1. Every table is RLS-scoped from creation, not bolted on.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- institutions (B2B tenants — credit unions etc.)
-- ----------------------------------------------------------------------------
create table institutions (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  created_at      timestamptz not null default now()
);

-- staff accounts belonging to an institution (compliance/fraud-ops viewers)
create table institution_staff (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references institutions(id) on delete cascade,
  auth_user_id    uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'compliance', -- compliance | fraud_ops | admin
  created_at      timestamptz not null default now(),
  unique (institution_id, auth_user_id)
);

-- ----------------------------------------------------------------------------
-- users (account holders — the protected individuals)
-- ----------------------------------------------------------------------------
create table users (
  id                   uuid primary key default gen_random_uuid(),
  auth_user_id         uuid not null references auth.users(id) on delete cascade,
  institution_id       uuid references institutions(id) on delete set null, -- nullable: consumer-direct allowed
  display_name         text not null,
  caretaker_present    boolean not null default false,
  onboarding_status    text not null default 'pending_confirmation'
                         check (onboarding_status in ('pending_confirmation', 'active')),
  primary_auth_method  text default 'passkey'
                         check (primary_auth_method in ('passkey', 'voice-passphrase', 'trusted-contact-assisted')),
  voice_passphrase_hash    text,   -- SHA-256 of the normalized transcript, never raw audio
  voice_passphrase_sample  text,   -- normalized transcript text, used for tolerant re-match
  created_at           timestamptz not null default now(),
  unique (auth_user_id)
);

-- ----------------------------------------------------------------------------
-- trusted_contacts — the social/threshold recovery + escalation list
-- ----------------------------------------------------------------------------
create table trusted_contacts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  name            text not null,
  relationship    text,
  channel         text not null,         -- 'sms' | 'email'
  channel_value   text not null,         -- phone number or email, encrypted at rest via Supabase Vault in prod
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- recovery_shares — Shamir 2-of-3 shares. Never store the reconstructed secret.
-- ----------------------------------------------------------------------------
create table recovery_shares (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  trusted_contact_id  uuid not null references trusted_contacts(id) on delete cascade,
  encrypted_share     text not null,   -- ciphertext only; share index lives inside the encrypted payload
  threshold           int  not null default 2,
  total_shares        int  not null default 3,
  created_at          timestamptz not null default now(),
  unique (trusted_contact_id)
);

-- ----------------------------------------------------------------------------
-- user_security_profile — the adaptation engine's memory
-- declared_needs: write-once from onboarding, NEVER written by the adaptation agent
-- observed_interaction_flags: fixed-vocabulary behavioral flags only, no free text
-- ----------------------------------------------------------------------------
create table user_security_profile (
  user_id                      uuid primary key references users(id) on delete cascade,
  declared_needs                jsonb not null default '[]'::jsonb,   -- set at onboarding, read-only afterward
  observed_interaction_flags    jsonb not null default '[]'::jsonb,   -- e.g. [{"flag":"softlock:visual-step","routed_to":"voice-alt","set_at":...}]
  heightened_flags              jsonb not null default '[]'::jsonb,   -- e.g. [{"flag":"unrecognized-caller-pattern","set_at":...}]
  declared_needs_locked         boolean not null default false,       -- flips true once onboarding confirms; blocks further writes to declared_needs
  pending_webauthn_challenge    text,                                 -- transient: cleared after each register/auth round-trip
  updated_at                    timestamptz not null default now()
);

-- enforce "agents can never write declared_needs after lock" at the DB level,
-- not just in agent prompts — structural enforcement, not just discipline
create or replace function prevent_declared_needs_mutation()
returns trigger as $$
begin
  if old.declared_needs_locked = true and new.declared_needs is distinct from old.declared_needs then
    raise exception 'declared_needs is locked after onboarding confirmation and cannot be modified';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_prevent_declared_needs_mutation
  before update on user_security_profile
  for each row execute function prevent_declared_needs_mutation();

-- ----------------------------------------------------------------------------
-- webauthn_credentials — registered passkey public keys, one user may have several
-- ----------------------------------------------------------------------------
create table webauthn_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  credential_id     text not null unique,   -- base64url, from the authenticator
  public_key        text not null,          -- base64, used to verify future signatures
  counter           bigint not null default 0,
  device_type       text,
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- threat_patterns — the attacker-side model, never about the user's body/mind
-- ----------------------------------------------------------------------------
create table threat_patterns (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references users(id) on delete cascade, -- nullable: aggregate patterns have no single user
  signal_type       text not null,   -- 'unrecognized-number' | 'spoofed-id' | 'urgency-language' | etc.
  leverage_type     text not null,   -- 'age' | 'authority' | 'urgency' | 'kinship-trust' | etc.
  target_asset      text,           -- what was being aimed at: 'money-transfer' | 'account-access' | 'recovery-bypass'
  occurrence_count  int not null default 1,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- events — the raw stream: calls, texts, login/recovery attempts, softlocks
-- ----------------------------------------------------------------------------
create table events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  event_type        text not null
                      check (event_type in (
                        'incoming_call', 'incoming_text', 'login_attempt',
                        'recovery_attempt', 'softlock', 'step_up_action'
                      )),
  step              text,           -- which flow step, e.g. 'passkey', 'shamir-collect', 'visual-step'
  session_id        uuid,
  device_signal     text,           -- partial passkey/device fingerprint, for identity-confidence checks only
  raw_metadata      jsonb not null default '{}'::jsonb,  -- caller number, etc. — never call/text content
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- agent_decisions — explainability source of truth. Every agent writes here.
-- ----------------------------------------------------------------------------
create table agent_decisions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  event_id        uuid references events(id) on delete set null,
  agent           text not null
                    check (agent in (
                      'sender_auth', 'receiver_auth', 'recovery',
                      'adaptation', 'guardrail', 'orchestrator', 'fusion'
                    )),
  decision        text not null,     -- 'allow' | 'block' | 'escalate' | 'route_alternative' | etc.
  confidence      numeric not null check (confidence >= 0 and confidence <= 1),
  signals_used    jsonb not null default '[]'::jsonb,  -- categories only, never raw biometric/content
  reason          text not null,     -- required, plain-language, dignity-framed at render time
  guardrail_passed boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- escalations — human-in-the-loop tracking, personal then institutional fallback
-- ----------------------------------------------------------------------------
create table escalations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  agent_decision_id   uuid not null references agent_decisions(id) on delete cascade,
  escalation_type     text not null check (escalation_type in ('personal', 'institutional')),
  trusted_contact_id  uuid references trusted_contacts(id),
  status              text not null default 'pending'
                        check (status in ('pending', 'responded', 'timed_out', 'institutional_fallback')),
  created_at          timestamptz not null default now(),
  responded_at        timestamptz
);

-- ============================================================================
-- Row Level Security — every table, from creation
-- ============================================================================

alter table institutions enable row level security;
alter table institution_staff enable row level security;
alter table users enable row level security;
alter table trusted_contacts enable row level security;
alter table recovery_shares enable row level security;
alter table user_security_profile enable row level security;
alter table webauthn_credentials enable row level security;
alter table threat_patterns enable row level security;
alter table events enable row level security;
alter table agent_decisions enable row level security;
alter table escalations enable row level security;

-- Helper: is the requesting auth user staff for a given institution?
create or replace function is_institution_staff(target_institution_id uuid)
returns boolean as $$
  select exists (
    select 1 from institution_staff
    where institution_id = target_institution_id
      and auth_user_id = auth.uid()
  );
$$ language sql stable security definer;

-- Helper: does this row's user_id belong to the requesting auth user?
create or replace function owns_user_row(target_user_id uuid)
returns boolean as $$
  select exists (
    select 1 from users
    where id = target_user_id
      and auth_user_id = auth.uid()
  );
$$ language sql stable security definer;

-- users: self access, or institution staff scoped to their own institution
create policy users_self_select on users
  for select using (auth_user_id = auth.uid());
create policy users_self_update on users
  for update using (auth_user_id = auth.uid());
create policy users_institution_staff_select on users
  for select using (institution_id is not null and is_institution_staff(institution_id));

-- trusted_contacts: owner only
create policy trusted_contacts_owner on trusted_contacts
  for all using (owns_user_row(user_id));

-- recovery_shares: owner only — institutions never see shares, even their own customers'
create policy recovery_shares_owner on recovery_shares
  for all using (owns_user_row(user_id));

-- user_security_profile: owner read/write (write path also gated by the trigger above);
-- institution staff get read-only, and only the flag fields are meaningful to them via the view below
create policy profile_owner on user_security_profile
  for all using (owns_user_row(user_id));
create policy profile_institution_staff_select on user_security_profile
  for select using (
    exists (
      select 1 from users u
      where u.id = user_security_profile.user_id
        and u.institution_id is not null
        and is_institution_staff(u.institution_id)
    )
  );

-- webauthn_credentials: owner only — never readable by institutions
create policy webauthn_credentials_owner on webauthn_credentials
  for all using (owns_user_row(user_id));

-- threat_patterns: owner read; institution staff read (aggregate defense intel, never user-identifying body/mind data)
create policy threat_patterns_owner on threat_patterns
  for select using (user_id is null or owns_user_row(user_id));
create policy threat_patterns_institution_staff on threat_patterns
  for select using (
    user_id is not null and exists (
      select 1 from users u
      where u.id = threat_patterns.user_id
        and u.institution_id is not null
        and is_institution_staff(u.institution_id)
    )
  );

-- events: owner only
create policy events_owner on events
  for all using (owns_user_row(user_id));

-- agent_decisions: owner read; institution staff read (this is the compliance audit trail)
create policy agent_decisions_owner on agent_decisions
  for select using (owns_user_row(user_id));
create policy agent_decisions_institution_staff on agent_decisions
  for select using (
    exists (
      select 1 from users u
      where u.id = agent_decisions.user_id
        and u.institution_id is not null
        and is_institution_staff(u.institution_id)
    )
  );

-- escalations: owner read; institution staff read for institutional-fallback cases
create policy escalations_owner on escalations
  for select using (owns_user_row(user_id));
create policy escalations_institution_staff on escalations
  for select using (
    exists (
      select 1 from users u
      where u.id = escalations.user_id
        and u.institution_id is not null
        and is_institution_staff(u.institution_id)
    )
  );

-- institutions / institution_staff: staff can see their own institution's roster only
create policy institutions_staff_select on institutions
  for select using (is_institution_staff(id));
create policy institution_staff_self on institution_staff
  for select using (is_institution_staff(institution_id));

-- ============================================================================
-- Notes for the agent layer (Edge Functions):
-- - All Edge Functions use the service role key (server-side env var only,
--   never shipped to /web, /android, or /ios) and therefore bypass RLS by
--   design — RLS here protects direct client access (web app, future
--   institution dashboard), not the trusted backend agents themselves.
-- - The adaptation agent must never UPDATE user_security_profile.declared_needs
--   after declared_needs_locked = true; the trigger above enforces this even
--   if the agent's own logic has a bug.
-- - The guardrail agent reads agent_decisions.signals_used and reason to
--   confirm no diagnosis-like language was written before flipping
--   guardrail_passed = true; nothing downstream acts on a decision where
--   guardrail_passed = false.
-- ============================================================================
