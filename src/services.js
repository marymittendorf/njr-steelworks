// The five service cards on the website. Their "from" prices are set by staff
// under Rates & settings → Website prices, and stored in settings.from_prices as
// { [key]: { label, price } }. A card with no price shows "Ask for a quote".
export const SERVICES = [
  { key: 'trailer', tag: 'Trailers', h: 'Trailers', defaultLabel: '3.0 m cage trailer from',
    items: ['New builds to your size, 1.8 m to 4 m', 'Mesh cages, lids, ramps and tool boxes', 'Floors, axles, springs, wiring and lights', 'Galvanised or painted finish'] },
  { key: 'skip', tag: 'Skips', h: 'Skips', defaultLabel: '2 m³ skip from',
    items: ["New 2 m³ and 3 m³ builder's skips", 'Floor and side replacement', 'Lifting lugs and pins renewed', 'Fleet rates for skip hire companies'] },
  { key: 'fabrication', tag: 'Custom work', h: 'Steel fabrication', defaultLabel: 'From',
    items: ['Frames, racks and brackets', 'Farm and workshop equipment', 'One-off parts made to drawing or sample'] },
  { key: 'welding', tag: 'All steel work', h: 'Welding', defaultLabel: 'From',
    items: ['MIG and arc welding in the workshop', 'Cracked frames and broken brackets', 'On-site welding by arrangement'] },
  { key: 'gates', tag: 'General repairs', h: 'Gates & structures', defaultLabel: 'From',
    items: ['Driveway and farm gates', 'Burglar bars and security frames', 'Carports, canopies and steel structures'] },
]
