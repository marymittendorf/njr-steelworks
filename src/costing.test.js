import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calc, customerLines, computeFromPrices, fromTemplate } from './costing.js'

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
