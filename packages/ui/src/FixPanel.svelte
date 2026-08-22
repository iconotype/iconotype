<script lang="ts">
  import { useApp } from './app.svelte.js'
  const app = useApp()

  const severityOrder = { error: 0, warning: 1, info: 2 } as const
  const current = $derived(app.lintFocus)
</script>

<aside>
  <h2>Fix</h2>

  <div class="opts">
    <label class="row">
      <span>Simplify</span>
      <input type="range" min="0" max="20" step="1" bind:value={app.fixSimplify} />
      <em>{app.fixSimplify || 'off'}</em>
    </label>
    <label class="row">
      <span>Snap grid</span>
      <input type="range" min="0" max="32" step="4" bind:value={app.fixSnap} />
      <em>{app.fixSnap || 'off'}</em>
    </label>
    <label class="row check">
      <input type="checkbox" bind:checked={app.fixRefit} />
      <span>Refit to em box</span>
    </label>
  </div>

  <div class="actions">
    <button class="ghost" onclick={() => app.lintAll()} disabled={app.busy || !app.session.glyphCount}>
      Check all glyphs
    </button>
    <button
      onclick={() => app.applyFix()}
      disabled={app.busy || (!app.selection.size && !app.session.glyphCount)}
    >
      Fix {app.selection.size ? `${app.selection.size} selected` : 'all'}
    </button>
  </div>

  {#if app.lintSummary}
    <p class="summary">
      <span class="err">{app.lintSummary.errors} error(s)</span> ·
      <span class="warn">{app.lintSummary.warnings} warning(s)</span> ·
      {app.lintSummary.clean} clean
    </p>
  {/if}

  {#if current}
    <h2>{current.glyph.name}</h2>
    <div class="preview">
      <svg viewBox="0 0 {current.height} {current.height}" aria-label="before and after">
        <!-- original in red underneath, fixed result on top -->
        {#each current.before as d}<path {d} class="before" />{/each}
        {#each current.after as d}<path {d} class="after" />{/each}
      </svg>
      <ul class="legend">
        <li><i class="swatch before"></i> before</li>
        <li><i class="swatch after"></i> after</li>
      </ul>
    </div>
    <ul class="findings">
      {#each [...current.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]) as f}
        <li class={f.severity}>
          <code>{f.code}</code>
          <span>{f.message}{f.count && f.count > 1 ? ` (×${f.count})` : ''}</span>
        </li>
      {:else}
        <li class="info"><span>No problems found.</span></li>
      {/each}
    </ul>
  {:else}
    <p class="muted">Select a glyph to inspect it, or run a check over the whole project.</p>
  {/if}
</aside>

<style>
  aside { border-left: 1px solid var(--gs-border); padding: 10px; overflow: auto; display: grid; gap: 10px; align-content: start; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--gs-muted); margin: 4px 0 0; }
  .opts { display: grid; gap: 4px; }
  .row { display: grid; grid-template-columns: 62px 1fr 28px; align-items: center; gap: 6px; font-size: 11px; color: var(--gs-muted); }
  .row.check { grid-template-columns: auto 1fr; }
  .row em { font-style: normal; font-family: var(--gs-mono); font-size: 10px; }
  .row input[type='range'] { width: 100%; }
  .actions { display: grid; gap: 6px; }
  .summary { font-size: 11px; margin: 0; color: var(--gs-muted); }
  .err { color: var(--gs-error); }
  .warn { color: var(--vscode-editorWarning-foreground, #d7a03c); }
  .preview svg { width: 100%; max-width: 150px; display: block; margin: 0 auto; background: var(--gs-hover); border-radius: 4px; }
  .preview .before { fill: var(--gs-error); opacity: .45; }
  .preview .after { fill: var(--gs-fg); }
  .legend { list-style: none; display: flex; gap: 10px; justify-content: center; padding: 0; margin: 6px 0 0; font-size: 10px; color: var(--gs-muted); }
  .legend li { display: flex; align-items: center; gap: 4px; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .swatch.before { background: var(--gs-error); opacity: .45; }
  .swatch.after { background: var(--gs-fg); }
  .findings { list-style: none; padding: 0; margin: 0; display: grid; gap: 5px; font-size: 11px; }
  .findings li { display: grid; gap: 1px; }
  .findings code { font-size: 9px; letter-spacing: .04em; color: var(--gs-muted); }
  .findings li.error code { color: var(--gs-error); }
  .findings li.warning code { color: var(--vscode-editorWarning-foreground, #d7a03c); }
  .muted { color: var(--gs-muted); font-size: 11px; }
</style>
