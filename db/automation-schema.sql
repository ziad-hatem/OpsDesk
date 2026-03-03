-- Workflow automation schema for OpsDesk
-- Apply this after db/topbar-schema.sql and db/tickets-schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('ticket', 'order')),
  name varchar(100) not null,
  description text null,
  trigger_event text not null check (
    trigger_event in ('ticket.created', 'ticket.updated', 'order.created', 'order.updated')
  ),
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  is_enabled boolean not null default true,
  archived_at timestamp with time zone null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint automation_rules_org_entity_name_unique unique (organization_id, entity_type, name)
);

create table if not exists public.automation_rule_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid null references public.automation_rules(id) on delete set null,
  entity_type text not null check (entity_type in ('ticket', 'order')),
  entity_id text not null,
  trigger_event text not null check (
    trigger_event in ('ticket.created', 'ticket.updated', 'order.created', 'order.updated')
  ),
  status text not null check (status in ('executed', 'skipped', 'failed')),
  details jsonb null,
  created_at timestamp with time zone not null default now()
);

do $$
begin
  if to_regclass('public.automation_rules') is not null then
    alter table public.automation_rules
      add column if not exists archived_at timestamp with time zone;

    alter table public.automation_rules
      drop constraint if exists automation_rules_entity_type_check;
    alter table public.automation_rules
      drop constraint if exists automation_rules_trigger_event_check;

    begin
      alter table public.automation_rules
        add constraint automation_rules_entity_type_check
        check (entity_type in ('ticket', 'order'));
    exception
      when duplicate_object then null;
    end;

    begin
      alter table public.automation_rules
        add constraint automation_rules_trigger_event_check
        check (trigger_event in ('ticket.created', 'ticket.updated', 'order.created', 'order.updated'));
    exception
      when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.automation_rule_runs') is not null then
    alter table public.automation_rule_runs
      drop constraint if exists automation_rule_runs_entity_type_check;
    alter table public.automation_rule_runs
      drop constraint if exists automation_rule_runs_trigger_event_check;

    begin
      alter table public.automation_rule_runs
        add constraint automation_rule_runs_entity_type_check
        check (entity_type in ('ticket', 'order'));
    exception
      when duplicate_object then null;
    end;

    begin
      alter table public.automation_rule_runs
        add constraint automation_rule_runs_trigger_event_check
        check (trigger_event in ('ticket.created', 'ticket.updated', 'order.created', 'order.updated'));
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

create or replace function public.set_automation_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists automation_rules_set_updated_at on public.automation_rules;
create trigger automation_rules_set_updated_at
before update on public.automation_rules
for each row
execute function public.set_automation_rules_updated_at();

create index if not exists idx_automation_rules_org
  on public.automation_rules (organization_id);
create index if not exists idx_automation_rules_org_entity_event_enabled
  on public.automation_rules (organization_id, entity_type, trigger_event, is_enabled);
create index if not exists idx_automation_rules_org_created_at
  on public.automation_rules (organization_id, created_at desc);
create index if not exists idx_automation_rules_org_archived_at
  on public.automation_rules (organization_id, archived_at);

create index if not exists idx_automation_rule_runs_org_created_at
  on public.automation_rule_runs (organization_id, created_at desc);
create index if not exists idx_automation_rule_runs_org_rule_created_at
  on public.automation_rule_runs (organization_id, rule_id, created_at desc);
create index if not exists idx_automation_rule_runs_org_entity_created_at
  on public.automation_rule_runs (organization_id, entity_type, entity_id, created_at desc);
create index if not exists idx_automation_rule_runs_org_status_created_at
  on public.automation_rule_runs (organization_id, status, created_at desc);
