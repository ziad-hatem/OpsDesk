-- Omnichannel communications hub schema for OpsDesk
-- Apply this after db/topbar-schema.sql, db/customers-schema.sql, and db/tickets-schema.sql.

create extension if not exists pgcrypto;

do $$
begin
  create type public.communication_channel as enum ('email', 'chat', 'whatsapp', 'sms');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.communication_direction as enum ('inbound', 'outbound');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.customer_communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel public.communication_channel not null,
  direction public.communication_direction not null,
  provider varchar(80) null,
  provider_message_id varchar(255) null,
  thread_key varchar(255) null,
  subject text null,
  body text not null,
  sender_name varchar(255) null,
  sender_email varchar(255) null,
  sender_phone varchar(50) null,
  recipient_name varchar(255) null,
  recipient_email varchar(255) null,
  recipient_phone varchar(50) null,
  actor_user_id uuid null references public.users(id) on delete set null,
  ticket_id uuid null,
  order_id uuid null,
  incident_id uuid null,
  metadata jsonb null,
  occurred_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

do $$
begin
  if to_regclass('public.customer_communications') is not null then
    if to_regclass('public.tickets') is not null then
      if not exists (
        select 1
        from pg_constraint
        where conname = 'customer_communications_ticket_id_fkey'
      ) then
        alter table public.customer_communications
        add constraint customer_communications_ticket_id_fkey
        foreign key (ticket_id) references public.tickets(id) on delete set null;
      end if;
    end if;

    if to_regclass('public.orders') is not null then
      if not exists (
        select 1
        from pg_constraint
        where conname = 'customer_communications_order_id_fkey'
      ) then
        alter table public.customer_communications
        add constraint customer_communications_order_id_fkey
        foreign key (order_id) references public.orders(id) on delete set null;
      end if;
    end if;

    if to_regclass('public.incidents') is not null then
      if not exists (
        select 1
        from pg_constraint
        where conname = 'customer_communications_incident_id_fkey'
      ) then
        alter table public.customer_communications
        add constraint customer_communications_incident_id_fkey
        foreign key (incident_id) references public.incidents(id) on delete set null;
      end if;
    end if;
  end if;
end $$;

create index if not exists idx_customer_communications_org_created_at
  on public.customer_communications (organization_id, created_at desc);
create index if not exists idx_customer_communications_org_customer_occurred_at
  on public.customer_communications (organization_id, customer_id, occurred_at desc);
create index if not exists idx_customer_communications_org_channel_occurred_at
  on public.customer_communications (organization_id, channel, occurred_at desc);
create index if not exists idx_customer_communications_org_ticket_occurred_at
  on public.customer_communications (organization_id, ticket_id, occurred_at desc);
create index if not exists idx_customer_communications_org_order_occurred_at
  on public.customer_communications (organization_id, order_id, occurred_at desc);
create index if not exists idx_customer_communications_org_incident_occurred_at
  on public.customer_communications (organization_id, incident_id, occurred_at desc);
create unique index if not exists idx_customer_communications_org_provider_message_unique
  on public.customer_communications (organization_id, provider, provider_message_id)
  where provider is not null and provider_message_id is not null;
