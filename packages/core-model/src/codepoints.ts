import type { Project } from './types.js'

/** Private Use Area. IcoMoon starts at 0xE900; we match so imports keep their codes. */
export const PUA_START = 0xe900
export const PUA_END = 0xf8ff

export interface AllocationResult {
  assignments: Record<string, number | number[]>
  /** names that could not be placed (PUA exhausted) */
  overflow: string[]
}

const used = (project: Project): Set<number> => {
  const s = new Set<number>()
  for (const v of Object.values(project.codepoints)) {
    if (Array.isArray(v)) v.forEach((c) => s.add(c))
    else s.add(v)
  }
  return s
}

/**
 * Append-only allocation. An already-assigned name KEEPS its codepoint — a stale
 * CSS build referencing \\e901 must never start rendering a different glyph.
 * Reclaiming freed slots is opt-in and deliberately awkward.
 */
export function allocate(
  project: Project,
  requests: Array<{ name: string; layers?: number }>,
  opts: { reclaim?: boolean } = {},
): AllocationResult {
  const taken = used(project)
  const assignments: Record<string, number | number[]> = {}
  const overflow: string[] = []
  let cursor = PUA_START
  if (!opts.reclaim) {
    for (const c of taken) if (c >= cursor) cursor = c + 1
  }

  const nextFree = (run: number): number | null => {
    for (let start = cursor; start + run - 1 <= PUA_END; start++) {
      let ok = true
      for (let i = 0; i < run; i++) if (taken.has(start + i)) { ok = false; start += i; break }
      if (ok) { cursor = start + run; return start }
    }
    return null
  }

  for (const req of requests) {
    if (project.codepoints[req.name] !== undefined) continue // already stable — leave it
    const run = Math.max(1, req.layers ?? 1)
    const start = nextFree(run)
    if (start === null) { overflow.push(req.name); continue }
    for (let i = 0; i < run; i++) taken.add(start + i)
    assignments[req.name] = run === 1 ? start : Array.from({ length: run }, (_, i) => start + i)
  }
  return { assignments, overflow }
}

/**
 * The codepoints a glyph needs once its layer count changed — new artwork swapped in,
 * say — or `undefined` when what it has already fits (or it has none yet, which is
 * `allocate`'s job).
 *
 * Layer `i` of a multicolor glyph is drawn at its `i`th codepoint, and a font build
 * DROPS any layer without one. So a monochrome icon whose artwork is replaced by a
 * two-colour SVG needs a second codepoint, or half of it silently goes missing. The
 * codepoints it has are kept, in order; extra ones come from the free space, and
 * surplus ones are released from the end.
 */
export function fitCodepoints(project: Project, name: string, layers: number): number | number[] | undefined {
  const current = project.codepoints[name]
  if (current === undefined) return undefined
  const codes = Array.isArray(current) ? current : [current]
  const want = Math.max(1, layers)
  if (codes.length === want) return undefined
  if (codes.length > want) return want === 1 ? codes[0]! : codes.slice(0, want)
  const key = '\u0000more'
  const { assignments, overflow } = allocate(project, [{ name: key, layers: want - codes.length }])
  if (overflow.length) return undefined
  const more = assignments[key]!
  return [...codes, ...(Array.isArray(more) ? more : [more])]
}

export const hex = (cp: number): string => cp.toString(16).padStart(4, '0')

/** Serializes codepoints.lock — hand-editable, diff-friendly, sorted by codepoint. */
export function serializeLock(project: Project): string {
  const rows = Object.entries(project.codepoints).sort((a, b) => {
    const av = Array.isArray(a[1]) ? a[1][0]! : a[1]
    const bv = Array.isArray(b[1]) ? b[1][0]! : b[1]
    return av - bv
  })
  const lines = [
    '# iconotype codepoint lock — append-only.',
    '# Changing an existing line is a BREAKING change for every consumer of this font.',
    '',
    ...rows.map(([name, v]) =>
      !Array.isArray(v)
        ? `${name}\tU+${hex(v)}`
        // a run is written as a range; a run with a gap in it (a layer deleted out of
        // the middle) as a list, or reading it back would invent the missing codes
        : v.every((c, i) => i === 0 || c === v[i - 1]! + 1)
          ? `${name}\tU+${hex(v[0]!)}..U+${hex(v[v.length - 1]!)}`
          : `${name}\t${v.map((c) => `U+${hex(c)}`).join(',')}`),
  ]
  return lines.join('\n') + '\n'
}

export function parseLock(text: string): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const [name, spec] = t.split(/\s+/)
    if (!name || !spec) continue
    const range = spec.match(/^U\+([0-9a-fA-F]+)\.\.U\+([0-9a-fA-F]+)$/)
    if (range) {
      const from = parseInt(range[1]!, 16)
      const to = parseInt(range[2]!, 16)
      out[name] = Array.from({ length: to - from + 1 }, (_, i) => from + i)
    } else if (/^U\+[0-9a-fA-F]+(,U\+[0-9a-fA-F]+)+$/.test(spec)) {
      out[name] = spec.split(',').map((c) => parseInt(c.slice(2), 16))
    } else {
      const single = spec.match(/^U\+([0-9a-fA-F]+)$/)
      if (single) out[name] = parseInt(single[1]!, 16)
    }
  }
  return out
}
