alter table public.purchase_orders
  add column if not exists source_wholesale_order_id uuid references public.wholesale_orders(id) on delete restrict,
  add column if not exists tracking_code text,
  add column if not exists shipped_at timestamptz,
  add column if not exists delivered_at timestamptz;

create unique index if not exists purchase_orders_source_supplier_uidx
  on public.purchase_orders(source_wholesale_order_id, supplier_id)
  where source_wholesale_order_id is not null;

create index if not exists purchase_orders_source_idx
  on public.purchase_orders(source_wholesale_order_id);
create index if not exists wholesale_order_items_product_idx
  on public.wholesale_order_items(product_id);
create index if not exists wholesale_order_items_variant_idx
  on public.wholesale_order_items(variant_id);
create index if not exists purchase_order_items_product_variant_idx
  on public.purchase_order_items(variant_id)
  where variant_id is not null;

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  wholesale_order_id uuid references public.wholesale_orders(id) on delete cascade,
  purchase_order_id uuid references public.purchase_orders(id) on delete cascade,
  event_type text not null,
  from_status public.order_status,
  to_status public.order_status,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (wholesale_order_id is not null or purchase_order_id is not null)
);

create index if not exists order_events_wholesale_created_idx
  on public.order_events(wholesale_order_id, created_at desc);
create index if not exists order_events_purchase_created_idx
  on public.order_events(purchase_order_id, created_at desc);

alter table public.order_events enable row level security;

create policy order_events_select_related on public.order_events
for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.wholesale_orders wo
    join public.wholesale_accounts wa on wa.id = wo.account_id
    where wo.id = order_events.wholesale_order_id
      and wa.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.purchase_orders po
    join public.supplier_members sm on sm.supplier_id = po.supplier_id
    where po.id = order_events.purchase_order_id
      and sm.user_id = (select auth.uid())
  )
);

grant select on public.order_events to authenticated;
grant usage, select on sequence public.order_events_id_seq to authenticated;
revoke all on public.order_events from anon;

create or replace function public.submit_wholesale_order(p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_order_code text := 'KVW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_total_units integer;
  v_total_amount bigint;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  select id into v_account_id
  from public.wholesale_accounts
  where user_id = v_user_id
    and status = 'approved'
    and (expires_at is null or expires_at > now())
  order by activated_at desc nulls last
  limit 1;
  if v_account_id is null then raise exception 'VIP_ACCOUNT_INACTIVE'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    where coalesce((line->>'quantity')::integer, 0) <= 0
       or line->>'variantId' is null
  ) then raise exception 'INVALID_ORDER_LINE'; end if;

  perform 1
  from public.inventory i
  where i.variant_id in (
    select (line->>'variantId')::uuid from jsonb_array_elements(p_lines) line
  )
  order by i.variant_id
  for update;

  if exists (
    with requested as (
      select (line->>'variantId')::uuid variant_id, sum((line->>'quantity')::integer)::integer quantity
      from jsonb_array_elements(p_lines) line group by 1
    )
    select 1
    from requested r
    left join public.product_variants pv on pv.id = r.variant_id
    left join public.supplier_products sp on sp.id = pv.product_id and sp.status = 'approved'
    left join public.inventory i on i.variant_id = r.variant_id
    where pv.id is null or sp.id is null or i.variant_id is null or i.on_hand - i.reserved < r.quantity
  ) then raise exception 'INSUFFICIENT_STOCK'; end if;

  with requested as (
    select (line->>'variantId')::uuid variant_id, sum((line->>'quantity')::integer)::integer quantity
    from jsonb_array_elements(p_lines) line group by 1
  )
  select sum(r.quantity)::integer, sum(r.quantity * sp.wholesale_price)::bigint
  into v_total_units, v_total_amount
  from requested r
  join public.product_variants pv on pv.id = r.variant_id
  join public.supplier_products sp on sp.id = pv.product_id;

  insert into public.wholesale_orders(id, account_id, order_code, status, total_amount, total_units)
  values (v_order_id, v_account_id, v_order_code, 'pending', v_total_amount, v_total_units);

  insert into public.wholesale_order_items(order_id, product_id, variant_id, product_name, sku, quantity, unit_price)
  select v_order_id, sp.id, pv.id, sp.name, pv.sku, r.quantity, sp.wholesale_price
  from (
    select (line->>'variantId')::uuid variant_id, sum((line->>'quantity')::integer)::integer quantity
    from jsonb_array_elements(p_lines) line group by 1
  ) r
  join public.product_variants pv on pv.id = r.variant_id
  join public.supplier_products sp on sp.id = pv.product_id;

  update public.inventory i
  set reserved = i.reserved + r.quantity, updated_at = now()
  from (
    select (line->>'variantId')::uuid variant_id, sum((line->>'quantity')::integer)::integer quantity
    from jsonb_array_elements(p_lines) line group by 1
  ) r
  where i.variant_id = r.variant_id;

  insert into public.order_events(wholesale_order_id, event_type, to_status, actor_user_id, metadata)
  values (v_order_id, 'wholesale_order_submitted', 'pending', v_user_id, jsonb_build_object('total_units', v_total_units, 'total_amount', v_total_amount));

  return jsonb_build_object('id', v_order_id, 'order_code', v_order_code, 'total_units', v_total_units, 'total_amount', v_total_amount);
end;
$$;

create or replace function public.approve_wholesale_order(p_order_id uuid, p_due_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.wholesale_orders%rowtype;
  v_supplier_id uuid;
  v_po_id uuid;
  v_po_code text;
  v_count integer := 0;
begin
  if auth.uid() is null or not (select private.is_admin()) then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_order from public.wholesale_orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;

  for v_supplier_id in
    select distinct sp.supplier_id
    from public.wholesale_order_items woi
    join public.supplier_products sp on sp.id = woi.product_id
    where woi.order_id = p_order_id
    order by sp.supplier_id
  loop
    v_po_id := gen_random_uuid();
    v_po_code := 'PO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    insert into public.purchase_orders(id, supplier_id, order_code, status, due_date, total_amount, source_wholesale_order_id)
    select v_po_id, v_supplier_id, v_po_code, 'confirmed', p_due_date,
      sum(woi.quantity * woi.unit_price), p_order_id
    from public.wholesale_order_items woi
    join public.supplier_products sp on sp.id = woi.product_id
    where woi.order_id = p_order_id and sp.supplier_id = v_supplier_id;

    insert into public.purchase_order_items(order_id, variant_id, product_name, sku, quantity, unit_price)
    select v_po_id, woi.variant_id, woi.product_name, woi.sku, woi.quantity, woi.unit_price
    from public.wholesale_order_items woi
    join public.supplier_products sp on sp.id = woi.product_id
    where woi.order_id = p_order_id and sp.supplier_id = v_supplier_id;

    insert into public.order_events(wholesale_order_id, purchase_order_id, event_type, to_status, actor_user_id)
    values (p_order_id, v_po_id, 'purchase_order_created', 'confirmed', auth.uid());
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'ORDER_HAS_NO_SUPPLIER'; end if;
  update public.wholesale_orders set status = 'confirmed' where id = p_order_id;
  insert into public.order_events(wholesale_order_id, event_type, from_status, to_status, actor_user_id, metadata)
  values (p_order_id, 'wholesale_order_approved', 'pending', 'confirmed', auth.uid(), jsonb_build_object('purchase_orders', v_count));
  return jsonb_build_object('order_id', p_order_id, 'purchase_orders', v_count);
end;
$$;

create or replace function public.update_supplier_purchase_order(
  p_order_id uuid,
  p_status public.order_status,
  p_tracking_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_wholesale_status public.order_status;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_po from public.purchase_orders where id = p_order_id for update;
  if v_po.id is null then raise exception 'PURCHASE_ORDER_NOT_FOUND'; end if;
  if not exists (select 1 from public.supplier_members sm where sm.supplier_id = v_po.supplier_id and sm.user_id = auth.uid())
     and not (select private.is_admin()) then raise exception 'SUPPLIER_ACCESS_REQUIRED'; end if;

  if not (
    (v_po.status = 'confirmed' and p_status = 'preparing') or
    (v_po.status = 'preparing' and p_status = 'shipped') or
    (v_po.status = 'shipped' and p_status = 'delivered') or
    ((select private.is_admin()) and v_po.status = p_status)
  ) then raise exception 'INVALID_STATUS_TRANSITION'; end if;
  if p_status = 'shipped' and nullif(trim(p_tracking_code), '') is null then raise exception 'TRACKING_CODE_REQUIRED'; end if;

  if p_status = 'delivered' and v_po.status <> 'delivered' then
    perform 1 from public.inventory i
    where i.variant_id in (select poi.variant_id from public.purchase_order_items poi where poi.order_id = p_order_id and poi.variant_id is not null)
    order by i.variant_id for update;

    update public.inventory i
    set on_hand = i.on_hand - x.quantity,
        reserved = i.reserved - x.quantity,
        updated_at = now()
    from (
      select poi.variant_id, sum(poi.quantity)::integer quantity
      from public.purchase_order_items poi
      where poi.order_id = p_order_id and poi.variant_id is not null
      group by poi.variant_id
    ) x
    where i.variant_id = x.variant_id
      and i.on_hand >= x.quantity and i.reserved >= x.quantity;
    if not found then raise exception 'INVENTORY_COMMIT_FAILED'; end if;
  end if;

  update public.purchase_orders
  set status = p_status,
      tracking_code = case when p_status = 'shipped' then trim(p_tracking_code) else tracking_code end,
      shipped_at = case when p_status = 'shipped' then now() else shipped_at end,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_order_id;

  insert into public.order_events(wholesale_order_id, purchase_order_id, event_type, from_status, to_status, actor_user_id, metadata)
  values (v_po.source_wholesale_order_id, p_order_id, 'purchase_order_status_changed', v_po.status, p_status, auth.uid(), jsonb_build_object('tracking_code', p_tracking_code));

  if v_po.source_wholesale_order_id is not null then
    select case
      when bool_and(status = 'delivered') then 'delivered'::public.order_status
      when bool_or(status = 'shipped') then 'shipped'::public.order_status
      when bool_or(status = 'preparing') then 'preparing'::public.order_status
      else 'confirmed'::public.order_status end
    into v_wholesale_status
    from public.purchase_orders where source_wholesale_order_id = v_po.source_wholesale_order_id;
    update public.wholesale_orders set status = v_wholesale_status where id = v_po.source_wholesale_order_id;
  end if;
  return jsonb_build_object('purchase_order_id', p_order_id, 'status', p_status, 'wholesale_status', v_wholesale_status);
end;
$$;

create or replace function public.cancel_wholesale_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.wholesale_orders%rowtype;
begin
  if auth.uid() is null or not (select private.is_admin()) then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_order from public.wholesale_orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status not in ('pending','confirmed','preparing') then raise exception 'ORDER_CANNOT_BE_CANCELLED'; end if;
  if exists (select 1 from public.purchase_orders where source_wholesale_order_id = p_order_id and status in ('shipped','delivered')) then raise exception 'ORDER_ALREADY_SHIPPED'; end if;

  perform 1 from public.inventory i
  where i.variant_id in (select variant_id from public.wholesale_order_items where order_id = p_order_id)
  order by i.variant_id for update;
  update public.inventory i set reserved = i.reserved - x.quantity, updated_at = now()
  from (select variant_id, sum(quantity)::integer quantity from public.wholesale_order_items where order_id = p_order_id group by variant_id) x
  where i.variant_id = x.variant_id and i.reserved >= x.quantity;
  if not found then raise exception 'INVENTORY_RELEASE_FAILED'; end if;

  update public.purchase_orders set status = 'cancelled' where source_wholesale_order_id = p_order_id;
  update public.wholesale_orders set status = 'cancelled' where id = p_order_id;
  insert into public.order_events(wholesale_order_id, event_type, from_status, to_status, actor_user_id)
  values (p_order_id, 'wholesale_order_cancelled', v_order.status, 'cancelled', auth.uid());
end;
$$;

revoke all on function public.submit_wholesale_order(jsonb) from public, anon;
revoke all on function public.approve_wholesale_order(uuid, date) from public, anon;
revoke all on function public.update_supplier_purchase_order(uuid, public.order_status, text) from public, anon;
revoke all on function public.cancel_wholesale_order(uuid) from public, anon;
grant execute on function public.submit_wholesale_order(jsonb) to authenticated;
grant execute on function public.approve_wholesale_order(uuid, date) to authenticated;
grant execute on function public.update_supplier_purchase_order(uuid, public.order_status, text) to authenticated;
grant execute on function public.cancel_wholesale_order(uuid) to authenticated;

grant select on public.purchase_orders, public.purchase_order_items to authenticated;
notify pgrst, 'reload schema';
