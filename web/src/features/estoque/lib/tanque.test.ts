import { describe, expect, it } from 'vitest'
import {
  alturaTotal,
  calculadora,
  capacidade,
  lerTabelaColada,
  linhasDaFolha,
  nivelDaLeitura,
  nivelParaVolume,
  PADROES_TORISFERICO,
  profundidadeTorisferico,
  tabelaArqueacao,
  validarTanque,
  volumeNaAltura,
  volumeNaTabela,
  type Tanque
} from './tanque'

const PI = Math.PI
/** diferença relativa */
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b)

// cilindro horizontal de 2 m de diâmetro por 6 m de costado: 18.849,56 L só de corpo
const cil = (tampo: Extract<Tanque, { forma: 'cilindrico_horizontal' }>['tampo']): Tanque => ({
  forma: 'cilindrico_horizontal',
  diametro: 200,
  comprimento: 600,
  tampo
})
const CORPO = (PI * 100 * 100 * 600) / 1000

describe('cilíndrico horizontal', () => {
  it('tampos planos: cheio, meio e simetria', () => {
    const t = cil({ tipo: 'plano' })
    expect(capacidade(t)).toBeCloseTo(CORPO, 6)
    expect(volumeNaAltura(t, 100)).toBeCloseTo(CORPO / 2, 6)
    const v = calculadora(t)
    for (const h of [10, 37.5, 80, 150]) expect(v(h) + v(200 - h)).toBeCloseTo(CORPO, 6)
  })
  it('a 1/4 da altura o segmento vale a fórmula do setor menos o triângulo', () => {
    // h = R/2: área = R²·(π/3) − (R/2)·(R·√3/2)
    const area = 100 * 100 * (PI / 3) - 50 * 100 * (Math.sqrt(3) / 2)
    expect(volumeNaAltura(cil({ tipo: 'plano' }), 50)).toBeCloseTo((area * 600) / 1000, 6)
  })
  it('tampos hemisféricos somam uma esfera; semielípticos 2:1, meia esfera', () => {
    const esfera = ((4 / 3) * PI * 100 ** 3) / 1000
    expect(capacidade(cil({ tipo: 'hemisferico' }))).toBeCloseTo(CORPO + esfera, 6)
    expect(capacidade(cil({ tipo: 'semieliptico' }))).toBeCloseTo(CORPO + esfera / 2, 6)
    // a meia altura os tampos também estão pela metade
    expect(volumeNaAltura(cil({ tipo: 'hemisferico' }), 100)).toBeCloseTo((CORPO + esfera) / 2, 6)
  })
  it('hemisférico parcial bate com a calota de esfera', () => {
    // esfera de raio 100 cheia até 30 cm: π·h²·(3R − h)/3
    const calota = (PI * 30 * 30 * (300 - 30)) / 3 / 1000
    const semTampo = volumeNaAltura(cil({ tipo: 'plano' }), 30)
    expect(volumeNaAltura(cil({ tipo: 'hemisferico' }), 30) - semTampo).toBeCloseTo(calota, 6)
  })
  it('abaulado com flecha igual ao raio é o hemisférico (integração numérica contra a fórmula)', () => {
    const numerico = calculadora(cil({ tipo: 'abaulado', flecha: 100 }))
    const fechado = calculadora(cil({ tipo: 'hemisferico' }))
    for (const h of [20, 60, 100, 145, 200]) expect(rel(numerico(h), fechado(h))).toBeLessThan(2e-4)
  })
  it('abaulado raso: os dois tampos somam duas calotas de esfera', () => {
    const f = 25
    const rc = (100 * 100 + f * f) / (2 * f)
    const duasCalotas = (2 * (PI * f * f * (3 * rc - f))) / 3 / 1000
    expect(rel(capacidade(cil({ tipo: 'abaulado', flecha: f })) - CORPO, duasCalotas)).toBeLessThan(
      5e-4
    )
  })
  it('torisférico ASME F&D: cada tampo vale cerca de 0,0809·D³', () => {
    const fd = PADROES_TORISFERICO.find((p) => p.id === 'asme_fd')!
    const tampos = capacidade(cil({ tipo: 'torisferico', fc: fd.fc, fk: fd.fk })) - CORPO
    expect(rel(tampos, (2 * 0.0809 * 200 ** 3) / 1000)).toBeLessThan(0.01)
    expect(profundidadeTorisferico(200, fd.fc, fd.fk) / 200).toBeCloseTo(0.169, 2)
  })
  it('torisférico é simétrico e cresce do F&D para o Korbbogen', () => {
    const caps = PADROES_TORISFERICO.map((p) =>
      capacidade(cil({ tipo: 'torisferico', fc: p.fc, fk: p.fk }))
    )
    for (let i = 1; i < caps.length; i++) expect(caps[i]).toBeGreaterThan(caps[i - 1])
    const v = calculadora(cil({ tipo: 'torisferico', fc: 1, fk: 0.1 }))
    expect(rel(v(60) + v(140), v(200))).toBeLessThan(1e-6)
  })
})

describe('cilíndrico vertical', () => {
  const base = PI * 100 * 100
  it('fundo plano: área × altura', () => {
    const t: Tanque = {
      forma: 'cilindrico_vertical',
      diametro: 200,
      altura: 300,
      fundo: { tipo: 'plano' }
    }
    expect(alturaTotal(t)).toBe(300)
    expect(volumeNaAltura(t, 120)).toBeCloseTo((base * 120) / 1000, 6)
  })
  it('fundo cônico: a régua parte do vértice do cone', () => {
    const t: Tanque = {
      forma: 'cilindrico_vertical',
      diametro: 200,
      altura: 300,
      fundo: { tipo: 'conico', altura: 60 }
    }
    expect(alturaTotal(t)).toBe(360)
    expect(volumeNaAltura(t, 60)).toBeCloseTo((base * 60) / 3 / 1000, 6)
    // meia altura do cone: um oitavo do volume do cone
    expect(volumeNaAltura(t, 30)).toBeCloseTo((base * 60) / 3 / 8 / 1000, 6)
    expect(capacidade(t)).toBeCloseTo((base * 60) / 3 / 1000 + (base * 300) / 1000, 6)
  })
  it('fundo abaulado: calota de esfera e depois o costado', () => {
    const f = 40
    const rc = (100 * 100 + f * f) / (2 * f)
    const calota = (PI * f * f * (3 * rc - f)) / 3 / 1000
    const t: Tanque = {
      forma: 'cilindrico_vertical',
      diametro: 200,
      altura: 300,
      fundo: { tipo: 'abaulado', flecha: f }
    }
    expect(volumeNaAltura(t, f)).toBeCloseTo(calota, 6)
    expect(volumeNaAltura(t, f + 100)).toBeCloseTo(calota + (base * 100) / 1000, 6)
  })
})

describe('elíptico e oval', () => {
  it('seção elíptica: π·a·b × comprimento, com o meio na metade', () => {
    const t: Tanque = {
      forma: 'eliptico_horizontal',
      largura: 240,
      altura: 150,
      comprimento: 600,
      flecha: 0
    }
    const cheio = (PI * 120 * 75 * 600) / 1000
    expect(capacidade(t)).toBeCloseTo(cheio, 6)
    expect(volumeNaAltura(t, 75)).toBeCloseTo(cheio / 2, 6)
  })
  it('elíptico com tampos abaulados: os dois tampos somam um elipsoide', () => {
    const t: Tanque = {
      forma: 'eliptico_horizontal',
      largura: 240,
      altura: 150,
      comprimento: 600,
      flecha: 20
    }
    const elipsoide = ((4 / 3) * PI * 120 * 75 * 20) / 1000
    expect(capacidade(t)).toBeCloseTo((PI * 120 * 75 * 600) / 1000 + elipsoide, 6)
  })
  it('seção oval deitada e em pé: semicírculos mais o trecho reto', () => {
    const area = PI * 75 * 75 + 90 * 150
    const deitado: Tanque = {
      forma: 'oval_horizontal',
      largura: 240,
      altura: 150,
      comprimento: 600,
      flecha: 0
    }
    const emPe: Tanque = {
      forma: 'oval_horizontal',
      largura: 150,
      altura: 240,
      comprimento: 600,
      flecha: 0
    }
    expect(capacidade(deitado)).toBeCloseTo((area * 600) / 1000, 6)
    expect(capacidade(emPe)).toBeCloseTo((area * 600) / 1000, 6)
    expect(volumeNaAltura(deitado, 75)).toBeCloseTo((area * 600) / 2000, 6)
    expect(volumeNaAltura(emPe, 120)).toBeCloseTo((area * 600) / 2000, 6)
    // em pé, no fim do semicírculo de baixo: meio círculo
    expect(volumeNaAltura(emPe, 75)).toBeCloseTo(((PI * 75 * 75) / 2) * 0.6, 6)
  })
  it('oval com tampos abaulados: cada tampo vale 2/3 da flecha × a área da seção', () => {
    const area = PI * 75 * 75 + 90 * 150
    const t: Tanque = {
      forma: 'oval_horizontal',
      largura: 240,
      altura: 150,
      comprimento: 600,
      flecha: 15
    }
    const tampos = capacidade(t) - (area * 600) / 1000
    expect(rel(tampos, (2 * (2 / 3) * 15 * area) / 1000)).toBeLessThan(2e-3)
    const v = calculadora(t)
    expect(rel(v(40) + v(110), v(150))).toBeLessThan(1e-6)
  })
})

describe('retangular e tabela do fabricante', () => {
  it('retangular: comprimento × largura × altura', () => {
    const t: Tanque = { forma: 'retangular', comprimento: 400, largura: 200, altura: 150 }
    expect(capacidade(t)).toBe(12000)
    expect(volumeNaAltura(t, 30)).toBe(2400)
  })
  it('tabela do fabricante interpola entre as linhas e parte do zero', () => {
    const t: Tanque = {
      forma: 'tabela',
      pontos: [
        { altura: 100, volume: 5000 },
        { altura: 50, volume: 2000 },
        { altura: 200, volume: 9000 }
      ]
    }
    expect(alturaTotal(t)).toBe(200)
    expect(volumeNaAltura(t, 25)).toBe(1000)
    expect(volumeNaAltura(t, 75)).toBe(3500)
    expect(volumeNaAltura(t, 150)).toBe(7000)
    expect(capacidade(t)).toBe(9000)
  })
  it('lê a tabela colada da planilha, em pt-BR ou com ponto decimal', () => {
    expect(lerTabelaColada('Altura\tVolume\n10\t1.250,5\n0\t0\n20\t2.600')).toEqual([
      { altura: 0, volume: 0 },
      { altura: 10, volume: 1250.5 },
      { altura: 20, volume: 2600 }
    ])
    expect(lerTabelaColada('5; 120.75\n10 250')).toEqual([
      { altura: 5, volume: 120.75 },
      { altura: 10, volume: 250 }
    ])
  })
})

describe('tabela de arqueação', () => {
  it('um ponto por centímetro, começa em zero, não decresce e termina na capacidade', () => {
    const t = cil({ tipo: 'torisferico', fc: 1, fk: 0.1 })
    const tab = tabelaArqueacao(t)
    expect(tab).toHaveLength(201)
    expect(tab[0]).toBe(0)
    for (let i = 1; i < tab.length; i++) expect(tab[i]).toBeGreaterThanOrEqual(tab[i - 1])
    expect(tab[200]).toBeCloseTo(capacidade(t), 1)
  })
  it('altura quebrada: o último ponto fica no centímetro de cima, já com a capacidade', () => {
    const t: Tanque = { forma: 'retangular', comprimento: 100, largura: 100, altura: 150.5 }
    const tab = tabelaArqueacao(t)
    expect(tab).toHaveLength(152)
    expect(tab[150]).toBe(1500)
    expect(tab[151]).toBe(1505)
  })
  it('interpolar a tabela erra muito pouco contra o cálculo direto', () => {
    const t = cil({ tipo: 'semieliptico' })
    const tab = tabelaArqueacao(t)
    const v = calculadora(t)
    const cap = capacidade(t)
    for (const h of [0.5, 3.5, 47.3, 100.5, 180.2, 199.5])
      expect(Math.abs(volumeNaTabela(tab, h) - v(h)) / cap).toBeLessThan(2e-4)
  })
  it('altura para um volume é o inverso da leitura', () => {
    const tab = tabelaArqueacao(cil({ tipo: 'plano' }))
    expect(nivelParaVolume(tab, 0)).toBe(0)
    expect(nivelParaVolume(tab, tab[200] + 10)).toBe(200)
    for (const h of [12.5, 80, 133.7])
      expect(nivelParaVolume(tab, volumeNaTabela(tab, h))).toBeCloseTo(h, 1)
  })
})

describe('régua pelo cheio e pelo vazio', () => {
  it('pelo vazio, a altura do líquido é a referência menos a leitura', () => {
    expect(nivelDaLeitura(120, 'cheio', null)).toBe(120)
    expect(nivelDaLeitura(60, 'vazio', 215)).toBe(155)
    expect(nivelDaLeitura(300, 'vazio', 215)).toBe(0)
  })
  it('a folha pelo vazio é indexada pelo número que o operador lê, de cima para baixo', () => {
    const tab = [0, 100, 250, 400]
    const cheio = linhasDaFolha(tab, 'cheio', null)
    expect(cheio.map((l) => l.leitura)).toEqual([0, 1, 2, 3])
    expect(cheio[2]).toEqual({ leitura: 2, nivel: 2, litros: 250, litrosPorCm: 150 })
    const vazio = linhasDaFolha(tab, 'vazio', 10)
    expect(vazio.map((l) => l.leitura)).toEqual([7, 8, 9, 10])
    expect(vazio[0]).toEqual({ leitura: 7, nivel: 3, litros: 400, litrosPorCm: 150 })
  })
})

describe('validação das medidas', () => {
  it('aceita os formatos completos', () => {
    expect(validarTanque(cil({ tipo: 'abaulado', flecha: 30 }))).toBeNull()
    expect(
      validarTanque({
        forma: 'oval_horizontal',
        largura: 240,
        altura: 150,
        comprimento: 600,
        flecha: 0
      })
    ).toBeNull()
  })
  it('diz o que falta ou está impossível', () => {
    expect(validarTanque({ ...cil({ tipo: 'plano' }), diametro: 0 } as Tanque)).toMatch(/diâmetro/)
    expect(validarTanque(cil({ tipo: 'abaulado', flecha: 130 }))).toMatch(/flecha/)
    expect(validarTanque(cil({ tipo: 'torisferico', fc: 0.4, fk: 0.1 }))).toMatch(/torisférico/)
    expect(validarTanque({ forma: 'tabela', pontos: [{ altura: 10, volume: 5 }] })).toMatch(
      /duas linhas/
    )
    expect(
      validarTanque({
        forma: 'tabela',
        pontos: [
          { altura: 0, volume: 0 },
          { altura: 10, volume: 50 },
          { altura: 20, volume: 40 }
        ]
      })
    ).toMatch(/diminuir/)
  })
})
