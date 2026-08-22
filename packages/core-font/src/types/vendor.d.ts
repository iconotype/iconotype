/** Minimal hand-written types for two untyped but stable dependencies. */

declare module 'svg2ttf' {
  interface Svg2TtfOptions {
    /** unix seconds — pass an explicit value or the output is not deterministic */
    ts?: number
    version?: string
    description?: string
    url?: string
    copyright?: string
  }
  interface MicroBuffer { buffer: ArrayBuffer; byteLength: number }
  export default function svg2ttf(svgFontString: string, options?: Svg2TtfOptions): MicroBuffer
}

declare module 'ttf2woff' {
  export default function ttf2woff(ttf: Uint8Array, options?: { metadata?: string }): Uint8Array
}
