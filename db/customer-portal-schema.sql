-- Customer portal schema for OpsDesk
-- Apply this after db/topbar-schema.sql, db/customers-schema.sql, db/tickets-schema.sql, and db/orders-schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.customer_portal_login_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  email varchar(255) not null,
  token_hash varchar(64) not null unique,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone null,
  revoked_at timestamp with time zone null,
  requested_ip varchar(64) null,
  user_agent text null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.customer_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  email varchar(255) not null,
  token_hash varchar(64) not null unique,
  expires_at timestamp with time zone not null,
  revoked_at timestamp with time zone null,
  last_seen_at timestamp with time zone null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.customer_portal_identities (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null unique references public.users(id) on delete cascade,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_customer_portal_login_links_email_created_at
  on public.customer_portal_login_links (email, created_at desc);
create index if not exists idx_customer_portal_login_links_org_customer
  on public.customer_portal_login_links (organization_id, customer_id);
create index if not exists idx_customer_portal_login_links_expires_at
  on public.customer_portal_login_links (expires_at);

create index if not exists idx_customer_portal_sessions_email_created_at
  on public.customer_portal_sessions (email, created_at desc);
create index if not exists idx_customer_portal_sessions_org_customer
  on public.customer_portal_sessions (organization_id, customer_id);
create index if not exists idx_customer_portal_sessions_expires_at
  on public.customer_portal_sessions (expires_at);

create index if not exists idx_customer_portal_identities_org_customer
  on public.customer_portal_identities (organization_id, customer_id);
