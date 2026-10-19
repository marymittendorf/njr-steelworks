import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The instant-price Edge Function must price exactly like the app. If this fails, run: npm run sync-functions
test('instant-price function has the current pricing code', () => {
  for (const f of ['costing.js', 'calculator.js']) {
    assert.equal(readFileSync(`supabase/functions/instant-price/${f}`, 'utf8'), readFileSync(`src/${f}`, 'utf8'), `${f} is out of date`)
  }
})
