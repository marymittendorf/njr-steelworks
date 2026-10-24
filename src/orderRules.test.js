import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextStep, stampsFor } from './orderRules.js'

test('customer job steps: start, ready, delivered, then nothing', () => {
  assert.deepEqual(nextStep({ status: 'Received', job_type: 'Customer job' }), ['In production', 'Start production'])
  assert.deepEqual(nextStep({ status: 'In production', job_type: 'Customer job' }), ['Ready', 'Mark ready'])
  assert.deepEqual(nextStep({ status: 'Ready', job_type: 'Customer job' }), ['Delivered', 'Mark delivered'])
  assert.equal(nextStep({ status: 'Delivered', job_type: 'Customer job' }), null)
  assert.equal(nextStep({ status: 'Quote sent', job_type: 'Customer job' }), null)
})

test('stock build ends at Ready (moves to stock), no delivery step', () => {
  assert.deepEqual(nextStep({ status: 'In production', job_type: 'Built for stock' }), ['Ready', 'Finished: move to stock'])
  assert.equal(nextStep({ status: 'Ready', job_type: 'Built for stock' }), null)
})

test('stamps fill the step and any skipped earlier steps, never overwrite', () => {
  const p = stampsFor({ accepted_at: '2026-10-01T08:00:00Z' }, 'Ready')
  assert.equal(p.accepted_at, undefined) // already set, kept
  assert.ok(p.production_started_at)     // skipped step filled
  assert.ok(p.ready_at)
  assert.equal(p.delivered_at, undefined)
})

test('quote stages get no stamps', () => {
  assert.deepEqual(stampsFor({}, 'Quote sent'), {})
  assert.deepEqual(stampsFor({}, 'Draft'), {})
})
