<script lang="ts">
  import GlyphDetail from './GlyphDetail.svelte'
  import GlyphGrid from './GlyphGrid.svelte'
  import ExportPanel from './ExportPanel.svelte'
  import FixPanel from './FixPanel.svelte'
  import HistoryPanel from './HistoryPanel.svelte'
  import Notices from './Notices.svelte'
  import SetPanel from './SetPanel.svelte'
  import Toolbar from './Toolbar.svelte'
  import { useApp } from './app.svelte.js'
  import { useHost } from './session.svelte.js'

  /**
   * `embedded` is for a shell that already has its own icon grid, set list and export
   * controls — the VSCode extension's sidebar. Repeating them in the editor panel
   * squeezed the artwork into a fifth of the width and gave two places to do the same
   * thing, so the embedded layout drops them and shows the glyph itself instead.
   */
  let { embedded = false }: { embedded?: boolean } = $props()

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
    <strong>{session.project.name}</strong>
    <span class="muted">{session.project.sets.length} set(s) · {session.glyphCount} glyph(s)</span>
    {#if app.busy}<span class="muted">importing…</span>
    {:else if app.saving}<span class="muted">saving…</span>{/if}
    <span class="spacer"></span>
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
      <FixPanel />
      <ExportPanel />
      <HistoryPanel />
    {/if}
  </main>

  <Notices />
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--gs-border); }
  .spacer { flex: 1; }
  .muted { color: var(--gs-muted); font-size: 12px; }
  .host { font-family: var(--gs-mono); }
  main { flex: 1; display: grid; grid-template-columns: 170px 1fr 190px 190px 200px; min-height: 0; }
  main.embedded { grid-template-columns: 1fr 220px 200px; }
  @media (max-width: 720px) {
    main.embedded { grid-template-columns: 1fr; grid-template-rows: 1fr auto auto; overflow: auto; }
  }
</style>
