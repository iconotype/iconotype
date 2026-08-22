import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { assertNoInlineAssets, cspSafeBuild, paperAlias } from '@iconotype/build-config'

export default defineConfig({
  root: 'webview',
  // relative, then rewritten to vscode-webview:// URIs by the extension
  base: './',
  plugins: [svelte(), assertNoInlineAssets()],
  resolve: { alias: { ...paperAlias } },
  build: {
    ...cspSafeBuild,
    outDir: '../dist/webview',
    emptyOutDir: true,
    target: 'es2022',
    /**
     * No content hashes.
     *
     * An extension is installed by replacing a directory, not served with cache
     * headers, so hashes buy nothing — and they cost: reinstalling over a running
     * window leaves an open webview asking for a chunk whose hash just changed, which
     * fails as "Failed to fetch dynamically imported module". Stable names also keep
     * the vsix diff small.
     */
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
