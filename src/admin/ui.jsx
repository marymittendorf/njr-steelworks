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
