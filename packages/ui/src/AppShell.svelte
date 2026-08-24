<script lang="ts">
  import GlyphDetail from './GlyphDetail.svelte'
  import GlyphEditor from './GlyphEditor.svelte'
  import GlyphGrid from './GlyphGrid.svelte'
  import ExportPanel from './ExportPanel.svelte'
  import FixPanel from './FixPanel.svelte'
  import HistoryPanel from './HistoryPanel.svelte'
  import Icon from './Icon.svelte'
  import IconLibrary from './IconLibrary.svelte'
  import Notices from './Notices.svelte'
  import SetPanel from './SetPanel.svelte'
  import ShortcutsOverlay from './ShortcutsOverlay.svelte'
  import Splitter from './Splitter.svelte'
  import Toolbar from './Toolbar.svelte'
  import { loadUiPrefs, saveUiPrefs, type RecentProject } from './recents.js'
  import { onMount } from 'svelte'
  import { useApp } from './app.svelte.js'
  import { useHost } from './session.svelte.js'

  /**
   * `embedded` is for a shell that already has its own icon grid, set list and export
   * controls — the VSCode extension's sidebar. Repeating them in the editor panel
   * squeezed the artwork into a fifth of the width and gave two places to do the same
   * thing, so the embedded layout drops them and shows the glyph itself instead.
   */
  let {
    embedded = false,
    onOpen,
    onSave,
    onSaveAs,
    onPickRecent,
    home,
    titleBarInset = 0,
    titleBarHeight = 0,
  }: {
    embedded?: boolean
    /** desktop only: a real file on disk, opened and saved through native dialogs */
    onOpen?: () => void
    onSave?: () => void
    onSaveAs?: () => void
    /** reopen a project from the recents list; without it the menu is not shown */
    onPickRecent?: (entry: RecentProject) => void
    /** home directory, so recent paths can be shortened to `~/…` */
    home?: string
    /**
     * Space to leave at the left of the title bar for the window's own buttons.
     *
     * The desktop window is frameless, so the traffic lights float over whatever is
     * in that corner; the shell that knows the platform says how much room they need.
     */
    titleBarInset?: number
    /**
     * How tall that bar is, when the window's own buttons are sitting in it.
     *
     * The point of a custom title bar is that it IS the title bar — one band with the
     * window buttons and the app in it. At the shell's usual 52px the buttons sit near
     * the top of a bar whose text is centred, which reads as two rows stacked rather
     * than one, so the shell that owns the window says how tall the band actually is.
     */
    titleBarHeight?: number
  } = $props()

  const app = useApp()
  const host = useHost()
  const session = $derived(app.session)

  const showSets = $derived(!embedded && app.showSets && app.mode === 'browse')

  /**
   * Undo lives in the toolbar, which the embedded shell does not have — so there it
   * stays in the title bar. What ⌘Z would undo is named, so it is never a surprise.
   */
  const undoLabel = $derived(session.canUndo ? `Undo ${session.timeline.at(-1)?.label ?? ''}` : 'Nothing to undo')
  const redoLabel = $derived(session.canRedo ? 'Redo' : 'Nothing to redo')

  /**
   * Only the open panes take a column, or a closed one leaves a gap behind — and each
   * open pane brings its own splitter, so the handle never outlives the pane.
   */
  const columns = $derived(
    embedded
      ? '1fr 200px'
      : [
          showSets ? `${app.sidebarWidth}px` : null,
          showSets ? 'var(--gs-split)' : null,
          'minmax(0, 1fr)',
          app.showRail ? 'var(--gs-split)' : null,
          app.showRail ? `${app.railWidth}px` : null,
        ].filter(Boolean).join(' '),
  )

  /** An explicit choice beats the system one; 'system' removes the attribute. */
  $effect(() => {
    const root = document.documentElement
    if (app.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', app.theme)
  })

  // autosave: touch the document, schedule a debounced write through the Host
  $effect(() => {
    session.project
    app.scheduleSave()
  })

  /**
   * Chrome preferences, remembered.
   *
   * Loaded once, then written on every change — a person who closed a panel yesterday,
   * or dragged it narrower, expects to find it that way today.
   */
  let prefsLoaded = $state(false)
  onMount(async () => {
    const prefs = await loadUiPrefs(host)
    if (prefs.theme) app.theme = prefs.theme
    if (typeof prefs.showSets === 'boolean') app.showSets = prefs.showSets
    if (typeof prefs.showRail === 'boolean') app.showRail = prefs.showRail
    if (typeof prefs.cellSize === 'number') app.cellSize = prefs.cellSize
    if (typeof prefs.sidebarWidth === 'number') app.sidebarWidth = prefs.sidebarWidth
    if (typeof prefs.railWidth === 'number') app.railWidth = prefs.railWidth
    prefsLoaded = true
  })

  $effect(() => {
    const prefs = {
      theme: app.theme, showSets: app.showSets, showRail: app.showRail, cellSize: app.cellSize,
      sidebarWidth: app.sidebarWidth, railWidth: app.railWidth,
    }
    if (!prefsLoaded) return
    void saveUiPrefs(host, prefs)
  })

  const typing = (target: EventTarget | null) => {
    const tag = (target as HTMLElement | null)?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  const themeIcon = $derived(
    app.theme === 'dark' ? 'theme-dark' as const
    : app.theme === 'light' ? 'theme-light' as const
    : 'theme-auto' as const,
  )

  function onKeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey

    if (mod) {
      // undo/redo are guarded: at the start of a document there is nothing to undo,
      // and firing anyway used to walk off the end of the timeline
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (session.canUndo) session.undo(); return }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); if (session.canRedo) session.redo(); return }
      if (e.key === 'a' && app.mode === 'browse') { e.preventDefault(); app.selectAll(); return }
      if (e.key === 'o') { e.preventDefault(); void app.pickAndImport(); return }
      if (e.key === 'k') { e.preventDefault(); app.showLibrary = !app.showLibrary; return }
      if (e.key === '1') { e.preventDefault(); app.showSets = !app.showSets; return }
      if (e.key === '2') { e.preventDefault(); app.showRail = !app.showRail; return }
      return
    }

    if (typing(e.target)) return

    if (e.key === '?') { e.preventDefault(); app.showShortcuts = !app.showShortcuts; return }
    if (e.key === 'Escape' && app.showShortcuts) { app.showShortcuts = false; return }

    if (app.mode !== 'browse') return

    if (e.key === '/') {
      e.preventDefault()
      ;(document.querySelector('input[type=search]') as HTMLInputElement | null)?.focus()
      return
    }
    /**
     * Arrows walk the grid.
     *
     * The editor uses the same keys to nudge geometry, which is why this only runs in
     * browse mode; ↑/↓ move by whatever the grid is currently laying out per row, so
     * they follow the icons rather than a guess about the window's width.
     */
    if (e.key === 'ArrowLeft') { e.preventDefault(); app.moveCursor(-1); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); app.moveCursor(1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); app.moveCursor(-app.gridColumns); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); app.moveCursor(app.gridColumns); return }
    if (e.key === 'Home') { e.preventDefault(); app.moveCursor(-Infinity); return }
    if (e.key === 'End') { e.preventDefault(); app.moveCursor(Infinity); return }
    if (e.key === 'Enter' || e.key === 'e') {
      const [first] = app.selection
      if (first) { e.preventDefault(); app.edit(first) }
      return
    }
    if (e.key === ' ') {
      const glyphs = app.selectedGlyphs
      if (glyphs.length) {
        e.preventDefault()
        // one space flips the whole selection to whatever the first one is not
        app.setIncluded(glyphs.map((g) => g.id), glyphs[0]!.selected === false)
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell">
  <!--
    The title bar: who you are and what you have open, and nothing you click by
    accident. The window's own layout switches sit at its right, where every editor
    with a custom title bar puts them.
  -->
  <header
    data-tauri-drag-region
    class:native={titleBarHeight}
    style:padding-left="{titleBarInset + 12}px"
    style:min-height={titleBarHeight ? `${titleBarHeight}px` : null}
  >
    <!--
      Every non-interactive piece carries the drag attribute: the frameless desktop
      window is moved by whatever is under the pointer, and a bare <strong> with the
      project's name in it is otherwise a dead spot in the title bar.
    -->
    {#if !embedded}<span class="brand" data-tauri-drag-region>Iconotype</span>{/if}
    <strong data-tauri-drag-region>{session.project.name}</strong>
    <span class="muted" data-tauri-drag-region>
      {session.project.sets.length} set(s) · {session.glyphCount} glyph(s)
    </span>
    {#if app.busy}<span class="muted" data-tauri-drag-region>importing…</span>
    {:else if app.saving}<span class="muted" data-tauri-drag-region>saving…</span>{/if}
    <span class="spacer" data-tauri-drag-region></span>
    {#if embedded}
      <button class="ghost icon" disabled={!session.canUndo} onclick={() => session.undo()} title={undoLabel} aria-label={undoLabel}>
        <Icon name="undo" />
      </button>
      <button class="ghost icon" disabled={!session.canRedo} onclick={() => session.redo()} title={redoLabel} aria-label={redoLabel}>
        <Icon name="redo" />
      </button>
    {/if}
    {#if !embedded}
      {#if app.mode === 'browse'}
        <button
          class="ghost icon"
          class:on={app.showSets}
          onclick={() => (app.showSets = !app.showSets)}
          title="{app.showSets ? 'Hide' : 'Show'} the sets panel (⌘1)"
          aria-label="{app.showSets ? 'Hide' : 'Show'} the sets panel"
          aria-pressed={app.showSets}
        ><Icon name={app.showSets ? 'sidebar-left' : 'sidebar-left-off'} /></button>
      {/if}
      <button
        class="ghost icon"
        class:on={app.showRail}
        onclick={() => (app.showRail = !app.showRail)}
        title="{app.showRail ? 'Hide' : 'Show'} the {app.mode === 'edit' ? 'fix' : 'export'} panel (⌘2)"
        aria-label="{app.showRail ? 'Hide' : 'Show'} the side panel"
        aria-pressed={app.showRail}
      ><Icon name={app.showRail ? 'sidebar-right' : 'sidebar-right-off'} /></button>
      <button
        class="ghost icon"
        onclick={() => (app.theme = app.theme === 'dark' ? 'light' : app.theme === 'light' ? 'system' : 'dark')}
        title={`Theme: ${app.theme} — click to change`}
        aria-label={`Theme: ${app.theme}`}
      ><Icon name={themeIcon} /></button>
      <button
        class="ghost icon"
        onclick={() => (app.showShortcuts = !app.showShortcuts)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
      ><Icon name="keyboard" /></button>
    {/if}
  </header>

  {#if !embedded}<Toolbar {onOpen} {onSave} {onSaveAs} {onPickRecent} {home} />{/if}

  <main class:embedded style:grid-template-columns={columns}>
    {#if embedded}
      <!-- the sidebar already lists the icons, so the panel is the editor itself -->
      {#if app.editing}<GlyphEditor />{:else}<GlyphDetail />{/if}
      <HistoryPanel />
    {:else}
      {#if showSets}
        <SetPanel />
        <Splitter bind:value={app.sidebarWidth} side="left" label="Sets panel" initial={220} min={160} max={420} />
      {/if}
      {#if app.editing}<GlyphEditor />{:else}<GlyphGrid />{/if}
      {#if app.showRail}
        <Splitter bind:value={app.railWidth} side="right" label="Side panel" initial={320} min={240} max={560} />
        <!--
          One rail, and only what belongs to the current mode. Mixing the export
          settings with a glyph's findings meant half the panel was answering a
          question you were not asking.
        -->
        <div class="rail">
          {#if app.mode === 'edit'}
            <FixPanel />
          {:else}
            <ExportPanel />
          {/if}
          <HistoryPanel />
        </div>
      {/if}
    {/if}
  </main>

  {#if app.showLibrary}
    <IconLibrary onClose={() => (app.showLibrary = false)} />
  {/if}

  {#if app.showShortcuts}
    <ShortcutsOverlay mode={app.mode} onClose={() => (app.showShortcuts = false)} />
  {/if}

  <Notices />
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100vh; --gs-split: 9px; }
  header {
    display: flex; align-items: center; gap: 10px;
    min-height: var(--gs-header); padding: 0 var(--gs-pad);
    background: var(--gs-surface); border-bottom: 1px solid var(--gs-border);
  }
  header strong { font-size: calc(var(--gs-size) + 1px); letter-spacing: -0.01em; }
  /* sharing the band with the window buttons: shorter, tighter, smaller targets */
  header.native { gap: 8px; }
  header.native .brand { padding-right: 8px; }
  header.native .icon { padding: 3px; }
  .spacer { flex: 1; }
  .muted { color: var(--gs-muted); font-size: var(--gs-size-sm); }
  main { flex: 1; display: grid; min-height: 0; gap: var(--gs-gap); padding: var(--gs-gap); }
  .rail { display: flex; flex-direction: column; gap: var(--gs-gap); min-height: 0; overflow: auto;
          background: transparent !important; box-shadow: none !important; }
  /* the rail scrolls; a card inside it is as tall as its content, never clipped */
  .rail > :global(*) {
    background: var(--gs-surface); border-radius: var(--gs-radius-lg); box-shadow: var(--gs-shadow);
    flex: 0 0 auto; overflow: visible;
  }
  .brand {
    font-weight: 650; letter-spacing: -0.02em; padding-right: 10px; margin-right: 2px;
    border-right: 1px solid var(--gs-border); color: var(--gs-accent);
  }
  .icon { display: grid; place-items: center; padding: 5px; }
  .icon.on { border-color: var(--gs-accent); color: var(--gs-accent); }
  /*
   * Each pane is a surface. With --gs-gap: 0 and a hairline divider that reads as one
   * flat split, which is what an editor panel should look like; with air between them
   * and a shadow it reads as cards, which is what an app should look like. Same markup.
   */
  main > :global(*) {
    background: var(--gs-surface);
    border-radius: var(--gs-radius-lg);
    box-shadow: var(--gs-shadow);
    min-height: 0;
  }
  /* the drag handles are not panes: no surface, no shadow, no rounding */
  main > :global(.splitter) { background: transparent; box-shadow: none; border-radius: 0; }
  @media (max-width: 720px) {
    main.embedded { grid-template-columns: 1fr !important; grid-template-rows: 1fr auto; overflow: auto; }
  }
</style>
