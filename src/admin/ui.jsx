import { useRef, useState } from 'react'

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

// Type-to-search part picker: type any part of the name (words in any order) and the list narrows.
// Arrow keys + Enter, or click. Shows each part's cost so the right one is easy to spot.
export function PartPicker({ prices, ...rest }) {
  return <Picker items={prices} search={(p) => `${p.name} ${p.id} ${p.notes || ''}`}
    sub={(p) => `${Number(p.cost) ? `R${Number(p.cost).toFixed(2)}` : 'no price'} · ${p.unit}`}
    placeholder="Type to find a part…" empty={(t) => `No part matches "${t}". Add it under Stock first.`} {...rest} />
}

// The same search box for any list of {id, name, active}: products on a quote, parts, etc.
export function Picker({ items, value, onChange, autoFocus, label = 'Part', search, sub, placeholder, empty }) {
  const prices = items
  const current = prices.find((p) => p.id === value)
  const [text, setText] = useState(null) // null = not typing: show the chosen part's name
  const [hi, setHi] = useState(0)
  const listRef = useRef(null)
  const words = (text || '').toLowerCase().split(/\s+/).filter(Boolean)
  const matches = text === null ? [] : prices
    .filter((p) => p.active !== false || p.id === value)
    .filter((p) => words.every((w) => search(p).toLowerCase().includes(w)))
    .slice(0, 60)

  function pick(p) { onChange(p.id); setText(null) }
  function onKey(e) {
    if (text === null) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); listRef.current?.children[hi + 1]?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); listRef.current?.children[hi - 1]?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[hi]) pick(matches[hi]) }
    else if (e.key === 'Escape') setText(null)
  }

  return (
    <div className="picker">
      <input aria-label={label} role="combobox" aria-expanded={text !== null} autoFocus={autoFocus} autoComplete="off"
        value={text ?? (current?.name || (value ? `${value} (not on the list)` : ''))}
        placeholder={placeholder}
        onFocus={(e) => { setText(''); setHi(0); e.target.select() }}
        onChange={(e) => { setText(e.target.value); setHi(0) }}
        onBlur={() => setText(null)} onKeyDown={onKey} />
      {text !== null && (
        <ul ref={listRef} role="listbox">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(p) }} onMouseEnter={() => setHi(i)}>
              <span>{p.name}</span><span className="num hint">{sub(p)}</span>
            </li>))}
          {!matches.length && <li className="hint">{empty(text)}</li>}
        </ul>
      )}
    </div>
  )
}
