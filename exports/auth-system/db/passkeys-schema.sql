-- Passkey (WebAuthn) support schema for next-passkey-webauthn + Supabase

create extension if not exists pgcrypto;

create table if not exists public.passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  credential_id text not null unique,
  public_key text not null,
  counter integer not null default 0,
  transports text[] not null default '{}',
  user_name text null,
  user_display_name text null,
  authenticator_attachment text null,
  device_info jsonb not null default '{}'::jsonb,
  backup_eligible boolean not null default false,
  backup_state boolean not null default false,
  last_used_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.passkey_challenges (
  id text primary key,
  user_id text not null,
  flow text not null,
  challenge text not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_passkeys_user_id on public.passkeys (user_id);
create index if not exists idx_passkeys_credential_id on public.passkeys (credential_id);
create index if not exists idx_passkey_challenges_user_id on public.passkey_challenges (user_id);
create index if not exists idx_passkey_challenges_expires_at
  on public.passkey_challenges (expires_at);

alter table public.passkeys enable row level security;
alter table public.passkey_challenges enable row level security;

drop policy if exists "Users can manage their own passkeys" on public.passkeys;
create policy "Users can manage their own passkeys"
on public.passkeys
for all
using (auth.uid()::text = user_id);

drop policy if exists "Service role access passkeys" on public.passkeys;
create policy "Service role access passkeys"
on public.passkeys
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Users can manage their own passkey challenges" on public.passkey_challenges;
create policy "Users can manage their own passkey challenges"
on public.passkey_challenges
for all
using (auth.uid()::text = user_id);

drop policy if exists "Service role access passkey challenges" on public.passkey_challenges;
create policy "Service role access passkey challenges"
on public.passkey_challenges
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.set_passkeys_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists passkeys_set_updated_at on public.passkeys;
create trigger passkeys_set_updated_at
before update on public.passkeys
for each row
execute function public.set_passkeys_updated_at();

create or replace function public.cleanup_expired_passkey_challenges()
returns void
language plpgsql
as $$
begin
  delete from public.passkey_challenges
  where expires_at < now();
end;
$$;

