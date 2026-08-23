alter function public.submit_wholesale_order(jsonb) set schema private;
alter function public.approve_wholesale_order(uuid, date) set schema private;
alter function public.update_supplier_purchase_order(uuid, public.order_status, text) set schema private;
alter function public.cancel_wholesale_order(uuid) set schema private;

revoke all on function private.submit_wholesale_order(jsonb) from public, anon;
revoke all on function private.approve_wholesale_order(uuid, date) from public, anon;
revoke all on function private.update_supplier_purchase_order(uuid, public.order_status, text) from public, anon;
revoke all on function private.cancel_wholesale_order(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.submit_wholesale_order(jsonb) to authenticated;
grant execute on function private.approve_wholesale_order(uuid, date) to authenticated;
grant execute on function private.update_supplier_purchase_order(uuid, public.order_status, text) to authenticated;
grant execute on function private.cancel_wholesale_order(uuid) to authenticated;

create function public.submit_wholesale_order(p_lines jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.submit_wholesale_order(p_lines); $$;

create function public.approve_wholesale_order(p_order_id uuid, p_due_date date default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.approve_wholesale_order(p_order_id, p_due_date); $$;

create function public.update_supplier_purchase_order(p_order_id uuid, p_status public.order_status, p_tracking_code text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.update_supplier_purchase_order(p_order_id, p_status, p_tracking_code); $$;

create function public.cancel_wholesale_order(p_order_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.cancel_wholesale_order(p_order_id); $$;

revoke all on function public.submit_wholesale_order(jsonb) from public, anon;
revoke all on function public.approve_wholesale_order(uuid, date) from public, anon;
revoke all on function public.update_supplier_purchase_order(uuid, public.order_status, text) from public, anon;
revoke all on function public.cancel_wholesale_order(uuid) from public, anon;
grant execute on function public.submit_wholesale_order(jsonb) to authenticated;
grant execute on function public.approve_wholesale_order(uuid, date) to authenticated;
grant execute on function public.update_supplier_purchase_order(uuid, public.order_status, text) to authenticated;
grant execute on function public.cancel_wholesale_order(uuid) to authenticated;

create index if not exists order_events_actor_created_idx
  on public.order_events(actor_user_id, created_at desc)
  where actor_user_id is not null;

notify pgrst, 'reload schema';
