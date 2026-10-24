-- One list for parts & materials: the price list items now carry the quantity on hand too,
-- and the page lives under Stock. Purchases add to the item's quantity and update its cost.
-- The separate stock_parts table (never used) goes.

alter table public.prices add column qty_on_hand numeric(12,2) not null default 0;

alter table public.purchase_lines add column price_id text references public.prices(id) on delete set null;
alter table public.purchase_lines drop column stock_part_id;
drop table public.stock_parts;
