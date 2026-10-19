import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, STATUSES } from '../costing.js'
import { money, shortDate } from '../format.js'
import { Pill, Loading, ErrorNote } from './ui.jsx'

export function JobsTable({ jobs, go }) {
  if (!jobs.length) return <div className="card hint">No jobs here yet. Cost a website request, or start a new costing.</div>
  return (
    <div className="tbl-wrap"><table>
      <thead><tr><th>Quote</th><th>Date</th><th>Customer</th><th>Job</th><th>Status</th><th className="r">Total incl. VAT</th><th className="r">Margin</th></tr></thead>
      <tbody>
        {jobs.map((j) => {
          const t = calc(j)
          const open = () => go('cost', { jobId: j.id })
          return (
            <tr key={j.id} className="clickable" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
              <td className="num">{j.quote_no}</td>
              <td className="num">{shortDate(j.quote_date)}</td>
              <td>{j.customer}</td>
              <td>{j.title}{j.units > 1 && <span className="hint"> × {j.units}</span>}</td>
              <td><Pill status={j.status} /></td>
              <td className="r num">{money(t.total)}</td>
              <td className="r num">{t.margin.toFixed(1)}%</td>
            </tr>
          )
        })}
      </tbody>
    </table></div>
  )
}

export default function Jobs({ go }) {
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('Open')

  useEffect(() => {
    supabase.from('jobs').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => { setJobs(data || []); setError(error) })
  }, [])

  const filters = ['Open', 'All', ...STATUSES]
  const shown = (jobs || []).filter((j) =>
    filter === 'All' ? true : filter === 'Open' ? !['Paid', 'Declined'].includes(j.status) : j.status === filter)

  return (
    <>
      <div className="pagehead">
        <div><h1>Quotes &amp; jobs</h1><p>Every quote, from draft to paid. Click a row to open its costing.</p></div>
        <button className="btn primary" type="button" onClick={() => go('cost', null)}>New costing</button>
      </div>
      <div className="filters" role="group" aria-label="Filter by status">
        {filters.map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
      </div>
      <ErrorNote error={error} />
      {jobs === null ? <Loading /> : <JobsTable jobs={shown} go={go} />}
    </>
  )
}
