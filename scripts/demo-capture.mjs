import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'

/**
 * Frame capture for the demo loop — `pnpm demo`, with the web dev server already up.
 *
 * Frames land in `.demo-frames`; encode them with the two ffmpeg passes at the bottom
 * of docs/19. Nothing here is composited or faked: it drives the real app, so a beat
 * that stops being true stops appearing in the recording.
 *
 * One fixed frame throughout. An earlier take pushed in on each area of interest, the
 * way app videos do, and it read as seasickness rather than emphasis: the layout is
 * dense, every move re-flowed what the eye had just found, and a viewer spent the zoom
 * re-locating themselves instead of watching. The pointer is what directs attention,
 * so the window is left alone.
 */
const OUT = process.argv[2] ?? '.demo-frames'
const FPS = 12
const URL = 'http://localhost:5178'

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 760 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await context.newPage()

let frame = 0
let capturing = false
const shoot = async () => {
  const name = `${OUT}/${String(frame++).padStart(5, '0')}.png`
  await page.screenshot({ path: name, animations: 'allow' })
}
const loop = async () => {
  while (capturing) {
    const started = Date.now()
    await shoot().catch(() => {})
    const rest = 1000 / FPS - (Date.now() - started)
    if (rest > 0) await new Promise((r) => setTimeout(r, rest))
  }
}

/** hold the current view for a beat */
const hold = (ms) => page.waitForTimeout(ms)

/**
 * Where a selector is on screen, as a point.
 *
 * Resolved through Playwright rather than in the page: the selectors here use
 * `:has-text()`, which is Playwright's and not CSS, so `document.querySelector` refuses
 * them. Only the coordinates cross into the page.
 */
const centreOf = async (selector) => {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`nothing to point at: ${selector}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** a pointer that reads as a cursor, since a headless browser draws none */
const pointer = async () => {
  await page.addStyleTag({
    content: `
      #__cursor {
        position: fixed; z-index: 99999; width: 22px; height: 22px; margin: -3px 0 0 -3px;
        border-radius: 50%; pointer-events: none; opacity: 0;
        background: radial-gradient(circle at 35% 35%, rgba(255,255,255,.95), rgba(124,127,245,.65) 60%, rgba(99,102,241,0) 72%);
        box-shadow: 0 0 0 2px rgba(255,255,255,.35);
        transition: transform 520ms cubic-bezier(.4,0,.2,1), opacity 200ms;
      }
      #__cursor.tap { animation: __tap 420ms ease-out; }
      @keyframes __tap { 0% { box-shadow: 0 0 0 2px rgba(255,255,255,.35) } 45% { box-shadow: 0 0 0 14px rgba(124,127,245,0) } 100% { box-shadow: 0 0 0 2px rgba(255,255,255,.35) } }
    `,
  })
  await page.evaluate(() => {
    const dot = document.createElement('div')
    dot.id = '__cursor'
    document.body.append(dot)
  })
}

/** point at something, then click it — the move is what makes the click legible */
const clickAt = async (selector, { travel = 520, settle = 260 } = {}) => {
  const point = await centreOf(selector)
  await page.evaluate((point) => {
    const dot = document.getElementById('__cursor')
    dot.style.opacity = '1'
    dot.style.transform = `translate(${point.x}px, ${point.y}px)`
  }, point)
  await hold(travel)
  await page.evaluate(() => document.getElementById('__cursor').classList.add('tap'))
  await page.locator(selector).first().click({ force: true })
  await hold(settle)
  await page.evaluate(() => document.getElementById('__cursor').classList.remove('tap'))
}

const byText = (role, text) => `${role}:has-text("${text}")`

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForSelector('button:has-text("Load a sample set")', { timeout: 20000 })
await pointer()

/**
 * A rehearsal of the search, before anything is recorded.
 *
 * The first query of a session pays for the whole collection index — several seconds of
 * "searching…" that is a cold cache, not the app being slow. Running it once off-camera
 * means the take shows what the second search onwards actually feels like, without the
 * recording having to lie about it by cutting frames out of the wait.
 */
await page.locator('button[title^="Search Lucide"]').click()
await page.waitForSelector('.library input[type=search]')
await page.locator('.library input[type=search]').fill('compass')
await page.waitForSelector('.library .results .cell', { timeout: 60000 })
await page.locator('.library button:has-text("Cancel")').click()
await page.waitForSelector('.library', { state: 'detached' })
await hold(400)

capturing = true
const capture = loop()

// ── 1. an empty project, and one click to fill it ────────────────────────────
await hold(450)
await clickAt('button:has-text("Load a sample set")', { travel: 420 })
await hold(650)

// ── 2. the grid: real artwork, codepoints under every cell ───────────────────
await hold(500)

// ── 3. taking one icon out of the build ──────────────────────────────────────
await clickAt('button[aria-label^="Exclude"]', { travel: 380 })
await hold(500)

// ── 4. the export rail: formats, family, prefix ──────────────────────────────
await hold(700)

// ── 5. the font, built and then rendered WITH ITSELF ─────────────────────────
await clickAt('button:has-text("Preview font")', { travel: 340 })
// the build is real — wasm woff2 and all — so wait for the proof rather than a guess
await page.waitForSelector('.preview .sample', { timeout: 30000 })
// the rail scrolls, and the proof lands below its fold: bring it up before leaning in
await page.locator('.preview .sample').scrollIntoViewIfNeeded()
await hold(450)
await hold(1000)

// ── 6. the part no export ships: how to use it ───────────────────────────────
await clickAt('button:has-text("How to use it")', { travel: 400 })
await hold(1000)
await hold(1000)

// ── 7. another target, same project ──────────────────────────────────────────
await clickAt('nav .target:has-text("Vite")', { travel: 400 })
await hold(1400)
await clickAt('.card button:has-text("Close")', { travel: 380 })
await hold(500)

// ── 8. 230+ libraries, searched as one, licences and all ─────────────────────
await clickAt('button[title^="Search Lucide"]', { travel: 420 })
await page.waitForSelector('.library input[type=search]')
await hold(500)
// typed rather than filled: the results narrowing as the query lands is the demo
await page.locator('.library input[type=search]').type('compass', { delay: 110 })
await page.waitForSelector('.library .results .cell', { timeout: 30000 })
await hold(900)
for (const nth of [2, 5]) {
  await clickAt(`.library .results .cell:nth-of-type(${nth})`, { travel: 300, settle: 180 })
}
await hold(400)
await clickAt('.library button:has-text("Add")', { travel: 380 })
await page.waitForSelector('.library', { state: 'detached', timeout: 30000 })
await hold(1400)

capturing = false
await capture
await browser.close()
console.log(`captured ${frame} frames at ${FPS}fps → ${(frame / FPS).toFixed(1)}s`)
