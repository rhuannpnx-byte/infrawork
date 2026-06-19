// Estado da conversa do Oráculo (persistido em whatsapp_oraculo_conversa) e a
// lógica de triagem (afunilar para UMA obra por sessão).

import { supabase } from '../supabase.js'
import { config } from '../config.js'
import type { ObraRef } from './identidade.js'
import type { ChatMessage } from './llm.js'

export interface Conversa {
  id: string
  sessao_id: string
  remetente_jid: string
  user_id: string | null
  obra_id: string | null
  estado: 'triagem' | 'ativa'
  opcoes_obra: Record<string, string> | null
  historico: ChatMessage[]
  ultima_interacao: string
}

export async function carregarConversa(
  sessaoId: string,
  jid: string
): Promise<Conversa | null> {
  const { data } = await supabase
    .from('whatsapp_oraculo_conversa')
    .select('id, sessao_id, remetente_jid, user_id, obra_id, estado, opcoes_obra, historico, ultima_interacao')
    .eq('sessao_id', sessaoId)
    .eq('remetente_jid', jid)
    .maybeSingle()
  return (data as Conversa) ?? null
}

export async function salvarConversa(
  sessaoId: string,
  jid: string,
  userId: string,
  patch: Partial<Pick<Conversa, 'obra_id' | 'estado' | 'opcoes_obra' | 'historico'>>
): Promise<void> {
  await supabase.from('whatsapp_oraculo_conversa').upsert(
    {
      sessao_id: sessaoId,
      remetente_jid: jid,
      user_id: userId,
      ultima_interacao: new Date().toISOString(),
      ...patch
    },
    { onConflict: 'sessao_id,remetente_jid' }
  )
}

/** true se a sessão expirou (passou da janela deslizante de inatividade) — a
 *  obra deve ser re-escolhida. A janela reinicia a cada interação. */
export function expirada(c: Conversa | null): boolean {
  if (!c) return false
  const ms = Date.now() - new Date(c.ultima_interacao).getTime()
  return ms > config.oraculoSessaoTtlMin * 60_000
}

// Comando explícito para reabrir a lista numerada de obras.
const RE_TROCAR = /^\s*(trocar\s+obra|mudar\s+obra|outra\s+obra|obras?|menu|trocar)\s*$/i

export function ehComandoTrocar(texto: string): boolean {
  return RE_TROCAR.test(texto.trim())
}

/** Acha uma obra pela busca livre (código ou nome) dentro das permitidas.
 *  Retorna o match único, ou candidatos quando ambíguo/nenhum. */
export function acharObra(
  obras: ObraRef[],
  busca: string
): { match: ObraRef | null; candidatos: ObraRef[] } {
  const q = busca
    .trim()
    .toLowerCase()
    .replace(/\bobra\b/g, '')
    .trim()
  if (!q) return { match: null, candidatos: [] }

  // 1) código exato (ignora pontuação: "6508" casa "6.508")
  const qDig = q.replace(/\D/g, '')
  const porCodigo = obras.filter((o) => {
    const cod = o.codigo.toLowerCase()
    return cod === q || (qDig.length > 0 && cod.replace(/\D/g, '') === qDig)
  })
  if (porCodigo.length === 1) return { match: porCodigo[0], candidatos: [] }

  // 2) contém no código ou no nome
  const contem = obras.filter(
    (o) => o.codigo.toLowerCase().includes(q) || o.nome.toLowerCase().includes(q)
  )
  if (contem.length === 1) return { match: contem[0], candidatos: [] }
  return { match: null, candidatos: contem }
}

/** Monta a lista numerada de obras + o mapa "N" → obra_id. */
export function montarTriagem(obras: ObraRef[]): { texto: string; mapa: Record<string, string> } {
  const mapa: Record<string, string> = {}
  const linhas = obras.map((o, i) => {
    const n = String(i + 1)
    mapa[n] = o.id
    return `Para *${o.codigo} - ${o.nome}* digite ${n}`
  })
  const texto = `Tenho as informações aqui. Sobre qual obra você deseja saber?\n\n${linhas.join('\n')}`
  return { texto, mapa }
}

/** Interpreta uma resposta de triagem (número escolhido) → obra_id ou null. */
export function parseEscolha(texto: string, mapa: Record<string, string> | null): string | null {
  if (!mapa) return null
  const m = texto.trim().match(/\d+/)
  if (!m) return null
  return mapa[m[0]] ?? null
}
