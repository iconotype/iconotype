<script lang="ts">
  import { useApp } from './app.svelte.js'
  const app = useApp()

  const severityOrder = { error: 0, warning: 1, info: 2 } as const
  const current = $derived(app.lintFocus)
  /**
   * Whether the fixer would actually change this glyph.
   *
   * Import already runs the pipeline, so with the sliders at their defaults "after" is
   * the same geometry as "before" — and the overlay drew one exactly on top of the
   * other, which read as a missing preview rather than as nothing to do. Say it.
   */
  const unchanged = $derived(!!current && current.before.join() === current.after.join())
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
    {#if app.mode === 'edit'}
      <!-- in the editor the subject is this glyph; "fix all" here would be a trap -->
      <button onclick={() => app.applyFix()} disabled={app.busy || !app.editing}>Fix this icon</button>
    {:else}
      <button class="ghost" onclick={() => app.lintAll()} disabled={app.busy || !app.session.glyphCount}>
        Check all glyphs
      </button>
      <button
        onclick={() => app.applyFix()}
        disabled={app.busy || (!app.selection.size && !app.session.glyphCount)}
      >
        Fix {app.selection.size ? `${app.selection.size} selected` : 'all'}
      </button>
    {/if}
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
    <!--
      Two tiles, not one overlay. The overlay alone could not show "before" at all when
      the fix moved nothing, and side by side is how you actually compare two drawings;
      the right-hand tile keeps the original ghosted underneath so a shift of two units
      still shows up where it happened.
    -->
    <div class="preview">
      <figure>
        <svg viewBox="0 0 {current.height} {current.height}" aria-label="before">
          {#each current.before as d}<path {d} class="before solid" />{/each}
        </svg>
        <figcaption>before</figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 {current.height} {current.height}" aria-label="after">
          {#each current.before as d}<path {d} class="before" />{/each}
          {#each current.after as d}<path {d} class="after" />{/each}
        </svg>
        <figcaption>after</figcaption>
      </figure>
    </div>
    {#if unchanged}
      <p class="muted">These settings change nothing here — before and after are identical.</p>
    {/if}
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
  aside { border-left: var(--gs-divider); padding: 10px; overflow: auto; display: grid; gap: 10px; align-content: start; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--gs-muted); margin: 4px 0 0; }
  .opts { display: grid; gap: 4px; }
  .row { display: grid; grid-template-columns: 62px 1fr 28px; align-items: center; gap: 6px; font-size: 11px; color: var(--gs-muted); }
  .row.check { grid-template-columns: auto 1fr; }
  .row em { font-style: normal; font-family: var(--gs-mono); font-size: 10px; }
  .row input[type='range'] { width: 100%; }
  .actions { display: grid; gap: 6px; }
  .summary { font-size: 11px; margin: 0; color: var(--gs-muted); }
  .err { color: var(--gs-error); }
  .warn { color: var(--gs-warn); }
  .preview { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .preview figure { margin: 0; display: grid; gap: 4px; }
  .preview svg { width: 100%; display: block; background: var(--gs-hover); border-radius: var(--gs-radius); }
  .preview figcaption { text-align: center; font-size: 10px; color: var(--gs-muted); }
  .preview .before { fill: var(--gs-error); opacity: .45; }
  .preview .before.solid { opacity: .8; }
  .preview .after { fill: var(--gs-fg); }
  .findings { list-style: none; padding: 0; margin: 0; display: grid; gap: 5px; font-size: 11px; }
  .findings li { display: grid; gap: 1px; }
  .findings code { font-size: 9px; letter-spacing: .04em; color: var(--gs-muted); }
  .findings li.error code { color: var(--gs-error); }
  .findings li.warning code { color: var(--gs-warn); }
  .muted { color: var(--gs-muted); font-size: 11px; }
</style>
