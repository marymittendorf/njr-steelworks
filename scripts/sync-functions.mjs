// Copies the shared pricing code into the Edge Function folder that uses it,
// so the website and the server price things exactly the same way.
// Run after editing src/costing.js or src/calculator.js:  npm run sync-functions
import { copyFileSync } from 'node:fs'

const target = 'supabase/functions/instant-price/'
for (const file of ['costing.js', 'calculator.js']) {
  copyFileSync(`src/${file}`, `${target}${file}`)
  console.log(`copied src/${file} → ${target}${file}`)
}
