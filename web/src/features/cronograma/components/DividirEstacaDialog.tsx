/**
 * Dividir por estaca (`SplitWorkSiteByStation` / diálogo "Split tasks" do ApeX): a tabela lista as tarefas, o
 * trecho, a faixa e a estaca do corte; as duas quantidades resultantes são calculadas pelo template (local "do
 * template") ou proporcionais ao comprimento (manual). A parte alta vai para a tarefa nova.
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { quantidadeNaFaixa, type SegmentoValores } from '@/lib/quantidades/segmentos'
import { cn } from '@/lib/utils'
import type { CalculoCronograma } from '../hooks/calculo'
import { traduzirErro, useDividirEstaca } from '../hooks/edicao'
import type { TarefaEntrada, TrechoEntrada } from '../motor/tipos'
import { fmtEstacaCompacta, fmtNum, lerEstaca, textoEstaca } from '../visoes/formato'

export interface AlvoDividirEstaca {
  tarefaIds: string[]
  /** trecho do corte (tempo-caminho); sem ele, o primeiro eixo da tarefa */
  trechoId?: string
  /** estaca do corte em metros internos (tempo-caminho); sem ela, o meio da faixa */
  estacaM?: number
}

interface Props {
  calc: CalculoCronograma
  alvo: AlvoDividirEstaca | null
  onFechar: () => void
}

interface Linha {
  marcada: boolean
  trechoId: string
  estaca: string
}

export function DividirEstacaDialog({ calc, alvo, onFechar }: Props): ReactNode {
  return (
    <Dialog open={!!alvo && !!calc.entrada} onOpenChange={(o) => !o && onFechar()} size="xl">
      {alvo && calc.entrada ? <Conteudo calc={calc} alvo={alvo} onFechar={onFechar} /> : null}
    </Dialog>
  )
}

function Conteudo({
  calc,
  alvo,
  onFechar
}: Omit<Props, 'alvo'> & { alvo: AlvoDividirEstaca }): ReactNode {
  const e = calc.entrada!
  const planoId = e.plano.id
  const dividir = useDividirEstaca()
  const trechos = useMemo(() => new Map(e.trechos.map((t) => [t.id, t])), [e.trechos])
  const tarefas = useMemo(
    () =>
      alvo.tarefaIds
        .map((id) => e.tarefas.find((t) => t.id === id))
        .filter((t): t is TarefaEntrada => !!t && t.tipo_no === 'tarefa'),
    [alvo.tarefaIds, e.tarefas]
  )
  const segsDe = (trechoId: string): SegmentoValores[] =>
    (e.templates[trechoId] ?? []).map((s) => ({
      ini: s.inicio_m,
      fim: s.fim_m,
      label_ini: '',
      label_fim: '',
      valores: s.valores
    }))
  const eixosDa = (t: TarefaEntrada): TrechoEntrada[] => {
    const ids = new Set(
      t.locais
        .filter(
          (l) => l.trecho_id && l.inicio_m !== null && trechos.get(l.trecho_id)?.tipo === 'eixo'
        )
        .map((l) => l.trecho_id!)
    )
    return [...ids].map((id) => trechos.get(id)!).filter(Boolean)
  }
  const faixaDe = (t: TarefaEntrada, trechoId: string): [number, number] | null => {
    const ls = t.locais.filter(
      (l) => l.trecho_id === trechoId && l.inicio_m !== null && l.fim_m !== null
    )
    if (!ls.length) return null
    return [Math.min(...ls.map((l) => l.inicio_m!)), Math.max(...ls.map((l) => l.fim_m!))]
  }

  const [linhas, setLinhas] = useState<Linha[]>(() =>
    tarefas.map((t) => {
      const eixos = eixosDa(t)
      const trechoId =
        alvo.trechoId && eixos.some((x) => x.id === alvo.trechoId)
          ? alvo.trechoId
          : (eixos[0]?.id ?? '')
      const tr = trechos.get(trechoId)
      const f = trechoId ? faixaDe(t, trechoId) : null
      const m = alvo.estacaM ?? (f ? (f[0] + f[1]) / 2 : 0)
      return { marcada: true, trechoId, estaca: tr ? textoEstaca(m, tr) : '' }
    })
  )
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  /** quantidades das duas partes no trecho do corte */
  const partes = (t: TarefaEntrada, trechoId: string, m: number): [number, number] => {
    let baixa = 0,
      alta = 0
    const segs = segsDe(trechoId)
    for (const l of t.locais) {
      if (l.trecho_id !== trechoId || l.inicio_m === null || l.fim_m === null) continue
      if (l.fim_m <= m) baixa += l.quantidade
      else if (l.inicio_m >= m) alta += l.quantidade
      else if (l.qtd_origem === 'trecho' && t.item_orcamentario_id) {
        baixa += quantidadeNaFaixa(segs, t.item_orcamentario_id, l.inicio_m, m)
        alta += quantidadeNaFaixa(segs, t.item_orcamentario_id, m, l.fim_m)
      } else {
        const f = (m - l.inicio_m) / (l.fim_m - l.inicio_m)
        baixa += l.quantidade * f
        alta += l.quantidade * (1 - f)
      }
    }
    return [baixa, alta]
  }

  const avaliar = (
    t: TarefaEntrada,
    l: Linha
  ): { m: number | null; faixa: [number, number] | null; erro: string | null } => {
    const tr = trechos.get(l.trechoId)
    const faixa = tr ? faixaDe(t, l.trechoId) : null
    if (!tr || !faixa) return { m: null, faixa: null, erro: 'sem eixo' }
    const m = lerEstaca(l.estaca, tr)
    if (m === null) return { m: null, faixa, erro: 'estaca inválida' }
    if (!(m > faixa[0] + 0.005 && m < faixa[1] - 0.005))
      return { m, faixa, erro: 'fora da faixa da tarefa' }
    return { m, faixa, erro: null }
  }

  const executar = async (): Promise<void> => {
    setErro(null)
    const fila: { t: TarefaEntrada; trechoId: string; m: number }[] = []
    for (const [i, t] of tarefas.entries()) {
      const l = linhas[i]!
      if (!l.marcada) continue
      const a = avaliar(t, l)
      if (a.erro || a.m === null) return setErro(`${t.nome}: ${a.erro}.`)
      fila.push({ t, trechoId: l.trechoId, m: Math.round(a.m * 1000) / 1000 })
    }
    if (!fila.length) return setErro('Marque ao menos uma tarefa.')
    setSalvando(true)
    try {
      for (const x of fila)
        await dividir.mutateAsync({
          planejamentoId: planoId,
          tarefaId: x.t.id,
          trechoId: x.trechoId,
          estacaM: x.m
        })
      onFechar()
    } catch (x) {
      setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
    } finally {
      setSalvando(false)
    }
  }

  const unidade = (t: TarefaEntrada): string =>
    (t.servico_id && e.servicos.find((s) => s.id === t.servico_id)?.unidade) || ''
  const nMarcadas = linhas.filter((l) => l.marcada).length

  return (
    <>
      <DialogHeader>
        <DialogTitle>Dividir por estaca</DialogTitle>
        <DialogDescription>
          A tarefa é cortada na estaca: o que fica antes continua nela, o que fica depois vai para
          uma tarefa nova (equipes e dependências copiadas). Locais “do template” continuam do
          template; manuais são divididos proporcionalmente ao comprimento.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        <div className="max-h-[50vh] overflow-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-panel text-2xs font-mono uppercase tracking-wider text-text-dim">
              <tr>
                <th className="w-8 py-1.5" />
                <th className="px-2 py-1.5 text-left">Tarefa</th>
                <th className="px-2 py-1.5 text-left w-40">Trecho</th>
                <th className="px-2 py-1.5 text-left">Faixa</th>
                <th className="px-2 py-1.5 text-left w-32">Estaca do corte</th>
                <th className="px-2 py-1.5 text-right">Quantidade</th>
                <th className="px-2 py-1.5 text-right">Parte 1</th>
                <th className="px-2 py-1.5 text-right">Parte 2 (nova)</th>
              </tr>
            </thead>
            <tbody>
              {tarefas.map((t, i) => {
                const l = linhas[i]!
                const tr = trechos.get(l.trechoId)
                const eixos = eixosDa(t)
                const a = avaliar(t, l)
                const [q1, q2] = a.m !== null && !a.erro ? partes(t, l.trechoId, a.m) : [null, null]
                const muda = (x: Partial<Linha>): void =>
                  setLinhas(linhas.map((y, j) => (j === i ? { ...y, ...x } : y)))
                return (
                  <tr
                    key={t.id}
                    className={cn('border-t border-border', !l.marcada && 'opacity-50')}
                  >
                    <td className="py-1 text-center">
                      <input
                        type="checkbox"
                        className="accent-[var(--accent)]"
                        checked={l.marcada}
                        onChange={(x) => muda({ marcada: x.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1 text-text">{t.nome}</td>
                    <td className="px-2 py-1">
                      {eixos.length > 1 ? (
                        <Select
                          value={l.trechoId}
                          className="h-6"
                          onChange={(x) => {
                            const ntr = trechos.get(x.target.value)
                            const f = faixaDe(t, x.target.value)
                            muda({
                              trechoId: x.target.value,
                              estaca: ntr && f ? textoEstaca((f[0] + f[1]) / 2, ntr) : ''
                            })
                          }}
                        >
                          {eixos.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.nome}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-text-muted">{tr?.nome ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 font-mono text-text-muted">
                      {a.faixa && tr
                        ? `${fmtEstacaCompacta(a.faixa[0], tr)} – ${fmtEstacaCompacta(a.faixa[1], tr)}`
                        : '—'}
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={l.estaca}
                        onChange={(x) => muda({ estaca: x.target.value })}
                        className={cn('h-6 font-mono', a.erro && l.marcada && 'border-danger')}
                        title={a.erro ?? 'Estaca no padrão do trecho'}
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-text-muted">
                      {fmtNum(t.quantidade, 'auto')} {unidade(t)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {q1 === null ? '—' : fmtNum(q1, 'auto')}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {q2 === null ? '—' : fmtNum(q2, 'auto')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
        <Button onClick={() => void executar()} disabled={salvando || nMarcadas === 0}>
          {salvando ? 'Dividindo…' : `Dividir ${nMarcadas} tarefa${nMarcadas === 1 ? '' : 's'}`}
        </Button>
      </DialogFooter>
    </>
  )
}
