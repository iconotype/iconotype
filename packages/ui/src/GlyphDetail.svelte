<script lang="ts">
  import { hex } from '@iconotype/core-model'
  import { useApp } from './app.svelte.js'

  /**
   * One glyph, large, with everything you can do to it.
   *
   * This is what the editor shows when it is embedded in an editor shell: the grid,
   * the set list and the export panel are all already in the sidebar there, so
   * repeating them wastes the space that the artwork actually needs.
   */
  const app = useApp()

  const glyph = $derived(app.selectedGlyphs[0] ?? app.lintFocus?.glyph ?? null)
  const set = $derived(
    glyph ? app.session.project.sets.find((s) => s.glyphs.some((g) => g.id === glyph.id)) : undefined)
  const code = $derived(glyph ? app.codepointOf(glyph) : undefined)
  const codes = $derived(code === undefined ? [] : Array.isArray(code) ? code : [code])
  const colors = $derived(
    glyph ? [...new Set(glyph.attrs.map((a) => a?.fill).filter((f): f is string => Boolean(f && f !== 'none')))] : [])
  const reference = $derived(
    glyph ? `${app.session.project.preferences.font.prefix}${glyph.name}` : '')

  let renaming = $state('')
  const startRename = () => { renaming = glyph?.name ?? '' }
  const commitRename = () => {
    if (glyph && renaming && renaming !== glyph.name) app.renameGlyph(glyph.id, renaming)
    renaming = ''
  }
</script>

<section>
  {#if !glyph}
    <p class="empty">Pick an icon in the sidebar to see it here.</p>
  {:else}
    <div class="stage">
      <svg viewBox="0 0 {set?.height ?? 1024} {set?.height ?? 1024}" aria-label={glyph.name}>
        {#each glyph.paths as d, i}
          <path {d} fill={glyph.attrs[i]?.fill ?? 'currentColor'} />
        {/each}
      </svg>
    </div>

    <div class="meta">
      {#if renaming}
        <input
          class="rename"
          bind:value={renaming}
          onblur={commitRename}
          onkeydown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') renaming = '' }}
        />
      {:else}
        <button class="name" onclick={startRename} title="Rename">{glyph.name}</button>
      {/if}
      <code class="ref">{reference}</code>
      <p class="codes">
        {#each codes as c}<span>U+{hex(c)}</span>{:else}<span class="muted">no codepoint</span>{/each}
      </p>

      {#if glyph.isMulticolor}
        <p class="warn">
          Multicolor: {glyph.paths.length} layers, {codes.length} codepoints.
          <button class="link" onclick={() => app.flattenColors(glyph.id)}>Flatten to one colour</button>
        </p>
      {:else if colors.length > 1}
        <p class="warn">
          {colors.length} fill colours in one glyph — a font glyph has none of its own.
          <button class="link" onclick={() => app.flattenColors(glyph.id)}>Use currentColor</button>
        </p>
      {/if}

      {#if colors.length}
        <ul class="swatches">
          {#each colors as c}<li><i style="background:{c}"></i><code>{c}</code></li>{/each}
        </ul>
      {/if}

      {#if glyph.tags.length}
        <p class="tags">{glyph.tags.join(' · ')}</p>
      {/if}
    </div>

    <div class="actions">
      <button onclick={() => app.replaceArtwork(glyph.id)}>Replace SVG…</button>
      <button class="ghost" onclick={() => { app.setQuickFormat('class'); void app.copyQuick() }}>
        {app.copied ? 'Copied' : 'Copy class'}
      </button>
      <button class="ghost" onclick={() => app.toggle(glyph.id, false)}>Re-check</button>
      <button class="danger" onclick={() => app.removeSelected()}>Remove</button>
    </div>
  {/if}
</section>

<style>
  section { display: grid; grid-template-rows: 1fr auto auto; gap: 10px; padding: 12px; min-height: 0; overflow: auto; }
  .stage { display: grid; place-items: center; min-height: 0; }
  .stage svg { width: min(100%, 320px); height: auto; background: var(--gs-hover); border-radius: var(--gs-radius-lg); padding: 12px; box-sizing: border-box; }
  .meta { display: grid; gap: 6px; justify-items: start; }
  .name { font-size: 16px; font-weight: 600; background: none; border: 0; color: var(--gs-fg); padding: 0; cursor: text; }
  .rename { font-size: 16px; font-weight: 600; }
  .ref { font-family: var(--gs-mono); font-size: 12px; color: var(--gs-muted); }
  .codes { margin: 0; display: flex; gap: 6px; font-family: var(--gs-mono); font-size: 11px; color: var(--gs-muted); }
  .warn { margin: 0; font-size: 11px; color: var(--gs-warn); }
  .link { background: none; border: 0; padding: 0; color: var(--gs-accent); cursor: pointer; font: inherit; text-decoration: underline; }
  .swatches { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; }
  .swatches li { display: flex; align-items: center; gap: 4px; font-size: 10px; }
  .swatches i { width: 12px; height: 12px; border-radius: var(--gs-radius); border: 1px solid var(--gs-border); }
  .tags { margin: 0; font-size: 11px; color: var(--gs-muted); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .danger { color: var(--gs-error); }
  .empty { color: var(--gs-muted); font-size: 12px; margin: auto; }
  .muted { color: var(--gs-muted); }
</style>
