/**
 * A tagged-union SVG document, as found in older icon-font project files.
 *
 * Instead of storing markup, those projects store the SVG already parsed into a typed
 * tree: every node is `{ tag, args }`, and every attribute value is a typed variant
 * rather than a string — `{"tag":"Length","args":[{"tag":"Px","args":[48]}]}` for
 * `width="48"`, a list of subpaths with real command records for `d`, and so on.
 *
 * Nothing downstream wants to know that. This module renders the tree back to plain
 * SVG markup so the normal import pipeline (docs/04) can do the actual work.
 *
 * The vocabulary is open-ended and only partly attested by any one project, so the
 * renderer is deliberately forgiving: a variant it does not recognise but that wraps a
 * single scalar renders as that scalar, and anything else is dropped with a warning
 * rather than throwing. A glyph that loses one attribute still imports.
 */

/** A node or value in the tree. `args` is the constructor's payload. */
export interface Tagged {
  tag: string
  args?: unknown[]
}

export interface TaggedElement {
  tagName: string
  attributes?: Record<string, unknown>
  children?: unknown[]
}

export const isTagged = (v: unknown): v is Tagged =>
  Boolean(v) && typeof v === 'object' && typeof (v as Tagged).tag === 'string'

type Warn = (message: string) => void

/** Trims the float noise a typed tree happily carries but `d=""` should not. */
const num = (v: unknown): string => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 1e4) / 1e4)
}

const point = (p: unknown): string =>
  Array.isArray(p) ? `${num(p[0])} ${num(p[1])}` : num((p as { x?: number })?.x) + ' ' + num((p as { y?: number })?.y)

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;')

/** Stroke caps, joins, fill rules — variants whose whole meaning is one SVG keyword. */
const KEYWORDS: Record<string, string> = {
  NoPaint: 'none',
  CurrentColor: 'currentColor',
  // a palette slot with no colour of its own; a font glyph paints in the text colour
  AutomaticColor: 'currentColor',
  ButtCap: 'butt',
  RoundCap: 'round',
  SquareCap: 'square',
  MiterJoin: 'miter',
  RoundJoin: 'round',
  BevelJoin: 'bevel',
  NonZero: 'nonzero',
  EvenOdd: 'evenodd',
  Visible: 'visible',
  Hidden: 'hidden',
}

/** Variants that are a plain wrapper around a length, with the unit in the name. */
const UNITS: Record<string, string> = { Px: '', Pt: 'pt', Em: 'em', Rem: 'rem', Percent: '%', Number: '', Scalar: '' }

/**
 * Path commands. The key is the variant name; the value is the SVG letter and the
 * payload fields to emit after it, in order. `point`-shaped fields render as `x y`.
 */
const COMMANDS: Record<string, { letter: string; fields: string[] }> = {
  MoveTo: { letter: 'M', fields: ['point'] },
  LineTo: { letter: 'L', fields: ['point'] },
  HorizontalTo: { letter: 'H', fields: ['x'] },
  HorizontalLineTo: { letter: 'H', fields: ['x'] },
  VerticalTo: { letter: 'V', fields: ['y'] },
  VerticalLineTo: { letter: 'V', fields: ['y'] },
  CurveTo: { letter: 'C', fields: ['control1', 'control2', 'point'] },
  CubicTo: { letter: 'C', fields: ['control1', 'control2', 'point'] },
  SmoothCurveTo: { letter: 'S', fields: ['control2', 'point'] },
  SmoothTo: { letter: 'S', fields: ['control2', 'point'] },
  QuadraticTo: { letter: 'Q', fields: ['control', 'point'] },
  QuadTo: { letter: 'Q', fields: ['control', 'point'] },
  SmoothQuadraticTo: { letter: 'T', fields: ['point'] },
  SmoothQuadTo: { letter: 'T', fields: ['point'] },
}

/** Subpath terminators that close the shape. Anything else leaves it open. */
const CLOSING = new Set(['Connected', 'Closed', 'Close', 'ClosePath'])

function renderArc(a: Record<string, unknown>): string {
  const r = a.radii as unknown
  const rx = Array.isArray(r) ? r[0] : (a.rx ?? (r as { x?: number })?.x)
  const ry = Array.isArray(r) ? r[1] : (a.ry ?? (r as { y?: number })?.y)
  const rot = a.rotation ?? a.xAxisRotation ?? a.angle ?? 0
  const large = a.largeArc ?? a.largeArcFlag ?? a.large ?? false
  const sweep = a.sweep ?? a.sweepFlag ?? false
  const flag = (v: unknown) => (v === true || v === 1 ? '1' : '0')
  return `A${num(rx)} ${num(ry)} ${num(rot)} ${flag(large)} ${flag(sweep)} ${point(a.point ?? a.end)}`
}

function renderCommand(cmd: unknown, warn: Warn): string {
  if (!isTagged(cmd)) {
    warn('path command is not a tagged node; dropped')
    return ''
  }
  const a = (cmd.args?.[0] ?? {}) as Record<string, unknown>
  if (cmd.tag === 'ArcTo' || cmd.tag === 'EllipticalArcTo') return renderArc(a)
  const spec = COMMANDS[cmd.tag]
  if (!spec) {
    warn(`unknown path command "${cmd.tag}"; dropped`)
    return ''
  }
  const parts = spec.fields.map((f) => {
    const v = a[f]
    // `x`/`y` are scalars, everything else is a point pair
    return f === 'x' || f === 'y' ? num(v) : point(v)
  })
  return spec.letter + parts.join(' ')
}

/** A list of subpaths as they appear in a typed `d` attribute. */
function renderPaths(subpaths: unknown, warn: Warn): string {
  if (!Array.isArray(subpaths)) {
    warn('path data is not a list of subpaths; dropped')
    return ''
  }
  return subpaths
    .map((sp) => {
      const s = sp as { start?: unknown; cmds?: unknown[]; endings?: unknown }
      const parts = [`M${point(s.start ?? [0, 0])}`]
      for (const cmd of s.cmds ?? []) {
        const out = renderCommand(cmd, warn)
        if (out) parts.push(out)
      }
      if (isTagged(s.endings) && CLOSING.has(s.endings.tag)) parts.push('Z')
      return parts.join(' ')
    })
    .filter(Boolean)
    .join(' ')
}

/**
 * A typed attribute value to its SVG string, or `undefined` to omit the attribute.
 */
export function renderValue(v: unknown, warn: Warn): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'number') return num(v)
  if (typeof v === 'boolean') return String(v)
  if (!isTagged(v)) {
    warn('attribute value is not a tagged node; dropped')
    return undefined
  }
  const a = v.args ?? []
  switch (v.tag) {
    // pure wrappers: the meaning is entirely in what they hold
    case 'Value':
    case 'StringValue':
    case 'Paint':
    case 'Length':
    case 'StrokeLineCap':
    case 'StrokeLineJoin':
    case 'FillRule':
    case 'Opacity':
      return renderValue(a[0], warn)
    case 'ViewBox': {
      const b = (a[0] ?? {}) as Record<string, number>
      return `${num(b.minX)} ${num(b.minY)} ${num(b.width)} ${num(b.height)}`
    }
    case 'Paths':
      return renderPaths(a[0], warn)
    case 'Points':
      return Array.isArray(a[0])
        ? (a[0] as unknown[]).map((p) => point(p).replace(' ', ',')).join(' ')
        : undefined
    case 'Color':
    case 'Hex':
    case 'Rgb':
      return typeof a[0] === 'string' ? a[0] : undefined
  }
  if (v.tag in KEYWORDS) return KEYWORDS[v.tag]
  if (v.tag in UNITS) return num(a[0]) + UNITS[v.tag]
  // an unattested wrapper around a single scalar still means something useful
  if (a.length === 1 && (typeof a[0] === 'string' || typeof a[0] === 'number')) return renderValue(a[0], warn)
  warn(`unknown attribute value "${v.tag}"; dropped`)
  return undefined
}

/** A node in the tree to SVG markup. Comments are dropped; they carry no geometry. */
export function renderNode(node: unknown, warn: Warn): string {
  if (!isTagged(node)) {
    warn('node is not a tagged node; dropped')
    return ''
  }
  const a = node.args ?? []
  if (node.tag === 'Text') return typeof a[0] === 'string' ? escapeText(a[0]) : ''
  if (node.tag === 'Comment' || node.tag === 'CData' || node.tag === 'Doctype') return ''
  if (node.tag !== 'Element') {
    warn(`unknown node "${node.tag}"; dropped`)
    return ''
  }
  const el = (a[0] ?? {}) as TaggedElement
  if (!el.tagName) {
    warn('element has no tag name; dropped')
    return ''
  }
  const attrs = Object.entries(el.attributes ?? {})
    .map(([name, value]) => {
      const rendered = renderValue(value, (m) => warn(`<${el.tagName} ${name}>: ${m}`))
      return rendered === undefined ? '' : ` ${name}="${escapeAttr(rendered)}"`
    })
    .join('')
  const children = (el.children ?? []).map((c) => renderNode(c, warn)).join('')
  return `<${el.tagName}${attrs}>${children}</${el.tagName}>`
}

export interface RenderResult {
  svg: string
  warnings: string[]
}

/** The whole tree to a standalone SVG document. */
export function renderTaggedSvg(node: unknown): RenderResult {
  const warnings: string[] = []
  const svg = renderNode(node, (m) => warnings.push(m))
  return { svg, warnings }
}
