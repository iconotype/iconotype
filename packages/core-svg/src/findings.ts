/**
 * Every mutation the fixer makes, and every thing it cannot represent, is reported.
 * Silence is the enemy: an icon that comes out wrong should say why.
 */
export type FindingCode =
  // input the pipeline rewrote
  | 'SHAPE_CONVERTED' | 'TRANSFORM_BAKED' | 'STYLE_INLINED' | 'USE_RESOLVED'
  | 'STROKE_OUTLINED' | 'EVENODD_CONVERTED' | 'CLIP_APPLIED' | 'SELF_INTERSECT'
  | 'OPEN_CONTOUR' | 'ZERO_AREA_REMOVED' | 'SIMPLIFIED' | 'SNAPPED' | 'REFITTED'
  // approximations
  | 'MASK_APPROXIMATED' | 'CLIP_APPROXIMATED' | 'STROKE_DASHARRAY' | 'STROKE_NONUNIFORM'
  | 'OPACITY_FLATTENED'
  // things a font cannot hold
  | 'GRADIENT_UNSUPPORTED' | 'IMAGE_EMBEDDED' | 'TEXT_ELEMENT' | 'FILTER_DROPPED'
  | 'SCRIPT_STRIPPED' | 'EXTERNAL_REF'
  // quality warnings
  | 'MULTIPLE_COLORS' | 'TINY_DETAIL' | 'HIGH_POINT_COUNT' | 'OUT_OF_BOX' | 'EMPTY'
  | 'NON_INTEGER_GRID' | 'UNSUPPORTED_SELECTOR' | 'NESTED_SVG'

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  code: FindingCode
  severity: Severity
  message: string
  /** how many elements/contours this applies to */
  count?: number
}

export const SEVERITY: Record<FindingCode, Severity> = {
  SHAPE_CONVERTED: 'info', TRANSFORM_BAKED: 'info', STYLE_INLINED: 'info', USE_RESOLVED: 'info',
  STROKE_OUTLINED: 'info', EVENODD_CONVERTED: 'info', CLIP_APPLIED: 'info', SELF_INTERSECT: 'info',
  OPEN_CONTOUR: 'info', ZERO_AREA_REMOVED: 'info', SIMPLIFIED: 'info', SNAPPED: 'info', REFITTED: 'info',

  MASK_APPROXIMATED: 'warning', CLIP_APPROXIMATED: 'warning', STROKE_DASHARRAY: 'warning',
  STROKE_NONUNIFORM: 'warning', OPACITY_FLATTENED: 'warning', MULTIPLE_COLORS: 'warning',
  TINY_DETAIL: 'warning', HIGH_POINT_COUNT: 'warning', OUT_OF_BOX: 'warning',
  NON_INTEGER_GRID: 'warning', UNSUPPORTED_SELECTOR: 'warning', NESTED_SVG: 'warning',
  SCRIPT_STRIPPED: 'warning', EXTERNAL_REF: 'warning', FILTER_DROPPED: 'warning',

  GRADIENT_UNSUPPORTED: 'error', IMAGE_EMBEDDED: 'error', TEXT_ELEMENT: 'error', EMPTY: 'error',
}

export class FindingLog {
  #items = new Map<FindingCode, Finding>()

  add(code: FindingCode, message: string): void {
    const existing = this.#items.get(code)
    if (existing) {
      existing.count = (existing.count ?? 1) + 1
      return
    }
    this.#items.set(code, { code, severity: SEVERITY[code], message, count: 1 })
  }

  get list(): Finding[] {
    const order: Severity[] = ['error', 'warning', 'info']
    return [...this.#items.values()].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  }

  get hasError(): boolean {
    return [...this.#items.values()].some((f) => f.severity === 'error')
  }
}
