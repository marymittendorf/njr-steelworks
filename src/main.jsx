import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import PublicSite from './site/PublicSite.jsx'
import AdminApp from './admin/AdminApp.jsx'
import CustomerDocPage from './site/CustomerDocPage.jsx'

const path = window.location.pathname
const isAdmin = path.startsWith('/admin')
// /q/<token>: a customer's own quote or invoice, from the link in the email.
const docToken = path.match(/^\/q\/([0-9a-f-]{36})\/?$/i)?.[1]

createRoot(document.getElementById('root')).render(
  <StrictMode>{isAdmin ? <AdminApp /> : docToken ? <CustomerDocPage token={docToken} /> : <PublicSite />}</StrictMode>
)
