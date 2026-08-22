import { describe, expect, it } from 'vitest'
import { createMemoryHost } from '@iconotype/core-host'
import { emptyProject } from '@iconotype/core-model'
import { deleteProject, listProjects, loadProject, saveProject } from '../src/persistence.js'

describe('project persistence', () => {
  it('saves, lists and reloads through the Host adapter', async () => {
    const host = createMemoryHost()
    const project = emptyProject('p1', 'alpimaps')
    await saveProject(host, project, 1000)

    const list = await listProjects(host)
    expect(list).toEqual([{ id: 'p1', name: 'alpimaps', glyphCount: 0, setCount: 1, updatedAt: 1000 }])
    expect(await loadProject(host, 'p1')).toEqual(project)
  })

  it('puts the most recently saved project first', async () => {
    const host = createMemoryHost()
    await saveProject(host, emptyProject('a', 'A'), 1)
    await saveProject(host, emptyProject('b', 'B'), 2)
    await saveProject(host, emptyProject('a', 'A'), 3)
    expect((await listProjects(host)).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('returns an empty list when nothing has been saved yet', async () => {
    expect(await listProjects(createMemoryHost())).toEqual([])
  })

  it('removes a project from the index on delete', async () => {
    const host = createMemoryHost()
    await saveProject(host, emptyProject('a', 'A'), 1)
    await deleteProject(host, 'a')
    expect(await listProjects(host)).toEqual([])
  })
})
