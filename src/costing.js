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
    title: "2 m³ builder's skip, new build",
    mats: [['sh45', 3], ['ch100', 1], ['ang50', 2], ['fb50', 1], ['lugs', 1], ['paint', 1]],
    labour: [['Cut & prep plate', 3], ['Body welding', 8], ['Lugs & reinforcing', 3], ['Grind, prime & paint', 2]],
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

export const STATUSES = ['Draft', 'Quote sent', 'Accepted', 'In workshop', 'Ready for collection', 'Invoiced', 'Paid', 'Declined']

export const n = (v) => {
  const x = parseFloat(v)
  return Number.isFinite(x) ? x : 0
}

export function ratesFrom(settings) {
  const { labour, consumables, overhead, vat, galv, validity, deposit } = settings
  return { labour: n(labour), consumables: n(consumables), overhead: n(overhead), vat: n(vat), galv: n(galv), validity: n(validity), deposit: n(deposit) }
}

export function matLine(price, qty = 1) {
  return { id: price.id, name: price.name, unit: price.unit, qty, cost: n(price.cost), kg: n(price.kg) }
}

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
  const cost = direct + overhead
  const markup = (cost * n(job.markup)) / 100
  const excl = cost + markup
  const vat = (excl * r.vat) / 100
  const total = excl + vat
  return {
    u, kg: kg * u, hours: hours * u,
    materials: materials * u, labour: labour * u, consumables: consumables * u, galv: galv * u, extras: extras * u,
    direct, overhead, cost, markup, excl, vat, total,
    margin: excl ? (markup / excl) * 100 : 0,
    deposit: (total * r.deposit) / 100,
  }
}

// Customer-facing lines: sell prices only, with overhead and markup spread
// across the lines in proportion to their cost. Lines always add up to excl.
export function customerLines(job) {
  const t = calc(job)
  const factor = t.direct ? t.excl / t.direct : 1
  const lines = [{ desc: `${job.title}: steel, hardware & fabrication`, qty: t.u, amount: (t.materials + t.labour + t.consumables) * factor }]
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
