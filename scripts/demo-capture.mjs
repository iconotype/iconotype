import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'

/**
 * Frame capture for the demo loop — `pnpm demo`, with the web dev server already up.
 *
 * Frames land in `.demo-frames`; encode them with the two ffmpeg passes at the bottom of
 * docs/19. Nothing here is composited or faked: it drives the real app, and the web page
 * at the end is served from the package the app actually exported, so a beat that stops
 * being true stops appearing in the recording.
 *
 * One fixed frame throughout. An earlier take pushed in on each area of interest, the
 * way app videos do, and it read as seasickness rather than emphasis: the layout is
 * dense, every move re-flowed what the eye had just found. The pointer directs attention
 * instead, and is drawn in because a headless browser has no cursor to record.
 */
const OUT = process.argv[2] ?? '.demo-frames'
const WORK = process.argv[3] ?? '.demo-work'
const FPS = 12
const URL = 'http://localhost:5178'
const SITE_PORT = 5199

rmSync(OUT, { recursive: true, force: true })
rmSync(WORK, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
mkdirSync(WORK, { recursive: true })

// ── the site the font ends up in ─────────────────────────────────────────────
/** serves whatever the last export unpacked into WORK */
const MIME = { '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.json': 'application/json' }
const server = createServer((req, res) => {
  const path = join(WORK, decodeURIComponent(req.url.split('?')[0]))
  if (!existsSync(path)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(readFileSync(path))
})
await new Promise((r) => server.listen(SITE_PORT, r))

/**
 * A page that uses the font the way anyone would: a class on an element, next to text.
 *
 * Written from the stylesheet the export produced rather than from a list kept here, so
 * it cannot drift from what the project actually contains.
 */
function writeSite(classes, base) {
  const [primary, ...rest] = classes
  /**
   * Both classes, always.
   *
   * The stylesheet puts the family on the base class and the codepoint on the icon
   * class. A page with only the second renders the character in its body font — which
   * is what the first cut of this video showed: rows of stray dashes where the icons
   * should be.
   */
  const cls = (name) => (base ? `${base} ${name}` : name)
  const row = (name, label) => `<li><i class="${cls(name)}"></i><span>${label}</span></li>`
  writeFileSync(join(WORK, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Trailhead</title>
<link rel="stylesheet" href="style.css">
<style>
  :root { color-scheme: dark }
  body { margin: 0; background: #0e1014; color: #e9eaee;
         font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 56px 40px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 40px; }
  header i { font-size: 34px; color: #7c7ff5; }
  header b { font-size: 26px; letter-spacing: -.02em; }
  header span { color: #969db0; font-size: 15px; margin-left: auto; }
  h1 { font-size: 40px; line-height: 1.15; letter-spacing: -.03em; margin: 0 0 12px; }
  p.lede { color: #969db0; font-size: 18px; margin: 0 0 36px; }
  ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
  li { display: flex; align-items: center; gap: 14px; padding: 16px 20px;
       background: #15181e; border: 1px solid #262b36; border-radius: 14px; font-size: 18px; }
  li i { font-size: 26px; color: #7c7ff5; width: 34px; text-align: center; }
  .cta { display: inline-flex; align-items: center; gap: 10px; margin-top: 34px;
         background: #6366f1; color: #fff; padding: 13px 22px; border-radius: 10px;
         font-weight: 600; font-size: 17px; }
  .cta i { font-size: 20px; }
</style></head>
<body><div class="wrap">
  <header><i class="${cls(primary)}"></i><b>Trailhead</b><span>your app, your font</span></header>
  <h1>Every route, one icon set.</h1>
  <p class="lede">The same font this page loads was built, fixed and exported next door.</p>
  <ul>
    ${rest.slice(0, 3).map((c, i) => row(c, ['Hiking · 12 km loop', 'Ridge traverse · 840 m', 'Trailhead · 20 min away'][i] ?? 'Route')).join('\n    ')}
  </ul>
  <a class="cta"><i class="${cls(primary)}"></i>Plan a route</a>
</div></body></html>
`)
}

// ── capture ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1500, height: 860 },
  deviceScaleFactor: 1.5,
  colorScheme: 'dark',
  acceptDownloads: true,
})
const app = await context.newPage()
/** whichever page the recording is pointed at — the app, or the site it produced */
let stage = app

let frame = 0
let capturing = false
const shoot = async () => {
  const name = `${OUT}/${String(frame++).padStart(5, '0')}.png`
  await stage.screenshot({ path: name, animations: 'allow' })
}
const loop = async () => {
  while (capturing) {
    const started = Date.now()
    await shoot().catch(() => {})
    const rest = 1000 / FPS - (Date.now() - started)
    if (rest > 0) await new Promise((r) => setTimeout(r, rest))
  }
}

const hold = (ms) => stage.waitForTimeout(ms)

const centreOf = async (selector) => {
  const box = await stage.locator(selector).first().boundingBox()
  if (!box) throw new Error(`nothing to point at: ${selector}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** a pointer that reads as a cursor, since a headless browser draws none */
const pointer = async (page) => {
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
const point = async (selector, travel = 500) => {
  const at = await centreOf(selector)
  await stage.evaluate((at) => {
    const dot = document.getElementById('__cursor')
    dot.style.opacity = '1'
    dot.style.transform = `translate(${at.x}px, ${at.y}px)`
  }, at)
  await hold(travel)
}
const clickAt = async (selector, { travel = 500, settle = 260 } = {}) => {
  await point(selector, travel)
  await stage.evaluate(() => document.getElementById('__cursor').classList.add('tap'))
  await stage.locator(selector).first().click({ force: true })
  await hold(settle)
  await stage.evaluate(() => document.getElementById('__cursor').classList.remove('tap'))
}

/** Download the package the app just built, unpack it, and point the site at it. */
const exportPackage = async () => {
  const [download] = await Promise.all([
    app.waitForEvent('download', { timeout: 60000 }),
    clickAt('button:has-text("Download package")', { travel: 420 }),
  ])
  const zip = join(WORK, 'package.zip')
  await download.saveAs(zip)
  execFileSync('unzip', ['-o', '-q', zip, '-d', WORK])
  const css = readFileSync(join(WORK, 'style.css'), 'utf8')
  const classes = [...css.matchAll(/\.([\w-]+):before/g)].map((m) => m[1])
  // whichever selector the stylesheet hangs `font-family` on, read rather than assumed
  const base = css.match(/^\.([\w-]+)\s*\{[^}]*font-family:/m)?.[1]
  const wanted = ['hiking', 'walk', 'trail', 'run']
  const chosen = [
    ...classes.filter((c) => wanted.some((w) => c.endsWith(w))),
    ...classes.filter((c) => !wanted.some((w) => c.endsWith(w))),
  ]
  writeSite([...new Set(chosen)].slice(0, 4), base)
  return classes
}

await app.goto(URL, { waitUntil: 'networkidle' })
await app.waitForSelector('button:has-text("Load a sample set")', { timeout: 20000 })
await pointer(app)

/**
 * A rehearsal of the search, before anything is recorded.
 *
 * The first query of a session pays for the whole collection index — several seconds of
 * "searching…" that is a cold cache, not the app being slow. Running it once off-camera
 * means the take shows what the second search onwards actually feels like, without the
 * recording having to lie about it by cutting frames out of the wait.
 */
await app.locator('button[title^="Search Lucide"]').click()
await app.waitForSelector('.library input[type=search]')
await app.locator('.library input[type=search]').fill('hiking')
await app.waitForSelector('.library .results .cell', { timeout: 60000 })
await app.locator('.library button:has-text("Cancel")').click()
await app.waitForSelector('.library', { state: 'detached' })
await hold(400)

capturing = true
const capture = loop()

// ── 1. 230+ collections, searched as one ─────────────────────────────────────
await hold(500)
await clickAt('button[title^="Search Lucide"]', { travel: 420 })
await app.waitForSelector('.library input[type=search]')
await hold(400)
// typed rather than filled: the results narrowing as the query lands is the demo
await app.locator('.library input[type=search]').type('hiking', { delay: 105 })
await app.waitForSelector('.library .results .cell', { timeout: 30000 })
await hold(800)
for (const nth of [2, 5, 8, 11]) {
  await clickAt(`.library .results .cell:nth-of-type(${nth})`, { travel: 260, settle: 150 })
}
// the licence line under the picks is the part nobody else shows
await hold(700)
await clickAt('.library button:has-text("Add")', { travel: 360 })
await app.waitForSelector('.library', { state: 'detached', timeout: 30000 })

// ── 2. they land in the project, in a set of their own ───────────────────────
await hold(2000)

// ── 3. the package, downloaded exactly as anyone would ───────────────────────
await exportPackage()
await hold(900)

// ── 4. the page that uses it — a font, a class, some text ────────────────────
const site = await context.newPage()
stage = site
await site.goto(`http://localhost:${SITE_PORT}/index.html`, { waitUntil: 'networkidle' })
await site.evaluate(() => document.fonts.ready)
await pointer(site)
await hold(2600)

// ── 5. one glyph does not fill its em box, so it sits small next to the text ─
stage = app
await app.bringToFront()
await hold(600)
const target = '.cell'
await point(target, 420)
await app.locator(target).first().dblclick()
await app.waitForSelector('button[title^="Scale the artwork"]', { timeout: 20000 })
await hold(1400)

// ── 6. fixed on the em square, where the fixing belongs ──────────────────────
// fitting to the em box is the fix; mirroring is what makes it legible three metres
// from the screen, since the walker on the page turns round with it
await clickAt('button[title^="Scale the artwork"]', { travel: 420 })
await hold(800)
await clickAt('button[title^="Mirror"]', { travel: 260, settle: 220 })
await hold(1200)
await clickAt('button[title^="Back to the"]', { travel: 380 })
await hold(900)

// ── 7. rebuilt, and the page again ───────────────────────────────────────────
await exportPackage()
await hold(700)
stage = site
await site.bringToFront()
await site.reload({ waitUntil: 'networkidle' })
await site.evaluate(() => document.fonts.ready)
await pointer(site)
await hold(2800)

capturing = false
await capture
await browser.close()
server.close()
console.log(`captured ${frame} frames at ${FPS}fps → ${(frame / FPS).toFixed(1)}s`)
