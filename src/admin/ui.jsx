export function Pill({ status }) {
  return <span className={`pill st-${status.replace(/ /g, '-')}`}>{status}</span>
}

export function Loading({ what = 'Loading…' }) {
  return <div className="loading">{what}</div>
}

export function ErrorNote({ error }) {
  if (!error) return null
  return <div className="errmsg">{typeof error === 'string' ? error : error.message}</div>
}

// Zoho-style list header: title as a view dropdown on the left; search, extra buttons and "+ New" on the right.
export function ListHead({ title, views, view, setView, q, setQ, searchLabel = 'Search', onNew, newLabel = 'New', children }) {
  return (
    <div className="lh">
      {views ? (
        <label className="lh-view"><span className="sr-only">Show</span>
          <select value={view} onChange={(e) => setView(e.target.value)}>{views.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        </label>
      ) : <h1>{title}</h1>}
      <div className="lh-tools">
        {setQ && <input type="search" aria-label={searchLabel} placeholder={searchLabel} value={q} onChange={(e) => setQ(e.target.value)} />}
        {children}
        {onNew && <button className="btn primary" type="button" onClick={onNew}>+ {newLabel}</button>}
      </div>
    </div>
  )
}

// The summary strip under the header: [label, value, onClick?, tone?]
export function SumStrip({ items }) {
  return (
    <div className="sumstrip">
      {items.map(([label, value, onClick, tone]) => {
        const body = <><span>{label}</span><b className={`num ${tone ? `tx-${tone}` : ''}`}>{value}</b></>
        return onClick ? <button key={label} type="button" onClick={onClick}>{body}</button> : <div key={label}>{body}</div>
      })}
    </div>
  )
}

// Status in coloured capitals, e.g. OVERDUE BY 8 DAYS. tone: good | warn | bad | info | muted
export function Status({ text, tone = 'muted' }) {
  return <span className={`stx tx-${tone}`}>{text}</span>
}

// Rows: Enter or click opens.
export const rowProps = (open) => ({ className: 'clickable', tabIndex: 0, onClick: open, onKeyDown: (e) => e.key === 'Enter' && open() })
