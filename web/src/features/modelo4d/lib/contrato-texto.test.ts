import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTRATO_TEXTO } from './contrato-texto'
import { lerModelo } from './arquivo'
import type { ResumoModelo } from './preparar'
import { sugerirVinculos } from './prompt'

describe('contrato do modelo 4D', () => {
  it('docs/MODELO-4D.md traz o mesmo texto que a tela e o MCP entregam', () => {
    const doc = readFileSync(join(__dirname, '../../../../docs/MODELO-4D.md'), 'utf-8')
    expect(doc.replace(/\r\n/g, '\n')).toContain(CONTRATO_TEXTO)
  })

  it('os exemplos do contrato (dados de projeto e geometria pronta) são modelos válidos', () => {
    const exemplos = [...CONTRATO_TEXTO.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) =>
      m[1].replace(/"<[^"]*base64>"/g, '"AAAA"')
    )
    expect(exemplos.map((t) => (JSON.parse(t) as { versao: number }).versao)).toEqual([2, 1])
    for (const t of exemplos) {
      const r = lerModelo(t)
      expect('erros' in r ? r.erros : []).toEqual([])
    }
  })

  it('o exemplo em dados de projeto vira seções, camadas e elementos', () => {
    const r = lerModelo(/```json\n([\s\S]*?)\n```/.exec(CONTRATO_TEXTO)![1])
    if ('erros' in r) throw new Error(r.erros.join(' '))
    expect(r.modelo.secoes).toHaveLength(2)
    expect(new Set(r.modelo.camadas!.map((c) => c.classe))).toEqual(
      new Set([
        'TERRA.ATERRO',
        'OC.SEMEAD',
        'PAV.CBUQ',
        'PAV.IMPRIM',
        'PAV.BASE',
        'PAV.SUBBASE',
        'SIN.HORIZ'
      ])
    )
    expect(r.modelo.elementos.map((e) => e.geo.t).sort()).toEqual(['linha', 'linha', 'tubo'])
  })
})

describe('sugestão de vínculo', () => {
  const servicos = [
    { id: 's2', codigo: 'S02', descricao: 'ESCAV, CARGA E TRANSP MAT. DE 1ª CAT', unidade: 'm³' },
    { id: 's3', codigo: 'S03', descricao: 'COMPACTAÇÃO DE ATERRO / SUB-LEITO', unidade: 'm³' },
    { id: 's5', codigo: 'S05', descricao: 'SUB-BASE', unidade: 'm³' },
    { id: 's6', codigo: 'S06', descricao: 'BASE', unidade: 'm³' },
    {
      id: 's12',
      codigo: 'S12',
      descricao: 'DRENAGEM SUPERFICIAL (SARJETAS E VALETAS)',
      unidade: 'm'
    },
    { id: 's15', codigo: 'S15', descricao: 'BUEROS TUBULARES (OAC)', unidade: 'm' },
    { id: 's16', codigo: 'S16', descricao: 'BUEROS CELULARES (OAE)', unidade: 'm' }
  ]
  const classe = (
    id: string,
    nome: string,
    servico: string | null = null
  ): ResumoModelo['classes'][number] => ({
    id,
    nome,
    disciplina: 'x',
    servico,
    contexto: false,
    pecas: 1,
    s0: 0,
    s1: 1
  })

  it('vale o código que o modelo traz; sem ele, o nome', () => {
    const r = sugerirVinculos(
      [
        classe('A', 'Qualquer nome', 's06'),
        classe('TERRA.CORTE', 'Escavação (corte)'),
        classe('TERRA.ATERRO', 'Aterro compactado'),
        classe('PAV.2', 'Sub-base estabilizada granulometricamente'),
        classe('PAV.3', 'Base estabilizada granulometricamente'),
        classe('DREN.VPCC', 'VPCC · Valeta de proteção de corte em concreto')
      ],
      servicos
    )
    expect(r).toEqual({
      A: 's6',
      'TERRA.CORTE': 's2',
      'TERRA.ATERRO': 's3',
      'PAV.2': 's5',
      'PAV.3': 's6',
      'DREN.VPCC': 's12'
    })
  })

  it('na dúvida entre dois serviços, não sugere', () => {
    expect(sugerirVinculos([classe('OAC.BUEIROS', 'Bueiros')], servicos)).toEqual({})
  })
})
