import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, fromTemplate, matLine, n, ratesFrom, STATUSES, TEMPLATES } from '../costing.js'
import { money, money0 } from '../format.js'
import { Loading, ErrorNote } from './ui.jsx'
import QuoteDoc from './QuoteDoc.jsx'
import { JOB_TYPES, PAYMENT_STATUSES, ensureStockItem, stampsFor } from '../orders.js'

const JOB_FIELDS = ['quote_date', 'customer', 'phone', 'email', 'title', 'units', 'galv', 'markup', 'status', 'job_type', 'payment_status', 'notes', 'request_id', 'mats', 'labour', 'extras', 'rates']

function blankJob(settings, prices) {
  return {
    ...fromTemplate('trailer', prices),
    customer: '', phone: '', email: '', notes: '', units: 1, galv: false,
    markup: settings.markup, status: 'Draft', request_id: null, rates: ratesFrom(settings),
  }
}

export default function JobCosting({ target, settings, prices, toast, go }) {
  const active = prices.filter((p) => p.active)
  const [job, setJob] = useState(() => target?.jobId ? null : (target?.draft || blankJob(settings, active)))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showDoc, setShowDoc] = useState(false)

  useEffect(() => {
    if (!target?.jobId) return
    supabase.from('jobs').select('*').eq('id', target.jobId).single()
      .then(({ data, error }) => { if (error) setError(error); else setJob(data) })
  }, [target?.jobId])

  if (!job) return error ? <ErrorNote error={error} /> : <Loading />

  const t = calc(job)
  const r = job.rates
  const upd = (patch) => setJob((j) => ({ ...j, ...patch }))
  const updRow = (list, i, patch) => setJob((j) => ({ ...j, [list]: j[list].map((row, k) => (k === i ? { ...row, ...patch } : row)) }))
  const delRow = (list, i) => setJob((j) => ({ ...j, [list]: j[list].filter((_, k) => k !== i) }))
  const addRow = (list, row) => setJob((j) => ({ ...j, [list]: [...j[list], row] }))
  const priceById = Object.fromEntries(prices.map((p) => [p.id, p]))

  // Prices or rates differ from what this quote was costed at?
  const stale = job.mats.some((m) => priceById[m.id] && n(priceById[m.id].cost) !== n(m.cost)) ||
    Object.entries(ratesFrom(settings)).some(([k, v]) => n(r[k]) !== v)

  function refreshPrices() {
    setJob((j) => ({
      ...j,
      rates: ratesFrom(settings),
      mats: j.mats.map((m) => (priceById[m.id] ? { ...matLine(priceById[m.id], m.qty) } : m)),
    }))
    toast('Updated to current prices and rates')
  }

  async function save() {
    if (!job.customer.trim()) { setError('Add the customer name before saving.'); return null }
    if (!job.title.trim()) { setError('Add a job description before saving.'); return null }
    setBusy(true); setError(null)
    const payload = Object.fromEntries(JOB_FIELDS.filter((k) => k in job).map((k) => [k, job[k]]))
    payload.units = Math.max(1, Math.round(n(payload.units)) || 1)
    payload.markup = n(payload.markup)
    payload.mats = payload.mats.map((m) => ({ ...m, qty: n(m.qty), cost: n(m.cost) }))
    payload.labour = payload.labour.map((l) => ({ ...l, hours: n(l.hours) }))
    payload.extras = payload.extras.map((x) => ({ ...x, amount: n(x.amount) }))
    Object.assign(payload, stampsFor(job, payload.status)) // date-stamp the order timeline
    let res
    if (job.id) res = await supabase.from('jobs').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', job.id).select().single()
    else res = await supabase.from('jobs').insert(payload).select().single()
    setBusy(false)
    if (res.error) { setError(res.error); return null }
    if (!job.id && job.request_id) await supabase.from('requests').update({ status: 'Quoted' }).eq('id', job.request_id)
    await ensureStockItem(res.data)
    setJob(res.data)
    toast('Saved ' + res.data.quote_no)
    return res.data
  }

  async function openDoc() {
    const saved = await save()
    if (saved) setShowDoc(true)
  }

  const marginColour = t.margin < 12 ? 'var(--bad)' : t.margin < 18 ? 'var(--warn)' : 'var(--good)'

  return (
    <>
      <div className="pagehead">
        <div><h1>Job costing</h1><p>{job.quote_no || 'New quote, not saved yet'}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="Load a template" value="" onChange={(e) => { if (e.target.value) { upd(fromTemplate(e.target.value, active)); toast('Template loaded') } }}>
            <option value="">Load a template…</option>
            {Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
          </select>
          <button className="btn small" type="button" onClick={() => go('cost', null)}>New costing</button>
        </div>
      </div>

      {stale && (
        <div className="card block" style={{ borderColor: 'var(--warn)' }}>
          <div className="block-head">
            <span>This quote uses older steel prices or rates than your current settings.</span>
            <button className="btn small" type="button" onClick={refreshPrices}>Use current prices</button>
          </div>
        </div>
      )}

      <div className="cost-layout">
        <div>
          <div className="card block"><div className="fgrid">
            <div className="field"><label htmlFor="c-cust">Customer</label><input id="c-cust" value={job.customer} onChange={(e) => upd({ customer: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-phone">Cell</label><input id="c-phone" value={job.phone || ''} onChange={(e) => upd({ phone: e.target.value })} /></div>
            <div className="field full"><label htmlFor="c-title">Job description (shown on quote)</label><input id="c-title" value={job.title} onChange={(e) => upd({ title: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-units">Number of identical units</label><input id="c-units" type="number" min="1" step="1" value={job.units} onChange={(e) => upd({ units: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-status">Stage</label>
              <select id="c-status" value={job.status} onChange={(e) => upd({ status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              <span className="hint">Accepted or later shows the job under Orders</span></div>
            <div className="field"><label htmlFor="c-type">Job type</label>
              <select id="c-type" value={job.job_type || 'Customer job'} onChange={(e) => upd({ job_type: e.target.value })}>{JOB_TYPES.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="field"><label htmlFor="c-pay">Payment</label>
              <select id="c-pay" value={job.payment_status || 'Awaiting deposit'} onChange={(e) => upd({ payment_status: e.target.value })}>{PAYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="field"><label htmlFor="c-markup">Markup on cost (%)</label><input id="c-markup" type="number" step="0.5" value={job.markup} onChange={(e) => upd({ markup: e.target.value })} /></div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label className="check" htmlFor="c-galv"><input id="c-galv" type="checkbox" checked={job.galv} onChange={(e) => upd({ galv: e.target.checked })} /> Hot-dip galvanise (R{r.galv}/kg)</label></div>
            <div className="field full"><label htmlFor="c-notes">Notes (internal)</label><textarea id="c-notes" style={{ minHeight: 70 }} value={job.notes || ''} onChange={(e) => upd({ notes: e.target.value })} /></div>
          </div></div>

          <div className="block">
            <div className="block-head"><h3>Steel &amp; hardware</h3>
              <button className="btn small" type="button" disabled={!active.length} onClick={() => addRow('mats', matLine(active[0]))}>Add material</button></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Unit cost</th><th className="r">Line</th><th></th></tr></thead>
              <tbody>
                {job.mats.map((m, i) => (
                  <tr key={i}>
                    <td>
                      <select aria-label="Material" value={m.id} onChange={(e) => updRow('mats', i, matLine(priceById[e.target.value], m.qty))}>
                        {!priceById[m.id] && <option value={m.id}>{m.name}</option>}
                        {prices.filter((p) => p.active || p.id === m.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <div className="hint" style={{ fontSize: '.8rem' }}>{m.unit} · {m.kg} kg</div>
                    </td>
                    <td className="r"><input className="qty num" aria-label="Quantity" type="number" min="0" step="0.5" value={m.qty} onChange={(e) => updRow('mats', i, { qty: e.target.value })} /></td>
                    <td className="r"><input className="money num" aria-label="Unit cost" type="number" min="0" step="10" value={m.cost} onChange={(e) => updRow('mats', i, { cost: e.target.value })} /></td>
                    <td className="r num">{money(n(m.qty) * n(m.cost))}</td>
                    <td><button className="x" type="button" aria-label={`Remove ${m.name}`} onClick={() => delRow('mats', i)}>×</button></td>
                  </tr>
                ))}
                {!job.mats.length && <tr><td colSpan="5" className="hint">No materials yet.</td></tr>}
              </tbody>
            </table></div>
          </div>

          <div className="block">
            <div className="block-head"><h3>Labour</h3><button className="btn small" type="button" onClick={() => addRow('labour', { task: 'New task', hours: 1 })}>Add task</button></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Task</th><th className="r">Hours</th><th className="r">Labour + consumables</th><th></th></tr></thead>
              <tbody>
                {job.labour.map((l, i) => (
                  <tr key={i}>
                    <td><input aria-label="Task" value={l.task} onChange={(e) => updRow('labour', i, { task: e.target.value })} /></td>
                    <td className="r"><input className="qty num" aria-label="Hours" type="number" min="0" step="0.5" value={l.hours} onChange={(e) => updRow('labour', i, { hours: e.target.value })} /></td>
                    <td className="r num">{money(n(l.hours) * (r.labour + r.consumables))}</td>
                    <td><button className="x" type="button" aria-label={`Remove ${l.task}`} onClick={() => delRow('labour', i)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="hint">R{r.labour}/h labour + R{r.consumables}/h welding wire, gas, discs and electricity.</p>
          </div>

          <div className="block">
            <div className="block-head"><h3>Outsourced &amp; extras</h3><button className="btn small" type="button" onClick={() => addRow('extras', { desc: 'Delivery', amount: 650 })}>Add extra</button></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Description</th><th className="r">Cost</th><th></th></tr></thead>
              <tbody>
                {job.extras.map((x, i) => (
                  <tr key={i}>
                    <td><input aria-label="Description" value={x.desc} onChange={(e) => updRow('extras', i, { desc: e.target.value })} /></td>
                    <td className="r"><input className="money num" aria-label="Cost" type="number" min="0" step="50" value={x.amount} onChange={(e) => updRow('extras', i, { amount: e.target.value })} /></td>
                    <td><button className="x" type="button" aria-label={`Remove ${x.desc}`} onClick={() => delRow('extras', i)}>×</button></td>
                  </tr>
                ))}
                {!job.extras.length && <tr><td colSpan="3" className="hint">Delivery, laser cutting, roadworthy, licensing…</td></tr>}
              </tbody>
            </table></div>
          </div>
        </div>

        <aside className="sheet">
          <h3>Cost sheet</h3>
          <dl>
            <dt>Steel &amp; hardware <span className="hint">({t.kg.toFixed(0)} kg)</span></dt><dd>{money(t.materials)}</dd>
            {t.galv > 0 && <><dt>Galvanising</dt><dd>{money(t.galv)}</dd></>}
            <dt>Labour <span className="hint">({t.hours.toFixed(1)} h)</span></dt><dd>{money(t.labour)}</dd>
            <dt>Consumables</dt><dd>{money(t.consumables)}</dd>
            {t.extras > 0 && <><dt>Extras</dt><dd>{money(t.extras)}</dd></>}
            <dt>Workshop overhead {r.overhead}%</dt><dd>{money(t.overhead)}</dd>
            <div className="rule" />
            <dt><b>Total cost</b></dt><dd><b>{money(t.cost)}</b></dd>
            <dt>Markup {n(job.markup)}%</dt><dd>{money(t.markup)}</dd>
            <dt>Price excl. VAT</dt><dd>{money(t.excl)}</dd>
            <dt>VAT {r.vat}%</dt><dd>{money(t.vat)}</dd>
          </dl>
          <div className="tot"><span className="label" style={{ color: 'var(--accent-ink)' }}>Quote total</span><b className="num">{money(t.total)}</b></div>
          <div className="row"><span>Gross margin <b className="num" style={{ color: marginColour }}>{t.margin.toFixed(1)}%</b></span><span>Deposit {r.deposit}%: <b className="num">{money0(t.deposit)}</b></span></div>
          {t.u > 1 && <div className="row"><span>Per unit</span><b className="num">{money(t.total / t.u)}</b></div>}
          <div className="acts">
            <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save quote'}</button>
            <button className="btn" type="button" disabled={busy} onClick={openDoc}>Customer {['Invoiced', 'Paid'].includes(job.payment_status) ? 'invoice' : 'quote'}</button>
          </div>
          {error && <div style={{ padding: '0 18px 14px' }}><ErrorNote error={error} /></div>}
        </aside>
      </div>

      {showDoc && <QuoteDoc job={job} settings={settings} onClose={() => setShowDoc(false)} />}
    </>
  )
}
