import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money, shortDate } from '../format.js'
import { Loading, ErrorNote } from './ui.jsx'

const CATEGORIES = ['Steel & materials', 'Consumables', 'Tools & equipment', 'Vehicle & fuel', 'Rent & utilities', 'Website & IT', 'Bank & payment fees', 'Insurance', 'Wages', 'Other']
const today = () => new Date().toISOString().slice(0, 10)
const month = (iso) => iso.slice(0, 7)
const monthLabel = (ym) => new Date(ym + '-01').toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })

function nextDue(iso, frequency) {
  const d = new Date(iso)
  if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

const blankExpense = () => ({ paid_on: today(), supplier: '', description: '', category: 'Steel & materials', amount_excl: '', vatOn: true, vat: '', invoice_no: '', payment_method: 'EFT', notes: '' })
const blankRecurring = () => ({ supplier: '', description: '', category: 'Rent & utilities', amount_excl: '', vat_rate: 15, frequency: 'monthly', next_due: today() })

export default function Expenses({ toast }) {
  const [expenses, setExpenses] = useState(null)
  const [recurring, setRecurring] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState(month(today()))
  const [form, setForm] = useState(blankExpense)
  const [file, setFile] = useState(null)
  const [rForm, setRForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [e, r] = await Promise.all([
      supabase.from('expenses').select('*').order('paid_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('recurring_costs').select('*').order('next_due'),
    ])
    setExpenses(e.data || []); setRecurring(r.data || []); setError(e.error || r.error)
  }
  useEffect(() => { load() }, [])

  if (!expenses || !recurring) return error ? <ErrorNote error={error} /> : <Loading />

  const active = recurring.filter((r) => r.active)
  const incl = (r) => n(r.amount_excl) * (1 + n(r.vat_rate) / 100)
  const perMonth = active.reduce((a, r) => a + (r.frequency === 'yearly' ? incl(r) / 12 : incl(r)), 0)
  const months = [...new Set([month(today()), ...expenses.map((e) => month(e.paid_on))])].sort().reverse()
  const shown = expenses.filter((e) => filter === 'all' || month(e.paid_on) === filter)
  const sum = (k) => shown.reduce((a, e) => a + n(e[k]), 0)
  const byCat = Object.entries(shown.reduce((a, e) => ({ ...a, [e.category]: (a[e.category] || 0) + n(e.total) }), {})).sort((a, b) => b[1] - a[1])

  async function uploadDoc(f) {
    const ext = (f.name.split('.').pop() || 'pdf').toLowerCase()
    const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('expense-docs').upload(path, f, { contentType: f.type })
    if (error) throw error
    return path
  }

  async function addExpense(e) {
    e.preventDefault()
    if (!form.supplier.trim() || !form.description.trim() || !(n(form.amount_excl) > 0)) {
      setError('Add the supplier, what it was for, and the amount.'); return
    }
    setBusy(true)
    try {
      const file_path = file ? await uploadDoc(file) : null
      const vat = form.vatOn ? (form.vat === '' ? n(form.amount_excl) * 0.15 : n(form.vat)) : 0
      const { error } = await supabase.from('expenses').insert({
        paid_on: form.paid_on, supplier: form.supplier.trim(), description: form.description.trim(), category: form.category,
        amount_excl: n(form.amount_excl), vat: Math.round(vat * 100) / 100, invoice_no: form.invoice_no.trim() || null,
        payment_method: form.payment_method || null, notes: form.notes.trim() || null, file_path,
      })
      if (error) throw error
      setForm(blankExpense()); setFile(null); e.target.reset(); setError(null); toast('Expense recorded'); load()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  async function recordPayment(r) {
    const vat = Math.round(n(r.amount_excl) * n(r.vat_rate)) / 100
    const { error } = await supabase.from('expenses').insert({
      paid_on: today(), supplier: r.supplier, description: `${r.description} (due ${shortDate(r.next_due)})`, category: r.category,
      amount_excl: r.amount_excl, vat, recurring_id: r.id,
    })
    if (error) { setError(error); return }
    await supabase.from('recurring_costs').update({ next_due: nextDue(r.next_due, r.frequency) }).eq('id', r.id)
    toast(`Recorded ${money(n(r.amount_excl) + vat)} to ${r.supplier}`); load()
  }

  async function saveRecurring(e) {
    e.preventDefault()
    if (!rForm.supplier.trim() || !rForm.description.trim() || !(n(rForm.amount_excl) > 0)) { setError('Add the supplier, what it is for, and the amount.'); return }
    const { error } = await supabase.from('recurring_costs').insert({ ...rForm, amount_excl: n(rForm.amount_excl), vat_rate: n(rForm.vat_rate) })
    if (error) { setError(error); return }
    setRForm(null); setError(null); toast('Regular cost added'); load()
  }

  async function toggleRecurring(r) {
    await supabase.from('recurring_costs').update({ active: !r.active }).eq('id', r.id)
    load()
  }

  async function openDoc(path) {
    const { data } = await supabase.storage.from('expense-docs').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function attachDoc(exp, f) {
    try {
      const file_path = await uploadDoc(f)
      const { error } = await supabase.from('expenses').update({ file_path }).eq('id', exp.id)
      if (error) throw error
      toast('Invoice attached'); load()
    } catch (err) { setError(err) }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const setR = (k) => (e) => setRForm({ ...rForm, [k]: e.target.value })

  return (
    <>
      <div className="pagehead">
        <div><h1>Expenses</h1><p>What the business pays out, and the costs that come back every month or year.</p></div>
      </div>
      <ErrorNote error={error} />

      <div className="kpis">
        <div className="kpi"><span className="label">Regular costs per month</span><b className="num">{money(perMonth)}</b><span className="sub">Incl. VAT, yearly costs ÷ 12</span></div>
        <div className="kpi"><span className="label">{filter === 'all' ? 'All expenses' : monthLabel(filter)}</span><b className="num">{money(sum('total'))}</b><span className="sub num">{shown.length} item{shown.length === 1 ? '' : 's'}</span></div>
        <div className="kpi"><span className="label">VAT paid (claimable)</span><b className="num">{money(sum('vat'))}</b><span className="sub">Same period</span></div>
        <div className="kpi"><span className="label">Biggest category</span><b style={{ fontSize: '1.5rem' }}>{byCat[0]?.[0] || '—'}</b><span className="sub num">{byCat[0] ? money(byCat[0][1]) : ''}</span></div>
      </div>

      <div className="block">
        <div className="block-head"><h3>Regular costs</h3>
          {!rForm && <button className="btn small" type="button" onClick={() => setRForm(blankRecurring())}>Add regular cost</button>}</div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Supplier</th><th>What for</th><th>How often</th><th className="r">Amount incl. VAT</th><th>Next due</th><th></th></tr></thead>
          <tbody>
            {recurring.map((r) => {
              const overdue = r.active && r.next_due <= today()
              return (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>{r.supplier}</td>
                  <td>{r.description}<div className="hint" style={{ fontSize: '.8rem' }}>{r.category}</div></td>
                  <td>{r.frequency === 'monthly' ? 'Monthly' : 'Yearly'}</td>
                  <td className="r num">{money(incl(r))}</td>
                  <td className="num" style={{ color: overdue ? 'var(--warn)' : undefined }}>{r.active ? shortDate(r.next_due) : 'Stopped'}{overdue && ' · due'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.active && <button className="btn small primary" type="button" onClick={() => recordPayment(r)}>Record payment</button>}{' '}
                    <button className="btn small ghost" type="button" onClick={() => toggleRecurring(r)}>{r.active ? 'Stop' : 'Restart'}</button>
                  </td>
                </tr>
              )
            })}
            {!recurring.length && <tr><td colSpan="6" className="hint">No regular costs yet.</td></tr>}
          </tbody>
        </table></div>
        <p className="hint">"Record payment" adds the payment to the log below, dated today, and moves the next due date on.</p>

        {rForm && (
          <form className="card" onSubmit={saveRecurring} style={{ marginTop: 12 }}>
            <div className="fgrid">
              <div className="field"><label htmlFor="r-sup">Supplier</label><input id="r-sup" value={rForm.supplier} onChange={setR('supplier')} placeholder="Eskom, landlord, insurer…" /></div>
              <div className="field"><label htmlFor="r-desc">What for</label><input id="r-desc" value={rForm.description} onChange={setR('description')} /></div>
              <div className="field"><label htmlFor="r-cat">Category</label><select id="r-cat" value={rForm.category} onChange={setR('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="field"><label htmlFor="r-amt">Amount excl. VAT (R)</label><input id="r-amt" type="number" min="0" step="0.01" value={rForm.amount_excl} onChange={setR('amount_excl')} /></div>
              <div className="field"><label htmlFor="r-vat">VAT (%)</label><input id="r-vat" type="number" min="0" step="1" value={rForm.vat_rate} onChange={setR('vat_rate')} /><span className="hint">0 if the supplier isn't VAT registered</span></div>
              <div className="field"><label htmlFor="r-freq">How often</label><select id="r-freq" value={rForm.frequency} onChange={setR('frequency')}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
              <div className="field"><label htmlFor="r-due">Next due</label><input id="r-due" type="date" value={rForm.next_due} onChange={setR('next_due')} /></div>
              <div className="field" style={{ justifyContent: 'flex-end', flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <button className="btn primary" type="submit">Save</button><button className="btn ghost" type="button" onClick={() => setRForm(null)}>Cancel</button></div>
            </div>
          </form>
        )}
      </div>

      <div className="block">
        <div className="block-head"><h3>Expense log</h3>
          <select aria-label="Show month" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            <option value="all">All months</option>
          </select></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Supplier</th><th>What for</th><th>Category</th><th className="r">Excl. VAT</th><th className="r">VAT</th><th className="r">Total</th><th>Invoice</th></tr></thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id}>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{shortDate(e.paid_on)}</td>
                <td>{e.supplier}{e.payment_method && <div className="hint" style={{ fontSize: '.8rem' }}>{e.payment_method}</div>}</td>
                <td>{e.description}{e.notes && <div className="hint" style={{ fontSize: '.8rem' }}>{e.notes}</div>}</td>
                <td className="hint">{e.category}</td>
                <td className="r num">{money(e.amount_excl)}</td>
                <td className="r num">{money(e.vat)}</td>
                <td className="r num"><b>{money(e.total)}</b></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {e.invoice_no && <span className="num">{e.invoice_no} </span>}
                  {e.file_path
                    ? <button className="linkbtn" type="button" onClick={() => openDoc(e.file_path)}>View</button>
                    : <label className="linkbtn" style={{ cursor: 'pointer' }}>Attach<input type="file" accept="application/pdf,image/*" hidden onChange={(ev) => ev.target.files[0] && attachDoc(e, ev.target.files[0])} /></label>}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan="8" className="hint">No expenses recorded for this period.</td></tr>}
            {shown.length > 0 && (
              <tr><td colSpan="4"><b>Total</b></td><td className="r num">{money(sum('amount_excl'))}</td><td className="r num">{money(sum('vat'))}</td><td className="r num"><b>{money(sum('total'))}</b></td><td /></tr>
            )}
          </tbody>
        </table></div>
      </div>

      <form className="card" onSubmit={addExpense}>
        <div className="block-head"><h3>Record an expense</h3></div>
        <div className="fgrid">
          <div className="field"><label htmlFor="x-date">Date paid</label><input id="x-date" type="date" value={form.paid_on} onChange={set('paid_on')} /></div>
          <div className="field"><label htmlFor="x-sup">Supplier</label><input id="x-sup" value={form.supplier} onChange={set('supplier')} placeholder="Macsteel, Builders, Afrox…" /></div>
          <div className="field full"><label htmlFor="x-desc">What for</label><input id="x-desc" value={form.description} onChange={set('description')} placeholder="6 × 50×50 square tube for NJR-Q-0003" /></div>
          <div className="field"><label htmlFor="x-cat">Category</label><select id="x-cat" value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="x-amt">Amount excl. VAT (R)</label><input id="x-amt" type="number" min="0" step="0.01" value={form.amount_excl} onChange={set('amount_excl')} /></div>
          <div className="field"><label className="check" htmlFor="x-vaton"><input id="x-vaton" type="checkbox" checked={form.vatOn} onChange={set('vatOn')} /> VAT charged</label>
            {form.vatOn && <input aria-label="VAT amount" type="number" min="0" step="0.01" value={form.vat} onChange={set('vat')} placeholder={`15%: ${money(n(form.amount_excl) * 0.15)}`} />}</div>
          <div className="field"><label htmlFor="x-pay">Paid by</label><select id="x-pay" value={form.payment_method} onChange={set('payment_method')}>{['EFT', 'Card', 'Cash', 'Paystack', 'Debit order'].map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="field"><label htmlFor="x-inv">Invoice no. (optional)</label><input id="x-inv" value={form.invoice_no} onChange={set('invoice_no')} /></div>
          <div className="field"><label htmlFor="x-file">Invoice or slip (optional)</label><input id="x-file" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
          <div className="field full"><label htmlFor="x-notes">Notes (optional)</label><input id="x-notes" value={form.notes} onChange={set('notes')} /></div>
        </div>
        <div style={{ marginTop: 14 }}><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record expense'}</button></div>
      </form>
    </>
  )
}
