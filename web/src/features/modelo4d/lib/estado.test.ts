import { describe, expect, it } from 'vitest'
import type { Modelo4D } from './contrato'
import { validarModelo } from './contrato'
import { converterHtml } from './converter-html'
import { Estado4D, situacao, type Lancamento, type TrechoPlano, type Vinculos } from './estado'
import { prepararModelo, resumirModelo } from './preparar'

const DIA = 86_400_000
const d = (n: number): number => Date.UTC(2026, 0, 1) + n * DIA

/** Eixo reto de 200 m para leste, plataforma de 10 m, com seções a cada 20 m. */
function modelo(): Modelo4D {
  const s = Array.from({ length: 11 }, (_, i) => i * 20)
  return {
    formato: 'infrawork-4d',
    versao: 1,
    nome: 'Teste',
    origem: { e: 500000, n: 8000000, fuso: '22S' },
    eixos: [{ id: 'E1', nome: 'Eixo', pontos: s.map((x) => [x, x, 0, 100]) }],
    classes: [
      { id: 'ATERRO', nome: 'Aterro', disciplina: 'Terraplenagem', terreno: true },
      { id: 'BASE', nome: 'Base', disciplina: 'Pavimentação' },
      { id: 'BUEIRO', nome: 'Bueiros', disciplina: 'Obras de arte correntes' },
      { id: 'FAIXA', nome: 'Faixa', disciplina: 'Contexto', contexto: true }
    ],
    secoes: s.map((x) => ({
      s: x,
      perfil: [
        [-5, 100],
        [0, 100.1],
        [5, 100]
      ]
    })),
    camadas: [
      { classe: 'ATERRO', s0: 0, s1: 200, faixas: [[-5, 5]], quantidade: 1000 },
      { classe: 'BASE', s0: 0, s1: 200, faixas: [[-4, 4]], elevacao: 0.1 }
    ],
    elementos: [
      {
        id: 'b1',
        classe: 'BUEIRO',
        s0: 50,
        s1: 50,
        geo: { t: 'tubo', p0: [50, -6, 99], p1: [50, 6, 99], diametro: 1 }
      },
      {
        id: 'f1',
        classe: 'FAIXA',
        geo: {
          t: 'linha',
          pts: [
            [0, 20, 100],
            [200, 20, 100]
          ],
          largura: 0.5
        }
      }
    ]
  }
}

const vinculos: Vinculos = {
  eixos: {
    E1: {
      id: 'T1',
      unidade_espaco_padrao: 'estaca',
      marcador_valor_inicial: 0,
      geometry_sentido: 'natural',
      comprimento_m: 200
    }
  },
  classes: { ATERRO: 'aterro', BASE: 'base', BUEIRO: 'bueiro' }
}

const wp = (
  item: string,
  a: number,
  b: number,
  t0: number,
  t1: number,
  q: number,
  crescente = true
): TrechoPlano => ({
  tarefa_id: `t-${item}`,
  item_id: item,
  trecho_id: 'T1',
  inicio_m: a,
  fim_m: b,
  inicio: d(t0),
  fim: d(t1),
  quantidade: q,
  crescente
})

const lanc = (
  item: string,
  a: number | null,
  b: number | null,
  dia: number,
  q: number
): Lancamento => ({
  id: `${item}-${dia}`,
  item_id: item,
  trecho_id: a == null ? null : 'T1',
  inicio_m: a,
  fim_m: b,
  dia: d(dia) + DIA / 2,
  quantidade: q
})

describe('modelo 4D', () => {
  it('fatia as camadas pelas seções e mede as peças', () => {
    expect('modelo' in validarModelo(modelo())).toBe(true)
    const p = prepararModelo(modelo())
    const r = resumirModelo(p)
    expect(r.classes.map((c) => [c.id, c.pecas])).toEqual([
      ['ATERRO', 10],
      ['BASE', 10],
      ['BUEIRO', 1],
      ['FAIXA', 10]
    ])
    const aterro = p.malhas[0].pecas.map((i) => p.pecas[i])
    expect(aterro[0]).toMatchObject({ s0: 0, s1: 20, qtd: 100 })
    expect(aterro.reduce((t, x) => t + (x.qtd ?? 0), 0)).toBeCloseTo(1000)
  })

  it('recusa arquivo fora do contrato dizendo o que falta', () => {
    const m = modelo() as unknown as Record<string, unknown>
    m.elementos = [
      { id: 'x', classe: 'NAO_EXISTE', geo: { t: 'caixa', p: [0, 0, 0], dim: [1, 1, 1] } }
    ]
    const v = validarModelo(m)
    expect('erros' in v && v.erros.join(' ')).toContain('classe que não existe')
    expect('erros' in validarModelo({ formato: 'outro' })).toBe(true)
  })
})

describe('estado 4D', () => {
  const p = prepararModelo(modelo())
  const aterro = p.malhas[0].pecas
  const base = p.malhas[1].pecas
  const bueiro = p.malhas[2].pecas[0]
  const faixa = p.malhas[3].pecas[0]

  it('previsto: a frente anda pela faixa no sentido da tarefa', () => {
    const e = new Estado4D(
      p,
      [wp('aterro', 0, 200, 0, 10, 1000), wp('base', 0, 200, 10, 20, 500, false)],
      [],
      vinculos
    )
    e.calcular(d(5))
    expect(Array.from(aterro, (i) => e.prev[i])).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 0])
    expect(base.every((i) => e.prev[i] === 0)).toBe(true)
    e.calcular(d(12.5))
    // decrescente: começa pelo fim do trecho
    expect(Array.from(base, (i) => +e.prev[i].toFixed(2))).toEqual([0, 0, 0, 0, 0, 0, 0, 0.5, 1, 1])
    expect(Number.isNaN(e.prev[faixa])).toBe(true)
    expect(e.janelaPrevista(aterro[2])!.map((t) => Math.round((t - d(0)) / DIA))).toEqual([2, 3])
    expect([e.inicio, e.fim]).toEqual([d(0), d(20)])
  })

  it('previsto segue o perfil da tarefa quando ele existe', () => {
    // 10 dias de tarefa, mas o perfil faz tudo nos 2 últimos
    const perfis = new Map([
      [
        't-aterro',
        [
          [d(0), 0],
          [d(8), 0],
          [d(10), 1000]
        ] as [number, number][]
      ]
    ])
    const e = new Estado4D(p, [wp('aterro', 0, 200, 0, 10, 1000)], [], vinculos, perfis)
    e.calcular(d(5))
    expect(aterro.every((i) => e.prev[i] === 0)).toBe(true)
    e.calcular(d(9))
    expect(Array.from(aterro, (i) => e.prev[i])).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 0])
  })

  it('realizado: o lançado sobre a estaca ÷ o previsto para ela', () => {
    const e = new Estado4D(
      p,
      [wp('aterro', 0, 200, 0, 10, 1000), wp('bueiro', 40, 60, 3, 4, 12)],
      [
        lanc('aterro', 0, 40, 1, 200),
        lanc('aterro', 40, 80, 2, 100),
        lanc('aterro', null, null, 2, 50),
        lanc('bueiro', 40, 60, 6, 12)
      ],
      vinculos
    )
    e.calcular(d(1) + DIA - 1)
    expect(Array.from(aterro.slice(0, 5), (i) => e.real[i])).toEqual([1, 1, 0, 0, 0])
    e.calcular(d(5))
    expect(Array.from(aterro.slice(0, 5), (i) => e.real[i])).toEqual([1, 1, 0.5, 0.5, 0])
    expect(situacao(e.prev[aterro[2]], e.real[aterro[2]])).toBe('atrasado')
    expect(situacao(e.prev[aterro[0]], e.real[aterro[0]])).toBe('concluido')
    expect([situacao(0.8, 0), situacao(0.5, 0.5), situacao(0.2, 1), situacao(0, 0)]).toEqual([
      'atrasado',
      'execucao',
      'adiantado',
      'nao_iniciado'
    ])
    expect([e.prev[bueiro], e.real[bueiro]]).toEqual([1, 0])
    e.calcular(d(7))
    expect(e.real[bueiro]).toBe(1)
    expect(e.semEstaca).toHaveLength(1)
    expect(e.lancamentosDaPeca(aterro[2]).map((l) => l.quantidade)).toEqual([100])
    const r = e.resumo(d(5)).find((x) => x.item_id === 'aterro')!
    expect(r).toMatchObject({ total: 1000, previsto: 500, realizado: 350 })
  })

  it('plano e lançamento maiores que o modelo contam só na parte que o modelo cobre', () => {
    // o local tem 400 m e o modelo cobre os primeiros 200: metade da quantidade cai nele
    const maior: Vinculos = {
      eixos: { E1: { ...vinculos.eixos.E1!, comprimento_m: 400 } },
      classes: { BASE: 'base' }
    }
    const e = new Estado4D(
      p,
      [wp('base', 0, 400, 0, 10, 2000)],
      [lanc('base', 0, 400, 3, 1000)],
      maior
    )
    e.calcular(d(5))
    // a frente está no meio do local, que é o fim do modelo
    expect(base.every((i) => e.prev[i] === 1)).toBe(true)
    // 1000 lançados em 400 m: 500 no modelo, metade dos 1000 previstos para ele
    expect(Array.from(base, (i) => +e.real[i].toFixed(3))).toEqual(Array(10).fill(0.5))
  })

  it('terreno acompanha a terraplenagem e fica no projeto quando ela não está vinculada', () => {
    const e = new Estado4D(p, [wp('aterro', 0, 200, 0, 10, 1000)], [], vinculos)
    e.calcular(d(5))
    const t = e.terreno(e.prev)[0]
    expect([t[0], t[4], t[5], t[9]]).toEqual([1, 1, 0, 0])
    const solto = new Estado4D(p, [], [], { eixos: vinculos.eixos, classes: {} })
    solto.calcular(d(5))
    expect(solto.terreno(solto.prev)[0][3]).toBe(1)
  })

  it('local com estaqueamento invertido e valor inicial', () => {
    const inv: Vinculos = {
      eixos: {
        E1: {
          id: 'T1',
          unidade_espaco_padrao: 'estaca',
          marcador_valor_inicial: 10,
          geometry_sentido: 'invertido',
          comprimento_m: 200
        }
      },
      classes: { ATERRO: 'aterro' }
    }
    const e = new Estado4D(p, [], [], inv)
    // a estaca 0 do modelo fica a 200 m do início do local (que começa na estaca 10 e decresce)
    expect([e.m0[aterro[0]], e.m1[aterro[0]]]).toEqual([180, 200])
    expect([e.m0[aterro[9]], e.m1[aterro[9]]]).toEqual([0, 20])
  })
})

describe('conversor do HTML', () => {
  const dados = {
    origin: [1000, 2000],
    axis: [0, 20, 40, 60].map((s) => [s, s, 0, 100]),
    sec: [0, 20, 40, 60].map((s) => [s, s, 0, 100, 99, -7.33, 99.9, -9, 99, 3.5, 99.95, 9, 101]),
    cub: [
      [20, 10, 30, 10, 30],
      [40, 50, 5, 60, 35],
      [60, 0, 20, 60, 55]
    ],
    pav: {
      seg: [
        { cam: 'BASE', s0: 0, s1: 60, larg: 12 },
        { cam: 'BASE', s0: 0, s1: 40, larg: 13 },
        { cam: 'IMPRIMAÇÃO', s0: 0, s1: 60, larg: 12 }
      ]
    },
    segs: {
      STC: [
        [
          [0, -8, 100],
          [30, -8, 100],
          [60, -8, 100]
        ]
      ]
    },
    devs: [{ t: 'DES', code: 'DES 1', s: 30, p: [30, -10, 99], est: '1+10,00' }],
    bue: [
      {
        tipo: 'BSTC Ø 1,0',
        est: '2+0,00',
        s: 40,
        D: 1,
        B: null,
        linhas: 1,
        L: 20,
        p0: [40, -10, 98],
        p1: [40, 10, 98]
      }
    ],
    signs: [{ code: 'R-1', s: 10, est: '0+10,00', p: [10, 8, 100] }],
    info: { STC: 'Sarjeta triangular de concreto', DES: 'Dissipador de energia' }
  }
  const html = `<html><title>Obra X</title><script>const l0=-51*r</script><script type="application/json" id="data">${JSON.stringify(dados)}</script></html>`

  it('gera um modelo válido com as classes e as quantidades', () => {
    const r = converterHtml(html)
    if ('erros' in r) throw new Error(r.erros.join('; '))
    expect('modelo' in validarModelo(r.modelo)).toBe(true)
    expect(r.modelo.nome).toBe('Obra X')
    const res = resumirModelo(prepararModelo(r.modelo))
    const por = Object.fromEntries(res.classes.map((c) => [c.id, c.pecas]))
    expect(por).toMatchObject({
      'TERRA.CORTE': 3,
      'TERRA.ATERRO': 3,
      'PAV.1': 3,
      'PAV.2': 3,
      'SIN.HORIZONTAL': 6,
      'DREN.STC': 4,
      'DREN.DES': 1,
      'OAC.BUEIROS': 1,
      'SIN.VERTICAL': 1
    })
    expect(r.modelo.classes.find((c) => c.id === 'PAV.1')!.nome).toBe('Base')
    const corte = r.modelo.camadas!.filter((c) => c.classe === 'TERRA.CORTE')
    expect(corte.map((c) => c.quantidade)).toEqual([10, 50, 0])
    // 50 de corte contra 5 de aterro: a plataforma do intervalo vai para o corte
    expect(corte[1].faixas).toHaveLength(2)
  })

  it('diz o que falta num HTML que não é de modelo', () => {
    const r = converterHtml('<html><body>nada</body></html>')
    expect('erros' in r && r.erros[0]).toContain('bloco "data"')
  })
})
