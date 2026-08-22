import svgpath from 'svgpath'
import { FindingLog, type Finding } from './findings.js'
import { prepare } from './prepare.js'
import { traverse, type Emitted } from './traverse.js'
import { viewBoxMatrix, multiply, parseTransform, type Matrix } from './matrix.js'
import {
  applyClipAndMask, boundsOf, evenOddToNonZero, fitPaths, hygiene, statsOf, unite,
  type GeometryStats,
} from './geometry.js'
import { clearScene } from './paper.js'

export interface FixOptions {
  /** coordinate space to produce, i.e. the destination set's height */
  targetHeight?: number
  precision?: number
  /** 0 disables */
  simplifyTolerance?: number
  /** 0 disables */
  snapGrid?: number
  /** contours smaller than this fraction of the em box are dropped */
  minAreaFraction?: number
  fit?: 'none' | 'contain'
  /** padding in target units, used with fit: 'contain' */
  padding?: number
  /** below this rendered size (px at 16px display) a detail is flagged */
  tinyDetailPx?: number
  /** flag glyphs above this segment count */
  maxSegments?: number
}

export interface FixResult {
  /** one entry per colour layer; monochrome art produces exactly one */
  paths: string[]
  attrs: Array<Record<string, string>>
  isMulticolor: boolean
  findings: Finding[]
  stats: GeometryStats
}

/**
 * Merges caller options over the defaults, ignoring keys that are present but
 * undefined.
 *
 * A plain spread does not: `{ targetHeight: set?.height }` on a set that is not there
 * yet spreads `targetHeight: undefined` OVER the default, and every later stage
 * multiplies by NaN until the path builder gives up with "Use a moveTo() command
 * first" — an error that says nothing about the actual cause. Optional chaining
 * produces exactly that shape, so this is not a hypothetical.
 */
function withDefaults(options: FixOptions = {}): Required<FixOptions> {
  const opts = { ...DEFAULTS }
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) (opts as Record<string, unknown>)[key] = value
  }
  return opts
}

const DEFAULTS: Required<FixOptions> = {
  targetHeight: 1024,
  precision: 2,
  simplifyTolerance: 0,
  snapGrid: 0,
  minAreaFraction: 1e-6,
  fit: 'none',
  padding: 0,
  tinyDetailPx: 0.75,
  maxSegments: 4000,
}

/** Stage 13 — validate the finished geometry and report anything suspicious. */
function validate(paths: string[], target: number, opts: Required<FixOptions>, log: FindingLog): GeometryStats {
  const stats = statsOf(paths)
  if (!stats.contours) {
    log.add('EMPTY', 'no drawable geometry survived the pipeline')
    return stats
  }
  if (paths.some((d) => /(NaN|Infinity)/.test(d))) {
    log.add('EMPTY', 'geometry contains NaN or Infinity and cannot be used')
  }
  const b = stats.bounds!
  const slack = target * 0.001
  if (b.x < -slack || b.y < -slack || b.x + b.width > target + slack || b.y + b.height > target + slack) {
    log.add('OUT_OF_BOX', `artwork extends outside the ${target}-unit em box (${Math.round(b.x)}, ${Math.round(b.y)} to ${Math.round(b.x + b.width)}, ${Math.round(b.y + b.height)})`)
  }
  if (stats.segments > opts.maxSegments) {
    log.add('HIGH_POINT_COUNT', `${stats.segments} segments — large glyphs bloat the font and slow rasterization`)
  }
  // a feature this small vanishes when the icon is rendered at 16 px
  const smallest = Math.min(b.width, b.height)
  const renderedPx = (smallest / target) * 16
  if (smallest > 0 && renderedPx < opts.tinyDetailPx) {
    log.add('TINY_DETAIL', `smallest dimension renders at ${renderedPx.toFixed(2)} px at a 16 px icon size`)
  }
  return stats
}

/**
 * The full pipeline from docs/04. SVG source in, font-ready layers out, with every
 * mutation and every impossibility reported.
 */
export function fixSvg(source: string, options: FixOptions = {}): FixResult {
  const opts = withDefaults(options)
  const log = new FindingLog()
  clearScene()

  const { root, byId } = prepare(source, log)
  const attrs = root.attributes ?? {}

  // stage 5 (root half): viewBox to the target box, preserving aspect ratio
  const base: Matrix = multiply(
    viewBoxMatrix(attrs.viewBox, parseFloat(attrs.width ?? ''), parseFloat(attrs.height ?? ''), opts.targetHeight),
    parseTransform(attrs.transform),
  )

  const emitted: Emitted[] = []
  traverse(root, { matrix: base, style: {}, opacity: 1, precision: opts.precision }, byId, emitted, log)

  const visible = emitted.filter((e) => {
    if (e.opacity < 0.05) {
      log.add('OPACITY_FLATTENED', 'near-transparent shape dropped — a font glyph has no opacity')
      return false
    }
    if (e.opacity < 1) log.add('OPACITY_FLATTENED', 'partial opacity flattened to solid')
    return Boolean(e.d.trim())
  })

  // stages 8 and 9, per shape, before anything is merged
  const resolved = visible.map((e) => ({
    fill: e.fill,
    d: applyClipAndMask(e.evenOdd ? evenOddToNonZero(e.d) : e.d, e.clip, e.maskKeep, e.maskCut),
  }))
  if (visible.some((e) => e.evenOdd)) log.add('EVENODD_CONVERTED', 'even-odd fill converted to non-zero winding')

  // stage 10 — group by paint; distinct fills become distinct layers
  const layers = new Map<string, string[]>()
  for (const shape of resolved) {
    if (!shape.d.trim()) continue
    const key = shape.fill ?? '__default__'
    const bucket = layers.get(key)
    if (bucket) bucket.push(shape.d)
    else layers.set(key, [shape.d])
  }

  const minArea = opts.minAreaFraction * opts.targetHeight * opts.targetHeight
  const cleaned = [...layers.entries()].map(([fill, group]) => ({
    fill,
    d: hygiene(unite(group), {
      minArea,
      simplifyTolerance: opts.simplifyTolerance,
      snapGrid: opts.snapGrid,
      precision: opts.precision,
    }, log),
  }))

  // A layer can come out empty — e.g. the fill layer of a <line>, which has no area.
  // Keeping it would emit a blank glyph layer and a spurious extra codepoint.
  const surviving = cleaned.filter((layer) => layer.d.trim() !== '')

  const fitted = fitPaths(surviving.map((l) => l.d), opts.targetHeight, opts.fit, opts.padding, log)
  const paths = fitted.paths.map((d) => svgpath(d).abs().unshort().unarc().round(opts.precision).toString())

  const keys = surviving.map((l) => l.fill)
  const isMulticolor = keys.length > 1
  if (isMulticolor) log.add('MULTIPLE_COLORS', `${keys.length} distinct fills become ${keys.length} glyph layers`)

  const stats = validate(paths, opts.targetHeight, opts, log)
  clearScene()

  return {
    paths,
    attrs: keys.map((fill): Record<string, string> => (fill === '__default__' ? {} : { fill })),
    isMulticolor,
    findings: log.list,
    stats,
  }
}

/**
 * Re-run hygiene on geometry that is already in target space — used to fix glyphs that
 * came from an IcoMoon import rather than from an SVG file.
 */
export function fixPaths(
  paths: string[], options: FixOptions & { attrs?: Array<Record<string, string>> } = {},
): FixResult {
  const opts = withDefaults(options)
  const log = new FindingLog()
  clearScene()

  const minArea = opts.minAreaFraction * opts.targetHeight * opts.targetHeight
  let out = paths.map((d) =>
    hygiene(d, {
      minArea,
      simplifyTolerance: opts.simplifyTolerance,
      snapGrid: opts.snapGrid,
      precision: opts.precision,
    }, log))

  const fitted = fitPaths(out, opts.targetHeight, opts.fit, opts.padding, log)
  out = fitted.paths.map((d) => svgpath(d).abs().unshort().unarc().round(opts.precision).toString())

  const stats = validate(out, opts.targetHeight, opts, log)
  clearScene()
  const attrs = (options.attrs ?? paths.map(() => ({}))).slice(0, out.length)
  return { paths: out, attrs, isMulticolor: attrs.length > 1, findings: log.list, stats }
}

export { boundsOf }
