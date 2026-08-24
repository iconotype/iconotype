import type { Project } from '@iconotype/core-model'
import { PUA_START, firstPath } from '@iconotype/core-model'
import { classNameOf } from '@iconotype/core-font'
import { identifier, pascalCase } from './options.js'
import { iconsOf } from './svg.js'

/**
 * "Now what?" — the integration snippets.
 *
 * A font, a stylesheet and a folder of woff2 files are not an answer to "how do I use
 * this in my app": every build tool wants them in a different place, and the parts that
 * bite (preloading, `font-display: block`, a name that has to survive minification) are
 * never in the export itself. So the app hands out the wiring as well as the files.
 *
 * Every snippet is GENERATED from the project — its family, its class prefix, its own
 * output paths and three of its actual icons — rather than being documentation with
 * `your-font-here` in it. A snippet you have to translate before pasting is a snippet
 * that gets pasted wrong.
 */

export type SnippetTarget =
  | 'html' | 'vite' | 'webpack' | 'next' | 'sprite' | 'react' | 'nativescript' | 'flutter'

export interface Snippet {
  id: string
  label: string
  /** syntax hint for highlighting, and the extension the code would live under */
  lang: 'html' | 'css' | 'scss' | 'js' | 'ts' | 'tsx' | 'xml' | 'yaml' | 'dart' | 'json'
  /** where this belongs, when it belongs somewhere specific */
  file?: string
  code: string
  /** the caveat that costs an afternoon if nobody mentions it */
  note?: string
}

export interface SnippetGroup {
  target: SnippetTarget
  label: string
  blurb: string
  snippets: Snippet[]
}

export interface SnippetIcon {
  name: string
  code: number
  /** the class the generated stylesheet declares for it */
  className: string
}

export interface SnippetOptions {
  /** icons to build the examples around; defaults to the first few in the project */
  icons?: SnippetIcon[]
}

export const SNIPPET_TARGETS: Array<{ id: SnippetTarget; label: string; group: string }> = [
  { id: 'html', label: 'HTML & CSS', group: 'Web' },
  { id: 'sprite', label: 'SVG sprite', group: 'Web' },
  { id: 'vite', label: 'Vite', group: 'Bundler' },
  { id: 'webpack', label: 'webpack', group: 'Bundler' },
  { id: 'next', label: 'Next.js', group: 'Framework' },
  { id: 'react', label: 'React / Vue / Svelte', group: 'Framework' },
  { id: 'nativescript', label: 'NativeScript', group: 'Native' },
  { id: 'flutter', label: 'Flutter', group: 'Native' },
]

const hex = (code: number) => code.toString(16)

/** `directions_walk` → `directions walk`, for an aria-label a person will hear read out */
const humanize = (name: string) => name.replace(/[-_]+/g, ' ')

/** The first codepoint of a name, whether it was allocated as one or as a colour run. */
const codeOf = (project: Project, name: string): number | undefined => {
  const v = project.codepoints[name]
  return Array.isArray(v) ? v[0] : v
}

interface Context {
  family: string
  /** a JS/Dart-safe version of the family, for identifiers */
  className: string
  prefix: string
  /** what the SOURCE writes, when a build step rewrites it — `alpimaps-hiking` */
  usagePrefix: string
  icons: SnippetIcon[]
  /** the stylesheet, as the project's output config places it (or as the zip does) */
  stylePath: string
  /** a stylesheet a BROWSER can link: never the .scss the project may build from */
  cssPath: string
  /** directory the font files land in */
  fontsDir: string
  /** the `{ "hiking": "e900" }` map, when the project emits one */
  jsonPath: string | undefined
  /** the SCSS or LESS variables file, when the project emits one */
  varsPath: string | undefined
  varsSigil: '$' | '@'
  spritePath: string | undefined
  hasTtf: boolean
  propertyPerGlyph: boolean
}

const strip = (p: string) => p.replace(/^\.?\//, '')

function context(project: Project, options: SnippetOptions): Context {
  const prefs = project.preferences.font
  const output = project.output ?? {}
  const styles = output.styles ?? []

  const icons = options.icons ?? sampleIcons(project)
  const sheet = styles.find((s) => s.kind === 'css' || s.kind === 'scss' || s.kind === 'less')
  const plainCss = styles.find((s) => s.kind === 'css')
  const json = styles.find((s) => s.kind === 'json')
  const vars = styles.find((s) => s.kind === 'scss-variables' || s.kind === 'less-variables')

  return {
    family: prefs.family,
    className: pascalCase(prefs.family) || 'Icons',
    prefix: prefs.prefix,
    usagePrefix: prefs.usagePrefixes?.[0] ?? prefs.prefix,
    icons,
    // a snippet points at ONE file; the first destination is the one a reader means
    stylePath: strip(firstPath(sheet?.path, 'style.css')),
    cssPath: strip(firstPath(plainCss?.path, sheet?.kind === 'css' ? firstPath(sheet.path) : 'style.css')),
    fontsDir: strip(firstPath(output.fonts?.dir, 'fonts').replace(/\/*$/, '/')),
    jsonPath: json ? strip(firstPath(json.path)) : undefined,
    varsPath: vars ? strip(firstPath(vars.path)) : undefined,
    varsSigil: vars?.kind === 'less-variables' ? '@' : '$',
    spritePath: output.sprite ? strip(firstPath(output.sprite.path)) : undefined,
    hasTtf: (output.fonts?.formats ?? ['woff2', 'woff', 'ttf']).includes('ttf'),
    propertyPerGlyph: prefs.propertyPerGlyph || (prefs.cssVars && prefs.cssVarsFormat === 'css'),
  }
}

/**
 * Three real icons off the top of the project.
 *
 * Real ones matter more than they sound: the codepoint in the snippet is the codepoint
 * in the font, so a reader can paste the escape into their own CSS and see the glyph,
 * and a wrong prefix or postfix shows up as a class that does not match their sheet.
 */
export function sampleIcons(project: Project, count = 3): SnippetIcon[] {
  const prefs = project.preferences.font
  const entries = iconsOf(project).filter((e) => e.glyph.selected !== false)
  /**
   * Prefer a name that survives being a class.
   *
   * IcoMoon projects carry names like `paper-plane-o, send-o` — a glyph and its alias
   * in one string. Real, but `.icon-paper-plane-o, send-o` is two broken selectors, and
   * a snippet that shows one teaches the wrong thing.
   */
  const safe = entries.filter((e) => /^[a-zA-Z0-9_-]+$/.test(e.glyph.name))
  const picked = (safe.length >= count ? safe : entries).slice(0, count)
  if (!picked.length) {
    // an empty project still deserves a snippet that reads correctly
    return ['home', 'search', 'settings'].slice(0, count).map((name, i) => ({
      name,
      code: PUA_START + i,
      className: classNameOf(prefs, name, i, PUA_START + i),
    }))
  }
  return picked.map(({ glyph }, i) => {
    const code = codeOf(project, glyph.name) ?? PUA_START + i
    return { name: glyph.name, code, className: classNameOf(prefs, glyph.name, i, code) }
  })
}

// ── web ──────────────────────────────────────────────────────────────────────
function htmlSnippets(c: Context): Snippet[] {
  const [first, second] = c.icons
  const icon = first!
  const out: Snippet[] = [
    {
      id: 'html-link',
      label: 'Link the stylesheet',
      lang: 'html',
      file: 'index.html',
      code: [
        '<head>',
        `  <!-- the font is fetched by the stylesheet, so preload it or the icons pop in late -->`,
        `  <link rel="preload" href="${c.fontsDir}${c.family}.woff2" as="font" type="font/woff2" crossorigin>`,
        `  <link rel="stylesheet" href="${c.cssPath}">`,
        '</head>',
        '',
        `<!-- decoration: the button already says what it does -->`,
        `<button>`,
        `  <i class="${icon.className}" aria-hidden="true"></i>`,
        `  ${humanize(icon.name)}`,
        `</button>`,
        '',
        `<!-- the icon IS the label: name it, or a screen reader announces nothing -->`,
        `<button aria-label="${humanize(icon.name)}">`,
        `  <i class="${icon.className}" aria-hidden="true"></i>`,
        `</button>`,
      ].join('\n'),
      note:
        `The generated \`@font-face\` uses \`font-display: block\`, so an icon is invisible — not fallback-glyphed — until the font lands. That is the right trade for icons, and it is why the preload is worth the line. \`crossorigin\` is required on the preload even for same-origin fonts; without it the browser fetches the file twice.`,
    },
    {
      id: 'html-own-css',
      label: 'An icon from your own CSS',
      lang: 'css',
      file: 'app.css',
      code: c.propertyPerGlyph
        ? [
            `/* the stylesheet declares --${c.prefix}${icon.name} on :root */`,
            `.menu-toggle::before {`,
            `  content: var(--${c.prefix}${icon.name});`,
            `  font-family: '${c.family}';`,
            `  margin-right: .4em;`,
            `}`,
          ].join('\n')
        : [
            `.menu-toggle::before {`,
            `  content: "\\${hex(icon.code)}";   /* ${icon.name} */`,
            `  font-family: '${c.family}';`,
            `  font-weight: normal;`,
            `  margin-right: .4em;`,
            `}`,
          ].join('\n'),
      note: c.propertyPerGlyph
        ? undefined
        : `Hardcoding \`\\${hex(icon.code)}\` ties this rule to one codepoint. Turn on "a custom property per glyph" in the font preferences and the stylesheet emits \`--${c.prefix}${icon.name}\`, which survives a re-ordered font.`,
    },
  ]

  if (second) {
    out.push({
      id: 'html-inline',
      label: 'Without any class (raw codepoint)',
      lang: 'html',
      code: [
        `<!-- the character itself, when a class is inconvenient (email, a CMS field) -->`,
        `<span style="font-family: '${c.family}'">&#x${hex(second.code)};</span>  <!-- ${second.name} -->`,
      ].join('\n'),
      note: `Copy the same thing for any icon from the Quick copy panel. Private Use Area codepoints carry no meaning to anything but this font — if the font fails to load the reader gets an empty box, which is why the class-based markup above hides it from assistive tech instead.`,
    })
  }
  return out
}

function spriteSnippets(c: Context): Snippet[] {
  const icon = c.icons[0]!
  const path = c.spritePath ?? 'sprite.svg'
  return [
    {
      id: 'sprite-use',
      label: 'Reference a symbol',
      lang: 'html',
      code: [
        `<svg class="icon" aria-hidden="true"><use href="/${path}#${c.prefix}${icon.name}"></use></svg>`,
        '',
        `<!-- with a name, when the icon is the only label -->`,
        `<svg class="icon" role="img" aria-label="${humanize(icon.name)}">`,
        `  <use href="/${path}#${c.prefix}${icon.name}"></use>`,
        `</svg>`,
      ].join('\n'),
    },
    {
      id: 'sprite-css',
      label: 'Size and colour',
      lang: 'css',
      code: [
        `.icon {`,
        `  width: 1em; height: 1em;   /* scales with the surrounding text */`,
        `  fill: currentColor;        /* takes the text colour, like a font icon does */`,
        `  vertical-align: -.125em;   /* sits on the baseline rather than above it */`,
        `}`,
      ].join('\n'),
      note: `The sprite route has no font to load, no FOIT and no Private Use Area — and multicolour artwork keeps its own fills. The cost is a request (or an inlined blob) and that \`<use href>\` across origins is blocked: serve the sprite from your own domain, or inline the file into the page and reference \`#${c.prefix}${icon.name}\` with no path.`,
    },
  ]
}

// ── bundlers ─────────────────────────────────────────────────────────────────
/**
 * The name-to-codepoint rewrite, in whichever tool asked for it.
 *
 * Writing `alpimaps-hiking` in a component and having the build turn it into the
 * literal glyph is the least-known way to use an icon font and the most pleasant: no
 * class, no wrapper element, no runtime lookup, and a name that a grep can still find.
 * It needs a name→codepoint map, which is what the project's JSON output is for.
 */
const mapImportNote = (c: Context): string =>
  c.jsonPath
    ? `Reads \`${c.jsonPath}\`, the JSON output this project already writes — regenerate the font and the map moves with it.`
    : `This needs a name→codepoint map. Add a \`json\` output to the project (Export ▸ outputs) and it writes \`{ "${c.icons[0]!.name}": "${hex(c.icons[0]!.code)}" }\`; parsing the SCSS variables instead works but breaks on every formatting change.`

function viteSnippets(c: Context): Snippet[] {
  const json = c.jsonPath ?? 'src/icons/icons.json'
  const out: Snippet[] = [
    {
      id: 'vite-import',
      label: 'Load the stylesheet',
      lang: 'ts',
      file: 'src/main.ts',
      code: [
        `// a leading slash resolves from the Vite project root, whatever the file's depth`,
        `import '/${c.stylePath}'`,
      ].join('\n'),
      note: `Two ways round, and mixing them is the usual bug. Keep the stylesheet and \`${c.fontsDir}\` under \`src/\` and import it — Vite rewrites the \`url()\`s and hashes the fonts. Or put both in \`public/\` and link the sheet from \`index.html\`, in which case the paths must be absolute (\`/${c.fontsDir}${c.family}.woff2\`) and nothing is hashed.`,
    },
  ]

  if (c.varsPath) {
    out.push({
      id: 'vite-scss',
      label: 'SCSS variables everywhere',
      lang: 'ts',
      file: 'vite.config.ts',
      code: [
        `export default defineConfig({`,
        `  css: {`,
        `    preprocessorOptions: {`,
        `      scss: {`,
        `        // every .scss file gets the icon variables without importing them`,
        `        additionalData: '@use "${c.varsPath.replace(/\.[a-z]+$/, '')}" as *;',`,
        `      },`,
        `    },`,
        `  },`,
        `})`,
      ].join('\n'),
      note: `\`@use\` has to come first in a file, which is exactly where \`additionalData\` puts it. Then \`content: ${c.varsSigil}${c.prefix}${c.icons[0]!.name};\` resolves in any stylesheet.`,
    })
  }

  out.push({
    id: 'vite-codepoints',
    label: 'Rewrite icon names to glyphs at build time',
    lang: 'ts',
    file: 'vite.config.ts',
    code: [
      `import { defineConfig, type Plugin } from 'vite'`,
      `import icons from './${json}'`,
      ``,
      `/** \`${c.usagePrefix}${c.icons[0]!.name}\` in any source file becomes the glyph itself. */`,
      `const codepoints = (): Plugin => ({`,
      `  name: 'iconotype-codepoints',`,
      `  enforce: 'pre',`,
      `  transform(code, id) {`,
      `    if (id.includes('node_modules') || !/\\.(ts|js|svelte|vue|jsx|tsx|scss|css)$/.test(id)) return`,
      `    const out = code.replace(/${c.usagePrefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([a-z0-9_-]+)/g, (match, name) =>`,
      `      icons[name] ? String.fromCodePoint(parseInt(icons[name], 16)) : match)`,
      `    return out === code ? null : { code: out, map: null }`,
      `  },`,
      `})`,
      ``,
      `export default defineConfig({ plugins: [codepoints()] })`,
    ].join('\n'),
    note: `${mapImportNote(c)} It is a blind text replacement: anything spelled \`${c.usagePrefix}…\` is rewritten, including inside comments, urls and unrelated strings — keep the file filter tight, and keep the prefix distinctive. \`map: null\` drops the source map for touched files; the offsets barely move, but if you care, use \`magic-string\`.`,
  })
  return out
}

function webpackSnippets(c: Context): Snippet[] {
  const json = c.jsonPath ?? 'src/icons/icons.json'
  const out: Snippet[] = [
    {
      id: 'webpack-fonts',
      label: 'Emit the font files',
      lang: 'js',
      file: 'webpack.config.js',
      code: [
        `module.exports = {`,
        `  module: {`,
        `    rules: [`,
        `      { test: /\\.css$/i, use: ['style-loader', 'css-loader'] },`,
        `      {`,
        `        // the stylesheet's url()s resolve to real emitted files`,
        `        test: /\\.(woff2?|ttf|eot)$/i,`,
        `        type: 'asset/resource',`,
        `        generator: { filename: '${c.fontsDir}[name][ext]' },`,
        `      },`,
        `    ],`,
        `  },`,
        `}`,
      ].join('\n'),
      note: `Keep the generator filename in the same shape as \`${c.fontsDir}\`, or the paths inside \`${c.stylePath}\` stop matching what webpack emitted. If the SVG font format is in the export, exclude it from your generic \`svg\` rule — it is a font, not an image.`,
    },
  ]

  if (c.varsPath) {
    out.push({
      id: 'webpack-scss',
      label: 'SCSS variables everywhere',
      lang: 'js',
      file: 'webpack.config.js',
      code: [
        `{`,
        `  test: /\\.scss$/,`,
        `  use: [`,
        `    'style-loader',`,
        `    'css-loader',`,
        `    {`,
        `      loader: 'sass-loader',`,
        `      options: { additionalData: '@use "${c.varsPath.replace(/\.[a-z]+$/, '')}" as *;' },`,
        `    },`,
        `  ],`,
        `}`,
      ].join('\n'),
    })
  }

  out.push({
    id: 'webpack-codepoints',
    label: 'Rewrite icon names to glyphs at build time',
    lang: 'js',
    file: 'webpack.config.js',
    code: [
      `const icons = require('./${json}')`,
      ``,
      `// \`${c.usagePrefix}${c.icons[0]!.name}\` in any source file becomes the glyph itself`,
      `{`,
      `  test: /\\.(ts|js|scss|css|svelte|vue)$/,`,
      `  exclude: /node_modules/,`,
      `  use: [{`,
      `    loader: 'string-replace-loader',`,
      `    options: {`,
      `      search: '${c.usagePrefix}([a-z0-9_-]+)',`,
      `      flags: 'g',`,
      `      replace: (match, name) =>`,
      `        icons[name] ? String.fromCodePoint(parseInt(icons[name], 16)) : match,`,
      `    },`,
      `  }],`,
      `}`,
    ].join('\n'),
    note: `${mapImportNote(c)} \`String.fromCodePoint\` rather than \`fromCharCode\`: identical below U+FFFF, correct above it, and the Private Use Area planes start there. Same caveat as everywhere — it is a text replacement over whole files, so keep \`exclude\` and \`test\` honest.`,
  })
  return out
}

// ── frameworks ───────────────────────────────────────────────────────────────
function nextSnippets(c: Context): Snippet[] {
  const icon = c.icons[0]!
  return [
    {
      id: 'next-layout',
      label: 'Import it once, in the root layout',
      lang: 'tsx',
      file: 'app/layout.tsx',
      code: [
        `import './${c.stylePath}'`,
        ``,
        `export default function RootLayout({ children }: { children: React.ReactNode }) {`,
        `  return (`,
        `    <html lang="en">`,
        `      <head>`,
        `        <link`,
        `          rel="preload"`,
        `          href="/${c.fontsDir}${c.family}.woff2"`,
        `          as="font"`,
        `          type="font/woff2"`,
        `          crossOrigin="anonymous"`,
        `        />`,
        `      </head>`,
        `      <body>{children}</body>`,
        `    </html>`,
        `  )`,
        `}`,
      ].join('\n'),
      note: `Put \`${c.fontsDir}\` under \`public/\` and the \`url()\`s in the stylesheet resolve as \`/${c.fontsDir}…\` with no bundler involvement. Global CSS can only be imported from the root layout in the App Router — an import in a page is a build error. \`next/font/local\` is the other route, but it declares its own \`@font-face\`, so you would strip that block out of the generated sheet and keep only the class rules; one source of truth is worth more than the automatic preload it buys you.`,
    },
    {
      id: 'next-usage',
      label: 'Use it in a component',
      lang: 'tsx',
      code: [
        `export function ${pascalCase(icon.name)}Button() {`,
        `  return (`,
        `    <button aria-label="${humanize(icon.name)}">`,
        `      <i className="${icon.className}" aria-hidden="true" />`,
        `    </button>`,
        `  )`,
        `}`,
      ].join('\n'),
    },
  ]
}

function reactSnippets(c: Context): Snippet[] {
  const icon = c.icons[0]!
  const name = c.className
  return [
    {
      id: 'component-react',
      label: 'React',
      lang: 'tsx',
      code: [
        `import { ${name} } from './icons'`,
        ``,
        `<${name} name="${icon.name}" size={20} />                    {/* decoration */}`,
        `<${name} name="${icon.name}" title="${humanize(icon.name)}" />   {/* labelled */}`,
      ].join('\n'),
      note: `Export ▸ components writes this file: one component holding every icon's path data, switching on \`name\`. With a literal name the bundler tree-shakes the rest away; with a computed one (\`name={row.icon}\`) the whole map ships, which for a few dozen icons is still smaller than a font.`,
    },
    {
      id: 'component-vue',
      label: 'Vue',
      lang: 'html',
      code: [
        `<script setup lang="ts">`,
        `import ${name} from './icons.vue'`,
        `</script>`,
        ``,
        `<template>`,
        `  <${name} name="${icon.name}" :size="20" />`,
        `</template>`,
      ].join('\n'),
    },
    {
      id: 'component-svelte',
      label: 'Svelte',
      lang: 'html',
      code: [
        `<script lang="ts">`,
        `  import ${name} from './${name}.svelte'`,
        `</script>`,
        ``,
        `<${name} name="${icon.name}" size={20} />`,
      ].join('\n'),
      note: `The SVG components need no font, no codepoints and no stylesheet — the artwork is inlined and takes \`currentColor\`. Reach for them when the icons are few, and for the font when they are many or when they have to appear inside a \`::before\` you do not control.`,
    },
  ]
}

// ── native ───────────────────────────────────────────────────────────────────
function nativescriptSnippets(c: Context): Snippet[] {
  const icon = c.icons[0]!
  /** the fonticon plugin keys its stylesheets by the class prefix, dash and all stripped */
  const key = c.prefix.replace(/[^a-zA-Z0-9]+$/, '') || 'icon'
  const sheet = c.cssPath.split('/').pop()!
  const out: Snippet[] = [
    {
      id: 'ns-css',
      label: 'Declare the font',
      lang: 'css',
      file: 'app/app.css',
      code: [
        `/* the file lives at app/fonts/${c.family}.ttf — NativeScript finds it by convention */`,
        `.icon {`,
        `  font-family: '${c.family}';`,
        `  font-weight: normal;`,
        `  font-style: normal;`,
        `}`,
      ].join('\n'),
      note: `${c.hasTtf ? '' : 'Turn TTF on in the export formats first — '}NativeScript loads \`.ttf\`/\`.otf\` only, never woff2, and only from \`app/fonts/\` (\`src/fonts/\` on newer templates). iOS resolves the font by the family name inside the file and Android by the file name, so keeping the file named \`${c.family}.ttf\` for family \`${c.family}\` makes one declaration work on both.`,
    },
    {
      id: 'ns-markup',
      label: 'Use it in markup',
      lang: 'xml',
      code: [
        `<!-- XML: the codepoint as a character entity -->`,
        `<Label class="icon" text="&#x${hex(icon.code)};" />`,
        ``,
        `<!-- Svelte / Vue flavours: same character, from code -->`,
        `<label class="icon" text={String.fromCodePoint(0x${hex(icon.code)})} />`,
      ].join('\n'),
      note: `\`::before\` content does not exist on a native \`Label\` — the glyph goes in \`text\`, not in a pseudo-element. That is why the codepoint matters here and the class does not.`,
    },
    {
      id: 'ns-fonticon',
      label: 'By name, with the fonticon plugin',
      lang: 'ts',
      file: 'app.ts',
      code: [
        `import { Application } from '@nativescript/core'`,
        `import { FontIcon, fonticon } from '@nativescript-community/fonticon'`,
        ``,
        `// the plugin reads the generated stylesheet and maps each class to its glyph`,
        `FontIcon.paths = { ${key}: '${sheet}' }`,
        `FontIcon.loadCss()`,
        `Application.setResources({ fonticon })`,
      ].join('\n'),
      note: `Then \`<Label class="icon" text="{{ '${icon.className}' | fonticon }}" />\`. The key in \`paths\` is the class prefix without its dash, so \`${key}\` matches \`${icon.className}\`; the value is \`${sheet}\` copied into \`app/\` — it parses CSS, so point it at a built stylesheet rather than at SCSS source. It costs a stylesheet parse at startup, and earns it when the icon names are data — a menu whose rows carry \`icon: '${icon.name}'\` — rather than literals you could have inlined at build time.`,
    },
  ]
  return out
}

function flutterSnippets(c: Context): Snippet[] {
  const icon = c.icons[0]!
  return [
    {
      id: 'flutter-pubspec',
      label: 'Declare the font',
      lang: 'yaml',
      file: 'pubspec.yaml',
      code: [
        `flutter:`,
        `  fonts:`,
        `    - family: ${c.family}`,
        `      fonts:`,
        `        - asset: ${c.fontsDir}${c.family}.ttf`,
      ].join('\n'),
      note: `${c.hasTtf ? '' : 'Turn TTF on in the export formats first — '}Flutter reads \`.ttf\` and \`.otf\`. The \`family\` here is the string the generated Dart class references, so the two have to agree; both come from the project's font family, so they do.`,
    },
    {
      id: 'flutter-usage',
      label: 'Use it',
      lang: 'dart',
      code: [
        `import 'icons.dart';   // the project's Dart output`,
        ``,
        `Icon(${c.className}.${identifier(icon.name)}, size: 24)`,
        ``,
        `IconButton(`,
        `  icon: const Icon(${c.className}.${identifier(icon.name)}),`,
        `  tooltip: '${humanize(icon.name)}',`,
        `  onPressed: () {},`,
        `)`,
      ].join('\n'),
      note: `Flutter's \`--tree-shake-icons\` (on by default in release builds) keeps only the \`IconData\` constants it can see at compile time — which is what the generated class emits. Build an \`IconData\` from a variable codepoint instead and the whole font ships.`,
    },
  ]
}

const BUILDERS: Record<SnippetTarget, (c: Context) => Snippet[]> = {
  html: htmlSnippets,
  sprite: spriteSnippets,
  vite: viteSnippets,
  webpack: webpackSnippets,
  next: nextSnippets,
  react: reactSnippets,
  nativescript: nativescriptSnippets,
  flutter: flutterSnippets,
}

const BLURBS: Record<SnippetTarget, string> = {
  html: 'A page, a stylesheet and a font folder. Everything else is a variation on this.',
  sprite: 'No font at all: one SVG file of symbols, referenced by id.',
  vite: 'Where the files go, and how to make icon names disappear into glyphs at build time.',
  webpack: 'Font emission, SCSS variables, and the name-to-glyph rewrite.',
  next: 'App Router: the stylesheet belongs to the root layout, the fonts to public/.',
  react: 'The generated SVG components — no font, no codepoints.',
  nativescript: 'TTF in app/fonts, and the glyph in `text` rather than in a pseudo-element.',
  flutter: 'pubspec declares the family; the generated Dart class holds the codepoints.',
}

/** Every snippet for one target, with the project's own names, paths and codepoints in it. */
export function buildSnippets(
  project: Project, target: SnippetTarget, options: SnippetOptions = {},
): SnippetGroup {
  const c = context(project, options)
  const meta = SNIPPET_TARGETS.find((t) => t.id === target)!
  return { target, label: meta.label, blurb: BLURBS[target], snippets: BUILDERS[target](c) }
}

/** All of them, for the CLI and for writing a USAGE.md next to an export. */
export function buildAllSnippets(project: Project, options: SnippetOptions = {}): SnippetGroup[] {
  return SNIPPET_TARGETS.map((t) => buildSnippets(project, t.id, options))
}

/** The same content as one Markdown document — what ships beside a downloaded package. */
export function snippetsMarkdown(project: Project, options: SnippetOptions = {}): string {
  const family = project.preferences.font.family
  const lines = [`# Using ${family}`, '', `Generated by Iconotype from this project — the paths, class names and codepoints below are the real ones.`, '']
  for (const group of buildAllSnippets(project, options)) {
    lines.push(`## ${group.label}`, '', group.blurb, '')
    for (const s of group.snippets) {
      lines.push(`### ${s.label}`, '')
      if (s.file) lines.push(`\`${s.file}\``, '')
      lines.push('```' + s.lang, s.code, '```', '')
      if (s.note) lines.push(s.note, '')
    }
  }
  return lines.join('\n')
}
