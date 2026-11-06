/** Planilhas (.xlsx) que chegam pela IA: em base64 ou por URL. Usa os parsers do próprio web. */
import ExcelJS from 'exceljs'
import type { ParseResult } from '@/lib/xlsx/types'
import { z } from 'zod'

export const ARQUIVO = {
  arquivo_base64: z
    .string()
    .optional()
    .describe('planilha .xlsx em base64 (no modelo do InfraWork; peça o modelo com acao "modelo")'),
  url: z.string().url().optional().describe('ou o endereço https da planilha .xlsx')
}

export async function abrirPlanilha(a: {
  arquivo_base64?: string
  url?: string
}): Promise<ExcelJS.Workbook | null> {
  let buf: ArrayBuffer
  if (a.arquivo_base64) {
    const b = Buffer.from(a.arquivo_base64.replace(/^data:[^,]*,/, ''), 'base64')
    buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  } else if (a.url) {
    const r = await fetch(a.url)
    if (!r.ok) throw new Error(`Não consegui baixar a planilha (${r.status}).`)
    buf = await r.arrayBuffer()
  } else return null
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return wb
}

/** Resumo de um parse para a IA: válidas, erros e avisos por linha. */
export function resumoParse<T>(p: ParseResult<T>) {
  const msgs = (lista: { sheet: string; row: number; msg: string }[]) =>
    lista.map((e) => `${e.sheet} linha ${e.row}: ${e.msg}`)
  return {
    resumo: p.resumo,
    erros_gerais: msgs(p.errosGerais),
    erros: p.rows.flatMap((r) => msgs(r.erros)).slice(0, 200),
    avisos: p.rows.flatMap((r) => msgs(r.avisos)).slice(0, 200)
  }
}

export const validas = <T>(p: ParseResult<T>) => p.rows.filter((r) => r.acao !== 'erro')

export async function blobBase64(b: Blob | Promise<Blob>): Promise<string> {
  return Buffer.from(await (await b).arrayBuffer()).toString('base64')
}
