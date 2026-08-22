<script lang="ts">
  import { hex } from '@iconotype/core-model'
  import { useApp } from './app.svelte.js'

  /**
   * One glyph on its em square.
   *
   * Not a bézier editor — the artwork arrives already drawn, and what actually needs
   * doing to it is positional: it sits off-centre, it is stroked instead of filled, it
   * overlaps itself, it is 40 units too far left. Those are the tools here, plus the
   * ability to walk the whole set doing them one after another without leaving.
   */
  const app = useApp()

  const target = $derived(app.editingGlyph)
  const glyph = $derived(target?.glyph ?? null)
  const size = $derived(target?.set.height ?? 1024)
  const position = $derived(app.editingIndex)
  const code = $derived(glyph ? app.codepointOf(glyph) : undefined)
  const codes = $derived(code === undefined ? [] : Array.isArray(code) ? code : [code])
  const findings = $derived(glyph ? app.findingsFor(glyph.id) ?? [] : [])

  /** The baseline sits `baselinePct` of the em above the bottom of the box. */
  const baseline = $derived(size - (size * app.session.project.preferences.font.baselinePct) / 100)

  /** Nudge step: a sixteenth of the em, or one unit with alt. */
  const stepFor = (event: KeyboardEvent) =>
    event.altKey ? 1 : event.shiftKey ? size / 8 : size / 64

  function onKeydown(event: KeyboardEvent) {
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (event.metaKey || event.ctrlKey) return

    const step = stepFor(event)
    switch (event.key) {
      case 'ArrowLeft': event.preventDefault(); void app.nudge(-step, 0); return
      case 'ArrowRight': event.preventDefault(); void app.nudge(step, 0); return
      case 'ArrowUp': event.preventDefault(); void app.nudge(0, -step); return
      case 'ArrowDown': event.preventDefault(); void app.nudge(0, step); return
      case '[': case ',': event.preventDefault(); app.step(-1); return
      case ']': case '.': event.preventDefault(); app.step(1); return
      case '+': case '=': event.preventDefault(); app.zoom = Math.min(8, app.zoom * 1.25); return
      case '-': case '_': event.preventDefault(); app.zoom = Math.max(0.25, app.zoom / 1.25); return
      case '0': event.preventDefault(); app.zoom = 1; return
      case 'g': app.editorGrid = app.editorGrid ? 0 : 16; return
      case 'm': app.showMetrics = !app.showMetrics; return
      case 'Escape': app.edit(null); return
    }
  }

  /** Ctrl/⌘ + wheel zooms, like every other canvas. */
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    app.zoom = Math.min(8, Math.max(0.25, app.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
  }

  const gridLines = $derived(
    app.editorGrid > 0
      ? Array.from({ length: app.editorGrid - 1 }, (_, i) => ((i + 1) * size) / app.editorGrid)
      : [],
  )
</script>

<svelte:window onkeydown={onKeydown} />

<section class="editor">
  <header>
    <div class="who">
      <strong>{glyph?.name ?? 'No icon'}</strong>
      <span class="muted">
        {position.index}/{position.total}
        {#each codes as c}<code>U+{hex(c)}</code>{/each}
        {#if glyph && !app.isIncluded(glyph)}<em class="excluded">excluded</em>{/if}
      </span>
    </div>
    <span class="spacer"></span>
    {#if glyph}
      <button
        class="ghost tiny"
        onclick={() => app.toggleIncluded(glyph)}
        title="Whether this icon ships in the built font"
      >{app.isIncluded(glyph) ? '✓ In font' : 'Excluded'}</button>
    {/if}
    <span class="zoom">
      <button class="ghost tiny" onclick={() => (app.zoom = Math.max(0.25, app.zoom / 1.25))} title="Zoom out (−)">−</button>
      <button class="ghost tiny" onclick={() => (app.zoom = 1)} title="Reset zoom (0)">{Math.round(app.zoom * 100)}%</button>
      <button class="ghost tiny" onclick={() => (app.zoom = Math.min(8, app.zoom * 1.25))} title="Zoom in (+)">+</button>
    </span>
    <button class="ghost tiny" onclick={() => app.edit(null)} title="Back to the grid (Esc)">Done</button>
  </header>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="stage" onwheel={onWheel} role="img" aria-label={glyph?.name ?? 'No icon selected'}>
    <!--
      Fixed to the canvas edges, not next to the name. They used to sit either side of
      the glyph's name, so the button moved every time you used it — the one control
      you press twenty times in a row.
    -->
    <button class="nav prev" onclick={() => app.step(-1)} title="Previous icon ([)" aria-label="Previous icon">‹</button>
    <button class="nav next" onclick={() => app.step(1)} title="Next icon (])" aria-label="Next icon">›</button>
    {#if glyph}
      <!--
        100% means "the whole em box, fitted" — not "as wide as the pane". The stage is
        wider than it is tall on a desktop window, so sizing by width alone drew the
        glyph past the top and bottom edges and cropped it.
      -->
      <svg viewBox="0 0 {size} {size}" style:width="{Math.round(app.zoom * 100)}%">
        <rect class="box" x="0" y="0" width={size} height={size} />
        {#if app.editorGrid}
          <g class="grid">
            {#each gridLines as at}
              <line x1={at} y1="0" x2={at} y2={size} />
              <line x1="0" y1={at} x2={size} y2={at} />
            {/each}
          </g>
        {/if}
        {#if app.showMetrics}
          <g class="metrics">
            <line x1="0" y1={baseline} x2={size} y2={baseline} />
            <line class="mid" x1={size / 2} y1="0" x2={size / 2} y2={size} />
          </g>
        {/if}
        <g class="art">
          {#each glyph.paths as d, i}
            <path {d} fill={glyph.attrs[i]?.fill ?? 'currentColor'} />
          {/each}
        </g>
      </svg>
    {:else}
      <p class="empty">Pick an icon to edit it.</p>
    {/if}
  </div>

  <div class="tools" class:disabled={!glyph}>
    <div class="group" role="group" aria-label="Align">
      <span class="label">Align</span>
      <button class="ghost tiny" onclick={() => app.align('left')} title="Align to the left edge">Left</button>
      <button class="ghost tiny" onclick={() => app.align('center-x')} title="Centre horizontally">Centre</button>
      <button class="ghost tiny" onclick={() => app.align('right')} title="Align to the right edge">Right</button>
      <button class="ghost tiny" onclick={() => app.align('top')} title="Align to the top edge">Top</button>
      <button class="ghost tiny" onclick={() => app.align('center-y')} title="Centre vertically">Middle</button>
      <button class="ghost tiny" onclick={() => app.align('bottom')} title="Align to the bottom edge">Bottom</button>
      <button class="ghost tiny" onclick={() => app.align('center')} title="Centre in the em box">Both</button>
    </div>

    <div class="group" role="group" aria-label="Move">
      <span class="label">Move</span>
      <button class="ghost tiny" onclick={() => app.nudge(-size / 64, 0)} title="Move left (←)">←</button>
      <button class="ghost tiny" onclick={() => app.nudge(0, -size / 64)} title="Move up (↑)">↑</button>
      <button class="ghost tiny" onclick={() => app.nudge(0, size / 64)} title="Move down (↓)">↓</button>
      <button class="ghost tiny" onclick={() => app.nudge(size / 64, 0)} title="Move right (→)">→</button>
    </div>

    <div class="group" role="group" aria-label="Transform">
      <span class="label">Transform</span>
      <button class="ghost tiny" onclick={() => app.scaleBy(1.1)} title="Scale up 10%">Bigger</button>
      <button class="ghost tiny" onclick={() => app.scaleBy(1 / 1.1)} title="Scale down 10%">Smaller</button>
      <button class="ghost tiny" onclick={() => app.rotate(-90)} title="Rotate 90° anticlockwise">Rotate ↺</button>
      <button class="ghost tiny" onclick={() => app.rotate(90)} title="Rotate 90° clockwise">Rotate ↻</button>
      <button class="ghost tiny" onclick={() => app.flip('horizontal')} title="Mirror left to right">Flip H</button>
      <button class="ghost tiny" onclick={() => app.flip('vertical')} title="Mirror top to bottom">Flip V</button>
    </div>

    <div class="group" role="group" aria-label="Fix">
      <span class="label">Fix</span>
      <button class="ghost tiny" onclick={() => app.fitToEm(0)} title="Scale the artwork to fill the em box">Fit to box</button>
      <button class="ghost tiny" onclick={() => app.strokeToFill()} title="Outline stroked paths into filled shapes — a font glyph has no stroke">
        Stroke → fill
      </button>
      <button class="ghost tiny" onclick={() => app.mergeOverlaps()} title="Unite overlapping shapes into one outline">
        Merge overlaps
      </button>
      <button class="ghost tiny" onclick={() => app.snapToGrid()} title="Round every coordinate onto the grid">Snap to grid</button>
    </div>

    <div class="group" role="group" aria-label="View">
      <span class="label">View</span>
      <label class="check"><input type="checkbox" bind:checked={app.showMetrics} /> Metrics</label>
      <label class="check">
        <input
          type="checkbox"
          checked={app.editorGrid > 0}
          onchange={(e) => (app.editorGrid = e.currentTarget.checked ? 16 : 0)}
        /> Grid
      </label>
    </div>
  </div>

  {#if findings.length}
    <ul class="findings">
      {#each findings.slice(0, 4) as f}
        <li class={f.severity}><code>{f.code}</code> {f.message}</li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .editor { display: grid; grid-template-rows: auto 1fr auto auto; min-height: 0; }
  header {
    display: flex; align-items: center; gap: 6px;
    padding: 6px var(--gs-pad); border-bottom: 1px solid var(--gs-border);
  }
  .who { display: grid; gap: 0; min-width: 0; }
  .who strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1; }
  .muted { color: var(--gs-muted); font-size: var(--gs-size-sm); display: flex; gap: 6px; }
  .tiny { padding: 1px 7px; font-size: var(--gs-size-sm); }
  .wide { padding: 1px 9px; }

  .stage { position: relative; display: grid; place-items: center; overflow: auto; padding: var(--gs-pad) 56px; min-height: 0; }
  .nav {
    position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
    width: 40px; height: 76px; padding: 0; font-size: 24px; line-height: 1;
    background: var(--gs-surface-2); color: var(--gs-fg);
    border: 1px solid var(--gs-border); border-radius: var(--gs-radius-lg); cursor: pointer;
  }
  .nav:hover { background: var(--gs-hover); border-color: var(--gs-accent); color: var(--gs-accent); }
  .nav.prev { left: 8px; }
  .nav.next { right: 8px; }
  .zoom { display: inline-flex; gap: 2px; }
  .excluded { font-style: normal; color: var(--gs-warn); }
  .stage svg { aspect-ratio: 1; max-width: 100%; max-height: 100%; height: auto; }
  .box { fill: var(--gs-surface-2); stroke: var(--gs-border); stroke-width: 2; }
  .grid line { stroke: var(--gs-border); stroke-width: 1; opacity: .55; }
  /* the baseline is the only line that changes what the font does, so it is the loud one */
  .metrics line { stroke: var(--gs-accent); stroke-width: 2; opacity: .5; }
  .metrics .mid { stroke-dasharray: 12 10; opacity: .3; }
  .art { fill: var(--gs-fg); }

  .tools { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px var(--gs-pad); border-top: 1px solid var(--gs-border); }
  .tools.disabled { opacity: .4; pointer-events: none; }
  .group { display: flex; align-items: center; gap: 3px; }
  .label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--gs-muted); margin-right: 2px; }
  .check { display: flex; align-items: center; gap: 4px; font-size: var(--gs-size-sm); color: var(--gs-muted); }

  .findings { list-style: none; margin: 0; padding: 6px var(--gs-pad) 10px; display: grid; gap: 3px; font-size: var(--gs-size-sm); }
  .findings code { color: var(--gs-muted); font-size: 10px; margin-right: 4px; }
  .findings li.error code { color: var(--gs-error); }
  .findings li.warning code { color: var(--gs-warn); }
  .empty { color: var(--gs-muted); font-size: var(--gs-size-sm); }
</style>
