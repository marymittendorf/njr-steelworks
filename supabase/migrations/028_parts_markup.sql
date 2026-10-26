-- Markup added to parts NJR buys when they are sold on a quote (cost + markup + VAT).
-- Starts at the current default markup; changed under Settings.
alter table public.settings add column parts_markup numeric not null default 20 check (parts_markup >= 0);
update public.settings set parts_markup = markup where id = 1;
