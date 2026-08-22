import { PaperOffset, analyze } from 'paperjs-offset'
import svgpath from 'svgpath'

// Single paper instance shared with paperjs-offset (which does `import paper from 'paper'`).
// jsdom/node-canvas are OPTIONAL deps of paper-full — absent here, and it still works headless.
// In browser builds, alias 'paper' → 'paper/dist/paper-core.js' to drop the PaperScript compiler.
import paper from 'paper'

const results = []
const t = (name, fn) => {
  const t0 = performance.now()
  try {
    const info = fn()
    results.push({ name, ok: true, ms: +(performance.now() - t0).toFixed(1), info })
  } catch (e) {
    results.push({ name, ok: false, ms: +(performance.now() - t0).toFixed(1), info: e.message })
  }
}

const round = (d, p = 2) => svgpath(d).round(p).toString()
const stats = (item) => ({
  children: item.children ? item.children.length : 1,
  segments: item.children
    ? item.children.reduce((n, c) => n + c.segments.length, 0)
    : item.segments.length,
  area: Math.round(item.area),
  bounds: [item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height].map(n => +n.toFixed(1)),
})

// ────────────────────────────────────────────────────────────── 1. headless setup
t('setup headless (paper-full, no canvas, no jsdom installed)', () => {
  paper.setup(new paper.Size(1024, 1024))
  return { project: !!paper.project, view: !!paper.view, hasDocument: typeof document !== 'undefined' }
})

// ────────────────────────────────────────────────── 2. pathData in / pathData out
t('Path from pathData → pathData (no DOM import/exportSVG)', () => {
  const d = 'M100 100 L300 100 L300 300 L100 300 Z'
  const p = new paper.Path(d)
  return { in: d, out: round(p.pathData), closed: p.closed, segments: p.segments.length }
})

// ────────────────────────────────────────────────────────────── 3. boolean ops
t('boolean unite / subtract / intersect', () => {
  const a = new paper.Path.Rectangle({ point: [0, 0], size: [200, 200] })
  const b = new paper.Path.Circle({ center: [200, 200], radius: 100 })
  const out = {}
  for (const op of ['unite', 'subtract', 'intersect', 'exclude']) {
    const r = a[op](b)
    out[op] = stats(r)
    r.remove()
  }
  a.remove(); b.remove()
  return out
})

// ────────────────────────────────────────── 4. even-odd → nonzero (bullseye, 6 rings)
t('evenodd → nonzero (6 nested rings, holes preserved)', () => {
  const rings = [300, 250, 200, 150, 100, 50].map(r =>
    new paper.Path.Circle({ center: [400, 400], radius: r }))
  const cp = new paper.CompoundPath({ children: rings, fillRule: 'evenodd' })
  // nonzero equivalence: alternate contour direction outer→hole→outer…
  cp.children.forEach((c, i) => { if (c.clockwise !== (i % 2 === 0)) c.reverse() })
  const dirs = cp.children.map(c => (c.clockwise ? 'cw' : 'ccw')).join(',')
  const areaEO = Math.abs(cp.area)
  const info = { contours: cp.children.length, directions: dirs, area: Math.round(areaEO) }
  cp.remove()
  return info
})

// ───────────────────────────────────────────────── 5. self-intersection (pentagram)
t('self-intersection resolved (pentagram → unite with itself)', () => {
  const pts = []
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * ((i * 2) % 5)) / 5 - Math.PI / 2
    pts.push(new paper.Point(400 + 200 * Math.cos(a), 400 + 200 * Math.sin(a)))
  }
  const star = new paper.Path({ segments: pts, closed: true })
  const before = { segments: star.segments.length, area: Math.round(star.area), intersections: star.getCrossings().length }
  const fixed = star.unite(star)
  const after = stats(fixed)
  star.remove(); fixed.remove()
  return { before, after }
})

// ─────────────────────────────────────────── 6. THE HARD ONE: stroke → outline
t('stroke → outline: miter join, star, width 12', () => {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2
    const r = i % 2 === 0 ? 200 : 80
    pts.push(new paper.Point(400 + r * Math.cos(a), 400 + r * Math.sin(a)))
  }
  const star = new paper.Path({ segments: pts, closed: true, strokeWidth: 12, strokeJoin: 'miter', miterLimit: 4 })
  const outlined = PaperOffset.offsetStroke(star, 6, { join: 'miter', cap: 'butt', limit: 4, insert: false })
  const quality = analyze(star, outlined, 6)
  const info = { ...stats(outlined), quality, pathDataLen: outlined.pathData.length }
  star.remove(); outlined.remove()
  return info
})

t('stroke → outline: open path, round cap + round join', () => {
  const line = new paper.Path('M100 400 C200 200 400 600 600 300')
  line.strokeWidth = 24
  const outlined = PaperOffset.offsetStroke(line, 12, { join: 'round', cap: 'round', insert: false })
  const info = { ...stats(outlined), closed: outlined.closed !== false }
  line.remove(); outlined.remove()
  return info
})

t('stroke → outline: real icon (24-grid, stroke-width 2, Lucide-style)', () => {
  // lucide "activity" polyline, stroke 2 on 24 grid → scaled to 1024 em
  const d = 'M22 12h-4l-3 9L9 3l-3 9H2'
  const scale = 1024 / 24
  const scaled = svgpath(d).scale(scale).round(3).toString()
  const p = new paper.Path(scaled)
  const outlined = PaperOffset.offsetStroke(p, (2 * scale) / 2, { join: 'round', cap: 'round', insert: false })
  const info = { ...stats(outlined), d: round(outlined.pathData, 1).slice(0, 90) + '…' }
  p.remove(); outlined.remove()
  return info
})

// ────────────────────────────────────────────────────────────── 7. simplify
t('simplify + precision reduction', () => {
  const p = new paper.Path()
  for (let i = 0; i <= 400; i++) p.add(new paper.Point(i * 2, 400 + Math.sin(i / 8) * 100))
  const before = p.segments.length
  p.simplify(2.5)
  const after = p.segments.length
  const len = round(p.pathData, 1).length
  p.remove()
  return { segmentsBefore: before, segmentsAfter: after, reduction: `${Math.round((1 - after / before) * 100)}%`, pathDataChars: len }
})

// ────────────────────────────────────────────────────── 8. clipPath as intersect
t('clipPath → boolean intersect', () => {
  const art = new paper.Path.Star({ center: [400, 400], points: 8, radius1: 120, radius2: 260 })
  const clip = new paper.Path.Circle({ center: [400, 400], radius: 200 })
  const r = art.intersect(clip)
  const info = stats(r)
  art.remove(); clip.remove(); r.remove()
  return info
})

// ────────────────────────────────────────────────────────── 9. determinism
t('determinism: same input twice → identical pathData', () => {
  const build = () => {
    const a = new paper.Path.Circle({ center: [300, 300], radius: 150 })
    const b = new paper.Path.Rectangle({ point: [250, 250], size: [300, 120] })
    const r = a.unite(b)
    const d = round(r.pathData, 3)
    a.remove(); b.remove(); r.remove()
    return d
  }
  const d1 = build(), d2 = build()
  return { identical: d1 === d2, chars: d1.length }
})

// ────────────────────────────────────────────── 10. throughput on a real workload
t('throughput: 200 stroke→outline ops', () => {
  const d = 'M22 12h-4l-3 9L9 3l-3 9H2'
  const scaled = svgpath(d).scale(1024 / 24).toString()
  const t0 = performance.now()
  for (let i = 0; i < 200; i++) {
    const p = new paper.Path(scaled)
    const o = PaperOffset.offsetStroke(p, 42, { join: 'round', cap: 'round', insert: false })
    o.remove(); p.remove()
  }
  const ms = performance.now() - t0
  return { total: `${ms.toFixed(0)}ms`, perGlyph: `${(ms / 200).toFixed(2)}ms` }
})

// ────────────────────────────────────────────── 11. does anything touch the DOM?
t('no global DOM leaked', () => ({
  document: typeof document,
  window: typeof window,
  self: typeof self,
  navigator: typeof navigator,
  paperCanvas: !!(paper.view && paper.view.element),
}))

const pad = (s, n) => String(s).padEnd(n)
console.log('\n paper.js 0.12.18 headless spike — node ' + process.version + '\n')
for (const r of results) {
  console.log(` ${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.name, 58)} ${pad(r.ms + 'ms', 9)}`)
  console.log(`       ${JSON.stringify(r.info)}`)
}
const failed = results.filter(r => !r.ok)
console.log(`\n ${results.length - failed.length}/${results.length} passed\n`)
process.exit(failed.length ? 1 : 0)
