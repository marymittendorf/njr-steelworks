import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc } from '../costing.js'
import { money0 } from '../format.js'
import { Loading, SumStrip, rowProps } from './ui.jsx'
import { balanceOf, invoiceStatus } from './Invoices.jsx'
import { quoteStatus } from './Jobs.jsx'
import { jobParts } from './PartsChecklist.jsx'

// Home: the numbers that matter and a short list of what needs doing, each one click away.
export default function Dashboard({ go, settings, prices }) {
  const [d, setD] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('jobs').select('*'),
      supabase.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'New'),
      supabase.from('bank_lines').select('id', { count: 'exact', head: true }).eq('status', 'unallocated'),
    ]).then(([j, r, b]) => setD({ jobs: j.data || [], newReq: r.count || 0, bankOpen: b.count || 0 }))
  }, [])

  if (!d) return <Loading />

  const month = new Date().toISOString().slice(0, 7)
  const jobs = d.jobs
  const sent = jobs.filter((j) => quoteStatus(j).text === 'Sent')
  const expired = jobs.filter((j) => quoteStatus(j).text === 'Expired')
  const invoices = jobs.filter((j) => j.invoice_no && !j.invoice_voided_at)
  const owing = invoices.reduce((a, j) => a + balanceOf(j), 0)
  const overdue = invoices.filter((j) => invoiceStatus(j, settings).overdue > 0)
  const monthInv = invoices.filter((j) => (j.invoice_date || '').slice(0, 7) === month).map(calc)
  const profit = monthInv.reduce((a, t) => a + t.excl - t.cost, 0)
  const open = jobs.filter((j) => ['Received', 'In production'].includes(j.status))
  const short = open.filter((j) => { const p = jobParts(j); return p.length && p.some((x) => !x.have) })
  const ready = jobs.filter((j) => j.status === 'Ready' && j.job_type !== 'Built for stock')
  const noPrice = prices.filter((p) => p.active && !Number(p.cost))
  const s = (k, one, many) => `${k} ${k === 1 ? one : many}`

  const todo = [
    d.newReq && [s(d.newReq, 'new website request', 'new website requests'), 'requests'],
    overdue.length && [`${s(overdue.length, 'invoice is', 'invoices are')} overdue (${money0(overdue.reduce((a, j) => a + balanceOf(j), 0))})`, 'invoices'],
    short.length && [`${s(short.length, 'order is', 'orders are')} still waiting for parts`, 'orders'],
    ready.length && [`${s(ready.length, 'job is', 'jobs are')} ready for delivery or collection`, 'orders'],
    expired.length && [`${s(expired.length, 'quote has', 'quotes have')} expired without an answer`, 'jobs'],
    d.bankOpen && [`${s(d.bankOpen, 'bank line needs', 'bank lines need')} matching`, 'banking'],
    noPrice.length && [`${s(noPrice.length, 'stock item has', 'stock items have')} no price yet`, 'stock'],
  ].filter(Boolean)

  return (
    <>
      <div className="lh"><h1>Home</h1><div className="lh-tools"><button className="btn primary" type="button" onClick={() => go('cost', null)}>+ New quote</button></div></div>
      <SumStrip items={[
        ['Website requests', String(d.newReq), () => go('requests')],
        ['Quotes waiting', money0(sent.reduce((a, j) => a + calc(j).total, 0)), () => go('jobs')],
        ['Customers owe', money0(owing), () => go('invoices'), overdue.length ? 'warn' : null],
        ['Profit this month', money0(profit), () => go('reports')],
      ]} />
      <div className="tbl-wrap"><table>
        <thead><tr><th>Needs attention</th><th /></tr></thead>
        <tbody>
          {todo.map(([text, page]) => (
            <tr key={text} {...rowProps(() => go(page))}><td>{text}</td><td className="r lnk">Open</td></tr>))}
          {!todo.length && <tr><td colSpan="2" className="hint">Nothing waiting. All up to date.</td></tr>}
        </tbody>
      </table></div>
    </>
  )
}
