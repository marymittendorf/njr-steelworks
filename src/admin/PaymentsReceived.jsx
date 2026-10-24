import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money, money0, shortDate } from '../format.js'
import { Loading, ErrorNote, ListHead, SumStrip, rowProps } from './ui.jsx'

const VIEWS = ['This month', 'Last month', 'This year', 'All payments']
const monthOf = (offset) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0, 7) }

// Every payment received against an invoice, newest first.
export default function PaymentsReceived({ go }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('This month')
  const [q, setQ] = useState('')

  useEffect(() => {
    supabase.from('payments').select('*, jobs(customer, invoice_no, quote_no)').order('paid_on', { ascending: false }).order('created_at', { ascending: false })
      .then(({ data, error }) => { setList(data || []); setError(error) })
  }, [])

  if (!list) return error ? <ErrorNote error={error} /> : <Loading />

  const year = new Date().toISOString().slice(0, 4)
  const inView = (p) => view === 'All payments' || (view === 'This year' ? p.paid_on.startsWith(year) : p.paid_on.startsWith(monthOf(view === 'This month' ? 0 : -1)))
  const total = (rows) => rows.reduce((a, p) => a + n(p.amount), 0)
  const needle = q.trim().toLowerCase()
  const shown = list.filter(inView)
    .filter((p) => !needle || [p.jobs?.customer, p.jobs?.invoice_no, p.reference, p.method].some((v) => String(v || '').toLowerCase().includes(needle)))

  return (
    <>
      <ListHead views={VIEWS} view={view} setView={setView} q={q} setQ={setQ} searchLabel="Search payments" />
      <ErrorNote error={error} />
      <SumStrip items={[
        ['This month', money0(total(list.filter((p) => p.paid_on.startsWith(monthOf(0))))), () => setView('This month')],
        ['Last month', money0(total(list.filter((p) => p.paid_on.startsWith(monthOf(-1))))), () => setView('Last month')],
        ['This year', money0(total(list.filter((p) => p.paid_on.startsWith(year)))), () => setView('This year')],
        ['In this view', money0(total(shown))],
      ]} />
      {!shown.length ? <div className="card hint">{list.length ? 'No payments in this view.' : 'No payments yet. Record one on an invoice, or match a bank line under Banking.'}</div> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Date</th><th>Customer</th><th>Invoice #</th><th>How</th><th>Reference</th><th className="r">Amount</th></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id} {...rowProps(() => go('invoices', { jobId: p.job_id }))}>
              <td className="num">{shortDate(p.paid_on)}</td>
              <td>{p.jobs?.customer || '—'}</td>
              <td className="num lnk">{p.jobs?.invoice_no || p.jobs?.quote_no || '—'}</td>
              <td>{p.method}</td>
              <td>{p.reference || '—'}</td>
              <td className="r num">{money(p.amount)}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  )
}
