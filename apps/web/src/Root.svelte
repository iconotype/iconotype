<script lang="ts">
  import {
    AppShell, AppStore, SessionStore, listProjects, loadProject, recordRecent,
    setApp, setHost, setSession, type RecentProject,
  } from '@iconotype/ui'
  import { createWebHost } from '@iconotype/core-host/web'
  import { createHistory, emptyProject } from '@iconotype/core-model'

  // The shell owns the clock; core stays deterministic.
  const now = () => Date.now()
  const host = createWebHost(import.meta.env.BASE_URL)
  const session = new SessionStore({ project: emptyProject('p0', 'Untitled project', now()), history: createHistory() }, now)
  const app = new AppStore(session, host, now)

  setHost(host)
  setSession(session)
  setApp(app)

  /** Reopens a project from browser storage, by the id the recents list carries. */
  async function openRecent(entry: RecentProject) {
    if (!entry.id) return
    try {
      const project = await loadProject(host, entry.id)
      session.replace(project, `Open ${entry.name}`)
      await recordRecent(host, { id: entry.id, name: project.name, openedAt: now() })
    } catch (e) {
      app.notify('error', `could not open "${entry.name}": ${(e as Error).message}`)
    }
  }

  // reopen the most recent project from OPFS
  $effect(() => {
    void (async () => {
      const [recent] = await listProjects(host)
      if (!recent) return
      try {
        session.replace(await loadProject(host, recent.id), `Reopen ${recent.name}`)
      } catch (e) {
        app.notify('warn', `could not reopen "${recent.name}": ${(e as Error).message}`)
      }
    })()
  })

  /**
   * Every project the browser has kept is a recent one.
   *
   * There are no paths here — OPFS is a private store — so the id is the identity and
   * the menu says "browser storage" where the desktop shows a folder.
   */
  $effect(() => {
    const { id, name } = session.project
    void recordRecent(host, { id, name, openedAt: now() })
  })
</script>

<AppShell onPickRecent={openRecent} />
