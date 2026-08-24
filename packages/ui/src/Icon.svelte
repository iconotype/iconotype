<script lang="ts">
  /**
   * The chrome's icon set, inline.
   *
   * Sixteen-pixel glyphs on the same grid as VSCode's codicons, drawn here rather than
   * pulled from a font: the extension runs under a CSP that forbids remote fonts, and a
   * toolbar that says "☰ ▤" tells nobody which panel it opens. Panel toggles follow the
   * editor convention people already know — a window outline with the pane filled when
   * it is showing and hollow when it is not.
   */
  import type { IconName } from './icons.js'

  let { name, size = 16 }: { name: IconName; size?: number } = $props()
</script>

<svg
  class="icon"
  viewBox="0 0 16 16"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if name.startsWith('sidebar')}
    <rect x="1.4" y="2.4" width="13.2" height="11.2" rx="2" />
    {#if name === 'sidebar-left'}
      <path d="M6 2.4v11.2M1.4 4.4a2 2 0 0 1 2-2H6v11.2H3.4a2 2 0 0 1-2-2z" fill="currentColor" />
    {:else if name === 'sidebar-left-off'}
      <path d="M6 2.4v11.2" stroke-dasharray="1.6 1.8" />
    {:else if name === 'sidebar-right'}
      <path d="M10 2.4v11.2M10 2.4h2.6a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H10z" fill="currentColor" />
    {:else}
      <path d="M10 2.4v11.2" stroke-dasharray="1.6 1.8" />
    {/if}
  {:else if name === 'theme-dark'}
    <path d="M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.6 5.6 0 1 0 7 7z" />
  {:else if name === 'theme-light'}
    <circle cx="8" cy="8" r="3.1" />
    <path d="M8 1.3v1.4M8 13.3v1.4M1.3 8h1.4M13.3 8h1.4M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1" />
  {:else if name === 'theme-auto'}
    <circle cx="8" cy="8" r="5.9" />
    <path d="M8 2.1a5.9 5.9 0 0 1 0 11.8z" fill="currentColor" stroke="none" />
  {:else if name === 'keyboard'}
    <rect x="1.3" y="3.6" width="13.4" height="8.8" rx="2" />
    <path d="M4.1 6.4h.01M6.6 6.4h.01M9.1 6.4h.01M11.6 6.4h.01M4.1 9.6h7.5" stroke-width="1.5" />
  {:else if name === 'undo'}
    <path d="M2.4 6.2h6.4a3.9 3.9 0 0 1 0 7.8H5.6" />
    <path d="M5.2 3.2 2.2 6.2l3 3" />
  {:else if name === 'redo'}
    <path d="M13.6 6.2H7.2a3.9 3.9 0 0 0 0 7.8h3.2" />
    <path d="M10.8 3.2l3 3-3 3" />
  {/if}
</svg>

<style>
  .icon { display: block; flex: none; }
</style>
