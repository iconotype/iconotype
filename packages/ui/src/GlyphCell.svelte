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

<button
  class="cell"
  class:selected={app.isSelected(glyph.id)}
  title="{glyph.name}{code === undefined ? '' : ` · U+${codeLabel}`}"
  onclick={(e) => app.toggle(glyph.id, e.metaKey || e.ctrlKey || e.shiftKey)}
>
  <svg viewBox="0 0 {height} {height}" width={size} height={size} aria-label={glyph.name}>
    {#each glyph.paths as d, i}
      <path {d} fill={glyph.attrs[i]?.fill ?? 'currentColor'} />
    {/each}
  </svg>
  {#if badge}<i class="badge {badge}" title="{findings!.length} finding(s)"></i>{/if}
  <span class="name">{glyph.name}</span>
  {#if app.session.project.preferences.showCodes}<span class="code">{codeLabel}</span>{/if}
</button>

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
  svg { display: block; }
  .badge { position: absolute; top: 4px; right: 4px; width: 6px; height: 6px; border-radius: 50%; }
  .badge.error { background: var(--gs-error); }
  .badge.warning { background: var(--gs-warn); }
  .name, .code { font-size: 10px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { color: var(--gs-fg); }
  .code { color: var(--gs-muted); font-family: var(--gs-mono); font-size: 9px; }
</style>
