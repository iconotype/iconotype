export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** a then b (SVG order: `transform="a b"` applies a to the result of b's coordinate space). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Parses an SVG `transform` attribute into a single matrix. Unknown functions are ignored. */
export function parseTransform(input: string | undefined): Matrix {
  if (!input) return [...IDENTITY] as Matrix
  let m: Matrix = [...IDENTITY] as Matrix
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
  for (const match of input.matchAll(re)) {
    const fn = match[1]!
    const args = match[2]!.trim().split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n))
    let t: Matrix = [...IDENTITY] as Matrix
    switch (fn) {
      case 'matrix':
        if (args.length === 6) t = args as Matrix
        break
      case 'translate':
        t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]
        break
      case 'scale': {
        const sx = args[0] ?? 1
        t = [sx, 0, 0, args[1] ?? sx, 0, 0]
        break
      }
      case 'rotate': {
        const [a = 0, cx, cy] = args
        const cos = Math.cos(rad(a)), sin = Math.sin(rad(a))
        const r: Matrix = [cos, sin, -sin, cos, 0, 0]
        t = cx === undefined ? r
          : multiply(multiply([1, 0, 0, 1, cx, cy ?? 0], r), [1, 0, 0, 1, -cx, -(cy ?? 0)])
        break
      }
      case 'skewX': t = [1, 0, Math.tan(rad(args[0] ?? 0)), 1, 0, 0]; break
      case 'skewY': t = [1, Math.tan(rad(args[0] ?? 0)), 0, 1, 0, 0]; break
    }
    m = multiply(m, t)
  }
  return m
}

/** Average scale factor — what a stroke-width is multiplied by. */
export const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1

/** True when x and y are scaled differently (a stroke cannot be outlined faithfully then). */
export function isNonUniform(m: Matrix, epsilon = 1e-6): boolean {
  const sx = Math.hypot(m[0], m[1])
  const sy = Math.hypot(m[2], m[3])
  return Math.abs(sx - sy) > epsilon * Math.max(sx, sy, 1)
}

/**
 * viewBox → a target square of `size`, preserving aspect ratio and centering
 * (the "fit inside" default from docs/04; per-set override lands with the fixer).
 */
export function viewBoxMatrix(viewBox: string | undefined, width: number | undefined, height: number | undefined, size: number): Matrix {
  const vb = (viewBox ?? '').trim().split(/[\s,]+/).map(Number)
  const [minX, minY, vbW, vbH] =
    vb.length === 4 && vb.every((n) => !Number.isNaN(n))
      ? (vb as [number, number, number, number])
      : [0, 0, width ?? size, height ?? size]
  if (!vbW || !vbH) return [...IDENTITY] as Matrix
  const scale = Math.min(size / vbW, size / vbH)
  const dx = (size - vbW * scale) / 2
  const dy = (size - vbH * scale) / 2
  return [scale, 0, 0, scale, -minX * scale + dx, -minY * scale + dy]
}
