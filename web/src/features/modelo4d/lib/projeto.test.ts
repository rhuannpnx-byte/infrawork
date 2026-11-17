import { describe, expect, it } from 'vitest'
import { lerModelo } from './arquivo'
import { dispositivoDeDrenagem, espelhar } from './catalogo'
import { validarModelo } from './contrato'
import { montarProjeto, type ArquivoProjeto, type EstacaNS } from './projeto'

/** Estaca com corte à esquerda (off-set acima do bordo) e aterro à direita (off-set abaixo). */
const estaca = (s: number, extra: Partial<EstacaNS> = {}): EstacaNS => ({
  s,
  e: 750000 + s,
  n: 8180000,
  z: 100.35,
  zt: 100,
  zn: 100.5,
  ie: -2,
  id: -2,
  esq: [
    [6.6, 99.87],
    [9.6, 102.87]
  ],
  dir: [
    [6.6, 99.87],
    [11.1, 96.87]
  ],
  ...extra
})

const arquivo = (mudar: (a: ArquivoProjeto) => void = () => {}): ArquivoProjeto => {
  const a: ArquivoProjeto = {
    formato: 'infrawork-4d',
    versao: 2,
    nome: 'Trecho de teste',
    origem: { e: 750000, n: 8180000, fuso: '22S' },
    classes: [
      { id: 'CORTE', nome: 'Escavação', disciplina: 'Terraplenagem', terreno: true },
      { id: 'ATERRO', nome: 'Aterro', disciplina: 'Terraplenagem', terreno: true },
      { id: 'BASE', nome: 'Base', disciplina: 'Pavimentação' },
      { id: 'CBUQ', nome: 'CBUQ', disciplina: 'Pavimentação' },
      { id: 'DREN', nome: 'Drenagem', disciplina: 'Drenagem' },
      { id: 'OAC', nome: 'Bueiros', disciplina: 'Obras de arte correntes' },
      { id: 'CERCA', nome: 'Cerca', disciplina: 'Obras complementares' }
    ],
    projeto: {
      secao_tipo: { pista: 3.5, acostamento: 2, faixa_dominio: 80 },
      pavimento: [
        { classe: 'CBUQ', onde: 'pista', espessura: 0.05 },
        { classe: 'BASE', onde: 'tudo', espessura: 0.3, sobra: 0.3 }
      ],
      terraplenagem: { corte: 'CORTE', aterro: 'ATERRO' },
      nota_servico: [{ estacas: [estaca(0), estaca(20), estaca(40)] }],
      cubacao: [
        {
          volumes: [
            [20, 10, 80],
            [40, 12, 90]
          ]
        }
      ],
      drenagem: [
        { tipo: 'STC 73-15', lado: 'E', s0: 0, s1: 40, classe: 'DREN' },
        { tipo: 'MFC 03', lado: 'D', s0: 0, s1: 40, classe: 'DREN' }
      ],
      descidas: [{ s: 20, lado: 'D', classe: 'DREN' }],
      bueiros: [{ s: 20, tipo: 'BDTC', diametro: 1, comprimento: 20, classe: 'OAC' }],
      cercas: [{ lado: 'E', s0: 0, s1: 40, classe: 'CERCA' }]
    }
  }
  mudar(a)
  return a
}

const montar = (
  a: ArquivoProjeto
): Extract<ReturnType<typeof montarProjeto>, { modelo: unknown }> => {
  const r = montarProjeto(a)
  if ('erros' in r) throw new Error(r.erros.join(' '))
  return r
}

describe('montarProjeto', () => {
  it('monta um modelo válido a partir das tabelas do projeto', () => {
    const { modelo } = montar(arquivo())
    expect('modelo' in validarModelo(modelo)).toBe(true)
    expect(modelo.versao).toBe(1)
    expect(modelo.eixos[0].pontos).toHaveLength(3)
    expect(modelo.eixos[0].pontos[1]).toEqual([20, 20, 0, 100.35])
    expect(modelo.secoes).toHaveLength(3)
  })

  it('desenha a seção do off-set ao off-set, com o pavimento no caimento da nota de serviço', () => {
    const { modelo } = montar(arquivo())
    const perfil = modelo.secoes![0].perfil
    const afast = perfil.map((p) => p[0])
    expect(afast).toEqual([...afast].sort((a, b) => a - b))
    expect(perfil[0]).toEqual([-9.6, 102.87])
    expect(perfil[perfil.length - 1]).toEqual([11.1, 96.87])
    // bordo do acostamento a 5,5 m, 2% abaixo do eixo
    expect(perfil).toContainEqual([5.5, 100.24])
    expect(perfil).toContainEqual([-3.5, 100.28])
    // no aterro o bordo do pavimento desce até a plataforma; no corte, a faixa da sarjeta vai direto ao bordo
    expect(perfil.filter((p) => p[0] > 5.5 && p[0] < 6.6)).toHaveLength(1)
    expect(perfil.filter((p) => p[0] < -5.5 && p[0] > -6.6)).toHaveLength(0)
  })

  it('separa corte e aterro pelo lado e leva o volume da cubação', () => {
    const { modelo } = montar(arquivo())
    const corte = modelo.camadas!.filter((c) => c.classe === 'CORTE')
    const aterro = modelo.camadas!.filter((c) => c.classe === 'ATERRO')
    expect(corte.map((c) => c.quantidade)).toEqual([10, 12])
    expect(aterro.map((c) => c.quantidade)).toEqual([80, 90])
    expect(corte[0].faixas).toEqual([[-1e6, -6.6]])
    // aterro: o lado direito e a plataforma, rebaixada sob o pavimento
    expect(aterro[0].faixas[0]).toEqual([6.6, 1e6])
    expect(aterro[0].faixas).toContainEqual([-5.5, 5.5, -0.35])
  })

  it('empilha o pavimento de cima para baixo', () => {
    const { modelo } = montar(arquivo())
    const cbuq = modelo.camadas!.find((c) => c.classe === 'CBUQ')!
    const base = modelo.camadas!.find((c) => c.classe === 'BASE')!
    expect(cbuq).toMatchObject({ s0: 0, s1: 40, elevacao: 0, espessura: 0.05 })
    expect(cbuq.faixas).toEqual([[-3.5, 3.5]])
    expect(base.faixas).toEqual([
      [-5.8, -3.5, 0],
      [-3.5, 3.5, -0.05],
      [3.5, 5.8, 0]
    ])
  })

  it('põe cada dispositivo no lugar dele na seção', () => {
    const { modelo } = montar(arquivo())
    const el = (trecho: string): (typeof modelo.elementos)[number] =>
      modelo.elementos.find((e) => e.nome?.includes(trecho))!
    const stc = el('STC 73-15')
    expect(stc.geo.t).toBe('linha')
    // sarjeta à esquerda, encostada no bordo do acostamento (n local positivo = lado esquerdo neste eixo)
    if (stc.geo.t === 'linha') {
      expect(stc.geo.pts[0][1]).toBeCloseTo(5.5 + 0.03 + 0.365, 2)
      expect(stc.geo.perfil).toEqual(espelhar(dispositivoDeDrenagem('STC 73-15')!.perfil))
    }
    const bueiro = modelo.elementos.find((e) => e.geo.t === 'tubo')!
    expect(bueiro.geo).toMatchObject({ t: 'tubo', linhas: 2, diametro: 1 })
    expect(bueiro.quantidade).toBe(40)
    const cerca = el('Cerca')
    expect(cerca.no_terreno).toBe(true)
    if (cerca.geo.t === 'linha') expect(cerca.geo.pts[0][1]).toBeCloseTo(40, 2)
    expect(modelo.elementos.filter((e) => e.nome?.includes('Descida'))).toHaveLength(2)
  })

  it('avisa o que merece conferência', () => {
    const { avisos } = montar(
      arquivo((a) => {
        a.projeto.nota_servico[0].estacas[1] = estaca(20, { ie: 4, id: 4 })
        a.projeto.drenagem!.push({ tipo: 'XYZ 10', lado: 'D', s0: 0, s1: 40, classe: 'DREN' })
        a.projeto.descidas!.push({ s: 20, lado: 'E', classe: 'DREN' })
      })
    )
    const texto = avisos.join('\n')
    expect(texto).toMatch(/1 estacas com os dois bordos acima do eixo/)
    expect(texto).toMatch(/fora do catálogo.*XYZ/)
    expect(texto).toMatch(/1 descidas d'água em estaca sem aterro/)
    expect(texto).toMatch(/Volumes pelas seções/)
  })

  it('recusa o projeto que cita classe inexistente ou vem sem nota de serviço', () => {
    const semClasse = montarProjeto(
      arquivo((a) => {
        a.projeto.drenagem![0].classe = 'NAO_EXISTE'
      })
    )
    expect('erros' in semClasse && semClasse.erros[0]).toMatch(/NAO_EXISTE/)
    const semNota = montarProjeto(
      arquivo((a) => {
        a.projeto.nota_servico = []
      })
    )
    expect('erros' in semNota && semNota.erros.join(' ')).toMatch(/nota_servico/)
  })

  it('é lido pelo mesmo leitor dos outros modelos, com a conferência', () => {
    const r = lerModelo(JSON.stringify(arquivo()))
    expect('modelo' in r && r.origem).toBe('iw4d')
    expect('modelo' in r && (r.avisos?.length ?? 0) > 0).toBe(true)
  })
})

describe('catálogo de drenagem', () => {
  it('tira as medidas do código do dispositivo', () => {
    const stc = dispositivoDeDrenagem('STC 88-20')!
    expect(stc.largura).toBeCloseTo(0.88)
    expect(Math.min(...stc.perfil.map((p) => p[1]))).toBeCloseTo(-0.28)
    const val = dispositivoDeDrenagem('VPAC 160-30')!
    expect(val.posicao).toBe('pe')
    expect(dispositivoDeDrenagem('VPCC 120-30')!.posicao).toBe('crista')
    expect(dispositivoDeDrenagem('VPAG 120-30')!.material).toBe('grama')
    expect(dispositivoDeDrenagem('ABC 1')).toBeNull()
  })
})
