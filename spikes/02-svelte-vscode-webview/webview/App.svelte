<script>
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'
  import { runProbes } from './probes.js'

  let results = $state([])
  let open = $state(false)
  let rpc = $state('pending')
  let counter = $state(0)
  const passed = $derived(results.filter(r => r.ok).length)

  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null

  onMount(async () => {
    // svelte transition below injects a <style> element at runtime → CSP style-src probe
    open = true
    results = await runProbes()
    // restore persisted state (webview state API)
    const prev = vscode?.getState?.()
    results.push({ name: 'webview state API', ok: !!vscode, detail: prev ? `restored ${JSON.stringify(prev)}` : 'no prior state' })
    vscode?.setState?.({ visited: true })
    vscode?.postMessage({ type: 'probes', results: $state.snapshot(results) })
  })

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'ping') { rpc = 'pong received'; vscode?.postMessage({ type: 'pong', echo: e.data.payload }) }
  })
</script>

<main>
  <h1>Svelte {5} in VSCode webview</h1>
  <p class="muted">runes: counter = {counter} · derived passed = {passed}/{results.length}</p>
  <button onclick={() => counter++}>increment (reactivity check)</button>

  {#if open}
    <ul transition:slide>
      {#each results as r}
        <li class:bad={!r.ok}><b>{r.ok ? 'PASS' : 'FAIL'}</b> {r.name} <span class="muted">{r.detail}</span></li>
      {/each}
    </ul>
  {/if}
  <p class="muted">host RPC: {rpc}</p>
</main>

<style>
  main { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); padding: 12px; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .muted { color: var(--vscode-descriptionForeground, #888); font-size: 12px; }
  ul { list-style: none; padding: 0; font-size: 12px; line-height: 1.7; }
  .bad b { color: var(--vscode-errorForeground, #f44); }
  b { color: var(--vscode-testing-iconPassed, #3a3); }
  button { background: var(--vscode-button-background, #06c); color: var(--vscode-button-foreground, #fff);
           border: none; padding: 4px 10px; border-radius: 2px; cursor: pointer; }
</style>
