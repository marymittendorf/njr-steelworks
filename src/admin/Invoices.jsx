import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money, money0, shortDate } from '../format.js'
import { Loading, ErrorNote } from './ui.jsx'
import QuoteDoc from './QuoteDoc.jsx'

const today = () => new Date().toISOString().slice(0, 10)
const METHODS = ['EFT', 'Cash', 'Card', 'Other']
export const balanceOf = (j) => Math.max(0, Math.round((n(j.invoice_total) - n(j.amount_paid)) * 100) / 100)
export function invoiceState(j) {
  if (j.invoice_voided_at) return 'Void'
  if (n(j.invoice_total) > 0 && balanceOf(j) <= 0.5) return 'Paid'
  if (n(j.amount_paid) > 0) return 'Part paid'
  return 'Unpaid'
}
const STATE_CLASS = { Void: 'st-Cancelled', Paid: 'st-Done', 'Part paid': 'st-In-production', Unpaid: 'st-New' }
const sameCustomer = (a, b) => a.customer.trim().toLowerCase() === b.customer.trim().toLowerCase() || (a.phone && b.phone && a.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, ''))

// Invoices and payments, like the skip program: every invoice with what's paid and owing,
// record payments with proof, customer statements, void (owners).
export default function Invoices({ settings, me, toast, target }) {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('Awaiting payment')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [statementFor, setStatementFor] = useState(null)
  const [paidThisMonth, setPaidThisMonth] = useState(0)

  const load = async () => {
    const month = today().slice(0, 8) + '01'
    const [j, p] = await Promise.all([
      supabase.from('jobs').select('*').not('invoice_no', 'is', null).order('invoice_date', { ascending: false }).order('invoice_no', { ascending: false }),
      supabase.from('payments').select('amount').gte('paid_on', month),
    ])
    setJobs(j.data || []); setError(j.error || p.error)
    setPaidThisMonth((p.data || []).reduce((a, x) => a + n(x.amount), 0))
    return j.data || []
  }
  useEffect(() => {
    load().then((list) => { if (target?.jobId) setOpen(list.find((x) => x.id === target.jobId) || null) })
  }, [target?.jobId])

  if (!jobs) return error ? <ErrorNote error={error} /> : <Loading />

  const needle = q.trim().toLowerCase()
  const shown = jobs
    .filter((j) => filter === 'All' || (filter === 'Awaiting payment' ? ['Unpaid', 'Part paid'].includes(invoiceState(j)) : invoiceState(j) === filter))
    .filter((j) => !needle || [j.invoice_no, j.quote_no, j.customer, j.phone, j.title].some((v) => String(v || '').toLowerCase().includes(needle.replace(/\s/g, '')) || String(v || '').toLowerCase().includes(needle)))
  const owing = jobs.filter((j) => !j.invoice_voided_at).reduce((a, j) => a + balanceOf(j), 0)
  const unpaidCount = jobs.filter((j) => ['Unpaid', 'Part paid'].includes(invoiceState(j))).length

  const refresh = async (id) => { const list = await load(); if (id) setOpen(list.find((x) => x.id === id) || null) }

  return (
    <>
      <div className="pagehead"><div><h1>Invoices</h1><p>Every invoice, what's been paid and what's owing. Click an invoice to record a payment.</p></div></div>
      <ErrorNote error={error} />
      <div className="kpis">
        <button type="button" className={`kpi kpi-btn${filter === 'Awaiting payment' ? ' on' : ''}`} onClick={() => setFilter('Awaiting payment')}>
          <span className="label">Owing to NJR</span><b className="num">{money0(owing)}</b><span className="sub">{unpaidCount} invoice{unpaidCount === 1 ? '' : 's'} awaiting payment</span></button>
        <div className="kpi"><span className="label">Received this month</span><b className="num">{money0(paidThisMonth)}</b></div>
        <button type="button" className={`kpi kpi-btn${filter === 'Paid' ? ' on' : ''}`} onClick={() => setFilter('Paid')}>
          <span className="label">Paid invoices</span><b className="num">{jobs.filter((j) => invoiceState(j) === 'Paid').length}</b></button>
        <button type="button" className={`kpi kpi-btn${filter === 'All' ? ' on' : ''}`} onClick={() => setFilter('All')}>
          <span className="label">All invoices</span><b className="num">{jobs.length}</b></button>
      </div>
      <div className="block-head" style={{ alignItems: 'flex-end' }}>
        <div className="filters" role="group" aria-label="Show" style={{ marginBottom: 0 }}>
          {['Awaiting payment', 'Paid', 'Void', 'All'].map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
        </div>
        <input type="search" aria-label="Search invoices" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice no., customer, cell…" style={{ maxWidth: 300 }} />
      </div>
      {!shown.length ? <div className="card hint">{jobs.length ? 'No invoices here.' : 'No invoices yet. A quote becomes an invoice when it\'s accepted (stage Received).'}</div> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Job</th><th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((j) => (
              <tr key={j.id} className="clickable" tabIndex={0} onClick={() => setOpen(j)} onKeyDown={(e) => e.key === 'Enter' && setOpen(j)}>
                <td className="num"><b>{j.invoice_no}</b><div className="hint">{j.quote_no}</div></td>
                <td className="num">{j.invoice_date ? shortDate(j.invoice_date) : '—'}</td>
                <td>{j.customer}<div className="hint">{j.phone}</div></td>
                <td>{j.title}</td>
                <td className="r num">{money(j.invoice_total)}</td>
                <td className="r num">{money(j.amount_paid)}</td>
                <td className="r num"><b>{j.invoice_voided_at ? '—' : money(balanceOf(j))}</b></td>
                <td><span className={`pill ${STATE_CLASS[invoiceState(j)]}`}>{invoiceState(j)}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {open && <InvoicePanel job={open} settings={settings} me={me} toast={toast} onChanged={() => refresh(open.id)}
        onStatement={() => setStatementFor(open)} onClose={() => setOpen(null)} />}
      {statementFor && <Statement customer={statementFor} jobs={jobs.filter((j) => sameCustomer(j, statementFor))} settings={settings} onClose={() => setStatementFor(null)} />}
    </>
  )
}

function InvoicePanel({ job, settings, me, toast, onChanged, onStatement, onClose }) {
  const [payments, setPayments] = useState(null)
  const [form, setForm] = useState({ amount: '', paid_on: today(), method: 'EFT', reference: '', note: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showDoc, setShowDoc] = useState(false)
  const [voiding, setVoiding] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const state = invoiceState(job)
  const bal = balanceOf(job)
  const deposit = Math.round(n(job.invoice_total) * n(job.rates?.deposit ?? 50)) / 100

  const load = () => supabase.from('payments').select('*').eq('job_id', job.id).order('paid_on').then(({ data, error }) => { setPayments(data || []); setError(error) })
  useEffect(() => { load(); setForm((f) => ({ ...f, amount: '' })) }, [job.id, job.amount_paid])

  async function record(e) {
    e.preventDefault()
    const amount = n(form.amount)
    if (!(amount > 0)) { setError('Type the amount received.'); return }
    if (amount > bal + 0.5 && !window.confirm?.('That is more than the balance. Record it anyway?')) return
    setBusy(true); setError(null)
    try {
      let proof_path = null
      if (file) {
        proof_path = `${job.id}/${crypto.randomUUID()}.${(file.name.split('.').pop() || 'pdf').toLowerCase()}`
        const up = await supabase.storage.from('payment-proofs').upload(proof_path, file, { contentType: file.type })
        if (up.error) throw up.error
      }
      const { error } = await supabase.from('payments').insert({
        job_id: job.id, amount, paid_on: form.paid_on, method: form.method, reference: form.reference.trim() || null,
        note: form.note.trim() || null, proof_path, recorded_by: me?.name || null,
      })
      if (error) throw error
      setForm({ amount: '', paid_on: today(), method: 'EFT', reference: '', note: '' }); setFile(null)
      toast(`${money(amount)} recorded on ${job.invoice_no}`); await load(); onChanged()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  async function openProof(path) {
    const { data } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }
  async function removePayment(p) {
    const { error } = await supabase.from('payments').delete().eq('id', p.id)
    if (error) { setError(error); return }
    setConfirmDel(null); toast('Payment removed'); await load(); onChanged()
  }
  async function voidInvoice() {
    if (!voiding.trim()) { setError('Say why the invoice is void.'); return }
    const { error } = await supabase.from('jobs').update({ invoice_voided_at: new Date().toISOString(), invoice_void_reason: voiding.trim(), status: 'Declined' }).eq('id', job.id)
    if (error) { setError(error); return }
    setVoiding(null); toast(`${job.invoice_no} is void`); onChanged()
  }

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card" style={{ maxWidth: 820, margin: '0 auto' }}>
        <div className="block-head">
          <div><h3 style={{ fontSize: '1.8rem' }}>{job.invoice_no}</h3><span className="hint">{job.quote_no} · {job.customer} · {job.title}</span></div>
          <button className="btn small" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="kpis" style={{ marginBottom: 12 }}>
          <div className="kpi"><span className="label">Invoice total</span><b className="num">{money0(job.invoice_total)}</b><span className="sub">{job.invoice_date && shortDate(job.invoice_date)}</span></div>
          <div className="kpi"><span className="label">Paid</span><b className="num">{money0(job.amount_paid)}</b><span className="sub">{job.payment_status}</span></div>
          <div className="kpi"><span className="label">Balance</span><b className="num" style={{ color: bal > 0 && !job.invoice_voided_at ? 'var(--accent-hi)' : 'var(--good)' }}>{job.invoice_voided_at ? 'Void' : money0(bal)}</b>
            {!n(job.amount_paid) && !job.invoice_voided_at && <span className="sub">Deposit {money0(deposit)}</span>}</div>
        </div>
        {job.invoice_voided_at && <div className="errmsg">Void since {shortDate(job.invoice_voided_at)}: {job.invoice_void_reason}</div>}
        <ErrorNote error={error} />

        <div className="block-head"><h3>Payments</h3></div>
        {payments === null ? <Loading /> : !payments.length ? <p className="hint">No payments yet.</p> : (
          <div className="tbl-wrap block"><table>
            <thead><tr><th>Date</th><th>How</th><th>Reference</th><th className="r">Amount</th><th>Proof</th><th /></tr></thead>
            <tbody>{payments.map((p) => (
              <tr key={p.id}>
                <td className="num">{shortDate(p.paid_on)}</td><td>{p.method}{p.recorded_by && <div className="hint">by {p.recorded_by}</div>}</td>
                <td>{p.reference || '—'}{p.note && <div className="hint">{p.note}</div>}</td>
                <td className="r num">{money(p.amount)}</td>
                <td>{p.proof_path ? <button className="linkbtn" type="button" onClick={() => openProof(p.proof_path)}>View</button> : <span className="hint">—</span>}</td>
                <td>{me?.role === 'owner' && (confirmDel === p.id
                  ? <button className="btn small danger" type="button" onClick={() => removePayment(p)}>Confirm</button>
                  : <button className="x" type="button" aria-label="Remove payment" onClick={() => setConfirmDel(p.id)}>×</button>)}</td>
              </tr>))}</tbody>
          </table></div>
        )}

        {!job.invoice_voided_at && state !== 'Paid' && (
          <form className="pay-form" onSubmit={record}>
            <b>Record a payment</b>
            <div className="fgrid" style={{ marginTop: 8 }}>
              <div className="field"><label htmlFor="pf-amt">Amount (R)</label>
                <input id="pf-amt" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={bal.toFixed(2)} />
                <span className="hint" style={{ display: 'flex', gap: 10 }}>
                  <button className="linkbtn" type="button" onClick={() => setForm({ ...form, amount: bal.toFixed(2) })}>Full balance</button>
                  {!n(job.amount_paid) && <button className="linkbtn" type="button" onClick={() => setForm({ ...form, amount: deposit.toFixed(2) })}>Deposit</button>}</span></div>
              <div className="field"><label htmlFor="pf-date">Date received</label><input id="pf-date" type="date" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} /></div>
              <div className="field"><label htmlFor="pf-m">How</label><select id="pf-m" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
              <div className="field"><label htmlFor="pf-ref">Reference (optional)</label><input id="pf-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="What the bank statement says" /></div>
              <div className="field"><label htmlFor="pf-proof">Proof of payment (optional)</label><input id="pf-proof" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} /></div>
              <div className="field"><label htmlFor="pf-note">Note (optional)</label><input id="pf-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            </div>
            <div style={{ marginTop: 12 }}><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button></div>
          </form>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn" type="button" onClick={() => setShowDoc(true)}>View / print / email invoice</button>
          <button className="btn" type="button" onClick={onStatement}>Customer statement</button>
          {me?.role === 'owner' && !job.invoice_voided_at && !n(job.amount_paid) && (voiding === null
            ? <button className="btn ghost" type="button" onClick={() => setVoiding('')}>Void invoice</button>
            : <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                <input aria-label="Reason for voiding" value={voiding} onChange={(e) => setVoiding(e.target.value)} placeholder="Why? e.g. customer cancelled" style={{ width: 240 }} />
                <button className="btn small danger" type="button" onClick={voidInvoice}>Confirm void</button>
                <button className="btn small ghost" type="button" onClick={() => setVoiding(null)}>Cancel</button></span>)}
        </div>
      </div>
      {showDoc && <QuoteDoc job={job} settings={settings} onClose={() => setShowDoc(false)} onSent={(msg) => { toast(msg); setShowDoc(false) }} />}
    </div>
  )
}

function Statement({ customer, jobs, settings, onClose }) {
  const [payments, setPayments] = useState(null)
  useEffect(() => {
    const ids = jobs.map((j) => j.id)
    if (!ids.length) { setPayments([]); return }
    supabase.from('payments').select('*').in('job_id', ids).then(({ data }) => setPayments(data || []))
  }, [customer.id])
  if (!payments) return null
  const rows = [
    ...jobs.filter((j) => !j.invoice_voided_at).map((j) => ({ date: j.invoice_date || j.created_at.slice(0, 10), what: `Invoice ${j.invoice_no}: ${j.title}`, debit: n(j.invoice_total) })),
    ...payments.map((p) => ({ date: p.paid_on, what: `Payment received (${p.method}${p.reference ? `, ${p.reference}` : ''}) · ${jobs.find((j) => j.id === p.job_id)?.invoice_no || ''}`, credit: n(p.amount) })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  let bal = 0
  rows.forEach((r) => { bal += (r.debit || 0) - (r.credit || 0); r.balance = bal })
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="doc-bar">
        <span className="label" style={{ color: '#fff' }}>Customer statement</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn small primary" type="button" onClick={() => window.print()}>Print / save PDF</button>
          <button className="btn small" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="doc">
        <div className="dh">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <img src="/logo.webp" alt="NJR Steelworks" />
            <div><b style={{ fontFamily: 'var(--f-display)', fontSize: '1.6rem' }}>NJR STEELWORKS</b><div className="muted">George, Western Cape</div>
              {settings.people.map((p) => <div className="muted" key={p.name}>{p.name} {p.phone}{p.email && ` · ${p.email}`}</div>)}</div>
          </div>
          <div style={{ textAlign: 'right' }}><h2>Statement</h2><div className="muted">{shortDate(today())}</div></div>
        </div>
        <p style={{ margin: '16px 0' }}><span className="muted">For</span><br /><b>{customer.customer}</b>{customer.phone && <><br />{customer.phone}</>}{customer.email && <><br />{customer.email}</>}</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Details</th><th className="r">Charged</th><th className="r">Paid</th><th className="r">Balance</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td className="num">{shortDate(r.date)}</td><td>{r.what}</td><td className="r num">{r.debit ? money(r.debit) : ''}</td><td className="r num">{r.credit ? money(r.credit) : ''}</td><td className="r num">{money(r.balance)}</td></tr>)}</tbody>
        </table></div>
        <div className="totals num"><span className="grand">Amount due</span><span className="grand">{money(Math.max(0, bal))}</span></div>
        {settings.bank_details && <div className="terms">Banking details:{'\n'}{settings.bank_details}</div>}
      </div>
    </div>
  )
}
