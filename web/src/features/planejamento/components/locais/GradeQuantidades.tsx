/**
 * Grade de quantidades por faixa de um local: linhas = faixas de estacas (ou a área inteira), colunas = serviços do
 * orçamento. Células editáveis (Enter/↓/↑ navegam, colar multi-linha preenche a partir da célula), rodapé com
 * total · em tarefas · outros locais · orçamento · disponível · situação.
 *
 * Só as faixas que aparecem na tela são desenhadas: um eixo de 55 km a cada estaca tem 2.700 faixas, e com 24
 * serviços seriam 65 mil campos montados de uma vez.
 */
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/IconButton'
import { formatNumber, parseNumero } from '@/lib/format'
import { numeroParaCampo } from '@/lib/mascara/numero'
import { InputMascara } from '@/components/ui/input-mascara'
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
  'h-6 w-full bg-transparent px-1 text-xs tabular outline-none rounded-sm focus:bg-accent-glow focus:ring-1 focus:ring-accent disabled:text-text-muted'
const ROTULO = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
/** Altura de uma linha (campo de 24 px + recuo + borda); a medida real corrige ao desenhar. */
const ALTURA_LINHA = 29
/** Linhas a mais acima e abaixo da tela: cobre o cabeçalho e o rodapé fixos e a navegação por ↑ e ↓. */
const FOLGA = 14

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
  const virt = useVirtualizer({
    count: segmentos.length,
    getScrollElement: () => raiz.current,
    estimateSize: () => ALTURA_LINHA,
    overscan: FOLGA
  })
  const visiveis = virt.getVirtualItems()
  const antes = visiveis.length ? visiveis[0]!.start : 0
  const depois = visiveis.length ? virt.getTotalSize() - visiveis[visiveis.length - 1]!.end : 0
  // As linhas são memorizadas: rolar a grade só monta as que entram na tela. Para isso as ações não podem mudar a
  // cada desenho; elas leem as faixas e as colunas mais recentes por esta referência.
  const atual = useRef({ segmentos, colunas, ctx, comprimento, onChange, virt })
  atual.current = { segmentos, colunas, ctx, comprimento, onChange, virt }
  const acoes = useMemo<AcoesGrade>(
    () => ({
      focar(r, c) {
        if (r < 0 || r >= atual.current.segmentos.length) return
        const campo = (): HTMLInputElement | null =>
          raiz.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`) ??
          null
        const ir = (el: HTMLInputElement): void => {
          el.focus()
          el.select()
        }
        const el = campo()
        if (el) return ir(el)
        // a linha ainda não está desenhada: rola até ela e foca no quadro seguinte
        atual.current.virt.scrollToIndex(r, { align: 'auto' })
        requestAnimationFrame(() => {
          const depoisDeRolar = campo()
          if (depoisDeRolar) ir(depoisDeRolar)
        })
      },
      setValor(r, id, v) {
        const { segmentos: segs, onChange: mudar } = atual.current
        mudar(
          segs.map((s, i) => {
            if (i !== r) return s
            const valores = { ...s.valores }
            if (v && v > 0) valores[id] = v
            else delete valores[id]
            return { ...s, valores }
          })
        )
      },
      colar(r, c, e) {
        const txt = e.clipboardData.getData('text')
        if (!/[\n\t]/.test(txt)) return
        e.preventDefault()
        const { segmentos: segs, colunas: cols, onChange: mudar } = atual.current
        const linhas = txt
          .split(/\r?\n/)
          .filter((l) => l.trim() !== '')
          .map((l) => l.split('\t'))
        // só as faixas que recebem valor são copiadas: as outras continuam o mesmo objeto e não redesenham
        const novo = [...segs]
        linhas.forEach((cels, i) => {
          const antes = novo[r + i]
          if (!antes) return
          const seg = { ...antes, valores: { ...antes.valores } }
          cels.forEach((cel, j) => {
            const col = cols[c + j]
            if (!col) return
            const v = parseNumero(cel)
            if (v && v > 0) seg.valores[col.id] = v
            else delete seg.valores[col.id]
          })
          novo[r + i] = seg
        })
        mudar(novo)
      },
      setFaixa(r, campo, m) {
        const { segmentos: segs, ctx: c, comprimento: comp, onChange: mudar } = atual.current
        const s = segs[r]
        if (!s) return false
        const ini = campo === 'ini' ? m : s.ini,
          fim = campo === 'fim' ? m : s.fim
        if (!(fim > ini) || ini < 0 || (comp > 0 && fim > comp + 0.005)) return false
        const ctxSem = { ...c, geometry_comprimento_m: null }
        mudar(
          segs.map((x, i) =>
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
      },
      remover(r) {
        const { segmentos: segs, onChange: mudar } = atual.current
        mudar(segs.filter((_, i) => i !== r))
      }
    }),
    []
  )
  const totais = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of segmentos)
      for (const id in s.valores) m.set(id, (m.get(id) ?? 0) + s.valores[id]!)
    return m
  }, [segmentos])
  const nColunas = colunas.length + 1 + (colExtra ? 1 : 0)

  const larg = `${Math.max(640, 200 + colunas.length * 120)}px`
  return (
    <div
      ref={raiz}
      role="region"
      aria-label="Grade de quantidades por faixa e serviço"
      tabIndex={editavel ? undefined : 0}
      className="overflow-auto h-full"
    >
      <table
        className="text-xs border-separate border-spacing-0"
        style={{ minWidth: larg }}
        aria-rowcount={segmentos.length + 1}
      >
        <thead className="sticky top-0 z-10 bg-bg-elevated">
          <tr className={ROTULO}>
            <th className="sticky left-0 z-20 bg-bg-elevated text-left px-2 py-1.5 border-b border-r border-border w-[200px] min-w-[200px]">
              {tipo === 'area' ? 'Local' : 'Faixa de estacas'}
            </th>
            {colunas.map((k) => (
              <th
                key={k.id}
                className="text-right px-2 py-1.5 border-b border-border w-[120px] min-w-[120px] align-bottom"
                title={`${k.codigo} ${k.descricao}`}
              >
                <div className="text-text truncate normal-case tracking-normal tabular">
                  {k.codigo}
                </div>
                <div className="truncate normal-case tracking-normal font-normal">
                  {k.descricao}
                </div>
                <div className="normal-case tracking-normal font-normal">{k.unidade || '—'}</div>
              </th>
            ))}
            {colExtra ? (
              <th className="border-b border-border w-8">
                <span className="sr-only">Remover</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {antes > 0 ? <LinhaVazia altura={antes} colunas={nColunas} /> : null}
          {visiveis.map(({ index: r }) => {
            const s = segmentos[r]
            if (!s) return null
            return (
              <LinhaGrade
                key={r}
                r={r}
                seg={s}
                colunas={colunas}
                ctx={ctx}
                tipo={tipo}
                editavel={editavel}
                colExtra={colExtra}
                unica={segmentos.length <= 1}
                acoes={acoes}
                medir={virt.measureElement}
              />
            )
          })}
          {depois > 0 ? <LinhaVazia altura={depois} colunas={nColunas} /> : null}
          {segmentos.length === 0 ? (
            <tr>
              <td colSpan={nColunas} className="px-3 py-6 text-center text-sm text-text-muted">
                Sem faixas. Defina o comprimento do eixo ou adicione uma faixa.
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot className="sticky bottom-0 z-10 bg-bg-elevated tabular">
          <LinhaRodape
            colExtra={colExtra}
            titulo="Total neste local"
            colunas={colunas}
            valor={(id) => totais.get(id) ?? 0}
            forte
          />
          {rodape ? (
            <>
              <LinhaRodape
                colExtra={colExtra}
                titulo={rotuloTarefas}
                colunas={colunas}
                valor={(id) => rodape.get(id)?.emTarefas ?? 0}
                dica="Quantidade dos locais das tarefas do plano neste local"
              />
              <LinhaRodape
                colExtra={colExtra}
                titulo="Outros locais"
                colunas={colunas}
                valor={(id) => rodape.get(id)?.outros ?? 0}
              />
              <LinhaRodape
                colExtra={colExtra}
                titulo="Orçamento"
                colunas={colunas}
                valor={(id) => rodape.get(id)?.orcamento ?? 0}
              />
              <LinhaRodape
                colExtra={colExtra}
                titulo="Disponível"
                colunas={colunas}
                valor={(id) => {
                  const r = rodape.get(id)
                  return r ? r.orcamento - r.outros - (totais.get(id) ?? 0) : 0
                }}
                negativoEmVermelho
              />
              <tr>
                <td
                  className={cn(
                    'sticky left-0 z-20 bg-bg-elevated px-2 py-1 border-t border-r border-border',
                    ROTULO
                  )}
                >
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
                          title="As tarefas deste local somam mais que a quantidade informada aqui"
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

interface AcoesGrade {
  focar: (r: number, c: number) => void
  setValor: (r: number, id: string, v: number | null) => void
  colar: (r: number, c: number, e: ClipboardEvent<HTMLInputElement>) => void
  setFaixa: (r: number, campo: 'ini' | 'fim', m: number) => boolean
  remover: (r: number) => void
}

/** Uma faixa da grade. Memorizada: só redesenha quando a própria faixa muda, não a cada rolagem. */
const LinhaGrade = memo(function LinhaGrade({
  r,
  seg: s,
  colunas,
  ctx,
  tipo,
  editavel,
  colExtra,
  unica,
  acoes,
  medir
}: {
  r: number
  seg: SegmentoValores
  colunas: ColunaGrade[]
  ctx: TrechoCtx
  tipo: 'eixo' | 'area'
  editavel: boolean
  colExtra: boolean
  /** a única faixa do eixo não pode ser removida */
  unica: boolean
  acoes: AcoesGrade
  medir: (el: HTMLTableRowElement | null) => void
}): ReactNode {
  // nome da faixa para leitor de tela: "faixa km 0 a km 1,5"
  const nomeFaixa =
    tipo === 'area'
      ? 'área inteira'
      : `faixa ${s.label_ini || fmtMarcador(s.ini, ctx)} a ${s.label_fim || fmtMarcador(s.fim, ctx)}`
  return (
    <tr ref={medir} data-index={r} aria-rowindex={r + 2} className="group hover:bg-bg-hover/40">
      <td className="sticky left-0 z-[5] bg-bg-panel group-hover:bg-bg-elevated px-1 py-0.5 border-b border-r border-border tabular">
        {tipo === 'area' ? (
          <span className="px-1 text-text-muted">Área inteira</span>
        ) : colExtra ? (
          <div className="flex items-center gap-1">
            <CelulaFaixa
              rotulo={`Início da faixa ${r + 1}, em ${rotulo(ctx)}`}
              valor={fmtMarcador(s.ini, ctx)}
              ctx={ctx}
              onCommit={(m) => acoes.setFaixa(r, 'ini', m)}
            />
            <span className="text-text-dim" aria-hidden>
              –
            </span>
            <CelulaFaixa
              rotulo={`Fim da faixa ${r + 1}, em ${rotulo(ctx)}`}
              valor={fmtMarcador(s.fim, ctx)}
              ctx={ctx}
              onCommit={(m) => acoes.setFaixa(r, 'fim', m)}
            />
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-2 px-1">
            <span className="text-text">
              {s.label_ini || fmtMarcador(s.ini, ctx)} <span className="text-text-dim">–</span>{' '}
              {s.label_fim || fmtMarcador(s.fim, ctx)}
            </span>
            <span className="text-2xs text-text-dim">{formatNumber(s.fim - s.ini, 0)} m</span>
          </div>
        )}
      </td>
      {colunas.map((k, c) => (
        <td key={k.id} className="px-1 py-0.5 border-b border-border text-right">
          <Celula
            r={r}
            c={c}
            rotulo={`Quantidade de ${k.codigo} ${k.descricao}${k.unidade ? `, em ${k.unidade}` : ''}, ${nomeFaixa}`}
            valor={s.valores[k.id] ?? 0}
            editavel={editavel}
            onCommit={(v) => acoes.setValor(r, k.id, v)}
            onNav={(dr) => acoes.focar(r + dr, c)}
            onPaste={(e) => acoes.colar(r, c, e)}
          />
        </td>
      ))}
      {colExtra ? (
        <td className="border-b border-border text-center">
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={`Remover a ${nomeFaixa}`}
            title={unica ? 'O eixo precisa de ao menos uma faixa' : 'Remover a faixa'}
            disabled={unica}
            onClick={() => acoes.remover(r)}
          >
            <Trash2 size={12} />
          </IconButton>
        </td>
      ) : null}
    </tr>
  )
})

/** Ocupa o lugar das faixas que estão fora da tela, para a barra de rolagem ter o tamanho da grade inteira. */
function LinhaVazia({ altura, colunas }: { altura: number; colunas: number }): ReactNode {
  return (
    <tr aria-hidden="true">
      <td colSpan={colunas} style={{ height: altura, padding: 0, border: 0 }} />
    </tr>
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
  negativoEmVermelho,
  colExtra
}: {
  /** a grade tem a coluna de remover faixa: o rodapé a cobre também */
  colExtra: boolean
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
        className={cn(
          'sticky left-0 z-20 bg-bg-elevated px-2 py-1 border-t border-r border-border',
          ROTULO
        )}
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
      {colExtra ? <td className="border-t border-border" /> : null}
    </tr>
  )
}

function Celula({
  r,
  c,
  rotulo,
  valor,
  editavel,
  onCommit,
  onNav,
  onPaste
}: {
  r: number
  c: number
  rotulo: string
  valor: number
  editavel: boolean
  onCommit: (v: number | null) => void
  onNav: (dr: number) => void
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void
}): ReactNode {
  const texto = (): string => (valor ? numeroParaCampo(valor, 4) : '')
  const [txt, setTxt] = useState(texto)
  const [erro, setErro] = useState(false)
  // digitou e ainda não confirmou: a linha pode sair da tela (rolagem) antes de o campo perder o foco
  const pendente = useRef(false)
  const ultimo = useRef({ txt, valor, onCommit })
  ultimo.current = { txt, valor, onCommit }
  useEffect(() => {
    setTxt(texto())
    setErro(false)
    pendente.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])
  useEffect(
    () => () => {
      if (!pendente.current) return
      const u = ultimo.current
      if (u.txt.trim() === '') {
        if (u.valor) u.onCommit(null)
        return
      }
      const v = parseNumero(u.txt)
      if (v !== null && v >= 0 && Math.abs(v - u.valor) > 1e-9) u.onCommit(v)
    },
    []
  )
  const commit = (): void => {
    pendente.current = false
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
      pendente.current = false
    }
  }
  return (
    <InputMascara
      mascara="decimal"
      casas={4}
      data-r={r}
      data-c={c}
      aria-label={rotulo}
      value={txt}
      disabled={!editavel}
      onChange={(e) => {
        setTxt(e.target.value)
        pendente.current = true
      }}
      onBlur={commit}
      onKeyDown={teclas}
      onPaste={onPaste}
      onFocus={(e) => e.target.select()}
      className={cn(INPUT, 'text-right', erro && 'ring-1 ring-danger text-danger')}
      aria-invalid={erro || undefined}
    />
  )
}

function CelulaFaixa({
  rotulo: nome,
  valor,
  ctx,
  onCommit
}: {
  rotulo: string
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
      aria-label={nome}
      aria-invalid={erro || undefined}
      title={`${rotulo(ctx)} (valor do marcador)`}
    />
  )
}
