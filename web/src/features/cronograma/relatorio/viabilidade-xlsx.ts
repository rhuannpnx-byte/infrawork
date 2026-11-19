/**
 * Relatório de viabilidade do plano, em Excel: Gantt (formas do Excel, aba protegida), premissas, orçamento com
 * rentabilidade, agrupadores, composições e os histogramas de mão de obra, equipamentos, materiais e combustíveis.
 */
import ExcelJS from 'exceljs'
import { XLSX_MIME } from '@/lib/files/download'
import { injetarDesenhos } from '@/lib/excel/desenho-xlsx'
import { montarAbaGantt } from './aba-gantt'
import { abaAgrupadores, abaComposicoes, abaOrcamento, abaPremissas, abasHistogramas } from './abas'
import type { DadosViabilidade } from './tipos'

export async function gerarRelatorioViabilidade(d: DadosViabilidade): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'InfraWork'
  wb.created = d.geradoEm
  const quando = d.geradoEm.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  const desenhoGantt = await montarAbaGantt(wb, {
    titulo: `Relatório de viabilidade · ${d.obra.codigo} ${d.obra.nome}`,
    subtitulo: `Plano: ${d.plano.nome} (${d.plano.situacao}) · gerado em ${quando}`,
    linhas: d.gantt.linhas,
    ligacoes: d.gantt.ligacoes
  })
  abaPremissas(wb, d)
  abaOrcamento(wb, d)
  abaAgrupadores(wb, d)
  abaComposicoes(wb, d)
  abasHistogramas(wb, d)
  const bruto = await wb.xlsx.writeBuffer()
  const final = await injetarDesenhos(bruto as ArrayBuffer, [desenhoGantt])
  return new Blob([final as BlobPart], { type: XLSX_MIME })
}
