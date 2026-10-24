-- Payment terms for invoices, in days after the invoice date (0 = due on receipt).
-- The due date and "overdue by N days" on the Invoices list are worked out from this.
alter table public.settings add column payment_terms int not null default 0 check (payment_terms between 0 and 120);
