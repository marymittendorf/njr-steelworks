-- Order tracker (modelled on the Forever Planks order book):
-- job stages separate from payment, a timeline, stock builds, deliveries with signatures.

-- Job stage: where the work is. Payment: where the money is.
alter table public.jobs drop constraint jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in
  ('Draft','Quote sent','Accepted','In workshop','Ready','Delivered','Declined'));

alter table public.jobs
  add column job_type text not null default 'Customer job' check (job_type in ('Customer job','Built for stock')),
  add column payment_status text not null default 'Awaiting deposit'
    check (payment_status in ('Awaiting deposit','Deposit paid','Invoiced','Paid')),
  add column accepted_at timestamptz,
  add column production_started_at timestamptz,
  add column ready_at timestamptz,
  add column delivered_at timestamptz;

-- Finished trailers/skips waiting in the yard.
create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id uuid unique references public.jobs(id) on delete set null,  -- one stock item per stock build
  title text not null,
  description text,
  built_on date not null default current_date,
  asking_price numeric,             -- incl. VAT
  status text not null default 'In stock' check (status in ('In stock','Sold')),
  sold_on date,
  sold_to text,
  sold_phone text,
  sold_price numeric,               -- incl. VAT
  notes text
);

-- Deliveries and collections, with the customer's signature when done.
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id uuid references public.jobs(id) on delete set null,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  kind text not null default 'Delivery' check (kind in ('Delivery','Collection')),
  delivery_date date not null,
  delivery_time time,
  customer text not null,
  phone text,
  address text,
  what text,
  notes text,
  status text not null default 'Scheduled' check (status in ('Scheduled','Done','Cancelled')),
  signed_name text,
  signature_path text,              -- PNG in the private 'signatures' bucket
  signed_at timestamptz
);
create index deliveries_date_idx on public.deliveries (delivery_date);
create index deliveries_job_idx on public.deliveries (job_id);
create index deliveries_stock_idx on public.deliveries (stock_item_id);

alter table public.stock_items enable row level security;
alter table public.deliveries enable row level security;
create policy stock_items_staff_all on public.stock_items for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy deliveries_staff_all on public.deliveries for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('signatures', 'signatures', false, 1048576, array['image/png']);
create policy signatures_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and (select public.is_staff()));
create policy signatures_staff_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and (select public.is_staff()));
