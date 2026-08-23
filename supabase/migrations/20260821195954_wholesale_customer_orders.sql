create table public.wholesale_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.wholesale_accounts(id) on delete restrict,
  order_code text not null unique,
  status public.order_status not null default 'pending',
  total_amount bigint not null default 0 check (total_amount >= 0),
  total_units integer not null default 0 check (total_units > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wholesale_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.wholesale_orders(id) on delete cascade,
  product_id uuid not null references public.supplier_products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0)
);

create index wholesale_orders_account_created_idx on public.wholesale_orders(account_id, created_at desc);
create index wholesale_order_items_order_idx on public.wholesale_order_items(order_id);
create trigger set_wholesale_orders_updated_at before update on public.wholesale_orders for each row execute function private.set_updated_at();
alter table public.wholesale_orders enable row level security;
alter table public.wholesale_order_items enable row level security;

create policy wholesale_orders_select_own on public.wholesale_orders for select to authenticated using (
  (select private.is_admin()) or exists (select 1 from public.wholesale_accounts account where account.id = account_id and account.user_id = (select auth.uid()))
);
create policy wholesale_orders_insert_own on public.wholesale_orders for insert to authenticated with check (
  exists (select 1 from public.wholesale_accounts account where account.id = account_id and account.user_id = (select auth.uid()) and account.status = 'approved' and (account.expires_at is null or account.expires_at > now()))
);
create policy wholesale_orders_admin_update on public.wholesale_orders for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy wholesale_order_items_select_own on public.wholesale_order_items for select to authenticated using (
  exists (select 1 from public.wholesale_orders customer_order join public.wholesale_accounts account on account.id = customer_order.account_id where customer_order.id = order_id and (account.user_id = (select auth.uid()) or (select private.is_admin())))
);
create policy wholesale_order_items_insert_own on public.wholesale_order_items for insert to authenticated with check (
  exists (select 1 from public.wholesale_orders customer_order join public.wholesale_accounts account on account.id = customer_order.account_id where customer_order.id = order_id and account.user_id = (select auth.uid()) and account.status = 'approved')
);

grant select, insert, update on public.wholesale_orders to authenticated;
grant select, insert on public.wholesale_order_items to authenticated;
revoke all on public.wholesale_orders, public.wholesale_order_items from anon;
