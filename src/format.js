const R = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })
const R0 = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })

export const money = (v) => R.format(v || 0)
export const money0 = (v) => R0.format(v || 0)

export function addDays(isoDate, days) {
  const d = new Date(isoDate)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export const shortDate = (iso) =>
  new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

// "077 402 8662" -> "27774028662" for wa.me links
export const waNumber = (phone) => '27' + String(phone).replace(/\D/g, '').replace(/^0/, '')
