import { describe, expect, it } from 'vitest'
import { dataExif } from './exifArquivo'

describe('dataExif', () => {
  it('lê a data EXIF na hora local da câmera', () => {
    const d = dataExif('2026:11:03 14:32:05')!
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 3, 14, 32])
  })
  it('valor ausente ou inválido → null', () => {
    expect(dataExif(undefined)).toBeNull()
    expect(dataExif('ontem')).toBeNull()
  })
})
