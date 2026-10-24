import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc } from '../costing.js'
import { money0 } from '../format.js'
import { JobsTable } from './Jobs.jsx'
import { Loading } from './ui.jsx'

const SEGMENTS = [
  ['Materials', 'm', 'var(--steel)'],
  ['Labour & consumables', 'l', 'var(--accent)'],
  ['Overhead', 'o', 'var(--info)'],
  ['Profit', 'p', 'var(--good)'],
]

export default function Dashboard({ go }) {
  const [jobs, setJobs] = useState(null)
  const [newReq, setNewReq] = useState(0)

  useEffect(() => {
    supabase.from('jobs').select('*').order('created_at', { ascending: false }).then(({ data }) => setJobs(data || []))
    supabase.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'New').then(({ count }) => setNewReq(count || 0))
  }, [])

  if (!jobs) return <Loading />

  const rows = jobs.map((j) => ({ j, t: calc(j) }))
  const sum = (a) => a.reduce((s, x) => s + x.t.total, 0)
  const awaiting = rows.filter((x) => x.j.status === 'Quote sent')
  const onHand = rows.filter((x) => x.j.job_type !== 'Built for stock' && ['Received', 'In production', 'Ready'].includes(x.j.status))
  const owed = rows.filter((x) => x.j.invoice_no && x.j.payment_status !== 'Paid')
  const won = rows.filter((x) => x.j.job_type !== 'Built for stock' && ['Received', 'In production', 'Ready', 'Delivered'].includes(x.j.status))
  const avgMargin = won.length ? won.reduce((a, x) => a + x.t.margin, 0) / won.length : 0
  const agg = won.reduce((a, { t }) => ({
    m: a.m + t.materials + t.galv + t.extras, l: a.l + t.labour + t.consumables, o: a.o + t.overhead, p: a.p + t.markup,
  }), { m: 0, l: 0, o: 0, p: 0 })
  const tot = agg.m + agg.l + agg.o + agg.p

  return (
    <>
      <div className="pagehead">
        <div><h1>Dashboard</h1><p>Workshop overview. Amounts include VAT.</p></div>
        <button className="btn primary" type="button" onClick={() => go('cost', null)}>New costing</button>
      </div>
      <div className="kpis">
        <button type="button" className="kpi" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go('requests')}>
          <span className="label">New requests</span><b className="num">{newReq}</b><span className="sub">From the website form</span></button>
        <div className="kpi"><span className="label">Quotes awaiting reply</span><b className="num">{awaiting.length}</b><span className="sub num">{money0(sum(awaiting))}</span></div>
        <button type="button" className="kpi kpi-btn" onClick={() => go('orders')}><span className="label">Work on hand</span><b className="num">{onHand.length}</b><span className="sub num">{money0(sum(onHand))}</span></button>
        <div className="kpi"><span className="label">Invoiced, unpaid</span><b className="num">{owed.length}</b><span className="sub num">{money0(sum(owed))}</span></div>
      </div>
      {tot > 0 && (
        <div className="card block">
          <div className="block-head"><h3>Where the money goes on won work</h3><span className="hint num">{money0(tot)} excl. VAT · avg margin {avgMargin.toFixed(1)}%</span></div>
          <div className="bar" role="img" aria-label="Split of won work into materials, labour, overhead and profit">
            {SEGMENTS.map(([, k, c]) => <i key={k} style={{ width: `${(agg[k] / tot) * 100}%`, background: c }} />)}
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: '.9rem' }}>
            {SEGMENTS.map(([label, k, c]) => (
              <span key={k}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, marginRight: 6 }} />
                {label} <b className="num">{((agg[k] / tot) * 100).toFixed(0)}%</b></span>
            ))}
          </div>
        </div>
      )}
      <div className="block-head"><h3>Quotes waiting for the customer</h3><button className="btn small" type="button" onClick={() => go('jobs')}>All quotes</button></div>
      <JobsTable jobs={jobs.filter((j) => ['Draft', 'Quote sent'].includes(j.status))} go={go} />
    </>
  )
}
