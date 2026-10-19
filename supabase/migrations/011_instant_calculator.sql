-- Instant price calculator (no AI): requests can come from it, and gates need a few
-- items the price list didn't have. Placeholder prices like the rest; edit under Steel price list.

alter table public.requests drop constraint requests_source_check;
alter table public.requests add constraint requests_source_check
  check (source in ('Form', 'AI estimate', 'Calculator'));

insert into public.prices (id, name, unit, cost, kg, sort) values
  ('sq20', 'Square tube 20×20×1.6 mm', '6 m length', 180, 5.3, 25),
  ('gate_hinge', 'Gate hinges & latch set', 'set per leaf', 450, 3, 230),
  ('gate_slide', 'Sliding gate wheels, guide & track kit', 'kit', 1650, 18, 240)
on conflict (id) do nothing;
