<script lang="ts">
  import GlyphDetail from './GlyphDetail.svelte'
  import GlyphEditor from './GlyphEditor.svelte'
  import GlyphGrid from './GlyphGrid.svelte'
  import ExportPanel from './ExportPanel.svelte'
  import FixPanel from './FixPanel.svelte'
  import HistoryPanel from './HistoryPanel.svelte'
  import Notices from './Notices.svelte'
  import RecentsMenu from './RecentsMenu.svelte'
  import SetPanel from './SetPanel.svelte'
  import ShortcutsOverlay from './ShortcutsOverlay.svelte'
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
  } = $props()

  const app = useApp()
  const host = useHost()
  const session = $derived(app.session)

  /** What ⌘Z would undo, named — so it is never a surprise. */
  /** Only the open panes take a column, or a closed one leaves a gap behind. */
  const columns = $derived(
    embedded
      ? '1fr 200px'
      : [
          app.showSets && app.mode === 'browse' ? '200px' : null,
          'minmax(0, 1fr)',
          app.showRail ? '320px' : null,
        ].filter(Boolean).join(' '),
  )

  const undoLabel = $derived(session.canUndo ? `Undo ${session.timeline.at(-1)?.label ?? ''}` : 'Nothing to undo')
  const redoLabel = $derived(session.canRedo ? 'Redo' : 'Nothing to redo')

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
   * Loaded once, then written on every change — they are four booleans, and a person
   * who closed a panel yesterday expects it closed today.
   */
  let prefsLoaded = $state(false)
  onMount(async () => {
    const prefs = await loadUiPrefs(host)
    if (prefs.theme) app.theme = prefs.theme
    if (typeof prefs.showSets === 'boolean') app.showSets = prefs.showSets
    if (typeof prefs.showRail === 'boolean') app.showRail = prefs.showRail
    if (typeof prefs.cellSize === 'number') app.cellSize = prefs.cellSize
    prefsLoaded = true
  })

  $effect(() => {
    const prefs = { theme: app.theme, showSets: app.showSets, showRail: app.showRail, cellSize: app.cellSize }
    if (!prefsLoaded) return
    void saveUiPrefs(host, prefs)
  })

  const typing = (target: EventTarget | null) => {
    const tag = (target as HTMLElement | null)?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  function onKeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey

    if (mod) {
      // undo/redo are guarded: at the start of a document there is nothing to undo,
      // and firing anyway used to walk off the end of the timeline
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (session.canUndo) session.undo(); return }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); if (session.canRedo) session.redo(); return }
      if (e.key === 'a' && app.mode === 'browse') { e.preventDefault(); app.selectAll(); return }
      if (e.key === 'o') { e.preventDefault(); void app.pickAndImport(); return }
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
  <header>
    {#if !embedded}<span class="brand">Iconotype</span>{/if}
    <strong>{session.project.name}</strong>
    <span class="muted">{session.project.sets.length} set(s) · {session.glyphCount} glyph(s)</span>
    {#if app.busy}<span class="muted">importing…</span>
    {:else if app.saving}<span class="muted">saving…</span>{/if}
    <span class="spacer"></span>
    {#if !embedded}
      {#if app.mode === 'browse'}
        <button
          class="ghost icon"
          class:on={app.showSets}
          onclick={() => (app.showSets = !app.showSets)}
          title="Sets panel (⌘1)"
        >☰</button>
      {/if}
      <button
        class="ghost icon"
        class:on={app.showRail}
        onclick={() => (app.showRail = !app.showRail)}
        title={app.mode === 'edit' ? 'Fix panel (⌘2)' : 'Export panel (⌘2)'}
      >▤</button>
      <button
        class="ghost icon"
        onclick={() => (app.theme = app.theme === 'dark' ? 'light' : app.theme === 'light' ? 'system' : 'dark')}
        title={`Theme: ${app.theme} — click to change`}
      >{app.theme === 'dark' ? '🌙' : app.theme === 'light' ? '☀️' : '◐'}</button>
      <button class="ghost icon" onclick={() => (app.showShortcuts = !app.showShortcuts)} title="Keyboard shortcuts (?)">?</button>
    {/if}
    {#if onOpen}
      <button class="ghost" onclick={onOpen} title="Open a project file (⌘O)">Open…</button>
    {/if}
    {#if onPickRecent}<RecentsMenu onPick={onPickRecent} {home} />{/if}
    {#if onSave}
      <button class="ghost" onclick={onSave} title="Save to the project file (⌘S)">Save</button>
    {/if}
    {#if onSaveAs}
      <button class="ghost" onclick={onSaveAs} title="Save to a new file (⇧⌘S)">Save as…</button>
    {/if}
    <span class="muted host">{host.name}</span>
    <button class="ghost" disabled={!session.canUndo} onclick={() => session.undo()} title={undoLabel}>Undo</button>
    <button class="ghost" disabled={!session.canRedo} onclick={() => session.redo()} title={redoLabel}>Redo</button>
  </header>

  <!-- browsing has a toolbar; editing has the editor's own header and nothing else -->
  {#if !embedded && app.mode === 'browse'}<Toolbar />{/if}

  <main class:embedded style:grid-template-columns={columns}>
    {#if embedded}
      <!-- the sidebar already lists the icons, so the panel is the editor itself -->
      {#if app.editing}<GlyphEditor />{:else}<GlyphDetail />{/if}
      <HistoryPanel />
    {:else}
      {#if app.showSets && app.mode === 'browse'}<SetPanel />{/if}
      {#if app.editing}<GlyphEditor />{:else}<GlyphGrid />{/if}
      {#if app.showRail}
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

  {#if app.showShortcuts}
    <ShortcutsOverlay mode={app.mode} onClose={() => (app.showShortcuts = false)} />
  {/if}

  <Notices />
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100vh; }
  header {
    display: flex; align-items: center; gap: 10px;
    min-height: var(--gs-header); padding: 0 var(--gs-pad);
    background: var(--gs-surface); border-bottom: 1px solid var(--gs-border);
  }
  header strong { font-size: calc(var(--gs-size) + 1px); letter-spacing: -0.01em; }
  .spacer { flex: 1; }
  .muted { color: var(--gs-muted); font-size: var(--gs-size-sm); }
  .host { font-family: var(--gs-mono); }
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
  .icon { padding: 4px 8px; }
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
  @media (max-width: 720px) {
    main.embedded { grid-template-columns: 1fr !important; grid-template-rows: 1fr auto; overflow: auto; }
  }
</style>
