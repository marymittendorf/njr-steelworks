import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calc, customerLines, computeFromPrices, fromTemplate, productCost, productLine, suggestedPrice, marginAt } from './costing.js'

const rates = { labour: 300, consumables: 50, overhead: 10, vat: 15, galv: 20, validity: 14, deposit: 50 }

test('calc builds cost up step by step', () => {
  const job = {
    units: 1, galv: true, markup: 20, rates,
    mats: [{ qty: 2, cost: 500, kg: 10 }],
    labour: [{ hours: 4 }],
    extras: [{ amount: 100 }],
  }
  const t = calc(job)
  // materials 1000, galv 20kg*20=400, labour 1200, consumables 200, extras 100 = 2900
  assert.equal(t.direct, 2900)
  assert.equal(t.overhead, 290)
  assert.equal(t.cost, 3190)
  assert.equal(t.markup, 638)
  assert.equal(t.excl, 3828)
  assert.ok(Math.abs(t.vat - 574.2) < 1e-9)
  assert.ok(Math.abs(t.total - 4402.2) < 1e-9)
})

test('units multiply everything', () => {
  const base = { galv: false, markup: 20, rates, mats: [{ qty: 1, cost: 1000, kg: 0 }], labour: [{ hours: 2 }], extras: [] }
  const one = calc({ ...base, units: 1 })
  const three = calc({ ...base, units: 3 })
  assert.ok(Math.abs(three.total - one.total * 3) < 1e-9)
})

test('customer lines add up to the price excl. VAT', () => {
  const job = {
    title: 'Trailer', units: 2, galv: true, markup: 25, rates,
    mats: [{ qty: 3, cost: 400, kg: 12 }], labour: [{ hours: 5 }], extras: [{ desc: 'Delivery', amount: 650 }],
  }
  const sum = customerLines(job).reduce((a, l) => a + l.amount, 0)
  assert.ok(Math.abs(sum - calc(job).excl) < 1e-6)
})

test('templates skip items missing from the price list', () => {
  const t = fromTemplate('skiprep', [{ id: 'sh45', name: 'Plate', unit: 'sheet', cost: 3300, kg: 108 }])
  assert.equal(t.mats.length, 1)
})

test('from prices are rounded to R100', () => {
  const prices = [{ id: 'sh45', name: 'Plate', unit: 'sheet', cost: 3300, kg: 108 }]
  const fp = computeFromPrices({ ...rates, markup: 20 }, prices)
  for (const v of Object.values(fp)) assert.equal(v % 100, 0)
})

test('parts supplied by the client are listed but not charged', () => {
  const rates = { labour: 0, consumables: 0, overhead: 0, vat: 0, galv: 0, validity: 14, deposit: 50 }
  const base = { units: 1, galv: false, markup: 0, rates, labour: [], extras: [] }
  const ours = calc({ ...base, mats: [{ qty: 1, cost: 500, kg: 0 }] })
  const withClient = calc({ ...base, mats: [{ qty: 1, cost: 500, kg: 0 }, { qty: 1, cost: 300, kg: 0, supplied_by: 'Client' }] })
  assert.equal(withClient.total, ours.total)
})

test('products: priced at their own price, cost from parts and hours, options add on', () => {
  const rates = { labour: 300, consumables: 50, overhead: 10, vat: 15, galv: 0, validity: 14, deposit: 50 }
  const prices = [{ id: 'kit', name: 'Laser kit', unit: 'each', cost: 1000 }]
  const product = { id: 'p1', name: '2 m³ skip', mats: [{ id: 'kit', qty: 2 }], labour: [{ task: 'Weld', hours: 10 }], extras: [],
    price_incl: 11500, options: [{ name: 'Galvanised', price_incl: 2300, cost_excl: 1500 }] }
  const pc = productCost(product, prices, rates)
  assert.equal(pc.cost, (2000 + 3500) * 1.1)            // parts + hours (labour+consumables), + overhead
  assert.equal(suggestedPrice(pc.cost, 20, 15), 8350)   // 6050 × 1.2 × 1.15 = 8349 → next R10
  const line = productLine(product, prices, rates, ['Galvanised'], 2)
  assert.equal(line.price_incl, 13800); assert.equal(line.cost_excl, 7550); assert.equal(line.parts[0].qty, 2)
  const job = { units: 1, galv: false, markup: 20, rates, mats: [], labour: [], extras: [], products: [line] }
  const t = calc(job)
  assert.ok(Math.abs(t.total - 27600) < 1e-6)           // 2 × R13 800 incl. VAT
  assert.ok(Math.abs(t.cost - 15100) < 1e-6)
  assert.ok(Math.abs(customerLines(job).reduce((a, l) => a + l.amount, 0) - t.excl) < 1e-6)
  assert.equal(customerLines(job)[0].desc, '2 m³ skip (Galvanised)')
  assert.ok(Math.abs(marginAt(11500, 6050, 15) - ((10000 - 6050) / 10000) * 100) < 1e-9)
})

test('a quote mixing a product with costed extras adds up', () => {
  const rates = { labour: 300, consumables: 0, overhead: 0, vat: 15, galv: 0, validity: 14, deposit: 50 }
  const job = { units: 1, galv: false, markup: 0, rates, mats: [], labour: [], extras: [{ desc: 'Delivery', amount: 650 }],
    products: [{ name: 'Skip', qty: 1, price_incl: 1150, cost_excl: 700, options: [] }] }
  const t = calc(job)
  assert.ok(Math.abs(t.excl - (1000 + 650)) < 1e-6)
  assert.ok(Math.abs(customerLines(job).reduce((a, l) => a + l.amount, 0) - t.excl) < 1e-6)
})
