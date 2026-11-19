import { describe, expect, it } from 'vitest'
import { parseBR } from '@/lib/money'
import { parseNumero } from '@/lib/format/number'
import {
  agrupar,
  canonicoDeDigitacao,
  canonicoDeTexto,
  contarSignificativos,
  limparCanonico,
  mascaraCnpj,
  mascaraCpf,
  mascaraPlaca,
  mascaraTelefone,
  mesmoNumero,
  numeroParaCampo,
  posicaoApos
} from './numero'

const q = { casas: 4 }

describe('canonicoDeTexto (valor que vem de fora)', () => {
  it('lê os formatos brasileiro e americano', () => {
    expect(canonicoDeTexto('1.234,56', q)).toBe('1234,56')
    expect(canonicoDeTexto('1234,56', q)).toBe('1234,56')
    expect(canonicoDeTexto('1,234.56', q)).toBe('1234,56')
    expect(canonicoDeTexto('1234.56', q)).toBe('1234,56')
    expect(canonicoDeTexto('1.234.567', q)).toBe('1234567')
    expect(canonicoDeTexto('R$ 1.725.622,35', q)).toBe('1725622,35')
  })
  it('um ponto só, sem vírgula, é decimal (como parseBR e parseNumero)', () => {
    expect(canonicoDeTexto('18416.6700', q)).toBe('18416,67')
    expect(canonicoDeTexto('1.234', q)).toBe('1,234')
  })
  it('vazio, zero e sinal', () => {
    expect(canonicoDeTexto('', q)).toBe('')
    expect(canonicoDeTexto('abc', q)).toBe('')
    expect(canonicoDeTexto('0', q)).toBe('0')
    expect(canonicoDeTexto('007', q)).toBe('7')
    expect(canonicoDeTexto('-5,5', q)).toBe('5,5')
    expect(canonicoDeTexto('-5,5', { casas: 4, negativo: true })).toBe('-5,5')
  })
  it('só corta casas quando pedido', () => {
    expect(canonicoDeTexto('0,1234567', q)).toBe('0,1234567')
    expect(canonicoDeTexto('0,1234567', q, true)).toBe('0,1234')
    expect(canonicoDeTexto('12,9', { casas: 0 }, true)).toBe('12')
  })
})

describe('canonicoDeDigitacao (texto do campo)', () => {
  it('ponto é milhar e a vírgula final fica', () => {
    expect(canonicoDeDigitacao('1.2345', q)).toBe('12345')
    expect(canonicoDeDigitacao('12,', q)).toBe('12,')
    expect(canonicoDeDigitacao(',5', q)).toBe('0,5')
    expect(canonicoDeDigitacao('0,05', q)).toBe('0,05')
  })
  it('limita as casas e ignora o que não é número', () => {
    expect(canonicoDeDigitacao('1,234567', q)).toBe('1,2345')
    expect(canonicoDeDigitacao('12a3', q)).toBe('123')
    expect(canonicoDeDigitacao('1,2,3', q)).toBe('1,23')
    expect(canonicoDeDigitacao('12,5', { casas: 0 })).toBe('125')
  })
  it('sinal só quando aceito', () => {
    expect(canonicoDeDigitacao('-', { casas: 2, negativo: true })).toBe('-')
    expect(canonicoDeDigitacao('-12', { casas: 2, negativo: true })).toBe('-12')
    expect(canonicoDeDigitacao('-12', { casas: 2 })).toBe('12')
  })
})

describe('exibição', () => {
  it('agrupa de três em três', () => {
    expect(agrupar('1234567,5')).toBe('1.234.567,5')
    expect(agrupar('123')).toBe('123')
    expect(agrupar('1234,')).toBe('1.234,')
    expect(agrupar('-1234')).toBe('-1.234')
    expect(agrupar('')).toBe('')
  })
  it('completa as casas do valor em reais', () => {
    expect(agrupar('125000', 2)).toBe('125.000,00')
    expect(agrupar('6,4', 2)).toBe('6,40')
    expect(agrupar('6,1234', 2)).toBe('6,1234')
  })
  it('limpa o que é só de digitação', () => {
    expect(limparCanonico('12,')).toBe('12')
    expect(limparCanonico('-')).toBe('')
  })
  it('compara pelo número', () => {
    expect(mesmoNumero('7,', '7')).toBe(true)
    expect(mesmoNumero('7,50', '7,5')).toBe(true)
    expect(mesmoNumero('7', '8')).toBe(false)
    expect(mesmoNumero('', '0')).toBe(false)
  })
  it('número para o campo, sem notação científica', () => {
    expect(numeroParaCampo(1234.5)).toBe('1234,5')
    expect(numeroParaCampo(0.0000001)).toBe('0,0000001')
    expect(numeroParaCampo(null)).toBe('')
    expect(numeroParaCampo('18416.6700')).toBe('18416,67')
    expect(numeroParaCampo(0.27 * 100, 2)).toBe('27')
  })
})

describe('o que o campo entrega é lido igual por todo o sistema', () => {
  it.each(['1234,56', '1234567', '0,5', '12,', '1,234'])('%s', (canonico) => {
    const n = Number(limparCanonico(canonico).replace(',', '.'))
    expect(parseBR(canonico).toNumber()).toBe(n)
    expect(parseNumero(canonico)).toBe(n)
  })
})

describe('máscaras de texto', () => {
  it('telefone', () => {
    expect(mascaraTelefone('64')).toBe('(64')
    expect(mascaraTelefone('6499999')).toBe('(64) 9-9999')
    expect(mascaraTelefone('6433334444')).toBe('(64) 3333-4444')
    expect(mascaraTelefone('64999998888')).toBe('(64) 99999-8888')
    expect(mascaraTelefone('(64) 99999-8888 9')).toBe('(64) 99999-8888')
  })
  it('CNPJ, CPF e placa', () => {
    expect(mascaraCnpj('12345678000190')).toBe('12.345.678/0001-90')
    expect(mascaraCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35')
    expect(mascaraCnpj('123')).toBe('12.3')
    expect(mascaraCpf('12345678901')).toBe('123.456.789-01')
    expect(mascaraPlaca('abc1d23')).toBe('ABC1D23')
    expect(mascaraPlaca('abc-1234 x')).toBe('ABC-1234')
  })
})

describe('cursor', () => {
  const conta = (c: string): boolean => /[\d,]/.test(c)
  it('conta e reposiciona pelos caracteres que valem', () => {
    expect(contarSignificativos('1.234,5', 3, conta)).toBe(2)
    expect(posicaoApos('12.345', 2, conta)).toBe(2)
    expect(posicaoApos('12.345', 3, conta)).toBe(4)
    expect(posicaoApos('12.345', 0, conta)).toBe(0)
    expect(posicaoApos('12', 9, conta)).toBe(2)
  })
})
