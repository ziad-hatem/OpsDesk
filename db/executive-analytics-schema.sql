-- Unified data platform schema for executive analytics and scheduled reports.
-- Apply this after db/topbar-schema.sql, db/tickets-schema.sql, db/orders-schema.sql, and db/incidents-schema.sql.

create extension if not exists pgcrypto;

do $$
begin
  create type public.analytics_schedule_frequency as enum (
    'daily',
    'weekly',
    'monthly'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.analytics_report_run_status as enum (
    'success',
    'failed'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.analytics_metric_scope as enum (
    'current',
    'previous',
    'year'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.analytics_report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name varchar(120) not null,
  frequency public.analytics_schedule_frequency not null default 'weekly',
  compare_with text not null default 'previous' check (compare_with in ('previous', 'year', 'none')),
  range_days integer not null default 30 check (range_days >= 1 and range_days <= 365),
  timezone varchar(64) not null default 'UTC',
  recipients text[] not null default '{}'::text[],
  is_enabled boolean not null default true,
  next_run_at timestamp with time zone not null,
  last_run_at timestamp with time zone null,
  last_status public.analytics_report_run_status null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint analytics_report_schedules_org_name_unique unique (organization_id, name)
);

do $$
begin
  if to_regclass('public.analytics_report_schedules') is not null then
    alter table public.analytics_report_schedules
      add column if not exists compare_with text not null default 'previous';
    alter table public.analytics_report_schedules
      add column if not exists range_days integer not null default 30;
    alter table public.analytics_report_schedules
      add column if not exists timezone varchar(64) not null default 'UTC';
    alter table public.analytics_report_schedules
      add column if not exists recipients text[] not null default '{}'::text[];
    alter table public.analytics_report_schedules
      add column if not exists next_run_at timestamp with time zone not null default now();
    alter table public.analytics_report_schedules
      add column if not exists last_run_at timestamp with time zone;
    alter table public.analytics_report_schedules
      add column if not exists last_status public.analytics_report_run_status;
    alter table public.analytics_report_schedules
      add column if not exists created_by uuid references public.users(id) on delete set null;
    alter table public.analytics_report_schedules
      add column if not exists created_at timestamp with time zone not null default now();
    alter table public.analytics_report_schedules
      add column if not exists updated_at timestamp with time zone not null default now();

    alter table public.analytics_report_schedules
      drop constraint if exists analytics_report_schedules_compare_with_check;
    begin
      alter table public.analytics_report_schedules
        add constraint analytics_report_schedules_compare_with_check
        check (compare_with in ('previous', 'year', 'none'));
    exception
      when duplicate_object then null;
    end;

    alter table public.analytics_report_schedules
      drop constraint if exists analytics_report_schedules_range_days_check;
    begin
      alter table public.analytics_report_schedules
        add constraint analytics_report_schedules_range_days_check
        check (range_days >= 1 and range_days <= 365);
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

create table if not exists public.analytics_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid null references public.analytics_report_schedules(id) on delete set null,
  status public.analytics_report_run_status not null,
  recipients text[] not null default '{}'::text[],
  report_from timestamp with time zone not null,
  report_to timestamp with time zone not null,
  error_message text null,
  delivered_at timestamp with time zone null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.analytics_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_key text not null,
  metric_scope public.analytics_metric_scope not null default 'current',
  metric_value double precision not null,
  period_from timestamp with time zone not null,
  period_to timestamp with time zone not null,
  source text not null default 'reports_api',
  schedule_id uuid null references public.analytics_report_schedules(id) on delete set null,
  report_run_id uuid null references public.analytics_report_runs(id) on delete set null,
  created_at timestamp with time zone not null default now()
);

create or replace function public.set_analytics_report_schedules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists analytics_report_schedules_set_updated_at on public.analytics_report_schedules;
create trigger analytics_report_schedules_set_updated_at
before update on public.analytics_report_schedules
for each row
execute function public.set_analytics_report_schedules_updated_at();

create index if not exists idx_analytics_report_schedules_org
  on public.analytics_report_schedules (organization_id);
create index if not exists idx_analytics_report_schedules_org_enabled_next_run
  on public.analytics_report_schedules (organization_id, is_enabled, next_run_at);
create index if not exists idx_analytics_report_schedules_org_created_at
  on public.analytics_report_schedules (organization_id, created_at desc);

create index if not exists idx_analytics_report_runs_org_created_at
  on public.analytics_report_runs (organization_id, created_at desc);
create index if not exists idx_analytics_report_runs_org_schedule_created_at
  on public.analytics_report_runs (organization_id, schedule_id, created_at desc);

create index if not exists idx_analytics_metric_snapshots_org_created_at
  on public.analytics_metric_snapshots (organization_id, created_at desc);
create index if not exists idx_analytics_metric_snapshots_org_metric_period
  on public.analytics_metric_snapshots (organization_id, metric_key, period_to desc);
create index if not exists idx_analytics_metric_snapshots_org_schedule_created_at
  on public.analytics_metric_snapshots (organization_id, schedule_id, created_at desc);
