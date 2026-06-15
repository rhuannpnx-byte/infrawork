export type Role = 'god' | 'adm' | 'engenheiro' | 'apoio' | 'cliente'

export interface AuthProfile {
  id: string
  email: string
  nome: string
  role: Role
  empresa_id: string | null
  engenheiro_id: string | null
  ativo: boolean
}

export interface AuthEmpresa {
  id: string
  nome: string
}

export interface AuthObra {
  id: string
  nome: string
  codigo: string
  status: string
  empresa_id: string
}

export interface MePayload {
  profile: AuthProfile
  empresa: AuthEmpresa | null
  obras: AuthObra[]
}
