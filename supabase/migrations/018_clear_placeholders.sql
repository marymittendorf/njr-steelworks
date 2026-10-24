-- Remove the 25 made-up placeholder prices (never real supplier prices); NJR enters real ones.
-- NJR's own parts from the Excel parts list (the rows with notes) stay.
-- Quote numbering restarts at NJR-Q-0001 (no quotes exist).
-- The website's instant price calculator gets an on/off switch, off until real prices are in.

delete from public.prices where id in (
  'sq50','sq40','sq20','rhs76','ang40','ang50','ch100','fb50','sh16','sh2','sh45','chq3','mesh',
  'axle','spring','wheel','coupler','jockey','lights','guards','reflect','lugs','paint','gate_hinge','gate_slide');

select setval('public.quote_seq', 1, false) where not exists (select 1 from public.jobs);

alter table public.settings add column calculator_enabled boolean not null default false;

create or replace function public.public_site_info()
returns jsonb
language sql stable security definer set search_path = public
as $$ select jsonb_build_object('people', people, 'from_prices', from_prices,
                                'ai_estimator', ai_estimator_enabled, 'calculator', calculator_enabled)
      from public.settings where id = 1 $$;
