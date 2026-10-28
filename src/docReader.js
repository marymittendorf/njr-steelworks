// Turns an uploaded PDF or photo into text lines for docParse.js.
// PDFs: pdf.js (same library Forever Planks uses), reading the text layer.
// Photos of slips: Tesseract OCR. Both run in the browser, so there's no per-slip cost;
// each library loads from the CDN the first time it's needed.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js'
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js'
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'

const loaded = {}
function loadScript(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = resolve
    s.onerror = () => { delete loaded[src]; reject(new Error('Could not load the document reader. Check the internet connection and try again.')) }
    document.head.appendChild(s)
  })
  return loaded[src]
}

// Group pdf.js text items into visual lines, top to bottom, left to right.
function toLines(items, tolerance = 2) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const it of sorted) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(line.y - it.y) <= tolerance) line.items.push(it)
    else lines.push({ y: it.y, items: [it] })
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.text).join('  ').replace(/\s{3,}/g, '  ').trim()).filter(Boolean)
}

async function pdfLines(file) {
  await loadScript(PDFJS)
  const pdfjs = window.pdfjsLib
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const items = []
  for (let p = 1; p <= Math.min(pdf.numPages, 5); p++) {
    const content = await (await pdf.getPage(p)).getTextContent()
    for (const it of content.items) {
      const text = it.str.trim()
      if (text) items.push({ text, x: it.transform[4], y: it.transform[5] - (p - 1) * 100000 })
    }
  }
  return toLines(items)
}

// Phone photos come in all sizes (WhatsApp shrinks them; cameras make them huge), shadowy and often
// sideways. Before reading: resize so the long side is about 3 600 px (small slip text gets big enough
// to read; tested on real NJR slips), greyscale + a little more contrast, and turn by `turn` quarter-turns.
async function prepare(file, turn = 0) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(4, 3600 / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
  const side = turn % 2 === 1
  const canvas = document.createElement('canvas')
  canvas.width = side ? h : w
  canvas.height = side ? w : h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.filter = 'grayscale(1) contrast(1.3)'
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((turn * Math.PI) / 2)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  img.close?.()
  return canvas
}

async function imageLines(file, onProgress) {
  await loadScript(TESSERACT)
  const worker = await window.Tesseract.createWorker('eng', 1, {
    logger: (m) => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100)),
  })
  try {
    // Upright first; if that reads badly (sideways photo), try a quarter turn each way and keep the best.
    let best = (await worker.recognize(await prepare(file, 0))).data
    if (best.confidence < 55) {
      for (const turn of [1, 3]) {
        const d = (await worker.recognize(await prepare(file, turn))).data
        if (d.confidence > best.confidence) best = d
      }
    }
    return best.text.split('\n').map((l) => l.trim()).filter(Boolean)
  } finally {
    await worker.terminate()
  }
}

// Phone photo → a JPEG about 2 000 px on the long side, as base64 (small enough to send, big enough to read).
async function shrink(file) {
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  img.close?.()
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
}
const toBase64 = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// Reads the slip with AI (the read-slip Edge Function, Google Gemini). Returns
// { supplier, invoice_no, date, prices_include_vat, vat, total, items: [{ desc, qty, unit_price, line_total }] },
// or throws (with .notConfigured when the key isn't set up yet) so the caller can fall back to readDocument.
export async function readSlipAI(supabase, file) {
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const body = pdf ? { mime: 'application/pdf', data: await toBase64(file) } : { mime: 'image/jpeg', data: await shrink(file) }
  const { data, error } = await supabase.functions.invoke('read-slip', { body })
  if (error) {
    const detail = await error.context?.json?.().catch(() => null)
    throw Object.assign(new Error(detail?.error || error.message), { notConfigured: !!detail?.notConfigured })
  }
  return data
}

// Returns { lines, scanned }. scanned=true means a PDF with no text layer (a scan),
// which is then read with OCR like a photo.
export async function readDocument(file, onProgress) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const lines = await pdfLines(file)
    if (lines.join('').length > 20) return { lines, scanned: false }
    throw new Error('This PDF is a scanned picture with no text in it. Take a photo of the page instead and upload that.')
  }
  if (file.type.startsWith('image/')) return { lines: await imageLines(file, onProgress), scanned: true }
  throw new Error('Upload a PDF or a photo (JPG or PNG).')
}
