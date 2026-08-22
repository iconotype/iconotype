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

  const cellTotal = $derived(cellSize + 26 + gap)          // icon + label + gap
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
          <div class="cells" style:grid-template-columns="repeat({columns}, minmax(0, 1fr))" style:gap="{gap}px">
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
