import { describe, expect, it } from 'vitest'
import {
  equipamentosDeCarga,
  extrairToken,
  FormatoFleetHubError,
  parseEquipamentos,
  parseObras,
  tipoInfraWork
} from '../../../supabase/functions/_shared/fleethub-parse'

const linha = (id: number, cod: string, placa: string, tipo: string, obra: string): string => `
  <tr>
    <th scope="row">${id}</th>
    <th scope="row">${cod}</th>
    <td>${placa}</td>
    <td>${tipo}</td>
    <td>Marca</td>
    <td>Modelo X</td>
    <td>2021</td>
    <td>${obra}</td>
    <td><div class="row justify-content-center"></div></td>
  </tr>`

const pagina = (
  linhas: string,
  cabecalho = ['ID', 'Código', 'Placa', 'Tipo', 'Marca', 'Modelo', 'Ano', 'Obra', 'Ação']
): string => `
<html><head><meta name="csrf-token" content="tok123"></head><body>
<select name="obraEquipamento[]" multiple><option value="95">OBRA 220</option><option value="91">OBRA 216</option></select>
<table id="table" class="table datatable">
  <thead><tr>${cabecalho.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
  <tbody>${linhas}</tbody>
</table></body></html>`

const html = pagina(
  linha(48, 'CBE0005', 'AAA0A00', 'CAMINHAO BASCULANTE', 'OBRA 220') +
    linha(41, 'PCE0004', '', 'PA CARREGADEIRA', 'OBRA 220') +
    linha(52, 'VLT0001', 'BBB1B11', 'VEICULO LEVE', 'OBRA 216') +
    linha(77, 'CBT0010', 'CCC2C22', 'Caminhão  Pipa', 'OBRA 216')
)

describe('página de equipamentos da FleetHub', () => {
  it('lê todas as linhas', () => {
    const eq = parseEquipamentos(html)
    expect(eq).toHaveLength(4)
    expect(eq[0]).toEqual({
      fleet_id: 48,
      codigo: 'CBE0005',
      placa: 'AAA0A00',
      tipo: 'CAMINHAO BASCULANTE',
      marca: 'Marca',
      modelo: 'Modelo X',
      ano: 2021,
      obra: 'OBRA 220'
    })
    expect(eq[1]!.placa).toBeNull()
  })

  it('só transporte de carga e máquinas de carga, com o tipo do InfraWork', () => {
    const c = equipamentosDeCarga(parseEquipamentos(html))
    expect(c.map((e) => [e.codigo, e.tipo_infrawork])).toEqual([
      ['CBE0005', 'basculante'],
      ['PCE0004', 'carregadeira'],
      ['CBT0010', 'pipa']
    ])
    expect(tipoInfraWork('Escavadeira Hidráulica')).toBe('escavadeira')
    expect(tipoInfraWork('ESC. HIDRAULICA C/ ROMPEDOR')).toBeNull()
  })

  it('obras do filtro e token', () => {
    expect(parseObras(html)).toEqual([
      { fleet_id: 95, nome: 'OBRA 220' },
      { fleet_id: 91, nome: 'OBRA 216' }
    ])
    expect(extrairToken(html)).toBe('tok123')
  })

  it('formato diferente para a leitura (não grava lixo)', () => {
    expect(() => parseEquipamentos('<html>login</html>')).toThrow(FormatoFleetHubError)
    expect(() => parseEquipamentos(pagina('', ['ID', 'Placa', 'Código']))).toThrow(
      /Colunas da FleetHub mudaram/
    )
    expect(parseEquipamentos(pagina('<tr><td colspan="9">Nenhum registro</td></tr>'))).toEqual([])
  })
})
