<script lang="ts">
  import GlyphCell from './GlyphCell.svelte'
  import VirtualGrid from './VirtualGrid.svelte'
  import { useApp } from './app.svelte.js'
  import { useHost } from './session.svelte.js'

  const app = useApp()
  const host = useHost()

  let dragging = $state(false)

  const sections = $derived(
    app.filteredSets
      .filter(({ glyphs }) => glyphs.length || !app.search)
      .map(({ set, glyphs }) => ({ key: set.id, title: set.name, items: glyphs, set })),
  )
  const heightOf = (key: string) => app.session.project.sets.find((s) => s.id === key)?.height ?? 1024
  const empty = $derived(app.session.glyphCount === 0)

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const files = [...(e.dataTransfer?.files ?? [])]
    if (!files.length) return
    await app.importFiles(
      await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))),
    )
  }
</script>

<section
  class="grid"
  class:dragging
  ondragover={(e) => { e.preventDefault(); dragging = true }}
  ondragleave={() => { dragging = false }}
  ondrop={onDrop}
  aria-label="Glyphs"
>
  {#if empty}
    <div class="empty">
      <p>Drop an <strong>IcoMoon project</strong> (.json), a <strong>font package</strong> (.zip) or <strong>SVG files</strong> here.</p>
      <button onclick={() => app.pickAndImport()}>Choose files…</button>
      <p class="muted">host: {host.name} · storage: {host.capabilities.realFs ? 'filesystem' : 'browser (OPFS)'}</p>
    </div>
  {:else if app.matchCount === 0}
    <div class="empty"><p>No glyph matches “{app.search}”.</p></div>
  {:else}
    <VirtualGrid {sections} cellSize={app.cellSize}>
      {#snippet header({ key, title, count })}
        <h2><span>{title}</span> <span class="muted">{count}</span></h2>
      {/snippet}
      {#snippet cell(glyph, key)}
        <GlyphCell {glyph} height={heightOf(key)} size={app.cellSize} />
      {/snippet}
    </VirtualGrid>
  {/if}

  {#if dragging}<div class="overlay">Drop to import</div>{/if}
</section>

<style>
  .grid { position: relative; min-height: 0; display: flex; flex-direction: column; }
  .grid > :global(.viewport) { flex: 1; }
  h2 {
    display: flex; gap: 8px; align-items: baseline; margin: 0; padding: 10px 0 6px;
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--gs-muted);
  }
  .empty { margin: auto; text-align: center; padding: 40px; display: grid; gap: 12px; justify-items: center; }
  .muted { color: var(--gs-muted); font-weight: 400; font-size: 12px; }
  .overlay {
    position: absolute; inset: 8px; border: 2px dashed var(--gs-accent); border-radius: 8px;
    display: grid; place-items: center; pointer-events: none;
    background: color-mix(in srgb, var(--gs-accent) 12%, transparent); font-weight: 600;
  }
</style>
