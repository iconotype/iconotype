<script lang="ts">
  /**
   * A highlighted snippet.
   *
   * Tokens are rendered as elements, never as an HTML string: the code these blocks
   * show is built from a project's own family name and file paths, and `{@html}` on
   * that would be an injection hole in exchange for nothing.
   */
  import { highlight } from './lib/highlight.js'

  let { code, lang = 'plain' }: { code: string; lang?: string } = $props()
  const tokens = $derived(highlight(code, lang))
</script>

<pre><code>{#each tokens as token}<span class={token.kind}>{token.text}</span>{/each}</code></pre>

<style>
  pre {
    margin: 0; padding: 10px 12px; overflow-x: auto;
    background: var(--gs-input); border: 1px solid var(--gs-border); border-radius: var(--gs-radius);
  }
  code { font: 11px/1.5 var(--gs-mono); white-space: pre; }
  /*
   * Hues, not a theme: each kind takes a token that already exists in both light and
   * dark, so a snippet reads the same way in either without a second palette to keep
   * in sync.
   */
  .comment { color: var(--gs-code-comment, var(--gs-muted)); font-style: italic; }
  .string { color: var(--gs-code-string); }
  .keyword { color: var(--gs-code-keyword); }
  .number { color: var(--gs-code-number); }
  .tag { color: var(--gs-code-tag); }
  .attr { color: var(--gs-code-attr); }
  .property { color: var(--gs-code-property); }
  .plain { color: inherit; }
</style>
