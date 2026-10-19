// Instant price calculator recipes: customer choices → steel quantities and workshop hours.
// No AI: fixed rules, checked against NJR's own costing templates (3.0 × 1.5 m cage trailer,
// 2 m³ and 3 m³ skips). Prices come from the price list and rates via costing.js.
// Quantities are per unit, in price-list units (6 m lengths, 2.5 × 1.225 m sheets, each…).
// Nico should check these rules against how the workshop actually builds.

const SHEET = 2.5 * 1.225 // m² per sheet or mesh panel
const len6 = (metres, waste = 1.15) => Math.ceil((metres * waste) / 6) // 6 m lengths incl. offcuts
const sheets = (m2, waste = 1.1) => Math.ceil((m2 * waste) / SHEET)
const half = (h) => Math.round(h * 2) / 2

export const OPTIONS = {
  trailer: {
    length: [1.8, 2.4, 3.0, 3.6, 4.0],
    width: [1.2, 1.5, 1.8],
    cage: [0, 0.6, 1.0],          // mesh cage height in m; 0 = open dropsides only
    axles: [1, 2],
    finish: ['Painted', 'Galvanised'],
  },
  skip: { size: [2, 3], work: ['New build', 'Replace floor', 'Replace a side panel', 'New lifting lugs'], finish: ['Painted'] },
  gate: { width: [1, 8], height: [1.2, 2.4], type: ['Swing', 'Sliding'], infill: ['Vertical bars', 'Mesh', 'Solid sheet'], finish: ['Painted', 'Galvanised'] },
}

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback)
const clamp = (v, lo, hi, fallback) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback }

export function trailerJob(o = {}) {
  const T = OPTIONS.trailer
  const L = pick(Number(o.length), T.length, 3.0)
  const W = pick(Number(o.width), T.width, 1.5)
  const cage = pick(Number(o.cage), T.cage, 0)
  const axles = pick(Number(o.axles), T.axles, 1)
  const galv = o.finish === 'Galvanised'
  const ramp = Boolean(o.ramp)
  const lid = Boolean(o.lid) && cage > 0
  const perim = 2 * (L + W)

  const chassis = perim + (Math.ceil(L / 0.6) + 1) * W // frame + cross-members every 600 mm
  const mats = [
    ['sq50', len6(chassis, 1.2)],
    ['rhs76', L > 3 ? 3 : 2],                 // drawbar
    ['sh2', sheets(L * W)],                   // 2 mm steel floor
    ['ang40', Math.ceil(perim / 6)],          // top rail of the sides
    ['axle', axles], ['spring', axles], ['wheel', 2 * axles], ['guards', axles],
    ['coupler', 1], ['jockey', 1], ['lights', 1], ['reflect', 1],
  ]
  if (cage > 0) {
    mats.push(['sq40', len6(Math.ceil(perim) * cage + perim)]) // posts every metre + top rail
    mats.push(['mesh', sheets(perim * cage)])
  } else {
    mats.push(['sh16', sheets(perim * 0.4)])  // 400 mm dropsides
  }
  if (ramp) mats.push(['sq40', 1], ['mesh', 1])
  if (lid) mats.push(['sq40', 2], ['sh16', sheets(L * W)])
  if (!galv) mats.push(['paint', Math.max(1, Math.ceil(L / 3))])

  const labour = [
    ['Cut & prep steel', half(1 + L)],
    ['Chassis & drawbar welding', half(3 + 2 * L + (axles === 2 ? 3 : 0))],
    ['Floor & sides', half(0.5 + 0.5 * L)],
    ...(cage > 0 ? [['Cage & mesh', half(1 + 2 * L * cage)]] : []),
    ...(ramp ? [['Ramp', 3]] : []),
    ...(lid ? [['Lid & hinges', 5]] : []),
    ['Wiring & lights', 2],
    [galv ? 'Prep for galvanising' : 'Grind, prime & paint', half(galv ? 1 : 1 + 0.5 * L)],
  ]
  const title = `${L.toFixed(1)} × ${W.toFixed(1)} m ${axles === 2 ? 'double' : 'single'}-axle trailer${cage ? ` with ${cage === 1 ? '1 m' : '600 mm'} mesh cage` : ''}${ramp ? ', ramp' : ''}${lid ? ', lid' : ''}${galv ? ', galvanised' : ''}`
  return {
    title, units: 1, galv, mats, labour: labour.map(([task, hours]) => ({ task, hours })), extras: [],
    assumptions: [
      '2 mm steel floor on a square-tube chassis',
      `${axles === 2 ? 'Two 1 000 kg axles' : 'One 1 000 kg axle'} with 13" wheels, lights and a jockey wheel`,
      cage ? `${cage === 1 ? '1 m' : '600 mm'} expanded-mesh cage all round` : '400 mm steel dropsides, no cage',
      galv ? 'Hot-dip galvanised' : 'Primed and painted',
      'Roadworthy and licensing not included',
    ],
  }
}

const SKIP_NEW = {
  2: { mats: [['sh45', 3], ['ch100', 1], ['ang50', 2], ['fb50', 1], ['lugs', 1], ['paint', 1]], hours: [3, 8, 3, 2] },
  3: { mats: [['sh45', 4], ['ch100', 1], ['ang50', 3], ['fb50', 2], ['lugs', 1], ['paint', 1]], hours: [4, 10, 3, 3] },
}

export function skipJob(o = {}) {
  const S = OPTIONS.skip
  const size = pick(Number(o.size), S.size, 2)
  const work = pick(o.work, S.work, 'New build')
  const units = Math.round(clamp(o.units, 1, 20, 1))
  let mats; let labour; let title
  if (work === 'New build') {
    const r = SKIP_NEW[size]
    mats = r.mats
    labour = [['Cut & prep plate', r.hours[0]], ['Body welding', r.hours[1]], ['Lugs & reinforcing', r.hours[2]], ['Grind, prime & paint', r.hours[3]]]
    title = `${size} m³ builder's skip, new build`
  } else if (work === 'Replace floor') {
    mats = [['sh45', 2], ['ang50', 1], ['paint', 1]]
    labour = [['Strip & cut out old floor', 3], ['Fit & weld new floor', size === 3 ? 7 : 6], ['Prime & paint', 2]]
    title = `${size} m³ skip: replace floor`
  } else if (work === 'Replace a side panel') {
    mats = [['sh45', 1], ['ang50', 1], ['paint', 1]]
    labour = [['Cut out damaged side', 2], ['Fit & weld new side', 5], ['Prime & paint', 1.5]]
    title = `${size} m³ skip: replace a side panel`
  } else {
    mats = [['lugs', 1], ['fb50', 1]]
    labour = [['Cut off old lugs', 1], ['Weld new lugs & reinforcing', 3]]
    title = `${size} m³ skip: new lifting lugs`
  }
  return {
    title, units, galv: false, mats, labour: labour.map(([task, hours]) => ({ task, hours })), extras: [],
    assumptions: [
      '4.5 mm steel plate',
      work === 'New build' ? 'Standard builder\'s skip shape with 4 lifting lugs, primed and painted' : 'Price assumes the rest of the skip is sound; we check it when it arrives',
      'You bring the skip to the workshop in George, or we quote collection',
    ],
  }
}

export function gateJob(o = {}) {
  const G = OPTIONS.gate
  const W = Math.round(clamp(o.width, G.width[0], G.width[1], 3) * 10) / 10
  const H = Math.round(clamp(o.height, G.height[0], G.height[1], 1.8) * 10) / 10
  const type = pick(o.type, G.type, 'Swing')
  const infill = pick(o.infill, G.infill, 'Vertical bars')
  const galv = o.finish === 'Galvanised'
  const leaves = type === 'Swing' && W > 3 ? 2 : 1
  const frame = 2 * (W + H) + W + (leaves === 2 ? H : 0) // outer frame, mid rail, centre stile
  const bars = Math.ceil(W / 0.12)                        // 120 mm spacing

  const mats = [['sq50', len6(frame)]]
  if (infill === 'Vertical bars') mats.push(['sq20', len6(bars * H, 1.1)])
  else if (infill === 'Mesh') mats.push(['mesh', sheets(W * H)])
  else mats.push(['sh16', sheets(W * H)])
  mats.push(type === 'Sliding' ? ['gate_slide', 1] : ['gate_hinge', leaves])
  if (!galv) mats.push(['paint', Math.max(1, Math.ceil((W * H) / 6))])

  const labour = [
    ['Cut & prep steel', half(1 + 0.4 * W)],
    ['Frame welding', half(2 + 1.2 * W)],
    ['Infill', half(infill === 'Vertical bars' ? 0.1 * bars * H : 0.5 * W * H)],
    [type === 'Sliding' ? 'Wheels, guide & track' : 'Hinges & latch', type === 'Sliding' ? 4 : 1.5 * leaves],
    [galv ? 'Prep for galvanising' : 'Grind, prime & paint', half(galv ? 1 : 1 + 0.4 * W * H)],
  ]
  return {
    title: `${type === 'Sliding' ? 'Sliding' : leaves === 2 ? 'Double swing' : 'Swing'} gate ${W.toFixed(1)} × ${H.toFixed(1)} m, ${infill.toLowerCase()}${galv ? ', galvanised' : ''}`,
    units: 1, galv, mats, labour: labour.map(([task, hours]) => ({ task, hours })), extras: [],
    assumptions: [
      '50 × 50 mm square-tube frame',
      infill === 'Vertical bars' ? '20 × 20 mm bars about 120 mm apart' : infill === 'Mesh' ? 'Expanded-mesh infill' : '1.6 mm steel sheet infill',
      type === 'Sliding' ? 'Includes wheels, guide and track (no motor)' : `${leaves === 2 ? 'Two leaves with' : 'Includes'} hinges and a latch`,
      'Made in the workshop; installation on site quoted separately',
    ],
  }
}

export const RECIPES = { trailer: trailerJob, skip: skipJob, gate: gateJob }

// Recipe → costing job (with price-list lines) that costing.calc() can price.
// Items missing from the price list are left out and reported.
export function priceableJob(kind, options, prices, rates, markup) {
  const recipe = RECIPES[kind]
  if (!recipe) throw new Error('Unknown item')
  const r = recipe(options)
  const byId = Object.fromEntries(prices.map((p) => [p.id, p]))
  const qty = {}
  for (const [id, q] of r.mats) qty[id] = (qty[id] || 0) + q
  const missing = Object.keys(qty).filter((id) => !byId[id])
  const mats = Object.entries(qty).filter(([id]) => byId[id])
    .map(([id, q]) => ({ id, name: byId[id].name, unit: byId[id].unit, qty: q, cost: Number(byId[id].cost), kg: Number(byId[id].kg) }))
  return { ...r, mats, missing, rates, markup }
}
