import { z } from 'zod'
import { ctxAtual } from '../contexto'
import { ferramenta } from '../ferramenta'
import { ler, type Filtro } from '../lib/banco'
import { LEGIVEIS } from '../cobertura'

export const quemSou = ferramenta({
  nome: 'quem_sou',
  titulo: 'Quem sou eu no InfraWork',
  descricao:
    'Usuário conectado (nome, papel, empresa) e as obras que ele pode ver. Chame primeiro: quase todas as ' +
    'ferramentas pedem obra_id. Papéis: god (tudo), adm (empresa), engenheiro (obras liberadas), apoio, ' +
    'apontador (só lança), cliente (só lê).',
  entrada: {},
  leitura: true,
  cobre: { tabelas: ['profiles', 'empresas', 'obras'] },
  async executar() {
    const c = ctxAtual()
    const obras = await ler('obras', {
      colunas: 'id, codigo, nome, empresa_id, ativa, status',
      ordem: [{ coluna: 'codigo' }]
    })
    const empresas = await ler('empresas', { colunas: 'id, nome' })
    return { usuario: c.perfil, empresas, obras }
  }
})

const FILTRO = z.object({
  coluna: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is', 'not_is']),
  valor: z.any().describe('para "in", uma lista; para "is"/"not_is", null')
})

export const consultar = ferramenta({
  nome: 'consultar',
  titulo: 'Consultar tabela ou view',
  descricao:
    'Leitura genérica de qualquer tabela ou view do InfraWork que o usuário pode ver (o banco aplica as ' +
    'permissões). Use quando nenhuma ferramenta específica responde. Pagina sozinho. Para saber as colunas, ' +
    'consulte com limite 1. Tabelas e views disponíveis: ' +
    LEGIVEIS.join(', '),
  entrada: {
    tabela: z
      .string()
      .describe('nome da tabela ou view (ex.: vw_acompanhamento_previsto_x_realizado)'),
    colunas: z.string().optional().describe('select do PostgREST; padrão *'),
    filtros: z.array(FILTRO).optional(),
    ordem: z.array(z.object({ coluna: z.string(), asc: z.boolean().optional() })).optional(),
    limite: z.number().int().min(1).max(20_000).optional().describe('padrão 200')
  },
  leitura: true,
  cobre: {},
  async executar(a) {
    if (!LEGIVEIS.includes(a.tabela))
      throw new Error(
        `"${a.tabela}" não está disponível para consulta. Opções: ${LEGIVEIS.join(', ')}`
      )
    const linhas = await ler(a.tabela, {
      colunas: a.colunas,
      filtros: (a.filtros ?? []) as Filtro[],
      ordem: a.ordem,
      limite: a.limite ?? 200
    })
    return { tabela: a.tabela, n: linhas.length, linhas }
  }
})
