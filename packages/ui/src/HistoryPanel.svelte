<script lang="ts">
  /**
   * The undo timeline.
   *
   * Its first node is not an edit — it is where the document came in, "Reopen alpimaps"
   * and the like. Listing that beside real actions reads as though opening a file were
   * something you did TO the icons, so it is drawn as an origin instead: muted, and
   * absent entirely until there is an edit to go back from.
   */
  import { useSession } from './session.svelte.js'
  const session = useSession()

  const origin = $derived(session.timeline[0])
  const steps = $derived(session.timeline.slice(1))
</script>

<aside>
  <h2>History</h2>
  <ol>
    {#if origin && steps.length}
      <li>
        <button class="entry origin" class:current={origin.current} onclick={() => session.goto(origin.id)}>
          <span class="n"></span>as opened
        </button>
        {#if origin.branchCount > 0}<span class="branch" title="alternative branches">⑂{origin.branchCount}</span>{/if}
      </li>
    {/if}
    {#each steps as node, i (node.id)}
      <li>
        <button class="entry" class:current={node.current} onclick={() => session.goto(node.id)}>
          <span class="n">{i + 1}.</span>{node.label}
        </button>
        {#if node.branchCount > 0}<span class="branch" title="alternative branches">⑂{node.branchCount}</span>{/if}
      </li>
    {/each}
    {#if !steps.length}<li><span class="empty">No edits yet.</span></li>{/if}
  </ol>

  {#if session.branches.length}
    <h2>Branches</h2>
    <ul>
      {#each session.branches as b (b.from.id)}
        {#each b.alternatives as alt (alt.id)}
          <li><button class="entry" onclick={() => session.goto(alt.id)}>⑂ {alt.label}</button></li>
        {/each}
      {/each}
    </ul>
  {/if}
</aside>

<style>
  aside { border-left: var(--gs-divider); padding: 12px; overflow: auto; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--gs-muted); margin: 4px 0 8px; }
  ol, ul { list-style: none; margin: 0 0 16px; padding: 0; }
  li { display: flex; align-items: center; gap: 4px; }
  .entry {
    flex: 1; text-align: left; background: transparent; color: var(--gs-fg);
    border: none; padding: 3px 6px; border-radius: var(--gs-radius); font-size: 12px;
  }
  .entry:hover { background: var(--gs-hover); }
  .current { background: var(--gs-active); }
  .n { color: var(--gs-muted); display: inline-block; min-width: 16px; }
  .origin { color: var(--gs-muted); font-style: italic; }
  .empty { color: var(--gs-muted); font-size: 12px; padding: 3px 6px; }
  .branch { color: var(--gs-muted); font-size: 11px; }
</style>
