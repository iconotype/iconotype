import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { assertNoInlineAssets, cspSafeBuild, paperAlias } from '@iconotype/build-config'

/**
 * The desktop frontend. Same UI package as the web app, different Host.
 *
 * Tauri serves this from a fixed dev port and expects a relative base in the bundle,
 * because the production window loads it from `tauri://localhost`, not from a server.
 */
export default defineConfig({
  base: './',
  plugins: [svelte(), assertNoInlineAssets()],
  resolve: { alias: { ...paperAlias } },
  clearScreen: false,
  server: { port: 5179, strictPort: true },
  build: { ...cspSafeBuild, target: 'es2022', sourcemap: true },
})
