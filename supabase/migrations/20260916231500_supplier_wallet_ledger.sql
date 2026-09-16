-- Supplier wallet / ledger foundation.
-- Money amounts intentionally use the same unit as existing wholesale_price/total_amount values.
-- Supplier-visible wallet balances are derived from immutable ledger entries.

create type public.ledger_direction as enum ('credit', 'debit');
create type public.ledger_entry_type as enum ('sale', 'commission', 'refund', 'commission_reversal', 'adjustment', 'payout');
create type public.payout_account_status as enum ('pending', 'verified', 'rejected');
create type public.withdrawal_status as enum ('requested', 'processing', 'paid', 'failed', 'rejected', 'cancelled');

create table public.supplier_finance_profiles (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  terms_configured boolean not null default false,
  commission_bps integer not null default 0 check (commission_bps between 0 and 10000),
  settlement_hold_days integer not null default 7 check (settlement_hold_days between 0 and 60),
  min_withdrawal_amount bigint not null default 0 check (min_withdrawal_amount >= 0),
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.supplier_finance_profiles (supplier_id)
select id from public.suppliers
on conflict (supplier_id) do nothing;

create trigger set_supplier_finance_profiles_updated_at
before update on public.supplier_finance_profiles
for each row execute function private.set_updated_at();

alter table public.purchase_orders
  add column if not exists commission_bps_snapshot integer check (commission_bps_snapshot between 0 and 10000),
  add column if not exists settlement_hold_days_snapshot integer check (settlement_hold_days_snapshot between 0 and 60);

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders(id) on delete restrict,
  transaction_type text not null,
  idempotency_key text not null unique,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ledger_transactions(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders(id) on delete restrict,
  entry_type public.ledger_entry_type not null,
  direction public.ledger_direction not null,
  amount bigint not null check (amount > 0),
  available_at timestamptz,
  created_at timestamptz not null default now()
);

comment on column public.ledger_entries.amount is 'Uses the same monetary unit as wholesale_price and total_amount; the current UI treats those values as toman.';

create index ledger_entries_supplier_available_idx
  on public.ledger_entries(supplier_id, available_at, created_at desc);
create index ledger_entries_purchase_order_idx
  on public.ledger_entries(purchase_order_id)
  where purchase_order_id is not null;
create index ledger_transactions_supplier_created_idx
  on public.ledger_transactions(supplier_id, created_at desc);

create table public.supplier_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  sheba text not null check (sheba ~ '^IR[0-9]{24}$'),
  account_holder text not null,
  bank_name text,
  status public.payout_account_status not null default 'pending',
  is_default boolean not null default false,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, sheba)
);

create unique index supplier_payout_accounts_default_uidx
  on public.supplier_payout_accounts(supplier_id)
  where is_default;

create trigger set_supplier_payout_accounts_updated_at
before update on public.supplier_payout_accounts
for each row execute function private.set_updated_at();

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  payout_account_id uuid not null references public.supplier_payout_accounts(id) on delete restrict,
  amount bigint not null check (amount > 0),
  status public.withdrawal_status not null default 'requested',
  requested_by uuid not null references auth.users(id) on delete restrict,
  bank_reference text,
  failure_reason text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  paid_at timestamptz
);

create index withdrawal_requests_supplier_status_idx
  on public.withdrawal_requests(supplier_id, status, requested_at desc);

alter table public.supplier_finance_profiles enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.supplier_payout_accounts enable row level security;
alter table public.withdrawal_requests enable row level security;

create policy supplier_finance_profiles_select on public.supplier_finance_profiles
for select to authenticated
using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));

create policy supplier_finance_profiles_admin_all on public.supplier_finance_profiles
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy ledger_transactions_select on public.ledger_transactions
for select to authenticated
using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));

create policy ledger_entries_select on public.ledger_entries
for select to authenticated
using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));

create policy supplier_payout_accounts_select on public.supplier_payout_accounts
for select to authenticated
using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));

create policy supplier_payout_accounts_insert on public.supplier_payout_accounts
for insert to authenticated
with check (
  (select private.is_supplier_member(supplier_id))
  and status = 'pending'
  and verified_by is null
  and verified_at is null
);

create policy supplier_payout_accounts_supplier_update on public.supplier_payout_accounts
for update to authenticated
using ((select private.is_supplier_member(supplier_id)) and status in ('pending', 'rejected'))
with check (
  (select private.is_supplier_member(supplier_id))
  and status in ('pending', 'rejected')
  and verified_by is null
  and verified_at is null
);

create policy supplier_payout_accounts_admin_all on public.supplier_payout_accounts
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy withdrawal_requests_select on public.withdrawal_requests
for select to authenticated
using ((select private.is_admin()) or (select private.is_supplier_member(supplier_id)));

create or replace function private.current_supplier_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.supplier_id
  from public.supplier_members sm
  where sm.user_id = (select auth.uid())
  order by sm.is_owner desc, sm.created_at asc
  limit 1;
$$;

revoke all on function private.current_supplier_id() from public, anon;
grant execute on function private.current_supplier_id() to authenticated;

create or replace function private.apply_supplier_finance_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.supplier_finance_profiles%rowtype;
begin
  if new.source_wholesale_order_id is null then
    return new;
  end if;

  select * into v_profile
  from public.supplier_finance_profiles
  where supplier_id = new.supplier_id;

  if v_profile.supplier_id is null or not v_profile.terms_configured then
    raise exception 'SUPPLIER_FINANCE_TERMS_REQUIRED';
  end if;

  new.commission_bps_snapshot := v_profile.commission_bps;
  new.settlement_hold_days_snapshot := v_profile.settlement_hold_days;
  return new;
end;
$$;

revoke all on function private.apply_supplier_finance_terms() from public, anon, authenticated;

create trigger apply_supplier_finance_terms_before_po
before insert on public.purchase_orders
for each row execute function private.apply_supplier_finance_terms();

create or replace function private.post_purchase_order_delivery_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction_id uuid;
  v_available_at timestamptz;
  v_commission bigint;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then
    return new;
  end if;

  if new.source_wholesale_order_id is null then
    return new;
  end if;

  if new.commission_bps_snapshot is null or new.settlement_hold_days_snapshot is null then
    raise exception 'PURCHASE_ORDER_FINANCE_SNAPSHOT_MISSING';
  end if;

  v_available_at := coalesce(new.delivered_at, now()) + make_interval(days => new.settlement_hold_days_snapshot);
  v_commission := round(new.total_amount::numeric * new.commission_bps_snapshot::numeric / 10000)::bigint;

  insert into public.ledger_transactions(
    supplier_id,
    purchase_order_id,
    transaction_type,
    idempotency_key,
    description,
    metadata,
    created_by
  ) values (
    new.supplier_id,
    new.id,
    'purchase_order_delivered',
    'purchase-order:' || new.id::text || ':delivered:v1',
    'Supplier order delivered',
    jsonb_build_object(
      'order_code', new.order_code,
      'gross_amount', new.total_amount,
      'commission_bps', new.commission_bps_snapshot,
      'hold_days', new.settlement_hold_days_snapshot
    ),
    auth.uid()
  )
  on conflict (idempotency_key) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    return new;
  end if;

  if new.total_amount > 0 then
    insert into public.ledger_entries(
      transaction_id, supplier_id, purchase_order_id, entry_type, direction, amount, available_at
    ) values (
      v_transaction_id, new.supplier_id, new.id, 'sale', 'credit', new.total_amount, v_available_at
    );
  end if;

  if v_commission > 0 then
    insert into public.ledger_entries(
      transaction_id, supplier_id, purchase_order_id, entry_type, direction, amount, available_at
    ) values (
      v_transaction_id, new.supplier_id, new.id, 'commission', 'debit', v_commission, v_available_at
    );
  end if;

  return new;
end;
$$;

revoke all on function private.post_purchase_order_delivery_ledger() from public, anon, authenticated;

create trigger post_purchase_order_delivery_ledger_after_status
  after update of status on public.purchase_orders
  for each row
  when (new.status = 'delivered' and old.status is distinct from new.status)
  execute function private.post_purchase_order_delivery_ledger();

create or replace function private.configure_supplier_finance(
  p_supplier_id uuid,
  p_commission_bps integer,
  p_settlement_hold_days integer,
  p_min_withdrawal_amount bigint,
  p_payouts_enabled boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_commission_bps < 0 or p_commission_bps > 10000 then raise exception 'INVALID_COMMISSION_BPS'; end if;
  if p_settlement_hold_days < 0 or p_settlement_hold_days > 60 then raise exception 'INVALID_HOLD_DAYS'; end if;
  if p_min_withdrawal_amount < 0 then raise exception 'INVALID_MIN_WITHDRAWAL'; end if;

  insert into public.supplier_finance_profiles(
    supplier_id,
    terms_configured,
    commission_bps,
    settlement_hold_days,
    min_withdrawal_amount,
    payouts_enabled
  ) values (
    p_supplier_id,
    true,
    p_commission_bps,
    p_settlement_hold_days,
    p_min_withdrawal_amount,
    p_payouts_enabled
  )
  on conflict (supplier_id) do update set
    terms_configured = true,
    commission_bps = excluded.commission_bps,
    settlement_hold_days = excluded.settlement_hold_days,
    min_withdrawal_amount = excluded.min_withdrawal_amount,
    payouts_enabled = excluded.payouts_enabled,
    updated_at = now();
end;
$$;

create or replace function public.configure_supplier_finance(
  p_supplier_id uuid,
  p_commission_bps integer,
  p_settlement_hold_days integer,
  p_min_withdrawal_amount bigint,
  p_payouts_enabled boolean default false
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.configure_supplier_finance(
    p_supplier_id,
    p_commission_bps,
    p_settlement_hold_days,
    p_min_withdrawal_amount,
    p_payouts_enabled
  );
$$;

create or replace function private.add_my_supplier_payout_account(
  p_sheba text,
  p_account_holder text,
  p_bank_name text default null,
  p_make_default boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.current_supplier_id();
  v_id uuid;
  v_sheba text := upper(replace(trim(p_sheba), ' ', ''));
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_supplier_id is null then raise exception 'SUPPLIER_ACCESS_REQUIRED'; end if;
  if v_sheba !~ '^IR[0-9]{24}$' then raise exception 'INVALID_SHEBA'; end if;
  if nullif(trim(p_account_holder), '') is null then raise exception 'ACCOUNT_HOLDER_REQUIRED'; end if;

  if p_make_default then
    update public.supplier_payout_accounts
    set is_default = false
    where supplier_id = v_supplier_id and is_default;
  end if;

  insert into public.supplier_payout_accounts(
    supplier_id, sheba, account_holder, bank_name, status, is_default
  ) values (
    v_supplier_id, v_sheba, trim(p_account_holder), nullif(trim(p_bank_name), ''), 'pending', p_make_default
  )
  on conflict (supplier_id, sheba) do update set
    account_holder = excluded.account_holder,
    bank_name = excluded.bank_name,
    status = 'pending',
    is_default = excluded.is_default,
    verified_by = null,
    verified_at = null,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.add_my_supplier_payout_account(
  p_sheba text,
  p_account_holder text,
  p_bank_name text default null,
  p_make_default boolean default true
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.add_my_supplier_payout_account(p_sheba, p_account_holder, p_bank_name, p_make_default);
$$;

create or replace function private.review_supplier_payout_account(
  p_account_id uuid,
  p_status public.payout_account_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select private.is_admin()) then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status not in ('verified', 'rejected') then raise exception 'INVALID_PAYOUT_ACCOUNT_STATUS'; end if;

  update public.supplier_payout_accounts
  set status = p_status,
      verified_by = case when p_status = 'verified' then auth.uid() else null end,
      verified_at = case when p_status = 'verified' then now() else null end,
      updated_at = now()
  where id = p_account_id;

  if not found then raise exception 'PAYOUT_ACCOUNT_NOT_FOUND'; end if;
end;
$$;

create or replace function public.review_supplier_payout_account(
  p_account_id uuid,
  p_status public.payout_account_status
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.review_supplier_payout_account(p_account_id, p_status); $$;

create or replace function private.get_my_supplier_wallet()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.current_supplier_id();
  v_ledger_available bigint := 0;
  v_pending bigint := 0;
  v_reserved bigint := 0;
  v_withdrawable bigint := 0;
  v_profile public.supplier_finance_profiles%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_supplier_id is null then raise exception 'SUPPLIER_ACCESS_REQUIRED'; end if;

  select * into v_profile
  from public.supplier_finance_profiles
  where supplier_id = v_supplier_id;

  select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)::bigint
  into v_ledger_available
  from public.ledger_entries
  where supplier_id = v_supplier_id
    and available_at is not null
    and available_at <= now();

  select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)::bigint
  into v_pending
  from public.ledger_entries
  where supplier_id = v_supplier_id
    and (available_at is null or available_at > now());

  select coalesce(sum(amount), 0)::bigint
  into v_reserved
  from public.withdrawal_requests
  where supplier_id = v_supplier_id
    and status in ('requested', 'processing');

  v_withdrawable := greatest(v_ledger_available - v_reserved, 0);

  select jsonb_build_object(
    'supplier_id', v_supplier_id,
    'ledger_available_balance', v_ledger_available,
    'pending_balance', v_pending,
    'reserved_for_withdrawal', v_reserved,
    'withdrawable_balance', v_withdrawable,
    'terms_configured', coalesce(v_profile.terms_configured, false),
    'commission_bps', coalesce(v_profile.commission_bps, 0),
    'settlement_hold_days', coalesce(v_profile.settlement_hold_days, 7),
    'min_withdrawal_amount', coalesce(v_profile.min_withdrawal_amount, 0),
    'payouts_enabled', coalesce(v_profile.payouts_enabled, false),
    'payout_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'sheba', a.sheba,
        'account_holder', a.account_holder,
        'bank_name', a.bank_name,
        'status', a.status,
        'is_default', a.is_default
      ) order by a.is_default desc, a.created_at desc)
      from public.supplier_payout_accounts a
      where a.supplier_id = v_supplier_id
    ), '[]'::jsonb),
    'recent_entries', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb)
      from (
        select le.id, le.entry_type, le.direction, le.amount, le.available_at, le.created_at,
               lt.description, po.order_code
        from public.ledger_entries le
        join public.ledger_transactions lt on lt.id = le.transaction_id
        left join public.purchase_orders po on po.id = le.purchase_order_id
        where le.supplier_id = v_supplier_id
        order by le.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'recent_withdrawals', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb)
      from (
        select wr.id, wr.amount, wr.status, wr.bank_reference, wr.failure_reason,
               wr.requested_at, wr.processed_at, wr.paid_at
        from public.withdrawal_requests wr
        where wr.supplier_id = v_supplier_id
        order by wr.requested_at desc
        limit 20
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_my_supplier_wallet()
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.get_my_supplier_wallet(); $$;

create or replace function private.request_supplier_withdrawal(p_amount bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id uuid := private.current_supplier_id();
  v_profile public.supplier_finance_profiles%rowtype;
  v_account_id uuid;
  v_ledger_available bigint := 0;
  v_reserved bigint := 0;
  v_withdrawable bigint := 0;
  v_request_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_supplier_id is null then raise exception 'SUPPLIER_ACCESS_REQUIRED'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_WITHDRAWAL_AMOUNT'; end if;

  perform pg_advisory_xact_lock(hashtext(v_supplier_id::text));

  select * into v_profile
  from public.supplier_finance_profiles
  where supplier_id = v_supplier_id
  for update;

  if v_profile.supplier_id is null or not v_profile.terms_configured then raise exception 'SUPPLIER_FINANCE_TERMS_REQUIRED'; end if;
  if not v_profile.payouts_enabled then raise exception 'PAYOUTS_DISABLED'; end if;
  if p_amount < v_profile.min_withdrawal_amount then raise exception 'BELOW_MIN_WITHDRAWAL'; end if;

  select id into v_account_id
  from public.supplier_payout_accounts
  where supplier_id = v_supplier_id
    and status = 'verified'
  order by is_default desc, verified_at desc nulls last
  limit 1;

  if v_account_id is null then raise exception 'VERIFIED_PAYOUT_ACCOUNT_REQUIRED'; end if;

  select coalesce(sum(case when direction = 'credit' then amount else -amount end), 0)::bigint
  into v_ledger_available
  from public.ledger_entries
  where supplier_id = v_supplier_id
    and available_at is not null
    and available_at <= now();

  select coalesce(sum(amount), 0)::bigint
  into v_reserved
  from public.withdrawal_requests
  where supplier_id = v_supplier_id
    and status in ('requested', 'processing');

  v_withdrawable := greatest(v_ledger_available - v_reserved, 0);
  if p_amount > v_withdrawable then raise exception 'INSUFFICIENT_WITHDRAWABLE_BALANCE'; end if;

  insert into public.withdrawal_requests(
    supplier_id, payout_account_id, amount, status, requested_by
  ) values (
    v_supplier_id, v_account_id, p_amount, 'requested', auth.uid()
  ) returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.request_supplier_withdrawal(p_amount bigint)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.request_supplier_withdrawal(p_amount); $$;

create or replace function private.process_supplier_withdrawal(
  p_request_id uuid,
  p_status public.withdrawal_status,
  p_bank_reference text default null,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_transaction_id uuid;
begin
  if auth.uid() is null or not (select private.is_admin()) then raise exception 'ADMIN_REQUIRED'; end if;
  if p_status not in ('processing', 'paid', 'failed', 'rejected') then raise exception 'INVALID_WITHDRAWAL_STATUS'; end if;

  select * into v_request
  from public.withdrawal_requests
  where id = p_request_id
  for update;

  if v_request.id is null then raise exception 'WITHDRAWAL_NOT_FOUND'; end if;
  if v_request.status in ('paid', 'failed', 'rejected', 'cancelled') then raise exception 'WITHDRAWAL_ALREADY_FINAL'; end if;
  if p_status = 'paid' and nullif(trim(p_bank_reference), '') is null then raise exception 'BANK_REFERENCE_REQUIRED'; end if;

  if p_status = 'paid' then
    insert into public.ledger_transactions(
      supplier_id,
      transaction_type,
      idempotency_key,
      description,
      metadata,
      created_by
    ) values (
      v_request.supplier_id,
      'supplier_payout',
      'withdrawal:' || v_request.id::text || ':paid:v1',
      'Supplier withdrawal paid',
      jsonb_build_object('withdrawal_request_id', v_request.id, 'bank_reference', trim(p_bank_reference)),
      auth.uid()
    )
    on conflict (idempotency_key) do nothing
    returning id into v_transaction_id;

    if v_transaction_id is not null then
      insert into public.ledger_entries(
        transaction_id, supplier_id, entry_type, direction, amount, available_at
      ) values (
        v_transaction_id, v_request.supplier_id, 'payout', 'debit', v_request.amount, now()
      );
    end if;
  end if;

  update public.withdrawal_requests
  set status = p_status,
      bank_reference = case when p_status = 'paid' then trim(p_bank_reference) else bank_reference end,
      failure_reason = case when p_status in ('failed', 'rejected') then nullif(trim(p_failure_reason), '') else null end,
      processed_at = now(),
      paid_at = case when p_status = 'paid' then now() else paid_at end
  where id = p_request_id;
end;
$$;

create or replace function public.process_supplier_withdrawal(
  p_request_id uuid,
  p_status public.withdrawal_status,
  p_bank_reference text default null,
  p_failure_reason text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.process_supplier_withdrawal(p_request_id, p_status, p_bank_reference, p_failure_reason); $$;

revoke all on function private.configure_supplier_finance(uuid, integer, integer, bigint, boolean) from public, anon;
revoke all on function private.add_my_supplier_payout_account(text, text, text, boolean) from public, anon;
revoke all on function private.review_supplier_payout_account(uuid, public.payout_account_status) from public, anon;
revoke all on function private.get_my_supplier_wallet() from public, anon;
revoke all on function private.request_supplier_withdrawal(bigint) from public, anon;
revoke all on function private.process_supplier_withdrawal(uuid, public.withdrawal_status, text, text) from public, anon;

grant execute on function private.configure_supplier_finance(uuid, integer, integer, bigint, boolean) to authenticated;
grant execute on function private.add_my_supplier_payout_account(text, text, text, boolean) to authenticated;
grant execute on function private.review_supplier_payout_account(uuid, public.payout_account_status) to authenticated;
grant execute on function private.get_my_supplier_wallet() to authenticated;
grant execute on function private.request_supplier_withdrawal(bigint) to authenticated;
grant execute on function private.process_supplier_withdrawal(uuid, public.withdrawal_status, text, text) to authenticated;

revoke all on function public.configure_supplier_finance(uuid, integer, integer, bigint, boolean) from public, anon;
revoke all on function public.add_my_supplier_payout_account(text, text, text, boolean) from public, anon;
revoke all on function public.review_supplier_payout_account(uuid, public.payout_account_status) from public, anon;
revoke all on function public.get_my_supplier_wallet() from public, anon;
revoke all on function public.request_supplier_withdrawal(bigint) from public, anon;
revoke all on function public.process_supplier_withdrawal(uuid, public.withdrawal_status, text, text) from public, anon;

grant execute on function public.configure_supplier_finance(uuid, integer, integer, bigint, boolean) to authenticated;
grant execute on function public.add_my_supplier_payout_account(text, text, text, boolean) to authenticated;
grant execute on function public.review_supplier_payout_account(uuid, public.payout_account_status) to authenticated;
grant execute on function public.get_my_supplier_wallet() to authenticated;
grant execute on function public.request_supplier_withdrawal(bigint) to authenticated;
grant execute on function public.process_supplier_withdrawal(uuid, public.withdrawal_status, text, text) to authenticated;

grant select on public.supplier_finance_profiles, public.ledger_transactions, public.ledger_entries, public.withdrawal_requests to authenticated;
grant select, insert, update on public.supplier_payout_accounts to authenticated;
revoke all on public.supplier_finance_profiles, public.ledger_transactions, public.ledger_entries, public.supplier_payout_accounts, public.withdrawal_requests from anon;

notify pgrst, 'reload schema';
