// Order tracker rules, modelled on the Forever Planks order book:
// a job moves Accepted → In workshop → Ready → Delivered, each step date-stamped,
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

// Move a job to a new stage, stamping the timeline. Returns the updated job.
export async function moveJob(job, status) {
  const patch = { status, ...stampsFor(job, status), updated_at: new Date().toISOString() }
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select().single()
  if (error) throw error
  await ensureStockItem(data)
  return data
}

