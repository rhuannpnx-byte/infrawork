import { describe, expect, it } from 'vitest'
import { contar, rotuloAlertaStatus, rotuloPapel, rotuloReajusteStatus } from './rotulos'

describe('rótulos de tela', () => {
  it('contar usa o singular só para 1 e separa o milhar', () => {
    expect(contar(0, 'lançamento', 'lançamentos')).toBe('0 lançamentos')
    expect(contar(1, 'lançamento', 'lançamentos')).toBe('1 lançamento')
    expect(contar(2, 'item', 'itens')).toBe('2 itens')
    expect(contar(1234, 'viagem', 'viagens')).toBe('1.234 viagens')
  })

  it('papel, situação de alerta e de reajuste nunca saem como código cru conhecido', () => {
    expect(rotuloPapel('god')).toBe('Administrador geral')
    expect(rotuloPapel('adm')).toBe('Administrador')
    expect(rotuloPapel(null)).toBe('—')
    expect(rotuloAlertaStatus('silenciado')).toBe('Silenciado')
    expect(rotuloReajusteStatus('rascunho')).toBe('Rascunho')
  })
})
