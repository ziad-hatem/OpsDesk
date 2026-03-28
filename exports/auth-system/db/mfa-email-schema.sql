-- Email MFA challenge storage
-- Apply this to enable email verification code step for multi-step authentication.

create table if not exists public.email_mfa_challenges (
  user_id text primary key,
  code_hash text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  expires_at timestamp with time zone not null,
  last_sent_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_email_mfa_challenges_expires_at
  on public.email_mfa_challenges (expires_at);

alter table public.email_mfa_challenges enable row level security;

drop policy if exists "Users can manage their own email MFA challenges" on public.email_mfa_challenges;
create policy "Users can manage their own email MFA challenges"
on public.email_mfa_challenges
for all
using (auth.uid()::text = user_id);

drop policy if exists "Service role access email MFA challenges" on public.email_mfa_challenges;
create policy "Service role access email MFA challenges"
on public.email_mfa_challenges
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.set_email_mfa_challenges_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists email_mfa_challenges_set_updated_at on public.email_mfa_challenges;
create trigger email_mfa_challenges_set_updated_at
before update on public.email_mfa_challenges
for each row
execute function public.set_email_mfa_challenges_updated_at();

create or replace function public.cleanup_expired_email_mfa_challenges()
returns void
language plpgsql
as $$
begin
  delete from public.email_mfa_challenges
  where expires_at < now();
end;
$$;
