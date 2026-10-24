-- Customer's company, address and VAT number, kept on each quote/invoice (like name, cell and email),
-- so a printed invoice always shows the details it was issued with. Editing a customer updates them all.
alter table public.jobs
  add column customer_company text,
  add column customer_address text,
  add column customer_vat text;
