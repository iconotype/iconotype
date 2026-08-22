<script lang="ts">
  import type { Glyph } from '@iconotype/core-model'
  import { hex } from '@iconotype/core-model'
  import { useApp } from './app.svelte.js'

  let { glyph, height, size }: { glyph: Glyph; height: number; size: number } = $props()
  const app = useApp()
  const code = $derived(app.codepointOf(glyph))
  const findings = $derived(app.findingsFor(glyph.id))
  const badge = $derived(
    !findings?.length ? null
    : findings.some((f) => f.severity === 'error') ? 'error'
    : findings.some((f) => f.severity === 'warning') ? 'warning'
    : null,
  )
  const codeLabel = $derived(
    code === undefined ? '—' : Array.isArray(code) ? `${hex(code[0]!)}+${code.length - 1}` : hex(code),
  )
</script>

<div
  class="cell"
  class:selected={app.isSelected(glyph.id)}
  class:excluded={!app.isIncluded(glyph)}
  role="button"
  tabindex="0"
  title="{glyph.name}{code === undefined ? '' : ` · U+${codeLabel}`}{app.isIncluded(glyph) ? '' : ' · excluded from the font'}"
  onclick={(e) => (e.shiftKey ? app.selectTo(glyph.id) : app.toggle(glyph.id, e.metaKey || e.ctrlKey))}
  ondblclick={() => app.edit(glyph.id)}
  onkeydown={(e) => {
    if (e.key === 'Enter') { e.preventDefault(); app.edit(glyph.id) }
    else if (e.key === ' ') { e.preventDefault(); app.toggleIncluded(glyph) }
  }}
>
  <!--
    The tick decides what ships; clicking the cell only selects it. Those were the same
    gesture, so opening an icon silently rewrote the export set.
  -->
  <button
    class="check"
    class:on={app.isIncluded(glyph)}
    tabindex="-1"
    title={app.isIncluded(glyph) ? 'In the font — click to exclude' : 'Excluded — click to include'}
    aria-label="{app.isIncluded(glyph) ? 'Exclude' : 'Include'} {glyph.name}"
    onclick={(e) => { e.stopPropagation(); app.toggleIncluded(glyph) }}
  >{app.isIncluded(glyph) ? '✓' : ''}</button>

  <svg viewBox="0 0 {height} {height}" width={size} height={size} aria-label={glyph.name}>
    {#each glyph.paths as d, i}
      <path {d} fill={glyph.attrs[i]?.fill ?? 'currentColor'} />
    {/each}
  </svg>
  {#if badge}<i class="badge {badge}" title="{findings!.length} finding(s)"></i>{/if}
  <span class="name">{glyph.name}</span>
  {#if app.session.project.preferences.showCodes}<span class="code">{codeLabel}</span>{/if}
</div>

<style>
  .cell {
    position: relative;
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: transparent; color: var(--gs-fg);
    border: 1px solid var(--gs-border); border-radius: var(--gs-radius); padding: 8px 4px 5px;
    overflow: hidden; cursor: pointer;
  }
  .cell:hover { background: var(--gs-hover); }
  .selected { background: var(--gs-active); border-color: var(--gs-accent); }
  .cell:focus-visible { outline: none; box-shadow: var(--gs-ring); }
  /* excluded artwork stays visible but obviously not shipping */
  .excluded { opacity: .45; }
  .excluded .name { text-decoration: line-through; }
  .check {
    position: absolute; top: 3px; right: 3px; width: 15px; height: 15px; padding: 0;
    line-height: 13px; font-size: 10px; text-align: center; cursor: pointer;
    border-radius: var(--gs-radius); border: 1px solid var(--gs-border);
    background: var(--gs-input); color: transparent;
  }
  .check.on { background: var(--gs-accent); border-color: var(--gs-accent); color: var(--gs-accent-fg); }
  .cell:hover .check { border-color: var(--gs-accent); }
  svg { display: block; }
  .badge { position: absolute; top: 4px; left: 4px; width: 6px; height: 6px; border-radius: 50%; }
  .badge.error { background: var(--gs-error); }
  .badge.warning { background: var(--gs-warn); }
  .name, .code { font-size: 10px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { color: var(--gs-fg); }
  .code { color: var(--gs-muted); font-family: var(--gs-mono); font-size: 9px; }
</style>
