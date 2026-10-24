import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { n } from '../costing.js'
import { money, shortDate } from '../format.js'
import { Loading, ErrorNote, SearchBox, matches } from './ui.jsx'
import ExpenseForm from './ExpenseForm.jsx'

const today = () => new Date().toISOString().slice(0, 10)
const thisMonth = () => today().slice(0, 7)
const CASH_METHODS = ['Petty cash', 'Cash'] // 'Cash' = older expenses captured before petty cash existed

// The cash box: top-ups in, slips out (each slip is also an expense), and regular counts.
export default function PettyCash({ me, toast }) {
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [topup, setTopup] = useState(null)
  const [count, setCount] = useState(null)

  const load = async () => {
    const [t, e, c] = await Promise.all([
      supabase.from('cash_topups').select('*').order('topped_up_on'),
      supabase.from('expenses').select('*').in('payment_method', CASH_METHODS).order('paid_on'),
      supabase.from('cash_counts').select('*').order('counted_on', { ascending: false }).order('created_at', { ascending: false }),
    ])
    setData({ topups: t.data || [], spent: e.data || [], counts: c.data || [] }); setError(t.error || e.error || c.error)
  }
  useEffect(() => { load() }, [])

  if (!data) return error ? <ErrorNote error={error} /> : <Loading />

  const totalIn = data.topups.reduce((a, t) => a + n(t.amount), 0)
  const totalOut = data.spent.reduce((a, e) => a + n(e.total), 0)
  const balance = Math.round((totalIn - totalOut) * 100) / 100
  const inMonth = data.topups.filter((t) => t.topped_up_on.startsWith(thisMonth())).reduce((a, t) => a + n(t.amount), 0)
  const outMonth = data.spent.filter((e) => e.paid_on.startsWith(thisMonth())).reduce((a, e) => a + n(e.total), 0)
  const last = data.counts[0]

  // Running balance, oldest first, then shown newest first.
  const rows = [
    ...data.topups.map((t) => ({ id: 't' + t.id, date: t.topped_up_on, at: t.created_at, what: t.source, sub: t.notes, inn: n(t.amount) })),
    ...data.spent.map((e) => ({ id: 'e' + e.id, date: e.paid_on, at: e.created_at, what: e.supplier, sub: e.description, out: n(e.total), file: e.file_path })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at))
  let run = 0
  rows.forEach((r) => { run += (r.inn || 0) - (r.out || 0); r.balance = run })
  rows.reverse()

  async function saveTopup(e) {
    e.preventDefault()
    if (!(n(topup.amount) > 0)) { setError('Add the amount put into the cash box.'); return }
    const { error } = await supabase.from('cash_topups').insert({ topped_up_on: topup.date, amount: n(topup.amount), source: topup.source, notes: topup.notes.trim() || null })
    if (error) { setError(error); return }
    setTopup(null); setError(null); toast(`${money(n(topup.amount))} added to petty cash`); load()
  }

  async function saveCount(e) {
    e.preventDefault()
    if (count.counted === '') { setError('Type how much cash is in the box.'); return }
    const { error } = await supabase.from('cash_counts').insert({ counted_on: today(), counted: n(count.counted), expected: balance, counted_by: me?.name || null, notes: count.notes.trim() || null })
    if (error) { setError(error); return }
    const diff = Math.round((n(count.counted) - balance) * 100) / 100
    setCount(null); setError(null); toast(diff === 0 ? 'Count matches' : `Count saved: ${diff > 0 ? 'over' : 'short'} by ${money(Math.abs(diff))}`); load()
  }

  async function openSlip(path) {
    const { data: d } = await supabase.storage.from('expense-docs').createSignedUrl(path, 300)
    if (d?.signedUrl) window.open(d.signedUrl, '_blank', 'noopener')
  }

  const diff = last ? Math.round((n(last.counted) - n(last.expected)) * 100) / 100 : null

  return (
    <>
      <div className="pagehead">
        <h1>Petty cash</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={() => { setCount(null); setTopup({ date: today(), amount: '', source: 'Bank withdrawal', notes: '' }) }}>Money in</button>
          <button className="btn" type="button" onClick={() => { setTopup(null); setCount({ counted: '', notes: '' }) }}>Count the cash</button>
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="kpis">
        <div className="kpi"><span className="label">Should be in the box</span><b className="num" style={{ color: balance < 0 ? 'var(--bad)' : undefined }}>{money(balance)}</b><span className="sub">Money in minus slips</span></div>
        <div className="kpi"><span className="label">In this month</span><b className="num">{money(inMonth)}</b></div>
        <div className="kpi"><span className="label">Spent this month</span><b className="num">{money(outMonth)}</b></div>
        <div className="kpi"><span className="label">Last count</span>
          {last ? <><b className="num" style={{ color: diff === 0 ? 'var(--good)' : 'var(--warn)' }}>{diff === 0 ? 'Matched' : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}`}</b>
            <span className="sub">{shortDate(last.counted_on)}{last.counted_by ? ` by ${last.counted_by}` : ''}</span></> : <><b>—</b><span className="sub">Not counted yet</span></>}
        </div>
      </div>

      {topup && (
        <form className="card block" onSubmit={saveTopup}>
          <div className="block-head"><h3>Money into the cash box</h3></div>
          <div className="fgrid">
            <div className="field"><label htmlFor="pt-date">Date</label><input id="pt-date" type="date" value={topup.date} onChange={(e) => setTopup({ ...topup, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="pt-amt">Amount (R)</label><input id="pt-amt" type="number" min="0" step="0.01" value={topup.amount} onChange={(e) => setTopup({ ...topup, amount: e.target.value })} /></div>
            <div className="field"><label htmlFor="pt-src">Where it came from</label>
              <select id="pt-src" value={topup.source} onChange={(e) => setTopup({ ...topup, source: e.target.value })}><option>Bank withdrawal</option><option>Customer paid cash</option><option>Owner put in</option><option>Other</option></select></div>
            <div className="field"><label htmlFor="pt-notes">Notes (optional)</label><input id="pt-notes" value={topup.notes} onChange={(e) => setTopup({ ...topup, notes: e.target.value })} placeholder="e.g. cash for NJR-INV-0004" /></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button className="btn primary" type="submit">Add money</button><button className="btn ghost" type="button" onClick={() => setTopup(null)}>Cancel</button></div>
        </form>
      )}

      {count && (
        <form className="card block" onSubmit={saveCount}>
          <div className="block-head"><h3>Count the cash</h3><span className="hint">The system expects {money(balance)}</span></div>
          <div className="fgrid">
            <div className="field"><label htmlFor="pc-amt">Cash counted (R)</label><input id="pc-amt" type="number" min="0" step="0.01" value={count.counted} onChange={(e) => setCount({ ...count, counted: e.target.value })} /></div>
            <div className="field"><label htmlFor="pc-notes">Notes (optional)</label><input id="pc-notes" value={count.notes} onChange={(e) => setCount({ ...count, notes: e.target.value })} placeholder="e.g. slip for R45 airtime missing" /></div>
          </div>
          {count.counted !== '' && <p className="hint" style={{ color: n(count.counted) === balance ? 'var(--good)' : 'var(--warn)' }}>
            {n(count.counted) === balance ? 'Matches.' : `${n(count.counted) > balance ? 'Over' : 'Short'} by ${money(Math.abs(n(count.counted) - balance))}.`}</p>}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button className="btn primary" type="submit">Save count</button><button className="btn ghost" type="button" onClick={() => setCount(null)}>Cancel</button></div>
        </form>
      )}

      <div className="block"><ExpenseForm toast={toast} onSaved={load} paymentMethod="Petty cash" heading="Pay from petty cash" /></div>

      <div className="block-head"><h3>Cash book</h3><SearchBox q={q} setQ={setQ} label="Search cash book" /></div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>What</th><th className="r">In</th><th className="r">Out</th><th className="r">Balance</th><th>Slip</th></tr></thead>
        <tbody>
          {rows.filter((r) => matches(q, r.what, r.sub, r.inn, r.out)).map((r) => (
            <tr key={r.id}>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>{shortDate(r.date)}</td>
              <td>{r.what}{r.sub && <div className="hint" style={{ fontSize: '.85rem' }}>{r.sub}</div>}</td>
              <td className="r num">{r.inn ? money(r.inn) : ''}</td>
              <td className="r num">{r.out ? money(r.out) : ''}</td>
              <td className="r num"><b>{money(r.balance)}</b></td>
              <td>{r.file ? <button className="linkbtn" type="button" onClick={() => openSlip(r.file)}>View</button> : r.out ? <span className="hint">No slip</span> : ''}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="6" className="hint">Nothing yet. Start with "Money in" for the cash in the box today.</td></tr>}
        </tbody>
      </table></div>
      {data.counts.length > 0 && (
        <>
          <div className="block-head" style={{ marginTop: 18 }}><h3>Counts</h3></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Date</th><th>By</th><th className="r">Counted</th><th className="r">Expected</th><th className="r">Difference</th><th>Notes</th></tr></thead>
            <tbody>{data.counts.map((c) => { const d = Math.round((n(c.counted) - n(c.expected)) * 100) / 100; return (
              <tr key={c.id}><td className="num">{shortDate(c.counted_on)}</td><td>{c.counted_by || '—'}</td><td className="r num">{money(c.counted)}</td><td className="r num">{money(c.expected)}</td>
                <td className="r num" style={{ color: d === 0 ? 'var(--good)' : 'var(--warn)' }}>{d === 0 ? 'Matched' : `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`}</td><td className="hint">{c.notes}</td></tr>) })}</tbody>
          </table></div>
        </>
      )}
    </>
  )
}
