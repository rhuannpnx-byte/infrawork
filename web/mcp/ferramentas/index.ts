import type { Ferramenta } from '../ferramenta'
import { consultar, quemSou } from './contexto'
import { obras, trechos, usuarios } from './gerencial'
import { agrupadores, orcamentoImportar, orcamentoItens, orcamentoResumo } from './orcamento'
import { aditivos, indiretos, notasItem, reajustes, taxas } from './orcamento-extra'
import { composicoes, recursos, servicosCatalogo } from './composicoes'
import { cronograma, dependencias, planos, tarefas } from './planejamento'
import { calendarios, equipes, quantidadesLocais } from './planejamento-extra'
import {
  alertas,
  fotos,
  frota,
  parametrosServico,
  producao,
  transporte,
  viagens
} from './acompanhamento'
import { analises } from './analises'

/** Todas as ferramentas do MCP (a ordem é a da lista mostrada aos clientes). */
export const FERRAMENTAS = [
  quemSou,
  consultar,
  obras,
  usuarios,
  trechos,
  orcamentoImportar,
  orcamentoItens,
  agrupadores,
  orcamentoResumo,
  indiretos,
  notasItem,
  aditivos,
  reajustes,
  taxas,
  recursos,
  composicoes,
  servicosCatalogo,
  planos,
  tarefas,
  dependencias,
  cronograma,
  quantidadesLocais,
  calendarios,
  equipes,
  producao,
  parametrosServico,
  transporte,
  viagens,
  frota,
  alertas,
  fotos,
  analises
] as unknown as Ferramenta[]
