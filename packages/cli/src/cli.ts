import { parseArgs } from 'node:util'
import { build, diff, fix, info, init, lint, scan, type Io } from './commands.js'
import type { ComponentTarget } from '@iconotype/core-export'

const USAGE = `iconotype — icon font toolchain

usage: iconotype <command> [options]

commands:
  init      create a committed .iconotype.json from an existing project or SVG folder
  build     build the font package from a project or a folder of SVGs
  lint      report what the fixer would have to change; non-zero exit on errors
  fix       rewrite source SVGs through the fixer pipeline
  diff      compare two projects; non-zero exit when the change is BREAKING
  scan      find which icons a codebase actually references
  info      summarise a project

common options:
  -i, --input <path>     project .json, IcoMoon .zip, or a directory of .svg  (default: icons)
      --json             machine-readable output
  -h, --help             show this

build options:
      --out <dir>        package everything into this directory. Omit it and a project
                         with an "output" block writes to the paths it names instead.
      --lock <file>      codepoints.lock to read and update            (default: next to --input)
      --formats <list>   woff2,woff,ttf,svg                            (default: woff2,woff,ttf)
      --components <l>   react,vue,svelte,webcomponent,elm
      --sprite           also emit sprite.svg, sprite.png and sprite.css
      --png              also emit one PNG per icon, at 1x and 2x
      --favicon <name>   build a favicon set from that icon
      --types            emit icons.d.ts with a union of every icon name

init options:
      --out <file>       where to write it                (default: <name>.iconotype.json)
      --name <name>      font family, class prefix root   (default: from the source)
      --prefix <p>       class prefix, e.g. app- — this is what autocompletion triggers
                         on. Defaults to the source project's, so existing markup keeps
                         working after an import.
      --fonts-dir <dir>  where a build writes font files  (default: fonts)
      --styles-dir <dir> where a build writes styles      (default: css)
      --style-kind <k>   css | scss-variables | css-variables | dart | …  (default: css)
      --types-file <f>   also emit a .d.ts of every icon name
                         (build's --types is a boolean, hence the different name)

lint options:
      --max-warnings <n> fail when there are more warnings than this

fix options:
      --write            apply the changes (otherwise it is a dry run)
      --simplify <n>     path simplification tolerance                 (default: 0)
      --snap <n>         snap coordinates to an n-unit grid            (default: 0)
      --refit            scale and centre the artwork in the em box

diff options:
      --allow-breaking   report a breaking change but exit 0 anyway

scan options:
      --source <dir>     the codebase to search                        (default: src)
      --fail-on-unused   exit non-zero when an icon is never referenced

examples:
  iconotype init --input icomoon/selection.json --name app \
      --fonts-dir app/fonts --styles-dir app/css --style-kind scss-variables
  iconotype build --input icons --out dist --components svelte --types
  iconotype lint --input icons --max-warnings 0
  iconotype diff dist/selection.json icons --allow-breaking
  iconotype scan --input icons --source src --json
`

const list = (v: string | undefined): string[] | undefined =>
  v === undefined ? undefined : v.split(',').map((s) => s.trim()).filter(Boolean)

export async function run(argv: string[], io: Io): Promise<number> {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    io.log(USAGE)
    return command ? 0 : 1
  }

  let parsed
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        input: { type: 'string', short: 'i' },
        out: { type: 'string' },
        lock: { type: 'string' },
        formats: { type: 'string' },
        components: { type: 'string' },
        favicon: { type: 'string' },
        source: { type: 'string' },
        simplify: { type: 'string' },
        snap: { type: 'string' },
        'max-warnings': { type: 'string' },
        name: { type: 'string' },
        prefix: { type: 'string' },
        'fonts-dir': { type: 'string' },
        'styles-dir': { type: 'string' },
        'style-kind': { type: 'string' },
        'types-file': { type: 'string' },
        sprite: { type: 'boolean' },
        png: { type: 'boolean' },
        types: { type: 'boolean' },
        write: { type: 'boolean' },
        refit: { type: 'boolean' },
        json: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        'allow-breaking': { type: 'boolean' },
        'fail-on-unused': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    io.error(`error: ${(e as Error).message}`)
    return 2
  }

  const { values: v, positionals } = parsed
  if (v.help) {
    io.log(USAGE)
    return 0
  }
  const input = v.input ?? positionals[0] ?? 'icons'
  const num = (s: string | undefined): number | undefined => (s === undefined ? undefined : Number(s))

  try {
    switch (command) {
      case 'init':
        return await init({
          input, out: v.out, name: v.name, prefix: v.prefix,
          fontsDir: v['fonts-dir'], stylesDir: v['styles-dir'], styleKind: v['style-kind'],
          formats: list(v.formats), types: v['types-file'],
        }, io)
      case 'build':
        return await build({
          input, out: v.out, lock: v.lock,
          formats: list(v.formats),
          components: list(v.components) as ComponentTarget[] | undefined,
          sprite: v.sprite, png: v.png, favicon: v.favicon, types: v.types, quiet: v.quiet,
        }, io)
      case 'lint':
        return await lint({ input, json: v.json, maxWarnings: num(v['max-warnings']) }, io)
      case 'fix':
        return await fix({ input, write: v.write, simplify: num(v.simplify), snap: num(v.snap), refit: v.refit }, io)
      case 'diff': {
        const before = v.input ?? positionals[0]
        const after = v.input ? positionals[0] : positionals[1]
        if (!before || !after) {
          io.error('error: diff needs two projects — iconotype diff <before> <after>')
          return 2
        }
        return await diff({ before, after, json: v.json, allowBreaking: v['allow-breaking'] }, io)
      }
      case 'scan':
        return await scan({ input, source: v.source ?? 'src', json: v.json, failOnUnused: v['fail-on-unused'] }, io)
      case 'info':
        return await info({ input, json: v.json }, io)
      default:
        io.error(`error: unknown command "${command}"\n`)
        io.log(USAGE)
        return 2
    }
  } catch (e) {
    io.error(`error: ${(e as Error).message}`)
    return 1
  }
}

/*
 * Entrypoint wiring. The binary is bundled as CJS, not ESM: paper's node shim uses
 * dynamic `require`, which an ESM bundle cannot do — and paper-core carries the same
 * shim as paper-full, so the paper-core alias does not avoid it either. `import.meta`
 * is therefore unavailable here, hence the argv check.
 * The commands themselves are covered by tests that call run() directly.
 */
if (process.argv[1]?.includes('iconotype')) {
  const io: Io = { log: (m) => console.log(m), error: (m) => console.error(m) }
  run(process.argv.slice(2), io).then((code) => { process.exitCode = code })
}

