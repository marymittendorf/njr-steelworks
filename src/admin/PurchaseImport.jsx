import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { customPart, n } from '../costing.js'
import { money } from '../format.js'
import { readDocument } from '../docReader.js'
import { parseSlip, parseInvoiceLines } from '../docParse.js'
import { uploadExpenseDoc, PAY_METHODS } from './ExpenseForm.jsx'
import { ErrorNote } from './ui.jsx'

const today = () => new Date().toISOString().slice(0, 10)
const r2 = (v) => Math.round(v * 100) / 100
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || `item${Date.now() % 100000}`

// Upload a supplier invoice → read supplier, date, number and each item → check → then either:
//  NJR bought it: items go into parts on hand at the purchase price, the purchase goes into Expenses;
//  the client bought it: items go onto the Parts list (nothing on hand, no expense) and onto a job as client-supplied.
export default function PurchaseImport({ manual, prices, me, toast, onClose, onSaved }) {
  const [file, setFile] = useState(null)
  const [reading, setReading] = useState(null)
  const [error, setError] = useState(null)
  const [f, setF] = useState(() => (manual ? { supplier: '', invoice_date: today(), invoice_no: '', method: 'EFT', docTotal: null, docVat: 0, inclVat: false, vatOn: true, items: [{ desc: '', qty: 1, unit: '', stock: '', updateCost: true }] } : null))
  const [busy, setBusy] = useState(false)
  const [who, setWho] = useState(null) // 'NJR' | 'Client'
  const [jobs, setJobs] = useState([])
  const [jobId, setJobId] = useState('')
  // Jobs a client-bought part can go onto: open quotes and orders, invoices first.
  useEffect(() => {
    supabase.from('jobs').select('id, quote_no, invoice_no, customer, customer_company, title, mats, status')
      .in('status', ['Draft', 'Quote sent', 'Received', 'In production', 'Ready']).order('created_at', { ascending: false })
      .then(({ data }) => { const list = (data || []).sort((a, b) => Boolean(b.invoice_no) - Boolean(a.invoice_no)); setJobs(list); if (list.length === 1) setJobId(list[0].id) })
  }, [])

  const findStock = (desc) => prices.find((s) => s.name.toLowerCase() === desc.trim().toLowerCase())?.id || ''

  async function pick(e) {
    const chosen = e.target.files[0]
    if (!chosen) return
    setFile(chosen); setError(null); setReading('Reading the invoice…')
    let slip = { supplier: '', date: null, invoice_no: '', total: null, vat: 0 }
    let items = []
    try {
      const { lines } = await readDocument(chosen, (pct) => setReading(`Reading the photo… ${pct}%`))
      slip = parseSlip(lines)
      items = parseInvoiceLines(lines)
    } catch (err) { setError(`${err.message} Type the items in below.`) }
    if (!items.length) setError("We couldn't read the items on this photo. Type them in below, or take a straighter, closer photo in good light (the whole slip, flat, no shadow).")
    const sum = items.reduce((a, i) => a + i.total, 0)
    // Line prices include VAT when they add up to the invoice total rather than the total less VAT.
    const inclVat = slip.total !== null && slip.vat > 0 && Math.abs(sum - slip.total) < Math.abs(sum - (slip.total - slip.vat))
    setF({
      supplier: slip.supplier || '', invoice_date: slip.date || today(), invoice_no: slip.invoice_no || '', method: 'EFT',
      docTotal: slip.total, docVat: slip.vat || 0, inclVat, vatOn: (slip.vat || 0) > 0,
      items: (items.length ? items : [{ desc: '', qty: 1, unit: '', total: 0 }]).map((i) => ({
        desc: i.desc, qty: i.qty, unit: i.unit, stock: findStock(i.desc), updateCost: true,
      })),
    })
    setReading(null)
  }

  const set = (i, patch) => setF({ ...f, items: f.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) })
  const exclUnit = (it) => (f.inclVat ? n(it.unit) / 1.15 : n(it.unit))
  const lineExcl = (it) => r2(n(it.qty) * exclUnit(it))
  const excl = f ? r2(f.items.reduce((a, it) => a + lineExcl(it), 0)) : 0
  const vat = f && f.vatOn ? r2(excl * 0.15) : 0
  const total = r2(excl + vat)
  const differs = f && f.docTotal !== null && Math.abs(total - f.docTotal) > 1

  async function save() {
    const items = f.items.filter((it) => it.desc.trim() && n(it.qty) > 0)
    if (!who) { setError('Say who bought it: NJR or the client.'); return }
    if (who === 'Client') return saveClient(items)
    if (!f.supplier.trim()) { setError('Add the supplier.'); return }
    if (!items.length) { setError('Add at least one item with a quantity.'); return }
    setBusy(true); setError(null)
    try {
      const file_path = file ? await uploadExpenseDoc(file) : null
      const names = items.map((it) => `${n(it.qty)} × ${it.desc.trim()}`).join(', ')
      const { data: exp, error: e1 } = await supabase.from('expenses').insert({
        paid_on: f.invoice_date, supplier: f.supplier.trim(), description: `Stock: ${names}`.slice(0, 500), category: 'Steel & materials',
        amount_excl: excl, vat, invoice_no: f.invoice_no.trim() || null, payment_method: f.method, file_path,
      }).select('id').single()
      if (e1) throw e1
      const { data: pur, error: e2 } = await supabase.from('purchases').insert({
        supplier: f.supplier.trim(), invoice_no: f.invoice_no.trim() || null, invoice_date: f.invoice_date,
        amount_excl: excl, vat, file_path, expense_id: exp.id, recorded_by: me?.name || null,
      }).select('id').single()
      if (e2) throw e2

      const taken = new Set(prices.map((x) => x.id))
      for (const it of items) {
        const unitCost = r2(exclUnit(it))
        const qty = n(it.qty)
        let item = prices.find((x) => x.id === it.stock) || prices.find((x) => x.name.toLowerCase() === it.desc.trim().toLowerCase())
        if (item) {
          const patch = { qty_on_hand: r2(n(item.qty_on_hand) + qty) }
          if (it.updateCost) patch.cost = unitCost
          const { error } = await supabase.from('prices').update(patch).eq('id', item.id)
          if (error) throw error
          item.qty_on_hand = patch.qty_on_hand
        } else {
          let id = slug(it.desc.trim())
          while (taken.has(id)) id = `${id.slice(0, 17)}${Math.floor(Math.random() * 900 + 100)}`
          taken.add(id)
          const sort = Math.max(0, ...prices.map((x) => x.sort || 0)) + 10
          const { data, error } = await supabase.from('prices').insert({ id, name: it.desc.trim(), unit: 'each', cost: unitCost, kg: 0, qty_on_hand: qty, sort,
            notes: `From ${f.supplier.trim()}${f.invoice_no ? ` invoice ${f.invoice_no.trim()}` : ''}` }).select().single()
          if (error) throw error
          item = data; prices.push(data)
        }
        const { error: e4 } = await supabase.from('purchase_lines').insert({ purchase_id: pur.id, price_id: item.id, description: it.desc.trim(), qty, unit_cost: unitCost, line_total: r2(qty * unitCost) })
        if (e4) throw e4
      }
      toast(`${items.length} item${items.length === 1 ? '' : 's'} added to stock; ${money(total)} recorded in Expenses`)
      onSaved()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  // The client bought it: Parts list only (nothing on hand, no expense), and onto the chosen job as client-supplied.
  async function saveClient(items) {
    if (!items.length) { setError('Add at least one item with a quantity.'); return }
    setBusy(true); setError(null)
    try {
      const from = [f.supplier.trim(), f.invoice_no.trim(), f.invoice_date].filter(Boolean).join(' · ')
      const taken = new Set(prices.map((x) => x.id))
      const onJob = []
      for (const it of items) {
        const unitCost = r2(exclUnit(it))
        let item = prices.find((x) => x.id === it.stock) || prices.find((x) => x.name.toLowerCase() === it.desc.trim().toLowerCase())
        if (item) {
          if (it.updateCost && unitCost > 0) {
            const { error } = await supabase.from('prices').update({ cost: unitCost }).eq('id', item.id)
            if (error) throw error
          }
        } else {
          let id = slug(it.desc.trim())
          while (taken.has(id)) id = `${id.slice(0, 17)}${Math.floor(Math.random() * 900 + 100)}`
          taken.add(id)
          const sort = Math.max(0, ...prices.map((x) => x.sort || 0)) + 10
          const { data, error } = await supabase.from('prices').insert({ id, name: it.desc.trim(), unit: 'each', cost: unitCost, kg: 0, qty_on_hand: 0, sort,
            notes: `${from ? `${from} · ` : ''}bought by the customer` }).select().single()
          if (error) throw error
          item = data; prices.push(data)
        }
        // Workshop list only: no cost on the job, so the quote or invoice price doesn't change.
        onJob.push({ ...customPart(item.name, 'Client'), id: item.id, unit: item.unit, qty: n(it.qty) })
      }
      const job = jobs.find((j) => j.id === jobId)
      if (job) {
        const { error } = await supabase.from('jobs').update({ mats: [...(job.mats || []), ...onJob], updated_at: new Date().toISOString() }).eq('id', job.id)
        if (error) throw error
      }
      // Keep the slip itself, marked as client-bought (no expense), so it can be opened from the job card and Purchases.
      const file_path = file ? await uploadExpenseDoc(file) : null
      const { data: pur, error: e2 } = await supabase.from('purchases').insert({
        supplier: f.supplier.trim() || 'Not given', invoice_no: f.invoice_no.trim() || null, invoice_date: f.invoice_date,
        amount_excl: excl, vat, file_path, bought_by: 'Client', job_id: job?.id || null, recorded_by: me?.name || null,
      }).select('id').single()
      if (e2) throw e2
      const { error: e3 } = await supabase.from('purchase_lines').insert(items.map((it, k) => ({ purchase_id: pur.id, price_id: onJob[k].id,
        description: it.desc.trim(), qty: n(it.qty), unit_cost: r2(exclUnit(it)), line_total: lineExcl(it) })))
      if (e3) throw e3
      toast(`${items.length} part${items.length === 1 ? '' : 's'} added to the Parts list${job ? ` and to ${job.invoice_no || job.quote_no} as supplied by the client` : ''}`)
      onSaved()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="card" style={{ maxWidth: 980, margin: '0 auto' }}>
        <div className="block-head"><h3 style={{ fontSize: '1.6rem', textTransform: 'uppercase' }}>{manual ? 'Type in a purchase' : 'Upload a purchase invoice'}</h3><button className="x" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <p className="hint" style={{ marginTop: 0 }}>{manual ? "What you bought, how many and what you paid. It's added to what you have on hand and recorded in Expenses." : "A PDF or a photo of the slip. We read each item; you check them and say who bought it."}</p>
        {manual
          ? <div className="field"><label htmlFor="pi-att">Receipt or slip (optional)</label><input id="pi-att" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
          : <div className="field slip-drop"><label htmlFor="pi-file">Supplier invoice (PDF or photo)</label>
          <input id="pi-file" type="file" accept="application/pdf,image/*" capture="environment" onChange={pick} disabled={!!reading || busy} /></div>}
        {reading && <p className="loading">{reading}</p>}
        <ErrorNote error={error} />

        {f && !reading && <>
          <div className="who-bought" role="group" aria-label="Who bought it?">
            <b>Who bought it?</b>
            <button type="button" aria-pressed={who === 'NJR'} onClick={() => setWho('NJR')}>NJR bought it<span>adds to parts on hand and to Expenses</span></button>
            <button type="button" aria-pressed={who === 'Client'} onClick={() => setWho('Client')}>The client bought it<span>Parts list and a job only, no expense</span></button>
          </div>
          {who === 'Client' && (
            <div className="field" style={{ marginTop: 10 }}><label htmlFor="pi-job">Put these parts on which job?</label>
              <select id="pi-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">No job yet (Parts list only)</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.invoice_no ? `${j.invoice_no} (invoice)` : j.quote_no} · {j.customer_company || j.customer} · {j.title}</option>)}
              </select></div>)}
          <div className="fgrid pi-head" style={{ marginTop: 12 }}>
            <div className="field"><label htmlFor="pi-sup">Supplier{who === 'Client' ? ' (optional)' : ''}</label><input id="pi-sup" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></div>
            <div className="field"><label htmlFor="pi-no">Invoice no.</label><input id="pi-no" value={f.invoice_no} onChange={(e) => setF({ ...f, invoice_no: e.target.value })} /></div>
            <div className="field"><label htmlFor="pi-date">Date</label><input id="pi-date" type="date" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} /></div>
            {who !== 'Client' && <div className="field"><label htmlFor="pi-m">Paid by</label><select id="pi-m" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>}
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0' }}>
            <label className="check"><input type="checkbox" checked={f.vatOn} onChange={(e) => setF({ ...f, vatOn: e.target.checked })} /> Supplier charged VAT</label>
            {f.vatOn && <label className="check"><input type="checkbox" checked={f.inclVat} onChange={(e) => setF({ ...f, inclVat: e.target.checked })} /> Item prices on the invoice include VAT</label>}
          </div>
          {f.items.some((it) => it.desc) && <p className="hint" style={{ margin: '4px 0 8px' }}>Read from the photo: check each line before saving.</p>}
          <div className="tbl-wrap"><table className="pi-items">
            <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Price each{f.inclVat ? ' (incl. VAT)' : ''}</th><th className="r">Line excl. VAT</th><th>Add to</th><th>Cost</th><th /></tr></thead>
            <tbody>{f.items.map((it, i) => (
              <tr key={i}>
                <td><input aria-label="Item" placeholder="What it is" value={it.desc} onChange={(e) => set(i, { desc: e.target.value, stock: it.stock || findStock(e.target.value) })} /></td>
                <td className="r"><input className="qty num" aria-label="Quantity" placeholder="Qty" type="number" min="0" step="0.5" value={it.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
                <td className="r"><input className="money num" aria-label="Price each" placeholder="Price each" type="number" min="0" step="0.01" value={it.unit} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                <td className="r num">{money(lineExcl(it))}</td>
                <td><select aria-label="Add to which item" value={it.stock} onChange={(e) => set(i, { stock: e.target.value })}>
                  <option value="">New item: {it.desc ? it.desc.slice(0, 30) : '…'}</option>
                  {prices.map((x) => <option key={x.id} value={x.id}>{x.name} ({n(x.qty_on_hand)} on hand)</option>)}
                </select></td>
                <td>{it.stock ? <label className="check" title="Set this item's cost to what you paid now"><input type="checkbox" checked={it.updateCost} onChange={(e) => set(i, { updateCost: e.target.checked })} /> Update</label> : <span className="hint">new</span>}</td>
                <td><button className="x" type="button" aria-label="Remove line" onClick={() => setF({ ...f, items: f.items.filter((_, k) => k !== i) })}>×</button></td>
              </tr>))}</tbody>
          </table></div>
          <button className="btn small" type="button" style={{ marginTop: 8 }} onClick={() => setF({ ...f, items: [...f.items, { desc: '', qty: 1, unit: '', stock: '', updateCost: true }] })}>Add line</button>
          <div className="sheet" style={{ position: 'static', marginTop: 12 }}>
            <dl style={{ paddingTop: 12 }}>
              <dt>Excl. VAT</dt><dd>{money(excl)}</dd><dt>VAT</dt><dd>{money(vat)}</dd><dt><b>Total</b></dt><dd><b>{money(total)}</b></dd>
              {f.docTotal !== null && <><dt>Total on the invoice</dt><dd style={{ color: differs ? 'var(--warn)' : 'var(--good)' }}>{money(f.docTotal)}{differs ? ' (check the lines)' : ' ✓'}</dd></>}
            </dl>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : who === 'Client' ? (jobId ? 'Add to Parts and the job' : 'Add to the Parts list') : who === 'NJR' ? 'Add to parts on hand and Expenses' : 'Choose who bought it'}</button>
            <button className="btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </>}
      </div>
    </div>
  )
}
