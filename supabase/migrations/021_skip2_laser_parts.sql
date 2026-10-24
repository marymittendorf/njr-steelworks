-- 2 m³ mini skip: laser-cut parts from RT Laser quote JOB-9298 (23 Oct 2026), 2 mm mild steel.
-- Cost = price per piece excl. VAT. Quantities per skip live in the "skip" costing template.
-- Lifting lugs and paint added without a price (NJR to fill in).

insert into public.prices (id, name, unit, cost, kg, sort, notes) values
  ('skip2_long1250', '2 m³ skip: long strip 1250×120×2 MS (laser)', 'each', 175.26, 0, 400, 'RT Laser JOB-9298 · 2 per skip'),
  ('skip2_long1300', '2 m³ skip: long strip 1300×120×2 MS (laser)', 'each', 180.30, 0, 401, 'RT Laser JOB-9298 · 2 per skip'),
  ('skip2_long2310', '2 m³ skip: long strip 2310×120×2 MS (laser)', 'each', 282.21, 0, 402, 'RT Laser JOB-9298 · 2 per skip'),
  ('skip2_plate300', '2 m³ skip: plate 300×170×2 MS (laser)',       'each', 92.92,  0, 403, 'RT Laser JOB-9298 · 2 per skip'),
  ('skip2_floor',    '2 m³ skip: floor 1210×900×2 MS (laser)',      'each', 712.62, 0, 404, 'RT Laser JOB-9298 · 1 per skip'),
  ('skip2_front',    '2 m³ skip: front 1230×1190×2 MS (laser)',     'each', 868.22, 0, 405, 'RT Laser JOB-9298 · 2 per skip'),
  ('skip2_inside',   '2 m³ skip: inside 110×110×2 MS (laser)',      'each', 31.36,  0, 406, 'RT Laser JOB-9298 · 2 per skip'),
  ('skip2_outside',  '2 m³ skip: outside 70×70×2 MS (laser)',       'each', 24.54,  0, 407, 'RT Laser JOB-9298 · 4 per skip'),
  ('skip2_sides',    '2 m³ skip: side 2230×980×2 MS (laser)',       'each', 1336.87, 0, 408, 'RT Laser JOB-9298 · 2 per skip'),
  ('lugs',  'Skip lifting lugs & pins', 'set of 4', 0, 0, 410, 'Enter your price before quoting'),
  ('paint', 'Primer & enamel paint',    '5 L kit',  0, 0, 411, 'Enter your price before quoting')
on conflict (id) do nothing;
