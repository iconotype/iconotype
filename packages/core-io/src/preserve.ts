/**
 * Lossless round-tripping helpers.
 *
 * Two things must survive an import → export cycle that a naive mapper destroys:
 *   1. KEY ORDER. IcoMoon is not consistent — one set writes `licenseURL,license`,
 *      another writes `license,licenseURL`. JSON.stringify preserves insertion order,
 *      so a byte-identical re-export means rebuilding objects in the original order.
 *   2. ARRAY POSITION. `icons[]` and `selection[]` are NOT sorted by id; display order
 *      lives in `selection[].order`. Re-sorting on export silently rewrites the file.
 *
 * So on import we record the original key order and array index, and on export we
 * replay them. Heavy mapped fields (paths, attrs) are never duplicated into `foreign`.
 */
export interface Preserved {
  /** original key order of the source object */
  keyOrder?: string[]
  /** unmapped fields, verbatim */
  raw?: Record<string, unknown>
  /** original index in the source array */
  index?: number
}

export function capture(source: Record<string, unknown>, mapped: Set<string>): Preserved {
  const raw: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) if (!mapped.has(k)) raw[k] = structuredClone(v)
  return { keyOrder: Object.keys(source), ...(Object.keys(raw).length ? { raw } : {}) }
}

/**
 * Rebuilds an object in the original key order.
 * `mapped` wins over `raw`; undefined mapped values are treated as absent (so a field
 * the original did not have does not appear as `"license": undefined`).
 */
export function rebuild(p: Preserved | undefined, mapped: Record<string, unknown>): Record<string, unknown> {
  const raw = p?.raw ?? {}
  const has = (o: Record<string, unknown>, k: string) => k in o && o[k] !== undefined
  const out: Record<string, unknown> = {}
  for (const k of p?.keyOrder ?? []) {
    if (has(mapped, k)) out[k] = mapped[k]
    else if (has(raw, k)) out[k] = raw[k]
  }
  // fields the source did not have (newly set by the user) go last
  for (const [k, v] of Object.entries(mapped)) if (!(k in out) && v !== undefined) out[k] = v
  for (const [k, v] of Object.entries(raw)) if (!(k in out) && v !== undefined) out[k] = v
  return out
}

/** Restores original array positions; items with no recorded index are appended in order. */
export function reorderByOriginalIndex<T>(items: T[], indexOf: (item: T) => number | undefined): T[] {
  const placed: Array<T | undefined> = []
  const appended: T[] = []
  for (const item of items) {
    const i = indexOf(item)
    if (i === undefined || placed[i] !== undefined) appended.push(item)
    else placed[i] = item
  }
  return [...placed.filter((x): x is T => x !== undefined), ...appended]
}
