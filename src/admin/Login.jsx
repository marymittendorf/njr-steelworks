import { useState } from 'react'
import { supabase } from '../supabase.js'

// Staff type a username; the login behind it is <username>@njrsteelworks.co.za.
export const LOGIN_DOMAIN = 'njrsteelworks.co.za'
const toLogin = (username) => {
  const u = username.trim().toLowerCase()
  return u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`
}

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [busy, setBusy] = useState(false)

  async function signIn(e) {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Type your username and password.'); return }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: toLogin(username), password })
    setBusy(false)
    if (error) setError('Username or password is wrong. Check them and try again.')
  }

  return (
    <div className="login">
      <form className="card" onSubmit={signIn}>
        <img src="/logo.webp" alt="NJR Steelworks" />
        <h2 style={{ textTransform: 'uppercase', textAlign: 'center' }}>Staff sign in</h2>
        <div className="field"><label htmlFor="l-user">Username</label>
          <input id="l-user" autoComplete="username" autoCapitalize="none" spellCheck="false" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. jeanette" /></div>
        <div className="field"><label htmlFor="l-pass">Password</label>
          <input id="l-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <div className="errmsg">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button className="linkbtn" type="button" onClick={() => setShowHelp(!showHelp)}>Forgot your password?</button>
        {showHelp && <p className="hint" style={{ margin: 0 }}>Ask Jeanette or Nico to set a new one for you under Staff in the back end.</p>}
        <a className="hint" href="/" style={{ textAlign: 'center' }}>Back to the website</a>
      </form>
    </div>
  )
}
