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

async function imageLines(file, onProgress) {
  await loadScript(TESSERACT)
  const { data } = await window.Tesseract.recognize(file, 'eng', {
    logger: (m) => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100)),
  })
  return data.text.split('\n').map((l) => l.trim()).filter(Boolean)
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
