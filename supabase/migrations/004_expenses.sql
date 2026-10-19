-- Business expenses: what was paid (expenses) and what keeps coming back (recurring_costs).
-- Staff only. Invoice PDFs/photos go in the private 'expense-docs' bucket.

create table public.recurring_costs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  supplier text not null,
  description text not null,
  category text not null default 'Other',
  amount_excl numeric not null check (amount_excl >= 0),
  vat_rate numeric not null default 15,        -- 0 if the supplier doesn't charge VAT
  frequency text not null check (frequency in ('monthly','yearly')),
  next_due date not null,
  active boolean not null default true
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  paid_on date not null,
  supplier text not null,
  description text not null,
  category text not null default 'Other',
  amount_excl numeric not null check (amount_excl >= 0),
  vat numeric not null default 0 check (vat >= 0),
  total numeric generated always as (amount_excl + vat) stored,
  invoice_no text,
  payment_method text,
  file_path text,                                -- object path in 'expense-docs'
  recurring_id uuid references public.recurring_costs(id) on delete set null,
  notes text
);
create index expenses_paid_on_idx on public.expenses (paid_on desc);
create index expenses_recurring_idx on public.expenses (recurring_id);

alter table public.recurring_costs enable row level security;
alter table public.expenses enable row level security;
create policy recurring_costs_staff_all on public.recurring_costs for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy expenses_staff_all on public.expenses for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('expense-docs', 'expense-docs', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp']);
create policy expense_docs_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'expense-docs' and (select public.is_staff()));
create policy expense_docs_staff_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-docs' and (select public.is_staff()));
create policy expense_docs_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'expense-docs' and (select public.is_staff()));
