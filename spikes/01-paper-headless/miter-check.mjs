import { PaperOffset, analyze } from 'paperjs-offset'
import paper from 'paper'
paper.setup(new paper.Size(2048, 2048))

const starPts = (r1, r2, n = 6) => {
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2
    const r = i % 2 === 0 ? r1 : r2
    pts.push(new paper.Point(500 + r * Math.cos(a), 500 + r * Math.sin(a)))
  }
  return pts
}

const perimeter = (p) => p.length

// control: square (no sharp concave corners)
{
  const sq = new paper.Path.Rectangle({ point: [100, 100], size: [400, 400] })
  const o = PaperOffset.offsetStroke(sq, 10, { join: 'miter', insert: false })
  console.log(`square    expected≈${(perimeter(sq) * 20).toFixed(0)}  got=${Math.abs(o.area).toFixed(0)}  children=${o.children?.length ?? 1}`)
  sq.remove(); o.remove()
}

// the failing case, across every algorithm
for (const [r1, r2, label] of [[200, 80, 'sharp star 200/80'], [200, 150, 'soft star 200/150'], [200, 40, 'very sharp 200/40']]) {
  for (const algorithm of ['auto', 'adaptive', 'robust', 'split', 'legacy']) {
    const star = new paper.Path({ segments: starPts(r1, r2), closed: true })
    const exp = perimeter(star) * 12
    let out
    try {
      out = PaperOffset.offsetStroke(star, 6, { join: 'miter', limit: 4, insert: false, algorithm })
      const got = Math.abs(out.area)
      const q = analyze(star, out, 6)
      const err = ((got - exp) / exp) * 100
      console.log(
        `${label.padEnd(18)} ${algorithm.padEnd(9)} expected≈${exp.toFixed(0).padStart(6)} got=${got.toFixed(0).padStart(6)} err=${err.toFixed(1).padStart(6)}%  selfInt=${q.selfIntersections} contain=${q.containmentErrors} dist=${q.distanceErrors} warn=[${q.warnings.join('|')}]`
      )
    } catch (e) {
      console.log(`${label.padEnd(18)} ${algorithm.padEnd(9)} THREW ${e.message}`)
    }
    star.remove(); out?.remove()
  }
  console.log()
}
