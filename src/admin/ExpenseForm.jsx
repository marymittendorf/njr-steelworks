import { useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money } from '../format.js'
import { readDocument } from '../docReader.js'
import { parseSlip } from '../docParse.js'
import { ErrorNote } from './ui.jsx'

export const CATEGORIES = ['Steel & materials', 'Consumables', 'Tools & equipment', 'Vehicle & fuel', 'Rent & utilities', 'Website & IT', 'Bank & payment fees', 'Insurance', 'Wages', 'Other']
export const PAY_METHODS = ['EFT', 'Card', 'Petty cash', 'Paystack', 'Debit order']
const today = () => new Date().toISOString().slice(0, 10)

export async function uploadExpenseDoc(file) {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('expense-docs').upload(path, file, { contentType: file.type })
  if (error) throw error
  return path
}

const blank = (paymentMethod) => ({ paid_on: today(), supplier: '', description: '', category: 'Consumables', amount_excl: '', vatOn: true, vat: '', invoice_no: '', payment_method: paymentMethod || 'EFT', notes: '' })

// "Record an expense" with slip reading: upload the slip first and the form fills itself in.
// Used on Expenses and (with paymentMethod="Petty cash" fixed) on Petty cash.
export default function ExpenseForm({ toast, onSaved, paymentMethod, heading = 'Record an expense' }) {
  const [form, setForm] = useState(() => blank(paymentMethod))
  const [file, setFile] = useState(null)
  const [reading, setReading] = useState(null)
  const [readNote, setReadNote] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fileKey, setFileKey] = useState(0)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function pickSlip(e) {
    const f = e.target.files[0] || null
    setFile(f); setReadNote(null); setError(null)
    if (!f) return
    setReading('Reading the slip…')
    try {
      const { lines } = await readDocument(f, (pct) => setReading(`Reading the photo… ${pct}%`))
      const s = parseSlip(lines)
      setForm((cur) => ({
        ...cur,
        supplier: s.supplier || cur.supplier,
        paid_on: s.date || cur.paid_on,
        invoice_no: s.invoice_no || cur.invoice_no,
        amount_excl: s.amount_excl ?? cur.amount_excl,
        vatOn: s.total !== null ? s.vat > 0 : cur.vatOn,
        vat: s.vat > 0 ? s.vat : '',
      }))
      const found = [s.supplier && 'supplier', s.date && 'date', s.total !== null && 'amount', s.vat > 0 && 'VAT', s.invoice_no && 'slip number'].filter(Boolean)
      setReadNote(found.length
        ? `Read from the slip: ${found.join(', ')}${s.total !== null ? ` (total ${money(s.total)})` : ''}. Check them, then add what it was for.`
        : "Couldn't read the figures on this slip. Fill them in yourself; the slip is still attached.")
    } catch (err) {
      setReadNote(`${err.message} The slip will still be attached.`)
    } finally { setReading(null) }
  }

  async function save(e) {
    e.preventDefault()
    if (!form.supplier.trim() || !form.description.trim() || !(n(form.amount_excl) > 0)) {
      setError('Add the supplier, what it was for, and the amount.'); return
    }
    setBusy(true)
    try {
      const file_path = file ? await uploadExpenseDoc(file) : null
      const vat = form.vatOn ? (form.vat === '' ? n(form.amount_excl) * 0.15 : n(form.vat)) : 0
      const { error } = await supabase.from('expenses').insert({
        paid_on: form.paid_on, supplier: form.supplier.trim(), description: form.description.trim(), category: form.category,
        amount_excl: n(form.amount_excl), vat: Math.round(vat * 100) / 100, invoice_no: form.invoice_no.trim() || null,
        payment_method: paymentMethod || form.payment_method || null, notes: form.notes.trim() || null, file_path,
      })
      if (error) throw error
      setForm(blank(paymentMethod)); setFile(null); setReadNote(null); setFileKey((k) => k + 1); setError(null)
      toast(paymentMethod === 'Petty cash' ? 'Cash slip recorded' : 'Expense recorded'); onSaved?.()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  const total = n(form.amount_excl) + (form.vatOn ? (form.vat === '' ? n(form.amount_excl) * 0.15 : n(form.vat)) : 0)

  return (
    <form className="card" onSubmit={save}>
      <div className="block-head"><h3>{heading}</h3></div>
      <div className="field slip-drop">
        <label htmlFor={`x-file-${paymentMethod || 'all'}`}>1. Slip or invoice (photo or PDF)</label>
        <input key={fileKey} id={`x-file-${paymentMethod || 'all'}`} type="file" accept="application/pdf,image/*" capture="environment" onChange={pickSlip} disabled={!!reading || busy} />
        <span className="hint">On a phone this opens the camera. We read the supplier, date, amount and VAT for you.</span>
        {reading && <span className="loading" style={{ padding: 0 }}>{reading}</span>}
        {readNote && <span className="hint" style={{ color: 'var(--accent-hi)' }}>{readNote}</span>}
      </div>
      <div className="fgrid" style={{ marginTop: 14 }}>
        <div className="field"><label htmlFor="x-date">Date paid</label><input id="x-date" type="date" value={form.paid_on} onChange={set('paid_on')} /></div>
        <div className="field"><label htmlFor="x-sup">Supplier</label><input id="x-sup" value={form.supplier} onChange={set('supplier')} placeholder="Macsteel, Builders, Afrox…" /></div>
        <div className="field full"><label htmlFor="x-desc">2. What it was for</label><input id="x-desc" value={form.description} onChange={set('description')} placeholder="Cutting discs and MIG wire for NJR-Q-0003" /></div>
        <div className="field"><label htmlFor="x-cat">Category</label><select id="x-cat" value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor="x-amt">Amount excl. VAT (R)</label><input id="x-amt" type="number" min="0" step="0.01" value={form.amount_excl} onChange={set('amount_excl')} /></div>
        <div className="field"><label className="check" htmlFor="x-vaton"><input id="x-vaton" type="checkbox" checked={form.vatOn} onChange={set('vatOn')} /> VAT charged</label>
          {form.vatOn && <input aria-label="VAT amount" type="number" min="0" step="0.01" value={form.vat} onChange={set('vat')} placeholder={`15%: ${money(n(form.amount_excl) * 0.15)}`} />}</div>
        {!paymentMethod && <div className="field"><label htmlFor="x-pay">Paid by</label><select id="x-pay" value={form.payment_method} onChange={set('payment_method')}>{PAY_METHODS.map((p) => <option key={p}>{p}</option>)}</select></div>}
        <div className="field"><label htmlFor="x-inv">Slip / invoice no. (optional)</label><input id="x-inv" value={form.invoice_no} onChange={set('invoice_no')} /></div>
        <div className="field full"><label htmlFor="x-notes">Notes (optional)</label><input id="x-notes" value={form.notes} onChange={set('notes')} /></div>
      </div>
      <ErrorNote error={error} />
      <div style={{ marginTop: 14, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn primary" type="submit" disabled={busy || !!reading}>{busy ? 'Saving…' : paymentMethod === 'Petty cash' ? 'Record cash slip' : 'Record expense'}</button>
        {total > 0 && <span className="hint num">Total {money(total)}</span>}
      </div>
    </form>
  )
}
