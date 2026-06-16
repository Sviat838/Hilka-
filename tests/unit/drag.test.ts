import { describe, expect, it } from 'vitest'
import { zoneFromEvent } from '../../src/lib/drag'

const rect = (over: Partial<DOMRect> = {}): DOMRect =>
  ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}), ...over }) as DOMRect

describe('zoneFromEvent', () => {
  it('vertical: top band = before, middle = child, bottom = after', () => {
    expect(zoneFromEvent(rect(), 50, 5, 'v')).toBe('before')
    expect(zoneFromEvent(rect(), 50, 50, 'v')).toBe('child')
    expect(zoneFromEvent(rect(), 50, 95, 'v')).toBe('after')
  })

  it('horizontal: left band = before, middle = child, right = after', () => {
    expect(zoneFromEvent(rect(), 5, 50, 'h')).toBe('before')
    expect(zoneFromEvent(rect(), 50, 50, 'h')).toBe('child')
    expect(zoneFromEvent(rect(), 95, 50, 'h')).toBe('after')
  })

  it('honors a non-zero rect origin', () => {
    expect(zoneFromEvent(rect({ top: 200, bottom: 300 }), 50, 205, 'v')).toBe('before')
    expect(zoneFromEvent(rect({ top: 200, bottom: 300 }), 50, 250, 'v')).toBe('child')
  })
})
