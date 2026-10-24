-- Type of work on each quote/job (same list as products), for the monthly profit report.
alter table public.jobs
  add column category text check (category in ('Skips', 'Trailers', 'Gates', 'Fabrication', 'Welding', 'Other'));

-- Best guess for existing jobs from their description.
update public.jobs set category = case
  when title ilike '%skip%' then 'Skips'
  when title ilike '%trailer%' then 'Trailers'
  when title ilike '%gate%' then 'Gates'
  else 'Other' end
where category is null;
