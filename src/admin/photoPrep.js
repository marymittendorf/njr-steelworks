// Shrinks a phone photo before upload (max 1600 px, JPEG) so it uploads quickly over mobile
// data and doesn't fill storage. Keeps the time the photo was taken, as far as the file says.
export async function preparePhoto(file, maxSide = 1600) {
  const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : null
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return { blob: file, takenAt, type: file.type || 'image/jpeg' } // unusual format: upload as it is
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  return { blob: blob || file, takenAt, type: 'image/jpeg' }
}
