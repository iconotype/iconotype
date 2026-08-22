import { defineConfig } from 'vite'
export default defineConfig({
  resolve: { alias: process.env.CORE_ALIAS ? { paper: 'paper/dist/paper-core.js' } : {} },
  build: {
    lib: { entry: 'bundle/entry.js', formats: ['es'], fileName: 'core' },
    outDir: process.env.CORE_ALIAS ? 'dist-core' : 'dist-full',
    minify: 'terser', reportCompressedSize: true, emptyOutDir: true,
  },
})
