-- Ticket tags schema for filter builder and categorization
-- Apply this after db/topbar-schema.sql and db/tickets-schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.ticket_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name varchar(50) not null,
  color varchar(20) null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  constraint ticket_tags_org_name_unique unique (organization_id, name)
);

create table if not exists public.ticket_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  tag_id uuid not null references public.ticket_tags(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  constraint ticket_tag_assignments_unique unique (ticket_id, tag_id)
);

create index if not exists idx_ticket_tags_org on public.ticket_tags (organization_id);
create index if not exists idx_ticket_tags_org_name on public.ticket_tags (organization_id, name);
create index if not exists idx_ticket_tag_assignments_org on public.ticket_tag_assignments (organization_id);
create index if not exists idx_ticket_tag_assignments_org_ticket
  on public.ticket_tag_assignments (organization_id, ticket_id);
create index if not exists idx_ticket_tag_assignments_org_tag
  on public.ticket_tag_assignments (organization_id, tag_id);
