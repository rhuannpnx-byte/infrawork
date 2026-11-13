/**
 * Lembra, por obra, o último caminhão usado numa ficha e o motorista de cada caminhão, para a ficha seguinte já
 * abrir preenchida (o motorista era redigitado a cada ficha). Fica só no aparelho (localStorage); não vai ao servidor.
 */
const CHAVE = 'campo.carreteiro.ultimo'

interface Lembrado {
  ultimoVeiculoId: string | null
  /** motorista informado por último em cada caminhão */
  motoristas: Record<string, string>
}

export interface CabecalhoLembrado {
  veiculoId: string | null
  motorista: string | null
}

function ler(): Record<string, Lembrado> {
  try {
    const bruto = JSON.parse(window.localStorage.getItem(CHAVE) ?? '{}') as unknown
    return bruto && typeof bruto === 'object' ? (bruto as Record<string, Lembrado>) : {}
  } catch {
    return {}
  }
}

export function ultimoCabecalho(obraId: string): CabecalhoLembrado | null {
  const l = ler()[obraId]
  if (!l?.ultimoVeiculoId) return null
  return { veiculoId: l.ultimoVeiculoId, motorista: l.motoristas?.[l.ultimoVeiculoId] ?? null }
}

export function motoristaDoVeiculo(obraId: string, veiculoId: string): string | null {
  return ler()[obraId]?.motoristas?.[veiculoId] ?? null
}

export function lembrarCabecalho(obraId: string, c: CabecalhoLembrado): void {
  if (!c.veiculoId) return
  try {
    const tudo = ler()
    const motoristas = { ...(tudo[obraId]?.motoristas ?? {}) }
    const nome = c.motorista?.trim()
    if (nome) motoristas[c.veiculoId] = nome
    else delete motoristas[c.veiculoId]
    tudo[obraId] = { ultimoVeiculoId: c.veiculoId, motoristas }
    window.localStorage.setItem(CHAVE, JSON.stringify(tudo))
  } catch {
    // sem armazenamento (janela privada): só não lembra
  }
}
