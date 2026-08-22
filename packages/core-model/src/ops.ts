import type { Glyph, IconSet, OutputConfig, Preferences, Project, SetId, GlyphId } from './types.js'

/**
 * Every mutation is an Op. Ops carry their own label, which is what the History
 * panel shows ("Add 55 glyphs", "Fit viewBox to content") — no separate bookkeeping.
 */
export type Op =
  | { t: 'project.rename'; name: string }
  /** wholesale document replacement (import). Carries the full doc so undo is exact. */
  | { t: 'project.replace'; project: Project }
  | { t: 'prefs.patch'; patch: DeepPartial<Preferences> }
  | { t: 'set.add'; set: IconSet; index?: number }
  | { t: 'set.remove'; setId: SetId }
  | { t: 'set.patch'; setId: SetId; patch: Partial<Omit<IconSet, 'glyphs' | 'id'>> }
  | { t: 'set.reorder'; setId: SetId; toIndex: number }
  | { t: 'glyph.add'; setId: SetId; glyphs: Glyph[]; index?: number }
  | { t: 'glyph.remove'; ids: GlyphId[] }
  /** inverse of a multi-glyph remove: puts each glyph back at its exact old index */
  | { t: 'glyph.restore'; entries: Array<{ setId: SetId; glyph: Glyph; index: number }> }
  | { t: 'glyph.patch'; id: GlyphId; patch: Partial<Omit<Glyph, 'id'>> }
  | { t: 'glyph.move'; ids: GlyphId[]; toSetId: SetId; toIndex?: number }
  | { t: 'codepoint.assign'; assignments: Record<string, number | number[]> }
  | { t: 'glyph.select'; ids: GlyphId[]; selected: boolean }
  /** exact inverse of a select over a mixed set: each glyph goes back to its own value */
  | { t: 'glyph.selectExact'; entries: Array<{ id: GlyphId; selected: boolean }> }
  | { t: 'output.patch'; patch: OutputConfig }

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export function labelOf(op: Op): string {
  switch (op.t) {
    case 'project.rename': return `Rename project to "${op.name}"`
    case 'project.replace': return `Replace project with "${op.project.name}"`
    case 'prefs.patch': return 'Change preferences'
    case 'set.add': return `Add set: ${op.set.name}`
    case 'set.remove': return 'Remove set'
    case 'set.patch': return 'Edit set'
    case 'set.reorder': return 'Reorder sets'
    case 'glyph.add': return op.glyphs.length === 1
      ? `Add glyph: ${op.glyphs[0]!.name}`
      : `Add ${op.glyphs.length} glyphs`
    case 'glyph.remove': return op.ids.length === 1 ? 'Remove glyph' : `Remove ${op.ids.length} glyphs`
    case 'glyph.restore': return op.entries.length === 1 ? 'Restore glyph' : `Restore ${op.entries.length} glyphs`
    case 'glyph.patch': return 'Edit glyph'
    case 'glyph.move': return op.ids.length === 1 ? 'Move glyph' : `Move ${op.ids.length} glyphs`
    case 'codepoint.assign': return 'Assign codepoints'
    case 'glyph.select': return `${op.selected ? 'Include' : 'Exclude'} ${op.ids.length} glyph(s)`
    case 'glyph.selectExact': return `Restore inclusion of ${op.entries.length} glyph(s)`
    case 'output.patch': return 'Change output paths'
  }
}

const clone = <T,>(v: T): T => structuredClone(v)

const findGlyph = (p: Project, id: GlyphId): { set: IconSet; index: number } | null => {
  for (const set of p.sets) {
    const index = set.glyphs.findIndex((g) => g.id === id)
    if (index >= 0) return { set, index }
  }
  return null
}

const deepMerge = <T,>(target: T, patch: DeepPartial<T>): T => {
  const out: Record<string, unknown> = { ...(target as object) } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch as object)) {
    const prev = out[k]
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object'
      ? deepMerge(prev, v as never)
      : v
  }
  return out as T
}

/**
 * Applies `op`, returning the next project AND the inverse op.
 * The inverse is what makes undo exact rather than a snapshot diff.
 */
export function apply(project: Project, op: Op): { next: Project; inverse: Op } {
  const p = clone(project)
  switch (op.t) {
    case 'project.rename': {
      const inverse: Op = { t: 'project.rename', name: p.name }
      p.name = op.name
      return { next: p, inverse }
    }
    case 'project.replace': {
      return { next: clone(op.project), inverse: { t: 'project.replace', project: clone(project) } }
    }
    case 'prefs.patch': {
      const before = clone(p.preferences)
      p.preferences = deepMerge(p.preferences, op.patch)
      return { next: p, inverse: { t: 'prefs.patch', patch: before } }
    }
    case 'set.add': {
      const index = op.index ?? p.sets.length
      p.sets.splice(index, 0, clone(op.set))
      return { next: p, inverse: { t: 'set.remove', setId: op.set.id } }
    }
    case 'set.remove': {
      const index = p.sets.findIndex((s) => s.id === op.setId)
      if (index < 0) throw new Error(`set.remove: unknown set ${op.setId}`)
      const [removed] = p.sets.splice(index, 1)
      return { next: p, inverse: { t: 'set.add', set: removed!, index } }
    }
    case 'set.patch': {
      const set = p.sets.find((s) => s.id === op.setId)
      if (!set) throw new Error(`set.patch: unknown set ${op.setId}`)
      const before: Partial<IconSet> = {}
      for (const k of Object.keys(op.patch) as Array<keyof IconSet>) (before as never as Record<string, unknown>)[k] = clone(set[k])
      Object.assign(set, clone(op.patch))
      return { next: p, inverse: { t: 'set.patch', setId: op.setId, patch: before as never } }
    }
    case 'set.reorder': {
      const from = p.sets.findIndex((s) => s.id === op.setId)
      if (from < 0) throw new Error(`set.reorder: unknown set ${op.setId}`)
      const [moved] = p.sets.splice(from, 1)
      p.sets.splice(op.toIndex, 0, moved!)
      return { next: p, inverse: { t: 'set.reorder', setId: op.setId, toIndex: from } }
    }
    case 'glyph.add': {
      const set = p.sets.find((s) => s.id === op.setId)
      if (!set) throw new Error(`glyph.add: unknown set ${op.setId}`)
      const index = op.index ?? set.glyphs.length
      set.glyphs.splice(index, 0, ...clone(op.glyphs))
      return { next: p, inverse: { t: 'glyph.remove', ids: op.glyphs.map((g) => g.id) } }
    }
    case 'glyph.remove': {
      // Locate everything FIRST: splicing as we go would shift the indices we record,
      // and the inverse would then put glyphs back in the wrong slots.
      const hits: Array<{ setId: SetId; glyph: Glyph; index: number }> = []
      for (const id of op.ids) {
        const hit = findGlyph(p, id)
        if (hit) hits.push({ setId: hit.set.id, glyph: clone(hit.set.glyphs[hit.index]!), index: hit.index })
      }
      // remove high index → low so the remaining indices stay valid
      for (const h of [...hits].sort((a, b) => b.index - a.index)) {
        p.sets.find((s) => s.id === h.setId)!.glyphs.splice(h.index, 1)
      }
      // restore low → high so each lands back at its original position
      const entries = [...hits].sort((a, b) => a.index - b.index)
      return { next: p, inverse: { t: 'glyph.restore', entries } }
    }
    case 'glyph.restore': {
      for (const e of op.entries) {
        const set = p.sets.find((s) => s.id === e.setId)
        if (!set) throw new Error(`glyph.restore: unknown set ${e.setId}`)
        set.glyphs.splice(e.index, 0, clone(e.glyph))
      }
      return { next: p, inverse: { t: 'glyph.remove', ids: op.entries.map((e) => e.glyph.id) } }
    }
    case 'glyph.patch': {
      const hit = findGlyph(p, op.id)
      if (!hit) throw new Error(`glyph.patch: unknown glyph ${op.id}`)
      const g = hit.set.glyphs[hit.index]!
      const before: Partial<Glyph> = {}
      for (const k of Object.keys(op.patch) as Array<keyof Glyph>) (before as Record<string, unknown>)[k] = clone(g[k])
      Object.assign(g, clone(op.patch))
      return { next: p, inverse: { t: 'glyph.patch', id: op.id, patch: before } }
    }
    case 'glyph.move': {
      const target = p.sets.find((s) => s.id === op.toSetId)
      if (!target) throw new Error(`glyph.move: unknown set ${op.toSetId}`)
      const origins: Array<{ setId: SetId; index: number; id: GlyphId }> = []
      const moving: Glyph[] = []
      for (const id of op.ids) {
        const hit = findGlyph(p, id)
        if (!hit) continue
        origins.push({ setId: hit.set.id, index: hit.index, id })
        moving.push(hit.set.glyphs.splice(hit.index, 1)[0]!)
      }
      target.glyphs.splice(op.toIndex ?? target.glyphs.length, 0, ...moving)
      const first = origins[0]
      return {
        next: p,
        inverse: first
          ? { t: 'glyph.move', ids: op.ids, toSetId: first.setId, toIndex: first.index }
          : { t: 'glyph.move', ids: [], toSetId: op.toSetId },
      }
    }
    case 'glyph.select': {
      const before: Array<{ id: GlyphId; selected: boolean }> = []
      for (const id of op.ids) {
        const hit = findGlyph(p, id)
        if (!hit) continue
        const glyph = hit.set.glyphs[hit.index]!
        before.push({ id, selected: glyph.selected !== false })
        glyph.selected = op.selected
      }
      // the selection may have been mixed, so the inverse carries each glyph's own value
      return { next: p, inverse: { t: 'glyph.selectExact', entries: before } }
    }
    case 'glyph.selectExact': {
      const before: Array<{ id: GlyphId; selected: boolean }> = []
      for (const entry of op.entries) {
        const hit = findGlyph(p, entry.id)
        if (!hit) continue
        const glyph = hit.set.glyphs[hit.index]!
        before.push({ id: entry.id, selected: glyph.selected !== false })
        glyph.selected = entry.selected
      }
      return { next: p, inverse: { t: 'glyph.selectExact', entries: before } }
    }
    case 'output.patch': {
      const before = clone(p.output ?? {})
      p.output = { ...(p.output ?? {}), ...clone(op.patch) }
      return { next: p, inverse: { t: 'output.patch', patch: before } }
    }
    case 'codepoint.assign': {
      const before: Record<string, number | number[]> = {}
      for (const name of Object.keys(op.assignments)) {
        const prev = p.codepoints[name]
        if (prev !== undefined) before[name] = prev
      }
      Object.assign(p.codepoints, clone(op.assignments))
      return { next: p, inverse: { t: 'codepoint.assign', assignments: before } }
    }
  }
}
