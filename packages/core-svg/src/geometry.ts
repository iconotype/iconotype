import type paper from 'paper'
import { getPaper } from './paper.js'
import type { FindingLog } from './findings.js'

/**
 * Stages 9 to 12 of docs/04: winding conversion, clip/mask booleans, geometry hygiene
 * and fitting. Everything here goes through paper, and everything in and out is path
 * data — the package must stay DOM free (see spikes/01).
 */

export interface HygieneOptions {
  /** drop contours whose absolute area is below this (in target units squared) */
  minArea?: number
  /** Douglas-Peucker style tolerance; 0 disables */
  simplifyTolerance?: number
  /** snap coordinates to this grid; 0 disables */
  snapGrid?: number
  precision?: number
}

const P = () => getPaper()

/**
 * paper 0.12 ships `resolveCrossings()` at runtime (it is in the published API docs)
 * but omits it from its bundled .d.ts. Declared narrowly rather than casting to any.
 */
interface Resolvable { resolveCrossings(): paper.PathItem }

export const parsePath = (d: string): paper.CompoundPath =>
  new (P().CompoundPath)({ pathData: d, insert: false })

export const pathData = (item: paper.PathItem): string => item.pathData ?? ''

const contoursOf = (item: paper.PathItem): paper.Path[] => {
  const cp = item as paper.CompoundPath
  return (cp.children?.length ? (cp.children as paper.Path[]) : [item as paper.Path]).filter(Boolean)
}

/**
 * Stage 9 — even-odd to non-zero.
 *
 * Fonts only know non-zero winding. `reorient(false)` reads the contours with even-odd
 * semantics and flips them so the same visual result holds under non-zero. Verified
 * against a six-ring bullseye: directions come out cw,ccw,cw,ccw,cw,ccw and the area
 * matches the analytic even-odd area.
 */
export function evenOddToNonZero(d: string): string {
  const item = parsePath(d)
  item.fillRule = 'evenodd'
  const reoriented = item.reorient(false)
  const out = pathData(reoriented)
  reoriented.remove()
  item.remove()
  return out
}

/** Stage 8 (geometry half) — apply collected clip and mask regions. */
export function applyClipAndMask(
  d: string, clip: string | undefined, maskKeep: string | undefined, maskCut: string | undefined,
): string {
  if (!clip && !maskKeep && !maskCut) return d
  let item: paper.PathItem = parsePath(d)
  const combine = (other: string, op: 'intersect' | 'subtract') => {
    const mask = parsePath(other)
    const next = op === 'intersect' ? item.intersect(mask) : item.subtract(mask)
    mask.remove()
    item.remove()
    item = next
  }
  if (clip) combine(clip, 'intersect')
  if (maskKeep) combine(maskKeep, 'intersect')
  if (maskCut) combine(maskCut, 'subtract')
  const out = pathData(item)
  item.remove()
  return out
}

/** Union of several path strings into one — how colour layers are merged. */
export function unite(paths: string[]): string {
  if (paths.length === 0) return ''
  if (paths.length === 1) return paths[0]!
  let acc: paper.PathItem = parsePath(paths[0]!)
  for (const next of paths.slice(1)) {
    const other = parsePath(next)
    const merged = acc.unite(other)
    other.remove()
    acc.remove()
    acc = merged
  }
  const out = pathData(acc)
  acc.remove()
  return out
}

/**
 * Stage 11 — geometry hygiene.
 * Resolves self-intersections, closes open contours, drops degenerate ones, and
 * optionally simplifies and snaps.
 */
export function hygiene(d: string, opts: HygieneOptions, log: FindingLog): string {
  if (!d.trim()) return d
  const item = parsePath(d)

  const openContours = contoursOf(item).filter((c) => !c.closed).length
  if (openContours) {
    for (const contour of contoursOf(item)) if (!contour.closed) contour.closePath()
    log.add('OPEN_CONTOUR', `${openContours} open contour(s) closed — a font glyph has no open paths`)
  }

  // resolveCrossings turns a self-overlapping outline into well-formed contours
  const crossings = contoursOf(item).reduce((n, c) => n + (c.getCrossings?.(c)?.length ?? 0), 0)
  const resolved: paper.PathItem = (item as unknown as Resolvable).resolveCrossings()
  if (crossings) log.add('SELF_INTERSECT', 'self-intersections resolved')

  const minArea = opts.minArea ?? 0
  if (minArea > 0) {
    let removed = 0
    for (const contour of contoursOf(resolved)) {
      if (Math.abs(contour.area) < minArea) { contour.remove(); removed++ }
    }
    if (removed) log.add('ZERO_AREA_REMOVED', `${removed} degenerate contour(s) removed`)
  }

  if (opts.simplifyTolerance && opts.simplifyTolerance > 0) {
    const before = contoursOf(resolved).reduce((n, c) => n + c.segments.length, 0)
    for (const contour of contoursOf(resolved)) contour.simplify(opts.simplifyTolerance)
    const after = contoursOf(resolved).reduce((n, c) => n + c.segments.length, 0)
    if (after < before) log.add('SIMPLIFIED', `${before} to ${after} segments`)
  }

  if (opts.snapGrid && opts.snapGrid > 0) {
    const g = opts.snapGrid
    for (const contour of contoursOf(resolved)) {
      for (const segment of contour.segments) {
        segment.point.x = Math.round(segment.point.x / g) * g
        segment.point.y = Math.round(segment.point.y / g) * g
      }
    }
    log.add('SNAPPED', `coordinates snapped to a ${g}-unit grid`)
  }

  const out = pathData(resolved)
  resolved.remove()
  item.remove()
  return out
}

export interface Bounds { x: number; y: number; width: number; height: number }

export function boundsOf(paths: string[]): Bounds | null {
  const joined = paths.filter(Boolean).join('')
  if (!joined.trim()) return null
  const item = parsePath(joined)
  const b = item.bounds
  const out = { x: b.x, y: b.y, width: b.width, height: b.height }
  item.remove()
  return out.width || out.height ? out : null
}

/**
 * Stage 12 — fit artwork into the em box.
 * `contain` scales uniformly to the target minus padding and centres; `none` leaves the
 * geometry alone (the right default for artwork already drawn on grid).
 */
export function fitPaths(
  paths: string[], target: number, mode: 'none' | 'contain', padding: number, log: FindingLog,
): { paths: string[]; scale: number } {
  if (mode === 'none') return { paths, scale: 1 }
  const bounds = boundsOf(paths)
  if (!bounds) return { paths, scale: 1 }

  const inner = target - padding * 2
  const scale = Math.min(inner / bounds.width, inner / bounds.height)
  const dx = padding + (inner - bounds.width * scale) / 2 - bounds.x * scale
  const dy = padding + (inner - bounds.height * scale) / 2 - bounds.y * scale
  if (Math.abs(scale - 1) < 1e-6 && Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return { paths, scale: 1 }
  }

  log.add('REFITTED', `artwork scaled by ${scale.toFixed(3)} and centred in the ${target}-unit box`)
  return {
    scale,
    paths: paths.map((d) => {
      if (!d.trim()) return d
      const item = parsePath(d)
      item.scale(scale, new (P().Point)(0, 0))
      item.translate(new (P().Point)(dx, dy))
      const out = pathData(item)
      item.remove()
      return out
    }),
  }
}

export interface GeometryStats {
  contours: number
  segments: number
  bounds: Bounds | null
}

export function statsOf(paths: string[]): GeometryStats {
  const joined = paths.filter(Boolean).join('')
  if (!joined.trim()) return { contours: 0, segments: 0, bounds: null }
  const item = parsePath(joined)
  const contours = contoursOf(item)
  const stats: GeometryStats = {
    contours: contours.length,
    segments: contours.reduce((n, c) => n + c.segments.length, 0),
    bounds: { x: item.bounds.x, y: item.bounds.y, width: item.bounds.width, height: item.bounds.height },
  }
  item.remove()
  return stats
}
