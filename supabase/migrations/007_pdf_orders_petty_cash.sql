-- Orders created from an uploaded PDF quote keep the PDF; petty cash float.

alter table public.jobs add column source_pdf_path text;  -- object path in 'job-docs'

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('job-docs', 'job-docs', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp']);
create policy job_docs_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'job-docs' and (select public.is_staff()));
create policy job_docs_staff_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'job-docs' and (select public.is_staff()));

-- Petty cash: money put into the cash box. Cash spent is an expense paid by 'Petty cash'.
create table public.cash_topups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  topped_up_on date not null default current_date,
  amount numeric not null check (amount > 0),
  source text not null default 'Bank withdrawal',
  notes text
);

-- Cash counts: what was physically in the box vs. what the system expected.
create table public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  counted_on date not null default current_date,
  counted numeric not null check (counted >= 0),
  expected numeric not null,
  counted_by text,
  notes text
);

alter table public.cash_topups enable row level security;
alter table public.cash_counts enable row level security;
create policy cash_topups_staff_all on public.cash_topups for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy cash_counts_staff_all on public.cash_counts for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
