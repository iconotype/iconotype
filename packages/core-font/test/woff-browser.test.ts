import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Buffer as Polyfill } from 'buffer/index.js'
import { importIcoMoon } from '@iconotype/core-io'
import { buildFont, ensureBuffer } from '../src/index.js'

const project = importIcoMoon(JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../fixtures/icomoon/alpimaps.json', import.meta.url)), 'utf8'))).project

/**
 * `ttf2woff` reaches for Node's Buffer, and a browser has none: "Download package" in
 * the web app failed with "Buffer is not defined" for every project that asked for WOFF,
 * which is every project by default.
 *
 * The runtime's own Buffer is substituted rather than deleted here — vitest talks to its
 * workers over a channel that needs one, so removing it takes the test runner with it.
 */
describe('WOFF without Node', () => {
  it('installs a Buffer only where one is missing', async () => {
    const browser: { Buffer?: unknown } = {}
    await ensureBuffer(browser)
    expect(typeof browser.Buffer).toBe('function')

    const already = { Buffer: 'left alone' }
    await ensureBuffer(already)
    expect(already.Buffer).toBe('left alone')
  })

  it('produces identical bytes through the polyfill', async () => {
    const native = await buildFont(project, { formats: ['woff'], timestamp: 0 })

    const saved = globalThis.Buffer
    globalThis.Buffer = Polyfill as unknown as typeof globalThis.Buffer
    try {
      const polyfilled = await buildFont(project, { formats: ['woff'], timestamp: 0 })
      expect([...polyfilled.woff!.slice(0, 4)]).toEqual([0x77, 0x4f, 0x46, 0x46])   // wOFF
      expect([...polyfilled.woff!]).toEqual([...native.woff!])
    } finally {
      globalThis.Buffer = saved
    }
  })
})
