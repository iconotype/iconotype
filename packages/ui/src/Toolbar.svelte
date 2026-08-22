<script lang="ts">
  import { useApp } from './app.svelte.js'
  const app = useApp()
</script>

<div class="bar">
  <button onclick={() => app.pickAndImport()} disabled={app.busy}>Import…</button>
  <button
    class="ghost"
    onclick={() => (app.showLibrary = true)}
    title="Search Lucide, Material Symbols, MDI and 200+ other open libraries (⌘K)"
  >Find icons…</button>

  <label class="size">
    <input type="range" min="16" max="96" step="8" bind:value={app.cellSize} aria-label="Glyph size" />
    <span class="muted">{app.cellSize}px</span>
  </label>

  <input class="search" type="search" placeholder="Search name or tag… (/)" bind:value={app.search} />
  <span class="muted count">{app.matchCount} shown · {app.includedCount} in font</span>

  <span class="spacer"></span>

  <!--
    Fixed positions, always. These used to swap: "Select all" sat where "Remove"
    appears the moment anything is selected, so all/none/all landed on Remove instead —
    a destructive action under a button you were clicking rhythmically.
  -->
  {#if app.selection.size}<span class="muted">{app.selection.size} selected</span>{/if}
  <button class="ghost" onclick={() => app.selectAll()} disabled={!app.matchCount}>All</button>
  <button class="ghost" onclick={() => app.selectNone()} disabled={!app.selection.size}>None</button>
  <button class="ghost" onclick={() => app.invertSelection()} disabled={!app.matchCount}>Invert</button>
  <span class="sep"></span>
  <!--
    Include/exclude is what decides the built font; it acts on the selection, or on
    everything the search matches when nothing is selected — which is how you take a
    900-icon set down to the twelve you need.
  -->
  <button
    class="ghost"
    onclick={() => app.includeSelected()}
    title={app.selection.size ? `Include the ${app.selection.size} selected` : 'Include everything shown'}
  >Include</button>
  <button
    class="ghost"
    onclick={() => app.excludeSelected()}
    title={app.selection.size ? `Exclude the ${app.selection.size} selected` : 'Exclude everything shown'}
  >Exclude</button>

  {#if app.selection.size}
    <span class="sep"></span>
    <button class="ghost danger" onclick={() => app.removeSelected()}>
      Remove {app.selection.size}
    </button>
  {/if}
</div>

<style>
  .bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--gs-border); }
  .spacer { flex: 1; }
  .muted { color: var(--gs-muted); font-size: 12px; }
  .count { min-width: 70px; }
  input[type='search'] {
    font: inherit; background: var(--gs-input); color: var(--gs-fg);
    border: 1px solid var(--gs-border); border-radius: var(--gs-radius); padding: 3px 8px; min-width: 180px;
  }
  .size { display: flex; align-items: center; gap: 6px; }
  .size input { width: 90px; }
  .danger:hover { border-color: var(--gs-error); color: var(--gs-error); }
  /* keeps the destructive button visibly out of the rhythm of the selection controls */
  .sep { width: 1px; align-self: stretch; margin: 2px 4px; background: var(--gs-border); }
</style>
