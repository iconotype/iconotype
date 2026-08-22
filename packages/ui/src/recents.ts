import type { Host } from '@iconotype/core-host'

/**
 * Recently opened projects, for switching between them.
 *
 * Kept next to the project store (`recent.json`), so it lands in OPFS on the web and
 * in the app data directory on the desktop without either shell knowing the
 * difference. Paths are recorded when there is one — a desktop project is a file
 * somewhere, and "which one is this?" is answered by its folder far more often than by
 * its name, since half of them are called `icons`.
 */

export interface RecentProject {
  /** absolute file path, when the project came from disk */
  path?: string
  /** id in the host's own project store, when it did not */
  id?: string
  name: string
  openedAt: number
}

const FILE = 'recent.json'
const LIMIT = 12

const key = (entry: Pick<RecentProject, 'path' | 'id'>) => entry.path ?? `id:${entry.id ?? ''}`

export async function listRecents(host: Host): Promise<RecentProject[]> {
  try {
    const parsed = JSON.parse(await host.fs.readText(FILE)) as RecentProject[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Moves an entry to the front, or adds it. Never grows past `LIMIT`. */
export async function recordRecent(host: Host, entry: RecentProject): Promise<RecentProject[]> {
  const rest = (await listRecents(host)).filter((r) => key(r) !== key(entry))
  const next = [entry, ...rest].slice(0, LIMIT)
  await host.fs.write(FILE, JSON.stringify(next))
  return next
}

export async function forgetRecent(host: Host, entry: RecentProject): Promise<RecentProject[]> {
  const next = (await listRecents(host)).filter((r) => key(r) !== key(entry))
  await host.fs.write(FILE, JSON.stringify(next))
  return next
}

/** The folder a recent lives in, shortened for display. `~` for the home directory. */
export function folderOf(entry: RecentProject, home?: string): string {
  if (!entry.path) return 'browser storage'
  const folder = entry.path.replace(/[\\/][^\\/]+$/, '')
  return home && folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder
}

/**
 * The bits of chrome a person sets once and expects to find that way tomorrow.
 *
 * Kept beside the recents for the same reason: one file, and the Host decides where
 * that lives. Nothing here belongs in the project — a collaborator opening the same
 * `.iconotype.json` should not inherit your theme.
 */
export interface UiPrefs {
  theme?: 'system' | 'light' | 'dark'
  showSets?: boolean
  showRail?: boolean
  cellSize?: number
}

const UI_FILE = 'ui.json'

export async function loadUiPrefs(host: Host): Promise<UiPrefs> {
  try {
    const parsed = JSON.parse(await host.fs.readText(UI_FILE)) as UiPrefs
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const saveUiPrefs = async (host: Host, prefs: UiPrefs): Promise<void> => {
  await host.fs.write(UI_FILE, JSON.stringify(prefs))
}
