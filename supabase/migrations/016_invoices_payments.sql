-- Invoices and payments, the skip program's way.
-- An accepted job (stage Received) is the invoice: it keeps its number (NJR-INV-…) and, from now on,
-- its totals are stored on the job when the invoice is issued or changed. Payments are recorded
-- against it (EFT, cash, card, other, with reference and proof), and the job's payment status
-- follows automatically: Awaiting deposit → Deposit paid → Paid. Owners can void an invoice.

alter table public.jobs
  add column invoice_excl numeric(12,2),
  add column invoice_vat numeric(12,2),
  add column invoice_total numeric(12,2),
  add column amount_paid numeric(12,2) not null default 0,
  add column invoice_voided_at timestamptz,
  add column invoice_void_reason text;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'EFT' check (method in ('EFT', 'Cash', 'Card', 'Other')),
  reference text,
  proof_path text,            -- in the private 'payment-proofs' bucket
  recorded_by text,
  note text
);
create index payments_job_idx on public.payments (job_id);
create index payments_date_idx on public.payments (paid_on);

alter table public.payments enable row level security;
create policy payments_staff_read on public.payments for select to authenticated using ((select public.is_staff()));
create policy payments_staff_insert on public.payments for insert to authenticated with check ((select public.is_staff()));
create policy payments_owner_delete on public.payments for delete to authenticated using ((select public.is_owner()));

-- Keep amount_paid and payment_status in step with the payments.
create or replace function public.refresh_job_payments(p_job_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_paid numeric(12,2);
  v_total numeric(12,2);
  v_deposit numeric;
begin
  select coalesce(sum(amount), 0) into v_paid from payments where job_id = p_job_id;
  select invoice_total, coalesce((rates->>'deposit')::numeric, 50) into v_total, v_deposit from jobs where id = p_job_id;
  update jobs set
    amount_paid = v_paid,
    payment_status = case
      when v_total is not null and v_paid >= v_total - 0.5 then 'Paid'
      when v_total is not null and v_paid >= round(v_total * v_deposit / 100, 2) - 0.5 then 'Deposit paid'
      when v_total is not null then 'Awaiting deposit'
      else payment_status end
  where id = p_job_id;
end $$;
revoke execute on function public.refresh_job_payments(uuid) from public, anon, authenticated;

create or replace function public.payments_changed()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.refresh_job_payments(coalesce(new.job_id, old.job_id));
  return null;
end $$;
revoke execute on function public.payments_changed() from public, anon, authenticated;

create trigger payments_refresh_job
  after insert or delete or update of amount, job_id on public.payments
  for each row execute function public.payments_changed();

-- When the invoice total changes (job repriced), re-check what's paid.
create or replace function public.invoice_total_changed()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.invoice_total is distinct from old.invoice_total then
    perform public.refresh_job_payments(new.id);
  end if;
  return null;
end $$;
revoke execute on function public.invoice_total_changed() from public, anon, authenticated;

create trigger jobs_invoice_total_changed
  after update of invoice_total on public.jobs
  for each row execute function public.invoice_total_changed();

-- Payment proofs (bank slips, card receipts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('payment-proofs', 'payment-proofs', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp']);
create policy payment_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (select public.is_staff()));
create policy payment_proofs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (select public.is_staff()));
