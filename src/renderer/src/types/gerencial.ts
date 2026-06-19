import type { Role } from './auth'

export interface Empresa {
  id: string
  nome: string
  cnpj: string | null
  ativo: boolean
  created_at: string
}

export interface UsuarioRow {
  id: string
  email: string
  nome: string
  role: Role
  empresa_id: string | null
  engenheiro_id: string | null
  ativo: boolean
  /** Número de WhatsApp (dígitos, formato internacional). Foundation do RAG. */
  whatsapp: string | null
  created_at: string
}

export interface UsuarioComEmpresa extends UsuarioRow {
  empresa?: { id: string; nome: string } | null
  engenheiro?: { id: string; nome: string } | null
  /** Rastreio de acesso/presença (visível só p/ God). */
  acessos_count?: number | null
  last_access_at?: string | null
  last_seen_at?: string | null
}

export type UnidadeEspacoPadrao = 'km' | 'm' | 'estaca' | 'custom'

/**
 * Paleta de cores predefinidas pra trechos. Cores escolhidas pra contrastar
 * entre si em mapas multi-trecho e serem distintas das cores de equipe
 * (EQUIPE_CORES_PADRAO em types/planejamento.ts).
 */
export const TRECHO_CORES_PADRAO = [
  '#3b82f6', // azul
  '#22c55e', // verde
  '#eab308', // amarelo
  '#f97316', // laranja
  '#ef4444', // vermelho
  '#a855f7', // roxo
  '#06b6d4', // ciano
  '#d946ef'  // magenta
]

export interface Obra {
  id: string
  empresa_id: string
  nome: string
  codigo: string
  status: string
  created_at: string
}

export interface ObraComEmpresa extends Obra {
  empresa?: { id: string; nome: string }
}

export interface ObraPermissao {
  id: string
  obra_id: string
  user_id: string
  concedido_por: string
  created_at: string
  /** Profile do usuário com permissão (engenheiro). */
  usuario?: { id: string; nome: string; email: string; role: Role }
  /** Profile de quem concedeu. */
  concedente?: { id: string; nome: string }
}

/**
 * Trecho de obra — segmento independente com estaqueamento/km proprio.
 * Obra pode ter N trechos. Tarefa referencia 1 trecho (FK NOT NULL).
 * Cada trecho carrega sua unidade de display (km|m|estaca|custom).
 *
 * Geometria e OPCIONAL — trecho pode existir sem mapa. Quando preenchida,
 * `geometry_geojson` traz uma LineString GeoJSON; `geometry_sentido` indica
 * se a UI deve renderizar a coordenada na ordem natural do KML ou invertida.
 */
export interface ObraTrecho {
  id: string
  obra_id: string
  nome: string
  ordem: number
  unidade_espaco_padrao: UnidadeEspacoPadrao
  cor: string
  /** Label da unidade quando `unidade_espaco_padrao = 'custom'`. */
  unidade_custom_label: string | null
  /** Quantos metros equivalem a 1 unidade quando `unidade_espaco_padrao = 'custom'`. */
  unidade_custom_divisor_m: number | null
  /** Valor da unidade no inicio da polilinha (ex: 5 = trecho comeca no km 5). */
  marcador_valor_inicial: number
  /** GeoJSON LineString completo (com sentido ja aplicado se invertido na UI). */
  geometry_geojson: GeoJSON.LineString | null
  geometry_bounds: { south: number; west: number; north: number; east: number } | null
  geometry_comprimento_m: number | null
  geometry_sentido: 'natural' | 'invertido'
  geometry_importado_em: string | null
  created_at: string
  updated_at: string
}
