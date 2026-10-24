import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, customPart, fromTemplate, matLine, n, productLine, ratesFrom, STATUSES, TEMPLATES } from '../costing.js'
import { money, money0 } from '../format.js'
import { Loading, ErrorNote } from './ui.jsx'
import QuoteDoc from './QuoteDoc.jsx'
import JobFile from './JobFile.jsx'
import { JOB_TYPES, ensureStockItem, stampsFor, syncInvoiceTotals } from '../orders.js'

export const CATEGORIES = ['Skips', 'Trailers', 'Gates', 'Fabrication', 'Welding', 'Other']

const JOB_FIELDS = ['quote_date', 'customer', 'phone', 'email', 'title', 'units', 'galv', 'markup', 'status', 'job_type', 'category', 'notes', 'request_id', 'mats', 'labour', 'extras', 'products', 'rates']

function blankJob(settings, prices) {
  return {
    // Starts empty: add products, or load a template for a one-off job.
    title: '', category: null, mats: [], labour: [], extras: [], products: [],
    customer: '', phone: '', email: '', notes: '', units: 1, galv: false,
    markup: settings.markup, status: 'Draft', request_id: null, rates: ratesFrom(settings),
  }
}

export default function JobCosting({ target, settings, prices, toast, go, me }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [showPhotos, setShowPhotos] = useState(false)
  const [catalogue, setCatalogue] = useState([])
  const settingsRates = ratesFrom(settings)
  const [adding, setAdding] = useState(null) // { id, qty, chosen: [] }
  const [customers, setCustomers] = useState([]) // past customers, newest first, for the Customer list
  const [costOpen, setCostOpen] = useState(null) // null = open only when the quote has no products
  useEffect(() => {
    supabase.from('jobs').select('customer,phone,email').order('created_at', { ascending: false }).limit(1000).then(({ data }) => {
      const seen = new Map()
      for (const c of data || []) { const k = (c.customer || '').trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, c) }
      setCustomers([...seen.values()])
    })
  }, [])
  useEffect(() => { supabase.from('products').select('*').eq('active', true).order('category').order('name').then(({ data }) => setCatalogue(data || [])) }, [])
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
  const updRow = (list, i, patch) => setJob((j) => ({ ...j, [list]: (j[list] || []).map((row, k) => (k === i ? { ...row, ...patch } : row)) }))
  const delRow = (list, i) => setJob((j) => ({ ...j, [list]: (j[list] || []).filter((_, k) => k !== i) }))
  const addRow = (list, row) => setJob((j) => ({ ...j, [list]: [...(j[list] || []), row] }))
  const priceById = Object.fromEntries(prices.map((p) => [p.id, p]))

  // Prices or rates differ from what this quote was costed at?
  const stale = job.mats.some((m) => priceById[m.id] && n(priceById[m.id].cost) !== n(m.cost)) ||
    Object.entries(ratesFrom(settings)).some(([k, v]) => n(r[k]) !== v)

  // Picking a past customer fills in their cell and email (only where still empty).
  function pickCustomer(name) {
    const c = customers.find((x) => x.customer.trim().toLowerCase() === name.trim().toLowerCase())
    upd(c ? { customer: name, phone: job.phone || c.phone || '', email: job.email || c.email || '' } : { customer: name })
  }

  function refreshPrices() {
    setJob((j) => ({
      ...j,
      rates: ratesFrom(settings),
      mats: j.mats.map((m) => (priceById[m.id] ? { ...matLine(priceById[m.id], m.qty), supplied_by: m.supplied_by || 'NJR', have: m.have || false } : m)),
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
    payload.products = (job.products || []).map((x) => ({ ...x, qty: n(x.qty), price_incl: n(x.price_incl) }))
    Object.assign(payload, stampsFor(job, payload.status)) // date-stamp the order timeline
    let res
    if (job.id) res = await supabase.from('jobs').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', job.id).select().single()
    else res = await supabase.from('jobs').insert(payload).select().single()
    setBusy(false)
    if (res.error) { setError(res.error); return null }
    if (!job.id && job.request_id) await supabase.from('requests').update({ status: 'Quoted' }).eq('id', job.request_id)
    await ensureStockItem(res.data)
    res.data = await syncInvoiceTotals(res.data)
    setJob(res.data)
    toast(!job.invoice_no && res.data.invoice_no ? `Received: invoice ${res.data.invoice_no} issued` : 'Saved ' + res.data.quote_no)
    return res.data
  }

  async function deleteJob() {
    const { error } = await supabase.from('jobs').delete().eq('id', job.id)
    if (error) { setError(error); return }
    toast(`Deleted ${job.quote_no}`); go('jobs')
  }

  async function openDoc() {
    const saved = await save()
    if (saved) setShowDoc(true)
  }

  const marginColour = t.margin < 12 ? 'var(--bad)' : t.margin < 18 ? 'var(--warn)' : 'var(--good)'

  return (
    <>
      <div className="pagehead">
        <div><h1>Quote</h1><p>{job.quote_no || 'New quote, not saved yet'}{job.invoice_no && ` · Invoice ${job.invoice_no}`}
          {job.source_pdf_path && <> · <button className="linkbtn" type="button" onClick={async () => { const { data } = await supabase.storage.from('job-docs').createSignedUrl(job.source_pdf_path, 300); if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener') }}>Original PDF quote</button></>}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn small" type="button" onClick={() => go('cost', null)}>New quote</button>
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
            <div className="field"><label htmlFor="c-cust">Customer</label><input id="c-cust" list="c-cust-list" autoComplete="off" value={job.customer} onChange={(e) => pickCustomer(e.target.value)} placeholder="Type to pick a past customer" />
              <datalist id="c-cust-list">{customers.map((c) => <option key={c.customer} value={c.customer}>{c.phone || ''}</option>)}</datalist></div>
            <div className="field"><label htmlFor="c-phone">Cell</label><input id="c-phone" value={job.phone || ''} onChange={(e) => upd({ phone: e.target.value })} /></div>
            <div className="field full"><label htmlFor="c-email">Customer email</label><input id="c-email" type="email" value={job.email || ''} onChange={(e) => upd({ email: e.target.value })} placeholder="For emailing the quote and invoice" /></div>
            <div className="field full"><label htmlFor="c-title">Job description (shown on quote)</label><input id="c-title" value={job.title} onChange={(e) => upd({ title: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-cat">Type</label>
              <select id="c-cat" value={job.category || ''} onChange={(e) => upd({ category: e.target.value || null })}>
                <option value="">Choose…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
              <span className="hint">For the monthly profit report</span></div>
            <div className="field"><label htmlFor="c-status">Stage</label>
              <select id="c-status" value={job.status} onChange={(e) => upd({ status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              <span className="hint">Received or later shows the job under Orders</span></div>
            <div className="field"><label htmlFor="c-type">Job type</label>
              <select id="c-type" value={job.job_type || 'Customer job'} onChange={(e) => upd({ job_type: e.target.value })}>{JOB_TYPES.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="field"><span className="flabel">Payment</span>
              {job.invoice_no
                ? <span>{job.invoice_voided_at ? 'Invoice void' : `${job.payment_status} · paid ${money0(job.amount_paid || 0)} of ${money0(job.invoice_total || 0)}`}
                    {' '}<button className="linkbtn" type="button" onClick={() => go('invoices', { jobId: job.id })}>Payments</button></span>
                : <span className="hint">Payments start once the quote is accepted (stage Received) and becomes an invoice.</span>}</div>
            <div className="field full"><label htmlFor="c-notes">Notes (internal)</label><textarea id="c-notes" style={{ minHeight: 70 }} value={job.notes || ''} onChange={(e) => upd({ notes: e.target.value })} /></div>
          </div></div>

          <div className="block">
            <div className="block-head"><h3>On the quote</h3>
              {!adding && <button className="btn small primary" type="button" disabled={!catalogue.length} onClick={() => setAdding({ id: catalogue[0]?.id, qty: 1, chosen: [] })}>Add product</button>}</div>
            {!catalogue.length && <p className="hint" style={{ marginTop: 0 }}>No products set up yet. Set them up under Products (e.g. "2 m³ skip"), then add them here in one click.</p>}
            {adding && (() => {
              const prod = catalogue.find((x) => x.id === adding.id)
              return (
                <div className="sugg" style={{ borderTop: 0 }}>
                  <select aria-label="Product" value={adding.id} onChange={(e) => setAdding({ id: e.target.value, qty: adding.qty, chosen: [] })} style={{ flex: 1, minWidth: 200 }}>
                    {catalogue.map((x) => <option key={x.id} value={x.id}>{x.name}{x.price_incl ? ` · ${money0(x.price_incl)}` : ' · no price yet'}</option>)}
                  </select>
                  <input className="qty num" aria-label="How many" type="number" min="1" step="1" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value })} />
                  {(prod?.options || []).map((o) => (
                    <label key={o.name} className="check"><input type="checkbox" checked={adding.chosen.includes(o.name)} onChange={(e) => setAdding({ ...adding, chosen: e.target.checked ? [...adding.chosen, o.name] : adding.chosen.filter((c) => c !== o.name) })} /> {o.name} (+{money0(o.price_incl)})</label>
                  ))}
                  <button className="btn small primary" type="button" disabled={!prod} onClick={() => { addRow('products', productLine(prod, prices, settingsRates, adding.chosen, Math.max(1, n(adding.qty)))); upd({ ...(job.title ? {} : { title: prod.name }), ...(job.category ? {} : { category: prod.category }) }); setAdding(null) }}>Add</button>
                  <button className="btn small ghost" type="button" onClick={() => setAdding(null)}>Cancel</button>
                </div>)
            })()}
            {(job.products || []).length > 0 && <div className="tbl-wrap"><table>
              <thead><tr><th>Product</th><th className="r">Qty</th><th className="r">Price each incl. VAT</th><th className="r">Costs you each</th><th className="r">Line incl. VAT</th><th /></tr></thead>
              <tbody>{job.products.map((pl, i) => (
                <tr key={i}>
                  <td><b>{pl.name}</b>{pl.options?.length > 0 && <div className="hint">{pl.options.join(', ')}</div>}</td>
                  <td className="r"><input className="qty num" aria-label="Quantity" type="number" min="1" step="1" value={pl.qty} onChange={(e) => updRow('products', i, { qty: e.target.value })} /></td>
                  <td className="r"><input className="money num" aria-label="Price each" type="number" min="0" step="10" value={pl.price_incl} onChange={(e) => updRow('products', i, { price_incl: e.target.value })} /></td>
                  <td className="r num hint">{money(pl.cost_excl)}</td>
                  <td className="r num">{money(n(pl.qty) * n(pl.price_incl))}</td>
                  <td><button className="x" type="button" aria-label={`Remove ${pl.name}`} onClick={() => delRow('products', i)}>×</button></td>
                </tr>))}</tbody>
            </table></div>}
            {(job.products || []).length > 0 && <p className="hint">The customer sees one line per product. You can change the price for this quote; the product's own price stays the same.</p>}
            {!(job.products || []).length && <p className="hint">Add the finished items (e.g. 1 × 2 m³ skip). For a one-off job, cost it part by part under Costing below.</p>}
          </div>

          <details className="costing" open={costOpen ?? !(job.products || []).length} onToggle={(e) => setCostOpen(e.currentTarget.open)}>
            <summary><h3 style={{ display: 'inline' }}>Costing</h3> <span className="hint">· staff only: one-off parts, labour and extras{t.costedExcl > 0 ? ` · ${money0(t.costedExcl * (1 + r.vat / 100))} incl. VAT` : ''}</span></summary>
          <div className="card block"><div className="fgrid">
            <div className="field full"><label htmlFor="c-tpl">Start from a template</label>
              <select id="c-tpl" value="" onChange={(e) => { if (e.target.value) { const tp = fromTemplate(e.target.value, active); upd({ mats: tp.mats, labour: tp.labour, extras: tp.extras, ...(job.title ? {} : { title: tp.title }) }); toast('Template loaded') } }}>
                <option value="">Load a template…</option>
                {Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
              </select></div>
            <div className="field"><label htmlFor="c-units">Number of identical units</label><input id="c-units" type="number" min="1" step="1" value={job.units} onChange={(e) => upd({ units: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-markup">Markup on cost (%)</label><input id="c-markup" type="number" step="0.5" value={job.markup} onChange={(e) => upd({ markup: e.target.value })} /></div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label className="check" htmlFor="c-galv"><input id="c-galv" type="checkbox" checked={job.galv} onChange={(e) => upd({ galv: e.target.checked })} /> Hot-dip galvanise (R{r.galv}/kg)</label></div>
          </div></div>

          <div className="block">
            <div className="block-head"><h3>Parts &amp; materials</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn small" type="button" disabled={!active.length} onClick={() => addRow('mats', matLine(active[0]))}>Add from price list</button>
                <button className="btn small" type="button" onClick={() => addRow('mats', customPart())}>Add other part</button>
                <button className="btn small" type="button" onClick={() => addRow('mats', customPart('', 'Client'))}>Client supplies a part</button>
              </div></div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Part</th><th className="r">Qty</th><th className="r">Unit cost</th><th className="r">Line</th><th>Supplied by</th><th>Have it</th><th></th></tr></thead>
              <tbody>
                {job.mats.map((m, i) => {
                  const client = m.supplied_by === 'Client'
                  return (
                  <tr key={i} className={client ? 'client-part' : ''}>
                    <td>
                      {m.custom || !priceById[m.id] && m.id?.startsWith('custom-')
                        ? <input aria-label="Part name" value={m.name} onChange={(e) => updRow('mats', i, { name: e.target.value })} placeholder={client ? 'e.g. towing hitch ball, brake cable' : 'Part name'} />
                        : <select aria-label="Material" value={m.id} onChange={(e) => updRow('mats', i, { ...matLine(priceById[e.target.value], m.qty), supplied_by: m.supplied_by || 'NJR', have: m.have || false })}>
                            {!priceById[m.id] && <option value={m.id}>{m.name}</option>}
                            {prices.filter((p) => p.active || p.id === m.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>}
                      {!m.custom && <div className="hint" style={{ fontSize: '.8rem' }}>{m.unit}{Number(m.kg) ? ` · ${m.kg} kg` : ''}</div>}
                    </td>
                    <td className="r"><input className="qty num" aria-label="Quantity" type="number" min="0" step="0.5" value={m.qty} onChange={(e) => updRow('mats', i, { qty: e.target.value })} /></td>
                    <td className="r">{client ? <span className="hint">not charged</span>
                      : <input className="money num" aria-label="Unit cost" type="number" min="0" step="0.01" value={m.cost} onChange={(e) => updRow('mats', i, { cost: e.target.value })} />}</td>
                    <td className="r num">{client ? '—' : money(n(m.qty) * n(m.cost))}</td>
                    <td><select aria-label="Supplied by" value={m.supplied_by || 'NJR'} onChange={(e) => updRow('mats', i, { supplied_by: e.target.value })} style={{ width: 'auto' }}>
                      <option value="NJR">NJR</option><option value="Client">Client</option></select></td>
                    <td><label className="check"><input type="checkbox" checked={Boolean(m.have)} onChange={(e) => updRow('mats', i, { have: e.target.checked })} aria-label={`Have ${m.name}`} /> {m.have ? 'Yes' : 'No'}</label></td>
                    <td><button className="x" type="button" aria-label={`Remove ${m.name}`} onClick={() => delRow('mats', i)}>×</button></td>
                  </tr>)
                })}
                {!job.mats.length && <tr><td colSpan="7" className="hint">No parts yet.</td></tr>}
              </tbody>
            </table></div>
            {job.mats.length > 0 && <p className="hint">Have {job.mats.filter((m) => m.have).length} of {job.mats.length} parts{job.mats.some((m) => m.supplied_by === 'Client') ? ` · ${job.mats.filter((m) => m.supplied_by === 'Client').length} supplied by the client (not charged, listed on the quote)` : ''}.</p>}
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
          </details>
        </div>

        <aside className="sheet">
          <h3>Cost sheet</h3>
          <dl>
            {t.productsExcl > 0 && <><dt>Products (sold excl. VAT)</dt><dd>{money(t.productsExcl)}</dd><dt className="hint">Products cost you</dt><dd className="hint">{money(t.productsCost)}</dd></>}
            <dt>Steel &amp; hardware <span className="hint">({t.kg.toFixed(0)} kg)</span></dt><dd>{money(t.materials)}</dd>
            {t.galv > 0 && <><dt>Galvanising</dt><dd>{money(t.galv)}</dd></>}
            <dt>Labour <span className="hint">({t.hours.toFixed(1)} h)</span></dt><dd>{money(t.labour)}</dd>
            <dt>Consumables</dt><dd>{money(t.consumables)}</dd>
            {t.extras > 0 && <><dt>Extras</dt><dd>{money(t.extras)}</dd></>}
            <dt>Workshop overhead {r.overhead}%</dt><dd>{money(t.overhead)}</dd>
            <div className="rule" />
            <dt><b>Total cost</b></dt><dd><b>{money(t.cost)}</b></dd>
            <dt>Profit{t.productsExcl > 0 ? '' : ` (markup ${n(job.markup)}%)`}</dt><dd>{money(t.markup)}</dd>
            <dt>Price excl. VAT</dt><dd>{money(t.excl)}</dd>
            <dt>VAT {r.vat}%</dt><dd>{money(t.vat)}</dd>
          </dl>
          <div className="tot"><span className="label" style={{ color: 'var(--accent-ink)' }}>Quote total</span><b className="num">{money(t.total)}</b></div>
          <div className="row"><span>Gross margin <b className="num" style={{ color: marginColour }}>{t.margin.toFixed(1)}%</b></span><span>Deposit {r.deposit}%: <b className="num">{money0(t.deposit)}</b></span></div>
          {t.u > 1 && <div className="row"><span>Per unit</span><b className="num">{money(t.total / t.u)}</b></div>}
          <div className="acts">
            <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save quote'}</button>
            <button className="btn" type="button" disabled={busy} onClick={openDoc}>Customer {job.invoice_no ? 'invoice' : 'quote'}</button>
            {job.id && <button className="btn" type="button" onClick={() => setShowPhotos(true)}>Photos &amp; hand-in</button>}
            {me?.role === 'owner' && job.id && !job.invoice_no && (confirmDel
              ? <button className="btn small danger" type="button" onClick={deleteJob}>Confirm: delete {job.quote_no}</button>
              : <button className="btn small ghost" type="button" onClick={() => setConfirmDel(true)}>Delete quote</button>)}
          </div>
          {error && <div style={{ padding: '0 18px 14px' }}><ErrorNote error={error} /></div>}
        </aside>
      </div>

      {showPhotos && <JobFile job={job} me={me} toast={toast} onClose={() => setShowPhotos(false)} />}
      {showDoc && <QuoteDoc job={job} settings={settings} onClose={() => setShowDoc(false)} onSent={async (msg) => {
        toast(msg); setShowDoc(false)
        const { data } = await supabase.from('jobs').select('*').eq('id', job.id).single() // status may now be Quote sent
        if (data) setJob(data)
      }} />}
    </>
  )
}
