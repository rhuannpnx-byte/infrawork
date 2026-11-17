import { validarModelo, type Modelo4D } from './contrato'
import { converterHtml, ehHtmlDeModelo } from './converter-html'
import { ehArquivoDeProjeto, montarProjeto } from './projeto'

/**
 * Lê o texto de um arquivo de modelo: o HTML da construção digital ou o JSON do contrato `infrawork-4d`, com a
 * geometria pronta (versão 1) ou com os dados de projeto (versão 2), que o InfraWork monta. `avisos` é a conferência
 * da montagem, para quem importa ver antes de gravar.
 */
export function lerModelo(
  texto: string
): { modelo: Modelo4D; origem: 'html' | 'iw4d'; avisos?: string[] } | { erros: string[] } {
  const t = texto.trimStart()
  if (t.startsWith('<') || ehHtmlDeModelo(t.slice(0, 500))) {
    if (!ehHtmlDeModelo(texto))
      return {
        erros: ['O HTML não é um modelo da construção digital (não achei o bloco de dados "data").']
      }
    const r = converterHtml(texto)
    if ('erros' in r) return r
    const v = validarModelo(r.modelo)
    return 'erros' in v ? v : { modelo: v.modelo, origem: 'html' }
  }
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    return { erros: ['O arquivo não é um HTML de modelo nem um JSON válido.'] }
  }
  if (ehArquivoDeProjeto(json)) {
    const r = montarProjeto(json)
    if ('erros' in r) return r
    const v = validarModelo(r.modelo)
    return 'erros' in v ? v : { modelo: v.modelo, origem: 'iw4d', avisos: r.avisos }
  }
  const v = validarModelo(json)
  return 'erros' in v ? v : { modelo: v.modelo, origem: 'iw4d' }
}

export async function compactar(texto: string): Promise<Blob> {
  const fluxo = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Blob([await new Response(fluxo).arrayBuffer()], { type: 'application/gzip' })
}

export async function descompactar(dados: Blob): Promise<string> {
  return new Response(dados.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

export const caminhoDoModelo = (obraId: string, modeloId: string): string =>
  `${obraId}/${modeloId}.iw4d.json.gz`
