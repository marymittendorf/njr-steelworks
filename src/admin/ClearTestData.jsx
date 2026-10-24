import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc } from '../costing.js'
import { money0, shortDate } from '../format.js'
import { ErrorNote } from './ui.jsx'

// Owners only: tick test quotes and test website requests, delete them, then restart
// quote numbering. Invoiced jobs are never listed: the database won't delete them.
export default function ClearTestData({ toast }) {
  const [jobs, setJobs] = useState(null)
  const [reqs, setReqs] = useState(null)
  const [pick, setPick] = useState({})
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [invoiced, setInvoiced] = useState(0)

  const load = async () => {
    const [j, r, inv] = await Promise.all([
      supabase.from('jobs').select('*').is('invoice_no', null).order('created_at'),
      supabase.from('requests').select('id,name,type,source,created_at,status').order('created_at'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).not('invoice_no', 'is', null),
    ])
    setJobs(j.data || []); setReqs(r.data || []); setInvoiced(inv.count || 0); setError(j.error || r.error)
  }
  useEffect(() => { load() }, [])

  const chosen = Object.entries(pick).filter(([, v]) => v).map(([k]) => k)
  const toggle = (key) => { setPick({ ...pick, [key]: !pick[key] }); setConfirm(false) }
  const all = (list, prefix, on) => setPick({ ...pick, ...Object.fromEntries(list.map((x) => [`${prefix}:${x.id}`, on])) })

  async function del() {
    setBusy(true); setError(null)
    const jobIds = chosen.filter((k) => k.startsWith('j:')).map((k) => k.slice(2))
    const reqIds = chosen.filter((k) => k.startsWith('r:')).map((k) => k.slice(2))
    const a = jobIds.length ? await supabase.from('jobs').delete().in('id', jobIds) : { error: null }
    const b = reqIds.length ? await supabase.from('requests').delete().in('id', reqIds) : { error: null }
    setBusy(false)
    if (a.error || b.error) { setError(a.error || b.error); return }
    toast(`Deleted ${jobIds.length} quote${jobIds.length === 1 ? '' : 's'} and ${reqIds.length} request${reqIds.length === 1 ? '' : 's'}`)
    setPick({}); setConfirm(false); load()
  }

  async function restart() {
    const { data, error } = await supabase.rpc('restart_numbering')
    if (error) setError(error.message); else toast(data)
  }

  if (!jobs || !reqs) return null
  const row = (key, label, sub) => (
    <label key={key} className="check clear-row"><input type="checkbox" checked={Boolean(pick[key])} onChange={() => toggle(key)} />
      <span>{label}<span className="hint"> · {sub}</span></span></label>
  )

  return (
    <>
      <div className="block-head"><h3>Clear test data</h3><span className="hint">Owners only. Tick what was made while testing, then delete it.</span></div>
      <div className="card block">
        <ErrorNote error={error} />
        <div className="clear-cols">
          <div>
            <div className="block-head"><b>Quotes not invoiced ({jobs.length})</b>
              {jobs.length > 0 && <button className="linkbtn" type="button" onClick={() => all(jobs, 'j', !jobs.every((x) => pick[`j:${x.id}`]))}>Tick all</button>}</div>
            {jobs.length ? jobs.map((j) => row(`j:${j.id}`, `${j.quote_no} · ${j.customer}`, `${j.title} · ${j.status} · ${money0(calc(j).total)} · ${shortDate(j.created_at)}`))
              : <p className="hint">None.</p>}
            {invoiced > 0 && <p className="hint">{invoiced} invoiced job{invoiced === 1 ? '' : 's'} not shown: invoices stay on record.</p>}
          </div>
          <div>
            <div className="block-head"><b>Website requests ({reqs.length})</b>
              {reqs.length > 0 && <button className="linkbtn" type="button" onClick={() => all(reqs, 'r', !reqs.every((x) => pick[`r:${x.id}`]))}>Tick all</button>}</div>
            {reqs.length ? reqs.map((r) => row(`r:${r.id}`, r.name, `${r.type} · ${r.source} · ${r.status} · ${shortDate(r.created_at)}`))
              : <p className="hint">None.</p>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          {confirm
            ? <><button className="btn danger" type="button" disabled={busy} onClick={del}>{busy ? 'Deleting…' : `Yes, delete ${chosen.length} for good`}</button>
                <button className="btn ghost" type="button" onClick={() => setConfirm(false)}>Cancel</button></>
            : <button className="btn" type="button" disabled={!chosen.length} onClick={() => setConfirm(true)}>Delete selected ({chosen.length})</button>}
          <button className="btn ghost" type="button" disabled={jobs.length > 0 || invoiced > 0} onClick={restart}
            title={jobs.length || invoiced ? 'Only possible once there are no quotes at all' : ''}>Restart quote numbers at NJR-Q-0001</button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>Deleting can't be undone. Expenses and petty cash entries can be deleted on their own pages.</p>
      </div>
    </>
  )
}
