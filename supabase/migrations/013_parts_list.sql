-- Parts from NJR's Excel "Parts Price List" (NJR_Steelworks_Invoice_Dropdown_Parts_Labour_Photos.xlsx),
-- with its Notes column. Prices as in the sheet.

alter table public.prices add column notes text;

insert into public.prices (id, name, unit, cost, kg, sort, notes) values
  ('gloves',      'Gloves',                    'per glove / unit', 6.00,   0, 300, 'Example price supplied; adjust if R6 refers to another unit.'),
  ('nitrile100',  'Nitrile gloves (box of 100)', 'per box',        97.00,  0, 310, 'From Margot Swiss receipt'),
  ('rivet6421',   'Pop rivets 6421',           'each',             1.68,   0, 320, 'R84 for 50; calculated unit price'),
  ('bush_sample', 'Steel bush – sample',       'each',             300.00, 0, 330, 'Cawmat invoice'),
  ('bush_pin',    'Steel bush to suit pin',    'each',             200.00, 0, 340, 'Cawmat invoice'),
  ('rags5kg',     'Cotton rags 5kg',           'per pack',         125.00, 0, 350, 'Midas receipt'),
  ('laserpart',   'Laser-cut part',            'each',             100.00, 0, 360, 'RT Laser quote; confirm final price'),
  ('custompart',  'Other / custom part',       'each',             0.00,   0, 370, 'Enter correct price before use')
on conflict (id) do nothing;
