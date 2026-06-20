// Estado de autenticação do Baileys persistido na coluna
// `whatsapp_sessao.creds` (jsonb). Mantém creds + keys em memória e grava o
// blob completo (serializado via BufferJSON). Assim a sessão sobrevive a
// reinícios do container e troca de host.
//
// IMPORTANTE (Signal/libsignal): a persistência das chaves NÃO pode ser
// debounced. Cada `keys.set` avança o ratchet da sessão; se a escrita atrasar e
// houver uma reconexão (que recarrega o estado do banco), o ratchet rebobina e
// o destinatário passa a receber mensagens "de versão anterior" que não
// decifram. Por isso `set` aguarda a gravação, com as escritas serializadas em
// fila para não se sobreporem nem se perderem.

import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys'
import type { AuthenticationCreds, AuthenticationState } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'
import { logger } from './logger.js'

type KeyStore = Record<string, Record<string, unknown>>

export interface SupabaseAuthState {
  state: AuthenticationState
  saveCreds: () => Promise<void>
}

export async function useSupabaseAuthState(sessaoId: string): Promise<SupabaseAuthState> {
  const { data } = await supabase
    .from('whatsapp_sessao')
    .select('creds')
    .eq('id', sessaoId)
    .single()

  let stored: { creds: AuthenticationCreds; keys: KeyStore } | null = null
  if (data?.creds) {
    try {
      stored = JSON.parse(JSON.stringify(data.creds), BufferJSON.reviver)
    } catch (e) {
      logger.warn({ err: e }, 'creds armazenadas inválidas — recriando do zero')
    }
  }

  const creds: AuthenticationCreds = stored?.creds ?? initAuthCreds()
  const keys: KeyStore = stored?.keys ?? {}

  // Grava o estado atual completo. Captura `creds`/`keys` no momento da execução,
  // então uma gravação enfileirada já inclui todas as mudanças acumuladas.
  const persist = async (): Promise<void> => {
    const serialized = JSON.parse(JSON.stringify({ creds, keys }, BufferJSON.replacer))
    const { error } = await supabase
      .from('whatsapp_sessao')
      .update({ creds: serialized })
      .eq('id', sessaoId)
    if (error) logger.error({ error }, 'falha ao persistir creds')
  }

  // Serializa as gravações: nunca há duas escritas concorrentes na mesma linha,
  // e quem chama aguarda até sua escrita (e as anteriores) concluírem.
  let chain: Promise<void> = Promise.resolve()
  const persistQueued = (): Promise<void> => {
    chain = chain.then(persist, persist)
    return chain
  }

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: { [id: string]: any } = {}
        const store = keys[type] ?? {}
        for (const id of ids) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let value: any = store[id]
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value)
          }
          if (value !== undefined) out[id] = value
        }
        return out
      },
      set: async (data) => {
        for (const type of Object.keys(data)) {
          const typeData = (data as Record<string, Record<string, unknown>>)[type]
          keys[type] = keys[type] ?? {}
          for (const id of Object.keys(typeData)) {
            const value = typeData[id]
            if (value === null || value === undefined) delete keys[type][id]
            else keys[type][id] = value
          }
        }
        // Aguarda a gravação: o ratchet precisa estar durável antes de o Baileys
        // seguir para a próxima mensagem.
        await persistQueued()
      }
    }
  }

  return { state, saveCreds: persistQueued }
}
