-- Two markups instead of one: parts & materials, and labour (workshop hours).
-- settings.parts_markup (028) is now "Markup on parts and materials"; labour_markup is new.
-- Starts at the current default markup so suggested prices don't change until NJR changes them.
alter table public.settings add column labour_markup numeric not null default 0 check (labour_markup >= 0);
update public.settings set labour_markup = markup where id = 1;

-- A product may override either markup (null = use Settings).
alter table public.products
  add column markup_parts numeric check (markup_parts >= 0),
  add column markup_labour numeric check (markup_labour >= 0);
-- Products that had their own single markup keep it for both.
update public.products set markup_parts = markup, markup_labour = markup where markup is not null;
