-- Custom RBAC + approval flow schema for OpsDesk
-- Apply this after db/topbar-schema.sql and db/team-schema.sql.

create extension if not exists pgcrypto;

do $$
begin
  create type public.rbac_permission_effect as enum ('allow', 'deny');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.approval_request_status as enum (
    'pending',
    'approved',
    'rejected',
    'cancelled',
    'expired'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.approval_decision as enum ('approved', 'rejected');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.custom_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name varchar(80) not null,
  description text null,
  is_system boolean not null default false,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint custom_roles_org_name_unique unique (organization_id, name)
);

create table if not exists public.custom_role_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.custom_roles(id) on delete cascade,
  permission_key varchar(160) not null,
  effect public.rbac_permission_effect not null default 'allow',
  created_at timestamp with time zone not null default now(),
  constraint custom_role_permissions_unique unique (role_id, permission_key, effect)
);

alter table public.organization_memberships
  add column if not exists custom_role_id uuid null references public.custom_roles(id) on delete set null;

create table if not exists public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  permission_key varchar(160) not null,
  enabled boolean not null default true,
  min_approvals integer not null default 1 check (min_approvals > 0 and min_approvals <= 10),
  approver_roles public.organization_role[] not null default array['admin']::public.organization_role[],
  approver_custom_role_ids uuid[] not null default '{}'::uuid[],
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint approval_policies_org_permission_unique unique (organization_id, permission_key)
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  permission_key varchar(160) not null,
  action_label varchar(180) not null,
  entity_type varchar(80) null,
  entity_id varchar(120) null,
  payload jsonb null,
  status public.approval_request_status not null default 'pending',
  requested_by uuid not null references public.users(id) on delete cascade,
  policy_id uuid null references public.approval_policies(id) on delete set null,
  required_approvals integer not null default 1 check (required_approvals > 0 and required_approvals <= 10),
  approved_count integer not null default 0 check (approved_count >= 0),
  approver_roles public.organization_role[] not null default array['admin']::public.organization_role[],
  approver_custom_role_ids uuid[] not null default '{}'::uuid[],
  expires_at timestamp with time zone null,
  used_at timestamp with time zone null,
  used_by uuid null references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.approval_request_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  decided_by uuid not null references public.users(id) on delete cascade,
  decision public.approval_decision not null,
  comment text null,
  created_at timestamp with time zone not null default now(),
  constraint approval_request_decisions_unique unique (request_id, decided_by)
);

create or replace function public.set_custom_roles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_approval_policies_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_approval_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists custom_roles_set_updated_at on public.custom_roles;
create trigger custom_roles_set_updated_at
before update on public.custom_roles
for each row
execute function public.set_custom_roles_updated_at();

drop trigger if exists approval_policies_set_updated_at on public.approval_policies;
create trigger approval_policies_set_updated_at
before update on public.approval_policies
for each row
execute function public.set_approval_policies_updated_at();

drop trigger if exists approval_requests_set_updated_at on public.approval_requests;
create trigger approval_requests_set_updated_at
before update on public.approval_requests
for each row
execute function public.set_approval_requests_updated_at();

create index if not exists idx_custom_roles_org_created_at
  on public.custom_roles (organization_id, created_at desc);
create index if not exists idx_custom_role_permissions_org_role
  on public.custom_role_permissions (organization_id, role_id);
create index if not exists idx_custom_role_permissions_org_permission
  on public.custom_role_permissions (organization_id, permission_key);
create index if not exists idx_org_memberships_org_custom_role
  on public.organization_memberships (organization_id, custom_role_id);

create index if not exists idx_approval_policies_org_permission
  on public.approval_policies (organization_id, permission_key);
create index if not exists idx_approval_policies_org_enabled
  on public.approval_policies (organization_id, enabled);

create index if not exists idx_approval_requests_org_status_created_at
  on public.approval_requests (organization_id, status, created_at desc);
create index if not exists idx_approval_requests_org_requester_created_at
  on public.approval_requests (organization_id, requested_by, created_at desc);
create index if not exists idx_approval_requests_org_permission_status
  on public.approval_requests (organization_id, permission_key, status, created_at desc);
create index if not exists idx_approval_requests_org_entity_status
  on public.approval_requests (organization_id, entity_type, entity_id, status, created_at desc);

create index if not exists idx_approval_request_decisions_org_request_created_at
  on public.approval_request_decisions (organization_id, request_id, created_at asc);
create index if not exists idx_approval_request_decisions_org_decider_created_at
  on public.approval_request_decisions (organization_id, decided_by, created_at desc);
