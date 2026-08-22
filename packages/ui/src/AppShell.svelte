<script lang="ts">
  import GlyphDetail from './GlyphDetail.svelte'
  import GlyphGrid from './GlyphGrid.svelte'
  import ExportPanel from './ExportPanel.svelte'
  import FixPanel from './FixPanel.svelte'
  import HistoryPanel from './HistoryPanel.svelte'
  import Notices from './Notices.svelte'
  import RecentsMenu from './RecentsMenu.svelte'
  import SetPanel from './SetPanel.svelte'
  import Toolbar from './Toolbar.svelte'
  import type { RecentProject } from './recents.js'
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

  // autosave: touch the document, schedule a debounced write through the Host
  $effect(() => {
    session.project
    app.scheduleSave()
  })

  function onKeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); session.undo() }
    else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); session.redo() }
    else if (e.key === 'a') { e.preventDefault(); app.selectAll() }
    else if (e.key === 'o') { e.preventDefault(); app.pickAndImport() }
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
    <button class="ghost" disabled={!session.canUndo} onclick={() => session.undo()}>Undo</button>
    <button class="ghost" disabled={!session.canRedo} onclick={() => session.redo()}>Redo</button>
  </header>

  {#if !embedded}<Toolbar />{/if}

  <main class:embedded>
    {#if embedded}
      <GlyphDetail />
      <FixPanel />
      <HistoryPanel />
    {:else}
      <SetPanel />
      <GlyphGrid />
      <!--
        One rail, not three columns. Five equal-weight panes fought for width and left
        the artwork — the thing you came to look at — squeezed between two lists of
        controls. The panels stack and scroll together instead.
      -->
      <div class="rail">
        <FixPanel />
        <ExportPanel />
        <HistoryPanel />
      </div>
    {/if}
  </main>

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
  main { flex: 1; display: grid; grid-template-columns: 200px minmax(0, 1fr) 300px; min-height: 0;
         gap: var(--gs-gap); padding: var(--gs-gap); }
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
  @media (max-width: 1100px) { main { grid-template-columns: 170px minmax(0, 1fr) 260px; } }
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
  main.embedded { grid-template-columns: 1fr 220px 200px; }
  @media (max-width: 720px) {
    main.embedded { grid-template-columns: 1fr; grid-template-rows: 1fr auto auto; overflow: auto; }
  }
</style>
