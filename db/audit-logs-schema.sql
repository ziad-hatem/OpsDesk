-- Audit log schema extensions for activity timeline
-- Apply this after db/topbar-schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists target_user_id uuid references public.users(id) on delete set null;

alter table public.audit_logs
  add column if not exists source text not null default 'api';

alter table public.audit_logs
  add column if not exists details jsonb;

create index if not exists idx_audit_logs_org_created_at
  on public.audit_logs (organization_id, created_at desc);

create index if not exists idx_audit_logs_org_action_created_at
  on public.audit_logs (organization_id, action, created_at desc);

create index if not exists idx_audit_logs_org_actor_created_at
  on public.audit_logs (organization_id, actor_user_id, created_at desc);

create index if not exists idx_audit_logs_org_target_created_at
  on public.audit_logs (organization_id, target_user_id, created_at desc);

create index if not exists idx_audit_logs_org_entity_created_at
  on public.audit_logs (organization_id, entity_type, entity_id, created_at desc);

create index if not exists idx_audit_logs_details_gin
  on public.audit_logs using gin (details);
