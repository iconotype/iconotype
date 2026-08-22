import paper from 'paper'
import { PaperOffset } from 'paperjs-offset'

/**
 * CONSTRAINT 1 — one paper instance, process-wide.
 *
 * `paperjs-offset` does `import paper from 'paper'` and type-guards with
 * `instanceof paper.Path`. Import 'paper/dist/paper-core.js' anywhere and you get a
 * second instance → every offset call throws "Offset source must be a Paper.js Path".
 * Bundlers alias 'paper' → 'paper/dist/paper-core.js' (see @glyphsmith/build-config);
 * because the alias is global, paperjs-offset resolves to the same module. Never
 * deep-import paper here.
 *
 * Also: NEVER call importSVG()/exportSVG() — they need a DOM and this package runs in
 * the VSCode extension host and the CLI. Path data in, path data out.
 */
let ready = false
export function getPaper(size = 1024): typeof paper {
  if (!ready) {
    paper.setup(new paper.Size(size, size))
    ready = true
  }
  return paper
}

export type PathLike = paper.Path | paper.CompoundPath

export const fromPathData = (d: string): PathLike => {
  const p = getPaper()
  return d.includes('M') && d.trim().split(/(?=[Mm])/).length > 1
    ? new p.CompoundPath(d)
    : new p.Path(d)
}

export const toPathData = (item: PathLike, precision = 3): string => item.pathData
  ? new (getPaper().CompoundPath)({ children: [], pathData: item.pathData }).pathData
  : ''

/**
 * CONSTRAINT 2 — offsetStroke(p, d) produces a stroke of total width 2d.
 * Verified: a 1000-unit line with d=10 outlines to area 20000.
 * Callers pass a real SVG stroke-width; this is the only place that halves it.
 */
export function outlineStroke(
  d: string,
  strokeWidth: number,
  opts: { join?: 'miter' | 'round' | 'bevel'; cap?: 'butt' | 'round'; miterLimit?: number } = {},
): string {
  const path = fromPathData(d)
  try {
    const outlined = PaperOffset.offsetStroke(path, strokeWidth / 2, {
      join: opts.join ?? 'miter',
      cap: opts.cap ?? 'butt',
      limit: opts.miterLimit ?? 4,
      insert: false,
    })
    const out = outlined.pathData
    outlined.remove()
    return out
  } finally {
    path.remove()
  }
}

/** Disposes the shared project's children — call between batch jobs to avoid growth. */
export function clearScene(): void {
  if (ready) paper.project.clear()
}
