create extension if not exists pgcrypto;
create schema if not exists private;

create type public.app_role as enum ('admin', 'supplier');
create type public.application_status as enum ('pending', 'reviewing', 'approved', 'rejected');
create type public.product_status as enum ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'archived');
create type public.order_status as enum ('pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled');
create type public.rfq_status as enum ('open', 'quoted', 'accepted', 'rejected', 'closed');
create type public.ticket_status as enum ('open', 'answered', 'closed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'supplier',
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  city text,
  phone text,
  status public.application_status not null default 'pending',
  monthly_capacity integer check (monthly_capacity is null or monthly_capacity >= 0),
  capabilities text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_members (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'عضو تیم',
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (supplier_id, user_id)
);

create table public.supplier_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  company_name text not null,
  representative_name text not null,
  phone text not null,
  category text not null,
  monthly_capacity integer check (monthly_capacity is null or monthly_capacity >= 0),
  status public.application_status not null default 'pending',
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null,
  sku text not null,
  category text not null,
  description text not null default '',
  wholesale_price bigint not null default 0 check (wholesale_price >= 0),
  image_url text,
  status public.product_status not null default 'draft',
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, sku)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.supplier_products(id) on delete cascade,
  sku text not null unique,
  color text not null,
  color_hex text,
  size text not null,
  cost bigint not null default 0 check (cost >= 0),
  created_at timestamptz not null default now()
);

create table public.inventory (
  variant_id uuid primary key references public.product_variants(id) on delete cascade,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  updated_at timestamptz not null default now()
);

create table public.rfqs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  reference_code text not null unique,
  title text not null,
  customer_name text not null,
  quantity integer not null check (quantity > 0),
  requested_delivery_date date,
  specifications jsonb not null default '{}',
  status public.rfq_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  lead_time_days integer not null check (lead_time_days > 0),
  note text,
  status public.rfq_status not null default 'quoted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  order_code text not null unique,
  status public.order_status not null default 'pending',
  due_date date,
  total_amount bigint not null default 0 check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0)
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  subject text not null,
  category text not null,
  message text not null,
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status public.ticket_status not null default 'open',
  admin_reply text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index supplier_members_user_id_idx on public.supplier_members(user_id);
create index supplier_applications_user_id_idx on public.supplier_applications(user_id);
create index supplier_applications_status_created_idx on public.supplier_applications(status, created_at desc);
create index supplier_products_supplier_status_idx on public.supplier_products(supplier_id, status);
create index product_variants_product_id_idx on public.product_variants(product_id);
create index rfqs_supplier_status_idx on public.rfqs(supplier_id, status);
create index quotes_rfq_id_idx on public.quotes(rfq_id);
create index quotes_supplier_id_idx on public.quotes(supplier_id);
create index purchase_orders_supplier_status_idx on public.purchase_orders(supplier_id, status);
create index purchase_order_items_order_id_idx on public.purchase_order_items(order_id);
create index purchase_order_items_variant_id_idx on public.purchase_order_items(variant_id);
create index support_tickets_supplier_status_idx on public.support_tickets(supplier_id, status);
create index support_tickets_created_by_idx on public.support_tickets(created_by);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function private.is_supplier_member(target_supplier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.supplier_members
    where supplier_id = target_supplier_id and user_id = (select auth.uid())
  );
$$;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke execute on function private.is_admin() from public, anon;
revoke execute on function private.is_supplier_member(uuid) from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_supplier_member(uuid) to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$ begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.phone);
  return new;
end $$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function private.protect_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$ begin
  if (select auth.uid()) is not null and not (select private.is_admin()) then
    if tg_table_name = 'profiles' and new.role is distinct from old.role then
      raise exception 'Only administrators can change account roles';
    elsif tg_table_name = 'supplier_products' and (new.status is distinct from old.status or new.review_note is distinct from old.review_note) and new.status not in ('draft', 'submitted') then
      raise exception 'Supplier cannot set a review decision';
    elsif tg_table_name = 'quotes' and new.status is distinct from old.status and new.status not in ('quoted', 'closed') then
      raise exception 'Supplier cannot accept or reject a quote';
    elsif tg_table_name = 'support_tickets' and new.admin_reply is distinct from old.admin_reply then
      raise exception 'Supplier cannot write an administrator reply';
    end if;
  end if;
  return new;
end $$;

revoke execute on function private.protect_privileged_fields() from public, anon, authenticated;
create trigger protect_profile_role before update on public.profiles for each row execute function private.protect_privileged_fields();
create trigger protect_product_review before update on public.supplier_products for each row execute function private.protect_privileged_fields();
create trigger protect_quote_decision before update on public.quotes for each row execute function private.protect_privileged_fields();
create trigger protect_ticket_reply before update on public.support_tickets for each row execute function private.protect_privileged_fields();

do $$ declare table_name text; begin
  foreach table_name in array array['profiles','suppliers','supplier_applications','supplier_products','inventory','rfqs','quotes','purchase_orders','support_tickets'] loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function private.set_updated_at()', table_name, table_name);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_members enable row level security;
alter table public.supplier_applications enable row level security;
alter table public.supplier_products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory enable row level security;
alter table public.rfqs enable row level security;
alter table public.quotes enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.support_tickets enable row level security;

create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update_self on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy suppliers_select on public.suppliers for select to authenticated using ((select private.is_admin()) or (select private.is_supplier_member(id)));
create policy suppliers_admin_all on public.suppliers for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy members_select on public.supplier_members for select to authenticated using ((select private.is_admin()) or user_id = (select auth.uid()));
create policy members_admin_all on public.supplier_members for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy applications_insert on public.supplier_applications for insert to authenticated with check (user_id = (select auth.uid()));
create policy applications_public_insert on public.supplier_applications for insert to anon with check (user_id is null and status = 'pending');
create policy applications_select on public.supplier_applications for select to authenticated using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy applications_admin_update on public.supplier_applications for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy products_select on public.supplier_products for select to authenticated using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));
create policy products_insert on public.supplier_products for insert to authenticated with check ((select private.is_supplier_member(supplier_id)));
create policy products_supplier_update on public.supplier_products for update to authenticated using ((select private.is_supplier_member(supplier_id))) with check ((select private.is_supplier_member(supplier_id)));
create policy products_admin_update on public.supplier_products for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy variants_select on public.product_variants for select to authenticated using (exists (select 1 from public.supplier_products p where p.id = product_id and ((select private.is_admin()) or (select private.is_supplier_member(p.supplier_id)))));
create policy variants_write on public.product_variants for all to authenticated using (exists (select 1 from public.supplier_products p where p.id = product_id and (select private.is_supplier_member(p.supplier_id)))) with check (exists (select 1 from public.supplier_products p where p.id = product_id and (select private.is_supplier_member(p.supplier_id))));
create policy inventory_select on public.inventory for select to authenticated using (exists (select 1 from public.product_variants v join public.supplier_products p on p.id = v.product_id where v.id = variant_id and ((select private.is_admin()) or (select private.is_supplier_member(p.supplier_id)))));
create policy inventory_write on public.inventory for all to authenticated using (exists (select 1 from public.product_variants v join public.supplier_products p on p.id = v.product_id where v.id = variant_id and (select private.is_supplier_member(p.supplier_id)))) with check (exists (select 1 from public.product_variants v join public.supplier_products p on p.id = v.product_id where v.id = variant_id and (select private.is_supplier_member(p.supplier_id))));
create policy rfqs_select on public.rfqs for select to authenticated using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));
create policy rfqs_admin_write on public.rfqs for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy quotes_select on public.quotes for select to authenticated using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));
create policy quotes_supplier_insert on public.quotes for insert to authenticated with check ((select private.is_supplier_member(supplier_id)));
create policy quotes_supplier_update on public.quotes for update to authenticated using ((select private.is_supplier_member(supplier_id))) with check ((select private.is_supplier_member(supplier_id)));
create policy quotes_admin_update on public.quotes for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy orders_select on public.purchase_orders for select to authenticated using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));
create policy orders_admin_write on public.purchase_orders for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy orders_supplier_update on public.purchase_orders for update to authenticated using ((select private.is_supplier_member(supplier_id))) with check ((select private.is_supplier_member(supplier_id)));
create policy order_items_select on public.purchase_order_items for select to authenticated using (exists (select 1 from public.purchase_orders po where po.id = order_id and ((select private.is_admin()) or (select private.is_supplier_member(po.supplier_id)))));
create policy order_items_admin_write on public.purchase_order_items for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy tickets_select on public.support_tickets for select to authenticated using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));
create policy tickets_insert on public.support_tickets for insert to authenticated with check (created_by = (select auth.uid()) and (select private.is_supplier_member(supplier_id)));
create policy tickets_supplier_update on public.support_tickets for update to authenticated using ((select private.is_supplier_member(supplier_id))) with check ((select private.is_supplier_member(supplier_id)));
create policy tickets_admin_update on public.support_tickets for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.suppliers, public.supplier_members, public.supplier_applications, public.supplier_products, public.product_variants, public.inventory, public.rfqs, public.quotes, public.purchase_orders, public.purchase_order_items, public.support_tickets to authenticated;
revoke all on public.profiles, public.suppliers, public.supplier_members, public.supplier_applications, public.supplier_products, public.product_variants, public.inventory, public.rfqs, public.quotes, public.purchase_orders, public.purchase_order_items, public.support_tickets from anon;
grant insert (company_name, representative_name, phone, category, monthly_capacity) on public.supplier_applications to anon;
