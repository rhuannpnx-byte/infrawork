// Config de exportação fornecida por uma página à DataTable.
// O botão "Exportar" entrega isto ao ExportDialog (via modalPayload['export']),
// que então gera CSV, Excel e PDF no navegador.

import type { RelatorioServicoInput } from '@/features/acompanhamento/lib/relatorio-servico'

export interface TableExportColumn {
  header: string
  /** numFmt do Excel quando a coluna é numérica (ex.: '#,##0.0', '0.0%'). */
  numFmt?: string
}

export interface TableExportConfig {
  /** Base do nome do arquivo (sem extensão). */
  filenameBase: string
  titulo: string
  obraNome: string
  /** Tabela plana — alimenta CSV e a aba "Comparativo" do Excel. */
  colunas: TableExportColumn[]
  linhas: Array<Array<string | number | null>>
  /**
   * Opcional: habilita o relatório rico por serviço (PDF) + abas por serviço no
   * Excel. `servicos` traz item + curva-S; o diálogo deriva séries/HTML.
   */
  relatorio?: {
    servicos: RelatorioServicoInput[]
    logoDataUrl: string
  }
  /** Opcional: abas a mais no Excel (resumos da mesma tabela), cada uma com as suas colunas e linhas. */
  abasExtras?: TableExportAba[]
}

export interface TableExportAba {
  /** nome da aba (até 28 caracteres) */
  nome: string
  titulo: string
  colunas: TableExportColumn[]
  linhas: Array<Array<string | number | null>>
  /** índices das linhas de total (ficam em negrito) */
  linhasTotal?: number[]
}
