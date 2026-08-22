import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
export default defineConfig({
  root: 'webview',
  base: './',
  plugins: [svelte()],
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { output: { entryFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' } },
  },
})
