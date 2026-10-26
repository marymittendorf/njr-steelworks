import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, n } from '../costing.js'
import { addDays, money, money0, shortDate } from '../format.js'
import { Loading, ErrorNote, ListHead, SumStrip, Status, rowProps, matches } from './ui.jsx'

const today = () => new Date().toISOString().slice(0, 10)
const ACCEPTED = ['Received', 'In production', 'Ready', 'Delivered']

// DRAFT, SENT, EXPIRED, ACCEPTED, DECLINED: what a quote's status reads as on the list.
export function quoteStatus(j) {
  if (j.status === 'Declined') return { text: j.invoice_voided_at ? 'Void' : 'Declined', tone: 'bad' }
  if (ACCEPTED.includes(j.status)) return { text: j.invoice_no ? 'Invoiced' : 'Accepted', tone: 'good' }
  if (j.status === 'Quote sent') {
    const until = addDays(j.quote_date, n(j.rates?.validity) || 14)
    return until < today() ? { text: 'Expired', tone: 'warn' } : { text: 'Sent', tone: 'info' }
  }
  return { text: 'Draft', tone: 'muted' }
}

const VIEWS = ['Drafts and sent', 'All quotes', 'Draft', 'Sent', 'Expired', 'Accepted', 'Declined']
const inView = (view, j) => {
  const s = quoteStatus(j).text
  if (view === 'All quotes') return true
  if (view === 'Drafts and sent') return ['Draft', 'Sent', 'Expired'].includes(s)
  if (view === 'Accepted') return ['Accepted', 'Invoiced'].includes(s)
  if (view === 'Declined') return ['Declined', 'Void'].includes(s)
  return s === view
}

export default function Jobs({ go }) {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('Drafts and sent')
  const [q, setQ] = useState('')

  useEffect(() => {
    supabase.from('jobs').select('*').order('quote_date', { ascending: false }).order('created_at', { ascending: false })
      .then(({ data, error }) => { setJobs(data || []); setError(error) })
  }, [])

  if (!jobs) return error ? <ErrorNote error={error} /> : <Loading />

  const rows = jobs.map((j) => ({ j, t: calc(j), st: quoteStatus(j) }))
  const month = today().slice(0, 7)
  const waiting = rows.filter((x) => x.st.text === 'Sent')
  const drafts = rows.filter((x) => x.st.text === 'Draft')
  const wonMonth = rows.filter((x) => ['Accepted', 'Invoiced'].includes(x.st.text) && (x.j.invoice_date || x.j.accepted_at || '').slice(0, 7) === month)
  const sum = (list) => list.reduce((a, x) => a + x.t.total, 0)
  const needle = q.trim().toLowerCase()
  const shown = rows.filter(({ j }) => inView(view, j))
    .filter(({ j }) => matches(needle, j.quote_no, j.invoice_no, j.customer, j.customer_company, j.phone, j.email, j.title, (j.products || []).map((l) => l.name).join(' ')))

  return (
    <>
      <ListHead views={VIEWS} view={view} setView={setView} q={q} setQ={setQ} searchLabel="Search quotes" onNew={() => go('cost', null)} />
      <ErrorNote error={error} />
      <SumStrip items={[
        ['Drafts', String(drafts.length), () => setView('Draft')],
        ['Waiting for the customer', money0(sum(waiting)), () => setView('Sent')],
        ['Accepted this month', money0(sum(wonMonth)), () => setView('Accepted')],
      ]} />
      {!shown.length ? <div className="card hint">{jobs.length ? 'No quotes in this view.' : 'No quotes yet. Press + New, or open a website request.'}</div> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Quote #</th><th>Customer</th><th>Item</th><th>Status</th><th className="r">Amount</th></tr></thead>
          <tbody>{shown.map(({ j, t, st }) => (
            <tr key={j.id} {...rowProps(() => (j.invoice_no ? go('invoices', { jobId: j.id }) : go('cost', { jobId: j.id })))}>
              <td className="num">{shortDate(j.quote_date)}</td>
              <td className="num lnk">{j.quote_no}</td>
              <td>{j.customer}</td>
              <td>{j.title}</td>
              <td><Status text={st.text} tone={st.tone} /></td>
              <td className="r num">{money(t.total)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  )
}
