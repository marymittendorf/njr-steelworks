-- Products: finished items NJR sells (e.g. "2 m³ skip"), set up once with what goes into them.
-- A quote can then be "1 × 2 m³ skip" while the job still knows every part inside.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  category text not null default 'Other' check (category in ('Skips', 'Trailers', 'Gates', 'Fabrication', 'Welding', 'Other')),
  spec text,                                   -- internal description
  mats jsonb not null default '[]',            -- [{id (price list), qty}] per product
  labour jsonb not null default '[]',          -- [{task, hours}] per product
  extras jsonb not null default '[]',          -- [{desc, amount}] cost excl. VAT per product
  markup numeric,                              -- % for the suggested price; null = default from settings
  price_incl numeric(12,2),                    -- NJR's selling price incl. VAT (editable)
  options jsonb not null default '[]',         -- [{name, price_incl, cost_excl}] add-ons, e.g. galvanised
  on_website boolean not null default false,   -- show in the website's instant price and "from" price
  active boolean not null default true,
  sort int not null default 0
);

alter table public.products enable row level security;
create policy products_staff_read on public.products for select to authenticated using ((select public.is_staff()));
create policy products_staff_insert on public.products for insert to authenticated with check ((select public.is_staff()));
create policy products_staff_update on public.products for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy products_owner_delete on public.products for delete to authenticated using ((select public.is_owner()));

-- Products on a quote/job: [{product_id, name, qty, options:[names], price_incl (each), cost_excl (each),
--   parts:[{id, name, unit, qty (per product), cost, supplied_by, have}], labour:[{task, hours}]}]
alter table public.jobs
  add column products jsonb not null default '[]',
  add column stock_taken_at timestamptz;

-- When a job goes into production, take its parts off stock (once).
-- Parts the client supplies, and parts not on the price list, are skipped.
create or replace function public.take_job_stock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  units numeric := greatest(coalesce(new.units, 1), 1);
begin
  if new.stock_taken_at is null
     and new.status in ('In production', 'Ready', 'Delivered')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    with used as (
      select m->>'id' as id, (m->>'qty')::numeric * units as qty
        from jsonb_array_elements(new.mats) m
        where coalesce(m->>'supplied_by', 'NJR') <> 'Client'
      union all
      select pt->>'id', (pt->>'qty')::numeric * coalesce((p->>'qty')::numeric, 1)
        from jsonb_array_elements(new.products) p, jsonb_array_elements(coalesce(p->'parts', '[]')) pt
        where coalesce(pt->>'supplied_by', 'NJR') <> 'Client'
    ), total as (select id, sum(qty) qty from used where id is not null group by id)
    update prices pr set qty_on_hand = pr.qty_on_hand - t.qty from total t where pr.id = t.id;
    new.stock_taken_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.take_job_stock() from public, anon, authenticated;
create trigger jobs_take_stock before insert or update of status on public.jobs
  for each row execute function public.take_job_stock();

-- Website: the products shown on the instant price, with selling prices only (never costs).
create or replace function public.public_products()
returns jsonb
language sql stable security definer set search_path = public
as $$ select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'name', name, 'category', category, 'price', price_incl,
          'options', (select coalesce(jsonb_agg(jsonb_build_object('name', o->>'name', 'price', (o->>'price_incl')::numeric)), '[]')
                      from jsonb_array_elements(options) o))
        order by category, sort, price_incl), '[]')
      from public.products where active and on_website and price_incl > 0 $$;
grant execute on function public.public_products() to anon, authenticated;
