-- When a customer accepts a quote it becomes an invoice: the job gets its own invoice
-- number (NJR-INV-0001…) and date, once, and keeps them. Done in the database so every
-- way of accepting (costing screen, Orders, PDF import) behaves the same.
-- Payment status no longer has "Invoiced": having an invoice number is what makes it invoiced.

alter table public.jobs drop constraint jobs_payment_status_check;
alter table public.jobs add constraint jobs_payment_status_check
  check (payment_status in ('Awaiting deposit', 'Deposit paid', 'Paid'));

alter table public.jobs
  add column invoice_no text unique,
  add column invoice_date date;

create sequence public.invoice_seq start 1;
grant usage on sequence public.invoice_seq to authenticated;

create or replace function public.issue_invoice_on_accept()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.invoice_no is null
     and new.job_type = 'Customer job'
     and new.status in ('Accepted', 'In workshop', 'Ready', 'Delivered') then
    new.invoice_no := 'NJR-INV-' || lpad(nextval('public.invoice_seq')::text, 4, '0');
    new.invoice_date := current_date;
  end if;
  return new;
end $$;

create trigger jobs_issue_invoice
  before insert or update of status, job_type on public.jobs
  for each row execute function public.issue_invoice_on_accept();

-- Not callable through the API; it only runs as a trigger.
revoke execute on function public.issue_invoice_on_accept() from public, anon, authenticated;
