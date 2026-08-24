<script lang="ts">
  import {
    AppShell, AppStore, SessionStore, listProjects, loadProject, recordRecent,
    setApp, setHost, setSession, type RecentProject,
  } from '@iconotype/ui'
  import { createTauriHost } from '@iconotype/core-host/tauri'
  import { createHistory, emptyProject } from '@iconotype/core-model'
  import { isIconFontFile, parseIconFont, serializeIconFont, ICONFONT_EXTENSION } from '@iconotype/core-io/iconfont-file'
  import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { getCurrentWebview } from '@tauri-apps/api/webview'
  import { homeDir } from '@tauri-apps/api/path'
  import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'
  import { onMount } from 'svelte'

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
      await host.fs.write(target, serializeIconFont(session.project))
      file = target
      remember(target, session.project.name)
      app.notify('info', `Saved ${target}`)
      setTitle(session.project.name)
    } catch (e) {
      app.notify('error', `could not save: ${(e as Error).message}`)
    }
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
      const project = parseIconFont(await host.fs.readText(entry.path), entry.path)
      session.open(project, `Open ${entry.name}`)
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

<AppShell
  onOpen={openFile}
  onSave={() => saveFile(false)}
  onSaveAs={() => saveFile(true)}
  onPickRecent={openRecent}
  {home}
  {titleBarInset}
  {titleBarHeight}
/>
