// Job costing engine. Pure functions only, so the public "from" prices,
// the staff costing screen and the customer quote all use the same maths.
//
// A job carries its own copy of the rates and the steel prices at the time
// it was quoted (job.rates, job.mats[].cost/kg), so later price-list or
// rate changes never alter a quote that was already sent.

export const TEMPLATES = {
  trailer: {
    title: '3.0 × 1.5 m utility trailer with mesh cage',
    mats: [['sq50', 5], ['sq40', 4], ['rhs76', 2], ['sh2', 2], ['mesh', 4], ['ang40', 2], ['axle', 1], ['spring', 1], ['wheel', 2], ['coupler', 1], ['jockey', 1], ['lights', 1], ['guards', 1], ['reflect', 1], ['paint', 1]],
    labour: [['Cut & prep steel', 4], ['Chassis & body welding', 12], ['Cage & mesh', 5], ['Wiring & lights', 2], ['Grind, prime & paint', 3]],
  },
  // 'skip' is the smallest new skip; the website shows its price as "from".
  skip: {
    // Steel = RT Laser laser-cut parts, quote JOB-9298 (2 mm MS, R6 745.06 excl. VAT per skip).
    // Hours are estimates: Nico to confirm.
    title: "2 m³ mini skip, new build (laser-cut parts)",
    mats: [['skip2_long1250', 2], ['skip2_long1300', 2], ['skip2_long2310', 2], ['skip2_plate300', 2], ['skip2_floor', 1], ['skip2_front', 2], ['skip2_inside', 2], ['skip2_outside', 4], ['skip2_sides', 2], ['lugs', 1], ['paint', 1]],
    labour: [['Fit-up & tack laser parts', 3], ['Body welding', 8], ['Lugs & reinforcing', 3], ['Grind, prime & paint', 2]],
  },
  skip3: {
    title: "3 m³ builder's skip, new build",
    mats: [['sh45', 4], ['ch100', 1], ['ang50', 3], ['fb50', 2], ['lugs', 1], ['paint', 1]],
    labour: [['Cut & prep plate', 4], ['Body welding', 10], ['Lugs & reinforcing', 3], ['Grind, prime & paint', 3]],
  },
  skiprep: {
    title: 'Skip repair: replace floor',
    mats: [['sh45', 2], ['ang50', 1], ['paint', 1]],
    labour: [['Strip & cut out old floor', 3], ['Fit & weld new floor', 6], ['Prime & paint', 2]],
  },
  trailerrep: {
    title: 'Trailer repair: chequer floor & new lights',
    mats: [['chq3', 1], ['fb50', 1], ['lights', 1]],
    labour: [['Remove old floor', 2], ['Fit & weld floor', 3], ['Rewire lights', 2]],
  },
  custom: { title: 'Custom fabrication', mats: [], labour: [['Fabrication', 1]] },
}

// Which template to start from when costing a website request.
export const TEMPLATE_FOR_REQUEST = {
  'New trailer': 'trailer',
  'Trailer repair': 'trailerrep',
  'New skip': 'skip',
  'Skip repair': 'skiprep',
  'Custom fabrication': 'custom',
}

// Job stage (where the work is). Payment is tracked separately: see src/orders.js.
export const STATUSES = ['Draft', 'Quote sent', 'Received', 'In production', 'Ready', 'Delivered', 'Declined']

export const n = (v) => {
  const x = parseFloat(v)
  return Number.isFinite(x) ? x : 0
}

export function ratesFrom(settings) {
  const { labour, consumables, overhead, vat, galv, validity, deposit } = settings
  return { labour: n(labour), consumables: n(consumables), overhead: n(overhead), vat: n(vat), galv: n(galv), validity: n(validity), deposit: n(deposit) }
}

export function matLine(price, qty = 1) {
  return { id: price.id, name: price.name, unit: price.unit, qty, cost: n(price.cost), kg: n(price.kg), supplied_by: 'NJR', have: false }
}

// A part that isn't on the price list (e.g. the towing hitch ball a client bought).
export function customPart(name = '', supplied_by = 'NJR') {
  return { id: `custom-${Math.random().toString(36).slice(2, 9)}`, name, unit: 'each', qty: 1, cost: 0, kg: 0, supplied_by, have: false, custom: true }
}

// Parts the customer supplies, for the quote/invoice note.
export const clientParts = (job) => [
  ...(job.products || []).flatMap((pl) => (pl.parts || []).filter((x) => x.supplied_by === 'Client').map((x) => ({ ...x, qty: n(x.qty) * n(pl.qty || 1) }))),
  ...(job.mats || []).filter((m) => m.supplied_by === 'Client'),
]

export function fromTemplate(key, prices) {
  const t = TEMPLATES[key] || TEMPLATES.custom
  const byId = Object.fromEntries(prices.map((p) => [p.id, p]))
  return {
    title: t.title,
    mats: t.mats.filter(([id]) => byId[id]).map(([id, qty]) => matLine(byId[id], qty)),
    labour: t.labour.map(([task, hours]) => ({ task, hours })),
    extras: [],
  }
}

export function calc(job) {
  const r = job.rates
  const u = Math.max(1, Math.round(n(job.units)) || 1)
  let materials = 0
  let kg = 0
  for (const m of job.mats) {
    if (m.supplied_by === 'Client') continue // the customer brings it: on the parts list, not charged
    materials += n(m.qty) * n(m.cost)
    kg += n(m.qty) * n(m.kg)
  }
  const hours = job.labour.reduce((a, l) => a + n(l.hours), 0)
  const labour = hours * r.labour
  const consumables = hours * r.consumables
  const galv = job.galv ? kg * r.galv : 0
  const extras = job.extras.reduce((a, e) => a + n(e.amount), 0)
  const direct = (materials + galv + labour + consumables + extras) * u
  const overhead = (direct * r.overhead) / 100
  const costedCost = direct + overhead
  const costedExcl = costedCost * (1 + n(job.markup) / 100)
  // Products ("1 × 2 m³ skip") are sold at their own price; their cost comes from their parts and hours.
  let productsExcl = 0
  let productsCost = 0
  for (const pl of job.products || []) {
    productsExcl += (n(pl.price_incl) / (1 + r.vat / 100)) * n(pl.qty)
    productsCost += n(pl.cost_excl) * n(pl.qty)
  }
  const cost = costedCost + productsCost
  const excl = costedExcl + productsExcl
  const markup = excl - cost // profit
  const vat = (excl * r.vat) / 100
  const total = excl + vat
  return {
    u, kg: kg * u, hours: hours * u,
    materials: materials * u, labour: labour * u, consumables: consumables * u, galv: galv * u, extras: extras * u,
    direct, overhead, costedCost, costedExcl, productsExcl, productsCost, cost, markup, excl, vat, total,
    margin: excl ? (markup / excl) * 100 : 0,
    deposit: (total * r.deposit) / 100,
  }
}

// Customer-facing lines: sell prices only, with overhead and markup spread
// across the lines in proportion to their cost. Lines always add up to excl.
export function customerLines(job) {
  const t = calc(job)
  const factor = t.direct ? t.costedExcl / t.direct : 1
  const lines = (job.products || []).map((pl) => ({
    desc: pl.options?.length ? `${pl.name} (${pl.options.join(', ')})` : pl.name,
    qty: n(pl.qty), amount: (n(pl.price_incl) / (1 + job.rates.vat / 100)) * n(pl.qty),
  }))
  const made = t.materials + t.labour + t.consumables
  if (made > 0) lines.push({ desc: `${job.title}: steel, hardware & fabrication`, qty: t.u, amount: made * factor })
  if (t.galv) lines.push({ desc: 'Hot-dip galvanising', qty: t.u, amount: t.galv * factor })
  for (const x of job.extras) lines.push({ desc: x.desc, qty: t.u, amount: n(x.amount) * t.u * factor })
  return lines
}

// "From" prices shown on the public site, incl. VAT, rounded to R100.
export function computeFromPrices(settings, prices) {
  const out = {}
  for (const key of ['trailer', 'skip', 'skiprep']) {
    const job = { ...fromTemplate(key, prices), units: 1, galv: false, markup: n(settings.markup), rates: ratesFrom(settings) }
    out[key] = Math.round(calc(job).total / 100) * 100
  }
  return out
}

// ---------------------------------------------------------------------------
// Products: finished items set up once (parts + hours), sold at NJR's own price.
// ---------------------------------------------------------------------------

// What one product costs NJR today (excl. VAT, incl. workshop overhead), from current part prices.
export function productCost(product, prices, rates) {
  const byId = Object.fromEntries(prices.map((x) => [x.id, x]))
  const parts = (product.mats || []).filter((m) => m.id).map((m) => { // an empty line (part not chosen yet) doesn't count
    const pr = byId[m.id]
    return { id: m.id, name: pr?.name || m.name || m.id, unit: pr?.unit || 'each', qty: n(m.qty), cost: n(pr?.cost), missing: !pr }
  })
  const materials = parts.reduce((a, x) => a + x.qty * x.cost, 0)
  const hours = (product.labour || []).reduce((a, l) => a + n(l.hours), 0)
  const labour = hours * n(rates.labour) + hours * n(rates.consumables)
  const extras = (product.extras || []).reduce((a, x) => a + n(x.amount), 0)
  const direct = materials + labour + extras
  const cost = direct * (1 + n(rates.overhead) / 100)
  return { parts, materials, hours, labour, extras, direct, cost, unpriced: parts.filter((x) => !x.cost || x.missing) }
}

// Suggested selling price incl. VAT: cost + markup + VAT, rounded up to the next R10.
export function suggestedPrice(cost, markupPct, vatPct) {
  return Math.ceil((cost * (1 + n(markupPct) / 100) * (1 + n(vatPct) / 100)) / 10) * 10
}

// Margin (profit as % of the price excl. VAT) for a selling price incl. VAT.
export function marginAt(priceIncl, cost, vatPct) {
  const excl = n(priceIncl) / (1 + n(vatPct) / 100)
  return excl > 0 ? ((excl - cost) / excl) * 100 : 0
}

// A product as a line on a quote: price and cost each (with chosen options), and its parts snapshot.
export function productLine(product, prices, rates, chosen = [], qty = 1) {
  const pc = productCost(product, prices, rates)
  const opts = (product.options || []).filter((o) => chosen.includes(o.name))
  return {
    product_id: product.id, name: product.name, qty,
    options: opts.map((o) => o.name),
    price_incl: Math.round((n(product.price_incl) + opts.reduce((a, o) => a + n(o.price_incl), 0)) * 100) / 100,
    cost_excl: Math.round((pc.cost + opts.reduce((a, o) => a + n(o.cost_excl), 0)) * 100) / 100,
    parts: pc.parts.map((x) => ({ id: x.id, name: x.name, unit: x.unit, qty: x.qty, cost: x.cost, supplied_by: 'NJR', have: false })),
    labour: product.labour || [],
  }
}

// A line NJR types in for one-off work: description, price each incl. VAT, and (optional) what it costs NJR.
export function ownLine(name = '', price_incl = '', qty = 1, cost_excl = '') {
  return { product_id: null, custom: true, name, qty, options: [], price_incl, cost_excl, parts: [], labour: [] }
}

// "Work out a price": parts from Stock + hours + other costs → cost and suggested price, as an own line.
// The recipe is kept on the line (worked) so the helper reopens with the same parts and hours.
export function workedLine(recipe, prices, rates, base = ownLine()) {
  const pc = productCost(recipe, prices, rates)
  return {
    ...base,
    price_incl: suggestedPrice(pc.cost, recipe.markup, rates.vat),
    cost_excl: Math.round(pc.cost * 100) / 100,
    parts: pc.parts.map((x) => ({ id: x.id, name: x.name, unit: x.unit, qty: x.qty, cost: x.cost, supplied_by: 'NJR', have: false })),
    labour: recipe.labour || [],
    worked: { mats: recipe.mats || [], labour: recipe.labour || [], extras: recipe.extras || [], markup: n(recipe.markup) },
  }
}

// A template (or old-style job costing) as a worked own line.
export function templateLine(key, prices, rates, markup) {
  const t = TEMPLATES[key] || TEMPLATES.custom
  const ids = new Set(prices.map((p) => p.id))
  const recipe = { mats: t.mats.filter(([id]) => ids.has(id)).map(([id, qty]) => ({ id, qty })), labour: t.labour.map(([task, hours]) => ({ task, hours })), extras: [], markup }
  return workedLine(recipe, prices, rates, ownLine(t.title))
}

// Older quotes were costed part by part on the job itself (mats/labour/extras). Turn that into one own line
// at exactly the same price, keeping the parts (client-supplied parts stay on the job's parts list).
export function legacyToLine(job) {
  const t = calc(job)
  if (!t.costedExcl) return null
  return {
    ...ownLine(job.title || 'Work as quoted', Math.round((t.costedExcl * (1 + job.rates.vat / 100) / t.u) * 100) / 100, t.u, Math.round((t.costedCost / t.u) * 100) / 100),
    parts: (job.mats || []).filter((m) => m.supplied_by !== 'Client').map((m) => ({ id: m.id, name: m.name, unit: m.unit, qty: n(m.qty), cost: n(m.cost), supplied_by: 'NJR', have: Boolean(m.have) })),
    labour: job.labour || [],
  }
}
