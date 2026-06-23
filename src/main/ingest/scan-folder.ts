// Varredura recursiva de pastas para a ingestão da Documentação Oficial.
//
// Detecta arquivos OneDrive "disponível apenas online" (placeholders Files
// On-Demand) por heurística de alocação física: um placeholder reporta
// `size > 0` mas `blocks === 0` (não há bytes no disco). A HIDRATAÇÃO em si
// não acontece aqui — acontece quando o conteúdo é lido (lerArquivoBytes),
// o que faz o OneDrive baixar o arquivo automaticamente. Aqui só sinalizamos.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface ArquivoVarrido {
  path: string
  nome: string
  tamanho: number
  mtime: number
  online_only: boolean
}

export interface VarreduraResultado {
  arquivos: ArquivoVarrido[]
  total: number
  online_only: number
}

// Extensões de documento que interessam ao repositório (ignora ruído).
const EXTENSOES = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
  '.zip',
  '.rar',
  '.msg',
  '.eml',
  '.txt',
  '.csv'
])

// Pastas a pular durante a varredura.
const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])

function temExtensaoRelevante(nome: string): boolean {
  const i = nome.lastIndexOf('.')
  if (i < 0) return false
  return EXTENSOES.has(nome.slice(i).toLowerCase())
}

/**
 * Varre `root` recursivamente e devolve os documentos encontrados, sinalizando
 * os que estão "online-only" no OneDrive. Limita profundidade para segurança.
 */
export async function scanFolder(root: string, maxDepth = 12): Promise<VarreduraResultado> {
  const arquivos: ArquivoVarrido[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // sem permissão / removido durante a varredura → ignora
    }
    for (const ent of entries) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        await walk(full, depth + 1)
        continue
      }
      if (!ent.isFile()) continue
      if (!temExtensaoRelevante(ent.name)) continue
      try {
        const st = await stat(full)
        // Heurística OneDrive Files On-Demand: arquivo lógico com tamanho > 0
        // mas sem blocos alocados no disco = placeholder "apenas online".
        const onlineOnly = st.size > 0 && st.blocks === 0
        arquivos.push({
          path: full,
          nome: ent.name,
          tamanho: st.size,
          mtime: st.mtimeMs,
          online_only: onlineOnly
        })
      } catch {
        // ignora arquivos inacessíveis
      }
    }
  }

  await walk(root, 0)
  return {
    arquivos,
    total: arquivos.length,
    online_only: arquivos.filter((a) => a.online_only).length
  }
}
