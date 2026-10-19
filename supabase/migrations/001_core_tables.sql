-- NJR Steelworks: core tables, staff check, row-level security.
-- Public visitors may only: send a quote request, upload request photos,
-- read the gallery, and read the public site info (contact people + "from" prices).
-- Everything else is staff only.

-- ---------- staff ----------
create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.staff where user_id = auth.uid()) $$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- ---------- settings (single row) ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  labour numeric not null default 320,        -- R per welder-hour
  consumables numeric not null default 45,    -- R per hour: wire, gas, discs, power
  overhead numeric not null default 10,       -- % on direct cost
  markup numeric not null default 20,         -- default % on total cost
  vat numeric not null default 15,
  galv numeric not null default 22,           -- R per kg hot-dip galvanising
  validity int not null default 14,           -- quote valid days
  deposit numeric not null default 50,        -- % deposit to book
  people jsonb not null default '[]',         -- [{name, role, phone}]
  bank_details text not null default '',
  from_prices jsonb not null default '{}',    -- written by the staff app: {trailer, skip, skiprep} incl. VAT
  updated_at timestamptz not null default now()
);
insert into public.settings (people) values (
  '[{"name":"Nico","role":"Workshop & quotes","phone":"077 402 8662"},
    {"name":"Jeanette","role":"Bookings & accounts","phone":"072 139 7783"}]'
);

-- ---------- steel price list ----------
create table public.prices (
  id text primary key,
  name text not null,
  unit text not null,
  cost numeric not null default 0,   -- buying price excl. VAT
  kg numeric not null default 0,     -- mass per unit, for galvanising
  sort int not null default 0,
  active boolean not null default true
);
insert into public.prices (id, name, unit, cost, kg, sort) values
 ('sq50','Square tube 50×50×2 mm','6 m length',520,17.6,10),
 ('sq40','Square tube 40×40×2 mm','6 m length',410,13.9,20),
 ('rhs76','Rect. tube 76×38×2 mm','6 m length',640,20.4,30),
 ('ang40','Angle 40×40×3 mm','6 m length',320,11.0,40),
 ('ang50','Angle 50×50×5 mm','6 m length',620,22.6,50),
 ('ch100','Channel (PFC) 100×50 mm','6 m length',1350,61.0,60),
 ('fb50','Flat bar 50×6 mm','6 m length',360,14.1,70),
 ('sh16','Sheet 1.6 mm, 2.5×1.225 m','sheet',1180,38.5,80),
 ('sh2','Sheet 2.0 mm, 2.5×1.225 m','sheet',1450,48.1,90),
 ('sh45','Plate 4.5 mm, 2.5×1.225 m','sheet',3300,108.2,100),
 ('chq3','Chequer plate 3 mm, 2.5×1.225 m','sheet',2650,80.0,110),
 ('mesh','Expanded mesh panel, 2.5×1.225 m','panel',780,15.0,120),
 ('axle','Axle 1 000 kg, unbraked, with hubs','each',2650,35,130),
 ('spring','Leaf springs + U-bolts','pair',980,12,140),
 ('wheel','Wheel & tyre 13"','each',1150,14,150),
 ('coupler','Coupler 50 mm ball','each',620,3,160),
 ('jockey','Jockey wheel & clamp','each',520,4,170),
 ('lights','LED light kit + 7-pin plug','kit',780,2,180),
 ('guards','Mudguards','pair',460,6,190),
 ('reflect','Reflectors & plate holder','set',180,0.5,200),
 ('lugs','Skip lifting lugs & pins','set of 4',650,4,210),
 ('paint','Primer & enamel paint','5 L kit',950,0,220);

-- ---------- quote requests from the website ----------
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  phone text not null check (char_length(phone) between 6 and 30),
  email text check (email is null or char_length(email) <= 200),
  type text not null check (type in ('New trailer','Trailer repair','New skip','Skip repair','Custom fabrication')),
  detail text check (detail is null or char_length(detail) <= 4000),
  timing text check (timing is null or char_length(timing) <= 60),
  photos text[] not null default '{}' check (cardinality(photos) <= 6),
  status text not null default 'New' check (status in ('New','Quoted','Declined'))
);

-- ---------- quotes & jobs ----------
create sequence public.quote_seq start 1;
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  quote_no text unique not null default ('NJR-Q-' || lpad(nextval('public.quote_seq')::text, 4, '0')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  quote_date date not null default current_date,
  customer text not null,
  phone text,
  email text,
  title text not null,
  units int not null default 1 check (units >= 1),
  galv boolean not null default false,
  markup numeric not null,
  status text not null default 'Draft' check (status in
    ('Draft','Quote sent','Accepted','In workshop','Ready for collection','Invoiced','Paid','Declined')),
  notes text,
  request_id uuid references public.requests(id) on delete set null,
  mats jsonb not null default '[]',    -- [{id, name, qty, cost, kg}]  prices locked at quote time
  labour jsonb not null default '[]',  -- [{task, hours}]
  extras jsonb not null default '[]',  -- [{desc, amount}]
  rates jsonb not null                 -- settings snapshot at quote time: {labour, consumables, overhead, vat, galv, validity, deposit}
);
create index jobs_status_idx on public.jobs (status);
create index jobs_request_idx on public.jobs (request_id);

-- ---------- gallery ----------
create table public.gallery (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  caption text,
  path text not null,          -- object path in the 'gallery' bucket
  sort int not null default 0,
  visible boolean not null default true
);

-- ---------- row-level security ----------
alter table public.staff    enable row level security;
alter table public.settings enable row level security;
alter table public.prices   enable row level security;
alter table public.requests enable row level security;
alter table public.jobs     enable row level security;
alter table public.gallery  enable row level security;

create policy staff_read on public.staff for select to authenticated using ((select public.is_staff()));

create policy settings_staff_read on public.settings for select to authenticated using ((select public.is_staff()));
create policy settings_staff_update on public.settings for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy prices_staff_all on public.prices for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy requests_public_insert on public.requests for insert to anon, authenticated
  with check (status = 'New');
create policy requests_staff_read on public.requests for select to authenticated using ((select public.is_staff()));
create policy requests_staff_update on public.requests for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy requests_staff_delete on public.requests for delete to authenticated using ((select public.is_staff()));

create policy jobs_staff_all on public.jobs for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy gallery_public_read on public.gallery for select to anon, authenticated using (visible or (select public.is_staff()));
create policy gallery_staff_insert on public.gallery for insert to authenticated with check ((select public.is_staff()));
create policy gallery_staff_update on public.gallery for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy gallery_staff_delete on public.gallery for delete to authenticated using ((select public.is_staff()));

-- Public site info: only contact people and the "from" prices, never rates or markup.
create or replace function public.public_site_info()
returns jsonb
language sql stable security definer set search_path = public
as $$ select jsonb_build_object('people', people, 'from_prices', from_prices) from public.settings where id = 1 $$;
revoke all on function public.public_site_info() from public;
grant execute on function public.public_site_info() to anon, authenticated;

grant usage on sequence public.quote_seq to authenticated;

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('request-photos', 'request-photos', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic']),
  ('gallery', 'gallery', true, 8388608, array['image/jpeg','image/png','image/webp']);

-- Visitors may upload request photos into an "incoming/" folder but never list or read them.
create policy request_photos_public_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'request-photos' and (storage.foldername(name))[1] = 'incoming');
create policy request_photos_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and (select public.is_staff()));
create policy request_photos_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'request-photos' and (select public.is_staff()));

create policy gallery_staff_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and (select public.is_staff()));
create policy gallery_staff_delete_obj on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and (select public.is_staff()));
