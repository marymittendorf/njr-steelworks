-- Customer link: every quote/invoice gets a private, unguessable link (njrsteelworks.co.za/q/<token>)
-- that the email includes. The customer sees the document there and can accept or decline a quote.
--
-- customer_doc is what the customer may see (lines at selling prices, totals, dates), written by the
-- staff app whenever the quote is saved or emailed, so costs and margins never leave the back end.

alter table public.jobs
  add column share_token uuid not null default gen_random_uuid() unique,
  add column customer_doc jsonb,
  add column customer_response text check (customer_response in ('Accepted', 'Declined')),
  add column customer_response_at timestamptz,
  add column customer_response_name text,
  add column customer_response_note text;

-- The document for a link, or null. Only customer-facing fields.
create or replace function public.customer_document(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'kind', case when j.invoice_no is not null then 'invoice' else 'quote' end,
    'quote_no', j.quote_no, 'invoice_no', j.invoice_no,
    'quote_date', j.quote_date, 'invoice_date', j.invoice_date,
    'status', j.status, 'voided', j.invoice_voided_at is not null,
    'customer', j.customer, 'customer_company', j.customer_company, 'customer_address', j.customer_address,
    'customer_vat', j.customer_vat, 'phone', j.phone, 'email', j.email,
    'title', j.title, 'doc', j.customer_doc, 'amount_paid', j.amount_paid,
    'response', j.customer_response, 'response_at', j.customer_response_at,
    'can_answer', j.invoice_no is null and j.status in ('Draft', 'Quote sent') and j.job_type = 'Customer job',
    'people', s.people, 'bank_details', s.bank_details, 'payment_terms', s.payment_terms
  )
  from public.jobs j cross join public.settings s
  where j.share_token = p_token and s.id = 1 and j.customer_doc is not null
$$;
revoke execute on function public.customer_document(uuid) from public;
grant execute on function public.customer_document(uuid) to anon, authenticated;

-- Accept or decline a quote from the link. Accepting moves it to Received, which issues the invoice
-- (issue_invoice_on_accept); declining marks it Declined. Only once, and only while it's still a quote.
create or replace function public.answer_quote(p_token uuid, p_accept boolean, p_name text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where share_token = p_token for update;
  if not found or j.customer_doc is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if j.invoice_no is not null or j.status not in ('Draft', 'Quote sent') or j.job_type <> 'Customer job' then
    return jsonb_build_object('ok', false, 'error', 'This quote has already been answered.');
  end if;
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Please type your name.');
  end if;
  update public.jobs set
    status = case when p_accept then 'Received' else 'Declined' end,
    accepted_at = case when p_accept then now() else accepted_at end,
    -- the invoice totals are the quote's totals (the staff app sets these itself when it accepts a quote)
    invoice_excl = case when p_accept then round((j.customer_doc->>'excl')::numeric, 2) else invoice_excl end,
    invoice_vat = case when p_accept then round((j.customer_doc->>'vat')::numeric, 2) else invoice_vat end,
    invoice_total = case when p_accept then round((j.customer_doc->>'total')::numeric, 2) else invoice_total end,
    customer_response = case when p_accept then 'Accepted' else 'Declined' end,
    customer_response_at = now(),
    customer_response_name = left(trim(p_name), 120),
    customer_response_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
    updated_at = now()
  where id = j.id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.answer_quote(uuid, boolean, text, text) from public;
grant execute on function public.answer_quote(uuid, boolean, text, text) to anon, authenticated;
