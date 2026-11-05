/**
 * Criar tarefas (o "Insert task" do ApeX + a criação de tarefas da importação de quantidades do DynaRoad):
 *  - **Das quantidades por local**: matriz serviços × locais com o que o template ainda tem livre (não coberto por
 *    tarefas "do template"); uma tarefa por sequência contígua (padrão do DynaRoad), uma por local, ou uma por janela
 *    de N metros; os locais ficam "do template" e acompanham a planilha.
 *  - **Manual**: serviço, quantidade e local (eixo com estaca inicial/final, área ou sem local), manual ou do template.
 * Custos indiretos viram tarefas de indireto (a janela vem das diretas).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
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
import { TabPill } from '@/components/ui/TabPill'
import { useTrechosQuantidadeTemplatesAtuais } from '@/features/planejamento/hooks/trechos'
import { useItensSincronizaveis } from '@/features/planejamento/hooks/tarefas'
import { useCriarTarefaIndireta } from '@/features/planejamento/hooks/indireto-config'
import { IndiretoCampos } from './IndiretoCampos'
import { FORM_INDIRETO_PADRAO, inputDoForm, type FormIndireto } from './indireto-form'
import { segmentosDoTemplate } from '@/features/planejamento/lib/trecho'
import {
  faixasDeDivisao,
  faixasLivresDoServico,
  quantidadeNaFaixa,
  type SegmentoValores
} from '@/lib/quantidades/segmentos'
import { cn } from '@/lib/utils'
import type { CalculoCronograma } from '../hooks/calculo'
import { invalidarCronograma } from '../hooks/calculo'
import {
  traduzirErro,
  useCriarDasQuantidades,
  useCriarTarefas,
  type LocalInput,
  type NovaTarefa,
  type OpcoesCriarDasQuantidades
} from '../hooks/edicao'
import type { TrechoEntrada } from '../motor/tipos'
import { fmtEstacaCompacta, fmtNum, lerEstaca, textoEstaca } from '../visoes/formato'
import { Campo } from './campos'
import { lerNumero } from './campos-util'

interface Props {
  calc: CalculoCronograma
  obraId: string
  /** tarefa-resumo de destino (null = raiz); undefined = fechado */
  destino: string | null | undefined
  onFechar: () => void
}

export function CriarTarefasDialog({ calc, obraId, destino, onFechar }: Props): ReactNode {
  return (
    <Dialog
      open={destino !== undefined && !!calc.entrada}
      onOpenChange={(o) => !o && onFechar()}
      size="xl"
    >
      {destino !== undefined && calc.entrada ? (
        <Conteudo calc={calc} obraId={obraId} destino={destino} onFechar={onFechar} />
      ) : null}
    </Dialog>
  )
}

type Aba = 'quantidades' | 'manual'
type Modo = OpcoesCriarDasQuantidades['modo']

interface LinhaManual {
  qtd: string
  trecho: string
  ini: string
  fim: string
  origem: 'manual' | 'trecho'
}

interface Previa {
  nome: string
  trecho: TrechoEntrada
  itemId: string
  faixas: { ini: number; fim: number }[]
  quantidade: number
}

const chaveCel = (trechoId: string, itemId: string): string => `${trechoId}|${itemId}`

function Conteudo({
  calc,
  obraId,
  destino,
  onFechar
}: Omit<Props, 'destino'> & { destino: string | null }): ReactNode {
  const e = calc.entrada!
  const planoId = e.plano.id
  const qc = useQueryClient()
  const itensQ = useItensSincronizaveis(planoId, obraId)
  const templates = useTrechosQuantidadeTemplatesAtuais(e.trechos.map((t) => t.id))
  const criar = useCriarTarefas()
  const criarDasQtd = useCriarDasQuantidades()
  const criarIndireta = useCriarTarefaIndireta()

  const [aba, setAba] = useState<Aba>('quantidades')
  const [pai, setPai] = useState<string>(destino ?? '')
  const [sentido, setSentido] = useState<'crescente' | 'decrescente'>('crescente')
  const [modo, setModo] = useState<Modo>('sequencia')
  const [janela, setJanela] = useState('1000')
  const [celulas, setCelulas] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Map<string, LinhaManual>>(new Map())
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [formInd, setFormInd] = useState<FormIndireto>(FORM_INDIRETO_PADRAO)

  const itens = itensQ.data ?? []
  const diretos = useMemo(() => itens.filter((i) => !i.indireto_id), [itens])
  const nIndSel = [...sel.keys()].filter((id) => itens.find((x) => x.id === id)?.indireto_id).length
  const segsPorTrecho = useMemo(() => {
    const m = new Map<string, SegmentoValores[]>()
    for (const t of e.trechos) m.set(t.id, segmentosDoTemplate(templates.get(t.id)))
    return m
  }, [e.trechos, templates])

  const grupos = e.tarefas.filter((t) => t.tipo_no === 'grupo')
  const caminho = (id: string): string => {
    const nomes: string[] = []
    let x: string | null = id
    while (x) {
      const t = e.tarefas.find((y) => y.id === x)
      if (!t) break
      nomes.unshift(t.nome)
      x = t.parent_id
    }
    return nomes.join(' › ')
  }

  // ── das quantidades por local ──────────────────────────────────────────────────────────────────────────────────
  /** locais "do template" já criados do serviço no trecho (cobertura) */
  const cobertos = (itemId: string, trecho: TrechoEntrada): [number, number][] => {
    const out: [number, number][] = []
    for (const t of e.tarefas) {
      if (t.item_orcamentario_id !== itemId) continue
      for (const l of t.locais) {
        if (l.trecho_id !== trecho.id || l.qtd_origem !== 'trecho') continue
        if (trecho.tipo === 'area') out.push([0, 1])
        else if (l.inicio_m !== null && l.fim_m !== null) out.push([l.inicio_m, l.fim_m])
      }
    }
    return out
  }
  const celulasInfo = useMemo(() => {
    const m = new Map<
      string,
      { total: number; livre: number; seqs: { ini: number; fim: number; total: number }[] }
    >()
    for (const t of e.trechos) {
      const segs = segsPorTrecho.get(t.id) ?? []
      for (const it of diretos) {
        const total = segs.reduce((s, x) => s + (x.valores[it.id] ?? 0), 0)
        if (!(total > 0)) continue
        const seqs = faixasLivresDoServico(segs, it.id, cobertos(it.id, t))
        m.set(chaveCel(t.id, it.id), {
          total,
          livre: seqs.reduce((s, x) => s + x.total, 0),
          seqs
        })
      }
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.trechos, e.tarefas, diretos, segsPorTrecho])
  const locaisComTemplate = e.trechos.filter((t) =>
    diretos.some((it) => celulasInfo.has(chaveCel(t.id, it.id)))
  )
  const servicosComTemplate = diretos.filter((it) =>
    e.trechos.some((t) => celulasInfo.has(chaveCel(t.id, it.id)))
  )
  const janelaM = lerNumero(janela) ?? 0

  const previa: Previa[] = useMemo(() => {
    const out: Previa[] = []
    for (const t of locaisComTemplate)
      for (const it of servicosComTemplate) {
        const k = chaveCel(t.id, it.id)
        if (!celulas.has(k)) continue
        const info = celulasInfo.get(k)
        if (!info || info.seqs.length === 0) continue
        const segs = segsPorTrecho.get(t.id) ?? []
        const prefixo = `${it.descricao} ${t.nome}`
        let faixas: { ini: number; fim: number }[][]
        if (t.tipo === 'area' || modo === 'local') faixas = [info.seqs]
        else if (modo === 'janela' && janelaM > 0)
          faixas = info.seqs.flatMap((s) =>
            faixasDeDivisao(s.ini, s.fim, janelaM).map(([ini, fim]) => [{ ini, fim }])
          )
        else faixas = info.seqs.map((s) => [s])
        faixas.forEach((fx, i) =>
          out.push({
            nome: faixas.length > 1 ? `${prefixo} ${i + 1}` : prefixo,
            trecho: t,
            itemId: it.id,
            faixas: fx,
            quantidade:
              t.tipo === 'area'
                ? info.livre
                : fx.reduce((s, f) => s + quantidadeNaFaixa(segs, it.id, f.ini, f.fim), 0)
          })
        )
      }
    return out
  }, [celulas, celulasInfo, locaisComTemplate, servicosComTemplate, segsPorTrecho, modo, janelaM])

  const alternarCel = (k: string): void => {
    const n = new Set(celulas)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    setCelulas(n)
  }
  const alternarVarias = (ks: string[]): void => {
    const livres = ks.filter((k) => (celulasInfo.get(k)?.livre ?? 0) > 0)
    const todas = livres.length > 0 && livres.every((k) => celulas.has(k))
    const n = new Set(celulas)
    for (const k of livres) {
      if (todas) n.delete(k)
      else n.add(k)
    }
    setCelulas(n)
  }

  const criarDasQuantidades = async (): Promise<void> => {
    setErro(null)
    if (modo === 'janela' && !(janelaM > 0))
      return setErro('Informe o tamanho da janela em metros.')
    const porTrecho = new Map<string, string[]>()
    for (const k of celulas) {
      const [trechoId, itemId] = k.split('|') as [string, string]
      if (!(celulasInfo.get(k)?.livre ?? 0)) continue
      porTrecho.set(trechoId, [...(porTrecho.get(trechoId) ?? []), itemId])
    }
    if (porTrecho.size === 0) return setErro('Marque ao menos uma célula com quantidade livre.')
    setSalvando(true)
    try {
      let n = 0
      for (const [trechoId, itensIds] of porTrecho) {
        const ids = await criarDasQtd.mutateAsync({
          planejamentoId: planoId,
          parentId: pai || null,
          trechos: [trechoId],
          itens: itensIds,
          opcoes: { modo, janela_m: modo === 'janela' ? janelaM : null, sentido }
        })
        n += ids.length
      }
      await invalidarCronograma(qc, planoId)
      void qc.invalidateQueries({ queryKey: ['planejamento', 'itens-sincronizaveis'] })
      if (n === 0) return setErro('Nada a criar: as quantidades marcadas já estão em tarefas.')
      onFechar()
    } catch (x) {
      setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
    } finally {
      setSalvando(false)
    }
  }

  // ── manual ────────────────────────────────────────────────────────────────────────────────────────────────────
  const itensFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return itens.filter((i) => !q || `${i.codigo} ${i.descricao}`.toLowerCase().includes(q))
  }, [itens, busca])
  const alternar = (id: string, restante: number): void => {
    const m = new Map(sel)
    if (m.has(id)) m.delete(id)
    else
      m.set(id, {
        qtd: restante > 0 ? fmtNum(restante, 'auto') : '',
        trecho: '',
        ini: '',
        fim: '',
        origem: 'manual'
      })
    setSel(m)
  }
  const mudar = (id: string, x: Partial<LinhaManual>): void => {
    const m = new Map(sel)
    const cur = m.get(id)!
    const prox = { ...cur, ...x }
    if (x.trecho !== undefined && x.trecho !== cur.trecho) {
      const tr = e.trechos.find((t) => t.id === x.trecho)
      prox.ini = tr && tr.tipo === 'eixo' ? textoEstaca(0, tr) : ''
      prox.fim = tr && tr.tipo === 'eixo' ? textoEstaca(tr.comprimento_m ?? 0, tr) : ''
      prox.origem = 'manual'
    }
    m.set(id, prox)
    setSel(m)
  }
  /** quantidade do template na faixa digitada (dica e valor "do template") */
  const noTemplate = (itemId: string, l: LinhaManual): number | null => {
    const tr = e.trechos.find((t) => t.id === l.trecho)
    if (!tr) return null
    const segs = segsPorTrecho.get(tr.id) ?? []
    if (!segs.some((s) => (s.valores[itemId] ?? 0) > 0)) return null
    if (tr.tipo === 'area') return segs.reduce((s, x) => s + (x.valores[itemId] ?? 0), 0)
    const a = lerEstaca(l.ini, tr),
      b = lerEstaca(l.fim, tr)
    if (a === null || b === null || !(b > a)) return null
    return quantidadeNaFaixa(segs, itemId, a, b)
  }

  const criarManual = async (): Promise<void> => {
    setErro(null)
    const irmaos = e.tarefas.filter((t) => (t.parent_id ?? '') === pai)
    let ordem = irmaos.length ? Math.max(...irmaos.map((t) => t.ordem)) + 1 : 0
    const diretas: NovaTarefa[] = []
    const indiretas: string[] = []
    for (const [id, l] of sel) {
      const it = itens.find((x) => x.id === id)
      if (!it) continue
      if (it.indireto_id) {
        indiretas.push(id)
        continue
      }
      const q = lerNumero(l.qtd)
      const tr = l.trecho ? e.trechos.find((t) => t.id === l.trecho) : undefined
      if (l.origem !== 'trecho' && (q === null || q <= 0))
        return setErro(`${it.codigo}: informe a quantidade.`)
      let locais: LocalInput[] | undefined
      if (tr) {
        if (tr.tipo === 'area') {
          locais = [
            {
              trecho_id: tr.id,
              inicio_m: null,
              fim_m: null,
              quantidade: l.origem === 'trecho' ? 0 : (q ?? 0),
              qtd_origem: l.origem
            }
          ]
        } else {
          const a = lerEstaca(l.ini, tr),
            b = lerEstaca(l.fim, tr)
          if (a === null || b === null)
            return setErro(
              `${it.codigo}: estaca fora do trecho ${tr.nome} (${textoEstaca(0, tr)} – ${textoEstaca(tr.comprimento_m ?? 0, tr)}).`
            )
          if (!(b > a))
            return setErro(`${it.codigo}: a estaca final precisa ser maior que a inicial.`)
          if (l.origem === 'trecho' && !(noTemplate(id, l) ?? 0 > 0))
            return setErro(`${it.codigo}: o template de ${tr.nome} não tem quantidade nessa faixa.`)
          locais = [
            {
              trecho_id: tr.id,
              inicio_m: a,
              fim_m: b,
              quantidade: l.origem === 'trecho' ? 0 : (q ?? 0),
              qtd_origem: l.origem
            }
          ]
        }
      }
      diretas.push({
        item_orcamentario_id: id,
        quantidade: l.origem === 'trecho' ? null : q,
        parent_id: pai || null,
        sentido,
        locais
      })
    }
    if (!diretas.length && !indiretas.length) return setErro('Escolha ao menos um serviço.')
    const cfgInd = indiretas.length ? inputDoForm(formInd) : null
    if (typeof cfgInd === 'string') return setErro(cfgInd)
    setSalvando(true)
    try {
      if (diretas.length)
        await criar.mutateAsync({ planejamentoId: planoId, tarefas: diretas, ordemInicial: ordem })
      ordem += diretas.length
      for (const item of indiretas) {
        await criarIndireta.mutateAsync({
          planejamento_id: planoId,
          item_orcamentario_id: item,
          config: cfgInd!,
          parent_id: pai || null,
          ordem: ordem++
        })
      }
      await invalidarCronograma(qc, planoId)
      void qc.invalidateQueries({ queryKey: ['planejamento', 'itens-sincronizaveis'] })
      onFechar()
    } catch (x) {
      setErro(traduzirErro(x instanceof Error ? x.message : String(x)))
    } finally {
      setSalvando(false)
    }
  }

  const faixaTexto = (t: TrechoEntrada, fx: { ini: number; fim: number }[]): string =>
    t.tipo === 'area'
      ? 'área inteira'
      : fx.map((f) => `${fmtEstacaCompacta(f.ini, t)} – ${fmtEstacaCompacta(f.fim, t)}`).join(' · ')

  return (
    <>
      <DialogHeader>
        <DialogTitle>Criar tarefas</DialogTitle>
        <DialogDescription>
          A tarefa nasce do serviço do orçamento e dos seus locais. A quantidade de cada local vem
          da planilha de quantidades (“do template”) ou é digitada.
        </DialogDescription>
        <div className="mt-2 flex gap-4 border-b border-border -mb-3">
          <TabPill active={aba === 'quantidades'} onClick={() => setAba('quantidades')}>
            Das quantidades por local
          </TabPill>
          <TabPill active={aba === 'manual'} onClick={() => setAba('manual')}>
            Manual
          </TabPill>
        </div>
      </DialogHeader>
      <DialogBody className="max-h-[72vh] space-y-3 overflow-y-auto">
        <DialogErrorBanner message={erro} />
        <div className="flex items-end gap-3 flex-wrap">
          <Campo rotulo="Tarefa-resumo de destino" className="w-72">
            <Select value={pai} onChange={(x) => setPai(x.target.value)}>
              <option value="">Raiz do plano</option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {caminho(g.id)}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo="Sentido" className="w-36">
            <Select
              value={sentido}
              onChange={(x) => setSentido(x.target.value as 'crescente' | 'decrescente')}
            >
              <option value="crescente">crescente</option>
              <option value="decrescente">decrescente</option>
            </Select>
          </Campo>
          {aba === 'quantidades' ? (
            <>
              <Campo rotulo="Uma tarefa por" className="w-56">
                <Select value={modo} onChange={(x) => setModo(x.target.value as Modo)}>
                  <option value="sequencia">sequência contígua (DynaRoad)</option>
                  <option value="local">local (todas as faixas juntas)</option>
                  <option value="janela">janela de N metros</option>
                </Select>
              </Campo>
              {modo === 'janela' ? (
                <Campo rotulo="Janela (m)" className="w-24">
                  <Input
                    value={janela}
                    onChange={(x) => setJanela(x.target.value)}
                    inputMode="decimal"
                  />
                </Campo>
              ) : null}
            </>
          ) : (
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
              />
              <Input
                value={busca}
                onChange={(x) => setBusca(x.target.value)}
                placeholder="Filtrar por código ou descrição"
                className="pl-7"
              />
            </div>
          )}
        </div>

        {aba === 'quantidades' ? (
          <>
            {locaisComTemplate.length === 0 ? (
              <div className="rounded border border-dashed border-border px-4 py-6 text-center text-xs text-text-dim">
                Nenhum local tem quantidades por serviço ainda. Informe-as em Planejamento › Locais
                (grade ou importação da planilha) — ou use a aba Manual.
              </div>
            ) : (
              <div className="max-h-[34vh] overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-[1] bg-bg-panel">
                    <tr className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                      <th className="px-2 py-1.5 text-left">
                        <button
                          type="button"
                          className="hover:text-text"
                          onClick={() =>
                            alternarVarias(
                              locaisComTemplate.flatMap((t) =>
                                servicosComTemplate.map((it) => chaveCel(t.id, it.id))
                              )
                            )
                          }
                          title="Marcar/desmarcar tudo com quantidade livre"
                        >
                          Serviço · livre / template
                        </button>
                      </th>
                      {locaisComTemplate.map((t) => (
                        <th key={t.id} className="px-2 py-1.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="hover:text-text"
                            onClick={() =>
                              alternarVarias(servicosComTemplate.map((it) => chaveCel(t.id, it.id)))
                            }
                            title="Marcar/desmarcar a coluna"
                          >
                            {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {servicosComTemplate.map((it) => (
                      <tr key={it.id} className="border-t border-border">
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            className="flex items-baseline gap-2 text-left hover:text-accent"
                            onClick={() =>
                              alternarVarias(locaisComTemplate.map((t) => chaveCel(t.id, it.id)))
                            }
                            title="Marcar/desmarcar a linha"
                          >
                            <span className="font-mono text-2xs text-text-dim">{it.codigo}</span>
                            <span className="text-text">{it.descricao}</span>
                            <span className="text-2xs text-text-dim">{it.unidade ?? ''}</span>
                          </button>
                        </td>
                        {locaisComTemplate.map((t) => {
                          const k = chaveCel(t.id, it.id)
                          const info = celulasInfo.get(k)
                          if (!info)
                            return (
                              <td key={t.id} className="px-2 py-1 text-right text-text-dim">
                                —
                              </td>
                            )
                          const livre = info.livre > 0.0005
                          return (
                            <td key={t.id} className="px-2 py-1 text-right">
                              <label
                                className={cn(
                                  'inline-flex items-center gap-1.5 tabular-nums',
                                  !livre && 'opacity-50'
                                )}
                              >
                                <span className={livre ? 'text-text' : 'text-text-muted'}>
                                  {fmtNum(info.livre, 'auto')}
                                </span>
                                <span className="text-text-dim">
                                  / {fmtNum(info.total, 'auto')}
                                </span>
                                <input
                                  type="checkbox"
                                  className="accent-[var(--accent)]"
                                  disabled={!livre}
                                  checked={celulas.has(k)}
                                  onChange={() => alternarCel(k)}
                                />
                              </label>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="rounded border border-border">
              <div className="px-2 py-1 border-b border-border text-2xs font-mono uppercase text-text-dim">
                Prévia — {previa.length} {previa.length === 1 ? 'tarefa' : 'tarefas'}
              </div>
              <div className="max-h-[22vh] overflow-auto">
                {previa.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-text-dim italic">
                    Marque células na matriz: cada marca vira tarefas com locais “do template”.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <tbody>
                      {previa.map((p, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="px-2 py-1 text-text">{p.nome}</td>
                          <td className="px-2 py-1 text-text-muted">
                            {p.trecho.tipo === 'area' ? `Área ${p.trecho.nome}` : p.trecho.nome}
                          </td>
                          <td className="px-2 py-1 font-mono text-text-muted">
                            {faixaTexto(p.trecho, p.faixas)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {fmtNum(p.quantidade, 'auto')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="max-h-[52vh] overflow-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[1] bg-bg-panel">
                <tr className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                  <th className="w-8 py-1.5" />
                  <th className="px-2 py-1.5 text-left">Serviço</th>
                  <th className="px-2 py-1.5 text-right">Orçado</th>
                  <th className="px-2 py-1.5 text-right">No plano</th>
                  <th className="w-28 px-2 py-1.5 text-right">Quantidade</th>
                  <th className="w-44 px-2 py-1.5 text-left">Local</th>
                  <th className="w-56 px-2 py-1.5 text-left">Estacas · origem</th>
                </tr>
              </thead>
              <tbody>
                {itensQ.isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-text-dim">
                      Carregando serviços…
                    </td>
                  </tr>
                ) : null}
                {!itensQ.isLoading && !itensFiltrados.length ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-text-dim">
                      Nenhum serviço com composição no orçamento.
                    </td>
                  </tr>
                ) : null}
                {itensFiltrados.map((it) => {
                  const l = sel.get(it.id)
                  const escolhido = !!l
                  const tr = l?.trecho ? e.trechos.find((t) => t.id === l.trecho) : undefined
                  const tpl = l ? noTemplate(it.id, l) : null
                  const temTemplate =
                    !!tr &&
                    (segsPorTrecho.get(tr.id) ?? []).some((s) => (s.valores[it.id] ?? 0) > 0)
                  return (
                    <tr
                      key={it.id}
                      className={cn('border-t border-border', escolhido && 'bg-accent-glow')}
                    >
                      <td className="py-1 text-center align-top">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={escolhido}
                          onChange={() => alternar(it.id, it.restante)}
                        />
                      </td>
                      <td className="px-2 py-1 align-top">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-2xs text-text-dim">{it.codigo}</span>
                          <span className="truncate text-text">{it.descricao}</span>
                          {it.indireto_id ? (
                            <span className="rounded bg-bg-elevated px-1 text-2xs text-text-muted">
                              indireto
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-text-muted align-top">
                        {fmtNum(it.quantidade_referencia, 'auto')} {it.unidade ?? ''}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-1 text-right tabular-nums align-top',
                          it.alocado > it.quantidade_referencia + 1e-6
                            ? 'text-warn'
                            : 'text-text-muted'
                        )}
                      >
                        {it.count ? `${fmtNum(it.alocado, 'auto')} (${it.count})` : '—'}
                      </td>
                      <td className="px-2 py-1 align-top">
                        {escolhido && !it.indireto_id ? (
                          l.origem === 'trecho' ? (
                            <span className="block text-right text-2xs text-text-muted tabular-nums">
                              {tpl !== null ? fmtNum(tpl, 'auto') : '—'} do template
                            </span>
                          ) : (
                            <Input
                              value={l.qtd}
                              onChange={(x) => mudar(it.id, { qtd: x.target.value })}
                              inputMode="decimal"
                              className="h-6 text-right"
                            />
                          )
                        ) : null}
                      </td>
                      <td className="px-2 py-1 align-top">
                        {escolhido && !it.indireto_id ? (
                          <Select
                            value={l.trecho}
                            onChange={(x) => mudar(it.id, { trecho: x.target.value })}
                            className="h-6"
                          >
                            <option value="">Sem local</option>
                            {e.trechos.filter((t) => t.tipo === 'eixo').length ? (
                              <optgroup label="Eixos">
                                {e.trechos
                                  .filter((t) => t.tipo === 'eixo')
                                  .map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.nome}
                                    </option>
                                  ))}
                              </optgroup>
                            ) : null}
                            {e.trechos.filter((t) => t.tipo === 'area').length ? (
                              <optgroup label="Áreas">
                                {e.trechos
                                  .filter((t) => t.tipo === 'area')
                                  .map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.nome}
                                    </option>
                                  ))}
                              </optgroup>
                            ) : null}
                          </Select>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 align-top">
                        {escolhido && !it.indireto_id && tr ? (
                          <div className="space-y-1">
                            {tr.tipo === 'eixo' ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  value={l.ini}
                                  onChange={(x) => mudar(it.id, { ini: x.target.value })}
                                  className={cn(
                                    'h-6 w-24 font-mono',
                                    lerEstaca(l.ini, tr) === null && 'border-danger'
                                  )}
                                  title={`Estaca inicial (${textoEstaca(0, tr)} – ${textoEstaca(tr.comprimento_m ?? 0, tr)})`}
                                />
                                <span className="text-text-dim">–</span>
                                <Input
                                  value={l.fim}
                                  onChange={(x) => mudar(it.id, { fim: x.target.value })}
                                  className={cn(
                                    'h-6 w-24 font-mono',
                                    lerEstaca(l.fim, tr) === null && 'border-danger'
                                  )}
                                  title="Estaca final"
                                />
                              </div>
                            ) : null}
                            <div className="flex items-center gap-2">
                              <Select
                                value={l.origem}
                                onChange={(x) =>
                                  mudar(it.id, { origem: x.target.value as 'manual' | 'trecho' })
                                }
                                className="h-6 w-36"
                                disabled={!temTemplate}
                                title={
                                  temTemplate
                                    ? undefined
                                    : 'Este local não tem quantidade do serviço na planilha'
                                }
                              >
                                <option value="manual">quantidade manual</option>
                                <option value="trecho">do template</option>
                              </Select>
                              {tpl !== null ? (
                                <span className="text-2xs text-text-dim whitespace-nowrap">
                                  no template: {fmtNum(tpl, 'auto')}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {aba !== 'quantidades' && nIndSel > 0 ? (
          <div className="rounded border border-border bg-bg-panel p-3">
            <p className="mb-3 text-xs text-text-muted">
              {nIndSel === 1
                ? 'Parâmetros do indireto selecionado'
                : `Parâmetros dos ${nIndSel} indiretos selecionados`}{' '}
              (podem ser mudados depois, na aba Indireto da tarefa).
            </p>
            <IndiretoCampos valor={formInd} onMudar={setFormInd} obraId={obraId} />
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <span className="mr-auto text-2xs text-text-dim">
          {aba === 'quantidades'
            ? celulas.size
              ? `${celulas.size} célula(s) marcada(s)`
              : ''
            : sel.size
              ? `${sel.size} selecionado(s)`
              : ''}
        </span>
        <Button variant="ghost" onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
        {aba === 'quantidades' ? (
          <Button
            onClick={() => void criarDasQuantidades()}
            disabled={salvando || previa.length === 0}
          >
            {salvando
              ? 'Criando…'
              : `Criar ${previa.length || ''} tarefa${previa.length === 1 ? '' : 's'}`}
          </Button>
        ) : (
          <Button onClick={() => void criarManual()} disabled={salvando || !sel.size}>
            {salvando ? 'Criando…' : `Criar ${sel.size || ''} tarefa${sel.size === 1 ? '' : 's'}`}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
