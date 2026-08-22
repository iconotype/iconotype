import { PaperOffset } from 'paperjs-offset'
import paper from 'paper'
paper.setup(new paper.Size(1024, 1024))

// straight line, length 1000 → outlined area / length = actual stroke width
for (const d of [5, 10, 20]) {
  const line = new paper.Path('M0 500 L1000 500')
  const o = PaperOffset.offsetStroke(line, d, { cap: 'butt', insert: false })
  console.log(`offsetStroke(line, ${d})  area=${Math.round(Math.abs(o.area))}  → effective stroke width = ${(Math.abs(o.area) / 1000).toFixed(2)}  bounds.h=${o.bounds.height.toFixed(2)}`)
  line.remove(); o.remove()
}
// closed shape: square 400x400, stroke 20
const sq = new paper.Path.Rectangle({ point: [100, 100], size: [400, 400] })
const o = PaperOffset.offsetStroke(sq, 10, { join: 'miter', insert: false })
console.log(`\nclosed square 400², offsetStroke(...,10): children=${o.children?.length ?? 1} outerBounds=${o.bounds.width.toFixed(1)} (expect 420 if width=20, 410 if width=10)`)
