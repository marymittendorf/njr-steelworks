import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { calc, n } from '../costing.js'
import { money } from '../format.js'
import { Loading, ErrorNote, SumStrip } from './ui.jsx'
import { CATEGORIES } from './JobCosting.jsx'

const thisMonth = () => new Date().toISOString().slice(0, 7)
const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
const lastDay = (ym) => { const d = new Date(`${ym}-01T00:00:00`); d.setMonth(d.getMonth() + 1); d.setDate(0); return `${ym}-${String(d.getDate()).padStart(2, '0')}` }

// Monthly profit by type of work: invoices dated in the month (excl. VAT) against what they cost,
// plus what was paid out as expenses that month.
export default function Reports() {
  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null)
    const from = `${month}-01`, to = lastDay(month)
    Promise.all([
      supabase.from('jobs').select('*').not('invoice_no', 'is', null).is('invoice_voided_at', null).gte('invoice_date', from).lte('invoice_date', to),
      supabase.from('expenses').select('category, amount_excl').gte('paid_on', from).lte('paid_on', to),
    ]).then(([j, e]) => { setError(j.error || e.error); setData({ jobs: j.data || [], expenses: e.data || [] }) })
  }, [month])

  const head = (
    <div className="lh">
      <h1>Profit by month</h1>
      <div className="lh-tools"><label className="sr-only" htmlFor="rep-month">Month</label>
        <input id="rep-month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 'auto' }} /></div>
    </div>
  )
  if (!data) return <>{head}{error ? <ErrorNote error={error} /> : <Loading />}</>

  const byType = Object.fromEntries([...CATEGORIES, 'Type not set'].map((c) => [c, { sales: 0, cost: 0, count: 0 }]))
  for (const j of data.jobs) {
    const t = calc(j)
    const row = byType[j.category] || byType['Type not set']
    row.sales += t.excl; row.cost += t.cost; row.count += 1
  }
  const rows = Object.entries(byType).filter(([c, r]) => r.count || c !== 'Type not set')
  const tot = rows.reduce((a, [, r]) => ({ sales: a.sales + r.sales, cost: a.cost + r.cost, count: a.count + r.count }), { sales: 0, cost: 0, count: 0 })
  const exp = {}
  for (const e of data.expenses) exp[e.category] = (exp[e.category] || 0) + n(e.amount_excl)
  const expTotal = Object.values(exp).reduce((a, v) => a + v, 0)
  const pct = (p, s) => (s > 0 ? `${((p / s) * 100).toFixed(0)}%` : '—')

  return (
    <>
      {head}
      <ErrorNote error={error} />
      <SumStrip items={[
        [`Sales, ${monthName(month)}`, money(tot.sales)],
        ['Cost of the work', money(tot.cost)],
        ['Gross profit', money(tot.sales - tot.cost), null, tot.sales - tot.cost < 0 ? 'bad' : 'good'],
        ['Expenses paid', money(expTotal)],
      ]} />
      <div className="block-head"><h3>By type of work</h3><span className="hint">Invoices dated in {monthName(month)}, excl. VAT</span></div>
      <div className="tbl-wrap block"><table>
        <thead><tr><th>Type</th><th className="r">Invoices</th><th className="r">Sales</th><th className="r">Cost</th><th className="r">Profit</th><th className="r">Margin</th></tr></thead>
        <tbody>
          {rows.map(([c, r]) => (
            <tr key={c}><td>{c}</td><td className="r num">{r.count}</td><td className="r num">{money(r.sales)}</td><td className="r num">{money(r.cost)}</td>
              <td className="r num">{money(r.sales - r.cost)}</td><td className="r num">{pct(r.sales - r.cost, r.sales)}</td></tr>))}
          <tr><td><b>Total</b></td><td className="r num"><b>{tot.count}</b></td><td className="r num"><b>{money(tot.sales)}</b></td><td className="r num"><b>{money(tot.cost)}</b></td>
            <td className="r num"><b>{money(tot.sales - tot.cost)}</b></td><td className="r num"><b>{pct(tot.sales - tot.cost, tot.sales)}</b></td></tr>
        </tbody>
      </table></div>
      {byType['Type not set'].count > 0 && <p className="hint">Some invoices have no type. Open the quote and choose one to sort them.</p>}

      <div className="block-head"><h3>Expenses paid</h3><span className="hint">{monthName(month)}, excl. VAT</span></div>
      {!expTotal ? <p className="hint">No expenses recorded for this month.</p> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Category</th><th className="r">Amount</th></tr></thead>
          <tbody>{Object.entries(exp).sort((a, b) => b[1] - a[1]).map(([c, v]) => <tr key={c}><td>{c}</td><td className="r num">{money(v)}</td></tr>)}
            <tr><td><b>Total</b></td><td className="r num"><b>{money(expTotal)}</b></td></tr></tbody>
        </table></div>
      )}
    </>
  )
}
