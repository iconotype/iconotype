<script lang="ts">
  /**
   * The shortcut list.
   *
   * Every one of these exists whether or not it is written down; the difference is
   * whether anyone finds it. Shown per mode, because half of them do not apply in the
   * other one and a list of twenty is a list nobody reads.
   */
  let { mode, onClose }: { mode: 'browse' | 'edit'; onClose: () => void } = $props()

  const browse: Array<[string, string]> = [
    ['/', 'Search'],
    ['click', 'Select an icon'],
    ['⌘ click', 'Add to the selection'],
    ['⇧ click', 'Select a range'],
    ['double-click, E', 'Edit the icon'],
    ['space', 'Include / exclude the selection'],
    ['⌘A', 'Select all'],
    ['⌘O', 'Import files'],
    ['⌘K', 'Find icons in the open libraries'],
  ]

  const edit: Array<[string, string]> = [
    ['[ ]', 'Previous / next icon'],
    ['← → ↑ ↓', 'Nudge (⇧ bigger, ⌥ one unit)'],
    ['+ − 0', 'Zoom in / out / reset'],
    ['G, M', 'Grid, metrics'],
    ['esc', 'Back to the grid'],
  ]

  const always: Array<[string, string]> = [
    ['⌘Z, ⇧⌘Z', 'Undo, redo'],
    ['⌘1, ⌘2', 'Toggle the side panels'],
    ['?', 'This list'],
  ]
</script>

<div class="scrim">
  <button class="backdrop" aria-label="Close" onclick={onClose}></button>
  <div class="card" role="dialog" aria-label="Keyboard shortcuts">
    <h2>Keyboard</h2>
    <div class="cols">
      <section>
        <h3>{mode === 'edit' ? 'Editing' : 'Browsing'}</h3>
        {#each mode === 'edit' ? edit : browse as [keys, what]}
          <p><kbd>{keys}</kbd><span>{what}</span></p>
        {/each}
      </section>
      <section>
        <h3>Anywhere</h3>
        {#each always as [keys, what]}
          <p><kbd>{keys}</kbd><span>{what}</span></p>
        {/each}
      </section>
    </div>
    <button class="ghost" onclick={onClose}>Close</button>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; }
  /*
   * The hover rule has to be here.
   * `button:hover:not(:disabled)` in the theme is more specific than a bare `.backdrop`,
   * so the invisible click-catcher lit up accent-purple the moment the pointer left the
   * dialog — the whole page flashing violet as you moved the mouse away.
   */
  .backdrop, .backdrop:hover { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); border: 0; cursor: default; }
  .card {
    position: relative; min-width: 420px; max-width: 90vw; display: grid; gap: 12px;
    padding: 18px; border-radius: var(--gs-radius-lg); border: 1px solid var(--gs-border);
    background: var(--gs-surface); box-shadow: var(--gs-shadow, 0 20px 60px rgba(0,0,0,.4));
  }
  h2 { margin: 0; font-size: calc(var(--gs-size) + 2px); }
  h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--gs-muted); }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  p { display: grid; grid-template-columns: 120px 1fr; gap: 8px; margin: 0 0 4px; font-size: var(--gs-size-sm); }
  kbd {
    font-family: var(--gs-mono); font-size: 10px; text-align: center;
    padding: 2px 6px; border-radius: var(--gs-radius);
    background: var(--gs-surface-2); border: 1px solid var(--gs-border);
  }
  .card > .ghost { justify-self: end; }
</style>
