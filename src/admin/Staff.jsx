import { useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import { shortDate } from '../format.js'
import { Loading, ErrorNote } from './ui.jsx'

async function manage(body) {
  const { data, error } = await supabase.functions.invoke('manage-staff', { body })
  if (error) {
    // The function's own message (e.g. "username already used") is in the response body.
    const msg = await error.context?.json?.().then((j) => j.error).catch(() => null)
    throw new Error(msg || 'That did not work. Try again.')
  }
  return data
}

const blank = { name: '', username: '', password: '', role: 'staff' }

export default function Staff({ me, toast }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [resetFor, setResetFor] = useState(null)
  const [newPass, setNewPass] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(null)

  const load = () => supabase.from('staff').select('*').order('created_at').then(({ data, error }) => { setList(data || []); setError(error) })
  useEffect(() => { load() }, [])

  async function run(fn, done) {
    setBusy(true); setError(null)
    try { await fn(); done() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const add = (e) => {
    e.preventDefault()
    run(() => manage({ action: 'create', ...form, username: form.username.trim().toLowerCase() }), () => {
      toast(`${form.name} can now sign in as "${form.username.trim().toLowerCase()}"`); setForm(blank); load()
    })
  }
  const reset = (s) => run(() => manage({ action: 'reset_password', user_id: s.user_id, password: newPass }), () => {
    toast(`New password set for ${s.name}`); setResetFor(null); setNewPass('')
  })
  const remove = (s) => run(() => manage({ action: 'remove', user_id: s.user_id }), () => {
    toast(`${s.name} can no longer sign in`); setConfirmRemove(null); load()
  })

  if (me.role !== 'owner') return <div className="card hint">Only Jeanette or Nico can manage staff logins.</div>

  return (
    <>
      <div className="pagehead"><div><h1>Staff</h1><p>Who can sign in to the back end. Owners can also manage this list.</p></div></div>
      <ErrorNote error={error} />
      {list === null ? <Loading /> : (
        <div className="tbl-wrap block"><table>
          <thead><tr><th>Name</th><th>Username</th><th>Access</th><th>Added</th><th></th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.user_id}>
                <td>{s.name}{s.user_id === me.user_id && <span className="hint"> (you)</span>}</td>
                <td className="num">{s.username || '—'}</td>
                <td>{s.role === 'owner' ? 'Owner' : 'Staff'}</td>
                <td className="num">{shortDate(s.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {resetFor === s.user_id ? (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <input aria-label={`New password for ${s.name}`} type="password" autoComplete="new-password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="New password (8+)" style={{ width: 170 }} />
                      <button className="btn small primary" type="button" disabled={busy || newPass.length < 8} onClick={() => reset(s)}>Save</button>
                      <button className="btn small ghost" type="button" onClick={() => { setResetFor(null); setNewPass('') }}>Cancel</button>
                    </span>
                  ) : <button className="btn small" type="button" onClick={() => { setResetFor(s.user_id); setNewPass('') }}>Set new password</button>}{' '}
                  {s.user_id !== me.user_id && (confirmRemove === s.user_id
                    ? <button className="btn small danger" type="button" disabled={busy} onClick={() => remove(s)}>Confirm remove</button>
                    : <button className="btn small ghost" type="button" onClick={() => setConfirmRemove(s.user_id)}>Remove</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <form className="card" onSubmit={add}>
        <div className="block-head"><h3>Add a staff login</h3></div>
        <div className="fgrid">
          <div className="field"><label htmlFor="st-name">Name</label><input id="st-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="st-user">Username</label><input id="st-user" autoCapitalize="none" spellCheck="false" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. sipho" />
            <span className="hint">Lowercase letters, numbers, dots or dashes</span></div>
          <div className="field"><label htmlFor="st-pass">Password</label><input id="st-pass" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <span className="hint">At least 8 characters. Give it to them in person.</span></div>
          <div className="field"><label htmlFor="st-role">Access</label>
            <select id="st-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="staff">Staff: quotes, jobs, expenses</option><option value="owner">Owner: also manages staff</option>
            </select></div>
        </div>
        <div style={{ marginTop: 14 }}><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add login'}</button></div>
      </form>
    </>
  )
}
