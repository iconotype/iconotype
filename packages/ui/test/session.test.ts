import { describe, expect, it } from 'vitest'
import { emptyProject, createHistory, type Glyph } from '@glyphsmith/core-model'
import { SessionStore } from '../src/session.svelte.js'

const glyph = (name: string): Glyph => ({
  id: name, name, aliases: [], tags: [name], paths: ['M0 0h512v512h-512z'], attrs: [{}],
  grid: 24, isMulticolor: false,
})
const store = () => new SessionStore({ project: emptyProject('p'), history: createHistory() }, () => 0)

describe('SessionStore', () => {
  /**
   * Regression: with deep $state the document is a Proxy, and every core op calls
   * structuredClone() — which throws "could not be cloned" on proxies. It only showed
   * up in the browser, because the failure is in Svelte's proxy, not in the core logic.
   * $state.raw is what makes this pass.
   */
  it('holds a structured-cloneable document (no reactive proxy)', () => {
    const s = store()
    expect(() => structuredClone(s.project)).not.toThrow()
    s.do({ t: 'glyph.add', setId: s.project.sets[0]!.id, glyphs: [glyph('a')] })
    expect(() => structuredClone(s.project)).not.toThrow()
    expect(s.glyphCount).toBe(1)
  })

  it('drives undo/redo and exposes the timeline', () => {
    const s = store()
    s.do({ t: 'glyph.add', setId: s.project.sets[0]!.id, glyphs: [glyph('a')] })
    expect(s.canUndo).toBe(true)
    s.undo()
    expect(s.glyphCount).toBe(0)
    s.redo()
    expect(s.glyphCount).toBe(1)
    expect(s.timeline.map((n) => n.label)).toEqual(['New project', 'Add glyph: a'])
  })

  it('replaces the whole document as one undoable step', () => {
    const s = store()
    s.replace({ ...emptyProject('p'), name: 'alpimaps' }, 'Import alpimaps.json')
    expect(s.project.name).toBe('alpimaps')
    expect(s.timeline.at(-1)!.label).toBe('Import alpimaps.json')
    s.undo()
    expect(s.project.name).toBe('Untitled project')
  })
})
