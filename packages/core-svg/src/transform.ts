import { boundsOf, parsePath, pathData, unite, type Bounds } from './geometry.js'
import { getPaper } from './paper.js'

/**
 * Whole-glyph transforms: what the editor's toolbar does.
 *
 * All of it is affine except `mergeOverlaps`, and all of it operates on the glyph's
 * paths as a set — a glyph is one drawing, so moving "it" means moving every subpath
 * by the same amount, not each into its own corner.
 */

const P = () => getPaper()

export type AlignMode = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'center'
export type FlipAxis = 'horizontal' | 'vertical'

/** Applies one paper transform to every path, keeping empty entries empty. */
function each(paths: string[], fn: (item: paper.PathItem) => void): string[] {
  return paths.map((d) => {
    if (!d.trim()) return d
    const item = parsePath(d)
    fn(item)
    const out = pathData(item)
    item.remove()
    return out
  })
}

export const translatePaths = (paths: string[], dx: number, dy: number): string[] =>
  dx === 0 && dy === 0 ? paths : each(paths, (item) => item.translate(new (P().Point)(dx, dy)))

/**
 * Scales about the artwork's own centre, not the origin.
 *
 * Scaling about the origin walks the glyph towards the corner as it shrinks, which is
 * never what "make this a bit smaller" means.
 */
export function scalePaths(paths: string[], factor: number, about?: { x: number; y: number }): string[] {
  if (factor === 1) return paths
  const bounds = boundsOf(paths)
  if (!bounds) return paths
  const centre = about ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  return each(paths, (item) => item.scale(factor, new (P().Point)(centre.x, centre.y)))
}

export function flipPaths(paths: string[], axis: FlipAxis): string[] {
  const bounds = boundsOf(paths)
  if (!bounds) return paths
  const centre = new (P().Point)(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  return each(paths, (item) =>
    item.scale(axis === 'horizontal' ? -1 : 1, axis === 'horizontal' ? 1 : -1, centre))
}

export function rotatePaths(paths: string[], degrees: number, about?: { x: number; y: number }): string[] {
  if (degrees % 360 === 0) return paths
  const bounds = boundsOf(paths)
  if (!bounds) return paths
  const centre = about ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  return each(paths, (item) => item.rotate(degrees, new (P().Point)(centre.x, centre.y)))
}

/** Where the artwork should sit inside a `size`-unit box for a given alignment. */
export function alignOffset(bounds: Bounds, size: number, mode: AlignMode): { dx: number; dy: number } {
  const right = size - bounds.width
  const bottom = size - bounds.height
  switch (mode) {
    case 'left': return { dx: -bounds.x, dy: 0 }
    case 'right': return { dx: right - bounds.x, dy: 0 }
    case 'center-x': return { dx: right / 2 - bounds.x, dy: 0 }
    case 'top': return { dx: 0, dy: -bounds.y }
    case 'bottom': return { dx: 0, dy: bottom - bounds.y }
    case 'center-y': return { dx: 0, dy: bottom / 2 - bounds.y }
    case 'center': return { dx: right / 2 - bounds.x, dy: bottom / 2 - bounds.y }
  }
}

export function alignPaths(paths: string[], size: number, mode: AlignMode): string[] {
  const bounds = boundsOf(paths)
  if (!bounds) return paths
  const { dx, dy } = alignOffset(bounds, size, mode)
  return translatePaths(paths, dx, dy)
}

/** Scales the artwork to fill the box (minus padding) and centres it. */
export function fitToBox(paths: string[], size: number, padding = 0): string[] {
  const bounds = boundsOf(paths)
  if (!bounds || (!bounds.width && !bounds.height)) return paths
  const inner = size - padding * 2
  const factor = Math.min(inner / bounds.width, inner / bounds.height)
  const scaled = each(paths, (item) => item.scale(factor, new (P().Point)(0, 0)))
  return alignPaths(scaled, size, 'center')
}

/**
 * Merges overlapping subpaths into one outline.
 *
 * Two shapes that overlap are two contours in the glyph, and a non-zero fill renders
 * them as one — until something rasterizes with even-odd, or a hinting pass trips over
 * the self-intersection, and the overlap punches a hole. Uniting them up front is the
 * fix every font tool eventually offers.
 */
export function mergeOverlaps(paths: string[]): string[] {
  const drawable = paths.filter((d) => d.trim())
  if (drawable.length < 2) return paths
  const united = unite(drawable)
  return united ? [united] : paths
}

/** Rounds every coordinate onto a grid — the same snap the importer offers. */
export function snapPaths(paths: string[], grid: number, size: number): string[] {
  if (grid <= 0) return paths
  const step = size / grid
  return each(paths, (item) => {
    for (const child of ('children' in item && item.children?.length ? item.children : [item]) as paper.Path[]) {
      for (const segment of child.segments ?? []) {
        segment.point.x = Math.round(segment.point.x / step) * step
        segment.point.y = Math.round(segment.point.y / step) * step
      }
    }
  })
}
