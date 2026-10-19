-- Supabase grants anon execute on new functions by default; is_staff() is only for signed-in users.
-- public_site_info() stays callable by anon on purpose (contact people + "from" prices only).
revoke execute on function public.is_staff() from anon;
