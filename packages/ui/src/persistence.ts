import type { Host } from '@iconotype/core-host'
import type { Project } from '@iconotype/core-model'

/**
 * Projects live under `projects/<id>/project.json`, with a small index for the
 * project list. Same layout on OPFS (web), disk (desktop) and workspace (vscode) —
 * the Host adapter hides the difference.
 */
export interface ProjectSummary {
  id: string
  name: string
  glyphCount: number
  setCount: number
  updatedAt: number
}

const INDEX = 'projects/index.json'
const file = (id: string) => `projects/${id}/project.json`

export async function listProjects(host: Host): Promise<ProjectSummary[]> {
  try {
    return JSON.parse(await host.fs.readText(INDEX)) as ProjectSummary[]
  } catch {
    return []
  }
}

export const loadProject = async (host: Host, id: string): Promise<Project> =>
  JSON.parse(await host.fs.readText(file(id))) as Project

export async function saveProject(host: Host, project: Project, now: number): Promise<void> {
  await host.fs.write(file(project.id), JSON.stringify(project))
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    glyphCount: project.sets.reduce((n, s) => n + s.glyphs.length, 0),
    setCount: project.sets.length,
    updatedAt: now,
  }
  const index = (await listProjects(host)).filter((p) => p.id !== project.id)
  await host.fs.write(INDEX, JSON.stringify([summary, ...index]))
}

export async function deleteProject(host: Host, id: string): Promise<void> {
  await host.fs.remove(`projects/${id}`).catch(() => {})
  await host.fs.write(INDEX, JSON.stringify((await listProjects(host)).filter((p) => p.id !== id)))
}

/** Trailing-edge debounce; the shell owns the timer so core stays side-effect free. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
