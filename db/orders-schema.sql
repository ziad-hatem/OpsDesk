-- Orders domain schema for OpsDesk
-- Apply this after db/topbar-schema.sql and db/customers-schema.sql.

create extension if not exists pgcrypto;

do $$
begin
  create type public.order_status as enum (
    'draft',
    'pending',
    'paid',
    'fulfilled',
    'cancelled',
    'refunded'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_payment_status as enum (
    'unpaid',
    'payment_link_sent',
    'paid',
    'failed',
    'refunded',
    'expired',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_number varchar(50) not null,
  status public.order_status not null default 'draft',
  payment_status public.order_payment_status not null default 'unpaid',
  currency char(3) not null,
  subtotal_amount bigint not null default 0 check (subtotal_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  total_amount bigint not null default 0 check (total_amount >= 0),
  placed_at timestamp with time zone null,
  paid_at timestamp with time zone null,
  fulfilled_at timestamp with time zone null,
  cancelled_at timestamp with time zone null,
  stripe_checkout_session_id varchar(255) null,
  stripe_payment_intent_id varchar(255) null,
  payment_link_url text null,
  payment_link_sent_at timestamp with time zone null,
  payment_completed_at timestamp with time zone null,
  notes text null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint orders_org_order_number_unique unique (organization_id, order_number),
  constraint orders_totals_consistency_check
    check (total_amount = subtotal_amount + tax_amount - discount_amount)
);

do $$
begin
  if to_regclass('public.orders') is not null then
    begin
      alter table public.orders
      add column if not exists payment_status public.order_payment_status not null default 'unpaid';
    exception
      when duplicate_column then null;
    end;

    alter table public.orders
      add column if not exists stripe_checkout_session_id varchar(255);
    alter table public.orders
      add column if not exists stripe_payment_intent_id varchar(255);
    alter table public.orders
      add column if not exists payment_link_url text;
    alter table public.orders
      add column if not exists payment_link_sent_at timestamp with time zone;
    alter table public.orders
      add column if not exists payment_completed_at timestamp with time zone;
  end if;
end $$;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  sku varchar(100) null,
  name varchar(255) not null,
  quantity integer not null check (quantity > 0),
  unit_price_amount bigint not null check (unit_price_amount >= 0),
  total_amount bigint not null check (total_amount >= 0),
  created_at timestamp with time zone not null default now()
);

create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status not null,
  to_status public.order_status not null,
  actor_user_id uuid references public.users(id) on delete set null,
  reason text null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.order_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  file_name varchar(255) not null,
  file_size bigint not null default 0 check (file_size >= 0),
  mime_type varchar(150) not null,
  storage_key varchar(255) not null unique,
  uploaded_by uuid not null references public.users(id) on delete restrict,
  created_at timestamp with time zone not null default now()
);

create or replace function public.set_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_orders_updated_at();

-- If tickets already exists, wire optional order foreign key there as well.
do $$
begin
  if to_regclass('public.tickets') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'tickets_order_id_fkey'
    ) then
      alter table public.tickets
      add constraint tickets_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete set null;
    end if;
  end if;
end $$;

create index if not exists idx_orders_org on public.orders (organization_id);
create index if not exists idx_orders_org_customer on public.orders (organization_id, customer_id);
create index if not exists idx_orders_org_status on public.orders (organization_id, status);
create index if not exists idx_orders_org_payment_status on public.orders (organization_id, payment_status);
create index if not exists idx_orders_org_created_at on public.orders (organization_id, created_at desc);
create unique index if not exists idx_orders_stripe_checkout_session_id_unique
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index if not exists idx_orders_stripe_payment_intent_id
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index if not exists idx_orders_org_payment_completed_at
  on public.orders (organization_id, payment_completed_at desc);
create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_order_items_org_order on public.order_items (organization_id, order_id);
create index if not exists idx_order_status_events_order_created_at
  on public.order_status_events (order_id, created_at desc);
create index if not exists idx_order_attachments_order_created_at
  on public.order_attachments (order_id, created_at desc);
create index if not exists idx_order_attachments_org
  on public.order_attachments (organization_id);
