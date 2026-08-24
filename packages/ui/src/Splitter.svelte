<script lang="ts">
  import { onDestroy } from 'svelte'

  /**
   * The drag handle between a side pane and the grid.
   *
   * A hairline that grows a hit area either side of itself: 2px of visible divider is
   * right for the layout and wrong for the pointer, so the target is 9px wide and the
   * line inside it is what you see. Arrow keys move it too — it is a real separator, so
   * it answers to the keyboard like one.
   */
  let {
    value = $bindable(),
    side,
    label,
    min = 160,
    max = 560,
    initial,
  }: {
    /** the pane's width in pixels */
    value: number
    /** which side of the splitter the pane is on */
    side: 'left' | 'right'
    label: string
    min?: number
    max?: number
    /** width a double-click goes back to */
    initial: number
  } = $props()

  let dragging = $state(false)
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)))

  // a pane closed mid-drag takes its handle with it, and the pointerup never lands
  onDestroy(() => document.body.classList.remove('gs-resizing'))

  function onPointerDown(event: PointerEvent) {
    // a middle or right button on a divider is not a drag
    if (event.button !== 0) return
    /**
     * Two things stop the drag from selecting the whole window.
     *
     * `preventDefault` cancels the selection the mousedown would otherwise start, and
     * the class on <body> keeps the pointer from extending one that already existed —
     * without it, dragging the handle swept a selection across every panel it passed,
     * and left the cursor flickering between a caret and a resize arrow.
     */
    event.preventDefault()
    document.body.classList.add('gs-resizing')

    const start = event.clientX
    const from = value
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    dragging = true

    const move = (e: PointerEvent) => {
      const delta = e.clientX - start
      value = clamp(side === 'left' ? from + delta : from - delta)
    }
    const up = () => {
      dragging = false
      document.body.classList.remove('gs-resizing')
      target.releasePointerCapture(event.pointerId)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  function onKeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 48 : 16
    const towards = side === 'left' ? 1 : -1
    if (event.key === 'ArrowLeft') { event.preventDefault(); value = clamp(value - step * towards) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); value = clamp(value + step * towards) }
    else if (event.key === 'Home') { event.preventDefault(); value = initial }
  }
</script>

<!--
  `slider`, not `separator`: a focusable separator is the ARIA window-splitter pattern,
  but it is a widget either way, and this role is the one both the linter and a screen
  reader agree reports a value you can change with the arrow keys.
-->
<div
  class="splitter"
  class:dragging
  role="slider"
  aria-orientation="horizontal"
  aria-label="{label} width"
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuetext="{value} pixels"
  tabindex="0"
  onpointerdown={onPointerDown}
  ondblclick={() => (value = initial)}
  onkeydown={onKeydown}
></div>

<style>
  .splitter {
    cursor: col-resize;
    user-select: none;
    -webkit-user-select: none;
    display: grid;
    place-items: center stretch;
    background: transparent;
    touch-action: none;
  }
  .splitter::after {
    content: '';
    width: 2px; height: 100%; justify-self: center;
    border-radius: 2px;
    background: transparent;
    transition: background var(--gs-transition);
  }
  .splitter:hover::after, .splitter:focus-visible::after, .splitter.dragging::after { background: var(--gs-accent); }
  .splitter:focus-visible { outline: none; box-shadow: none; }
</style>
