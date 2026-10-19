import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import PublicSite from './site/PublicSite.jsx'
import AdminApp from './admin/AdminApp.jsx'

const isAdmin = window.location.pathname.startsWith('/admin')

createRoot(document.getElementById('root')).render(
  <StrictMode>{isAdmin ? <AdminApp /> : <PublicSite />}</StrictMode>
)
