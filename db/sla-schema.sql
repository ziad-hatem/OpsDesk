-- SLA engine schema for OpsDesk
-- Apply this after db/topbar-schema.sql and db/tickets-schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  priority public.ticket_priority not null,
  first_response_minutes integer not null check (first_response_minutes > 0),
  resolution_minutes integer not null check (resolution_minutes > 0),
  warning_minutes integer not null default 60 check (warning_minutes >= 0),
  escalation_role public.organization_role not null default 'manager',
  auto_escalate boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint sla_policies_org_priority_unique unique (organization_id, priority)
);

create table if not exists public.ticket_sla_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'first_response_warning',
      'first_response_breached',
      'resolution_warning',
      'resolution_breached',
      'auto_escalated'
    )
  ),
  due_at timestamp with time zone null,
  metadata jsonb null,
  created_at timestamp with time zone not null default now()
);

create or replace function public.set_sla_policies_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sla_policies_set_updated_at on public.sla_policies;
create trigger sla_policies_set_updated_at
before update on public.sla_policies
for each row
execute function public.set_sla_policies_updated_at();

create index if not exists idx_sla_policies_org on public.sla_policies (organization_id);
create index if not exists idx_sla_policies_org_priority on public.sla_policies (organization_id, priority);
create index if not exists idx_ticket_sla_events_org_created_at
  on public.ticket_sla_events (organization_id, created_at desc);
create index if not exists idx_ticket_sla_events_org_ticket_created_at
  on public.ticket_sla_events (organization_id, ticket_id, created_at desc);
create index if not exists idx_ticket_sla_events_org_event_created_at
  on public.ticket_sla_events (organization_id, event_type, created_at desc);
create unique index if not exists idx_ticket_sla_events_dedupe
  on public.ticket_sla_events (
    organization_id,
    ticket_id,
    event_type,
    coalesce(due_at, '1970-01-01 00:00:00+00'::timestamp with time zone)
  );
