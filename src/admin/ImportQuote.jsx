import { useState } from 'react'
import { supabase } from '../supabase.js'
import { n, ownLine } from '../costing.js'
import { readDocument } from '../docReader.js'
import { parseQuote } from '../docParse.js'
import { stampsFor, syncInvoiceTotals } from '../orders.js'
import { money } from '../format.js'
import { ErrorNote } from './ui.jsx'

const today = () => new Date().toISOString().slice(0, 10)

// Upload a PDF (or photo) of an accepted quote → check what was read → create the order.
// Like Forever Planks' "Upload invoice", but works with any layout because staff confirm it.
export default function ImportQuote({ settings, onClose, onCreated }) {
  const [file, setFile] = useState(null)
  const [reading, setReading] = useState(null) // progress text while reading
  const [error, setError] = useState(null)
  const [f, setF] = useState(null)
  const [docTotal, setDocTotal] = useState(null)
  const [busy, setBusy] = useState(false)

  async function pick(e) {
    const chosen = e.target.files[0]
    if (!chosen) return
    if (chosen.size > 10 * 1024 * 1024) { setError('That file is over 10 MB.'); return }
    setFile(chosen); setError(null); setReading('Reading the quote…')
    try {
      const { lines } = await readDocument(chosen, (pct) => setReading(`Reading the photo… ${pct}%`))
      const q = parseQuote(lines)
      const vatOn = (q.vat || 0) > 0
      const items = q.items.length ? q.items : [{ desc: q.number ? `As per quote ${q.number}` : 'As per attached quote', amount: q.subtotal ?? (q.total ? (vatOn ? q.total - q.vat : q.total) : '') }]
      setF({
        customer: q.customer || '', phone: q.phone || '', number: q.number || '', date: q.date || today(),
        vatOn, items: items.map((i) => ({ desc: i.desc, amount: i.amount ?? '' })),
        status: 'Received', payment_status: 'Awaiting deposit', linesAddUp: q.linesAddUp,
      })
      setDocTotal(q.total)
    } catch (err) {
      setError(err.message)
      setF({ customer: '', phone: '', number: '', date: today(), vatOn: true, items: [{ desc: '', amount: '' }], status: 'Received', payment_status: 'Awaiting deposit', linesAddUp: false })
    } finally { setReading(null) }
  }

  const excl = f ? f.items.reduce((a, i) => a + n(i.amount), 0) : 0
  const vatRate = f?.vatOn ? n(settings.vat) : 0
  const total = excl * (1 + vatRate / 100)
  const differs = docTotal !== null && f && Math.abs(total - docTotal) > 1

  const setItem = (i, k, v) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })

  async function create() {
    if (!f.customer.trim()) { setError('Add the customer name.'); return }
    const items = f.items.filter((i) => i.desc.trim() && n(i.amount) > 0)
    if (!items.length) { setError('Add at least one line with an amount.'); return }
    setBusy(true); setError(null)
    try {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
      const path = `quotes/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('job-docs').upload(path, file, { contentType: file.type || 'application/pdf' })
      if (up.error) throw up.error
      const job = {
        customer: f.customer.trim(), phone: f.phone.trim() || null,
        title: items.length === 1 ? items[0].desc.trim() : `${items[0].desc.trim()} and ${items.length - 1} more`,
        quote_date: f.date, units: 1, galv: false, markup: 0,
        status: f.status, job_type: 'Customer job',
        notes: `Imported from PDF quote${f.number ? ` ${f.number}` : ''}.`,
        mats: [], labour: [], extras: [],
        products: items.map((i) => ownLine(i.desc.trim(), Math.round(n(i.amount) * (1 + vatRate / 100) * 100) / 100)),
        // Imported prices are final: lines at the PDF's prices.
        rates: { labour: 0, consumables: 0, overhead: 0, vat: vatRate, galv: 0, validity: n(settings.validity), deposit: n(settings.deposit) },
        source_pdf_path: path,
        ...stampsFor({}, f.status),
      }
      const { data, error } = await supabase.from('jobs').insert(job).select().single()
      if (error) throw error
      onCreated(await syncInvoiceTotals(data))
    } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="card" style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="block-head"><h3 style={{ fontSize: '1.6rem' }}>Upload an accepted quote</h3><button className="x" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <p className="hint">Upload the PDF (or a clear photo) of a quote the customer has accepted. We read it, you check it, and it becomes an order with an invoice number. The PDF is kept with the order.</p>
        <div className="field"><label htmlFor="iq-file">Quote PDF or photo</label>
          <input id="iq-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={pick} disabled={!!reading || busy} /></div>
        {reading && <p className="loading">{reading}</p>}
        <ErrorNote error={error} />

        {f && !reading && (
          <>
            {!f.linesAddUp && f.items.length <= 1 && <p className="hint" style={{ color: 'var(--warn)' }}>We couldn't match the separate lines to the total, so it's one line for now. Split it into lines below if you want them on the invoice.</p>}
            <div className="fgrid" style={{ marginTop: 12 }}>
              <div className="field"><label htmlFor="iq-cust">Customer</label><input id="iq-cust" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></div>
              <div className="field"><label htmlFor="iq-ph">Cell</label><input id="iq-ph" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
              <div className="field"><label htmlFor="iq-no">Their quote number</label><input id="iq-no" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></div>
              <div className="field"><label htmlFor="iq-date">Quote date</label><input id="iq-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            </div>

            <div className="tbl-wrap" style={{ marginTop: 14 }}><table>
              <thead><tr><th>Line</th><th className="r">Amount excl. VAT</th><th /></tr></thead>
              <tbody>
                {f.items.map((it, i) => (
                  <tr key={i}>
                    <td><input aria-label="Line description" value={it.desc} onChange={(e) => setItem(i, 'desc', e.target.value)} /></td>
                    <td className="r"><input className="money num" aria-label="Amount" type="number" min="0" step="0.01" value={it.amount} onChange={(e) => setItem(i, 'amount', e.target.value)} /></td>
                    <td><button className="x" type="button" aria-label="Remove line" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn small" type="button" onClick={() => setF({ ...f, items: [...f.items, { desc: '', amount: '' }] })}>Add line</button>
              <label className="check"><input type="checkbox" checked={f.vatOn} onChange={(e) => setF({ ...f, vatOn: e.target.checked })} /> Add VAT ({settings.vat}%)</label>
            </div>
            <div className="sheet" style={{ position: 'static', marginTop: 12 }}>
              <dl style={{ paddingTop: 12 }}>
                <dt>Excl. VAT</dt><dd>{money(excl)}</dd>
                <dt>VAT</dt><dd>{money(total - excl)}</dd>
                <dt><b>Total</b></dt><dd><b>{money(total)}</b></dd>
                {docTotal !== null && <><dt>Total on the PDF</dt><dd style={{ color: differs ? 'var(--warn)' : 'var(--good)' }}>{money(docTotal)}{differs ? ' (check)' : ' ✓'}</dd></>}
              </dl>
            </div>

            <div className="fgrid" style={{ marginTop: 12 }}>
              <div className="field"><label htmlFor="iq-stage">Stage</label>
                <select id="iq-stage" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option>Received</option><option>In production</option><option>Ready</option></select></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn primary" type="button" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create order and invoice'}</button>
              <button className="btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
