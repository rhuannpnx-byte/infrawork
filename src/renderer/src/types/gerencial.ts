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
  created_at: string
}

export interface UsuarioComEmpresa extends UsuarioRow {
  empresa?: { id: string; nome: string } | null
  engenheiro?: { id: string; nome: string } | null
}

export type UnidadeEspacoPadrao = 'km' | 'm' | 'estaca'

export interface Obra {
  id: string
  empresa_id: string
  nome: string
  codigo: string
  status: string
  /** Unidade de display padrão pra posições espaciais (km|m|estaca). Default 'km'. */
  unidade_espaco_padrao: UnidadeEspacoPadrao
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
