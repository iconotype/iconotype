<script lang="ts">
  import { onMount } from 'svelte'
  import { AppShell, AppStore, SessionStore, setApp, setHost, setSession } from '@iconotype/ui'
  import { createHistory, emptyProject, type Project } from '@iconotype/core-model'
  import { createWebviewHost, vscodeApi } from './host.js'

  const now = () => Date.now()
  const host = createWebviewHost()
  const session = new SessionStore(
    { project: emptyProject('p0', 'Loading…', now()), history: createHistory() },
    now,
  )
  const app = new AppStore(session, host, now)
  // the extension owns the .iconotype.json; the Host project store is not ours to write
  app.autosave = false

  setHost(host)
  setSession(session)
  setApp(app)

  /**
   * The last project we either received from the extension or sent to it.
   *
   * Both directions are guarded against it: the extension's file watcher fires after
   * our own save, and re-applying that would clobber the editor's history — or worse,
   * ping-pong between the two.
   */
  let synced = ''

  /**
   * The extension's per-panel token, sent with the project and echoed on every save.
   *
   * Until it arrives this editor holds a placeholder project, and saving that would
   * overwrite the real file with an empty font — which is exactly what it used to do:
   * the `$effect` below runs on mount, long before the project message lands. The
   * token also means the extension can reject a save that was never handed a project,
   * rather than trusting whatever the webview posts.
   */
  let token: string | null = null

  const save = (project: Project) => {
    if (!token) return // no project received yet — there is nothing of ours to save
    const snapshot = JSON.stringify(project)
    if (snapshot === synced) return
    synced = snapshot
    vscodeApi()?.postMessage({ type: 'save', token, project: $state.snapshot(project) })
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as
      {
        type?: string; project?: Project; name?: string; token?: string
        focus?: string; library?: boolean; libraryQuery?: string
      }
    if (message?.type !== 'project' || !message.project) return
    if (message.token) token = message.token
    const snapshot = JSON.stringify(message.project)
    if (snapshot !== synced) { // otherwise it is our own save coming back through the watcher
      synced = snapshot
      session.replace(message.project, `Open ${message.name ?? message.project.name}`)
    }
    // alt-clicking an icon in the sidebar opens the editor ON that icon
    if (message.focus) {
      const glyph = session.project.sets.flatMap((s) => s.glyphs).find((g) => g.id === message.focus)
      // alt-clicking an icon in the sidebar opens the editor ON it, not beside it
      if (glyph) app.edit(glyph.id)
    }
    // "Iconotype: Find Icons" opens the editor with the library already up, and the
    // missing-icon fix arrives with the name it needs already searched for
    if (message.library) {
      app.libraryQuery = message.libraryQuery ?? ''
      app.showLibrary = true
    }
  })

  // ask for the project once we are alive; the extension answers with `project`
  onMount(() => {
    vscodeApi()?.postMessage({
      type: 'ready',
      assetBase: host.assetBase(),
      themeKind: document.body.dataset.vscodeThemeKind ?? null,
      // proves the strict style-src actually applied our stylesheet
      styled: getComputedStyle(document.body).backgroundColor,
      // proves the embedded layout applied: the sidebar already has the grid, the set
      // list and the export controls, so the panel must not render them again
      panels: [...(document.querySelector('main')?.children ?? [])].length,
      embedded: document.querySelector('main')?.classList.contains('embedded') ?? false,
    })
  })

  /**
   * Test seam: makes a real edit through the session, so the integration test drives
   * the same path a user does — op → history → $effect → save → extension → file.
   */
  window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { type?: string; name?: string }
    if (m?.type !== 'test:edit' || !m.name) return
    // the file's `name` is written from the font family, so change that
    session.do({ t: 'prefs.patch', patch: { font: { family: m.name } } })
    session.do({ t: 'project.rename', name: m.name })
  })

  /**
   * Test seam: lets the integration test exercise the REAL Host path
   * (webview Host → postMessage RPC → extension workspace.fs → back).
   */
  window.addEventListener('message', async (e: MessageEvent) => {
    const m = e.data as { type?: string; method?: string; args?: unknown[] }
    if (m?.type !== 'test:hostCall') return
    try {
      const fn = (host.fs as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[m.method!]
      vscodeApi()?.postMessage({ type: 'test:hostResult', result: await fn.apply(host.fs, m.args ?? []) })
    } catch (err) {
      vscodeApi()?.postMessage({ type: 'test:hostResult', error: (err as Error).message })
    }
  })

  /**
   * Test seam: posts a save exactly as the editor does, with a token of the test's
   * choosing — the only way to exercise the extension's rejection of a save that was
   * never handed this project.
   */
  window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { type?: string; token?: string; project?: Project }
    if (m?.type !== 'test:rawSave') return
    vscodeApi()?.postMessage({ type: 'save', token: m.token, project: m.project })
  })

  /**
   * Test seam: runs the same code path as "Check all glyphs", whose first act is to
   * dynamically import core-svg. A webview CSP that only trusts a nonce blocks that
   * import — the script it pulls in cannot carry one — and the failure surfaces as
   * "Failed to fetch dynamically imported module".
   */
  window.addEventListener('message', async (e: MessageEvent) => {
    if ((e.data as { type?: string })?.type !== 'test:dynamicImport') return
    try {
      await app.lintAll()
      vscodeApi()?.postMessage({ type: 'test:dynamicImportResult', ok: true })
    } catch (err) {
      vscodeApi()?.postMessage({ type: 'test:dynamicImportResult', ok: false, error: (err as Error).message })
    }
  })

  // every edit in the editor is written back to the .iconotype.json
  $effect(() => {
    save(session.project)
  })
</script>

<AppShell embedded />
