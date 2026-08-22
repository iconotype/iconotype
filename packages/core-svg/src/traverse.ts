import type { INode } from 'svgson'
import { children } from './prepare.js'
import type { FindingLog } from './findings.js'
import { bakePath, shapeToPath } from './normalize.js'
import { isNonUniform, multiply, parseTransform, scaleOf, type Matrix } from './matrix.js'
import { outlineStroke } from './paper.js'

/** A drawable produced by traversal: geometry in final coordinates, plus paint. */
export interface Emitted {
  d: string
  fill: string | null
  /** true when the source declared fill-rule: evenodd */
  evenOdd: boolean
  /** clip geometry (already transformed) to intersect with */
  clip?: string
  /** mask regions to intersect with / subtract */
  maskKeep?: string
  maskCut?: string
  opacity: number
}

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const CONTAINERS = new Set(['g', 'a', 'svg', 'symbol'])
const DEFS_LIKE = new Set([
  'defs', 'clipPath', 'mask', 'marker', 'pattern', 'linearGradient', 'radialGradient',
  'title', 'desc', 'metadata', 'style', 'filter',
])

const isNone = (v: string | undefined) => v === undefined || v === 'none' || v === 'transparent'
const num = (v: string | undefined, dflt: number) => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : dflt
}

/** A primitive with no extent draws nothing; paper would silently swallow it. */
function isDegenerate(tag: string, attrs: Record<string, string>): boolean {
  const n = (k: string) => parseFloat(attrs[k] ?? '')
  if (tag === 'rect') return !(n('width') > 0) || !(n('height') > 0)
  if (tag === 'circle') return !(n('r') > 0)
  if (tag === 'ellipse') return !(n('rx') > 0) || !(n('ry') > 0)
  return false
}

/** Inheritable paint properties. */
const INHERITED = [
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-opacity', 'color',
]

export interface TraverseContext {
  matrix: Matrix
  style: Record<string, string>
  clip?: string
  maskKeep?: string
  maskCut?: string
  opacity: number
  precision: number
}

/** Converts a referenced element's children into one path string, in final coordinates. */
function referencedGeometry(
  node: INode, matrix: Matrix, precision: number, filter?: (n: INode) => boolean,
): string {
  const parts: string[] = []
  const walk = (n: INode, m: Matrix) => {
    for (const child of children(n)) {
      const cm = multiply(m, parseTransform(child.attributes?.transform))
      if (CONTAINERS.has(child.name)) { walk(child, cm); continue }
      if (!SHAPES.has(child.name)) continue
      if (filter && !filter(child)) continue
      const raw = shapeToPath(child.name, child.attributes ?? {})
      if (raw) parts.push(bakePath(raw, cm, { precision }))
    }
  }
  walk(node, matrix)
  return parts.join('')
}

/** Luminance masks are approximated: light areas keep, dark areas cut. */
function luminanceOf(fill: string | undefined): number {
  if (!fill || fill === 'none') return 1
  const key = fill.trim().toLowerCase()
  const named: Record<string, number> = { white: 1, black: 0 }
  if (key in named) return named[key]!
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(key)
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(key)
  if (rgb) {
    const [r = 0, g = 0, b = 0] = rgb[1]!.split(/[\s,]+/).map((n) => parseFloat(n) / 255)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return 1
}

function resolveReference(
  attr: string | undefined, byId: Map<string, INode>, log: FindingLog,
): INode | null {
  const id = /url\(#([^)]+)\)/.exec(attr ?? '')?.[1]
  if (!id) return null
  const node = byId.get(id)
  if (!node) {
    log.add('EXTERNAL_REF', `reference #${id} not found`)
    return null
  }
  const units = node.attributes?.clipPathUnits ?? node.attributes?.maskContentUnits
  if (units === 'objectBoundingBox') {
    log.add('CLIP_APPROXIMATED', 'objectBoundingBox units approximated as userSpaceOnUse')
  }
  return node
}

/** Stages 4 to 8: shapes to paths, transforms baked, strokes outlined, clips and masks collected. */
export function traverse(
  node: INode, ctx: TraverseContext, byId: Map<string, INode>, out: Emitted[], log: FindingLog,
): void {
  for (const child of children(node)) {
    const tag = child.name
    const attrs = child.attributes ?? {}

    if (DEFS_LIKE.has(tag)) continue
    if (tag === 'text' || tag === 'tspan') {
      log.add('TEXT_ELEMENT', 'text needs the source font to become paths, convert it first')
      continue
    }
    if (tag === 'image') {
      log.add('IMAGE_EMBEDDED', 'image cannot be represented in a font')
      continue
    }

    // filters are referenced by attribute; the <filter> element itself sits in <defs>
    // and is never visited, so the attribute is the only place to catch it
    if (attrs.filter && attrs.filter !== 'none') {
      log.add('FILTER_DROPPED', 'filter cannot be represented in a font and was dropped')
    }

    const matrix = multiply(ctx.matrix, parseTransform(attrs.transform))
    const style: Record<string, string> = { ...ctx.style }
    for (const key of INHERITED) if (attrs[key] !== undefined) style[key] = attrs[key]!

    const groupOpacity = ctx.opacity * num(attrs.opacity, 1)

    // clip-path and mask apply to this element and everything under it
    let clip = ctx.clip
    const clipNode = resolveReference(attrs['clip-path'], byId, log)
    if (clipNode) {
      const geometry = referencedGeometry(clipNode, matrix, ctx.precision)
      clip = clip ? clip + geometry : geometry
      log.add('CLIP_APPLIED', 'clipPath resolved as a boolean intersection')
    }

    let maskKeep = ctx.maskKeep
    let maskCut = ctx.maskCut
    const maskNode = resolveReference(attrs.mask, byId, log)
    if (maskNode) {
      const keep = referencedGeometry(maskNode, matrix, ctx.precision, (n) => luminanceOf(n.attributes?.fill) > 0.5)
      const cut = referencedGeometry(maskNode, matrix, ctx.precision, (n) => luminanceOf(n.attributes?.fill) <= 0.5)
      if (keep) maskKeep = (maskKeep ?? '') + keep
      if (cut) maskCut = (maskCut ?? '') + cut
      log.add('MASK_APPROXIMATED', 'mask approximated: light areas keep, dark areas cut')
    }

    if (CONTAINERS.has(tag)) {
      if (tag === 'svg') log.add('NESTED_SVG', 'nested svg flattened, its own viewBox is ignored')
      traverse(child, { ...ctx, matrix, style, clip, maskKeep, maskCut, opacity: groupOpacity }, byId, out, log)
      continue
    }
    if (!SHAPES.has(tag)) continue

    if (isDegenerate(tag, attrs)) {
      log.add('ZERO_AREA_REMOVED', `${tag} with zero width, height or radius removed`)
      continue
    }

    const raw = shapeToPath(tag, attrs)
    if (!raw) continue
    if (tag !== 'path') log.add('SHAPE_CONVERTED', `${tag} converted to a path`)
    // the accumulated matrix matters, not just this element's own transform attribute:
    // a transform on any ancestor is equally baked away here
    if (matrix.join() !== '1,0,0,1,0,0') log.add('TRANSFORM_BAKED', 'transforms baked into path data')

    for (const paint of [style.fill, style.stroke]) {
      if (paint && /^url\(/.test(paint)) {
        log.add('GRADIENT_UNSUPPORTED', `${paint} cannot be represented in a font`)
      }
    }

    const placed = bakePath(raw, matrix, { precision: ctx.precision })
    const strokeWidth = num(style['stroke-width'], 1)
    const hasStroke = !isNone(style.stroke) && strokeWidth > 0
    // an ABSENT fill means black; only an explicit none/transparent suppresses it
    const explicitNoFill = style.fill !== undefined && isNone(style.fill)
    const fillOpacity = groupOpacity * num(style['fill-opacity'], 1)

    if (!explicitNoFill) {
      out.push({
        d: placed,
        fill: style.fill ?? null,
        evenOdd: style['fill-rule'] === 'evenodd',
        clip, maskKeep, maskCut,
        opacity: fillOpacity,
      })
    }
    if (hasStroke) {
      if (isNonUniform(matrix)) {
        log.add('STROKE_NONUNIFORM', 'non-uniform scaling on a stroked shape, outline width is approximated')
      }
      if (style['stroke-dasharray'] && style['stroke-dasharray'] !== 'none') {
        log.add('STROKE_DASHARRAY', 'dashed stroke outlined as solid')
      }
      out.push({
        d: outlineStroke(placed, strokeWidth * scaleOf(matrix), {
          cap: style['stroke-linecap'] === 'round' ? 'round' : 'butt',
          join: (style['stroke-linejoin'] as 'miter' | 'round' | 'bevel') ?? 'miter',
          miterLimit: num(style['stroke-miterlimit'], 4),
        }),
        fill: isNone(style.stroke) ? null : (style.stroke ?? null),
        evenOdd: false,
        clip, maskKeep, maskCut,
        opacity: groupOpacity * num(style['stroke-opacity'], 1),
      })
      log.add('STROKE_OUTLINED', 'stroke converted to an outline')
    }
  }
}
