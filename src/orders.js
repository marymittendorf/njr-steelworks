// Order tracker rules, modelled on the Forever Planks order book:
// a job moves Received → In production → Ready → Delivered, each step date-stamped,
// with payment tracked separately. Stock builds go into Stock when they're ready.
import { supabase } from './supabase.js'
import { calc } from './costing.js'

export { ORDER_STAGES, PAYMENT_STATUSES, JOB_TYPES, isOrder, isStockBuild, nextStep, stampsFor, shortStamp } from './orderRules.js'
import { isStockBuild, stampsFor } from './orderRules.js'

// A finished stock build becomes a stock item (once; job_id is unique).
export async function ensureStockItem(job) {
  if (!isStockBuild(job) || !['Ready', 'Delivered'].includes(job.status) || !job.id) return
  const t = calc(job)
  await supabase.from('stock_items').upsert({
    job_id: job.id,
    title: job.title,
    description: job.notes || null,
    built_on: (job.ready_at || new Date().toISOString()).slice(0, 10),
    asking_price: Math.round(t.total / Math.max(1, t.u)),
  }, { onConflict: 'job_id', ignoreDuplicates: true })
}

const r2 = (v) => Math.round(v * 100) / 100

// An invoiced job stores its totals (what the customer owes). Call after any save that could
// change them; payments and payment status are then worked out by the database.
export async function syncInvoiceTotals(job) {
  if (!job?.id || !job.invoice_no || job.invoice_voided_at) return job
  const t = calc(job)
  const patch = { invoice_excl: r2(t.excl), invoice_vat: r2(t.vat), invoice_total: r2(t.total) }
  if (Number(job.invoice_total) === patch.invoice_total && Number(job.invoice_vat) === patch.invoice_vat) return job
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select().single()
  if (error) throw error
  return data
}

// Move a job to a new stage, stamping the timeline. Returns the updated job.
export async function moveJob(job, status) {
  const patch = { status, ...stampsFor(job, status), updated_at: new Date().toISOString() }
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select().single()
  if (error) throw error
  await ensureStockItem(data)
  return syncInvoiceTotals(data)
}

