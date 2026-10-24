-- Before/after photos on jobs, and a signed hand-in record for items a client brings in.
-- Protects NJR if a client later says something was damaged or never handed in.
-- After photos can be published to the website gallery.

create table public.job_photos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),       -- uploaded (server time, can't be changed by the browser)
  job_id uuid not null references public.jobs(id) on delete cascade,
  stage text not null check (stage in ('Received', 'Before', 'After', 'Delivered')),
  path text not null,                                   -- object path in the private 'job-photos' bucket
  taken_at timestamptz,                                 -- from the photo file, when available
  note text,
  taken_by text,
  gallery_id uuid references public.gallery(id) on delete set null  -- set when published to the website
);
create index job_photos_job_idx on public.job_photos (job_id, stage);

create table public.job_handins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  items jsonb not null default '[]',                    -- [{desc, qty, condition}]
  notes text,
  received_by text,                                     -- staff member
  signed_name text,                                     -- client
  signature_path text,                                  -- PNG in 'signatures'
  signed_at timestamptz
);
create index job_handins_job_idx on public.job_handins (job_id);

alter table public.job_photos enable row level security;
alter table public.job_handins enable row level security;
create policy job_photos_staff_read on public.job_photos for select to authenticated using ((select public.is_staff()));
create policy job_photos_staff_insert on public.job_photos for insert to authenticated with check ((select public.is_staff()));
create policy job_photos_staff_update on public.job_photos for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy job_photos_owner_delete on public.job_photos for delete to authenticated using ((select public.is_owner()));
create policy job_handins_staff_read on public.job_handins for select to authenticated using ((select public.is_staff()));
create policy job_handins_staff_insert on public.job_handins for insert to authenticated with check ((select public.is_staff()));
-- A signed hand-in is evidence: it can't be edited afterwards, only before signing.
create policy job_handins_staff_update on public.job_handins for update to authenticated
  using ((select public.is_staff()) and signed_at is null) with check ((select public.is_staff()));
create policy job_handins_owner_delete on public.job_handins for delete to authenticated using ((select public.is_owner()) and signed_at is null);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('job-photos', 'job-photos', false, 10485760, array['image/jpeg','image/png','image/webp']);
create policy job_photos_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and (select public.is_staff()));
create policy job_photos_obj_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and (select public.is_staff()));
create policy job_photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and (select public.is_owner()));
