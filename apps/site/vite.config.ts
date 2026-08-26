import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

/**
 * The demo loop, served from where it is recorded.
 *
 * The GIF is here for somewhere to point at rather than for the page, which uses the
 * mp4: a forum that takes a URL and not an upload needs one that will not move, and a
 * link to a file in a git host is a link that breaks the day the branch is renamed.
 *
 * `docs/media` is the one copy of these files — the README points at them and so does
 * this page. Copying them into `public/` would put a second megabyte of binary in the
 * repository that silently goes stale the next time the video is re-cut, so they are
 * served from there in dev and emitted at build instead.
 */
const media = (files: string[]): Plugin => {
  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../../docs/media/${name}`, import.meta.url)))
  const TYPES: Record<string, string> = {
    mp4: 'video/mp4', jpg: 'image/jpeg', gif: 'image/gif', png: 'image/png',
  }
  return {
    name: 'iconotype-media',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = files.find((f) => req.url?.split('?')[0].endsWith(`/${f}`))
        if (!name) return next()
        res.setHeader('content-type', TYPES[name.split('.').pop()!] ?? 'application/octet-stream')
        res.end(read(name))
      })
    },
    generateBundle() {
      for (const name of files) this.emitFile({ type: 'asset', fileName: name, source: read(name) })
    },
  }
}

/**
 * The JSON schema every `.iconotype.json` points at, served from the one copy on disk.
 *
 * `$schema` in a generated file is a promise to whoever opens it later — their editor,
 * their CI, a stranger reading the diff — so the URL has to resolve. It named a domain
 * that was never registered, which is worse than naming nothing: tooling reports a
 * fetch failure rather than "no schema".
 *
 * The path carries the version (`iconfont-1.json`) because the URL must keep meaning
 * the same thing forever; `ICONFONT_SCHEMA_URL` in core-io is the other half of this
 * and the two have to agree. The extension keeps registering its local copy, so
 * validation inside VS Code never depended on the network and still does not.
 */
const schema = (): Plugin => {
  const source = () =>
    readFileSync(fileURLToPath(new URL('../vscode/schema/iconfont.schema.json', import.meta.url)))
  const path = 'schema/iconfont-1.json'
  return {
    name: 'iconotype-schema',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0].endsWith(`/${path}`)) return next()
        res.setHeader('content-type', 'application/schema+json')
        res.end(source())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: path, source: source() })
    },
  }
}

/**
 * The product page.
 *
 * No framework: it is one document, and every kilobyte of JavaScript here is a
 * kilobyte spent before anyone has seen what the thing does. `BASE_PATH` matches the
 * Pages subpath, and the app is deployed underneath it at `app/`.
 */
/**
 * One page per thing people search for.
 *
 * Directory-shaped entries, so the URLs are `/icomoon-alternative/` rather than
 * `/icomoon-alternative.html`, and every link between them can stay relative — which is
 * what lets the whole site move under the Pages subpath without rewriting anything.
 */
const page = (name: string) => fileURLToPath(new URL(`./${name}/index.html`, import.meta.url))

export default defineConfig({
  plugins: [media(['demo.mp4', 'demo.gif', 'demo-poster.jpg', 'social-preview.png']), schema()],
  base: process.env.BASE_PATH ?? '/',
  build: {
    target: 'es2022',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: page('.'),
        icomoon: page('icomoon-alternative'),
        fontello: page('fontello-alternative'),
        svg: page('svg-to-icon-font'),
      },
    },
  },
})
