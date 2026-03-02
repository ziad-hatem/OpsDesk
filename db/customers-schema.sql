-- Customers domain schema for OpsDesk
-- Apply this after db/topbar-schema.sql and before/with db/tickets-schema.sql.

create extension if not exists pgcrypto;

do $$
begin
  create type public.customer_status as enum ('active', 'inactive', 'blocked');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.customer_address_type as enum ('billing', 'shipping');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name varchar(255) not null,
  email varchar(255) null,
  phone varchar(50) null,
  status public.customer_status not null default 'active',
  external_id varchar(255) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  name varchar(255) not null,
  email varchar(255) null,
  phone varchar(50) null,
  role varchar(100) null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  type public.customer_address_type not null,
  line1 text not null,
  line2 text null,
  city text null,
  state text null,
  postal_code text null,
  country text null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_metadata (
  customer_id uuid not null references public.customers(id) on delete cascade,
  key text not null,
  value text null,
  primary key (customer_id, key)
);

do $$
begin
  if to_regclass('public.tickets') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'tickets_customer_id_fkey'
    ) then
      alter table public.tickets
      add constraint tickets_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete set null;
    end if;
  end if;
end $$;

create or replace function public.set_customers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row
execute function public.set_customers_updated_at();

create index if not exists idx_customers_org on public.customers (organization_id);
create index if not exists idx_customers_org_status on public.customers (organization_id, status);
create index if not exists idx_customers_org_name on public.customers (organization_id, name);
create index if not exists idx_customers_org_email on public.customers (organization_id, email);
create index if not exists idx_customer_contacts_org_customer on public.customer_contacts (organization_id, customer_id);
create index if not exists idx_customer_addresses_org_customer on public.customer_addresses (organization_id, customer_id);
