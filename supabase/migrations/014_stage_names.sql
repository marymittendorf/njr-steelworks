-- Order stages renamed (Forever Planks style): Received → In production → Ready → Delivered.
-- "Received" = quote accepted and/or the client's item handed in at the workshop.
-- Column names stay (accepted_at = received, production_started_at = in production).

alter table public.jobs drop constraint jobs_status_check;
update public.jobs set status = 'Received' where status = 'Accepted';
update public.jobs set status = 'In production' where status = 'In workshop';
alter table public.jobs add constraint jobs_status_check check (status in
  ('Draft','Quote sent','Received','In production','Ready','Delivered','Declined'));

create or replace function public.issue_invoice_on_accept()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.invoice_no is null
     and new.job_type = 'Customer job'
     and new.status in ('Received', 'In production', 'Ready', 'Delivered') then
    new.invoice_no := 'NJR-INV-' || lpad(nextval('public.invoice_seq')::text, 4, '0');
    new.invoice_date := current_date;
  end if;
  return new;
end $$;
revoke execute on function public.issue_invoice_on_accept() from public, anon, authenticated;
