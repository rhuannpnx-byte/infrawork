import { describe, expect, it } from 'vitest'
import {
  cubagemM3,
  equipamentosDeCarga,
  extrairToken,
  FormatoFleetHubError,
  parseEquipamentos,
  parseCapacidade,
  parseObras,
  temCubagem,
  textoCapacidade,
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

describe('cubagem da FleetHub', () => {
  const editar = (valor: string, unidade: string): string => `
    <label id="capacidade_label">Capacidade *</label>
    <div class="input-group" id="capacidade_group" data-unidade-salva="${unidade}">
      <input id="capacidade" list="capacidades" type="text" class="form-control" name="capacidade" value="${valor}" maxlength="21">
      <datalist id="capacidades"><option value="99"></option></datalist>
    </div>`

  it('lê valor e unidade salva da página de edição', () => {
    expect(parseCapacidade(editar('15.98', 'm³'))).toEqual({ valor: '15.98', unidade: 'm³' })
    expect(parseCapacidade(editar('14 M&sup3;', ''))).toEqual({ valor: '14 M³', unidade: '' })
    expect(() => parseCapacidade('<html>login</html>')).toThrow(FormatoFleetHubError)
  })

  it('converte para m³ só quando dá para confiar', () => {
    expect(cubagemM3('16,12', 'm³')).toBe(16.12)
    expect(cubagemM3('15.98', '')).toBe(15.98)
    expect(cubagemM3('14 M³', '')).toBe(14)
    expect(cubagemM3('12M³', '')).toBe(12)
    expect(cubagemM3('14 M/3', '')).toBe(14)
    expect(cubagemM3('20.000 L', '')).toBe(20)
    expect(cubagemM3('20000', 'L')).toBe(20)
    expect(cubagemM3('10.000 LITROS', '')).toBe(10)
    // toneladas não viram cubagem
    expect(cubagemM3('15.98', 'ton')).toBeNull()
    expect(cubagemM3('18.08 TON', '')).toBeNull()
    // lixo e valores fora de 2–60 m³
    expect(cubagemM3('1', '')).toBeNull()
    expect(cubagemM3('0', '')).toBeNull()
    expect(cubagemM3('139', '')).toBeNull()
    expect(cubagemM3('*.*', '')).toBeNull()
    expect(cubagemM3('', '')).toBeNull()
    expect(cubagemM3('15,07', 'L')).toBeNull()
  })

  it('texto como aparece na FleetHub', () => {
    expect(textoCapacidade('15.98', 'ton')).toBe('15.98 ton')
    expect(textoCapacidade('20.000 L', 'L')).toBe('20.000 L')
    expect(textoCapacidade('  ', 'm³')).toBeNull()
  })

  it('cavalo mecânico e máquinas de carga não têm cubagem', () => {
    expect(temCubagem({ tipo: 'CAMINHÃO BASCULANTE', tipo_infrawork: 'basculante' })).toBe(true)
    expect(temCubagem({ tipo: 'CAMINHAO PIPA', tipo_infrawork: 'pipa' })).toBe(true)
    expect(temCubagem({ tipo: 'CAVALO MECÂNICO', tipo_infrawork: 'carreta' })).toBe(false)
    expect(temCubagem({ tipo: 'PÁ CARREGADEIRA', tipo_infrawork: 'carregadeira' })).toBe(false)
  })
})
