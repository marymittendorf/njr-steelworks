import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase.js'
import Login from './Login.jsx'
import Dashboard from './Dashboard.jsx'
import Requests from './Requests.jsx'
import Jobs from './Jobs.jsx'
import JobCosting from './JobCosting.jsx'
import Orders from './Orders.jsx'
import Invoices from './Invoices.jsx'
import Banking from './Banking.jsx'
import Stock from './Stock.jsx'
import Products from './Products.jsx'
import Deliveries from './Deliveries.jsx'
import Expenses from './Expenses.jsx'
import PettyCash from './PettyCash.jsx'
import Settings from './Settings.jsx'
import Gallery from './Gallery.jsx'
import Staff from './Staff.jsx'
import { Loading } from './ui.jsx'

export default function AdminApp() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="login"><Loading /></div>
  if (!session) return <Login />
  return <StaffShell session={session} />
}

const PAGES = [
  ['dash', 'Dashboard'],
  ['requests', 'Requests'],
  ['jobs', 'Quotes'],
  ['orders', 'Orders'],
  ['invoices', 'Invoices'],
  ['banking', 'Banking'],
  ['deliveries', 'Deliveries'],
  ['products', 'Products'],
  ['stock', 'Stock'],
  ['cost', 'Job costing'],
  ['expenses', 'Expenses'],
  ['petty', 'Petty cash'],
  ['gallery', 'Website photos'],
  ['settings', 'Rates & settings'],
  ['staff', 'Staff'], // owners only
]

const pageFromHash = () => {
  const raw = window.location.hash.replace('#', '')
  const h = raw === 'prices' ? 'stock' : raw // the price list now lives under Stock
  return PAGES.some(([k]) => k === h) ? h : 'dash'
}

function StaffShell({ session }) {
  const [staff, setStaff] = useState(undefined)
  const [settings, setSettings] = useState(null)
  const [prices, setPrices] = useState(null)
  const [page, setPage] = useState(pageFromHash)
  const [costTarget, setCostTarget] = useState(null) // {jobId} | {draft} | {} = new blank, plus a nonce
  const [invoiceTarget, setInvoiceTarget] = useState(null) // {jobId}: open that invoice
  const [deliveryTarget, setDeliveryTarget] = useState(null) // {jobId} | {stockItemId}: open a booking form
  const [newCount, setNewCount] = useState(0)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef()

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 2400)
  }, [])

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from('settings').select('*').eq('id', 1).single()
    setSettings(data)
    return data
  }, [])
  const loadPrices = useCallback(async () => {
    const { data } = await supabase.from('prices').select('*').order('sort')
    setPrices(data || [])
    return data || []
  }, [])

  // Website "from" prices are typed in by staff (Settings), so this only refreshes data.
  const syncFromPrices = useCallback(async () => {
    await Promise.all([loadSettings(), loadPrices()])
  }, [loadSettings, loadPrices])

  const refreshCount = useCallback(async () => {
    const { count } = await supabase.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'New')
    setNewCount(count || 0)
  }, [])

  useEffect(() => {
    supabase.from('staff').select('*').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => setStaff(data))
    loadSettings()
    loadPrices()
  }, [session.user.id, loadSettings, loadPrices])

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => { if (staff) refreshCount() }, [staff, page, refreshCount])

  const go = useCallback((p, target) => {
    // A fresh nonce each time remounts the costing screen, so "New costing" always starts clean.
    if (p === 'cost') setCostTarget({ ...(target || {}), nonce: Date.now() })
    if (p === 'invoices') setInvoiceTarget(target ? { ...target, nonce: Date.now() } : null)
    if (p === 'deliveries') setDeliveryTarget(target ? { ...target, nonce: Date.now() } : null)
    if (window.location.hash !== '#' + p) window.location.hash = p
    setPage(p)
    window.scrollTo(0, 0)
  }, [])

  const signOut = () => supabase.auth.signOut()

  if (staff === undefined) return <div className="login"><Loading /></div>
  if (!staff) {
    return (
      <div className="login"><div className="card">
        <img src="/logo.webp" alt="NJR Steelworks" />
        <h2 style={{ textTransform: 'uppercase' }}>No staff access</h2>
        <p className="hint">{session.user.email} is signed in but isn't set up as NJR staff. Ask the owner to add you.</p>
        <button className="btn" type="button" onClick={signOut}>Sign out</button>
      </div></div>
    )
  }

  const ready = settings && prices
  const props = { settings, prices, go, toast, refreshCount, me: staff }

  return (
    <div className="admin">
      <nav className="side" aria-label="Back end">
        <a className="brand" href="/"><img src="/logo.webp" alt="" /><b>NJR <span>ADMIN</span></b></a>
        {PAGES.filter(([k]) => k !== 'staff' || staff.role === 'owner').map(([k, label]) => (
          <button key={k} type="button" aria-current={page === k ? 'page' : undefined}
            onClick={() => { if (!(k === 'cost' && page === 'cost')) go(k) }}>
            {label}{k === 'requests' && newCount > 0 && <span className="count">{newCount}</span>}
          </button>
        ))}
        <div className="who">
          <span>Signed in as <b style={{ color: 'var(--fg)' }}>{staff.name}</b></span>
          <button className="linkbtn" type="button" onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        {!ready ? <Loading /> : (
          <>
            {page === 'dash' && <Dashboard {...props} />}
            {page === 'requests' && <Requests {...props} />}
            {page === 'jobs' && <Jobs {...props} />}
            {page === 'orders' && <Orders {...props} />}
            {page === 'banking' && <Banking {...props} />}
            {page === 'invoices' && <Invoices key={invoiceTarget?.nonce || 'inv'} target={invoiceTarget} {...props} />}
            {page === 'deliveries' && <Deliveries key={deliveryTarget?.nonce || 'cal'} target={deliveryTarget} {...props} />}
            {page === 'products' && <Products {...props} syncFromPrices={syncFromPrices} />}
            {page === 'stock' && <Stock {...props} reload={loadPrices} syncFromPrices={syncFromPrices} />}
            {page === 'cost' && <JobCosting key={costTarget?.nonce || 'new'} target={costTarget} {...props} />}
            {page === 'expenses' && <Expenses {...props} />}
            {page === 'petty' && <PettyCash {...props} me={staff} />}
            {page === 'gallery' && <Gallery {...props} />}
            {page === 'staff' && <Staff {...props} me={staff} />}
            {page === 'settings' && <Settings {...props} syncFromPrices={syncFromPrices} />}
          </>
        )}
      </main>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  )
}
