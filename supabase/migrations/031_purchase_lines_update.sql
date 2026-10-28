-- Renaming a part also fixes its name on the uploaded slips' item lines.
create policy purchase_lines_staff_update on purchase_lines for update
  using ((select is_staff())) with check ((select is_staff()));
