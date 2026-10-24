-- Deleting is for owners only, and a job that has an invoice number can never be deleted
-- (invoices must stay on record; decline or credit it instead).

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.staff where user_id = auth.uid() and role = 'owner') $$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- jobs: staff read/add/change; owners delete un-invoiced jobs only
drop policy jobs_staff_all on public.jobs;
create policy jobs_staff_read on public.jobs for select to authenticated using ((select public.is_staff()));
create policy jobs_staff_insert on public.jobs for insert to authenticated with check ((select public.is_staff()));
create policy jobs_staff_update on public.jobs for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy jobs_owner_delete on public.jobs for delete to authenticated using ((select public.is_owner()) and invoice_no is null);

-- requests
drop policy requests_staff_delete on public.requests;
create policy requests_owner_delete on public.requests for delete to authenticated using ((select public.is_owner()));

-- expenses, stock, deliveries, petty cash: split "all" into staff read/add/change + owner delete
drop policy expenses_staff_all on public.expenses;
create policy expenses_staff_read on public.expenses for select to authenticated using ((select public.is_staff()));
create policy expenses_staff_insert on public.expenses for insert to authenticated with check ((select public.is_staff()));
create policy expenses_staff_update on public.expenses for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy expenses_owner_delete on public.expenses for delete to authenticated using ((select public.is_owner()));

drop policy stock_items_staff_all on public.stock_items;
create policy stock_items_staff_read on public.stock_items for select to authenticated using ((select public.is_staff()));
create policy stock_items_staff_insert on public.stock_items for insert to authenticated with check ((select public.is_staff()));
create policy stock_items_staff_update on public.stock_items for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy stock_items_owner_delete on public.stock_items for delete to authenticated using ((select public.is_owner()));

drop policy deliveries_staff_all on public.deliveries;
create policy deliveries_staff_read on public.deliveries for select to authenticated using ((select public.is_staff()));
create policy deliveries_staff_insert on public.deliveries for insert to authenticated with check ((select public.is_staff()));
create policy deliveries_staff_update on public.deliveries for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy deliveries_owner_delete on public.deliveries for delete to authenticated using ((select public.is_owner()));

drop policy cash_topups_staff_all on public.cash_topups;
create policy cash_topups_staff_read on public.cash_topups for select to authenticated using ((select public.is_staff()));
create policy cash_topups_staff_insert on public.cash_topups for insert to authenticated with check ((select public.is_staff()));
create policy cash_topups_owner_delete on public.cash_topups for delete to authenticated using ((select public.is_owner()));

drop policy cash_counts_staff_all on public.cash_counts;
create policy cash_counts_staff_read on public.cash_counts for select to authenticated using ((select public.is_staff()));
create policy cash_counts_staff_insert on public.cash_counts for insert to authenticated with check ((select public.is_staff()));
create policy cash_counts_owner_delete on public.cash_counts for delete to authenticated using ((select public.is_owner()));

-- After clearing test quotes: start numbering again at NJR-Q-0001 / NJR-INV-0001.
-- Owners only, and only when no quotes exist (so a number is never reused).
create or replace function public.restart_numbering()
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can restart numbering.'; end if;
  if exists (select 1 from public.jobs) then raise exception 'Delete all quotes first; numbers can only restart when there are none.'; end if;
  perform setval('public.quote_seq', 1, false);
  perform setval('public.invoice_seq', 1, false);
  return 'Next quote will be NJR-Q-0001';
end $$;
revoke all on function public.restart_numbering() from public, anon;
grant execute on function public.restart_numbering() to authenticated;
