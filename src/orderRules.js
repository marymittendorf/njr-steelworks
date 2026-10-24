// Pure order-tracker rules (no database), so they can be unit tested.
// Modelled on the Forever Planks order book: Received → In production → Ready → Delivered.

export const ORDER_STAGES = ['Received', 'In production', 'Ready', 'Delivered']
export const PAYMENT_STATUSES = ['Awaiting deposit', 'Deposit paid', 'Paid']
export const JOB_TYPES = ['Customer job', 'Built for stock']
export const isOrder = (job) => ORDER_STAGES.includes(job.status)
export const isStockBuild = (job) => job.job_type === 'Built for stock'

// The one-click button shown next to each stage: [next stage, button text].
export function nextStep(job) {
  if (job.status === 'Received') return ['In production', 'Start production']
  if (job.status === 'In production') return ['Ready', isStockBuild(job) ? 'Finished: move to stock' : 'Mark ready']
  if (job.status === 'Ready' && !isStockBuild(job)) return ['Delivered', 'Mark delivered']
  return null
}

const STAMP_FOR = { Received: 'accepted_at', 'In production': 'production_started_at', Ready: 'ready_at', Delivered: 'delivered_at' }

// Date stamps for moving to `status`: fills that step (and any skipped earlier ones) if empty.
export function stampsFor(job, status) {
  const now = new Date().toISOString()
  const patch = {}
  const upTo = ORDER_STAGES.indexOf(status)
  ORDER_STAGES.forEach((stage, i) => {
    const col = STAMP_FOR[stage]
    if (i <= upTo && !job[col]) patch[col] = now
  })
  return patch
}

export const shortStamp = (iso) => (iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—')
