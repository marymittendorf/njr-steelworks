import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { addDays, money, money0, shortDate } from '../format.js'
import { Loading, ErrorNote, BillTo, matches, openStored } from './ui.jsx'
import QuoteDoc, { DocPaper } from './QuoteDoc.jsx'
import JobCard from './JobCard.jsx'

export const today = () => new Date().toISOString().slice(0, 10)
const METHODS = ['EFT', 'Cash', 'Card', 'Other']
export const balanceOf = (j) => Math.max(0, Math.round((n(j.invoice_total) - n(j.amount_paid)) * 100) / 100)
export function invoiceState(j) {
  if (j.invoice_voided_at) return 'Void'
  if (n(j.invoice_total) > 0 && balanceOf(j) <= 0.5) return 'Paid'
  if (n(j.amount_paid) > 0) return 'Part paid'
  return 'Unpaid'
}
export const sameCustomer = (a, b) => a.customer.trim().toLowerCase() === b.customer.trim().toLowerCase() || Boolean(a.phone && b.phone && a.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, ''))

// Due date = invoice date + payment terms (Settings; 0 = due on receipt).
export const dueDate = (j, settings) => (j.invoice_date ? addDays(j.invoice_date, n(settings.payment_terms)) : null)
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)
const plural = (d) => `${d} DAY${d === 1 ? '' : 'S'}`

// Zoho-style status: OVERDUE BY 8 DAYS, DUE TODAY, DUE IN 27 DAYS, PARTLY PAID, PAID, VOID.
export function invoiceStatus(j, settings) {
  const state = invoiceState(j)
  if (state === 'Void') return { text: 'Void', tone: 'muted', overdue: 0 }
  if (state === 'Paid') return { text: 'Paid', tone: 'good', overdue: 0 }
  const due = dueDate(j, settings)
  const late = due ? daysBetween(due, today()) : 0
  if (late > 0) return { text: `Overdue by ${plural(late)}`, tone: 'warn', overdue: late }
  if (state === 'Part paid') return { text: 'Partly paid', tone: 'info', overdue: 0 }
  if (late === 0) return { text: 'Due today', tone: 'warn', overdue: 0 }
  return { text: `Due in ${plural(-late)}`, tone: 'info', overdue: 0 }
}

const VIEWS = ['Unpaid invoices', 'Overdue invoices', 'Partly paid invoices', 'Paid invoices', 'Void invoices', 'All invoices']
const inView = (view, state, st) => view === 'All invoices'
  || (view === 'Unpaid invoices' ? ['Unpaid', 'Part paid'].includes(state)
    : view === 'Overdue invoices' ? st.overdue > 0
      : view === 'Partly paid invoices' ? state === 'Part paid'
        : view === 'Paid invoices' ? state === 'Paid' : state === 'Void')

// Invoices like Zoho: a slim list on the left, the chosen invoice on the right exactly as the
// customer gets it (white A4), with its actions on top and payments and emails underneath.
export default function Invoices({ settings, prices, me, toast, target, go }) {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState(target?.jobId ? 'All invoices' : 'Unpaid invoices')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(target?.jobId || null)

  const load = async () => {
    const { data, error } = await supabase.from('jobs').select('*').not('invoice_no', 'is', null)
      .order('invoice_date', { ascending: false }).order('invoice_no', { ascending: false })
    setJobs(data || []); setError(error)
  }
  useEffect(() => { load() }, [])

  if (!jobs) return error ? <ErrorNote error={error} /> : <Loading />

  const rows = jobs.map((j) => ({ j, st: invoiceStatus(j, settings), state: invoiceState(j), bal: balanceOf(j) }))
  const owing = rows.filter((x) => x.state !== 'Void').reduce((a, x) => a + x.bal, 0)
  // Searching looks through every invoice, whatever the view.
  const shown = rows
    .filter(({ state, st }) => q.trim() || inView(view, state, st))
    .filter(({ j }) => matches(q, j.invoice_no, j.quote_no, j.customer, j.customer_company, j.phone, j.email, j.title))
  const open = openId && jobs.find((j) => j.id === openId)

  return (
    <div className={`inv-split${open ? ' has-open' : ''}`}>
      <div className="inv-list">
        <div className="inv-list-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="sr-only" htmlFor="inv-view">Which invoices</label>
            <select id="inv-view" className="inv-view" value={view} onChange={(e) => setView(e.target.value)}>{VIEWS.map((v) => <option key={v}>{v}</option>)}</select>
            <span className="hint num" style={{ whiteSpace: 'nowrap' }}>{money0(owing)} due</span>
          </div>
          <input type="search" aria-label="Search invoices" placeholder="Search number or customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ErrorNote error={error} />
        <div className="inv-rows">
          {!shown.length && <p className="hint" style={{ padding: '12px 16px' }}>{jobs.length ? 'No invoices here.' : 'No invoices yet. Use Convert to invoice on a quote.'}</p>}
          {shown.map(({ j, st, state, bal }) => (
            <button key={j.id} type="button" className={`inv-row${j.id === openId ? ' on' : ''}`} onClick={() => setOpenId(j.id)}>
              <span className="inv-row-top"><span className="inv-cust">{j.customer_company || j.customer}</span><span className="num">{money(state === 'Unpaid' || state === 'Part paid' ? bal : j.invoice_total)}</span></span>
              <span className="inv-row-sub"><span className="num">{j.invoice_no} · {j.invoice_date ? shortDate(j.invoice_date) : '—'}</span><span className={`tx-${st.tone}`}>{st.text}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="inv-pane">
        {open
          ? <InvoicePane key={open.id} job={open} jobs={jobs} settings={settings} prices={prices} me={me} toast={toast} go={go} onBack={() => setOpenId(null)} onChanged={load} />
          : <div className="inv-empty hint">Choose an invoice on the left to see it here.</div>}
      </div>
    </div>
  )
}

// The chosen invoice: number, status and actions on top; the invoice as the customer gets it; then its history.
function InvoicePane({ job, jobs, settings, prices, me, toast, go, onBack, onChanged }) {
  const [payments, setPayments] = useState(null)
  const [emails, setEmails] = useState([])
  const [paying, setPaying] = useState(false)
  const [more, setMore] = useState(false)
  const [showDoc, setShowDoc] = useState(false)
  const [statement, setStatement] = useState(false)
  const [card, setCard] = useState(false)
  const [voiding, setVoiding] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [error, setError] = useState(null)
  const st = invoiceStatus(job, settings)
  const bal = balanceOf(job)
  const canPay = !job.invoice_voided_at && invoiceState(job) !== 'Paid'
  const pill = { good: 'pill-good', warn: 'pill-warn', info: 'pill-info', bad: 'pill-bad', muted: 'pill-muted' }[st.tone]

  const load = () => {
    supabase.from('payments').select('*').eq('job_id', job.id).order('paid_on').then(({ data, error }) => { setPayments(data || []); setError(error) })
    supabase.from('job_emails').select('*').eq('job_id', job.id).order('sent_at', { ascending: false }).then(({ data }) => setEmails(data || []))
  }
  useEffect(() => { load() }, [job.id, job.amount_paid])

  function openProof(path) { openStored('payment-proofs', path) }
  async function removePayment(p) {
    const { error } = await supabase.from('payments').delete().eq('id', p.id)
    if (error) { setError(error); return }
    setConfirmDel(null); toast('Payment removed'); load(); onChanged()
  }
  async function voidInvoice() {
    if (!voiding.trim()) { setError('Say why the invoice is void.'); return }
    const { error } = await supabase.from('jobs').update({ invoice_voided_at: new Date().toISOString(), invoice_void_reason: voiding.trim(), status: 'Declined' }).eq('id', job.id)
    if (error) { setError(error); return }
    setVoiding(null); toast(`${job.invoice_no} is void`); onChanged()
  }

  return (
    <div className="inv-pane-box">
      <div className="inv-pane-head">
        <div className="inv-title">
          <button className="btn small inv-back" type="button" aria-label="Back to the list" onClick={onBack}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b className="num" style={{ fontSize: '1.15rem' }}>{job.invoice_no}</b><span className={`pill2 ${pill}`}>{st.text}</span></div>
            <div className="hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.customer_company ? `${job.customer_company} · ${job.customer}` : job.customer}{!job.email && canPay && ' · no email on file'}</div>
          </div>
        </div>
        <div className="inv-acts">
          {!job.invoice_voided_at && <button type="button" onClick={() => go('cost', { jobId: job.id, invoice: true })}>✎ Edit</button>}
          {!job.invoice_voided_at && <button type="button" onClick={() => setShowDoc('email')}>✉ Email</button>}
          <button type="button" onClick={() => setShowDoc('view')}>⎙ PDF</button>
          <button type="button" onClick={() => setCard(true)}>Job card</button>
          <button type="button" onClick={() => setStatement(true)}>Statement</button>
          <div className="menu-more">
            <button type="button" aria-label="More" aria-expanded={more} onClick={() => setMore(!more)}>⋯</button>
            {more && <div>
              <button type="button" onClick={() => { setMore(false); go('customers', { name: job.customer }) }}>Open customer</button>
              {me?.role === 'owner' && !job.invoice_voided_at && !n(job.amount_paid) && <button type="button" onClick={() => { setMore(false); setVoiding('') }}>Void invoice</button>}
            </div>}
          </div>
          {canPay && <button type="button" className="inv-pay" onClick={() => setPaying(!paying)}>Record payment</button>}
        </div>
      </div>
      {(error || voiding !== null || (paying && canPay) || job.invoice_voided_at) && (
        <div style={{ padding: '0 18px' }}>
          <ErrorNote error={error} />
          {job.invoice_voided_at && <div className="errmsg">Void since {shortDate(job.invoice_voided_at)}: {job.invoice_void_reason}</div>}
          {voiding !== null && (
            <div className="card block" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
              <input aria-label="Reason for voiding" value={voiding} onChange={(e) => setVoiding(e.target.value)} placeholder="Why? e.g. customer cancelled" style={{ maxWidth: 320 }} />
              <button className="btn small danger" type="button" onClick={voidInvoice}>Confirm void</button>
              <button className="btn small ghost" type="button" onClick={() => setVoiding(null)}>Cancel</button>
            </div>)}
          {paying && canPay && <div style={{ marginTop: 12 }}><PaymentForm job={job} bal={bal} me={me} toast={toast} onDone={() => { setPaying(false); load(); onChanged() }} onCancel={() => setPaying(false)} /></div>}
        </div>)}

      <div className="inv-desk">
        <div className="inv-sheet"><DocPaper job={job} settings={settings} /></div>
        <div className="inv-history">
          <h4>Payments received</h4>
          {payments === null ? <Loading /> : !payments.length ? <p className="muted">No payments yet. Balance due {money(bal)}.</p> : (
            <table><tbody>{payments.map((p) => (
              <tr key={p.id}>
                <td className="num">{shortDate(p.paid_on)}</td><td>{p.method}{p.reference && ` · ${p.reference}`}{p.recorded_by && <span className="muted"> · by {p.recorded_by}</span>}</td>
                <td className="r num">{money(p.amount)}</td>
                <td>{p.proof_path && <button className="linkbtn" type="button" onClick={() => openProof(p.proof_path)}>Proof</button>}</td>
                <td>{me?.role === 'owner' && (confirmDel === p.id
                  ? <button className="btn small danger" type="button" onClick={() => removePayment(p)}>Confirm</button>
                  : <button className="x" type="button" aria-label="Remove payment" onClick={() => setConfirmDel(p.id)}>×</button>)}</td>
              </tr>))}</tbody></table>
          )}
          <h4>Emails</h4>
          {!emails.length ? <p className="muted">Not emailed yet.</p> : (
            <ul>{emails.map((e) => <li key={e.id}>{e.kind} emailed to {e.sent_to} · {shortDate(e.sent_at)}{e.sent_by && ` · by ${e.sent_by}`}</li>)}</ul>
          )}
          {job.customer_response && <><h4>Online</h4><p>Quote {job.customer_response.toLowerCase()} online by {job.customer_response_name} · {shortDate(job.customer_response_at)}</p></>}
        </div>
      </div>

      {showDoc && <QuoteDoc job={job} settings={settings} email={showDoc === 'email'} onClose={() => setShowDoc(false)} onSent={(msg) => { toast(msg); setShowDoc(false); load() }} />}
      {card && <JobCard job={job} prices={prices} me={me} toast={toast} onClose={() => setCard(false)} onSaved={(u, opts) => { onChanged(); if (!opts?.keepOpen) setCard(false) }} />}
      {statement && <Statement customer={job} jobs={jobs.filter((j) => sameCustomer(j, job))} settings={settings} onClose={() => setStatement(false)} />}
    </div>
  )
}

function PaymentForm({ job, bal, me, toast, onDone, onCancel }) {
  const [form, setForm] = useState({ amount: '', paid_on: today(), method: 'EFT', reference: '', note: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const deposit = Math.round(n(job.invoice_total) * n(job.rates?.deposit ?? 50)) / 100

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
      toast(`${money(amount)} recorded on ${job.invoice_no}`); onDone()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  return (
    <form className="card block pay-form" onSubmit={record}>
      <b>Record a payment</b>
      <ErrorNote error={error} />
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
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save payment'}</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export function Statement({ customer, jobs, settings, onClose }) {
  const [payments, setPayments] = useState(null)
  useEffect(() => {
    const ids = jobs.map((j) => j.id)
    if (!ids.length) { setPayments([]); return }
    supabase.from('payments').select('*').in('job_id', ids).then(({ data }) => setPayments(data || []))
  }, [customer.id])
  if (!payments) return null
  const rows = [
    ...jobs.filter((j) => j.invoice_no && !j.invoice_voided_at).map((j) => ({ date: j.invoice_date || j.created_at.slice(0, 10), what: `Invoice ${j.invoice_no}: ${j.title}`, debit: n(j.invoice_total) })),
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
        <BillTo who={customer} />
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
