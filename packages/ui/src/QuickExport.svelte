<script lang="ts">
  import { useApp } from './app.svelte.js'
  const app = useApp()

  const FORMATS = [
    { id: 'character', label: 'Character' },
    { id: 'escape', label: 'CSS escape' },
    { id: 'class', label: 'Class name' },
    { id: 'svg', label: 'SVG' },
    { id: 'datauri', label: 'Data URI' },
    { id: 'use', label: 'SVG <use>' },
    { id: 'symbol', label: 'SVG <symbol>' },
  ] as const
</script>

<section class="quick">
  <div class="tabs">
    {#each FORMATS as f}
      <button class="tab" class:active={app.quickFormat === f.id} onclick={() => app.setQuickFormat(f.id)}>
        {f.label}
      </button>
    {/each}
  </div>

  {#if app.quickValue}
    <textarea readonly rows="3" value={app.quickValue}></textarea>
    <div class="row">
      <button onclick={() => app.copyQuick()}>{app.copied ? 'Copied' : 'Copy'}</button>
      <span class="muted">{app.selection.size || 1} icon(s)</span>
    </div>
  {:else}
    <p class="muted">Select an icon to copy it in any format.</p>
  {/if}
</section>

<style>
  .quick { display: grid; gap: 6px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 3px; }
  .tab {
    background: transparent; color: var(--gs-muted); border: 1px solid var(--gs-border);
    border-radius: var(--gs-radius); padding: 1px 6px; font-size: 10px;
  }
  .tab.active { background: var(--gs-active); color: var(--gs-fg); border-color: var(--gs-accent); }
  textarea {
    width: 100%; font: 11px/1.4 var(--gs-mono); resize: vertical;
    background: var(--gs-input); color: var(--gs-fg);
    border: 1px solid var(--gs-border); border-radius: var(--gs-radius); padding: 4px 6px;
  }
  .row { display: flex; align-items: center; gap: 8px; }
  .muted { color: var(--gs-muted); font-size: 11px; margin: 0; }
</style>
