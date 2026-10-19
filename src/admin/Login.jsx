import { useState } from 'react'
import { supabase } from '../supabase.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState({ error: '', info: '' })
  const [busy, setBusy] = useState(false)

  async function signIn(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setMsg({ error: 'Email or password is wrong. Try again, or reset your password.', info: '' })
  }

  async function reset() {
    if (!email.trim()) { setMsg({ error: 'Type your email first, then click reset.', info: '' }); return }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/admin' })
    setMsg(error ? { error: 'Could not send the reset email. Try again in a minute.', info: '' } : { error: '', info: 'Check your email for a reset link.' })
  }

  return (
    <div className="login">
      <form className="card" onSubmit={signIn}>
        <img src="/logo.webp" alt="NJR Steelworks" />
        <h2 style={{ textTransform: 'uppercase', textAlign: 'center' }}>Staff sign in</h2>
        <div className="field"><label htmlFor="l-email">Email</label>
          <input id="l-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="field"><label htmlFor="l-pass">Password</label>
          <input id="l-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {msg.error && <div className="errmsg">{msg.error}</div>}
        {msg.info && <div className="okmsg">{msg.info}</div>}
        <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button className="linkbtn" type="button" onClick={reset}>Forgot password?</button>
        <a className="hint" href="/" style={{ textAlign: 'center' }}>Back to the website</a>
      </form>
    </div>
  )
}
