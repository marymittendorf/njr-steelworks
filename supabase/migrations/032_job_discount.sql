-- Discount on a quote or invoice: a rand amount (excl. VAT) or a percentage, taken off the subtotal before VAT.
alter table jobs add column if not exists discount_type text not null default 'amount' check (discount_type in ('amount', 'pct'));
alter table jobs add column if not exists discount_value numeric not null default 0 check (discount_value >= 0);
