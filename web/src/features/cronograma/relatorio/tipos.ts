/** Dados do relatório de viabilidade, já lidos e calculados: cada aba recebe só o que escreve. */
import type {
  Indireto,
  ItemOrcamentario,
  ItemTreeNode,
  LucratividadeResumo,
  TaxaRegime
} from '@/types/orcamento'
import type { HistogramaResultado } from '../visoes/histograma'

export interface LinhaGantt {
  id: string
  /** Número na estrutura de tópicos (ex.: 1.2.3). */
  eap: string | null
  nome: string
  /** Profundidade na estrutura (0 = raiz). */
  nivel: number
  tipo: 'resumo' | 'tarefa' | 'marco'
  inicio: string | null
  fim: string | null
  duracaoDias: number | null
  critica: boolean
}

export interface LigacaoGantt {
  de: string
  para: string
  /** T = término, I = início: TI (padrão), II, TT, IT; EST = por estacas (desenhada como TI). */
  tipo: 'TI' | 'II' | 'TT' | 'IT' | 'EST'
  defasagemDias: number
  /** Derivada dos tipos de serviço pelo motor (tracejada), não criada pelo usuário. */
  automatica: boolean
}

export interface TaxaNoPlano extends TaxaRegime {
  /** Onde o regime entra: vigente da obra e/ou tarefas de indireto do plano. */
  uso: string
}

export interface IndiretoNoPlano {
  nome: string
  inicio: string | null
  fim: string | null
  diasUteis: number
  periodos: number
  periodicidade: 'dia' | 'mes' | 'ano'
  custoUnitario: number | null
  custoTotal: number
  receitaTotal: number
  custoTaxas: number
}

export interface AgrupadorRelatorio {
  item: ItemOrcamentario
  /** Serviço (composição) que executa o agrupador; null = sem composição ou indireto. */
  servico: { codigo: string; nome: string } | null
  receitas: Array<{ codigo: string; descricao: string; fracao: number; vendaTotal: number }>
}

export interface ItemComposicaoRelatorio {
  grupo: 'MO' | 'EQUIPAMENTO' | 'MATERIAL' | 'COMBUSTIVEL'
  recurso: string
  unidade: string
  quantidade: number
  horasDia: number | null
  consumoCombustivelLh: number | null
  indiceProdutividade: number
  consumoMaterialPorUnid: number | null
  preco: number | null
  custoDia: number
}

export interface ComposicaoRelatorio {
  servico: { codigo: string; nome: string; unidade: string | null }
  nome: string | null
  versao: number
  /** Como a composição entra no serviço (vínculo com fator) — 1 e "dividir" quando é a vigente do serviço. */
  fator: number
  operacao: 'dividir' | 'multiplicar'
  producaoDiaria: number
  unidadeProducao: string
  custoEquipamentoDia: number
  custoCombustivelDia: number
  custoMaoDeObraDia: number
  custoMaterialDia: number
  custoUnitario: number
  itens: ItemComposicaoRelatorio[]
}

export interface DadosViabilidade {
  obra: { codigo: string; nome: string }
  plano: {
    nome: string
    situacao: string
    inicio: string | null
    fim: string | null
    prazo: string | null
    calendario: { nome: string; jornadaHoras: number; diasPorSemana: number } | null
  }
  geradoEm: Date
  gantt: { linhas: LinhaGantt[]; ligacoes: LigacaoGantt[] }
  resumo: LucratividadeResumo
  taxas: TaxaNoPlano[]
  indiretoCadastro: Indireto[]
  indiretoPlano: IndiretoNoPlano[]
  orcamento: ItemTreeNode[]
  agrupadores: AgrupadorRelatorio[]
  composicoes: ComposicaoRelatorio[]
  histograma: HistogramaResultado
}
