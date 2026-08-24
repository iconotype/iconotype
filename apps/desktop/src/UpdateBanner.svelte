<script lang="ts">
  /**
   * "There is a new version."
   *
   * Desktop only, and deliberately not in the shared UI: the web build updates by
   * being reloaded and the extension updates through the marketplace, so an update
   * banner there would be a lie in two shells out of three.
   *
   * Nothing happens without a click. A tool that replaces itself mid-edit, on a
   * document held in memory, is a tool that loses work — so the download is asked for,
   * and the relaunch after it is asked for again.
   */
  import { check, type Update } from '@tauri-apps/plugin-updater'
  import { relaunch } from '@tauri-apps/plugin-process'
  import { onMount } from 'svelte'

  let { onError }: { onError?: (message: string) => void } = $props()

  let update = $state.raw<Update | null>(null)
  let stage = $state<'idle' | 'downloading' | 'ready'>('idle')
  let progress = $state(0)
  let dismissed = $state(false)

  onMount(() => {
    // after the window has settled: a check on the first frame competes with the
    // project load for the same network and the same attention
    const timer = setTimeout(() => void look(), 4000)
    return () => clearTimeout(timer)
  })

  async function look() {
    try {
      update = await check()
    } catch (e) {
      /**
       * Silent on purpose.
       *
       * Offline, behind a proxy, or built without updater configuration — all three
       * are normal, none is the user's problem, and none of them should interrupt
       * someone drawing an icon. Only a failure they ASKED for gets reported.
       */
      console.debug('update check failed', e)
    }
  }

  async function install() {
    if (!update) return
    stage = 'downloading'
    let total = 0
    let received = 0
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        else if (event.event === 'Progress') {
          received += event.data.chunkLength
          progress = total ? Math.min(100, Math.round((received / total) * 100)) : 0
        }
      })
      stage = 'ready'
    } catch (e) {
      stage = 'idle'
      onError?.(`update failed: ${(e as Error).message}`)
    }
  }
</script>

{#if update && !dismissed}
  <div class="update" role="status">
    {#if stage === 'ready'}
      <strong>Iconotype {update.version} is installed.</strong>
      <span class="muted">Save your work — restarting closes this window.</span>
      <span class="spacer"></span>
      <button class="ghost" onclick={() => void relaunch()}>Restart now</button>
      <button class="ghost" onclick={() => (dismissed = true)}>On next launch</button>
    {:else if stage === 'downloading'}
      <strong>Downloading {update.version}…</strong>
      <span class="muted">{progress}%</span>
      <span class="spacer"></span>
    {:else}
      <strong>Iconotype {update.version} is available.</strong>
      <span class="muted">You have {update.currentVersion}.</span>
      <span class="spacer"></span>
      <button class="ghost" onclick={() => void install()}>Download</button>
      <button class="ghost" onclick={() => (dismissed = true)}>Later</button>
    {/if}
  </div>
{/if}

<style>
  .update {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; font-size: var(--gs-size-sm);
    background: var(--gs-accent-weak); border-bottom: 1px solid var(--gs-border);
  }
  .muted { color: var(--gs-muted); }
  .spacer { flex: 1; }
</style>
