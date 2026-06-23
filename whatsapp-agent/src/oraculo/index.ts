// Orquestra o atendimento de UMA mensagem de DM pelo Oráculo:
//   identidade → estado/triagem → contexto + LLM (tools) → resposta → log.
// Segurança: só responde a usuários habilitados/ativos; toda obra usada está
// no conjunto de obras permitidas do usuário (triagem e tools garantem isso).

import type { WASocket, WAMessageKey } from '@whiskeysockets/baileys'
import { supabase } from '../supabase.js'
import { logger } from '../logger.js'
import { enviarTexto, marcarLido } from '../reply.js'
import { identificarRemetente, obrasPermitidas, type ObraRef } from './identidade.js'
import {
  carregarConversa,
  salvarConversa,
  expirada,
  ehComandoTrocar,
  montarTriagem,
  parseEscolha
} from './conversa.js'
import { montarContexto } from './contexto.js'
import { responder, type ChatMessage } from './llm.js'
import { config } from '../config.js'

function hojeBR(): string {
  // en-CA formata como YYYY-MM-DD; fuso de São Paulo para "ontem" bater.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function systemPrompt(
  obra: ObraRef,
  contexto: unknown,
  hoje: string,
  outrasObras: ObraRef[]
): string {
  const listaOutras =
    outrasObras.length > 0
      ? outrasObras
          .slice(0, 30)
          .map((o) => `${o.codigo} - ${o.nome}`)
          .join('; ')
      : '(nenhuma)'
  return `Você é o "Oráculo" do InfraWork, assistente de engenharia de obras rodoviárias.
Obra ATIVA da conversa: *${obra.codigo} - ${obra.nome}*. Responda sobre ELA por padrão.
Data de hoje: ${hoje} (use para interpretar "ontem", "esta semana", etc.).

Troca de obra: o usuário PODE pedir dados de outra obra a qualquer momento (por nome ou código, ex.: "e na Anel Viário?", "muda pra 6.502"). Quando isso acontecer, chame a ferramenta *mudar_obra* ANTES de responder e então responda sobre a nova obra. NUNCA responda com dados de uma obra diferente da ativa sem antes trocar. Para reabrir a lista de obras, oriente a digitar *obras*.
Outras obras que este usuário pode acessar: ${listaOutras}.

Responda em pt-BR, curto e objetivo (é uma mensagem de WhatsApp). Para negrito use UM ÚNICO asterisco de cada lado (*assim*) — NUNCA use dois (**assim** não funciona no WhatsApp). Use "• " para listas.
Baseie-se SOMENTE no contexto/dados retornados pelas ferramentas. NUNCA invente números. Se não houver registro, diga que não há.

Ferramentas:
• mudar_obra — troca a obra ativa (use quando o usuário citar outra obra).
• producao_periodo — produção apontada num período (já convertida para a unidade do InfraWork).
• composicao_servico — composição/CPU de um serviço (produção diária, custo unitário, insumos por grupo).
• previsto_x_realizado — planejamento da SEMANA por serviço (linha de base) + andamento/atraso/risco.

Ao responder "o que está previsto para a semana" (ou quanto produzir de um serviço na semana), use SEMPRE a tool previsto_x_realizado e responda com NÚMEROS da linha de base, por serviço. NÃO decida sozinho se está atrasado ou adiantado — use SEMPRE o campo "atrasado" que a tool retorna:
1) Sempre diga o previsto da semana pela linha de base: "segundo o cronograma, devem ser feitos *X unidade* de <serviço> nesta semana" (previsto_semana_baseline + unidade).
2) Se atrasado=true: acrescente que, por estar atrasado, para manter o término planejado é preciso entregar *necessario_semana unidade* na semana (sempre ≥ previsto da base).
3) Se atrasado=false: diga que está no ritmo/adiantado e que o ritmo atual sustenta o prazo; NÃO peça mais que a base. Nunca proponha número acima de qtd_restante nem de qtd_plan_total.
4) Se atrasado=null ou previsto_semana_baseline=0: trate como não iniciado/sem previsão de base na semana (não invente números).
• buscar_fotos — envia fotos do serviço/período pedido (as imagens vão automaticamente; só confirme o que foi enviado).

Contexto atual da obra (orçamento, produção e planejamento), em JSON:
${JSON.stringify(contexto)}`
}

async function registrarLog(
  sessaoId: string,
  jid: string,
  userId: string,
  obraId: string | null,
  pergunta: string,
  resposta: string,
  tools: string[],
  erro?: string
): Promise<void> {
  const { data: c } = await supabase
    .from('whatsapp_oraculo_conversa')
    .select('id')
    .eq('sessao_id', sessaoId)
    .eq('remetente_jid', jid)
    .maybeSingle()
  await supabase.from('whatsapp_oraculo_log').insert({
    conversa_id: c?.id ?? null,
    user_id: userId,
    obra_id: obraId,
    pergunta,
    resposta,
    tools,
    erro: erro ?? null
  })
}

export async function atenderDM(
  sock: WASocket,
  sessaoId: string,
  jid: string,
  texto: string,
  senderPn?: string | null,
  msgKey?: WAMessageKey
): Promise<void> {
  // Identidade pelo TELEFONE real (senderPn). O remoteJid pode ser um @lid (novo
  // endereçamento do WhatsApp), que não contém o número.
  const profile = await identificarRemetente(senderPn || jid)
  if (!profile) return // número não habilitado → ignora em silêncio (sem vazamento)

  // Responde SEMPRE no mesmo JID em que a mensagem chegou (`jid`). Para DMs com o
  // novo endereçamento do WhatsApp esse é o @lid — e é nessa identidade que o
  // aparelho do usuário estabeleceu a sessão Signal. Responder no PN
  // (senderPn, @s.whatsapp.net) usa OUTRA sessão libsignal: a 1ª mensagem até
  // passa, mas os ratchets das duas sessões divergem e as seguintes chegam como
  // "mensagem de versão anterior" indecifrável (o aparelho reinicia a sessão a
  // cada msg). `senderPn` serve apenas para identificar o usuário, nunca para enviar.
  const replyJid = jid

  // marca como lida (comportamento humano) só para quem atendemos
  if (msgKey) await marcarLido(sock, msgKey)

  const obras = await obrasPermitidas(profile)
  logger.info(
    { nome: profile.nome, role: profile.role, obras: obras.length },
    'oráculo: remetente identificado'
  )
  if (obras.length === 0) {
    await enviarTexto(sock, replyJid, 'Você ainda não tem obras liberadas para consulta.')
    return
  }

  const conversa = await carregarConversa(sessaoId, jid)
  const obrasById = new Map(obras.map((o) => [o.id, o]))

  // obra da sessão — válida só dentro da janela deslizante (expira por inatividade)
  let obraSel: ObraRef | null = null
  if (conversa && conversa.estado === 'ativa' && conversa.obra_id && !expirada(conversa)) {
    obraSel = obrasById.get(conversa.obra_id) ?? null
  }

  // comando para trocar de obra → re-triagem (mesmo com 1 obra, reapresenta)
  if (ehComandoTrocar(texto)) {
    const { texto: lista, mapa } = montarTriagem(obras)
    await salvarConversa(sessaoId, jid, profile.id, {
      obra_id: null,
      estado: 'triagem',
      opcoes_obra: mapa
    })
    await enviarTexto(sock, replyJid, lista)
    return
  }

  // ainda sem obra fixada → triagem
  if (!obraSel) {
    // resposta a uma triagem pendente? (só dentro da janela — uma triagem
    // antiga já não vale: a mensagem inicia uma triagem NOVA, não é "escolha".)
    if (conversa && conversa.estado === 'triagem' && conversa.opcoes_obra && !expirada(conversa)) {
      const escolhido = parseEscolha(texto, conversa.opcoes_obra)
      const obra = escolhido ? obrasById.get(escolhido) : undefined
      if (obra) {
        await salvarConversa(sessaoId, jid, profile.id, {
          obra_id: obra.id,
          estado: 'ativa',
          opcoes_obra: null
        })
        await enviarTexto(
          sock,
          replyJid,
          `✅ Obra *${obra.codigo} - ${obra.nome}* selecionada. Pode mandar sua pergunta (orçamento, planejamento, produção ou fotos).`
        )
        return
      }
      // escolha não reconhecida (ex.: saudação) → só reapresenta a triagem,
      // sem expor "não entendi" (pode soar como erro para o usuário).
      const { texto: lista } = montarTriagem(obras)
      await enviarTexto(sock, replyJid, lista)
      return
    }

    // primeira interação: 1 obra → auto-seleciona e segue; N obras → triagem
    if (obras.length === 1) {
      obraSel = obras[0]
      await salvarConversa(sessaoId, jid, profile.id, {
        obra_id: obraSel.id,
        estado: 'ativa',
        opcoes_obra: null
      })
    } else {
      const { texto: lista, mapa } = montarTriagem(obras)
      await salvarConversa(sessaoId, jid, profile.id, {
        obra_id: null,
        estado: 'triagem',
        opcoes_obra: mapa
      })
      // Triagem direta, sem expor o conceito interno de "sessão expirou".
      await enviarTexto(sock, replyJid, lista)
      return
    }
  }

  // ── responde com o LLM; a obra pode ser trocada via tool mudar_obra ──────
  const outras = obras.filter((o) => o.id !== obraSel.id)
  const ctx = {
    obra: obraSel,
    obras,
    obrasPermitidasIds: new Set(obras.map((o) => o.id)),
    sock,
    jid: replyJid,
    hoje: hojeBR(),
    trocou: false
  }
  let resposta = ''
  let toolsUsadas: string[] = []
  let erro: string | undefined
  try {
    const contexto = await montarContexto(obraSel.id)
    const historico = (conversa?.historico ?? []).filter(
      (m) => m.role === 'user' || m.role === 'assistant'
    )
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(obraSel, contexto, ctx.hoje, outras) },
      ...historico,
      { role: 'user', content: texto }
    ]
    const r = await responder(messages, ctx)
    resposta = r.texto
    toolsUsadas = r.toolsUsadas
  } catch (e) {
    erro = String(e)
    logger.error({ err: e, obra: ctx.obra.codigo }, 'erro ao responder no oráculo')
    resposta = 'Tive um problema ao consultar os dados agora. Tente novamente em instantes.'
  }

  await enviarTexto(sock, replyJid, resposta)

  // a obra ativa pode ter mudado durante a resposta (tool mudar_obra)
  const obraFinal = ctx.obra

  // atualiza histórico (só texto, limitado) e registra log
  const novoHistorico = [
    ...(conversa?.historico ?? []).filter((m) => m.role === 'user' || m.role === 'assistant'),
    { role: 'user' as const, content: texto },
    { role: 'assistant' as const, content: resposta }
  ].slice(-config.oraculoHistoricoMax * 2)
  await salvarConversa(sessaoId, jid, profile.id, {
    obra_id: obraFinal.id,
    estado: 'ativa',
    historico: novoHistorico
  })
  await registrarLog(sessaoId, jid, profile.id, obraFinal.id, texto, resposta, toolsUsadas, erro)
}

/** Extrai o texto de uma mensagem (conversation / extendedTextMessage). */
export function extrairTexto(msg: {
  message?: {
    conversation?: string | null
    extendedTextMessage?: { text?: string | null } | null
  } | null
}): string | null {
  const m = msg.message
  if (!m) return null
  const t = m.conversation ?? m.extendedTextMessage?.text ?? null
  const limpo = (t ?? '').trim()
  return limpo.length > 0 ? limpo : null
}
