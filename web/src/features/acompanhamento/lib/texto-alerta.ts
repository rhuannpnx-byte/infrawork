import { contar } from '@/lib/rotulos'

const dataBR = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/')

/**
 * Título e descrição do alerta chegam prontos da função que recalcula os alertas. Aqui só se ajusta a escrita
 * para a tela: sem travessão como separador, sem "(s)", sem "baseline" e com a data em dia/mês/ano.
 */
export function textoAlerta(texto: string | null | undefined): string {
  if (!texto) return ''
  return texto
    .replace(/\s+—\s+/g, ': ')
    .replace(/(\d+) lançamento\(s\)/g, (_, n: string) =>
      contar(Number(n), 'lançamento', 'lançamentos')
    )
    .replace(/\bdo baseline\b/gi, 'da linha de base')
    .replace(/\bno baseline\b/gi, 'na linha de base')
    .replace(/\bbaseline\b/gi, 'linha de base')
    .replace(/\bp50 diário\b/gi, 'mediana diária de')
    .replace(/ vs /g, ' contra ')
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (iso: string) => dataBR(iso))
}

const pct = (v: unknown): string => `${Math.round(Number(v) * 100)}%`

/** O que do contexto do alerta interessa a quem lê, já com rótulo. Identificadores ficam de fora. */
const CONTEXTO: Record<string, (v: unknown) => string | null> = {
  codigo: (v) => `Serviço ${String(v)}`,
  equipe_nome: (v) => `Equipe ${String(v)}`,
  mes: (v) => {
    const [ano, mes] = String(v).split('-')
    return ano && mes ? `Mês ${mes}/${ano}` : null
  },
  semana: (v) => {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(String(v))
    return m ? `Semana ${Number(m[2])} de ${m[1]}` : null
  },
  ratio: (v) => (Number.isFinite(Number(v)) ? `${pct(v)} do esperado` : null),
  n: (v) => contar(Number(v), 'lançamento', 'lançamentos'),
  dias_sem: (v) => `${contar(Number(v), 'dia', 'dias')} sem lançamento`,
  dias_atraso: (v) => `${contar(Number(v), 'dia', 'dias')} de atraso`,
  datas: (v) =>
    Array.isArray(v) && v.length
      ? `${v.length === 1 ? 'Dia' : 'Dias'} ${v.map((d) => dataBR(String(d)).slice(0, 5)).join(', ')}`
      : null
}

export function contextoAlerta(contexto: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = []
  for (const [chave, valor] of Object.entries(contexto ?? {})) {
    if (valor == null) continue
    const texto = CONTEXTO[chave]?.(valor)
    if (texto) out.push(texto)
  }
  return out
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias". */
export function tempoDesde(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (!Number.isFinite(s) || s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`
  return `há ${contar(Math.floor(s / 86400), 'dia', 'dias')}`
}
