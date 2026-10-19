// Instant price calculator (no AI, no running cost).
// The website sends the customer's choices (trailer / skip / gate options); this prices them
// with NJR's own price list and rates and returns only a price range, so cost prices and
// markup never reach the browser. With save=true it also files the request for staff.
// costing.js and calculator.js are copies of src/ (npm run sync-functions).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { calc, ratesFrom } from './costing.js'
import { priceableJob } from './calculator.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const REQUEST_TYPE: Record<string, (o: Record<string, unknown>) => string> = {
  trailer: () => 'New trailer',
  skip: (o) => (o.work && o.work !== 'New build' ? 'Skip repair' : 'New skip'),
  gate: () => 'Custom fabrication',
}
const r100 = (v: number) => Math.round(v / 100) * 100

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const kind = String(b.kind || '')
  if (!REQUEST_TYPE[kind]) return json({ error: 'Choose a trailer, skip or gate.' }, 400)
  const options = (b.options && typeof b.options === 'object' ? b.options : {}) as Record<string, unknown>

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const [{ data: s }, { data: prices }] = await Promise.all([
    db.from('settings').select('*').eq('id', 1).single(),
    db.from('prices').select('id,name,unit,cost,kg').eq('active', true),
  ])
  if (!s || !prices) return json({ error: 'Prices are not available right now. Send a quote request instead.' }, 503)

  const job = priceableJob(kind, options, prices, ratesFrom(s), Number(s.markup))
  const t = calc(job)
  if (!(t.total > 0)) return json({ error: 'We couldn\'t price that combination. Send a quote request instead.' }, 422)
  const low = r100(t.total * 0.95)
  const high = r100(t.total * 1.1)

  let saved = false
  if (b.save) {
    const name = String(b.name || '').trim().slice(0, 120)
    const phone = String(b.phone || '').trim().slice(0, 30)
    const email = String(b.email || '').trim().slice(0, 200) || null
    const note = String(b.note || '').trim().slice(0, 1000)
    if (!name || phone.replace(/\D/g, '').length < 9) return json({ error: 'Add your name and a cell number so we can confirm the price with you.' }, 400)
    const { error } = await db.from('requests').insert({
      name, phone, email, type: REQUEST_TYPE[kind](options),
      detail: `${job.title}${job.units > 1 ? ` × ${job.units}` : ''}${note ? `\n\n${note}` : ''}`,
      timing: 'Instant calculator', status: 'New', source: 'Calculator',
      ai_estimate: {
        title: job.title, units: job.units, galv: job.galv, mats: job.mats,
        labour: job.labour, extras: job.extras, total: Math.round(t.total), low, high,
        assumptions: job.assumptions, questions: [], confidence: 'calculator', options,
      },
    })
    if (error) return json({ error: 'We couldn\'t send that through. Please try again, or call us.' }, 500)
    saved = true
  }

  return json({ ok: true, title: job.title, units: job.units, low, high, assumptions: job.assumptions, saved })
})
