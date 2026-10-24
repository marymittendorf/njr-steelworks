-- Banking, the skip program's way: upload a bank statement export (Nedbank or FNB CSV; Capitec
-- to follow), money in is matched to invoices as payments, money out becomes expenses.
-- A statement line is stored once (fingerprint), so uploading overlapping statements is safe.

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  bank text not null check (bank in ('nedbank', 'capitec', 'fnb', 'other')),
  account_number text,
  active boolean not null default true
);

create table public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id),
  file_name text,
  period_from date,
  period_to date,
  money_in_added int not null default 0,
  money_out_added int not null default 0,
  lines_skipped int not null default 0,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

-- Money in.
create table public.bank_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bank_account_id uuid not null references public.bank_accounts(id),
  statement_id uuid references public.bank_statements(id) on delete set null,
  txn_date date not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  balance numeric(14,2),
  fingerprint text not null,
  allocated_amount numeric(12,2) not null default 0,
  status text not null default 'unallocated' check (status in ('unallocated', 'part', 'allocated', 'ignored')),
  ignore_note text,
  unique (bank_account_id, fingerprint)
);
create index bank_lines_open_idx on public.bank_lines (status, txn_date);

-- Payments can point at the statement line that proves them.
alter table public.payments add column bank_line_id uuid references public.bank_lines(id) on delete set null;
create index payments_bank_line_idx on public.payments (bank_line_id);

-- Money out lands in expenses, linked back to its statement line.
alter table public.expenses
  add column bank_account_id uuid references public.bank_accounts(id),
  add column statement_id uuid references public.bank_statements(id) on delete set null,
  add column fingerprint text,
  add column bank_description text,
  add column needs_review boolean not null default false;
create unique index expenses_bank_fingerprint_idx on public.expenses (bank_account_id, fingerprint) where fingerprint is not null;

-- Keep a bank line's allocated amount and status in step with the payments pointing at it.
create or replace function public.refresh_bank_line(p_line uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_alloc numeric(12,2);
begin
  if p_line is null then return; end if;
  select coalesce(sum(amount), 0) into v_alloc from payments where bank_line_id = p_line;
  update bank_lines set
    allocated_amount = v_alloc,
    status = case when status = 'ignored' and v_alloc = 0 then 'ignored'
                  when v_alloc >= amount - 0.005 then 'allocated'
                  when v_alloc > 0 then 'part'
                  else 'unallocated' end
  where id = p_line;
end $$;
revoke execute on function public.refresh_bank_line(uuid) from public, anon, authenticated;

create or replace function public.payments_bank_line_changed()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.refresh_bank_line(old.bank_line_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.refresh_bank_line(new.bank_line_id); end if;
  return null;
end $$;
revoke execute on function public.payments_bank_line_changed() from public, anon, authenticated;

create trigger payments_refresh_bank_line
  after insert or delete or update of bank_line_id, amount on public.payments
  for each row execute function public.payments_bank_line_changed();

-- Staff may link a recorded payment to its statement line (and nothing else on a payment).
create policy payments_staff_link_line on public.payments for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create or replace function public.payments_guard_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.amount, new.job_id, new.paid_on, new.method) is distinct from (old.amount, old.job_id, old.paid_on, old.method) then
    raise exception 'A recorded payment can''t be changed. Remove it and record it again.';
  end if;
  return new;
end $$;
revoke execute on function public.payments_guard_update() from public, anon, authenticated;
create trigger payments_guard_update before update on public.payments
  for each row execute function public.payments_guard_update();

alter table public.bank_accounts enable row level security;
alter table public.bank_statements enable row level security;
alter table public.bank_lines enable row level security;
create policy bank_accounts_staff_read on public.bank_accounts for select to authenticated using ((select public.is_staff()));
create policy bank_accounts_owner_write on public.bank_accounts for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy bank_statements_staff_read on public.bank_statements for select to authenticated using ((select public.is_staff()));
create policy bank_statements_staff_insert on public.bank_statements for insert to authenticated with check ((select public.is_staff()));
create policy bank_statements_staff_update on public.bank_statements for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy bank_lines_staff_read on public.bank_lines for select to authenticated using ((select public.is_staff()));
create policy bank_lines_staff_insert on public.bank_lines for insert to authenticated with check ((select public.is_staff()));
create policy bank_lines_staff_update on public.bank_lines for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
