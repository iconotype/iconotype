/**
 * The shapes inside one path.
 *
 * The importer unites everything of one colour into a single path, so an icon drawn as
 * a background square plus a glyph arrives as ONE layer. To take the square out you
 * need to see it as its own thing — which means splitting the path back into shapes.
 *
 * A shape is an outline plus the holes cut into it: the counter of an "o" is part of
 * the "o", and deleting the outer ring alone would leave the counter behind as a
 * filled disc. Which subpath is a hole is decided by nesting, not by winding
 * direction — IcoMoon exports and hand-edited artwork do not wind consistently.
 *
 * Dependency-free on purpose: the editor lists shapes on every render, and the path
 * toolchain (paper.js) is loaded only when an edit actually needs it.
 */

export interface ShapeBounds { x: number; y: number; width: number; height: number }

export interface Shape {
  /** absolute path data for this shape: its outline and its holes */
  d: string
  bounds: ShapeBounds
  /** how many subpaths it is made of — 1, plus one per hole */
  subpaths: number
}

interface Subpath {
  d: string
  /** a polyline through the subpath, curves sampled — for containment only */
  points: Array<[number, number]>
  bounds: ShapeBounds
  area: number
}

const PARAMS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/** Splits path data into commands, each with its numbers. Arc flags may be written unseparated ("a1 1 0 011 1"). */
function tokenize(d: string): Array<{ cmd: string; args: number[] }> {
  const out: Array<{ cmd: string; args: number[] }> = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
  let current: { cmd: string; args: number[] } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    if (m[1]) {
      current = { cmd: m[1], args: [] }
      out.push(current)
      continue
    }
    if (!current) continue
    const upper = current.cmd.toUpperCase()
    // an arc's two flags are single digits and are allowed to run into what follows
    const slot = current.args.length % 7
    if (upper === 'A' && (slot === 3 || slot === 4) && m[2]!.length > 1 && /^[01]/.test(m[2]!)) {
      current.args.push(Number(m[2]![0]))
      re.lastIndex = m.index + 1
      continue
    }
    current.args.push(Number(m[2]))
  }
  return out
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

/** The path as absolute subpaths, curves kept, with a sampled outline for each. */
function subpathsOf(d: string): Subpath[] {
  const out: Subpath[] = []
  let x = 0, y = 0, startX = 0, startY = 0
  let text = ''
  let points: Array<[number, number]> = []

  const flush = () => {
    if (text && points.length) {
      const xs = points.map((p) => p[0]), ys = points.map((p) => p[1])
      const minX = Math.min(...xs), minY = Math.min(...ys)
      let area = 0
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i]!
        const [bx, by] = points[(i + 1) % points.length]!
        area += ax * by - bx * ay
      }
      out.push({
        d: text.trim(),
        points,
        bounds: { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY },
        area: Math.abs(area / 2),
      })
    }
    text = ''
    points = []
  }

  for (const { cmd, args } of tokenize(d)) {
    const upper = cmd.toUpperCase()
    const rel = cmd !== upper
    const n = PARAMS[upper]!
    if (upper === 'Z') {
      text += 'Z '
      x = startX; y = startY
      continue
    }
    // a command letter may be followed by several argument groups; after M they are L
    for (let i = 0; i + n <= args.length; i += n) {
      const a = args.slice(i, i + n)
      const ox = rel ? x : 0, oy = rel ? y : 0
      const kind = upper === 'M' && i > 0 ? 'L' : upper
      switch (kind) {
        case 'M':
          flush()
          x = a[0]! + ox; y = a[1]! + oy; startX = x; startY = y
          text += `M${fmt(x)} ${fmt(y)} `
          points.push([x, y])
          break
        case 'L': case 'T':
          x = a[0]! + ox; y = a[1]! + oy
          text += `${kind}${fmt(x)} ${fmt(y)} `
          points.push([x, y])
          break
        case 'H':
          x = a[0]! + (rel ? x : 0)
          text += `H${fmt(x)} `
          points.push([x, y])
          break
        case 'V':
          y = a[0]! + (rel ? y : 0)
          text += `V${fmt(y)} `
          points.push([x, y])
          break
        case 'C': case 'S': case 'Q': {
          const coords = a.map((v, k) => v + (k % 2 ? oy : ox))
          const [x0, y0] = [x, y]
          x = coords[coords.length - 2]!; y = coords[coords.length - 1]!
          text += `${kind}${coords.map(fmt).join(' ')} `
          // sampled along the control polygon: close enough to tell inside from out
          const ctrl: Array<[number, number]> = [[x0, y0]]
          for (let k = 0; k < coords.length; k += 2) ctrl.push([coords[k]!, coords[k + 1]!])
          for (const t of [0.25, 0.5, 0.75, 1]) points.push(bezier(ctrl, t))
          break
        }
        case 'A':
          x = a[5]! + ox; y = a[6]! + oy
          text += `A${a.slice(0, 5).map(fmt).join(' ')} ${fmt(x)} ${fmt(y)} `
          points.push([x, y])
          break
      }
    }
  }
  flush()
  return out
}

/** De Casteljau over however many control points there are. */
function bezier(ctrl: Array<[number, number]>, t: number): [number, number] {
  let pts = ctrl
  while (pts.length > 1) {
    const next: Array<[number, number]> = []
    for (let i = 0; i + 1 < pts.length; i++) {
      next.push([pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * t, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * t])
    }
    pts = next
  }
  return pts[0]!
}

function inside([px, py]: [number, number], poly: Array<[number, number]>): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

const within = (a: ShapeBounds, b: ShapeBounds) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height

/** Whether subpath `a` lies inside subpath `b`: boxes nest, and a majority of its points are inside. */
function contains(b: Subpath, a: Subpath): boolean {
  if (a === b || a.area >= b.area || !within(a.bounds, b.bounds)) return false
  const hits = a.points.filter((p) => inside(p, b.points)).length
  return hits * 2 > a.points.length
}

/** A path's shapes, in drawing order. A path with no geometry has none. */
export function splitShapes(d: string): Shape[] {
  const subs = subpathsOf(d)
  // for each subpath, every other subpath it sits inside
  const parents = subs.map((s) => subs.filter((o) => contains(o, s)))
  const shapes: Array<{ outline: Subpath; parts: Subpath[] }> = []
  const owner = new Map<Subpath, { outline: Subpath; parts: Subpath[] }>()
  subs.forEach((s, i) => {
    // even nesting depth: an outline (an island inside a hole is its own shape)
    if (parents[i]!.length % 2 === 0) {
      const shape = { outline: s, parts: [s] }
      shapes.push(shape)
      owner.set(s, shape)
    }
  })
  subs.forEach((s, i) => {
    if (parents[i]!.length % 2 === 0) return
    // a hole belongs to the smallest outline around it
    const around = parents[i]!.filter((p) => owner.has(p)).sort((a, b) => a.area - b.area)[0]
    const shape = around ? owner.get(around)! : undefined
    if (shape) shape.parts.push(s)
    else shapes.push({ outline: s, parts: [s] })
  })
  return shapes.map(({ outline, parts }) => ({
    d: parts.map((p) => p.d).join(' '),
    bounds: outline.bounds,
    subpaths: parts.length,
  }))
}
