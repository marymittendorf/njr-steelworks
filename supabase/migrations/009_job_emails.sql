-- Log of quotes/invoices emailed to customers (sent by the send-document Edge Function).
create table public.job_emails (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  sent_at timestamptz not null default now(),
  kind text not null check (kind in ('Quote', 'Invoice')),
  sent_to text not null,
  subject text not null,
  sent_by text
);
create index job_emails_job_idx on public.job_emails (job_id, sent_at desc);

alter table public.job_emails enable row level security;
create policy job_emails_staff_read on public.job_emails for select to authenticated
  using ((select public.is_staff()));
-- Inserts come from the Edge Function (service role), not the browser.
