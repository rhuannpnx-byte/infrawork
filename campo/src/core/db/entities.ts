import type { CatalogoDto, ObraDto, PainelDto } from '@/types/dtos'

/**
 * Entidades do banco local (IndexedDB via Dexie).
 *  - cat_obra       obras liberadas ao usuário (`campo_obras`)
 *  - cat_catalogo   um snapshot por obra (`campo_catalogo`): serviços parametrizados, equipes, encarregados, locais,
 *                   frota, origens/destinos e rotas — renovado quando a `versao` muda
 *  - out_producao   lançamentos de produção (um por serviço), idempotentes pelo id (= app_uuid no servidor)
 *  - out_ficha      fichas de viagens do dia com as viagens embutidas (um envio = uma ficha)
 *  - out_foto       fotos com o JPEG (marca d'água já queimada)
 *  - draft_ficha    fichas em andamento (várias em paralelo; sobrevivem a recarregar o app)
 *  - cat_painel     último retrato da visão estratégica por obra (`campo_painel`; só god/adm/engenheiro)
 */

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'REJEITADA'

export type CatObra = ObraDto

export interface CatPainel extends PainelDto {
  obraId: string
  fetchedAt: number
}

export interface CatCatalogo extends CatalogoDto {
  obraId: string
  fetchedAt: number
}

export interface OutProducao {
  id: string // uuid (vira app_uuid)
  obraId: string
  obraCodigo: string
  dt: string // YYYY-MM-DD
  servicoId: string
  servicoCodigo: string
  servicoNome: string
  unidade: string | null
  quantidade: number
  equipeId: string | null
  equipeNome: string | null
  encarregadoId: string | null
  encarregadoNome: string | null
  localId: string | null
  localNome: string | null
  /** estacas como digitadas (texto) e a faixa em metros internos do eixo */
  estacaInicial: string | null
  estacaFinal: string | null
  posicaoInicioM: number | null
  posicaoFimM: number | null
  materialNome: string | null
  materialUnidade: string | null
  materialQtd: number | null
  obs: string | null
  capturedAt: string
  cadastradorNome: string
  /** exclusão pedida pelo operador (vai como `excluir` no próximo envio) */
  excluir?: boolean
  syncStatus: SyncStatus
  lastSyncAttempt?: number | null
  failureReason?: string | null
  retryCount?: number
}

export interface ViagemLocal {
  id: string
  servicoId: string
  servicoNome: string
  unidade: string | null
  origemId: string | null
  origemNome: string | null
  destinoId: string | null
  destinoNome: string | null
  horaCarga: string | null
  horaDescarga: string | null
  /** na unidade do serviço, como o apontador lançou */
  quantidade: number
  materialQtd: number | null
  /** DMT efetiva mostrada no app (calculada, ou a ajustada quando dmtManual) */
  dmtKm: number | null
  dmtManual?: boolean
  dmtVia?: 'rota' | 'geometria' | 'manual' | null
  nfTicket: string | null
  /** estacas das pontas na pista (texto digitado e metros no trecho) */
  estacaCarga?: string | null
  estacaCargaM?: number | null
  estacaDescarga?: string | null
  estacaDescargaM?: number | null
  /** legado (antes da DMT pelo eixo): uma estaca só, a da ponta na pista */
  trechoId?: string | null
  estaca?: string | null
  posicaoM?: number | null
  obs: string | null
  /** máquina que carregou (escavadeira/carregadeira) */
  carregadorId?: string | null
  carregadorNome?: string | null
}

export interface FichaCabecalho {
  id: string
  obraId: string
  obraCodigo: string
  dt: string
  veiculoId: string | null
  veiculoNome: string | null
  motorista: string | null
  encarregadoId: string | null
  encarregadoNome: string | null
  equipeId: string | null
  equipeNome: string | null
  obs: string | null
}

export interface OutFicha extends FichaCabecalho {
  viagens: ViagemLocal[]
  capturedAt: string
  cadastradorNome: string
  excluir?: boolean
  syncStatus: SyncStatus
  lastSyncAttempt?: number | null
  failureReason?: string | null
  retryCount?: number
}

export interface DraftFicha extends FichaCabecalho {
  viagens: ViagemLocal[]
  lastUpdatedAt: number
}

export interface OutFoto {
  id: string // uuid (vira app_uuid)
  obraId: string
  obraCodigo: string
  empresaId: string
  /** lançamento do app a que a foto pertence (app_uuid da produção), se houver */
  producaoId: string | null
  servicoId: string | null
  servicoNome: string | null
  encarregadoId: string | null
  encarregadoNome: string | null
  equipeId: string | null
  equipeNome: string | null
  lat: number | null
  lng: number | null
  accuracy: number | null
  capturedAt: string
  /** JPEG em bytes. O Chrome do Android às vezes não grava Blob no IndexedDB ("Error preparing Blob/File data"). */
  fileData?: ArrayBuffer | null
  /** fotos gravadas antes de `fileData` */
  fileBlob?: Blob | null
  mime: string
  sizeBytes: number
  width: number | null
  height: number | null
  obs: string | null
  cadastradorNome: string
  syncStatus: SyncStatus
  lastSyncAttempt?: number | null
  failureReason?: string | null
  retryCount?: number
}
