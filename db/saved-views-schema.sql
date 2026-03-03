-- Saved views schema for advanced filters
-- Apply this after db/topbar-schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('tickets', 'orders', 'customers')),
  scope text not null default 'personal' check (scope in ('personal', 'team')),
  name varchar(80) not null,
  filters jsonb not null default '{}'::jsonb,
  is_favorite boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint saved_views_unique_name_per_entity unique (organization_id, user_id, entity_type, name)
);

do $$
begin
  if to_regclass('public.saved_views') is not null then
    alter table public.saved_views
      add column if not exists scope text not null default 'personal';
  end if;
end $$;

do $$
begin
  if to_regclass('public.saved_views') is not null then
    begin
      alter table public.saved_views
        add constraint saved_views_scope_check
        check (scope in ('personal', 'team'));
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

create or replace function public.set_saved_views_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists saved_views_set_updated_at on public.saved_views;
create trigger saved_views_set_updated_at
before update on public.saved_views
for each row
execute function public.set_saved_views_updated_at();

create index if not exists idx_saved_views_org_user_entity
  on public.saved_views (organization_id, user_id, entity_type);
create index if not exists idx_saved_views_org_user_entity_created_at
  on public.saved_views (organization_id, user_id, entity_type, created_at desc);
create index if not exists idx_saved_views_org_entity_scope
  on public.saved_views (organization_id, entity_type, scope, created_at desc);
