import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, n } from '../costing.js'
import { money, money0, shortDate, waNumber } from '../format.js'
import { Loading, ErrorNote, ListHead, SumStrip, Status, rowProps } from './ui.jsx'
import { balanceOf, invoiceStatus, Statement } from './Invoices.jsx'
import { quoteStatus } from './Jobs.jsx'
import { blankJob } from './JobCosting.jsx'

const keyOf = (name) => String(name || '').trim().toLowerCase()

// Customers come from the quotes and invoices themselves (one row per customer name),
// with the newest cell number and email on file.
function groupCustomers(jobs) {
  const map = new Map()
  for (const j of jobs) {
    if (j.job_type === 'Built for stock' || !keyOf(j.customer)) continue
    const k = keyOf(j.customer)
    const c = map.get(k) || { key: k, customer: j.customer.trim(), phone: '', email: '', customer_company: '', customer_address: '', customer_vat: '', jobs: [], invoiced: 0, paid: 0, owing: 0, last: '' }
    c.jobs.push(j)
    if (!c.phone && j.phone) c.phone = j.phone
    if (!c.email && j.email) c.email = j.email
    for (const f of ['customer_company', 'customer_address', 'customer_vat']) if (!c[f] && j[f]) c[f] = j[f]
    if (j.invoice_no && !j.invoice_voided_at) { c.invoiced += n(j.invoice_total); c.paid += n(j.amount_paid); c.owing += balanceOf(j) }
    const d = j.invoice_date || j.quote_date || ''
    if (d > c.last) c.last = d
    map.set(k, c)
  }
  return [...map.values()].sort((a, b) => a.customer.localeCompare(b.customer))
}

const VIEWS = ['All customers', 'Owing money']

export default function Customers({ settings, go, target, toast }) {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('All customers')
  const [q, setQ] = useState('')
  const [openKey, setOpenKey] = useState(target?.name ? keyOf(target.name) : null)

  const load = () => supabase.from('jobs').select('*').order('quote_date', { ascending: false })
    .then(({ data, error }) => { setJobs(data || []); setError(error) })
  useEffect(() => { load() }, [])

  if (!jobs) return error ? <ErrorNote error={error} /> : <Loading />
  const customers = groupCustomers(jobs)
  const open = openKey && customers.find((c) => c.key === openKey)
  if (open) return <CustomerView c={open} settings={settings} go={go} toast={toast} onBack={() => setOpenKey(null)}
    onSaved={async (name) => { await load(); setOpenKey(keyOf(name)) }} />

  const needle = q.trim().toLowerCase()
  const shown = customers.filter((c) => view === 'All customers' || c.owing > 0.5)
    .filter((c) => !needle || [c.customer, c.phone, c.email].some((v) => String(v || '').toLowerCase().includes(needle)))
  const owing = customers.reduce((a, c) => a + c.owing, 0)

  return (
    <>
      <ListHead views={VIEWS} view={view} setView={setView} q={q} setQ={setQ} searchLabel="Search customers" onNew={() => go('cost', null)} newLabel="New quote" />
      <ErrorNote error={error} />
      <SumStrip items={[
        ['Customers', String(customers.length)],
        ['Owing money', String(customers.filter((c) => c.owing > 0.5).length), () => setView('Owing money')],
        ['Total owing', money0(owing), () => setView('Owing money'), owing > 0.5 ? 'warn' : null],
      ]} />
      {!shown.length ? <div className="card hint">{customers.length ? 'No customers in this view.' : 'Customers appear here once you make a quote for them.'}</div> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Name</th><th>Cell</th><th>Email</th><th className="r">Quotes</th><th>Last</th><th className="r">Invoiced</th><th className="r">Owing</th></tr></thead>
          <tbody>{shown.map((c) => (
            <tr key={c.key} {...rowProps(() => setOpenKey(c.key))}>
              <td className="lnk">{c.customer}</td>
              <td className="num">{c.phone || '—'}</td>
              <td>{c.email || '—'}</td>
              <td className="r num">{c.jobs.length}</td>
              <td className="num">{c.last ? shortDate(c.last) : '—'}</td>
              <td className="r num">{money(c.invoiced)}</td>
              <td className={`r num${c.owing > 0.5 ? ' tx-warn' : ''}`}>{money(c.owing)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  )
}

function CustomerView({ c, settings, go, toast, onBack, onSaved }) {
  const [payments, setPayments] = useState(null)
  const [statement, setStatement] = useState(false)
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // A customer is the name on their quotes and invoices, so editing updates every one of them.
  async function save() {
    const name = edit.customer.trim()
    if (!name) { setError('The customer needs a name.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('jobs')
      .update({
        customer: name, phone: edit.phone.trim() || null, email: edit.email.trim() || null,
        customer_company: edit.customer_company.trim() || null, customer_address: edit.customer_address.trim() || null, customer_vat: edit.customer_vat.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .in('id', c.jobs.map((j) => j.id))
    setBusy(false)
    if (error) { setError(error); return }
    setEdit(null); toast(`Saved ${name} on ${c.jobs.length} quote${c.jobs.length === 1 ? '' : 's'} and invoice${c.jobs.length === 1 ? '' : 's'}`); onSaved(name)
  }
  useEffect(() => {
    const ids = c.jobs.map((j) => j.id)
    supabase.from('payments').select('*').in('job_id', ids).order('paid_on', { ascending: false }).then(({ data }) => setPayments(data || []))
  }, [c.key])
  const byId = Object.fromEntries(c.jobs.map((j) => [j.id, j]))
  const newQuote = () => go('cost', { draft: { ...blankJob(settings), customer: c.customer, phone: c.phone, email: c.email, customer_company: c.customer_company, customer_address: c.customer_address, customer_vat: c.customer_vat } })

  return (
    <>
      <div className="rec-bar">
        <h1><button className="btn small" type="button" aria-label="Back to customers" onClick={onBack}>←</button>{c.customer}</h1>
        <div className="rec-acts">
          {c.phone && <a className="btn" href={`https://wa.me/${waNumber(c.phone)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
          <button className="btn" type="button" onClick={() => setEdit({ customer: c.customer, phone: c.phone || '', email: c.email || '', customer_company: c.customer_company || '', customer_address: c.customer_address || '', customer_vat: c.customer_vat || '' })}>Edit</button>
          <button className="btn" type="button" onClick={() => setStatement(true)}>Statement</button>
          <button className="btn primary" type="button" onClick={newQuote}>+ New quote</button>
        </div>
      </div>
      <div className="rec-meta">
        {c.customer_company && <b style={{ color: 'var(--fg)' }}>{c.customer_company}</b>}
        {c.customer_vat && <span>VAT no. {c.customer_vat}</span>}
        {c.customer_address && <span>{c.customer_address.replace(/\n+/g, ', ')}</span>}
        {c.phone && <a className="num" href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>}
        {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
      </div>
      {edit && (
        <div className="card block">
          <div className="fgrid">
            <div className="field"><label htmlFor="cu-name">Name</label><input id="cu-name" value={edit.customer} onChange={(e) => setEdit({ ...edit, customer: e.target.value })} autoFocus /></div>
            <div className="field"><label htmlFor="cu-cell">Cell</label><input id="cu-cell" inputMode="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
            <div className="field"><label htmlFor="cu-company">Company</label><input id="cu-company" value={edit.customer_company} onChange={(e) => setEdit({ ...edit, customer_company: e.target.value })} /></div>
            <div className="field"><label htmlFor="cu-vat">VAT number</label><input id="cu-vat" value={edit.customer_vat} onChange={(e) => setEdit({ ...edit, customer_vat: e.target.value })} /></div>
            <div className="field full"><label htmlFor="cu-addr">Address</label><textarea id="cu-addr" style={{ minHeight: 70 }} value={edit.customer_address} onChange={(e) => setEdit({ ...edit, customer_address: e.target.value })} placeholder={'Street\nTown\nPostal code'} /></div>
            <div className="field full"><label htmlFor="cu-email">Email</label><input id="cu-email" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} placeholder="For emailing quotes and invoices" /></div>
          </div>
          <ErrorNote error={error} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save customer'}</button>
            <button className="btn ghost" type="button" onClick={() => { setEdit(null); setError(null) }}>Cancel</button>
            <span className="hint">Updates all {c.jobs.length} of their quotes and invoices.</span>
          </div>
        </div>)}
      <SumStrip items={[['Invoiced', money0(c.invoiced)], ['Paid', money0(c.paid)], ['Owing', money0(c.owing), null, c.owing > 0.5 ? 'warn' : null]]} />

      <div className="block-head"><h3>Quotes and invoices</h3></div>
      <div className="tbl-wrap block"><table>
        <thead><tr><th>Date</th><th>Number</th><th>Item</th><th>Status</th><th className="r">Amount</th><th className="r">Balance</th></tr></thead>
        <tbody>{c.jobs.map((j) => {
          const st = j.invoice_no ? invoiceStatus(j, settings) : quoteStatus(j)
          const openIt = () => (j.invoice_no ? go('invoices', { jobId: j.id }) : go('cost', { jobId: j.id }))
          return (
            <tr key={j.id} {...rowProps(openIt)}>
              <td className="num">{shortDate(j.invoice_date || j.quote_date)}</td>
              <td className="num lnk">{j.invoice_no || j.quote_no}</td>
              <td>{j.title}</td>
              <td><Status text={st.text} tone={st.tone} /></td>
              <td className="r num">{money(j.invoice_no ? j.invoice_total : calc(j).total)}</td>
              <td className="r num">{j.invoice_no && !j.invoice_voided_at ? money(balanceOf(j)) : '—'}</td>
            </tr>)
        })}</tbody>
      </table></div>

      <div className="block-head"><h3>Payments received</h3></div>
      {payments === null ? <Loading /> : !payments.length ? <p className="hint">No payments yet.</p> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Invoice #</th><th>How</th><th>Reference</th><th className="r">Amount</th></tr></thead>
          <tbody>{payments.map((p) => (
            <tr key={p.id} {...rowProps(() => go('invoices', { jobId: p.job_id }))}>
              <td className="num">{shortDate(p.paid_on)}</td><td className="num lnk">{byId[p.job_id]?.invoice_no}</td><td>{p.method}</td><td>{p.reference || '—'}</td><td className="r num">{money(p.amount)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {statement && <Statement customer={c.jobs[0]} jobs={c.jobs} settings={settings} onClose={() => setStatement(false)} />}
    </>
  )
}
