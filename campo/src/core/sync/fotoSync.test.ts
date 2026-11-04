import { describe, expect, it, vi } from 'vitest'
vi.mock('@/core/api/endpoints', () => ({ syncEndpoints: {} }))
import { esperaFalhaMs } from './fotoSync'

describe('esperaFalhaMs', () => {
  it('cresce 1, 2, 4… min e para em 6 h', () => {
    expect(esperaFalhaMs(1)).toBe(60_000)
    expect(esperaFalhaMs(3)).toBe(240_000)
    expect(esperaFalhaMs(20)).toBe(6 * 3_600_000)
  })
})
