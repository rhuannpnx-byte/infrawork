import type { VeiculoDto } from '@/types/dtos'

/** Escavadeiras e carregadeiras carregam o caminhão ("Carregado por"); os demais tipos transportam. */
const MAQUINAS_DE_CARGA = new Set(['escavadeira', 'retroescavadeira', 'carregadeira'])

export const ehMaquinaDeCarga = (v: Pick<VeiculoDto, 'tipo'>): boolean =>
  MAQUINAS_DE_CARGA.has(v.tipo)

export const rotuloVeiculo = (v: Pick<VeiculoDto, 'prefixo' | 'placa'>): string =>
  `${v.prefixo}${v.placa ? ` · ${v.placa}` : ''}`
