-- Topbar domain schema (PostgreSQL / Supabase)
-- Apply this once in your DB migration pipeline.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'organization_role') then
    create type organization_role as enum ('admin', 'manager', 'support', 'read_only');
  end if;
end $$;

create table if not exists public.users (
  id uuid primary key,
  name text,
  email text not null unique,
  password_hash text,
  avatar_url text,
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role organization_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  enabled boolean not null default true,
  primary key (user_id, type)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_read_idx
  on public.notifications (user_id, read_at);

create index if not exists notifications_user_org_idx
  on public.notifications (user_id, organization_id);

-- Realtime websocket support for notifications.
alter table if exists public.notifications
  replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
