/**
 * Comparação de dois planos linha a linha (página "Comparar baseline").
 *
 * Um serviço do orçamento pode ter várias tarefas (trechos, frentes, equipes), então o par entre os planos é pela
 * posição na árvore: o caminho de nomes até a raiz + o serviço, com um contador para nomes repetidos entre irmãs.
 * Uma cópia do plano (linha de base → plano em edição) pareia linha a linha; o que só existe de um lado aparece
 * sozinho, logo depois da linha anterior do seu plano. Grupos levam o período das tarefas abaixo deles.
 */

export interface LinhaPlano {
  id: string
  parent_id: string | null
  tipo_no: string
  ordem: number
  item_orcamentario_id: string | null
  nome_custom: string | null
  servico_grupo_descricao?: string | null
  data_inicio: string | null
  data_fim: string | null
}

export interface Periodo {
  inicio: string | null
  fim: string | null
}

export interface LinhaComparacao {
  key: string
  numero: string
  nivel: number
  nome: string
  grupo: boolean
  esq?: Periodo
  dir?: Periodo
  /** diferença em dias corridos (dir − esq); null sem os dois lados */
  dInicio: number | null
  dFim: number | null
}

interface No {
  key: string
  numero: string
  nivel: number
  nome: string
  grupo: boolean
  periodo: Periodo
}

const nomeDe = (t: LinhaPlano): string =>
  t.nome_custom?.trim() || t.servico_grupo_descricao?.trim() || '(sem nome)'

/** Linhas do plano em pré-ordem, com a chave de pareamento, a numeração e o período (grupos: o das filhas). */
export function arvore(linhas: readonly LinhaPlano[]): No[] {
  const ids = new Set(linhas.map((t) => t.id))
  const filhas = new Map<string | null, LinhaPlano[]>()
  for (const t of linhas) {
    const pai = t.parent_id && ids.has(t.parent_id) ? t.parent_id : null
    filhas.set(pai, [...(filhas.get(pai) ?? []), t])
  }
  for (const l of filhas.values())
    l.sort((a, b) => a.ordem - b.ordem || nomeDe(a).localeCompare(nomeDe(b), 'pt-BR'))

  const out: No[] = []
  const visitar = (
    pai: string | null,
    chavePai: string,
    numPai: string,
    nivel: number
  ): Periodo => {
    const vistos = new Map<string, number>()
    let ini: string | null = null
    let fim: string | null = null
    ;(filhas.get(pai) ?? []).forEach((t, i) => {
      const base = `${nomeDe(t)}|${t.item_orcamentario_id ?? ''}`
      const k = (vistos.get(base) ?? 0) + 1
      vistos.set(base, k)
      const key = `${chavePai}/${base}#${k}`
      const numero = numPai ? `${numPai}.${i + 1}` : String(i + 1)
      const grupo = t.tipo_no === 'grupo'
      const no: No = {
        key,
        numero,
        nivel,
        nome: nomeDe(t),
        grupo,
        periodo: { inicio: null, fim: null }
      }
      out.push(no)
      const p = grupo
        ? visitar(t.id, key, numero, nivel + 1)
        : { inicio: t.data_inicio, fim: t.data_fim }
      no.periodo = p
      if (p.inicio && (!ini || p.inicio < ini)) ini = p.inicio
      if (p.fim && (!fim || p.fim > fim)) fim = p.fim
    })
    return { inicio: ini, fim }
  }
  visitar(null, '', '', 0)
  return out
}

const dias = (a: string | null | undefined, b: string | null | undefined): number | null =>
  a && b
    ? Math.round(
        (new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000
      )
    : null

export function compararPlanos(
  esq: readonly LinhaPlano[],
  dir: readonly LinhaPlano[]
): LinhaComparacao[] {
  const a = arvore(esq)
  const b = arvore(dir)
  const linhas: LinhaComparacao[] = a.map((n) => ({
    key: n.key,
    numero: n.numero,
    nivel: n.nivel,
    nome: n.nome,
    grupo: n.grupo,
    esq: n.periodo,
    dInicio: null,
    dFim: null
  }))
  const pos = new Map(linhas.map((l, i) => [l.key, i]))
  let ultima = -1
  for (const n of b) {
    const i = pos.get(n.key)
    if (i !== undefined) {
      linhas[i]!.dir = n.periodo
      ultima = i
      continue
    }
    // só no plano da direita: logo depois da linha anterior dele
    ultima += 1
    linhas.splice(ultima, 0, {
      key: n.key,
      numero: n.numero,
      nivel: n.nivel,
      nome: n.nome,
      grupo: n.grupo,
      dir: n.periodo,
      dInicio: null,
      dFim: null
    })
    pos.clear()
    linhas.forEach((l, k) => pos.set(l.key, k))
  }
  for (const l of linhas) {
    l.dInicio = dias(l.esq?.inicio, l.dir?.inicio)
    l.dFim = dias(l.esq?.fim, l.dir?.fim)
  }
  return linhas
}
