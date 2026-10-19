-- The gallery read policy called is_staff() for anon visitors, but anon may not run is_staff(),
-- so the public gallery query failed. Split it: anon sees visible photos, staff see all.
drop policy gallery_public_read on public.gallery;
create policy gallery_anon_read on public.gallery for select to anon using (visible);
create policy gallery_signed_in_read on public.gallery for select to authenticated using (visible or (select public.is_staff()));
