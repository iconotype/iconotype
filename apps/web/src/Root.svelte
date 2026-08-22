<script lang="ts">
  import { AppShell, AppStore, SessionStore, listProjects, loadProject, setApp, setHost, setSession } from '@iconotype/ui'
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
</script>

<AppShell />
