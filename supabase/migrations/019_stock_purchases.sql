-- Parts & materials stock, filled from supplier invoices: upload the invoice, the items are read,
-- added to stock at the purchase price, and the purchase is recorded as an expense.

create table public.stock_parts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  unit text not null default 'each',
  qty_on_hand numeric(12,2) not null default 0,
  last_cost numeric(12,2),                     -- excl. VAT, from the latest purchase
  price_id text references public.prices(id) on delete set null,
  notes text
);
create unique index stock_parts_name_idx on public.stock_parts (lower(name));

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  supplier text not null,
  invoice_no text,
  invoice_date date not null,
  amount_excl numeric(12,2) not null,
  vat numeric(12,2) not null default 0,
  total numeric(12,2) generated always as (amount_excl + vat) stored,
  file_path text,                              -- in 'expense-docs'
  expense_id uuid references public.expenses(id) on delete set null,
  recorded_by text
);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  stock_part_id uuid references public.stock_parts(id) on delete set null,
  description text not null,
  qty numeric(12,2) not null,
  unit_cost numeric(12,2) not null,            -- excl. VAT
  line_total numeric(12,2) not null
);
create index purchase_lines_purchase_idx on public.purchase_lines (purchase_id);

alter table public.stock_parts enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
create policy stock_parts_staff_read on public.stock_parts for select to authenticated using ((select public.is_staff()));
create policy stock_parts_staff_insert on public.stock_parts for insert to authenticated with check ((select public.is_staff()));
create policy stock_parts_staff_update on public.stock_parts for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy stock_parts_owner_delete on public.stock_parts for delete to authenticated using ((select public.is_owner()));
create policy purchases_staff_read on public.purchases for select to authenticated using ((select public.is_staff()));
create policy purchases_staff_insert on public.purchases for insert to authenticated with check ((select public.is_staff()));
create policy purchases_owner_delete on public.purchases for delete to authenticated using ((select public.is_owner()));
create policy purchase_lines_staff_read on public.purchase_lines for select to authenticated using ((select public.is_staff()));
create policy purchase_lines_staff_insert on public.purchase_lines for insert to authenticated with check ((select public.is_staff()));
create policy purchase_lines_owner_delete on public.purchase_lines for delete to authenticated using ((select public.is_owner()));
