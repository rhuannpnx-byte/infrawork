// Ferramentas (tool-calling estilo OpenAI) do Oráculo. Todas escopadas à obra
// FIXA da sessão (o LLM não escolhe obra) e revalidam a obra ∈ permitidas antes
// de qualquer query (defesa em profundidade).

import type { WASocket } from '@whiskeysockets/baileys'
import { supabase } from '../supabase.js'
import { logger } from '../logger.js'
import { enviarImagem, enviarTexto } from '../reply.js'
import type { ObraRef } from './identidade.js'
import { buscarFotos } from './fotos.js'
import { acharObra } from './conversa.js'
import { montarContexto } from './contexto.js'
import { buscarComposicao } from './composicao.js'

export interface ToolCtx {
  /** Obra ATIVA da sessão. Mutável: a tool mudar_obra reatribui em tempo real. */
  obra: ObraRef
  /** Todas as obras que o usuário pode acessar (para troca por nome/código). */
  obras: ObraRef[]
  obrasPermitidasIds: Set<string>
  sock: WASocket
  jid: string
  hoje: string // YYYY-MM-DD (data corrente no fuso do agente)
  /** Marcado true quando a obra foi trocada nesta interação (para persistir). */
  trocou: boolean
}

/** Definições expostas ao LLM. Nenhuma recebe obra_id — a obra é fixa na sessão. */
export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'mudar_obra',
      description:
        'Troca a obra ativa da conversa quando o usuário pedir para falar de OUTRA obra (por nome ou código, ex.: "e na Anel Viário?", "muda pra 6.502"). SEMPRE chame esta ferramenta antes de responder sobre uma obra diferente da ativa. Se houver ambiguidade, ela retorna candidatos para você confirmar com o usuário.',
      parameters: {
        type: 'object',
        properties: {
          busca: { type: 'string', description: 'Nome ou código da obra desejada' }
        },
        required: ['busca']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'producao_periodo',
      description:
        'Soma a produção apontada da obra em um período, agrupada por serviço. As quantidades JÁ vêm convertidas para a unidade do InfraWork (fator de conversão do vínculo aplicado) — use sempre a "qtd" e a "unidade" retornadas, nunca a quantidade bruta do SIGA. Use para "produção de ontem/da semana/do dia X". Datas YYYY-MM-DD; se omitidas, usa os últimos 7 dias.',
      parameters: {
        type: 'object',
        properties: {
          data_inicio: { type: 'string', description: 'YYYY-MM-DD' },
          data_fim: { type: 'string', description: 'YYYY-MM-DD' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'composicao_servico',
      description:
        'Composição de preço unitário (CPU) de um serviço da obra: produção diária, custo unitário e os insumos por grupo (equipamento, combustível, mão de obra, material) com quantidades/consumos e custos. Use para "composição/CPU/custo do serviço X", "o que entra no serviço Y".',
      parameters: {
        type: 'object',
        properties: {
          servico: { type: 'string', description: 'Nome ou código do serviço (ex.: "CBUQ", "micro revestimento")' }
        },
        required: ['servico']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'previsto_x_realizado',
      description:
        'Comparativo previsto × realizado por serviço/tarefa da obra (avanço %, desvio de prazo, status). Use para perguntas de andamento, atraso, o que está em risco.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_fotos',
      description:
        'Envia ao usuário as fotos georreferenciadas da obra que casem com o serviço e/ou período. As imagens são enviadas automaticamente no WhatsApp. Datas YYYY-MM-DD.',
      parameters: {
        type: 'object',
        properties: {
          servico: { type: 'string', description: 'Texto do serviço (ex.: "CBUQ", "drenagem")' },
          data_inicio: { type: 'string', description: 'YYYY-MM-DD' },
          data_fim: { type: 'string', description: 'YYYY-MM-DD' }
        }
      }
    }
  }
] as const

function diasAtras(hoje: string, n: number): string {
  const d = new Date(`${hoje}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Executa uma tool e devolve um JSON-string com o resultado para o LLM. */
export async function executarTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<string> {
  // defesa em profundidade: a obra da sessão tem de estar entre as permitidas
  if (!ctx.obrasPermitidasIds.has(ctx.obra.id)) {
    return JSON.stringify({ erro: 'Sem permissão para esta obra.' })
  }
  const obraId = ctx.obra.id

  try {
    if (name === 'mudar_obra') {
      const busca = String(args.busca ?? '')
      const { match, candidatos } = acharObra(ctx.obras, busca)
      if (match) {
        ctx.obra = match // reatribui a obra ativa para o resto desta interação
        ctx.trocou = true
        await enviarTexto(ctx.sock, ctx.jid, `📍 Agora na obra *${match.codigo} - ${match.nome}*.`)
        // devolve o contexto novo já pronto para o modelo responder na hora
        const contexto = await montarContexto(match.id)
        return JSON.stringify({
          ok: true,
          obra: { codigo: match.codigo, nome: match.nome },
          contexto
        })
      }
      if (candidatos.length > 1) {
        return JSON.stringify({
          ambiguo: true,
          opcoes: candidatos.map((o) => `${o.codigo} - ${o.nome}`)
        })
      }
      return JSON.stringify({
        nao_encontrada: true,
        disponiveis: ctx.obras.slice(0, 15).map((o) => `${o.codigo} - ${o.nome}`)
      })
    }

    if (name === 'producao_periodo') {
      const dataFim = (args.data_fim as string) || ctx.hoje
      const dataInicio = (args.data_inicio as string) || diasAtras(dataFim, 7)
      // View enriquecida: aplica o vínculo SIGA→InfraWork (fator_conversao) e
      // traz a UNIDADE do InfraWork. Reportamos a qtd CONVERTIDA, não a bruta.
      const { data } = await supabase
        .from('vw_acompanhamento_producao_enriquecida')
        .select(
          'servico_display_nome, siga_servico_nome, servico_unidade, siga_unidade_nome, qtd, qtd_convertida, fator_conversao, equipe_display_nome, siga_equipe_nome'
        )
        .eq('obra_id', obraId)
        .gte('data', dataInicio)
        .lte('data', dataFim)
      const linhas = data ?? []
      const porServico = new Map<
        string,
        { qtd: number; unidade: string; fator: number | null; convertido: boolean }
      >()
      const equipes = new Set<string>()
      for (const l of linhas) {
        const convertido = l.qtd_convertida != null
        const nome =
          (l.servico_display_nome as string) || (l.siga_servico_nome as string) || 'Serviço'
        const unidade =
          (l.servico_unidade as string) || (l.siga_unidade_nome as string) || ''
        const cur =
          porServico.get(nome) ?? { qtd: 0, unidade, fator: (l.fator_conversao as number) ?? null, convertido }
        cur.qtd += Number(l.qtd_convertida ?? l.qtd) || 0
        // se qualquer registro do serviço não tem conversão, sinaliza
        if (!convertido) cur.convertido = false
        porServico.set(nome, cur)
        const eq = (l.equipe_display_nome as string) || (l.siga_equipe_nome as string)
        if (eq) equipes.add(eq)
      }
      return JSON.stringify({
        periodo: { inicio: dataInicio, fim: dataFim },
        registros: linhas.length,
        equipes: [...equipes],
        observacao:
          'Quantidades já na unidade do InfraWork (fator de conversão do vínculo aplicado). convertido=false indica serviço sem vínculo (valor bruto do SIGA).',
        por_servico: [...porServico.entries()].map(([servico, v]) => ({
          servico,
          qtd: Number(v.qtd.toFixed(2)),
          unidade: v.unidade,
          fator_conversao: v.fator,
          convertido: v.convertido
        }))
      })
    }

    if (name === 'composicao_servico') {
      const r = await buscarComposicao(obraId, String(args.servico ?? ''))
      return JSON.stringify(r)
    }

    if (name === 'previsto_x_realizado') {
      const { data } = await supabase
        .from('vw_acompanhamento_previsto_x_realizado')
        .select(
          'codigo, descricao, unidade, qtd_plan, qtd_real, pct_avanco, status, desvio_dias_estimado, data_fim_plan'
        )
        .eq('obra_id', obraId)
        .limit(200)
      const linhas = data ?? []
      // prioriza o que está atrasado/em risco, depois em andamento
      const peso: Record<string, number> = {
        atrasado: 0,
        em_risco: 1,
        em_andamento: 2,
        no_prazo: 3,
        adiantado: 4,
        nao_iniciado: 5,
        concluido: 6,
        sem_plano: 7
      }
      linhas.sort((a, b) => (peso[a.status as string] ?? 9) - (peso[b.status as string] ?? 9))
      return JSON.stringify({
        total_itens: linhas.length,
        itens: linhas.slice(0, 25).map((l) => ({
          codigo: l.codigo,
          descricao: l.descricao,
          unidade: l.unidade,
          qtd_plan: l.qtd_plan,
          qtd_real: l.qtd_real,
          pct_avanco: l.pct_avanco,
          status: l.status,
          desvio_dias: l.desvio_dias_estimado,
          fim_previsto: l.data_fim_plan
        }))
      })
    }

    if (name === 'buscar_fotos') {
      const r = await buscarFotos(obraId, {
        servico: (args.servico as string) ?? null,
        dataInicio: (args.data_inicio as string) ?? null,
        dataFim: (args.data_fim as string) ?? null
      })
      if (r.fotos.length === 0) {
        return JSON.stringify({ enviadas: 0, total: 0, mensagem: 'Nenhuma foto encontrada para esse filtro.' })
      }
      // efeito colateral: envia as imagens diretamente ao usuário
      for (const f of r.fotos) {
        await enviarImagem(ctx.sock, ctx.jid, f.buffer, f.caption)
      }
      if (r.hasMore) {
        await enviarTexto(
          ctx.sock,
          ctx.jid,
          `Enviei ${r.fotos.length} de ${r.total} fotos. Refine por serviço ou período para ver outras.`
        )
      }
      return JSON.stringify({ enviadas: r.fotos.length, total: r.total, hasMore: r.hasMore })
    }

    return JSON.stringify({ erro: `Ferramenta desconhecida: ${name}` })
  } catch (e) {
    logger.error({ err: e, tool: name }, 'erro ao executar tool do oráculo')
    return JSON.stringify({ erro: 'Falha ao consultar os dados.' })
  }
}
