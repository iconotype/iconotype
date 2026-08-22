import svgpath from 'svgpath'

/**
 * Stage 4 and the path half of stages 5 and 6: primitive shapes to path data,
 * transforms baked in, commands normalized. The full pipeline lives in pipeline.ts.
 */
export interface NormalizeOptions {
  /** scale source coordinates into this height (the set's coordinate space) */
  targetHeight?: number
  sourceHeight?: number
  precision?: number
}

/** rect/circle/ellipse/line/polyline/polygon → path data. */
export function shapeToPath(tag: string, a: Record<string, string>): string | null {
  const n = (k: string, dflt = 0) => (a[k] === undefined ? dflt : parseFloat(a[k]!))
  switch (tag) {
    case 'path': return a.d ?? null
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height')
      let rx = a.rx !== undefined ? n('rx') : a.ry !== undefined ? n('ry') : 0
      let ry = a.ry !== undefined ? n('ry') : a.rx !== undefined ? n('rx') : 0
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2)
      if (!rx && !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}` +
        `V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
        `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
        `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
    }
    case 'circle': {
      const cx = n('cx'), cy = n('cy'), r = n('r')
      return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`
    }
    case 'ellipse': {
      const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry')
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`
    }
    case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`
    case 'polyline':
    case 'polygon': {
      const pts = (a.points ?? '').trim().split(/[\s,]+/).map(Number)
      if (pts.length < 4) return null
      let d = `M${pts[0]} ${pts[1]}`
      for (let i = 2; i < pts.length - 1; i += 2) d += `L${pts[i]} ${pts[i + 1]}`
      return tag === 'polygon' ? d + 'Z' : d
    }
    default: return null
  }
}

/** Bake a transform matrix into path data and normalize commands (abs, no arcs, no shorthand). */
export function bakePath(d: string, matrix?: [number, number, number, number, number, number], opts: NormalizeOptions = {}): string {
  let p = svgpath(d)
  if (matrix) p = p.matrix(matrix)
  if (opts.sourceHeight && opts.targetHeight && opts.sourceHeight !== opts.targetHeight) {
    p = p.scale(opts.targetHeight / opts.sourceHeight)
  }
  return p.abs().unshort().unarc().round(opts.precision ?? 3).toString()
}
