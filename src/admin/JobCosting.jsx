import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, customerDoc, legacyToLine, markupsFrom, n, ownLine, partLine, productLine, ratesFrom, STATUSES } from '../costing.js'
import { money, money0 } from '../format.js'
import { Loading, ErrorNote, Picker, PartPicker } from './ui.jsx'
import QuoteDoc from './QuoteDoc.jsx'
import JobFile from './JobFile.jsx'
import WorkOutPrice from './WorkOutPrice.jsx'
import JobCard from './JobCard.jsx'
import { ProductEditor, blankProduct, syncWebsiteFromProducts } from './Products.jsx'
import { JOB_TYPES, ensureStockItem, stampsFor, syncInvoiceTotals } from '../orders.js'

export const CATEGORIES = ['Skips', 'Trailers', 'Gates', 'Fabrication', 'Welding', 'Other']

const JOB_FIELDS = ['quote_date', 'customer', 'phone', 'email', 'customer_company', 'customer_address', 'customer_vat', 'title', 'units', 'galv', 'markup', 'status', 'job_type', 'category', 'notes', 'request_id', 'mats', 'labour', 'extras', 'products', 'rates']

export function blankJob(settings) {
  return {
    // A quote is a list of lines: products, and NJR's own lines for one-off work.
    title: '', category: null, mats: [], labour: [], extras: [], products: [],
    customer: '', phone: '', email: '', notes: '', units: 1, galv: false,
    markup: settings.markup, status: 'Draft', request_id: null, rates: ratesFrom(settings),
  }
}

export default function JobCosting({ target, settings, prices, toast, go, me }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmConvert, setConfirmConvert] = useState(false)
  const [showPhotos, setShowPhotos] = useState(false)
  const [showCard, setShowCard] = useState(false)
  const [catalogue, setCatalogue] = useState([])
  const settingsRates = ratesFrom(settings)
  const [adding, setAdding] = useState(null) // { id, qty, chosen: [] }
  const [addingPart, setAddingPart] = useState(null) // { id, qty, markup }: a stock part sold on the quote
  const [workOut, setWorkOut] = useState(null) // index of the own line being worked out
  const [newProduct, setNewProduct] = useState(null) // product being set up from this quote
  const [customers, setCustomers] = useState([]) // past customers, newest first, for the Customer list
  useEffect(() => {
    supabase.from('jobs').select('customer,phone,email,customer_company,customer_address,customer_vat').order('created_at', { ascending: false }).limit(1000).then(({ data }) => {
      const seen = new Map()
      for (const c of data || []) { const k = (c.customer || '').trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, c) }
      setCustomers([...seen.values()])
    })
  }, [])
  const loadCatalogue = () => supabase.from('products').select('*').eq('active', true).order('category').order('name').then(({ data }) => setCatalogue(data || []))
  useEffect(() => { loadCatalogue() }, [])
  const [job, setJob] = useState(() => target?.jobId ? null : (target?.draft || blankJob(settings)))
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
  const lines = job.products || []
  const upd = (patch) => setJob((j) => ({ ...j, ...patch }))
  const updLine = (i, patch) => setJob((j) => ({ ...j, products: (j.products || []).map((row, k) => (k === i ? { ...row, ...patch } : row)) }))
  const delLine = (i) => setJob((j) => ({ ...j, products: (j.products || []).filter((_, k) => k !== i) }))
  const addLine = (row) => setJob((j) => ({ ...j, products: [...(j.products || []), row] }))
  const noCost = lines.filter((l) => l.custom && !n(l.cost_excl)).length

  // Picking a past customer fills in their cell and email (only where still empty).
  function pickCustomer(name) {
    const c = customers.find((x) => x.customer.trim().toLowerCase() === name.trim().toLowerCase())
    upd(c ? {
      customer: name, phone: job.phone || c.phone || '', email: job.email || c.email || '',
      customer_company: job.customer_company || c.customer_company || '', customer_address: job.customer_address || c.customer_address || '', customer_vat: job.customer_vat || c.customer_vat || '',
    } : { customer: name })
  }

  // Older quotes were costed part by part: turn that into one line at the same price.
  function convertLegacy() {
    const line = legacyToLine(job)
    setJob((j) => ({ ...j, products: [...(j.products || []), line], mats: (j.mats || []).filter((m) => m.supplied_by === 'Client'), labour: [], extras: [], units: 1, galv: false }))
  }

  // patch: changes to save along with the form, e.g. { status: 'Received' } to convert to an invoice.
  async function save(patch) {
    const j = patch && !patch.nativeEvent ? { ...job, ...patch } : job
    if (!j.customer.trim()) { setError('Add the customer name before saving.'); return null }
    const title = j.title.trim() || lines[0]?.name?.trim() || ''
    if (!title) { setError('Add a job description, or a line, before saving.'); return null }
    if (lines.some((l) => !String(l.name || '').trim())) { setError('Every line needs a description.'); return null }
    setBusy(true); setError(null)
    const payload = Object.fromEntries(JOB_FIELDS.filter((k) => k in j).map((k) => [k, j[k]]))
    payload.title = title
    for (const k of ['customer_company', 'customer_address', 'customer_vat']) payload[k] = String(payload[k] || '').trim() || null
    payload.units = Math.max(1, Math.round(n(payload.units)) || 1)
    payload.markup = n(payload.markup)
    payload.mats = (payload.mats || []).map((m) => ({ ...m, qty: n(m.qty), cost: n(m.cost) }))
    payload.labour = (payload.labour || []).map((l) => ({ ...l, hours: n(l.hours) }))
    payload.extras = (payload.extras || []).map((x) => ({ ...x, amount: n(x.amount) }))
    payload.products = lines.map((x) => ({ ...x, name: x.name.trim(), qty: Math.max(1, n(x.qty)), price_incl: n(x.price_incl), cost_excl: n(x.cost_excl) }))
    Object.assign(payload, stampsFor(j, payload.status)) // date-stamp the order timeline
    payload.customer_doc = customerDoc({ ...j, ...payload }) // what the customer sees on their link
    let res
    if (j.id) res = await supabase.from('jobs').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', j.id).select().single()
    else res = await supabase.from('jobs').insert(payload).select().single()
    setBusy(false)
    if (res.error) { setError(res.error); return null }
    if (!j.id && j.request_id) await supabase.from('requests').update({ status: 'Quoted' }).eq('id', j.request_id)
    await ensureStockItem(res.data)
    res.data = await syncInvoiceTotals(res.data)
    setJob(res.data)
    toast(!j.invoice_no && res.data.invoice_no ? `Invoice ${res.data.invoice_no} issued` : 'Saved ' + (res.data.invoice_no || res.data.quote_no))
    return res.data
  }

  // Convert to invoice: the customer accepted, so the stage becomes Received and the database issues the invoice number.
  async function convertToInvoice() {
    const saved = await save({ status: 'Received' })
    setConfirmConvert(false)
    if (saved?.invoice_no) go('invoices', { jobId: saved.id })
  }

  async function deleteJob() {
    const { error } = await supabase.from('jobs').delete().eq('id', job.id)
    if (error) { setError(error); return }
    toast(`Deleted ${job.quote_no}`); go('jobs')
  }

  async function openDoc(mode = 'view') {
    const saved = await save()
    if (saved) setShowDoc(mode)
  }

  const marginColour = t.margin < 12 ? 'var(--bad)' : t.margin < 18 ? 'var(--warn)' : 'var(--good)'

  return (
    <>
      <div className="pagehead">
        <div><h1>{job.invoice_no ? 'Edit invoice' : 'Quote'}</h1><p>{job.invoice_no ? `${job.invoice_no} · from quote ${job.quote_no}` : job.quote_no || 'New quote, not saved yet'}
          {job.source_pdf_path && <> · <button className="linkbtn" type="button" onClick={async () => { const { data } = await supabase.storage.from('job-docs').createSignedUrl(job.source_pdf_path, 300); if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener') }}>Original PDF quote</button></>}</p></div>
        {job.invoice_no
          ? <button className="btn small" type="button" onClick={() => go('invoices', { jobId: job.id })}>Back to invoice</button>
          : <button className="btn small" type="button" onClick={() => go('cost', null)}>New quote</button>}
      </div>

      {job.customer_response && (
        <div className="card block" style={{ borderColor: job.customer_response === 'Accepted' ? 'var(--good)' : 'var(--bad)' }}>
          <b className={job.customer_response === 'Accepted' ? 'tx-good' : 'tx-bad'}>{job.customer_response} online</b> by {job.customer_response_name} on {new Date(job.customer_response_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
          {job.customer_response_note && <div style={{ marginTop: 6 }}>"{job.customer_response_note}"</div>}
        </div>)}
      <div className="cost-layout">
        <div>
          <div className="card block"><div className="fgrid">
            <div className="field"><label htmlFor="c-cust">Customer</label><input id="c-cust" list="c-cust-list" autoComplete="off" value={job.customer} onChange={(e) => pickCustomer(e.target.value)} placeholder="Type to pick a past customer" />
              <datalist id="c-cust-list">{customers.map((c) => <option key={c.customer} value={c.customer}>{c.phone || ''}</option>)}</datalist></div>
            <div className="field"><label htmlFor="c-phone">Cell</label><input id="c-phone" value={job.phone || ''} onChange={(e) => upd({ phone: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-company">Company (optional)</label><input id="c-company" value={job.customer_company || ''} onChange={(e) => upd({ customer_company: e.target.value })} /></div>
            <div className="field"><label htmlFor="c-vat">Customer VAT number (optional)</label><input id="c-vat" value={job.customer_vat || ''} onChange={(e) => upd({ customer_vat: e.target.value })} /></div>
            <div className="field full"><label htmlFor="c-addr">Address (optional)</label><textarea id="c-addr" style={{ minHeight: 56 }} value={job.customer_address || ''} onChange={(e) => upd({ customer_address: e.target.value })} /></div>
            <div className="field full"><label htmlFor="c-email">Customer email</label><input id="c-email" type="email" value={job.email || ''} onChange={(e) => upd({ email: e.target.value })} placeholder="For emailing the quote and invoice" /></div>
            <div className="field full"><label htmlFor="c-title">Job description (heading on the quote)</label><input id="c-title" value={job.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Filled in from the first line if left empty" /></div>
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
            <div className="field full"><label htmlFor="c-notes">Notes (internal)</label><textarea id="c-notes" style={{ minHeight: 60 }} value={job.notes || ''} onChange={(e) => upd({ notes: e.target.value })} /></div>
          </div></div>

          <div className="block">
            <div className="block-head"><h3>On the quote</h3>
              {!adding && !addingPart && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn small primary" type="button" onClick={() => setAdding({ id: '', qty: 1, chosen: [] })}>Add product</button>
                <button className="btn small" type="button" onClick={() => setAddingPart({ id: '', qty: 1, markup: n(settings.parts_markup) })}>Add part</button>
                <button className="btn small" type="button" onClick={() => addLine(ownLine())}>Add your own line</button>
              </div>}</div>
            {addingPart && (() => {
              const part = prices.find((x) => x.id === addingPart.id)
              const line = part && partLine(part, Math.max(1, n(addingPart.qty)), addingPart.markup, settingsRates.vat)
              return (
                <div className="sugg" style={{ borderTop: 0 }}>
                  <div style={{ flex: 1, minWidth: 240 }}><PartPicker prices={prices} value={addingPart.id} autoFocus={!addingPart.id} onChange={(id) => setAddingPart({ ...addingPart, id })} /></div>
                  <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Qty <input className="qty num" aria-label="How many" type="number" min="1" step="1" value={addingPart.qty} onChange={(e) => setAddingPart({ ...addingPart, qty: e.target.value })} /></label>
                  <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Markup <input className="qty num" aria-label="Markup %" type="number" min="0" step="5" value={addingPart.markup} onChange={(e) => setAddingPart({ ...addingPart, markup: e.target.value })} />%</label>
                  {line && <span className="num">{money(line.price_incl)} each incl. VAT{!n(part.cost) && <span className="tx-warn"> · no cost yet</span>}</span>}
                  <button className="btn small primary" type="button" disabled={!line} onClick={() => { addLine(line); setAddingPart(null) }}>Add</button>
                  <button className="btn small ghost" type="button" onClick={() => setAddingPart(null)}>Cancel</button>
                </div>)
            })()}
            {adding && (() => {
              const prod = catalogue.find((x) => x.id === adding.id)
              return (
                <div className="sugg" style={{ borderTop: 0 }}>
                  <div style={{ flex: 1, minWidth: 240 }}><Picker items={catalogue} value={adding.id} autoFocus={!adding.id} label="Product"
                    onChange={(id) => setAdding({ id, qty: adding.qty, chosen: [] })}
                    search={(x) => `${x.name} ${x.category} ${x.spec || ''}`}
                    sub={(x) => `${x.price_incl ? money0(x.price_incl) : 'no price yet'} · ${x.category}`}
                    placeholder="Type to find a product…" empty={(t) => `No product matches "${t}".`}
                    onCreate={(name) => setNewProduct({ ...blankProduct(n(settings.markup)), name, category: job.category || 'Skips' })} createLabel="New product" /></div>
                  <input className="qty num" aria-label="How many" type="number" min="1" step="1" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value })} />
                  {(prod?.options || []).map((o) => (
                    <label key={o.name} className="check"><input type="checkbox" checked={adding.chosen.includes(o.name)} onChange={(e) => setAdding({ ...adding, chosen: e.target.checked ? [...adding.chosen, o.name] : adding.chosen.filter((c) => c !== o.name) })} /> {o.name} (+{money0(o.price_incl)})</label>
                  ))}
                  <button className="btn small primary" type="button" disabled={!prod} onClick={() => { addLine(productLine(prod, prices, settingsRates, adding.chosen, Math.max(1, n(adding.qty)))); if (!job.category) upd({ category: prod.category }); setAdding(null) }}>Add</button>
                  <button className="btn small ghost" type="button" onClick={() => setAdding(null)}>Cancel</button>
                </div>)
            })()}

            <div className="tbl-wrap"><table>
              <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Price each incl. VAT</th><th className="r">Costs you each</th><th className="r">Line incl. VAT</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.custom
                      ? <><input aria-label="Description" value={l.name} onChange={(e) => updLine(i, { name: e.target.value })} placeholder="e.g. Repair skip floor" />
                          <button className="linkbtn" type="button" onClick={() => setWorkOut(i)}>{l.worked ? 'Change the working-out' : 'Work out a price'}</button>
                          {l.parts?.length > 0 && <span className="hint"> · {l.parts.length} parts, {(l.labour || []).reduce((a, x) => a + n(x.hours), 0)} h</span>}</>
                      : <><b>{l.name}</b>{l.options?.length > 0 && <div className="hint">{l.options.join(', ')}</div>}</>}</td>
                    <td className="r"><input className="qty num" aria-label="Quantity" type="number" min="1" step="1" value={l.qty} onChange={(e) => updLine(i, { qty: e.target.value })} /></td>
                    <td className="r"><input className="money num" aria-label="Price each" type="number" min="0" step="10" value={l.price_incl} onChange={(e) => updLine(i, { price_incl: e.target.value })} /></td>
                    <td className="r">{l.custom
                      ? <input className="money num" aria-label="Costs you each (excl. VAT)" type="number" min="0" step="10" value={l.cost_excl} placeholder="optional" onChange={(e) => updLine(i, { cost_excl: e.target.value })} />
                      : <span className="num hint">{money(l.cost_excl)}</span>}</td>
                    <td className="r num">{money(n(l.qty) * n(l.price_incl))}</td>
                    <td><button className="x" type="button" aria-label={`Remove ${l.name || 'line'}`} onClick={() => delLine(i)}>×</button></td>
                  </tr>))}
                {t.costedExcl > 0 && (
                  <tr>
                    <td><b>{job.title}</b> <span className="hint">(costed the old way)</span>
                      {!job.invoice_no && <div><button className="linkbtn" type="button" onClick={convertLegacy}>Turn into a line I can edit</button></div>}</td>
                    <td className="r num">{t.u}</td>
                    <td className="r num">{money(t.costedExcl * (1 + r.vat / 100) / t.u)}</td>
                    <td className="r num hint">{money(t.costedCost / t.u)}</td>
                    <td className="r num">{money(t.costedExcl * (1 + r.vat / 100))}</td>
                    <td />
                  </tr>)}
                {!lines.length && !t.costedExcl && <tr><td colSpan="6" className="hint">Add a product (e.g. 2 m³ skip), or your own line for one-off work.</td></tr>}
              </tbody>
            </table></div>
            <p className="hint">Prices include VAT. "Costs you" is excl. VAT and never shows on the customer's quote. Changing a product's price here doesn't change the product itself.</p>
          </div>
        </div>

        <aside className="sheet">
          <h3>Total</h3>
          <dl>
            <dt>Price excl. VAT</dt><dd>{money(t.excl)}</dd>
            <dt>VAT {r.vat}%</dt><dd>{money(t.vat)}</dd>
          </dl>
          <div className="tot"><span className="label" style={{ color: 'var(--accent-ink)' }}>{job.invoice_no ? 'Invoice total' : 'Quote total'}</span><b className="num">{money(t.total)}</b></div>
          <div className="row"><span>Deposit {r.deposit}%</span><b className="num">{money0(t.deposit)}</b></div>
          <div className="row hint"><span>Costs you {money0(t.cost)} · profit <b className="num" style={{ color: marginColour }}>{money0(t.markup)} ({t.margin.toFixed(0)}%)</b></span></div>
          {noCost > 0 && <div className="row hint" style={{ color: 'var(--warn)' }}>{noCost} line{noCost > 1 ? 's have' : ' has'} no cost, so profit looks higher than it is.</div>}
          <div className="acts">
            <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : job.invoice_no ? 'Save invoice' : 'Save quote'}</button>
            <button className="btn" type="button" disabled={busy} onClick={async () => { const saved = await save(); if (saved) (saved.invoice_no ? go('invoices', { jobId: saved.id }) : go('jobs')) }}>Save and close</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => (job.invoice_no ? go('invoices', { jobId: job.id }) : go('jobs'))} title="Close without saving changes">Cancel</button>
            {!job.invoice_no && (job.job_type || 'Customer job') === 'Customer job' && ['Draft', 'Quote sent'].includes(job.status) && (confirmConvert
              ? <button className="btn primary" type="button" disabled={busy} onClick={convertToInvoice}>Confirm: make invoice</button>
              : <button className="btn" type="button" disabled={busy} onClick={() => setConfirmConvert(true)} title="The customer accepted: issue the invoice and move the job to Orders">Convert to invoice</button>)}
            <button className="btn" type="button" disabled={busy} onClick={() => openDoc('email')}>Email {job.invoice_no ? 'invoice' : 'quote'}</button>
            <button className="btn" type="button" disabled={busy} onClick={() => openDoc('view')}>View / print</button>
            {job.id && <button className="btn" type="button" onClick={() => setShowCard(true)}>Job card</button>}
            {job.id && <button className="btn" type="button" onClick={() => setShowPhotos(true)}>Photos &amp; hand-in</button>}
            {me?.role === 'owner' && job.id && !job.invoice_no && (confirmDel
              ? <button className="btn small danger" type="button" onClick={deleteJob}>Confirm: delete {job.quote_no}</button>
              : <button className="btn small ghost" type="button" onClick={() => setConfirmDel(true)}>Delete quote</button>)}
          </div>
          {error && <div style={{ padding: '0 18px 14px' }}><ErrorNote error={error} /></div>}
        </aside>
      </div>

      {workOut !== null && lines[workOut] && <WorkOutPrice line={lines[workOut]} prices={prices} rates={settingsRates} markups={markupsFrom(settings)}
        onClose={() => setWorkOut(null)} onUse={(line) => { updLine(workOut, line); setWorkOut(null) }} />}
      {newProduct && <ProductEditor product={newProduct} prices={prices} settings={settings} rates={settingsRates} me={me} toast={toast}
        onClose={() => setNewProduct(null)}
        onSaved={async (saved) => {
          setNewProduct(null)
          await loadCatalogue()
          if (saved?.active) setAdding({ id: saved.id, qty: adding?.qty || 1, chosen: [] })
          syncWebsiteFromProducts(settings)
        }} />}
      {showCard && <JobCard job={job} prices={prices} me={me} toast={toast} onClose={() => setShowCard(false)} onSaved={(u, opts) => { setJob(u); if (!opts?.keepOpen) setShowCard(false) }} />}
      {showPhotos && <JobFile job={job} me={me} toast={toast} onClose={() => setShowPhotos(false)} />}
      {showDoc && <QuoteDoc job={job} settings={settings} email={showDoc === 'email'} onClose={() => setShowDoc(false)} onSent={async (msg) => {
        toast(msg); setShowDoc(false)
        const { data } = await supabase.from('jobs').select('*').eq('id', job.id).single() // status may now be Quote sent
        if (data) setJob(data)
      }} />}
    </>
  )
}
