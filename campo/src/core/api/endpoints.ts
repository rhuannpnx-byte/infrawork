import { BUCKET_FOTOS, supabase } from '@/core/supabase'
import type {
  PainelDto,
  CatalogoDto,
  FichaDto,
  FotoMetaDto,
  ObraDto,
  ProducaoBatchResponse,
  ProducaoRegistroDto,
} from '@/types/dtos'
import { ApiError, comPrazo, paraApiError } from './fetchClient'

/**
 * Camada de API do app de campo: o InfraWork Web (Supabase) no lugar do backend Fastify/SIGA do Monito.
 * Leituras com prazo curto (sinal fraco = "offline" e a tela usa o cache local); envios com prazo folgado
 * (abortar cedo um envio que o servidor gravou só gera reenvio — que é idempotente, mas desperdiça dados).
 */
const PRAZO_LEITURA = 20_000
const PRAZO_ENVIO = 90_000
const PRAZO_UPLOAD = 5 * 60_000

async function rpc<T>(nome: string, args: Record<string, unknown>, prazo: number): Promise<T> {
  try {
    const { data, error } = await comPrazo(supabase.rpc(nome, args), prazo)
    if (error) throw error
    return data as T
  } catch (e) {
    throw paraApiError(e)
  }
}

export interface LoginResultado {
  userId: string
  email: string
  nome: string
  role: string
  empresaId: string | null
  accessToken: string
  expiresAtEpochMs: number
}

export const authEndpoints = {
  async login(email: string, senha: string): Promise<LoginResultado> {
    let res
    try {
      res = await comPrazo(
        supabase.auth.signInWithPassword({ email, password: senha }),
        PRAZO_LEITURA,
      )
    } catch (e) {
      throw paraApiError(e)
    }
    if (res.error || !res.data.session) {
      const m = res.error?.message ?? ''
      if (/invalid login|invalid credentials/i.test(m))
        throw new ApiError(401, 'E-mail ou senha inválidos')
      throw paraApiError(res.error ?? new Error('Falha no login'))
    }
    const s = res.data.session
    const { data: perfil, error } = await supabase
      .from('profiles')
      .select('nome, role, empresa_id, ativo')
      .eq('id', s.user.id)
      .single()
    if (error || !perfil) throw paraApiError(error ?? new Error('Perfil não encontrado'))
    if (!perfil.ativo) {
      await supabase.auth.signOut()
      throw new ApiError(403, 'Usuário inativo')
    }
    if (perfil.role === 'cliente') {
      await supabase.auth.signOut()
      throw new ApiError(403, 'Este usuário não lança produção')
    }
    return {
      userId: s.user.id,
      email: s.user.email ?? email,
      nome: (perfil.nome as string) || email,
      role: perfil.role as string,
      empresaId: (perfil.empresa_id as string | null) ?? null,
      accessToken: s.access_token,
      expiresAtEpochMs: (s.expires_at ?? 0) * 1000,
    }
  },
  async logout(): Promise<void> {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  },
}

export const catalogEndpoints = {
  /** Obras em que o usuário pode lançar. */
  obras: () => rpc<ObraDto[]>('campo_obras', {}, PRAZO_LEITURA),
  /** Catálogo da obra (serviços parametrizados, equipes, encarregados, locais, frota, origens/destinos, rotas). */
  catalogo: (obraId: string) =>
    rpc<CatalogoDto>('campo_catalogo', { _obra_id: obraId }, PRAZO_LEITURA),
  /** Visão estratégica da obra (só god, adm e engenheiro — o servidor confere). */
  painel: (obraId: string) => rpc<PainelDto>('campo_painel', { _obra_id: obraId }, PRAZO_LEITURA),
}

export const syncEndpoints = {
  producao: (registros: ProducaoRegistroDto[]) =>
    rpc<ProducaoBatchResponse>('campo_sync_producao', { _registros: registros }, PRAZO_ENVIO),

  ficha: (ficha: FichaDto) =>
    rpc<{ ficha_id: string; viagens: number; versao?: string }>(
      'campo_sync_ficha',
      { _ficha: ficha },
      PRAZO_ENVIO,
    ),

  /** Upload direto ao bucket (a política de storage confere a obra) + registro idempotente da foto. */
  async foto(meta: FotoMetaDto, arquivo: Blob): Promise<{ id: string; duplicada: boolean }> {
    try {
      const up = await comPrazo(
        supabase.storage.from(BUCKET_FOTOS).upload(meta.storage_key, arquivo, {
          contentType: meta.mime,
          // sem upsert: o apontador só insere (não lê nem sobrescreve o bucket); reenvio cai em "já existe" = ok
          upsert: false,
        }),
        PRAZO_UPLOAD,
      )
      if (up.error && !/already exists|duplicate/i.test(up.error.message)) throw up.error
    } catch (e) {
      throw paraApiError(e)
    }
    return rpc('campo_registrar_foto', { _meta: meta }, PRAZO_ENVIO)
  },

  /** URL assinada (15 min) de uma foto já enviada — quando o blob local foi descartado pelo navegador. */
  async fotoSignedUrl(storageKey: string): Promise<string> {
    try {
      const { data, error } = await comPrazo(
        supabase.storage.from(BUCKET_FOTOS).createSignedUrl(storageKey, 15 * 60),
        PRAZO_LEITURA,
      )
      if (error || !data) throw error ?? new Error('sem URL')
      return data.signedUrl
    } catch (e) {
      throw paraApiError(e)
    }
  },
}
