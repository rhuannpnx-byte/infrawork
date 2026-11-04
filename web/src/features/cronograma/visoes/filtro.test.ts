import { describe, expect, it } from 'vitest'
import type { PlanoEntrada, TarefaEntrada } from '../motor/tipos'
import { aplicarFiltro, FILTRO_VAZIO, SEM_LOCAL_FILTRO } from './filtro'

const tarefa = (p: Partial<TarefaEntrada> & { id: string }): TarefaEntrada =>
  ({
    tipo_no: 'tarefa',
    parent_id: null,
    ordem: 0,
    nome: p.id,
    item_orcamentario_id: null,
    servico_id: null,
    is_indireto: false,
    quantidade: 1,
    prioridade: 500,
    asap: true,
    inicio_dia: false,
    sentido: 'crescente',
    restricao_inicio: null,
    restricao_inicio_em: null,
    restricao_fim: null,
    restricao_fim_em: null,
    coef_producao: 1,
    qtd_equipes: 1,
    calendario_id: null,
    derivar_predecessoras: true,
    equipes_ids: [],
    locais: [],
    inicio_em: null,
    venda_unitaria: null,
    venda_total_item: null,
    quantidade_referencia: null,
    custo_unitario_item: null,
    indireto: null,
    ...p
  }) as TarefaEntrada

const local = (trecho_id: string | null): TarefaEntrada['locais'][number] => ({
  id: `l-${trecho_id}`,
  ordem: 0,
  trecho_id,
  inicio_m: trecho_id ? 0 : null,
  fim_m: trecho_id ? 100 : null,
  quantidade: 1,
  qtd_origem: 'manual'
})

const e = {
  tarefas: [
    tarefa({ id: 'g1', tipo_no: 'grupo' }),
    tarefa({ id: 'g2', tipo_no: 'grupo' }),
    tarefa({
      id: 'a',
      parent_id: 'g1',
      servico_id: 's1',
      locais: [local('t1')],
      equipes_ids: ['q1']
    }),
    tarefa({ id: 'b', parent_id: 'g1', servico_id: 's2', locais: [local('t2')] }),
    tarefa({ id: 'c', parent_id: 'g2', servico_id: 's1', locais: [] })
  ],
  dependencias: [
    { id: 'd1', predecessora_id: 'a', sucessora_id: 'b', tipo: 'FS' },
    { id: 'd2', predecessora_id: 'a', sucessora_id: 'c', tipo: 'FS' }
  ]
} as unknown as PlanoEntrada

const ids = (x: PlanoEntrada): string[] => x.tarefas.map((t) => t.id)

describe('aplicarFiltro', () => {
  it('sem critérios devolve a entrada como está', () => {
    expect(aplicarFiltro(e, FILTRO_VAZIO)).toBe(e)
  })
  it('por tarefa-resumo: as filhas e o próprio resumo', () => {
    expect(ids(aplicarFiltro(e, { ...FILTRO_VAZIO, resumo: 'g1' }))).toEqual(['g1', 'a', 'b'])
  })
  it('por trecho (e "sem local"), mantendo os ancestrais e só as dependências internas', () => {
    const r = aplicarFiltro(e, { ...FILTRO_VAZIO, trechos: ['t1', SEM_LOCAL_FILTRO] })
    expect(ids(r)).toEqual(['g1', 'g2', 'a', 'c'])
    expect(r.dependencias.map((d) => d.id)).toEqual(['d2'])
  })
  it('por serviço e por equipe se combinam (E)', () => {
    expect(ids(aplicarFiltro(e, { ...FILTRO_VAZIO, servicos: ['s1'], equipes: ['q1'] }))).toEqual([
      'g1',
      'a'
    ])
  })
})
