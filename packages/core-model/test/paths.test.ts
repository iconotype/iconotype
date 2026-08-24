import { describe, expect, it } from 'vitest'
import { asPaths, firstPath, formatPathList, parsePathList, toPaths } from '../src/index.js'

describe('output paths', () => {
  it('reads a single string and a list the same way', () => {
    expect(asPaths('app/css/icons.css')).toEqual(['app/css/icons.css'])
    expect(asPaths(['a.css', 'b.css'])).toEqual(['a.css', 'b.css'])
    expect(asPaths(undefined)).toEqual([])
  })

  it('drops blank entries, so a trailing comma never writes to nowhere', () => {
    expect(asPaths([' app/css ', '', '  '])).toEqual(['app/css'])
    expect(parsePathList('app/css, public/css,  ,')).toEqual(['app/css', 'public/css'])
  })

  it('collapses back to a plain string when there is only one', () => {
    expect(toPaths(['only.css'])).toBe('only.css')
    expect(toPaths(['a.css', 'b.css'])).toEqual(['a.css', 'b.css'])
  })

  it('round-trips through a text field', () => {
    const text = 'app/fonts, public/fonts'
    expect(formatPathList(toPaths(parsePathList(text)))).toBe(text)
  })

  it('answers "the one destination" for anything single-valued', () => {
    expect(firstPath(['app/css/icons.css', 'other.css'])).toBe('app/css/icons.css')
    expect(firstPath(undefined, 'style.css')).toBe('style.css')
    expect(firstPath([], 'style.css')).toBe('style.css')
  })
})
