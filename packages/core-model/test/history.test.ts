import { describe, expect, it } from 'vitest'
import {
  branches, canRedo, canUndo, commit, createHistory, emptyProject, goto, redo, timeline, undo,
  type Glyph, type Session,
} from '../src/index.js'

const glyph = (id: string, name = id): Glyph => ({
  id, name, aliases: [], tags: [name], paths: ['M0 0h512v512h-512z'], attrs: [{}],
  grid: 24, isMulticolor: false,
})
const start = (): Session => ({ project: emptyProject('p'), history: createHistory() })
const setId = (s: Session) => s.project.sets[0]!.id

describe('history tree', () => {
  it('commits, undoes and redoes', () => {
    let s = start()
    expect(canUndo(s)).toBe(false)
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('a')] })
    expect(s.project.sets[0]!.glyphs).toHaveLength(1)
    expect(canUndo(s)).toBe(true)
    s = undo(s)
    expect(s.project.sets[0]!.glyphs).toHaveLength(0)
    expect(canRedo(s)).toBe(true)
    s = redo(s)
    expect(s.project.sets[0]!.glyphs[0]!.name).toBe('a')
  })

  it('undo is exact: round-trip restores deep equality', () => {
    let s = start()
    const before = structuredClone(s.project)
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('a'), glyph('b'), glyph('c')] })
    s = commit(s, { t: 'glyph.remove', ids: ['a', 'c'] })
    s = commit(s, { t: 'prefs.patch', patch: { font: { prefix: 'gs-' } } })
    s = undo(undo(undo(s)))
    expect(s.project).toEqual(before)
  })

  it('multi-glyph remove restores exact positions', () => {
    let s = start()
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('a'), glyph('b'), glyph('c'), glyph('d')] })
    s = commit(s, { t: 'glyph.remove', ids: ['b', 'd'] })
    expect(s.project.sets[0]!.glyphs.map((g) => g.id)).toEqual(['a', 'c'])
    s = undo(s)
    expect(s.project.sets[0]!.glyphs.map((g) => g.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  // The whole reason history is a tree: editing after an undo must not destroy the future.
  it('editing after undo BRANCHES instead of discarding the redo', () => {
    let s = start()
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('a')] })
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('b')] })
    const bNode = s.history.currentId
    s = undo(s)
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('c')] })

    expect(s.project.sets[0]!.glyphs.map((g) => g.id)).toEqual(['a', 'c'])
    const alt = branches(s.history)
    expect(alt).toHaveLength(1)
    expect(alt[0]!.alternatives.map((n) => n.id)).toContain(bNode)

    // the abandoned branch is still reachable
    s = goto(s, bNode)
    expect(s.project.sets[0]!.glyphs.map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('goto walks across branches via the common ancestor', () => {
    let s = start()
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('a')] })
    const root = s.history.currentId
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('b')] })
    const left = s.history.currentId
    s = goto(s, root)
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('c')] })
    const right = s.history.currentId

    s = goto(s, left)
    expect(s.project.sets[0]!.glyphs.map((g) => g.id)).toEqual(['a', 'b'])
    s = goto(s, right)
    expect(s.project.sets[0]!.glyphs.map((g) => g.id)).toEqual(['a', 'c'])
  })

  it('import is a single undoable step', () => {
    let s = start()
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('a')] })
    const before = structuredClone(s.project)
    const imported = { ...emptyProject('p'), name: 'alpimaps' }
    s = commit(s, { t: 'project.replace', project: imported })
    expect(s.project.name).toBe('alpimaps')
    s = undo(s)
    expect(s.project).toEqual(before)
  })

  it('restores a MIXED inclusion set exactly on undo', () => {
    let s = start()
    const set = setId(s)
    s = commit(s, { t: 'glyph.add', setId: set, glyphs: [glyph('a'), glyph('b'), glyph('c')] })
    s = commit(s, { t: 'glyph.select', ids: ['b'], selected: false })
    // now a=on, b=off, c=on — excluding all three must undo back to that mix
    s = commit(s, { t: 'glyph.select', ids: ['a', 'b', 'c'], selected: false })
    expect(s.project.sets[0]!.glyphs.map((g) => g.selected)).toEqual([false, false, false])
    s = undo(s)
    expect(s.project.sets[0]!.glyphs.map((g) => g.selected !== false)).toEqual([true, false, true])
  })

  it('labels the timeline the way the History panel renders it', () => {
    let s = start()
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('a', 'altitude')] })
    s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('b'), glyph('c')] })
    expect(timeline(s.history).map((n) => n.label)).toEqual(['New project', 'Add glyph: altitude', 'Add 2 glyphs'])
  })

  it('never calls Date.now(): identical op sequences produce identical state', () => {
    const build = () => {
      let s = start()
      s = commit(s, { t: 'glyph.add', setId: setId(s), glyphs: [glyph('a')] })
      s = commit(s, { t: 'project.rename', name: 'x' })
      return s
    }
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()))
  })
})
