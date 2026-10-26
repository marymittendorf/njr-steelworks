-- Job card notes: a running log on each job, [{at, by, text}], newest last.
alter table public.jobs add column job_notes jsonb not null default '[]';
