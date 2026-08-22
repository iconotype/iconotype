<script lang="ts">
  /**
   * Windowed grid over section headers + glyph rows.
   *
   * Rows have two heights (header vs glyph row), so offsets are a prefix-sum array and
   * the first visible row comes from a binary search. That keeps a 10k-glyph project at
   * a few dozen DOM nodes without assuming uniform row height.
   */
  import type { Snippet } from 'svelte'

  interface Section<T> { key: string; title: string; items: T[] }

  let {
    sections,
    cellSize,
    headerHeight = 34,
    gap = 8,
    overscan = 3,
    cell,
    header,
  }: {
    sections: Section<any>[]
    cellSize: number
    headerHeight?: number
    gap?: number
    overscan?: number
    cell: Snippet<[any, string]>
    header: Snippet<[{ key: string; title: string; count: number }]>
  } = $props()

  let viewport = $state<HTMLDivElement | null>(null)
  let scrollTop = $state(0)
  let width = $state(0)
  let height = $state(600)

  /**
   * A cell is its artwork plus a fixed amount of chrome, and the chrome is measured.
   *
   * It used to be a flat `cellSize + 26`, tuned against the extension's 11px type.
   * Under the app palette — 14px, roomier padding — a cell is taller than that, so
   * every absolutely-positioned row sat on top of the one below it.
   */
  let chrome = $state(0)
  const cellTotal = $derived(cellSize + (chrome || 26) + gap)
  const columns = $derived(Math.max(1, Math.floor((width || 1) / (cellSize + 24 + gap))))

  type Row =
    | { kind: 'header'; section: Section<any>; h: number }
    | { kind: 'cells'; section: Section<any>; from: number; h: number }

  const rows = $derived.by((): Row[] => {
    const out: Row[] = []
    for (const section of sections) {
      out.push({ kind: 'header', section, h: headerHeight })
      for (let i = 0; i < section.items.length; i += columns) {
        out.push({ kind: 'cells', section, from: i, h: cellTotal })
      }
    }
    return out
  })

  const offsets = $derived.by(() => {
    const out = new Array<number>(rows.length + 1)
    out[0] = 0
    for (let i = 0; i < rows.length; i++) out[i + 1] = out[i]! + rows[i]!.h
    return out
  })
  const total = $derived(offsets[offsets.length - 1] ?? 0)

  /** last index whose offset is <= y */
  function findRow(y: number): number {
    let lo = 0, hi = rows.length - 1, best = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (offsets[mid]! <= y) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    return best
  }

  const first = $derived(Math.max(0, findRow(scrollTop) - overscan))
  const last = $derived(Math.min(rows.length, findRow(scrollTop + height) + overscan + 1))
  const visible = $derived(rows.slice(first, last).map((row, i) => ({ row, top: offsets[first + i]! })))

  /**
   * Watches one rendered row of cells; they are all the same height.
   *
   * The first read is synchronous rather than left to the observer. A
   * ResizeObserver callback is delivered on a rendering frame, and a page that is not
   * being composited — a background tab, a hidden panel — produces none, so the rows
   * would keep their estimated height and overlap until something painted.
   * `getBoundingClientRect` forces layout there and then, which always works; the
   * observer stays for what comes later, like a font loading or the window zooming.
   */
  let probe: HTMLElement | null = null

  /**
   * What a cell costs BEYOND its artwork: padding, the name, the codepoint.
   *
   * Measuring the whole cell was the obvious thing and the wrong one — it has to be
   * re-measured every time the size slider moves, and the measurement lands a beat
   * behind the DOM, so a row stayed short while its cells grew and they overlapped
   * again. The chrome does not change with the slider, so measuring THAT once gives a
   * row height that is correct the instant the size changes.
   */
  const readProbe = () => {
    const height = probe?.getBoundingClientRect().height ?? 0
    if (height <= 0) return
    const next = Math.max(0, height - cellSize)
    if (Math.abs(next - chrome) > 0.5) chrome = next
  }

  const measureCells = (node: HTMLElement) => {
    probe = node
    queueMicrotask(readProbe)
    const ro = new ResizeObserver(readProbe)
    ro.observe(node)
    return {
      destroy: () => {
        ro.disconnect()
        if (probe === node) probe = null
      },
    }
  }

  /**
   * Re-measure when the size changes.
   *
   * Only to catch a theme or font change; the row height itself no longer depends on
   * this being timely, because it is derived from `cellSize` directly.
   */
  $effect(() => {
    // the comparison is what makes the dependency real: a bare `cellSize` statement is
    // an unused expression and the compiler does not track it
    if (cellSize > 0) readProbe()
  })

  const measure = (node: HTMLDivElement) => {
    const ro = new ResizeObserver(([entry]) => {
      width = entry!.contentRect.width
      height = entry!.contentRect.height
    })
    ro.observe(node)
    return { destroy: () => ro.disconnect() }
  }
</script>

<div
  class="viewport"
  bind:this={viewport}
  use:measure
  onscroll={() => { scrollTop = viewport?.scrollTop ?? 0 }}
>
  <div class="spacer" style:height="{total}px">
    {#each visible as { row, top } (row.kind + row.section.key + (row.kind === 'cells' ? row.from : 'h'))}
      <div class="row" style:top="{top}px" style:height="{row.h}px">
        {#if row.kind === 'header'}
          {@render header({ key: row.section.key, title: row.section.title, count: row.section.items.length })}
        {:else}
          <div
            class="cells"
            use:measureCells
            style:grid-template-columns="repeat({columns}, minmax(0, 1fr))"
            style:gap="{gap}px"
          >
            {#each row.section.items.slice(row.from, row.from + columns) as item (row.section.key + row.from + item.id)}
              {@render cell(item, row.section.key)}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .viewport { overflow: auto; position: relative; height: 100%; }
  .spacer { position: relative; width: 100%; }
  .row { position: absolute; left: 0; right: 0; padding: 0 12px; }
  .cells { display: grid; align-items: start; }
</style>
