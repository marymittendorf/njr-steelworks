import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, fromTemplate, ratesFrom } from '../costing.js'
import { ORDER_STAGES, isStockBuild, moveJob, nextStep, shortStamp } from '../orders.js'
import { balanceOf, invoiceState } from './Invoices.jsx'
import { money } from '../format.js'
import { Pill, Loading, ErrorNote } from './ui.jsx'
import ImportQuote from './ImportQuote.jsx'
import JobFile from './JobFile.jsx'
import PartsChecklist from './PartsChecklist.jsx'

const TABS = [
  ['Received', 'Received'],
  ['In production', 'In production'],
  ['Ready', 'Ready'],
  ['Delivered', 'Delivered'],
  ['all', 'All orders'],
]

export default function Orders({ settings, prices, go, toast, me }) {
  const [photosFor, setPhotosFor] = useState(null)
  const [partsFor, setPartsFor] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [stockCount, setStockCount] = useState(0)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Received')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  const [importing, setImporting] = useState(false)

  const load = async () => {
    const [j, s] = await Promise.all([
      supabase.from('jobs').select('*').in('status', ORDER_STAGES).order('accepted_at', { ascending: false, nullsFirst: false }),
      supabase.from('stock_items').select('id', { count: 'exact', head: true }).eq('status', 'In stock'),
    ])
    setJobs(j.data || []); setStockCount(s.count || 0); setError(j.error || s.error)
  }
  useEffect(() => { load() }, [])

  if (!jobs) return error ? <ErrorNote error={error} /> : <Loading />

  const count = (stage) => jobs.filter((j) => j.status === stage).length
  const needle = q.trim().toLowerCase()
  const shown = jobs
    .filter((j) => tab === 'all' || j.status === tab)
    .filter((j) => !needle || [j.customer, j.quote_no, j.invoice_no, j.title, j.phone].some((v) => String(v || '').toLowerCase().includes(needle)))

  async function advance(job, status, label) {
    setBusy(job.id)
    try {
      const updated = await moveJob(job, status)
      setJobs((list) => list.map((j) => (j.id === job.id ? updated : j)))
      toast(isStockBuild(job) && status === 'Ready' ? `${job.title} moved to stock` : `${job.quote_no}: ${label.toLowerCase()}`)
      if (isStockBuild(job) && status === 'Ready') load()
    } catch (e) { setError(e) } finally { setBusy(null) }
  }

  function newStockBuild() {
    go('cost', {
      draft: {
        ...fromTemplate('trailer', prices.filter((p) => p.active)),
        customer: 'Stock build', phone: '', email: '', notes: '', units: 1, galv: false,
        markup: settings.markup, status: 'Received', job_type: 'Built for stock', payment_status: 'Paid',
        request_id: null, rates: ratesFrom(settings),
      },
    })
  }

  return (
    <>
      <div className="pagehead">
        <div><h1>Orders</h1><p>Jobs from received to delivered. Double-click a row to open its costing.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" type="button" onClick={() => setImporting(true)}>Upload PDF quote</button>
          <button className="btn" type="button" onClick={newStockBuild}>Add stock build</button>
          <button className="btn" type="button" onClick={() => go('jobs')}>Quotes</button>
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="kpis">
        {[['Received', 'Received, not started'], ['In production', 'In production'], ['Ready', 'Ready for delivery']].map(([stage, label]) => (
          <button key={stage} type="button" className={`kpi kpi-btn${tab === stage ? ' on' : ''}`} onClick={() => setTab(stage)}>
            <span className="label">{label}</span><b className="num">{count(stage)}</b>
          </button>
        ))}
        <button type="button" className="kpi kpi-btn" onClick={() => go('stock')}>
          <span className="label">Stock on hand</span><b className="num">{stockCount}</b><span className="sub">Finished, in the yard</span>
        </button>
      </div>

      <div className="block-head" style={{ alignItems: 'flex-end' }}>
        <div className="filters" role="group" aria-label="Show orders" style={{ marginBottom: 0 }}>
          {TABS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
              {label} <span className="hint">({k === 'all' ? jobs.length : count(k)})</span>
            </button>
          ))}
        </div>
        <input aria-label="Search orders" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, invoice or quote no., job…" style={{ maxWidth: 300 }} />
      </div>

      {!shown.length ? (
        <div className="card hint">{jobs.length ? 'No orders here.' : 'No orders yet. When a quote is accepted (stage Received) it shows up here.'}</div>
      ) : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Stage</th><th>Customer</th><th>Job</th><th>Payment</th><th>Timeline</th><th className="r">Total</th></tr></thead>
          <tbody>
            {shown.map((j) => {
              const step = nextStep(j)
              const stock = isStockBuild(j)
              return (
                <tr key={j.id} onDoubleClick={() => go('cost', { jobId: j.id })} title="Double-click to open the costing">
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Pill status={j.status} />
                    {step && <div style={{ marginTop: 6 }}>
                      <button className="btn small" type="button" disabled={busy === j.id} onClick={() => advance(j, step[0], step[1])}>{step[1]}</button>
                    </div>}
                    <div style={{ marginTop: 6 }}><button className="linkbtn" type="button" onClick={() => setPhotosFor(j)}>Photos &amp; hand-in</button></div>
                    {(j.mats || []).length > 0 && <div><button className="linkbtn" type="button" onClick={() => setPartsFor(j)}>Parts {(j.mats || []).filter((m) => m.have).length}/{(j.mats || []).length}</button></div>}
                    {!stock && ['Ready', 'In production'].includes(j.status) && (
                      <div style={{ marginTop: 6 }}><button className="linkbtn" type="button" onClick={() => go('deliveries', { jobId: j.id })}>Book delivery</button></div>
                    )}
                  </td>
                  <td>{stock ? <span className="hint">Stock build</span> : <>{j.customer}<div className="hint">{j.phone}</div></>}</td>
                  <td>
                    <b>{j.title}</b>{j.units > 1 && <span className="hint"> × {j.units}</span>}
                    <div className="hint num">{j.invoice_no ? `${j.invoice_no} · ${j.quote_no}` : j.quote_no}</div>
                  </td>
                  <td>
                    {stock ? <span className="hint">—</span> : (
                      <button className="linkbtn" type="button" onClick={() => go('invoices', { jobId: j.id })} title="Open the invoice to record a payment">
                        {invoiceState(j)}{j.invoice_total ? ` · ${money(balanceOf(j))} owing` : ''}</button>
                    )}
                  </td>
                  <td className="hint num" style={{ fontSize: '.85rem', whiteSpace: 'nowrap' }}>
                    Accepted {shortStamp(j.accepted_at)}<br />Started {shortStamp(j.production_started_at)}<br />
                    Ready {shortStamp(j.ready_at)}{!stock && <><br />Delivered {shortStamp(j.delivered_at)}</>}
                  </td>
                  <td className="r num">{money(calc(j).total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      )}
      {partsFor && <PartsChecklist job={partsFor} toast={toast} onClose={() => setPartsFor(null)} onSaved={(updated) => { setJobs((list) => list.map((x) => (x.id === updated.id ? updated : x))); setPartsFor(null) }} />}
      {photosFor && <JobFile job={photosFor} me={me} toast={toast} onClose={() => setPhotosFor(null)} />}
      {importing && <ImportQuote settings={settings} onClose={() => setImporting(false)} onCreated={(job) => { setImporting(false); setTab(job.status); toast(`Order created for ${job.customer}: invoice ${job.invoice_no}`); load() }} />}
      <p className="hint">Tip: double-click any row to open it. Setting a quote to Received on the costing screen puts it here.</p>
    </>
  )
}

