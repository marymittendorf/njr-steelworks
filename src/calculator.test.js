import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trailerJob, skipJob, gateJob, priceableJob } from './calculator.js'
import { TEMPLATES, calc } from './costing.js'

const qtyOf = (job, id) => job.mats.filter(([m]) => m === id).reduce((a, [, q]) => a + q, 0)
const hours = (job) => job.labour.reduce((a, l) => a + l.hours, 0)
const tpl = (key) => Object.fromEntries(TEMPLATES[key].mats)

test('3.0 × 1.5 m 1 m cage trailer lines up with the costing template', () => {
  const j = trailerJob({ length: 3, width: 1.5, cage: 1, axles: 1, finish: 'Painted' })
  const t = tpl('trailer')
  for (const id of ['sh2', 'mesh', 'sq40', 'ang40', 'axle', 'wheel', 'coupler', 'lights', 'paint']) {
    assert.ok(Math.abs(qtyOf(j, id) - t[id]) <= 1, `${id}: recipe ${qtyOf(j, id)} vs template ${t[id]}`)
  }
  const tplHours = TEMPLATES.trailer.labour.reduce((a, [, h]) => a + h, 0)
  assert.ok(Math.abs(hours(j) - tplHours) <= 3, `hours ${hours(j)} vs template ${tplHours}`)
})

test('bigger trailers cost more; double axle adds running gear', () => {
  const small = trailerJob({ length: 1.8, width: 1.2 })
  const big = trailerJob({ length: 4, width: 1.8, axles: 2 })
  assert.ok(qtyOf(big, 'sq50') > qtyOf(small, 'sq50'))
  assert.equal(qtyOf(big, 'wheel'), 4)
  assert.equal(qtyOf(big, 'axle'), 2)
  assert.ok(hours(big) > hours(small))
})

test('galvanised trailer has no paint; lid only with a cage', () => {
  assert.equal(qtyOf(trailerJob({ finish: 'Galvanised' }), 'paint'), 0)
  assert.equal(trailerJob({ cage: 0, lid: true }).labour.some((l) => l.task.startsWith('Lid')), false)
})

test('new skips use the same quantities as the templates', () => {
  assert.deepEqual(skipJob({ size: 2 }).mats, TEMPLATES.skip.mats)
  assert.deepEqual(skipJob({ size: 3 }).mats, TEMPLATES.skip3.mats)
  assert.equal(skipJob({ size: 3, units: 4 }).units, 4)
})

test('gates: wide swing gate gets two leaves; sliding gets the track kit', () => {
  const swing = gateJob({ width: 4, height: 1.8, type: 'Swing' })
  assert.equal(qtyOf(swing, 'gate_hinge'), 2)
  assert.equal(qtyOf(gateJob({ width: 4, type: 'Sliding' }), 'gate_slide'), 1)
  assert.ok(qtyOf(swing, 'sq20') > 0)
})

test('odd inputs are clamped to sensible values', () => {
  const g = gateJob({ width: 99, height: -2 })
  assert.match(g.title, /8\.0 × 1\.2 m/)
  assert.match(trailerJob({ length: 'x' }).title, /^3\.0 × 1\.5 m/)
})

test('priceable job prices through calc and reports missing items', () => {
  const prices = [{ id: 'sq50', name: 'Sq 50', unit: '6 m', cost: 520, kg: 17.6 }]
  const rates = { labour: 320, consumables: 45, overhead: 10, vat: 15, galv: 22, validity: 14, deposit: 50 }
  const j = priceableJob('gate', { width: 3 }, prices, rates, 20)
  assert.ok(j.missing.includes('gate_hinge'))
  assert.ok(calc(j).total > 0)
})
