-- Team management schema (PostgreSQL / Supabase)
-- Apply after db/topbar-schema.sql

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'organization_membership_status') then
    create type organization_membership_status as enum ('active', 'suspended');
  end if;
end $$;

alter table public.organization_memberships
  add column if not exists status organization_membership_status not null default 'active',
  add column if not exists joined_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists organization_memberships_org_user_uidx
  on public.organization_memberships (organization_id, user_id);

create index if not exists organization_memberships_org_idx
  on public.organization_memberships (organization_id);

create index if not exists organization_memberships_org_role_idx
  on public.organization_memberships (organization_id, role);

create index if not exists organization_memberships_org_status_idx
  on public.organization_memberships (organization_id, status);

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email varchar(255) not null,
  role organization_role not null,
  token_hash varchar(255) not null,
  expires_at timestamptz not null,
  invited_by uuid not null references public.users(id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists organization_invites_org_idx
  on public.organization_invites (organization_id);

create index if not exists organization_invites_org_email_idx
  on public.organization_invites (organization_id, email);

create index if not exists organization_invites_expires_idx
  on public.organization_invites (expires_at);
