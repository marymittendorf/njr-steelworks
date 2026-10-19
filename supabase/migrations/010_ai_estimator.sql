-- AI price estimator on the website. The ai-estimate Edge Function writes here with the service role.

-- Website requests can now come with an AI estimate attached.
alter table public.requests
  add column source text not null default 'Form' check (source in ('Form', 'AI estimate')),
  add column ai_estimate jsonb;

-- On/off switch and limits, editable by staff under Rates & settings. Off until the API key is added.
alter table public.settings
  add column ai_estimator_enabled boolean not null default false,
  add column ai_daily_limit int not null default 40 check (ai_daily_limit between 0 and 1000),
  add column ai_per_visitor_daily int not null default 5 check (ai_per_visitor_daily between 1 and 50);

-- One row per estimate attempt: for the limits and to show what it's costing.
create table public.ai_estimate_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  visitor text not null,          -- hashed IP address, never the IP itself
  ok boolean not null,
  input_tokens int,
  output_tokens int,
  cost_usd numeric,
  note text
);
create index ai_estimate_log_day_idx on public.ai_estimate_log (created_at);
alter table public.ai_estimate_log enable row level security;
create policy ai_estimate_log_staff_read on public.ai_estimate_log for select to authenticated
  using ((select public.is_staff()));

-- The public site needs to know whether to show the estimator.
create or replace function public.public_site_info()
returns jsonb
language sql stable security definer set search_path = public
as $$ select jsonb_build_object('people', people, 'from_prices', from_prices, 'ai_estimator', ai_estimator_enabled)
      from public.settings where id = 1 $$;
