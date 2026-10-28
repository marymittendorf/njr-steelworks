-- Slips for parts the client bought are kept too (no expense, no stock), linked to the job they went onto.
alter table purchases add column if not exists bought_by text not null default 'NJR' check (bought_by in ('NJR', 'Client'));
alter table purchases add column if not exists job_id uuid references jobs(id) on delete set null;
create index if not exists purchases_job_id_idx on purchases(job_id);
