-- Tickets domain schema for OpsDesk
-- Compatible with Supabase Postgres

create extension if not exists pgcrypto;

do $$
begin
  create type public.ticket_status as enum ('open', 'pending', 'resolved', 'closed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.ticket_text_type as enum ('comment', 'internal_note', 'system');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid null,
  order_id uuid null,
  title varchar(255) not null,
  description text null,
  status public.ticket_status not null default 'open',
  priority public.ticket_priority not null default 'medium',
  assignee_id uuid null references public.users(id) on delete set null,
  created_by uuid not null references public.users(id) on delete restrict,
  sla_due_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  closed_at timestamp with time zone null
);

create table if not exists public.ticket_texts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete restrict,
  type public.ticket_text_type not null default 'comment',
  body text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone null
);

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  ticket_text_id uuid null references public.ticket_texts(id) on delete set null,
  file_name varchar(255) not null,
  file_size bigint not null default 0,
  mime_type varchar(150) not null,
  storage_key varchar(255) not null unique,
  uploaded_by uuid not null references public.users(id) on delete restrict,
  created_at timestamp with time zone not null default now()
);

-- Optional foreign keys only when those tables exist in your workspace.
do $$
begin
  if to_regclass('public.customers') is not null then
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

  if to_regclass('public.orders') is not null then
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

create or replace function public.set_tickets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at
before update on public.tickets
for each row
execute function public.set_tickets_updated_at();

drop trigger if exists ticket_texts_set_updated_at on public.ticket_texts;
create trigger ticket_texts_set_updated_at
before update on public.ticket_texts
for each row
execute function public.set_tickets_updated_at();

create index if not exists idx_tickets_org on public.tickets (organization_id);
create index if not exists idx_tickets_org_status on public.tickets (organization_id, status);
create index if not exists idx_tickets_org_assignee on public.tickets (organization_id, assignee_id);
create index if not exists idx_tickets_org_created_at on public.tickets (organization_id, created_at desc);
create index if not exists idx_ticket_texts_ticket_created_at on public.ticket_texts (ticket_id, created_at);
create index if not exists idx_ticket_texts_org on public.ticket_texts (organization_id);
create index if not exists idx_ticket_attachments_ticket on public.ticket_attachments (ticket_id, created_at);
create index if not exists idx_ticket_attachments_org on public.ticket_attachments (organization_id);
