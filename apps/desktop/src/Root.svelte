<script lang="ts">
  import {
    AppShell, AppStore, SessionStore, listProjects, loadProject, recordRecent,
    setApp, setHost, setSession, type RecentProject,
  } from '@iconotype/ui'
  import { createTauriHost } from '@iconotype/core-host/tauri'
  import { createHistory, emptyProject } from '@iconotype/core-model'
  import { isIconFontFile, parseIconFont, serializeIconFont, ICONFONT_EXTENSION } from '@iconotype/core-io/iconfont-file'
  import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
  import { openPath } from '@tauri-apps/plugin-opener'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { getCurrentWebview } from '@tauri-apps/api/webview'
  import { homeDir } from '@tauri-apps/api/path'
  import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'
  import { onMount } from 'svelte'
  import UpdateBanner from './UpdateBanner.svelte'

  /**
   * The desktop shell.
   *
   * Same UI as the web build; the difference is a real filesystem underneath. A
   * project opened from disk keeps its path, so ⌘S writes back to the file the user
   * chose rather than to a private store they cannot find.
   */
  const now = () => Date.now()
  const host = createTauriHost()
  const session = new SessionStore(
    { project: emptyProject('p0', 'Untitled project', now()), history: createHistory() }, now)
  const app = new AppStore(session, host, now)

  setHost(host)
  setSession(session)
  setApp(app)

  /**
   * How much of the title bar belongs to the window, not to us.
   *
   * The window is frameless (`titleBarStyle: Transparent`), so on macOS the traffic
   * lights are painted over the top-left corner of the page and anything we put there
   * lands underneath them.
   */
  const macos = navigator.userAgent.includes('Macintosh')
  const titleBarInset = macos ? 74 : 0
  /** the height of the macOS title bar the buttons are drawn in, so we share the band */
  const titleBarHeight = macos ? 38 : 0

  /** The `.iconotype.json` this window is editing, when it came from disk. */
  let file = $state<string | null>(null)
  let home = $state<string | undefined>(undefined)
  /**
   * The document as of the last read or write, in OUR serialization.
   *
   * Two questions need it. "Did that change come from us?" — a save fires the watcher
   * too, and reloading after every ⌘S would throw away the undo history for nothing.
   * And "would reloading lose work?" — if the window no longer serializes to this,
   * there are unsaved edits, and a file on disk does not get to overwrite them
   * silently. Both comparisons are made on the serialized form rather than on the
   * file's bytes, so someone reformatting the JSON by hand does not read as an edit.
   */
  let synced = $state<string | null>(null)

  /** Remembers a file so it can be reopened from the Recent menu. */
  const remember = (path: string, name: string) =>
    void recordRecent(host, { path, name, openedAt: now() })

  const setTitle = (name: string, dirty = false) =>
    void getCurrentWindow().setTitle(`${dirty ? '• ' : ''}${name} — Iconotype`)

  async function openFile() {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: 'Icon font project', extensions: ['json', 'zip'] }],
    })
    if (typeof picked !== 'string') return
    try {
      const text = await host.fs.readText(picked)
      const data = JSON.parse(text) as unknown
      if (isIconFontFile(data)) {
        const project = parseIconFont(text, picked)
        session.open(project, `Open ${picked.split('/').pop()}`)
        synced = serializeIconFont(project)
        // only OUR file becomes the save target: ⌘S must never overwrite the IcoMoon
        // project someone imported from
        file = picked
        remember(picked, project.name)
        setTitle(project.name)
        return
      }
      await app.importFiles([{ name: picked.split('/').pop() ?? picked, data: await host.fs.read(picked) }])
      file = null
    } catch (e) {
      app.notify('error', `${picked}: ${(e as Error).message}`)
    }
  }

  async function saveFile(as = false) {
    let target = file
    if (as || !target) {
      const chosen = await saveDialog({
        defaultPath: `${session.project.preferences.font.family || session.project.name}${ICONFONT_EXTENSION}`,
        filters: [{ name: 'Icon font project', extensions: ['json'] }],
      })
      if (!chosen) return
      target = chosen
    }
    try {
      const text = serializeIconFont(session.project)
      await host.fs.write(target, text)
      synced = text
      file = target
      remember(target, session.project.name)
      app.notify('info', `Saved ${target}`)
      setTitle(session.project.name)
    } catch (e) {
      app.notify('error', `could not save: ${(e as Error).message}`)
    }
  }

  /** Hand the project file to whatever the system opens JSON with. */
  async function revealFile() {
    if (!file) return
    try {
      await openPath(file)
    } catch (e) {
      app.notify('error', `could not open ${file}: ${(e as Error).message}`)
    }
  }

  /**
   * The file, edited elsewhere.
   *
   * Someone will change an output path in the JSON by hand, or a `git checkout` will
   * move it under the app. Watching it makes the window agree with the disk instead of
   * quietly holding a stale copy — and a reload is a new timeline, exactly like an
   * open, because the undo stack of the old document does not describe the new one.
   */
  $effect(() => {
    const path = file
    if (!path || !host.fs.watch) return
    let timer: ReturnType<typeof setTimeout> | undefined

    const watcher = host.fs.watch(path, () => {
      // editors write in two or three bursts; act once the dust settles
      clearTimeout(timer)
      timer = setTimeout(() => void reload(path), 150)
    })

    return () => { clearTimeout(timer); watcher.dispose() }
  })

  async function reload(path: string) {
    const name = path.split('/').pop() ?? path
    let project: ReturnType<typeof parseIconFont>
    try {
      project = parseIconFont(await host.fs.readText(path), path)
    } catch (e) {
      // gone, half-written, or saved by rename — a later event brings the finished file
      app.notify('warn', `${name} changed on disk but could not be read: ${(e as Error).message}`)
      return
    }
    const incoming = serializeIconFont(project)
    if (incoming === synced) return                                   // our own write coming back
    if (serializeIconFont(session.project) !== synced) {
      app.notify('warn', `${name} changed on disk — not reloaded, this window has unsaved edits`)
      return
    }
    session.open(project, `Reload ${name}`)
    synced = incoming
    setTitle(project.name)
    app.notify('info', `Reloaded ${name} from disk`)
  }

  function onKeydown(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey)) return
    if (e.key === 'o') { e.preventDefault(); void openFile() }
    else if (e.key === 's') { e.preventDefault(); void saveFile(e.shiftKey) }
  }

  // reopen whatever was last worked on, exactly like the web build does from OPFS
  $effect(() => {
    void (async () => {
      const [recent] = await listProjects(host)
      if (!recent) return
      try {
        session.open(await loadProject(host, recent.id), `Reopen ${recent.name}`)
      } catch (e) {
        app.notify('warn', `could not reopen "${recent.name}": ${(e as Error).message}`)
      }
    })()
  })

  $effect(() => { setTitle(session.project.name) })

  /**
   * Dropping files from Finder.
   *
   * With `dragDropEnabled` the webview's own HTML5 drop events never fire — Tauri
   * intercepts them and emits paths instead, which is the better deal: a path can be
   * read straight off disk, where a browser only ever hands over an opaque File.
   * `GlyphGrid`'s drop handler still works in the web build; this is the desktop's.
   */
  onMount(() => { void homeDir().then((h) => { home = h.replace(/\/+$/, '') }) })

  /** Reopens a file from the Recent menu, dropping entries that have gone away. */
  async function openRecent(entry: RecentProject) {
    if (!entry.path) return
    try {
      const text = await host.fs.readText(entry.path)
      const project = parseIconFont(text, entry.path)
      session.open(project, `Open ${entry.name}`)
      synced = serializeIconFont(project)
      file = entry.path
      remember(entry.path, project.name)
      setTitle(project.name)
    } catch (e) {
      app.notify('error', `${entry.path}: ${(e as Error).message}`)
    }
  }

  onMount(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== 'drop') return
      const files = await Promise.all(event.payload.paths.map(async (path) => ({
        name: path.split('/').pop() ?? path,
        data: await host.fs.read(path),
      })))
      if (files.length) await app.importFiles(files)
    })
    return () => { void unlisten.then((off) => off()) }
  })

  /**
   * A real menu bar.
   *
   * Built in JS rather than Rust so the actions stay next to the state they act on;
   * the Rust side has no idea what a project is and should not have to.
   */
  onMount(() => {
    void (async () => {
      const item = async (id: string, text: string, accelerator: string, action: () => void) =>
        await MenuItem.new({ id, text, accelerator, action })

      const file = await Submenu.new({
        text: 'File',
        items: [
          await item('open', 'Open…', 'CmdOrCtrl+O', () => void openFile()),
          await item('save', 'Save', 'CmdOrCtrl+S', () => void saveFile(false)),
          await item('saveAs', 'Save As…', 'CmdOrCtrl+Shift+S', () => void saveFile(true)),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await item('export', 'Download Package…', 'CmdOrCtrl+E', () => void app.downloadBundle()),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await PredefinedMenuItem.new({ item: 'CloseWindow', text: 'Close Window' }),
        ],
      })

      const edit = await Submenu.new({
        text: 'Edit',
        items: [
          await item('undo', 'Undo', 'CmdOrCtrl+Z', () => session.undo()),
          await item('redo', 'Redo', 'CmdOrCtrl+Shift+Z', () => session.redo()),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await PredefinedMenuItem.new({ item: 'Cut' }),
          await PredefinedMenuItem.new({ item: 'Copy' }),
          await PredefinedMenuItem.new({ item: 'Paste' }),
          await PredefinedMenuItem.new({ item: 'SelectAll' }),
        ],
      })

      const app_ = await Submenu.new({
        text: 'Iconotype',
        items: [
          await PredefinedMenuItem.new({
            item: { About: { name: 'Iconotype', version: '0.1.0', comments: 'Build and manage icon fonts.' } },
            text: 'About Iconotype',
          }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await PredefinedMenuItem.new({ item: 'Hide' }),
          await PredefinedMenuItem.new({ item: 'HideOthers' }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await PredefinedMenuItem.new({ item: 'Quit' }),
        ],
      })

      await (await Menu.new({ items: [app_, file, edit] })).setAsAppMenu()
    })()
  })
</script>

<svelte:window onkeydown={onKeydown} />

<!--
  The banner sits ABOVE the shell rather than over it: the shell is a full-height flex
  child here, so it gives up the few pixels instead of the window growing a scrollbar
  and losing its bottom edge.
-->
<div class="window">
  <UpdateBanner onError={(message) => app.notify('error', message)} />

  <AppShell
    onOpen={openFile}
    onSave={() => saveFile(false)}
    onSaveAs={() => saveFile(true)}
    onRevealFile={file ? revealFile : undefined}
    onPickRecent={openRecent}
    {home}
    {titleBarInset}
    {titleBarHeight}
  />
</div>

<style>
  .window { display: flex; flex-direction: column; height: 100vh; }
  /* the shell declares 100vh of its own; as a flex child it shrinks to what is left */
  .window > :global(.shell) { flex: 1 1 auto; min-height: 0; }
</style>
