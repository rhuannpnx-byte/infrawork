/** Prompts prontos (fluxos comuns) — aparecem como atalhos nos clientes que suportam prompts MCP. */
export interface Prompt {
  nome: string
  titulo: string
  descricao: string
  argumentos: string[]
  texto: (a: Record<string, string | undefined>) => string
}

const obra = (a: Record<string, string | undefined>) =>
  a.obra ? `a obra ${a.obra}` : 'a obra (pergunte qual, depois de chamar quem_sou)'

export const PROMPTS: Prompt[] = [
  {
    nome: 'montar_obra',
    titulo: 'Montar uma obra do zero',
    descricao: 'Do cadastro da obra até a linha de base, seguindo o guia.',
    argumentos: ['obra', 'arquivos'],
    texto: (a) =>
      `Leia o recurso infrawork://guia e monte ${obra(a)} no InfraWork seguindo a ordem do guia: obra e locais, ` +
      `recursos, composições, orçamento com agrupamento, vínculo das composições, calendário, equipes, plano, ` +
      `quantidades por local, tarefas e linha de base. ${a.arquivos ? `Use estes arquivos: ${a.arquivos}. ` : ''}` +
      `Mostre um resumo antes de cada ação em massa e peça confirmação.`
  },
  {
    nome: 'importar_orcamento',
    titulo: 'Importar orçamento e agrupar',
    descricao: 'Sobe a planilha de venda, agrupa as receitas em serviços e liga as composições.',
    argumentos: ['obra'],
    texto: (a) =>
      `Para ${obra(a)}: importe a planilha orçamentária (orcamento_importar; mostre a prévia), confira os ` +
      `agrupadores e o rateio (agrupadores.listar), ligue cada serviço à composição certa (composicoes.listar → ` +
      `agrupadores.editar servico_id) e aponte os serviços que ficaram sem composição.`
  },
  {
    nome: 'planejar_quantidades',
    titulo: 'Planejar a partir das quantidades por local',
    descricao: 'Distribui as quantidades nos trechos, gera as tarefas e calcula o cronograma.',
    argumentos: ['obra'],
    texto: (a) =>
      `Para ${obra(a)}: confira as quantidades por local (quantidades_locais.ler/totais), gere as tarefas do ` +
      `plano em edição (quantidades_locais.criar_tarefas), ajuste equipes e dependências e mostre o cronograma ` +
      `calculado (cronograma.ler, com as críticas).`
  },
  {
    nome: 'lancar_viagens',
    titulo: 'Lançar as viagens do dia',
    descricao: 'Registra as fichas de viagem de um dia e confere a produção gerada.',
    argumentos: ['obra', 'data'],
    texto: (a) =>
      `Para ${obra(a)}, no dia ${a.data ?? '(pergunte a data)'}: confira os locais (estaca e distância do ` +
      `acesso) e as distâncias fixas (transporte.listar) e a medição de cada serviço (parametros_servico.listar: ` +
      `volume ou peso). Registre as fichas (viagens.salvar, uma por veículo), com a estaca de carga/descarga ` +
      `quando a ponta é pista, a quantidade que o usuário informar (na unidade do serviço, sem aplicar ` +
      `empolamento por conta própria) e o ticket quando é por peso. Mostre a DMT calculada de cada viagem ` +
      `(viagens.listar) e a produção resultante (producao.listar).`
  },
  {
    nome: 'situacao_obra',
    titulo: 'Situação da obra',
    descricao: 'Previsto × realizado, atrasos, alertas e medição do mês.',
    argumentos: ['obra'],
    texto: (a) =>
      `Faça um resumo da situação de ${obra(a)}: analises.resumo e previsto_realizado (serviços atrasados ` +
      `primeiro), alertas abertos e o valor agregado do mês (analises.valor_agregado).`
  }
]
