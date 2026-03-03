-- Orders payment extension schema for OpsDesk
-- Run this for existing databases that already have public.orders.

create extension if not exists pgcrypto;

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

do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'public.orders table is missing. Run db/orders-schema.sql first.';
  end if;

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
end $$;

create index if not exists idx_orders_org_payment_status
  on public.orders (organization_id, payment_status);

create unique index if not exists idx_orders_stripe_checkout_session_id_unique
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index if not exists idx_orders_stripe_payment_intent_id
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists idx_orders_org_payment_completed_at
  on public.orders (organization_id, payment_completed_at desc);
