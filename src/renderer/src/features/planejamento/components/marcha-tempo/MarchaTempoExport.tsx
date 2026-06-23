// MarchaTempoExport — exportação profissional em PDF.
// Modal de opções (A4/A3 · retrato/paisagem · carimbo) → preview de folha
// branca de engenharia → diálogo de impressão do navegador. Port do design
// Claude Design.

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  bandasNaoTrabalhadas,
  clusterizarSegmentos,
  corDoServico,
  desvioDensidadeSegs,
  detectarConflitos,
  fmtDataBR,
  fmtQtdCompact,
  gerarMesesGrid,
  meiaNoite,
  pathReto,
  resolverCoresColunas
} from '@/features/planejamento/lib/marcha-tempo-pure'
import { formatMarcadorCompacto } from '@/lib/format/posicao'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import type { EstiloSerie, MarchaTempoOpcoes, TracoTarefa } from '@/types/planejamento'
import type { ObraTrecho } from '@/types/gerencial'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

const DAY = 86400000
const PX_MM = 3.7795
const PAGES = {
  A4: { w: Math.round(210 * PX_MM), h: Math.round(297 * PX_MM) },
  A3: { w: Math.round(297 * PX_MM), h: Math.round(420 * PX_MM) }
}

function fmtMesAno(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function pageDims(tamanho: 'A4' | 'A3', orient: 'retrato' | 'paisagem'): { w: number; h: number } {
  const p = PAGES[tamanho]
  return orient === 'paisagem' ? { w: p.h, h: p.w } : { w: p.w, h: p.h }
}

// Cores de impressão (variantes escuras pra ler no branco)
const PRINT_COR: Record<string, string> = {
  '#60a5fa': '#1d4ed8',
  '#34d399': '#047857',
  '#fbbf24': '#b45309',
  '#f87171': '#b91c1c',
  '#a78bfa': '#6d28d9',
  '#f472b6': '#be185d',
  '#2dd4bf': '#0f766e',
  '#fb923c': '#c2410c'
}
const pcor = (c: string): string => PRINT_COR[c] || c

const DASHP: Record<EstiloSerie['dash'], string> = {
  solido: '',
  tracejado: '6 4',
  pontilhado: '1.5 4'
}
const TODAY_COR = '#b45309'
const MARCO_COR = '#1d4ed8'

interface CarimboCampos {
  empresa: string
  obra: string
  titulo: string
  trecho: string
  intervalo: string
  periodo: string
  revisao: string
  desenhoNum: string
  responsavel: string
  escala: string
  folha: string
}

interface MarchaTempoExportProps {
  open: boolean
  onClose: () => void
  /** Trechos a exportar — 1 página de PDF por trecho. */
  trechos: ObraTrecho[]
  templatesPorTrecho: Map<string, TrechoQuantidadeVersaoCompleta | null>
  /** Tracos de TODOS os trechos — filtrado internamente por trechoId. */
  tracos: TracoTarefa[]
  tarefas: Array<{
    id: string
    tipo_no: string
    data_inicio: string | null
    nome_custom: string | null
    servico_grupo_descricao: string | null
    codigo_eap: string | null
    trecho_id: string | null
  }>
  dataDate: string | null
  dominioTempo: [number, number]
  opcoes: MarchaTempoOpcoes
}

export function MarchaTempoExport({
  open,
  onClose,
  trechos,
  templatesPorTrecho,
  tracos,
  tarefas,
  dataDate,
  dominioTempo,
  opcoes
}: MarchaTempoExportProps): ReactNode {
  const [tamanho, setTamanho] = useState<'A4' | 'A3'>('A4')
  const [orient, setOrient] = useState<'retrato' | 'paisagem'>('retrato')
  const [incluirFaixas, setIncluirFaixas] = useState(true)
  const [preview, setPreview] = useState(false)

  // Auto-fill via auth-store + scope — campos não-editáveis pelo user
  const empresaNome = useAuthStore((s) => s.empresa?.nome ?? '—')
  const userNome = useAuthStore((s) => s.profile?.nome ?? '—')
  const scope = useCurrentScope()
  const obraNome = scope.obra?.nome ?? ''

  // Campos do carimbo. Empresa/obra/responsável vêm do sistema (auto-fill).
  // Trecho/intervalo/período são recomputados por página dentro do Sheet.
  // Título/desenho/escala/revisão são editáveis pelo user.
  const carimboDefaults = useMemo<CarimboCampos>(() => {
    return {
      empresa: empresaNome,
      obra: obraNome,
      titulo: 'Diagrama Marcha-Tempo',
      trecho: trechos[0]?.nome ?? '',
      intervalo: '—',
      periodo: '—',
      revisao: 'Rev. 04',
      desenhoNum: 'MT-001',
      responsavel: userNome,
      escala: 'INDICADA',
      folha: '01/01'
    }
  }, [empresaNome, obraNome, userNome, trechos])
  const [carimbo, setCarimbo] = useState<CarimboCampos>(carimboDefaults)

  // Sincroniza auto-fill se mudar empresa/obra/usuário enquanto modal aberto
  useEffect(() => {
    setCarimbo((c) => ({
      ...c,
      empresa: empresaNome,
      obra: obraNome,
      responsavel: userNome
    }))
  }, [empresaNome, obraNome, userNome])

  if (!open) return null

  if (preview) {
    return createPortal(
      <PreviewSheet
        tamanho={tamanho}
        orient={orient}
        carimbo={carimbo}
        incluirFaixas={incluirFaixas}
        trechos={trechos}
        templatesPorTrecho={templatesPorTrecho}
        tracos={tracos}
        tarefas={tarefas}
        dataDate={dataDate}
        dominioTempo={dominioTempo}
        opcoes={opcoes}
        onClose={() => setPreview(false)}
      />,
      document.body
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      size="md"
    >
      <DialogHeader>
        <DialogTitle>Exportar Marcha-Tempo em PDF</DialogTitle>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
        <Linha label="Tamanho">
          <Seg opts={['A4', 'A3'] as const} value={tamanho} onChange={(v) => setTamanho(v)} />
        </Linha>
        <Linha label="Orientação">
          <Seg
            opts={['retrato', 'paisagem'] as const}
            value={orient}
            onChange={(v) => setOrient(v)}
          />
        </Linha>
        <label className="flex items-center gap-2 cursor-pointer text-text-muted text-xs">
          <input
            type="checkbox"
            checked={incluirFaixas}
            onChange={(e) => setIncluirFaixas(e.target.checked)}
            className="w-3.5 h-3.5 accent-accent"
          />
          Incluir faixas de quantidade
        </label>
        <div className="text-2xs text-text-dim font-mono">
          {trechos.length} {trechos.length === 1 ? 'página' : 'páginas'} no PDF
          (1 por trecho selecionado)
        </div>

        <div className="h-px bg-border my-1" />
        <div className="text-2xs uppercase tracking-wider text-text-dim">Carimbo</div>

        {/* Campos auto-fill (read-only) — vêm do sistema */}
        <div className="grid grid-cols-2 gap-2 px-2 py-2 rounded bg-bg/50 border border-border/60 text-2xs font-mono">
          <AutoCampo label="Empresa" value={carimbo.empresa} />
          <AutoCampo label="Obra" value={carimbo.obra} />
          <AutoCampo label="Responsável" value={carimbo.responsavel} />
        </div>

        {/* Campos editáveis */}
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Título" value={carimbo.titulo} onChange={(v) => setCarimbo({ ...carimbo, titulo: v })} />
          <Campo label="Desenho nº" value={carimbo.desenhoNum} onChange={(v) => setCarimbo({ ...carimbo, desenhoNum: v })} />
          <Campo label="Revisão" value={carimbo.revisao} onChange={(v) => setCarimbo({ ...carimbo, revisao: v })} />
          <Campo label="Escala" value={carimbo.escala} onChange={(v) => setCarimbo({ ...carimbo, escala: v })} />
        </div>
        <p className="text-2xs text-text-faint">
          Trecho/intervalo/período/folha são preenchidos automaticamente por
          página a partir das tarefas atuais.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="default" size="sm" onClick={() => setPreview(true)}>
          Pré-visualizar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function Linha({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <Label className="!mb-0">{label}</Label>
      {children}
    </div>
  )
}

function Seg<T extends string>({
  opts,
  value,
  onChange
}: {
  opts: readonly T[]
  value: T
  onChange: (v: T) => void
}): ReactNode {
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-3 py-1 text-2xs rounded border transition-colors ${
            value === o
              ? 'border-border-accent bg-accent/10 text-accent-hover'
              : 'border-border bg-bg text-text-dim hover:bg-bg-hover'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Campo({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-2xs">{label}</Label>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-xs"
      />
    </div>
  )
}

function AutoCampo({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-2xs uppercase tracking-wider text-text-faint">{label}</span>
      <span
        className="text-xs text-text-muted truncate"
        title={value}
      >
        {value || '—'}
      </span>
    </div>
  )
}

// ─── Preview Sheet ──────────────────────────────────────────────────────────

interface PreviewSheetProps extends Omit<MarchaTempoExportProps, 'open'> {
  tamanho: 'A4' | 'A3'
  orient: 'retrato' | 'paisagem'
  carimbo: CarimboCampos
  incluirFaixas: boolean
}

function PreviewSheet(props: PreviewSheetProps): ReactNode {
  const dims = pageDims(props.tamanho, props.orient)
  const [scale, setScale] = useState(1)

  // @page size — usa keywords (A4/A3 + landscape/portrait) que o browser
  // respeita melhor que dimensões em mm pra rotação automática.
  const pageSize = useMemo(() => {
    const orient = props.orient === 'paisagem' ? 'landscape' : 'portrait'
    return `${props.tamanho} ${orient}`
  }, [props.tamanho, props.orient])

  useEffect(() => {
    const calc = (): void => {
      const margin = 48
      const sx = (window.innerWidth - margin) / dims.w
      const sy = (window.innerHeight - 100) / dims.h
      setScale(Math.min(1, Math.min(sx, sy)))
    }
    calc()
    window.addEventListener('resize', calc)
    return (): void => window.removeEventListener('resize', calc)
  }, [dims.w, dims.h])

  const handlePrint = (): void => {
    document.body.classList.add('mt-printing')
    setTimeout(() => {
      window.print()
      setTimeout(() => document.body.classList.remove('mt-printing'), 500)
    }, 100)
  }

  return (
    <div className="mt-print-root fixed inset-0 z-[2000] flex flex-col bg-[oklch(14%_0.006_255)]">
      {/* @page dinâmico (injeção via <style>) — browser usa esse tamanho ao
          imprimir, evitando crop por mismatch de tamanho de papel default. */}
      <style>{`@media print { @page { size: ${pageSize}; margin: 0; } }`}</style>
      <div className="mt-print-toolbar flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border">
        <span className="text-xs text-text-muted">
          Pré-visualização · {props.tamanho} {props.orient} ·{' '}
          {props.trechos.length} página{props.trechos.length > 1 ? 's' : ''}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Voltar
          </Button>
          <Button variant="default" size="sm" onClick={handlePrint}>
            Imprimir / Salvar PDF
          </Button>
        </div>
      </div>
      <div className="mt-print-pages flex-1 overflow-auto flex flex-col items-center gap-6 px-6 py-4">
        {props.trechos.map((tr, idx) => (
          <div
            key={tr.id}
            data-mt-export-page={idx + 1}
            className="export-page flex flex-col items-center gap-2"
            // Layout total = scaled size + badge height (~24px)
            style={{ width: dims.w * scale, scrollMarginTop: 16 }}
          >
            <div className="mt-print-page-badge flex items-center gap-2 text-2xs font-mono uppercase tracking-widest text-text-dim">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-bg-elevated text-text-muted">
                <span className="text-text-faint">Página</span>
                <span className="text-text font-semibold">{idx + 1}</span>
                <span className="text-text-faint">/ {props.trechos.length}</span>
              </span>
              <span className="text-text-muted">{tr.nome}</span>
            </div>
            <div
              style={{
                width: dims.w * scale,
                height: dims.h * scale,
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: dims.w,
                  height: dims.h,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                  position: 'absolute',
                  top: 0,
                  left: 0
                }}
              >
                <SheetPagina
                  dims={dims}
                  carimbo={props.carimbo}
                  incluirFaixas={props.incluirFaixas}
                  trecho={tr}
                  template={props.templatesPorTrecho.get(tr.id) ?? null}
                  tracos={props.tracos.filter((t) => t.trechoId === tr.id)}
                  tarefas={props.tarefas}
                  dataDate={props.dataDate}
                  dominioTempo={props.dominioTempo}
                  opcoes={props.opcoes}
                  pageIndex={idx}
                  pageCount={props.trechos.length}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface SheetPaginaProps {
  dims: { w: number; h: number }
  carimbo: CarimboCampos
  incluirFaixas: boolean
  trecho: ObraTrecho
  template: TrechoQuantidadeVersaoCompleta | null
  tracos: TracoTarefa[]
  tarefas: Array<{
    id: string
    tipo_no: string
    data_inicio: string | null
    nome_custom: string | null
    servico_grupo_descricao: string | null
    codigo_eap: string | null
    trecho_id: string | null
  }>
  dataDate: string | null
  dominioTempo: [number, number]
  opcoes: MarchaTempoOpcoes
  pageIndex: number
  pageCount: number
}

function SheetPagina({
  dims,
  carimbo: carimboBase,
  incluirFaixas,
  trecho,
  template,
  tracos,
  tarefas,
  dataDate,
  dominioTempo,
  opcoes,
  pageIndex,
  pageCount
}: SheetPaginaProps): ReactNode {
  // Layout DINÂMICO: carimbo ancorado no fundo, diagrama cresce pra ocupar
  // o espaço entre header (em cima) e legenda/carimbo (em baixo).
  // Reservas fixas (todas precisas, somando até a altura usada):
  const PAD = 8
  const HEADER_H = 32 // título 13 + sub 10 + paddingBottom 5 + margem
  const LEGENDA_H = 36 // 1-2 linhas de chips
  const CARIMBO_H = 124
  const GAP = 8 // entre header→diagrama, diagrama→legenda, legenda→carimbo
  const innerW = dims.w - PAD * 2
  // 3 gaps (header→diagrama, diagrama→legenda, legenda→carimbo) = 24
  const usadoH = PAD * 2 + HEADER_H + LEGENDA_H + CARIMBO_H + 3 * GAP
  const diagramH = Math.max(200, dims.h - usadoH)

  // Carimbo: começa do base (campos globais) + overrides por trecho
  // (obra/trecho/intervalo/periodo/folha são recomputados PRA CADA página).
  const carimbo: CarimboCampos = useMemo(() => {
    let posLo = Number.POSITIVE_INFINITY
    let posHi = Number.NEGATIVE_INFINITY
    let dataLo = Number.POSITIVE_INFINITY
    let dataHi = Number.NEGATIVE_INFINITY
    for (const t of tracos) {
      for (const ilha of t.ilhas) {
        for (const p of ilha) {
          posLo = Math.min(posLo, p.posicaoM)
          posHi = Math.max(posHi, p.posicaoM)
          const ms = new Date(`${p.data}T00:00:00Z`).getTime()
          dataLo = Math.min(dataLo, ms)
          dataHi = Math.max(dataHi, ms)
        }
      }
    }
    const intervalo = Number.isFinite(posLo)
      ? `${formatMarcadorCompacto(posLo, trecho)} → ${formatMarcadorCompacto(posHi, trecho)}`
      : carimboBase.intervalo
    const periodo = Number.isFinite(dataLo)
      ? `${fmtMesAno(dataLo)} → ${fmtMesAno(dataHi)}`
      : carimboBase.periodo
    return {
      ...carimboBase,
      obra: carimboBase.obra || trecho.nome,
      trecho: trecho.nome,
      intervalo,
      periodo,
      folha: `${String(pageIndex + 1).padStart(2, '0')}/${String(pageCount).padStart(2, '0')}`
    }
  }, [carimboBase, tracos, trecho.nome, pageIndex, pageCount])

  // Cor base por código (mesma lógica que MarchaTempoSeriesPanel/Faixas)
  const codigosVisiveis = useMemo(() => {
    const set = new Set<string>()
    for (const t of tracos) {
      const cod = t.codigo ?? t.tarefaId
      const est = opcoes.estilosSerie[cod]
      if (est?.visivel === false) continue
      set.add(cod)
    }
    return set
  }, [tracos, opcoes.estilosSerie])

  const legendaItems = useMemo(() => {
    const m = new Map<
      string,
      { codigo: string; label: string; cor: string; count: number }
    >()
    for (const t of tracos) {
      const cod = t.codigo ?? t.tarefaId
      if (!codigosVisiveis.has(cod)) continue
      const est = opcoes.estilosSerie[cod]
      const cor = pcor(est?.cor ?? t.cor)
      const atual = m.get(cod)
      if (atual) atual.count++
      else m.set(cod, { codigo: cod, label: t.label, cor, count: 1 })
    }
    return Array.from(m.values())
  }, [tracos, codigosVisiveis, opcoes.estilosSerie])

  // Conflitos só pra séries VISÍVEIS
  const totalConflitos = useMemo(() => {
    if (!opcoes.mostrarConflitos) return 0
    const visiveis = tracos.filter(
      (t) =>
        t.trechoId === trecho.id &&
        (!t.codigo || opcoes.estilosSerie[t.codigo]?.visivel !== false)
    )
    return detectarConflitos(visiveis).length
  }, [tracos, trecho.id, opcoes.mostrarConflitos, opcoes.estilosSerie])

  return (
    <div
      className="export-sheet"
      style={{
        width: dims.w,
        height: dims.h,
        background: '#fff',
        color: '#111827',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)'
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          border: '1.5px solid #374151',
          padding: PAD,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflow: 'hidden'
        }}
      >
        {/* Header — stack vertical (referência canon) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            borderBottom: '1px solid #9ca3af',
            paddingBottom: 5,
            flex: 'none'
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
            MARCHA-TEMPO · DIAGRAMA TEMPO × POSIÇÃO
          </div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>
            {carimbo.obra} · {carimbo.trecho}
          </div>
        </div>

        {/* Diagrama — `flex: 1` faz absorver TODO o espaço restante entre
            header (no topo) e legenda/carimbo (no fim). Sem espaço morto. */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <DiagramaExport
            W={innerW}
            H={diagramH}
            trecho={trecho}
            template={template}
            tracos={tracos}
            tarefas={tarefas}
            dataDate={dataDate}
            dominioTempo={dominioTempo}
            estilosSerie={opcoes.estilosSerie}
            colunasQuantidade={opcoes.colunasQuantidade}
            incluirFaixas={incluirFaixas}
            passoPosicaoM={opcoes.passoPosicaoM}
          />
        </div>

        {/* Legenda */}
        <div
          style={{
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            border: '1px solid #9ca3af',
            padding: '0 10px',
            minHeight: 28
          }}
        >
          <span style={{ fontSize: 9, letterSpacing: '0.1em', color: '#6b7280' }}>LEGENDA</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {legendaItems.map((l) => (
              <div
                key={l.codigo}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 10,
                  color: '#374151'
                }}
              >
                <svg width="20" height="6">
                  <line x1="0" y1="3" x2="20" y2="3" stroke={l.cor} strokeWidth="2" />
                </svg>
                <span>
                  {l.label}
                  {l.count > 1 && (
                    <span style={{ color: '#6b7280', marginLeft: 4 }}>
                      ×{l.count}
                    </span>
                  )}
                </span>
              </div>
            ))}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#374151' }}>
              <svg width="14" height="14">
                <circle cx="7" cy="7" r="4" fill="none" stroke={TODAY_COR} strokeWidth="1.5" />
              </svg>
              <span>HOJE</span>
            </div>
            {totalConflitos > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#374151' }}>
                <svg width="14" height="14">
                  <circle cx="7" cy="7" r="3.2" fill="none" stroke="#dc2626" strokeWidth="1.5" />
                </svg>
                <span>CONFLITO</span>
              </div>
            )}
          </div>
        </div>

        {/* Carimbo */}
        <Carimbo carimbo={carimbo} />
      </div>
    </div>
  )
}

// ─── Carimbo (selo técnico) ─────────────────────────────────────────────────

function Carimbo({ carimbo }: { carimbo: CarimboCampos }): ReactNode {
  const cellStyle: CSSProperties = {
    boxSizing: 'border-box',
    borderRight: '1px solid #9ca3af',
    padding: '5px 8px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
    minWidth: 0,
    flex: 1
  }
  const kStyle: CSSProperties = {
    fontSize: 6.5,
    letterSpacing: '0.08em',
    color: '#6b7280',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    lineHeight: 1.15
  }
  const vStyle: CSSProperties = {
    fontSize: 10.5,
    fontWeight: 600,
    color: '#111827',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    lineHeight: 1.15
  }
  const rowStyle: CSSProperties = {
    boxSizing: 'border-box',
    flex: 1,
    display: 'flex',
    borderBottom: '1px solid #9ca3af',
    minHeight: 0,
    alignItems: 'stretch'
  }

  return (
    <div
      style={{
        flex: 'none',
        boxSizing: 'border-box',
        display: 'flex',
        border: '1.5px solid #374151',
        height: 124
      }}
    >
      <div
        style={{
          width: 152,
          flex: 'none',
          borderRight: '1.5px solid #374151',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: 6,
          textAlign: 'center'
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#111827', lineHeight: 1.18 }}>
          {carimbo.empresa}
        </div>
        <div style={{ fontSize: 6.5, letterSpacing: '0.1em', color: '#6b7280' }}>
          ENGENHARIA · PLANEJAMENTO
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Linha 1: OBRA | TÍTULO */}
        <div style={rowStyle}>
          <div style={cellStyle}>
            <div style={kStyle}>OBRA</div>
            <div style={vStyle}>{carimbo.obra}</div>
          </div>
          <div style={{ ...cellStyle, borderRight: 'none' }}>
            <div style={kStyle}>TÍTULO</div>
            <div style={vStyle}>{carimbo.titulo}</div>
          </div>
        </div>
        {/* Linha 2: INTERVALO (ESTACA) | PERÍODO */}
        <div style={rowStyle}>
          <div style={cellStyle}>
            <div style={kStyle}>INTERVALO (ESTACA)</div>
            <div style={vStyle}>{carimbo.intervalo}</div>
          </div>
          <div style={{ ...cellStyle, borderRight: 'none' }}>
            <div style={kStyle}>PERÍODO</div>
            <div style={vStyle}>{carimbo.periodo}</div>
          </div>
        </div>
        {/* Linha 3: TRECHO | DESENHO Nº | ESCALA | REVISÃO */}
        <div style={rowStyle}>
          <div style={cellStyle}>
            <div style={kStyle}>TRECHO</div>
            <div style={vStyle}>{carimbo.trecho}</div>
          </div>
          <div style={cellStyle}>
            <div style={kStyle}>DESENHO Nº</div>
            <div style={vStyle}>{carimbo.desenhoNum}</div>
          </div>
          <div style={cellStyle}>
            <div style={kStyle}>ESCALA</div>
            <div style={vStyle}>{carimbo.escala}</div>
          </div>
          <div style={{ ...cellStyle, borderRight: 'none' }}>
            <div style={kStyle}>REVISÃO</div>
            <div style={vStyle}>{carimbo.revisao}</div>
          </div>
        </div>
        {/* Linha 4: DATA | RESPONSÁVEL TÉCNICO | FOLHA */}
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <div style={cellStyle}>
            <div style={kStyle}>DATA</div>
            <div style={vStyle}>{fmtDataBR(Date.now())}</div>
          </div>
          <div style={cellStyle}>
            <div style={kStyle}>RESPONSÁVEL</div>
            <div style={vStyle}>{carimbo.responsavel}</div>
          </div>
          <div style={{ ...cellStyle, borderRight: 'none' }}>
            <div style={kStyle}>FOLHA</div>
            <div style={vStyle}>{carimbo.folha}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Diagrama em SVG p/ impressão (cores em PRINT_COR) ─────────────────────

interface DiagramaExportProps {
  W: number
  H: number
  trecho: ObraTrecho
  template: TrechoQuantidadeVersaoCompleta | null
  tracos: TracoTarefa[]
  tarefas: Array<{
    id: string
    tipo_no: string
    data_inicio: string | null
    nome_custom: string | null
    servico_grupo_descricao: string | null
    codigo_eap: string | null
    trecho_id: string | null
  }>
  dataDate: string | null
  dominioTempo: [number, number]
  estilosSerie: Record<string, EstiloSerie>
  colunasQuantidade: string[]
  incluirFaixas: boolean
  /** Passo do eixo X em metros (null = auto). Espelha opção do usuário no menu. */
  passoPosicaoM: number | null
}

function DiagramaExport({
  W,
  H,
  trecho,
  template,
  tracos,
  tarefas,
  dataDate,
  dominioTempo,
  estilosSerie,
  colunasQuantidade,
  incluirFaixas,
  passoPosicaoM
}: DiagramaExportProps): ReactNode {
  const [t0, t1] = dominioTempo

  // Domínio de posição vindo dos tracos
  const [px0, px1] = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const t of tracos) {
      if (t.trechoId !== trecho.id) continue
      for (const ilha of t.ilhas) {
        for (const p of ilha) {
          lo = Math.min(lo, p.posicaoM)
          hi = Math.max(hi, p.posicaoM)
        }
      }
    }
    if (!Number.isFinite(lo)) return [0, 1000] as const
    const pad = (hi - lo) * 0.05
    return [Math.max(0, lo - pad), hi + pad] as const
  }, [tracos, trecho.id])

  const GUT = { l: 58, r: 58, t: 26, b: 30 }
  const colsVis = incluirFaixas && template
    ? colunasQuantidade
        .map((nome) => template.colunas.find((c) => c.nome === nome))
        .filter((c): c is NonNullable<typeof c> => !!c)
    : []
  const coresColunas = resolverCoresColunas(
    colsVis.map((c) => c.nome),
    tracos.map((t) => ({ codigo: t.codigo ?? t.tarefaId, label: t.label, cor: t.cor })),
    estilosSerie
  )
  // Sufixo único p/ ids de gradiente (evita colisão entre páginas/trechos).
  const gradSuffix = trecho.id.replace(/[^a-zA-Z0-9]/g, '')
  const FH = 14
  const FB = 26
  const FG = 9
  const faixasH = colsVis.length
    ? colsVis.length * (FH + FB) + (colsVis.length - 1) * FG + 8
    : 0
  const clearTopo = colsVis.length ? 16 : 0
  const plotTop = GUT.t + faixasH + clearTopo
  const innerW = W - GUT.l - GUT.r
  const innerH = H - plotTop - GUT.b

  const sx = (v: number): number => ((v - px0) / Math.max(1, px1 - px0)) * innerW
  const sy = (ms: number): number => ((ms - t0) / Math.max(1, t1 - t0)) * innerH

  // grids — respeita passoPosicaoM personalizado quando definido pelo user
  const spanX = px1 - px0
  const cands =
    passoPosicaoM != null && passoPosicaoM > 0
      ? [passoPosicaoM]
      : [500, 1000, 2000, 5000, 10000, 25000, 50000]
  let majX = cands[cands.length - 1]
  for (const c of cands) {
    if (innerW / (spanX / c) >= 82) {
      majX = c
      break
    }
  }
  const minX = majX / 5
  const majorsX: number[] = []
  const minorsX: number[] = []
  for (let m = Math.floor(px0 / minX) * minX; m <= px1 + 0.5; m += minX) {
    if (m < px0 - 0.5 || m < 0) continue
    ;(Math.abs(m - Math.round(m / majX) * majX) < 0.5 ? majorsX : minorsX).push(m)
  }

  const meses = gerarMesesGrid(t0, t1)
  const semanas: number[] = []
  const shift = (new Date(t0).getDay() + 6) % 7
  let mon = meiaNoite(t0 - shift * DAY)
  while (mon < t0) mon += 7 * DAY
  const spDia = innerH / Math.max(1, (t1 - t0) / DAY)
  const passo = spDia * 7 >= 24 ? 1 : spDia * 7 >= 12 ? 2 : 4
  let k = 0
  while (mon <= t1) {
    if (k % passo === 0) semanas.push(mon)
    mon += 7 * DAY
    k += 1
  }
  const bandas = bandasNaoTrabalhadas(t0, t1)

  const todayMs = dataDate ? new Date(`${dataDate}T00:00:00Z`).getTime() : Date.now()
  const todayY = sy(todayMs)
  const dentro = (y: number): boolean => y >= -1 && y <= innerH + 1

  const conflitos = detectarConflitos(
    tracos.filter(
      (t) =>
        t.trechoId === trecho.id &&
        (!t.codigo || estilosSerie[t.codigo]?.visivel !== false)
    )
  )

  const marcos = tarefas.filter(
    (t) =>
      t.tipo_no === 'marco' &&
      t.data_inicio &&
      (t.trecho_id == null || t.trecho_id === trecho.id)
  )

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <defs>
        <clipPath id="expPlotClip">
          <rect x="0" y="0" width={innerW} height={innerH} />
        </clipPath>
      </defs>

      {/* Faixas de quantidade */}
      {colsVis.length > 0 && template && (
        <g transform={`translate(${GUT.l},${GUT.t})`}>
          {colsVis.map((col, i) => {
            const top = i * (FH + FB + FG)
            const by = top + FH
            const codigo = col.nome.match(/^\s*([\w.-]+)/)?.[1] ?? col.nome
            // Cor da faixa = cor da trajetória do serviço no plot (casada por
            // código ou nome), incl. a cor custom escolhida no painel de séries.
            const cor = pcor(coresColunas[col.nome] ?? estilosSerie[codigo]?.cor ?? corDoServico(codigo))
            const segs = template.segmentos
              .map((s) => ({
                ini: Math.min(s.posicao_inicio_m, s.posicao_fim_m),
                fim: Math.max(s.posicao_inicio_m, s.posicao_fim_m),
                valor:
                  typeof s.valores[col.id] === 'number' ? Number(s.valores[col.id]) : 0
              }))
              .filter((s) => s.fim > s.ini && s.valor > 0)
            const total = segs.reduce((s, x) => s + x.valor, 0)
            const vals = segs.map((s) => s.valor)
            const vmin = vals.length ? Math.min(...vals) : 0
            const vmax = vals.length ? Math.max(...vals) : 1

            return (
              <g key={col.id}>
                <rect x={0} y={top + 3} width={7} height={8} fill={cor} />
                <text x={11} y={top + 10} fontSize={9} fontWeight={700} fill="#111827" fontFamily="ui-monospace, monospace">
                  {codigo} · {col.nome}
                </text>
                <text x={innerW} y={top + 10} textAnchor="end" fontSize={8.5} fill="#6b7280" fontFamily="ui-monospace, monospace">
                  Σ {fmtQtdCompact(total)} {col.unidade}
                </text>
                <rect x={0} y={by} width={innerW} height={FB} fill="#fff" stroke="#d1d5db" strokeWidth={0.75} />
                {/* Gradiente vertical por coluna — mesma estética da visualização. */}
                <defs>
                  <linearGradient id={`bandgrad-${i}-${gradSuffix}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={cor} stopOpacity="1" />
                    <stop offset="55%" stopColor={cor} stopOpacity="0.78" />
                    <stop offset="100%" stopColor={cor} stopOpacity="0.42" />
                  </linearGradient>
                </defs>
                {/* Clusterização IDÊNTICA à visualização: segregação por desvio de
                    densidade + cap anti-supercluster, e gradiente com intensidade
                    proporcional ao valor (lib compartilhada). */}
                {(() => {
                  const MIN_LABEL_PX = 22
                  const MAX_CLUSTER_PX = Math.min(220, innerW / 6)
                  const stdDens = desvioDensidadeSegs(segs)
                  const clusters = clusterizarSegmentos(
                    segs,
                    sx,
                    innerW,
                    MIN_LABEL_PX,
                    stdDens,
                    MAX_CLUSTER_PX
                  )
                  return clusters.map((c, j) => {
                    const rx0 = sx(c.ini)
                    const rx1 = sx(c.fim)
                    const x0 = Math.max(0, Math.min(innerW, rx0))
                    const x1 = Math.max(0, Math.min(innerW, rx1))
                    const w = x1 - x0
                    if (w < 0.5) return null
                    const v = c.count > 0 ? c.valor / c.count : c.valor
                    const tt = vmax > vmin ? (v - vmin) / (vmax - vmin) : 0.5
                    const alpha = 0.42 + Math.max(0, Math.min(1, tt)) * (0.95 - 0.42)
                    const ctr = (rx0 + rx1) / 2
                    return (
                      <g key={j}>
                        <rect
                          x={x0}
                          y={by}
                          width={w}
                          height={FB}
                          fill={`url(#bandgrad-${i}-${gradSuffix})`}
                          fillOpacity={alpha}
                        />
                        <rect x={x0} y={by} width={w} height={2.5} fill={cor} />
                        {/* Sub-divisões internas quando o cluster tem múltiplos segmentos */}
                        {c.count > 1 &&
                          w > 12 &&
                          segs
                            .filter((s) => s.ini >= c.ini && s.fim <= c.fim)
                            .slice(0, -1)
                            .map((s, sj) => {
                              const xSub = sx(s.fim)
                              if (xSub < x0 + 1 || xSub > x1 - 1) return null
                              return (
                                <line
                                  key={`sub${sj}`}
                                  x1={xSub}
                                  x2={xSub}
                                  y1={by + 2}
                                  y2={by + FB - 1}
                                  stroke={cor}
                                  strokeWidth={0.5}
                                  opacity={0.35}
                                />
                              )
                            })}
                        {/* Borda do cluster */}
                        {w > 6 && (
                          <rect
                            x={x0}
                            y={by}
                            width={w}
                            height={FB}
                            fill="none"
                            stroke={cor}
                            strokeWidth={0.5}
                            opacity={0.6}
                          />
                        )}
                        {w >= 16 && ctr >= 0 && ctr <= innerW && (
                          <text
                            x={ctr}
                            y={by + FB / 2 + 3.5}
                            textAnchor="middle"
                            fontSize={w >= 44 ? 9 : w >= 32 ? 8 : 7}
                            fontWeight={700}
                            fill="#111827"
                            fontFamily="ui-monospace, monospace"
                          >
                            {fmtQtdCompact(c.valor)}
                          </text>
                        )}
                      </g>
                    )
                  })
                })()}
              </g>
            )
          })}
        </g>
      )}

      <g transform={`translate(${GUT.l},${plotTop})`}>
        <rect x="0" y="0" width={innerW} height={innerH} fill="#ffffff" />

        {/* Zebra + bandas */}
        <g clipPath="url(#expPlotClip)">
          {meses.map((m, i) =>
            m.zebra ? (
              <rect
                key={`z${i}`}
                x="0"
                y={sy(m.ms)}
                width={innerW}
                height={Math.max(0, sy(m.fim) - sy(m.ms))}
                fill="#f6f7f9"
              />
            ) : null
          )}
          {bandas.map((b, i) => (
            <rect
              key={`b${i}`}
              x="0"
              y={sy(b.inicio)}
              width={innerW}
              height={Math.max(0, sy(b.fim) - sy(b.inicio))}
              fill={b.fer ? '#e6e8eb' : '#eef0f2'}
            />
          ))}
        </g>

        {/* Grid */}
        <g clipPath="url(#expPlotClip)">
          {minorsX.map((m, i) => (
            <line key={`nx${i}`} x1={sx(m)} y1="0" x2={sx(m)} y2={innerH} stroke="#edeef1" strokeWidth={0.6} />
          ))}
          {semanas.map((d, i) => (
            <line key={`ny${i}`} x1="0" y1={sy(d)} x2={innerW} y2={sy(d)} stroke="#edeef1" strokeWidth={0.6} />
          ))}
          {majorsX.map((m, i) => (
            <line key={`mx${i}`} x1={sx(m)} y1="0" x2={sx(m)} y2={innerH} stroke="#cbd0d6" strokeWidth={0.75} />
          ))}
          {meses.map((m, i) =>
            i === 0 ? null : (
              <line key={`my${i}`} x1="0" y1={sy(m.ms)} x2={innerW} y2={sy(m.ms)} stroke="#cbd0d6" strokeWidth={0.75} />
            )
          )}
        </g>

        {/* Trajetórias */}
        <g clipPath="url(#expPlotClip)">
          {tracos
            .filter((t) => t.trechoId === trecho.id)
            .map((t) => {
              const codigo = t.codigo ?? t.tarefaId
              const est = estilosSerie[codigo]
              if (est?.visivel === false) return null
              const cor = pcor(est?.cor ?? t.cor)
              const dash = DASHP[est?.dash ?? 'solido']
              return (
                <g key={t.tarefaId}>
                  {t.ilhas.map((ilha, idx) => {
                    const pts = ilha.map((p) => ({
                      x: sx(p.posicaoM),
                      y: sy(new Date(`${p.data}T00:00:00Z`).getTime())
                    }))
                    const d = pathReto(pts)
                    return (
                      <g key={idx}>
                        <path d={d} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
                        <path d={d} fill="none" stroke={cor} strokeWidth={1.5} strokeDasharray={dash || undefined} strokeLinejoin="round" strokeLinecap="round" />
                      </g>
                    )
                  })}
                </g>
              )
            })}

          {/* Conflitos */}
          {conflitos.map((c, i) => (
            <circle
              key={`c${i}`}
              cx={sx(c.posM)}
              cy={sy(c.dateMs)}
              r={3.4}
              fill="none"
              stroke="#dc2626"
              strokeWidth={1}
            />
          ))}
        </g>

        {/* Marcos */}
        {marcos.map((m) => {
          if (!m.data_inicio) return null
          const y = sy(new Date(`${m.data_inicio}T00:00:00Z`).getTime())
          if (!dentro(y)) return null
          const nome = m.nome_custom ?? m.servico_grupo_descricao ?? m.codigo_eap ?? '◆'
          return (
            <g key={m.id}>
              <line x1="0" y1={y} x2={innerW} y2={y} stroke={MARCO_COR} strokeWidth={1.1} strokeDasharray="4 3" />
              <text x={innerW - 6} y={y - 4} textAnchor="end" fontSize={8} fontWeight={700} fill={MARCO_COR} fontFamily="ui-monospace, monospace">
                {nome}
              </text>
            </g>
          )
        })}

        {/* Today */}
        {dentro(todayY) && (
          <>
            <line x1="0" y1={todayY} x2={innerW} y2={todayY} stroke={TODAY_COR} strokeWidth={1.6} strokeDasharray="6 4" />
            <text x="6" y={todayY - 4} fontSize={8.5} fontWeight={700} fill={TODAY_COR} fontFamily="ui-monospace, monospace">
              HOJE · {fmtDataBR(todayMs)}
            </text>
          </>
        )}

        {/* Borda */}
        <rect x="0" y="0" width={innerW} height={innerH} fill="none" stroke="#374151" strokeWidth={1} />

        {/* Ticks espelhados */}
        {majorsX.map((m, i) => {
          const x = sx(m)
          return (
            <g key={`xt${i}`}>
              <text x={x} y={-9} textAnchor="middle" fontSize={8.5} fill="#374151" fontFamily="ui-monospace, monospace">
                {formatMarcadorCompacto(m, trecho)}
              </text>
              <text x={x} y={innerH + 14} textAnchor="middle" fontSize={8.5} fill="#374151" fontFamily="ui-monospace, monospace">
                {formatMarcadorCompacto(m, trecho)}
              </text>
            </g>
          )
        })}
        {semanas.map((d, i) => {
          const y = sy(d)
          return (
            <g key={`yt${i}`}>
              <text x={-8} y={y + 3} textAnchor="end" fontSize={8.5} fill="#374151" fontFamily="ui-monospace, monospace">
                {fmtDataBR(d)}
              </text>
              <text x={innerW + 8} y={y + 3} textAnchor="start" fontSize={8.5} fill="#374151" fontFamily="ui-monospace, monospace">
                {fmtDataBR(d)}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
