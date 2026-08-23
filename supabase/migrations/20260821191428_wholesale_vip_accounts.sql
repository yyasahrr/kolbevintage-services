create table public.wholesale_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  member_name text not null,
  store_name text not null,
  phone text not null,
  city text not null,
  plan_name text not null default 'وی‌آی‌پی',
  status public.application_status not null default 'pending',
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or activated_at is null or expires_at > activated_at)
);

create index wholesale_accounts_status_idx on public.wholesale_accounts(status, expires_at);
create trigger set_wholesale_accounts_updated_at before update on public.wholesale_accounts for each row execute function private.set_updated_at();

alter table public.wholesale_accounts enable row level security;

create policy wholesale_accounts_select_own on public.wholesale_accounts
for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy wholesale_accounts_admin_all on public.wholesale_accounts
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy products_vip_select on public.supplier_products
for select to authenticated
using (
  status = 'approved'
  and exists (
    select 1 from public.wholesale_accounts account
    where account.user_id = (select auth.uid())
      and account.status = 'approved'
      and (account.expires_at is null or account.expires_at > now())
  )
);

create policy variants_vip_select on public.product_variants
for select to authenticated
using (
  exists (
    select 1
    from public.supplier_products product
    join public.wholesale_accounts account on account.user_id = (select auth.uid())
    where product.id = product_id
      and product.status = 'approved'
      and account.status = 'approved'
      and (account.expires_at is null or account.expires_at > now())
  )
);

create policy inventory_vip_select on public.inventory
for select to authenticated
using (
  exists (
    select 1
    from public.product_variants variant
    join public.supplier_products product on product.id = variant.product_id
    join public.wholesale_accounts account on account.user_id = (select auth.uid())
    where variant.id = variant_id
      and product.status = 'approved'
      and account.status = 'approved'
      and (account.expires_at is null or account.expires_at > now())
  )
);

grant select, insert, update, delete on public.wholesale_accounts to authenticated;
revoke all on public.wholesale_accounts from anon;
