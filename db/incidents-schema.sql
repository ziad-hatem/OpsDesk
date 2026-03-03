-- Incident management and public status schema for OpsDesk
-- Apply this after db/topbar-schema.sql.

create extension if not exists pgcrypto;

do $$
begin
  create type public.incident_service_health as enum (
    'operational',
    'degraded',
    'partial_outage',
    'major_outage',
    'maintenance'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.incident_status as enum (
    'investigating',
    'identified',
    'monitoring',
    'resolved'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.incident_severity as enum (
    'critical',
    'high',
    'medium',
    'low'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.status_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name varchar(120) not null,
  slug varchar(140) not null,
  description text null,
  current_status public.incident_service_health not null default 'operational',
  is_public boolean not null default true,
  display_order integer not null default 0,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint status_services_org_slug_unique unique (organization_id, slug)
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title varchar(200) not null,
  summary text null,
  status public.incident_status not null default 'investigating',
  severity public.incident_severity not null default 'medium',
  is_public boolean not null default true,
  started_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.incident_impacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  service_id uuid not null references public.status_services(id) on delete cascade,
  impact_level public.incident_service_health not null default 'degraded',
  created_at timestamp with time zone not null default now(),
  constraint incident_impacts_incident_service_unique unique (incident_id, service_id)
);

create table if not exists public.incident_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  message text not null,
  status public.incident_status null,
  is_public boolean not null default true,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now()
);

create or replace function public.set_status_services_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_incidents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists status_services_set_updated_at on public.status_services;
create trigger status_services_set_updated_at
before update on public.status_services
for each row
execute function public.set_status_services_updated_at();

drop trigger if exists incidents_set_updated_at on public.incidents;
create trigger incidents_set_updated_at
before update on public.incidents
for each row
execute function public.set_incidents_updated_at();

create index if not exists idx_status_services_org_display_order
  on public.status_services (organization_id, display_order, name);
create index if not exists idx_status_services_org_status
  on public.status_services (organization_id, current_status);
create index if not exists idx_status_services_org_public
  on public.status_services (organization_id, is_public);

create index if not exists idx_incidents_org_started_at
  on public.incidents (organization_id, started_at desc);
create index if not exists idx_incidents_org_status
  on public.incidents (organization_id, status, severity, started_at desc);
create index if not exists idx_incidents_org_public
  on public.incidents (organization_id, is_public, started_at desc);

create index if not exists idx_incident_impacts_org_incident
  on public.incident_impacts (organization_id, incident_id);
create index if not exists idx_incident_impacts_org_service
  on public.incident_impacts (organization_id, service_id);

create index if not exists idx_incident_updates_org_incident_created_at
  on public.incident_updates (organization_id, incident_id, created_at asc);
create index if not exists idx_incident_updates_org_public_created_at
  on public.incident_updates (organization_id, is_public, created_at desc);
