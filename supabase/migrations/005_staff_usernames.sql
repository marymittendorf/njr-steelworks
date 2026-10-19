-- Staff sign in with a username. Behind the scenes each login is <username>@njrsteelworks.co.za.
alter table public.staff add column username text unique
  check (username ~ '^[a-z0-9][a-z0-9._-]{1,29}$');

-- First two staff, both owners (can manage staff logins).
insert into public.staff (user_id, name, role, username)
select id, initcap(split_part(email, '@', 1)), 'owner', split_part(email, '@', 1)
from auth.users
where email in ('jeanette@njrsteelworks.co.za', 'nico@njrsteelworks.co.za')
on conflict (user_id) do nothing;
