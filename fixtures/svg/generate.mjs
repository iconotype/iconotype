/**
 * Authors the pathological-SVG corpus from docs/04 as real files.
 *
 * Files are committed so they can be opened, diffed and eyeballed; this script exists so
 * the corpus can be regenerated or extended in one place. Run: node fixtures/svg/generate.mjs
 *
 * `expect`  — finding codes the pipeline MUST report for this input
 * `pixel`   — whether the fixed glyph should still look like the source. false for inputs
 *             that contain something a font cannot hold (text, images, gradients), where
 *             a visual difference is the correct outcome, not a bug.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const svg = (body, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>\n`

/** @type {Record<string, {svg: string, expect?: string[], pixel?: boolean, note?: string}>} */
const FIXTURES = {
  // ── transforms ─────────────────────────────────────────────────────────────
  'transform-translate': {
    svg: svg('<rect x="0" y="0" width="8" height="8" transform="translate(8, 8)"/>'),
    expect: ['TRANSFORM_BAKED'],
  },
  'transform-scale': {
    svg: svg('<rect width="6" height="6" transform="scale(2)"/>'),
    expect: ['TRANSFORM_BAKED'],
  },
  'transform-rotate-about-point': {
    svg: svg('<rect x="8" y="2" width="8" height="8" transform="rotate(45, 12, 12)"/>'),
    expect: ['TRANSFORM_BAKED'],
  },
  'transform-matrix': {
    svg: svg('<rect width="8" height="8" transform="matrix(1.5 0 0 1.5 3 3)"/>'),
    expect: ['TRANSFORM_BAKED'],
  },
  'transform-nested-groups': {
    svg: svg('<g transform="translate(12,0)"><g transform="scale(2)"><rect width="6" height="6"/></g></g>'),
    expect: ['TRANSFORM_BAKED'],
  },
  'transform-skew': {
    svg: svg('<rect x="4" y="4" width="10" height="10" transform="skewX(20)"/>'),
    expect: ['TRANSFORM_BAKED'],
  },

  // ── primitive shapes ───────────────────────────────────────────────────────
  'shape-rect': { svg: svg('<rect x="2" y="2" width="20" height="20"/>'), expect: ['SHAPE_CONVERTED'] },
  'shape-rect-rounded': { svg: svg('<rect x="2" y="2" width="20" height="20" rx="6" ry="4"/>'), expect: ['SHAPE_CONVERTED'] },
  'shape-rect-rx-clamped': {
    svg: svg('<rect x="2" y="2" width="20" height="10" rx="40"/>'),
    expect: ['SHAPE_CONVERTED'],
    note: 'rx larger than half the width must clamp, not explode',
  },
  'shape-circle': { svg: svg('<circle cx="12" cy="12" r="9"/>'), expect: ['SHAPE_CONVERTED'] },
  'shape-ellipse': { svg: svg('<ellipse cx="12" cy="12" rx="10" ry="6"/>'), expect: ['SHAPE_CONVERTED'] },
  'shape-polygon': { svg: svg('<polygon points="12,2 22,22 2,22"/>'), expect: ['SHAPE_CONVERTED'] },
  'shape-polyline-stroked': {
    svg: svg('<polyline points="2,20 8,8 14,16 22,4" fill="none" stroke="#000" stroke-width="2"/>'),
    expect: ['SHAPE_CONVERTED', 'STROKE_OUTLINED'],
  },
  'shape-line-stroked': {
    svg: svg('<line x1="2" y1="2" x2="22" y2="22" stroke="#000" stroke-width="3"/>'),
    expect: ['SHAPE_CONVERTED', 'STROKE_OUTLINED'],
  },

  // ── path data ──────────────────────────────────────────────────────────────
  'path-arcs': {
    svg: svg('<path d="M4 12 A8 8 0 0 1 20 12 A8 8 0 0 1 4 12 Z"/>'),
    note: 'arcs must become cubics; fonts have no arc command',
  },
  'path-relative-commands': { svg: svg('<path d="m4 4 h16 v16 h-16 z"/>') },
  'path-shorthand-curves': { svg: svg('<path d="M4 12 C4 6 10 4 12 8 S20 6 20 12 T12 20 Z"/>') },
  'path-high-precision': { svg: svg('<path d="M4.123456789 4.987654321 L19.111111111 4.9 L19.2 19.87654321 Z"/>') },
  'path-open': {
    svg: svg('<path d="M4 4 L20 4 L20 20"/>'),
    expect: ['OPEN_CONTOUR'],
    pixel: false,
    note: 'an open filled path is auto-closed, which legitimately changes the render',
  },
  'path-self-intersecting-star': {
    svg: svg('<path d="M12 2 L19 22 L2 9 L22 9 L5 22 Z"/>'),
    expect: ['SELF_INTERSECT'],
    pixel: false,
    note: 'a pentagram resolved to non-zero loses the inner hole an even-odd render shows',
  },

  // ── strokes ────────────────────────────────────────────────────────────────
  'stroke-basic': {
    svg: svg('<path d="M2 12 H22" fill="none" stroke="#000" stroke-width="4"/>'),
    expect: ['STROKE_OUTLINED'],
  },
  'stroke-miter-sharp': {
    svg: svg('<path d="M2 20 L12 4 L22 20" fill="none" stroke="#000" stroke-width="3" stroke-linejoin="miter" stroke-miterlimit="4"/>'),
    expect: ['STROKE_OUTLINED'],
  },
  'stroke-round-join': {
    svg: svg('<path d="M2 20 L12 4 L22 20" fill="none" stroke="#000" stroke-width="3" stroke-linejoin="round"/>'),
    expect: ['STROKE_OUTLINED'],
  },
  'stroke-bevel-join': {
    svg: svg('<path d="M2 20 L12 4 L22 20" fill="none" stroke="#000" stroke-width="3" stroke-linejoin="bevel"/>'),
    expect: ['STROKE_OUTLINED'],
  },
  'stroke-round-cap': {
    svg: svg('<path d="M6 12 H18" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round"/>'),
    expect: ['STROKE_OUTLINED'],
  },
  'stroke-dasharray': {
    svg: svg('<path d="M2 12 H22" fill="none" stroke="#000" stroke-width="4" stroke-dasharray="3 2"/>'),
    expect: ['STROKE_DASHARRAY'],
    pixel: false,
    note: 'dashes are outlined as a solid stroke for now',
  },
  'stroke-plus-fill': {
    svg: svg('<rect x="6" y="6" width="12" height="12" fill="#000" stroke="#000" stroke-width="4"/>'),
    expect: ['STROKE_OUTLINED'],
  },
  'stroke-on-scaled-group': {
    svg: svg('<g transform="scale(2)"><path d="M1 6 H11" fill="none" stroke="#000" stroke-width="1"/></g>'),
    expect: ['STROKE_OUTLINED'],
    note: 'stroke width must scale with the transform',
  },
  'stroke-nonuniform-scale': {
    svg: svg('<g transform="scale(2,1)"><path d="M1 12 H11" fill="none" stroke="#000" stroke-width="2"/></g>'),
    expect: ['STROKE_NONUNIFORM'],
    pixel: false,
  },
  'stroke-lucide-style': {
    svg: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    expect: ['STROKE_OUTLINED'],
    note: 'the shape of a typical stroke icon set',
  },

  // ── winding ────────────────────────────────────────────────────────────────
  'winding-evenodd-bullseye': {
    svg: svg('<path fill-rule="evenodd" d="M12 1 A11 11 0 1 1 12 23 A11 11 0 1 1 12 1 Z M12 4 A8 8 0 1 0 12 20 A8 8 0 1 0 12 4 Z M12 7 A5 5 0 1 1 12 17 A5 5 0 1 1 12 7 Z M12 9 A3 3 0 1 0 12 15 A3 3 0 1 0 12 9 Z"/>'),
    expect: ['EVENODD_CONVERTED'],
  },
  'winding-evenodd-donut': {
    svg: svg('<path fill-rule="evenodd" d="M2 2 H22 V22 H2 Z M7 7 H17 V17 H7 Z"/>'),
    expect: ['EVENODD_CONVERTED'],
  },
  'winding-nonzero-donut': {
    svg: svg('<path d="M2 2 H22 V22 H2 Z M7 17 H17 V7 H7 Z"/>'),
    note: 'already non-zero with a reversed hole; must pass through unchanged',
  },
  'winding-evenodd-inherited': {
    svg: svg('<g fill-rule="evenodd"><path d="M2 2 H22 V22 H2 Z M7 7 H17 V17 H7 Z"/></g>'),
    expect: ['EVENODD_CONVERTED'],
    note: 'fill-rule inherits from the group',
  },

  // ── clip and mask ──────────────────────────────────────────────────────────
  'clip-rect': {
    svg: svg('<defs><clipPath id="c"><rect x="0" y="0" width="12" height="24"/></clipPath></defs><circle cx="12" cy="12" r="10" clip-path="url(#c)"/>'),
    expect: ['CLIP_APPLIED'],
  },
  'clip-circle': {
    svg: svg('<defs><clipPath id="c"><circle cx="12" cy="12" r="8"/></clipPath></defs><rect width="24" height="24" clip-path="url(#c)"/>'),
    expect: ['CLIP_APPLIED'],
  },
  'clip-on-group': {
    svg: svg('<defs><clipPath id="c"><rect x="0" y="0" width="24" height="12"/></clipPath></defs><g clip-path="url(#c)"><circle cx="8" cy="12" r="6"/><circle cx="16" cy="12" r="6"/></g>'),
    expect: ['CLIP_APPLIED'],
  },
  'clip-object-bounding-box': {
    svg: svg('<defs><clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath></defs><rect width="24" height="24" clip-path="url(#c)"/>'),
    expect: ['CLIP_APPROXIMATED'],
    pixel: false,
  },
  'mask-white-keeps': {
    svg: svg('<defs><mask id="m"><rect x="0" y="0" width="12" height="24" fill="#fff"/></mask></defs><circle cx="12" cy="12" r="10" mask="url(#m)"/>'),
    expect: ['MASK_APPROXIMATED'],
  },
  'mask-black-cuts': {
    svg: svg('<defs><mask id="m"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="12" r="5" fill="#000"/></mask></defs><rect width="24" height="24" mask="url(#m)"/>'),
    expect: ['MASK_APPROXIMATED'],
  },

  // ── references ─────────────────────────────────────────────────────────────
  'use-simple': {
    svg: svg('<defs><rect id="r" width="8" height="8"/></defs><use href="#r" x="4" y="4"/>'),
    expect: ['USE_RESOLVED'],
  },
  'use-with-transform': {
    svg: svg('<defs><rect id="r" width="8" height="8"/></defs><use href="#r" x="2" y="2" transform="scale(2)"/>'),
    expect: ['USE_RESOLVED'],
  },
  'use-symbol': {
    svg: svg('<defs><symbol id="s"><circle cx="6" cy="6" r="5"/></symbol></defs><use href="#s" x="6" y="6"/>'),
    expect: ['USE_RESOLVED'],
  },
  'use-xlink-href': {
    // real exports declare the namespace; strict parsers reject the prefix without it
    svg: svg('<defs><rect id="r" width="10" height="10"/></defs><use xlink:href="#r" x="7" y="7"/>',
      'viewBox="0 0 24 24" xmlns:xlink="http://www.w3.org/1999/xlink"'),
    expect: ['USE_RESOLVED'],
  },
  'use-missing-target': {
    svg: svg('<rect width="10" height="10"/><use href="#nope"/>'),
    expect: ['EXTERNAL_REF'],
  },

  // ── styling ────────────────────────────────────────────────────────────────
  'style-block-tag': {
    svg: svg('<style>rect { fill: #000 }</style><rect x="4" y="4" width="16" height="16"/>'),
    expect: ['STYLE_INLINED'],
  },
  'style-block-class': {
    svg: svg('<style>.a { fill: none; stroke: #000; stroke-width: 3 }</style><path class="a" d="M4 12 H20"/>'),
    expect: ['STYLE_INLINED', 'STROKE_OUTLINED'],
  },
  'style-inline-attribute': {
    svg: svg('<rect x="4" y="4" width="16" height="16" style="fill:none;stroke:#000;stroke-width:2"/>'),
    expect: ['STROKE_OUTLINED'],
  },
  'style-specificity': {
    svg: svg('<style>rect { fill: none } #keep { fill: #000 }</style><rect id="keep" x="4" y="4" width="16" height="16"/>'),
    expect: ['STYLE_INLINED'],
    note: 'the id rule wins, so the rect is filled rather than dropped',
  },
  'style-inline-beats-css': {
    svg: svg('<style>rect { fill: none }</style><rect x="4" y="4" width="16" height="16" style="fill:#000"/>'),
    expect: ['STYLE_INLINED'],
  },
  'style-unsupported-selector': {
    svg: svg('<style>g > rect:first-child { fill: #000 }</style><g><rect x="4" y="4" width="16" height="16"/></g>'),
    expect: ['UNSUPPORTED_SELECTOR'],
  },

  // ── things a font cannot hold ──────────────────────────────────────────────
  'unsupported-text': {
    svg: svg('<text x="4" y="16" font-size="16">A</text>'),
    expect: ['TEXT_ELEMENT', 'EMPTY'],
    pixel: false,
  },
  'unsupported-image': {
    svg: svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="24" height="24"/>'),
    expect: ['IMAGE_EMBEDDED', 'EMPTY'],
    pixel: false,
  },
  'unsupported-gradient-fill': {
    svg: svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="24" height="24" fill="url(#g)"/>'),
    expect: ['GRADIENT_UNSUPPORTED'],
    pixel: false,
  },
  'unsupported-filter': {
    svg: svg('<defs><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs><rect x="4" y="4" width="16" height="16" filter="url(#f)"/>'),
    expect: ['FILTER_DROPPED'],
    pixel: false,
  },
  'unsupported-script': {
    svg: svg('<script>alert(1)</script><rect x="4" y="4" width="16" height="16" onclick="alert(2)"/>'),
    expect: ['SCRIPT_STRIPPED'],
  },
  'unsupported-external-ref': {
    svg: svg('<use href="https://example.com/icons.svg#star"/><rect x="4" y="4" width="16" height="16"/>'),
    expect: ['EXTERNAL_REF'],
    note: 'the reference is stripped; the local rect still becomes the glyph',
  },

  // ── document structure ─────────────────────────────────────────────────────
  'structure-nested-svg': {
    svg: svg('<svg x="0" y="0" width="12" height="12"><rect width="12" height="12"/></svg>'),
    expect: ['NESTED_SVG'],
    pixel: false,
  },
  'structure-unused-defs': {
    svg: svg('<defs><rect id="unused" width="99" height="99"/></defs><rect x="4" y="4" width="16" height="16"/>'),
  },
  'structure-empty': {
    svg: svg('<g></g>'),
    expect: ['EMPTY'],
    pixel: false,
  },
  'structure-no-viewbox': {
    svg: svg('<rect x="4" y="4" width="16" height="16"/>', 'width="24" height="24"'),
    note: 'width/height stand in for a missing viewBox',
  },
  'structure-viewbox-offset': {
    svg: svg('<rect x="104" y="104" width="16" height="16"/>', 'viewBox="100 100 24 24"'),
    note: 'a non-zero viewBox origin must be normalized away',
  },
  'structure-viewbox-nonsquare': {
    svg: svg('<rect width="48" height="24"/>', 'viewBox="0 0 48 24"'),
    pixel: false,
    note: 'fitted into a square em box with letterboxing, so it cannot match pixel for pixel',
  },

  // ── geometry quality ───────────────────────────────────────────────────────
  'quality-tiny-detail': {
    svg: svg('<rect x="12" y="12" width="0.3" height="0.3"/>'),
    expect: ['TINY_DETAIL'],
    pixel: false,
  },
  'quality-zero-area': {
    svg: svg('<rect x="4" y="4" width="16" height="16"/><rect x="2" y="2" width="0" height="10"/>'),
    expect: ['ZERO_AREA_REMOVED'],
  },
  'quality-duplicate-points': {
    svg: svg('<path d="M4 4 L4 4 L20 4 L20 4 L20 20 L4 20 Z"/>'),
  },
  'quality-out-of-box': {
    svg: svg('<rect x="-6" y="-6" width="40" height="40"/>', 'viewBox="0 0 24 24"'),
    note: 'artwork drawn outside its own viewBox',
    pixel: false,
  },
  'quality-many-segments': {
    svg: svg(`<path d="${Array.from({ length: 400 }, (_, i) => `${i === 0 ? 'M' : 'L'}${(12 + 10 * Math.cos((i / 400) * Math.PI * 2)).toFixed(3)} ${(12 + 10 * Math.sin((i / 400) * Math.PI * 2)).toFixed(3)}`).join(' ')} Z"/>`),
  },

  // ── colour ─────────────────────────────────────────────────────────────────
  'colour-two-fills': {
    svg: svg('<rect width="12" height="24" fill="#000"/><rect x="12" width="12" height="24" fill="#888"/>'),
    expect: ['MULTIPLE_COLORS'],
  },
  'colour-three-fills': {
    svg: svg('<rect width="8" height="24" fill="#000"/><rect x="8" width="8" height="24" fill="#666"/><rect x="16" width="8" height="24" fill="#ccc"/>'),
    expect: ['MULTIPLE_COLORS'],
  },
  'colour-partial-opacity': {
    svg: svg('<rect x="4" y="4" width="16" height="16" opacity="0.4"/>'),
    expect: ['OPACITY_FLATTENED'],
    pixel: false,
  },
  'colour-invisible-shape': {
    svg: svg('<rect x="4" y="4" width="16" height="16"/><rect width="24" height="24" opacity="0.01"/>'),
    expect: ['OPACITY_FLATTENED'],
  },

  // ── real-world exporter noise ──────────────────────────────────────────────
  'editor-inkscape-cruft': {
    svg: svg('<g inkscape:label="Layer 1" inkscape:groupmode="layer" sodipodi:insensitive="true"><rect x="4" y="4" width="16" height="16"/></g>',
      'viewBox="0 0 24 24" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"'),
  },
  'editor-figma-export': {
    svg: svg('<g id="Frame 1" clip-path="url(#clip0)"><rect x="4" y="4" width="16" height="16" fill="black"/></g><defs><clipPath id="clip0"><rect width="24" height="24" fill="white"/></clipPath></defs>'),
    expect: ['CLIP_APPLIED'],
  },
  'editor-illustrator-style-block': {
    svg: svg('<style type="text/css">.st0{fill:#231F20;}</style><path class="st0" d="M4 4 H20 V20 H4 Z"/>'),
    expect: ['STYLE_INLINED'],
  },
}

mkdirSync(here, { recursive: true })
const manifest = {}
for (const [name, spec] of Object.entries(FIXTURES)) {
  writeFileSync(join(here, `${name}.svg`), spec.svg)
  manifest[name] = { expect: spec.expect ?? [], pixel: spec.pixel !== false, note: spec.note }
}
writeFileSync(join(here, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${Object.keys(FIXTURES).length} fixtures + manifest.json`)
