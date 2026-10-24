import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, customerLines, n } from '../costing.js'
import { addDays, money, money0, shortDate } from '../format.js'
import { Loading, ErrorNote, ListHead, SumStrip, Status, rowProps, BillTo } from './ui.jsx'
import QuoteDoc from './QuoteDoc.jsx'

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

const VIEWS = ['All invoices', 'Unpaid', 'Overdue', 'Partly paid', 'Paid', 'Void']

// Invoices, Zoho style: summary of what's owed, one clean list, and each invoice opens as its own page.
export default function Invoices({ settings, me, toast, target, go }) {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('All invoices')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(target?.jobId || null)

  const load = async () => {
    const { data, error } = await supabase.from('jobs').select('*').not('invoice_no', 'is', null)
      .order('invoice_date', { ascending: false }).order('invoice_no', { ascending: false })
    setJobs(data || []); setError(error)
  }
  useEffect(() => { load() }, [])

  if (!jobs) return error ? <ErrorNote error={error} /> : <Loading />

  const open = openId && jobs.find((j) => j.id === openId)
  if (open) return <InvoiceView job={open} jobs={jobs} settings={settings} me={me} toast={toast} go={go} onBack={() => setOpenId(null)} onChanged={load} />

  const rows = jobs.map((j) => ({ j, st: invoiceStatus(j, settings), state: invoiceState(j), bal: balanceOf(j), due: dueDate(j, settings) }))
  const live = rows.filter((x) => x.state !== 'Void')
  const owing = live.reduce((a, x) => a + x.bal, 0)
  const dueToday = live.filter((x) => x.bal > 0 && x.due === today()).reduce((a, x) => a + x.bal, 0)
  const in30 = live.filter((x) => x.bal > 0 && x.due && x.due >= today() && daysBetween(today(), x.due) <= 30).reduce((a, x) => a + x.bal, 0)
  const overdue = live.filter((x) => x.st.overdue > 0).reduce((a, x) => a + x.bal, 0)

  const needle = q.trim().toLowerCase()
  const shown = rows
    .filter(({ state, st }) => view === 'All invoices' || (view === 'Unpaid' ? ['Unpaid', 'Part paid'].includes(state) : view === 'Overdue' ? st.overdue > 0 : view === 'Partly paid' ? state === 'Part paid' : state === view))
    .filter(({ j }) => !needle || [j.invoice_no, j.quote_no, j.customer, j.phone, j.title].some((v) => String(v || '').toLowerCase().includes(needle)))

  return (
    <>
      <ListHead views={VIEWS} view={view} setView={setView} q={q} setQ={setQ} searchLabel="Search invoices" />
      <ErrorNote error={error} />
      <SumStrip items={[
        ['Total owing', money0(owing), () => setView('Unpaid')],
        ['Due today', money0(dueToday), null, dueToday > 0 ? 'warn' : null],
        ['Due within 30 days', money0(in30)],
        ['Overdue', money0(overdue), () => setView('Overdue'), overdue > 0 ? 'warn' : null],
      ]} />
      {!shown.length ? <div className="card hint">{jobs.length ? 'No invoices in this view.' : 'No invoices yet. A quote becomes an invoice when the customer accepts it (stage Received).'}</div> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Invoice #</th><th>Customer</th><th>Status</th><th>Due date</th><th className="r">Amount</th><th className="r">Balance due</th></tr></thead>
          <tbody>{shown.map(({ j, st, bal, due, state }) => (
            <tr key={j.id} {...rowProps(() => setOpenId(j.id))}>
              <td className="num">{j.invoice_date ? shortDate(j.invoice_date) : '—'}</td>
              <td className="num lnk">{j.invoice_no}</td>
              <td>{j.customer}</td>
              <td><Status text={st.text} tone={st.tone} /></td>
              <td className="num">{due ? shortDate(due) : '—'}</td>
              <td className="r num">{money(j.invoice_total)}</td>
              <td className="r num">{state === 'Void' ? '—' : money(bal)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  )
}

// One invoice as its own page: actions on top, the invoice as the customer sees it, then payments.
function InvoiceView({ job, jobs, settings, me, toast, go, onBack, onChanged }) {
  const [payments, setPayments] = useState(null)
  const [paying, setPaying] = useState(false)
  const [more, setMore] = useState(false)
  const [showDoc, setShowDoc] = useState(false)
  const [statement, setStatement] = useState(false)
  const [voiding, setVoiding] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [error, setError] = useState(null)
  const st = invoiceStatus(job, settings)
  const bal = balanceOf(job)
  const t = calc(job)
  const lines = customerLines(job)
  const canPay = !job.invoice_voided_at && invoiceState(job) !== 'Paid'

  const load = () => supabase.from('payments').select('*').eq('job_id', job.id).order('paid_on').then(({ data, error }) => { setPayments(data || []); setError(error) })
  useEffect(() => { load() }, [job.id, job.amount_paid])

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
    <>
      <div className="rec-bar">
        <h1><button className="btn small" type="button" aria-label="Back to invoices" onClick={onBack}>←</button><span className="num">{job.invoice_no}</span></h1>
        <div className="rec-acts">
          {!job.invoice_voided_at && <button className="btn" type="button" onClick={() => go('cost', { jobId: job.id })}>Edit</button>}
          <button className="btn" type="button" onClick={() => setShowDoc('email')}>Email</button>
          <button className="btn" type="button" onClick={() => setShowDoc('view')}>View / print</button>
          {canPay && <button className="btn primary" type="button" onClick={() => setPaying(!paying)}>Record payment</button>}
          <div className="menu-more">
            <button className="btn" type="button" aria-label="More" aria-expanded={more} onClick={() => setMore(!more)}>⋯</button>
            {more && <div>
              <button type="button" onClick={() => { setMore(false); setStatement(true) }}>Customer statement</button>
              <button type="button" onClick={() => { setMore(false); go('customers', { name: job.customer }) }}>Open customer</button>
              {me?.role === 'owner' && !job.invoice_voided_at && !n(job.amount_paid) && <button type="button" onClick={() => { setMore(false); setVoiding('') }}>Void invoice</button>}
            </div>}
          </div>
        </div>
      </div>
      <div className="rec-meta">
        <Status text={st.text} tone={st.tone} />
        {!job.invoice_voided_at && <span>Balance due <b className="num" style={{ color: 'var(--fg)' }}>{money(bal)}</b></span>}
        {n(job.amount_paid) > 0 && <span>Paid <span className="num">{money(job.amount_paid)}</span></span>}
        <span>Due {dueDate(job, settings) ? shortDate(dueDate(job, settings)) : '—'}</span>
        <span>{job.quote_no}</span>
      </div>
      <ErrorNote error={error} />
      {job.invoice_voided_at && <div className="errmsg" style={{ marginBottom: 12 }}>Void since {shortDate(job.invoice_voided_at)}: {job.invoice_void_reason}</div>}
      {voiding !== null && (
        <div className="card block" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label="Reason for voiding" value={voiding} onChange={(e) => setVoiding(e.target.value)} placeholder="Why? e.g. customer cancelled" style={{ maxWidth: 320 }} />
          <button className="btn small danger" type="button" onClick={voidInvoice}>Confirm void</button>
          <button className="btn small ghost" type="button" onClick={() => setVoiding(null)}>Cancel</button>
        </div>)}
      {paying && canPay && <PaymentForm job={job} bal={bal} me={me} toast={toast} onDone={async () => { setPaying(false); await load(); onChanged() }} onCancel={() => setPaying(false)} />}

      <div className="paper">
        <div className="ph-row">
          <div><b style={{ fontFamily: 'var(--f-display)', fontSize: '1.5rem' }}>NJR STEELWORKS</b><div className="hint">George, Western Cape</div></div>
          <div style={{ textAlign: 'right' }}><b style={{ fontFamily: 'var(--f-display)', fontSize: '1.5rem' }}>TAX INVOICE</b>
            <div className="hint num">{job.invoice_date && shortDate(job.invoice_date)}{dueDate(job, settings) && ` · due ${n(settings.payment_terms) ? shortDate(dueDate(job, settings)) : 'on receipt'}`}</div></div>
        </div>
        <BillTo who={job} label="Bill to" mutedClass="hint" />
        <table>
          <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Amount excl. VAT</th></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}><td>{l.desc}</td><td className="r num">{l.qty}</td><td className="r num">{money(l.amount)}</td></tr>)}</tbody>
        </table>
        <div className="tots num">
          <div><span className="hint">Sub total</span><span>{money(t.excl)}</span></div>
          <div><span className="hint">VAT {job.rates.vat}%</span><span>{money(t.vat)}</span></div>
          <div className="grand"><span>Total</span><span>{money(t.total)}</span></div>
          {n(job.amount_paid) > 0 && <div><span className="hint">Paid</span><span>−{money(job.amount_paid)}</span></div>}
          {!job.invoice_voided_at && <div><b>Balance due</b><b>{money(bal)}</b></div>}
        </div>
      </div>

      <div className="block-head"><h3>Payments received</h3></div>
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

      {showDoc && <QuoteDoc job={job} settings={settings} email={showDoc === 'email'} onClose={() => setShowDoc(false)} onSent={(msg) => { toast(msg); setShowDoc(false) }} />}
      {statement && <Statement customer={job} jobs={jobs.filter((j) => sameCustomer(j, job))} settings={settings} onClose={() => setStatement(false)} />}
    </>
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
