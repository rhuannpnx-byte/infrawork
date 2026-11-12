/**
 * Grade de quantidades por faixa de um local: linhas = faixas de estacas (ou a área inteira), colunas = serviços do
 * orçamento. Células editáveis (Enter/↓/↑ navegam, colar multi-linha preenche a partir da célula), rodapé com
 * total · em tarefas · outros locais · orçamento · disponível · situação.
 */
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/IconButton'
import { formatNumber, parseNumero } from '@/lib/format'
import { metrosToMarcador, parseMarcador, type TrechoCtx } from '@/lib/format/posicao'
import type { SegmentoValores } from '@/lib/quantidades/segmentos'
import { cn } from '@/lib/utils'

export interface ColunaGrade {
  id: string
  codigo: string
  descricao: string
  unidade: string
}
export interface RodapeColuna {
  emTarefas: number
  outros: number
  orcamento: number
}

interface Props {
  segmentos: SegmentoValores[]
  colunas: ColunaGrade[]
  ctx: TrechoCtx
  tipo: 'eixo' | 'area'
  editavel: boolean
  /** início/fim editáveis e linhas removíveis */
  livre: boolean
  comprimento: number
  onChange: (segs: SegmentoValores[]) => void
  rodape?: Map<string, RodapeColuna>
  rotuloTarefas?: string
}

const fmtMarcador = (m: number, ctx: TrechoCtx): string => {
  const v = Math.round(metrosToMarcador(m, ctx) * 1000) / 1000
  return String(v).replace('.', ',')
}

const INPUT =
  'h-6 w-full bg-transparent px-1 text-xs font-mono tabular-nums outline-none rounded-sm focus:bg-accent-glow focus:ring-1 focus:ring-accent disabled:text-text-muted'

export function GradeQuantidades({
  segmentos,
  colunas,
  ctx,
  tipo,
  editavel,
  livre,
  comprimento,
  onChange,
  rodape,
  rotuloTarefas = 'Em tarefas'
}: Props): ReactNode {
  const raiz = useRef<HTMLDivElement>(null)
  // coluna de remover faixa e início/fim editáveis: só em eixo com faixas livres
  const colExtra = livre && editavel && tipo !== 'area'
  const focar = (r: number, c: number): void => {
    const el = raiz.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)
    el?.focus()
    el?.select()
  }
  const setValor = (r: number, id: string, v: number | null): void => {
    const novo = segmentos.map((s, i) => {
      if (i !== r) return s
      const valores = { ...s.valores }
      if (v && v > 0) valores[id] = v
      else delete valores[id]
      return { ...s, valores }
    })
    onChange(novo)
  }
  const colar = (r: number, c: number, e: ClipboardEvent<HTMLInputElement>): void => {
    const txt = e.clipboardData.getData('text')
    if (!/[\n\t]/.test(txt)) return
    e.preventDefault()
    const linhas = txt
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => l.split('\t'))
    const novo = segmentos.map((s) => ({ ...s, valores: { ...s.valores } }))
    linhas.forEach((cels, i) => {
      const seg = novo[r + i]
      if (!seg) return
      cels.forEach((cel, j) => {
        const col = colunas[c + j]
        if (!col) return
        const v = parseNumero(cel)
        if (v && v > 0) seg.valores[col.id] = v
        else delete seg.valores[col.id]
      })
    })
    onChange(novo)
  }
  const setFaixa = (r: number, campo: 'ini' | 'fim', m: number): boolean => {
    const s = segmentos[r]
    if (!s) return false
    const ini = campo === 'ini' ? m : s.ini,
      fim = campo === 'fim' ? m : s.fim
    if (!(fim > ini) || ini < 0 || (comprimento > 0 && fim > comprimento + 0.005)) return false
    const ctxSem = { ...ctx, geometry_comprimento_m: null }
    onChange(
      segmentos.map((x, i) =>
        i === r
          ? {
              ...x,
              ini,
              fim,
              label_ini: `${rotulo(ctxSem)} ${fmtMarcador(ini, ctxSem)}`,
              label_fim: `${rotulo(ctxSem)} ${fmtMarcador(fim, ctxSem)}`
            }
          : x
      )
    )
    return true
  }
  const totais = new Map<string, number>()
  for (const s of segmentos)
    for (const [id, v] of Object.entries(s.valores)) totais.set(id, (totais.get(id) ?? 0) + v)

  const larg = `${Math.max(640, 200 + colunas.length * 120)}px`
  return (
    <div ref={raiz} className="overflow-auto h-full">
      <table className="text-xs border-separate border-spacing-0" style={{ minWidth: larg }}>
        <thead className="sticky top-0 z-10 bg-bg">
          <tr className="text-2xs font-mono uppercase text-text-dim">
            <th className="sticky left-0 z-20 bg-bg text-left px-2 py-1.5 border-b border-r border-border w-[200px] min-w-[200px]">
              {tipo === 'area' ? 'Local' : 'Faixa de estacas'}
            </th>
            {colunas.map((k) => (
              <th
                key={k.id}
                className="text-right px-2 py-1.5 border-b border-border w-[120px] min-w-[120px] align-bottom"
                title={`${k.codigo} ${k.descricao}`}
              >
                <div className="text-text truncate normal-case font-sans font-medium">
                  {k.codigo}
                </div>
                <div className="truncate normal-case font-sans" title={k.descricao}>
                  {k.descricao}
                </div>
                <div className="text-text-dim">{k.unidade || '—'}</div>
              </th>
            ))}
            {colExtra ? <th className="border-b border-border w-8" /> : null}
          </tr>
        </thead>
        <tbody>
          {segmentos.map((s, r) => (
            <tr key={r} className="group hover:bg-bg-hover/40">
              <td className="sticky left-0 z-[5] bg-bg-panel group-hover:bg-bg-elevated px-1 py-0.5 border-b border-r border-border font-mono">
                {tipo === 'area' ? (
                  <span className="px-1 text-text-muted">Área inteira</span>
                ) : colExtra ? (
                  <div className="flex items-center gap-1">
                    <CelulaFaixa
                      valor={fmtMarcador(s.ini, ctx)}
                      ctx={ctx}
                      onCommit={(m) => setFaixa(r, 'ini', m)}
                    />
                    <span className="text-text-dim">–</span>
                    <CelulaFaixa
                      valor={fmtMarcador(s.fim, ctx)}
                      ctx={ctx}
                      onCommit={(m) => setFaixa(r, 'fim', m)}
                    />
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <span className="text-text">
                      {s.label_ini || fmtMarcador(s.ini, ctx)}{' '}
                      <span className="text-text-dim">–</span>{' '}
                      {s.label_fim || fmtMarcador(s.fim, ctx)}
                    </span>
                    <span className="text-2xs text-text-dim">
                      {formatNumber(s.fim - s.ini, 0)} m
                    </span>
                  </div>
                )}
              </td>
              {colunas.map((k, c) => (
                <td key={k.id} className="px-1 py-0.5 border-b border-border text-right">
                  <Celula
                    r={r}
                    c={c}
                    valor={s.valores[k.id] ?? 0}
                    editavel={editavel}
                    onCommit={(v) => setValor(r, k.id, v)}
                    onNav={(dr) => focar(r + dr, c)}
                    onPaste={(e) => colar(r, c, e)}
                  />
                </td>
              ))}
              {colExtra ? (
                <td className="border-b border-border text-center">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label="Remover faixa"
                    disabled={segmentos.length <= 1}
                    onClick={() => onChange(segmentos.filter((_, i) => i !== r))}
                  >
                    <Trash2 size={11} />
                  </IconButton>
                </td>
              ) : null}
            </tr>
          ))}
          {segmentos.length === 0 ? (
            <tr>
              <td
                colSpan={colunas.length + 1}
                className="px-3 py-6 text-center text-text-dim italic"
              >
                Sem faixas — defina o comprimento do eixo ou adicione uma faixa.
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot className="sticky bottom-0 z-10 bg-bg font-mono tabular-nums">
          <LinhaRodape
            titulo="Total neste local"
            colunas={colunas}
            valor={(id) => totais.get(id) ?? 0}
            forte
          />
          {rodape ? (
            <>
              <LinhaRodape
                titulo={rotuloTarefas}
                colunas={colunas}
                valor={(id) => rodape.get(id)?.emTarefas ?? 0}
                dica="Quantidade dos locais das tarefas do plano neste local"
              />
              <LinhaRodape
                titulo="Outros locais"
                colunas={colunas}
                valor={(id) => rodape.get(id)?.outros ?? 0}
              />
              <LinhaRodape
                titulo="Orçamento"
                colunas={colunas}
                valor={(id) => rodape.get(id)?.orcamento ?? 0}
              />
              <LinhaRodape
                titulo="Disponível"
                colunas={colunas}
                valor={(id) => {
                  const r = rodape.get(id)
                  return r ? r.orcamento - r.outros - (totais.get(id) ?? 0) : 0
                }}
                negativoEmVermelho
              />
              <tr>
                <td className="sticky left-0 z-20 bg-bg px-2 py-1 border-t border-r border-border text-2xs uppercase text-text-dim">
                  Situação
                </td>
                {colunas.map((k) => {
                  const r = rodape.get(k.id)
                  const total = totais.get(k.id) ?? 0
                  const excede = r ? total + r.outros > r.orcamento + 0.0005 : false
                  const tarefasAcima = r ? r.emTarefas > total + 0.0005 : false
                  return (
                    <td key={k.id} className="px-2 py-1 border-t border-border text-right">
                      {excede ? (
                        <Badge variant="danger">acima do orçamento</Badge>
                      ) : tarefasAcima ? (
                        <Badge
                          variant="warn"
                          title="As tarefas deste local somam mais que o template"
                        >
                          tarefas acima
                        </Badge>
                      ) : total > 0 ? (
                        <Badge variant="success">ok</Badge>
                      ) : (
                        <Badge variant="outline">sem quantidade</Badge>
                      )}
                    </td>
                  )
                })}
                {colExtra ? <td className="border-t border-border" /> : null}
              </tr>
            </>
          ) : null}
        </tfoot>
      </table>
    </div>
  )
}

const rotulo = (ctx: TrechoCtx): string =>
  ctx.unidade_espaco_padrao === 'km'
    ? 'km'
    : ctx.unidade_espaco_padrao === 'estaca'
      ? 'EST'
      : ctx.unidade_espaco_padrao === 'm'
        ? 'm'
        : ctx.unidade_custom_label?.trim() || 'ref'

function LinhaRodape({
  titulo,
  colunas,
  valor,
  forte,
  dica,
  negativoEmVermelho
}: {
  titulo: string
  colunas: ColunaGrade[]
  valor: (id: string) => number
  forte?: boolean
  dica?: string
  negativoEmVermelho?: boolean
}): ReactNode {
  return (
    <tr className={cn(forte ? 'text-text' : 'text-text-muted')}>
      <td
        className="sticky left-0 z-20 bg-bg px-2 py-1 border-t border-r border-border text-2xs uppercase text-text-dim"
        title={dica}
      >
        {titulo}
      </td>
      {colunas.map((k) => {
        const v = valor(k.id)
        return (
          <td
            key={k.id}
            className={cn(
              'px-2 py-1 border-t border-border text-right',
              negativoEmVermelho && v < -0.0005 && 'text-danger',
              forte && 'font-semibold'
            )}
          >
            {formatNumber(v, 3)}
          </td>
        )
      })}
    </tr>
  )
}

function Celula({
  r,
  c,
  valor,
  editavel,
  onCommit,
  onNav,
  onPaste
}: {
  r: number
  c: number
  valor: number
  editavel: boolean
  onCommit: (v: number | null) => void
  onNav: (dr: number) => void
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void
}): ReactNode {
  const texto = (): string => (valor ? formatNumber(valor, 4) : '')
  const [txt, setTxt] = useState(texto)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    setTxt(texto())
    setErro(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])
  const commit = (): void => {
    if (txt.trim() === '') {
      if (valor) onCommit(null)
      setErro(false)
      return
    }
    const v = parseNumero(txt)
    if (v === null || v < 0) {
      setErro(true)
      return
    }
    setErro(false)
    if (Math.abs(v - valor) > 1e-9) onCommit(v)
    else setTxt(texto())
  }
  const teclas = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      commit()
      onNav(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      commit()
      onNav(-1)
    } else if (e.key === 'Escape') {
      setTxt(texto())
      setErro(false)
    }
  }
  return (
    <input
      data-r={r}
      data-c={c}
      value={txt}
      disabled={!editavel}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={teclas}
      onPaste={onPaste}
      onFocus={(e) => e.target.select()}
      className={cn(INPUT, 'text-right', erro && 'ring-1 ring-danger text-danger')}
      aria-invalid={erro || undefined}
      inputMode="decimal"
    />
  )
}

function CelulaFaixa({
  valor,
  ctx,
  onCommit
}: {
  valor: string
  ctx: TrechoCtx
  onCommit: (m: number) => boolean
}): ReactNode {
  const [txt, setTxt] = useState(valor)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    setTxt(valor)
    setErro(false)
  }, [valor])
  const commit = (): void => {
    if (txt.trim() === valor) return
    const r = parseMarcador(txt.trim(), { ...ctx, geometry_comprimento_m: null })
    if (r.metros === null || !onCommit(r.metros)) {
      setErro(true)
      return
    }
    setErro(false)
  }
  return (
    <input
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          setTxt(valor)
          setErro(false)
        }
      }}
      className={cn(INPUT, 'w-[70px] text-right', erro && 'ring-1 ring-danger text-danger')}
      title={`${rotulo(ctx)} (valor do marcador)`}
    />
  )
}
