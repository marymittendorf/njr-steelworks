import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, ratesFrom, templateLine } from '../costing.js'
import { ORDER_STAGES, isStockBuild, moveJob, nextStep, shortStamp } from '../orders.js'
import { balanceOf, invoiceState } from './Invoices.jsx'
import { money, money0 } from '../format.js'
import { Pill, Loading, ErrorNote, ListHead, SumStrip } from './ui.jsx'
import ImportQuote from './ImportQuote.jsx'
import JobFile from './JobFile.jsx'
import PartsChecklist, { jobParts } from './PartsChecklist.jsx'

const VIEWS = ['Open orders', 'Received', 'In production', 'Ready', 'Delivered', 'All orders']
const inView = (view, j) => view === 'All orders' || (view === 'Open orders' ? j.status !== 'Delivered' : j.status === view)

export default function Orders({ settings, prices, go, toast, me }) {
  const [photosFor, setPhotosFor] = useState(null)
  const [partsFor, setPartsFor] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [stockCount, setStockCount] = useState(0)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('Open orders')
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
    .filter((j) => inView(tab, j))
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
        title: '', mats: [], labour: [], extras: [], products: [templateLine('trailer', prices.filter((p) => p.active), ratesFrom(settings), settings.markup)],
        customer: 'Stock build', phone: '', email: '', notes: '', units: 1, galv: false,
        markup: settings.markup, status: 'Received', job_type: 'Built for stock', payment_status: 'Paid',
        request_id: null, rates: ratesFrom(settings),
      },
    })
  }

  return (
    <>
      <ListHead views={VIEWS} view={tab} setView={setTab} q={q} setQ={setQ} searchLabel="Search orders">
        <button className="btn" type="button" onClick={() => setImporting(true)}>Upload PDF quote</button>
        <button className="btn" type="button" onClick={newStockBuild}>Add stock build</button>
      </ListHead>
      <ErrorNote error={error} />
      <SumStrip items={[
        ['Received, not started', String(count('Received')), () => setTab('Received')],
        ['In production', String(count('In production')), () => setTab('In production')],
        ['Ready', String(count('Ready')), () => setTab('Ready')],
        ['Still to be paid', money0(jobs.filter((j) => j.invoice_no && !j.invoice_voided_at).reduce((a, j) => a + balanceOf(j), 0)), () => go('invoices')],
        ['Finished stock in the yard', String(stockCount), () => go('stock')],
      ]} />

      {!shown.length ? (
        <div className="card hint">{jobs.length ? 'No orders in this view.' : 'No orders yet. When a quote is accepted (stage Received) it shows up here.'}</div>
      ) : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Stage</th><th>Customer</th><th>Job</th><th>Payment</th><th>Timeline</th><th className="r">Total</th></tr></thead>
          <tbody>
            {shown.map((j) => {
              const step = nextStep(j)
              const stock = isStockBuild(j)
              return (
                <tr key={j.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Pill status={j.status} />
                    {step && <div style={{ marginTop: 6 }}>
                      <button className="btn small" type="button" disabled={busy === j.id} onClick={() => advance(j, step[0], step[1])}>{step[1]}</button>
                    </div>}
                    <div style={{ marginTop: 6 }}><button className="linkbtn" type="button" onClick={() => setPhotosFor(j)}>Photos &amp; hand-in</button></div>
                    <div><button className="linkbtn" type="button" onClick={() => setPartsFor(j)}>Parts {jobParts(j).filter((x) => x.have).length}/{jobParts(j).length}</button></div>
                    {!stock && ['Ready', 'In production'].includes(j.status) && (
                      <div style={{ marginTop: 6 }}><button className="linkbtn" type="button" onClick={() => go('deliveries', { jobId: j.id })}>Book delivery</button></div>
                    )}
                  </td>
                  <td>{stock ? <span className="hint">Stock build</span> : <>{j.customer}<div className="hint">{j.phone}</div></>}</td>
                  <td>
                    <button className="linkbtn lnk" type="button" style={{ textDecoration: 'none', fontSize: '1rem' }} onClick={() => go('cost', { jobId: j.id })}><b>{j.title}</b></button>{j.units > 1 && <span className="hint"> × {j.units}</span>}
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
    </>
  )
}

