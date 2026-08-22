<script lang="ts">
  import {
    AppShell, AppStore, SessionStore, listProjects, loadProject, recordRecent,
    setApp, setHost, setSession, type RecentProject,
  } from '@iconotype/ui'
  import { createWebHost } from '@iconotype/core-host/web'
  import { createHistory, emptyProject } from '@iconotype/core-model'
  import { isIconFontFile, parseIconFont, serializeIconFont, ICONFONT_EXTENSION } from '@iconotype/core-io/iconfont-file'

  /**
   * The browser shell: the same app as the desktop one, with the browser's own
   * storage under it.
   *
   * Projects live in OPFS and are reopened from there, so closing the tab loses
   * nothing. Where the browser supports it, `Open…` and `Save` are real files through
   * the File System Access API — and where it does not (Firefox, Safari), the same
   * buttons fall back to an upload and a download, which is what those browsers give.
   */
  const now = () => Date.now()
  const host = createWebHost(import.meta.env.BASE_URL)
  const session = new SessionStore(
    { project: emptyProject('p0', 'Untitled project', now()), history: createHistory() }, now)
  const app = new AppStore(session, host, now)

  setHost(host)
  setSession(session)
  setApp(app)

  interface FilePickerWindow {
    showOpenFilePicker?: (opts?: unknown) => Promise<Array<FileSystemFileHandle>>
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>
  }
  const picker = window as unknown as FilePickerWindow
  const canPickFiles = Boolean(picker.showOpenFilePicker)

  /** The handle of the file this tab is editing, when one was opened or saved. */
  let handle: FileSystemFileHandle | null = null

  const projectTypes = [{
    description: 'Icon font project',
    accept: { 'application/json': ['.json'] as string[] },
  }]

  async function openFile() {
    if (!canPickFiles) { await app.pickAndImport(); return }
    try {
      const [picked] = await picker.showOpenFilePicker!({ types: projectTypes, multiple: false })
      if (!picked) return
      const file = await picked.getFile()
      const text = await file.text()
      const data = JSON.parse(text) as unknown

      if (isIconFontFile(data)) {
        session.open(parseIconFont(text, file.name), `Open ${file.name}`)
        // only our own file becomes the save target, exactly as on the desktop
        handle = picked
      } else {
        await app.importFiles([{ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }])
        handle = null
      }
      await recordRecent(host, { id: session.project.id, name: session.project.name, openedAt: now() })
    } catch (e) {
      // an abandoned picker throws AbortError; that is a person changing their mind
      if ((e as Error).name !== 'AbortError') app.notify('error', (e as Error).message)
    }
  }

  async function saveFile(as = false) {
    const name = `${session.project.preferences.font.family || session.project.name}${ICONFONT_EXTENSION}`
    const text = serializeIconFont(session.project)

    if (!canPickFiles) { await host.saveAs(name, text); return }
    try {
      const target = as || !handle
        ? await picker.showSaveFilePicker!({ suggestedName: name, types: projectTypes })
        : handle
      if (!target) return
      const writable = await (target as FileSystemFileHandle & {
        createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
      }).createWritable()
      await writable.write(text)
      await writable.close()
      handle = target
      app.notify('info', `Saved ${target.name}`)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') app.notify('error', `could not save: ${(e as Error).message}`)
    }
  }

  /** Reopens a project from browser storage, by the id the recents list carries. */
  async function openRecent(entry: RecentProject) {
    if (!entry.id) return
    try {
      const project = await loadProject(host, entry.id)
      session.open(project, `Open ${entry.name}`)
      handle = null
      await recordRecent(host, { id: entry.id, name: project.name, openedAt: now() })
    } catch (e) {
      app.notify('error', `could not open "${entry.name}": ${(e as Error).message}`)
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.key === 's') { event.preventDefault(); void saveFile(event.shiftKey) }
  }

  /**
   * Deep links: `?sample` opens the bundled set, `#icon-name` opens the editor on one.
   *
   * A link that lands someone on the actual icon is worth having on its own — it is
   * what you paste into a review — and it is also what makes a screenshot of this app
   * reproducible without a human driving it.
   */
  async function applyDeepLink() {
    const params = new URLSearchParams(location.search)
    if (params.has('sample') && !session.glyphCount) {
      const url = host.sampleProjectUrl?.()
      if (url) await app.importUrl(url)
    }
    const wanted = decodeURIComponent(location.hash.replace(/^#/, ''))
    if (!wanted) return
    const glyph = session.project.sets.flatMap((s) => s.glyphs).find((g) => g.name === wanted)
    if (glyph) app.edit(glyph.id)
  }

  // reopen the most recent project from OPFS, unless a link says otherwise
  $effect(() => {
    void (async () => {
      if (new URLSearchParams(location.search).has('sample')) { await applyDeepLink(); return }
      const [recent] = await listProjects(host)
      if (!recent) { await applyDeepLink(); return }
      try {
        session.open(await loadProject(host, recent.id), `Reopen ${recent.name}`)
      } catch (e) {
        app.notify('warn', `could not reopen "${recent.name}": ${(e as Error).message}`)
      }
      await applyDeepLink()
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

<svelte:window onkeydown={onKeydown} />

<AppShell
  onOpen={openFile}
  onSave={() => saveFile(false)}
  onSaveAs={canPickFiles ? () => saveFile(true) : undefined}
  onPickRecent={openRecent}
/>
