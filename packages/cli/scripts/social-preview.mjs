import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

/** paths off this file, not off the working directory, so it runs from anywhere */
const repo = (path) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

/**
 * The GitHub social preview: 1280×640, the size GitHub asks for and Twitter, Slack and
 * every other unfurl reuses. Drawn from the project's own parts — the mark, and real
 * glyphs out of the alpimaps fixture — because a card for an icon tool that shows no
 * icons is a card about nothing.
 */
const W = 1280, H = 640
const fixture = JSON.parse(readFileSync(repo('fixtures/icomoon/alpimaps.json'), 'utf8'))

/** a handful of recognisable glyphs, in the coordinate space their set declares */
const WANTED = ['hiking', 'mountain-biking', 'roundabout', 'compass-calibrate', 'u-turn', 'running', 'flag-checkered', 'up-arrow']
const glyphs = []
for (const set of fixture.iconSets) {
  const height = set.height ?? 1024
  for (const sel of set.selection) {
    const name = sel.name
    if (!WANTED.includes(name) || glyphs.some((g) => g.name === name)) continue
    // IcoMoon joins icons[] to selection[] BY ID, not by position — see icomoon-export
    const icon = set.icons.find((candidate) => candidate.id === sel.id)
    if (!icon?.paths?.length) continue
    glyphs.push({ name, height, d: icon.paths.join(' ') })
  }
}
glyphs.sort((a, b) => WANTED.indexOf(a.name) - WANTED.indexOf(b.name))

const SIZE = 74, GAP = 34
const row = glyphs.slice(0, 8)
const rowWidth = row.length * SIZE + (row.length - 1) * GAP
const rowX = (W - rowWidth) / 2
const rowY = 452

const strip = row.map((g, i) => {
  const scale = SIZE / g.height
  const x = rowX + i * (SIZE + GAP)
  return `<g transform="translate(${x} ${rowY}) scale(${scale.toFixed(5)})"><path d="${g.d}" fill="#9aa3bd" fill-opacity="${0.52 + (i % 3) * 0.13}"/></g>`
}).join('\n    ')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#12151c"/>
      <stop offset="1" stop-color="#0b0d11"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c7ff5"/>
      <stop offset="1" stop-color="#4f46e5"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6366f1" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#6366f1" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- the em square and its guides: what the app draws on, at wallpaper scale -->
  <g stroke="#6366f1" stroke-opacity="0.13" fill="none" stroke-width="2">
    <rect x="92" y="86" width="1096" height="468" rx="18"/>
    <path d="M92 196h1096" stroke-dasharray="14 16"/>
    <path d="M92 396h1096" stroke-dasharray="14 16"/>
  </g>

  <!-- the mark, drawn as the app draws it -->
  <g transform="translate(150 148) scale(0.1328)">
    <rect width="1024" height="1024" rx="224" fill="url(#mark)"/>
    <g fill="#ffffff">
      <rect x="336" y="288" width="352" height="86" rx="12"/>
      <rect x="452" y="288" width="120" height="448" rx="12"/>
      <rect x="336" y="650" width="352" height="86" rx="12"/>
    </g>
  </g>

  <text x="310" y="212" font-family="Helvetica Neue, Helvetica, Arial" font-size="96" font-weight="700" fill="#f2f3f7" letter-spacing="-3">Iconotype</text>

  <text x="150" y="322" font-family="Helvetica Neue, Helvetica, Arial" font-size="46" font-weight="500" fill="#c9cde0">Icon fonts, without the round trip.</text>

  <text x="150" y="384" font-family="Helvetica Neue, Helvetica, Arial" font-size="27" font-weight="400" fill="#8b93ab">An open-source IcoMoon alternative — in your editor, your terminal and your CI.</text>

  <path d="M150 424h980" stroke="url(#rule)" stroke-width="2"/>

  <g>
    ${strip}
  </g>

  <text x="${W / 2}" y="586" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial" font-size="25" font-weight="600" fill="#7f83f0" letter-spacing="4">VSCODE  ·  CLI  ·  DESKTOP  ·  WEB</text>
</svg>
`

writeFileSync(repo('docs/media/social-preview.svg'), svg)
const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: true } }).render().asPng()
writeFileSync(repo('docs/media/social-preview.png'), png)
console.log(`glyphs: ${row.map((g) => g.name).join(', ')}`)
console.log(`png: ${(png.length / 1024).toFixed(0)} kB`)
