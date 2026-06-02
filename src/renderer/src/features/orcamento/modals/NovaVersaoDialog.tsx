// NovaVersaoDialog — wizard pra criar nova versão do orçamento com aproveitamento
// parcial de uma revisão anterior. Operação DESTRUTIVA (reseta tabelas live).
//
// Etapa 1 — Configuração:
//   - Revisão de origem (ou "do zero")
//   - Rótulo, observação
//   - Para cada categoria (Planilha, Indireto, Recursos, CPUs):
//       'Não copiar' | 'Tudo' | 'Selecionar itens'
//   - Se "Selecionar itens" → expande lista com checkboxes
//
// Etapa 2 — Confirmação:
//   - Sumário + aviso destrutivo + botão "Resetar e criar"
//
// Antes de apagar tudo, a edge function auto-cria revisão rascunho de
// preservação (estado atual) — segurança contra perda.

import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Check, Search } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useCopiarRevisaoOrcamento, useRevisoes } from '../hooks/revisoes'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

type ModoCategoria = 'nao' | 'tudo' | 'selecionar'

interface ItemSnap {
  id: string
  codigo: string
  descricao: string
  parent_id: string | null
  tipo?: string
}
interface IndSnap {
  id: string
  codigo: string
  descricao: string
}

export function NovaVersaoDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const copiar = useCopiarRevisaoOrcamento()
  const { data: revisoes = [] } = useRevisoes(obraId)
  const [step, setStep] = useState<1 | 2>(1)

  const [origemId, setOrigemId] = useState<string>('')
  const [rotulo, setRotulo] = useState('')
  const [observacao, setObservacao] = useState('')
  const [modoPlanilha, setModoPlanilha] = useState<ModoCategoria>('tudo')
  const [modoIndireto, setModoIndireto] = useState<ModoCategoria>('tudo')
  const [modoRecursos, setModoRecursos] = useState<ModoCategoria>('tudo')
  const [modoCpus, setModoCpus] = useState<ModoCategoria>('tudo')

  const [planSel, setPlanSel] = useState<Set<string>>(new Set())
  const [indSel, setIndSel] = useState<Set<string>>(new Set())
  const [buscaPlan, setBuscaPlan] = useState('')
  const [buscaInd, setBuscaInd] = useState('')

  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setStep(1)
    setOrigemId('')
    setRotulo('')
    setObservacao('')
    setModoPlanilha('tudo')
    setModoIndireto('tudo')
    setModoRecursos('tudo')
    setModoCpus('tudo')
    setPlanSel(new Set())
    setIndSel(new Set())
    setBuscaPlan('')
    setBuscaInd('')
    setError(null)
  }

  // Snapshot da revisão escolhida (pra mostrar lista de itens / indireto).
  const origem = useMemo(
    () => revisoes.find((r) => r.id === origemId) ?? null,
    [revisoes, origemId]
  )
  const itensSnap: ItemSnap[] = useMemo(() => {
    const snap = origem?.snapshot as { itens?: ItemSnap[] } | undefined
    return snap?.itens ?? []
  }, [origem])
  const indiretosSnap: IndSnap[] = useMemo(() => {
    const snap = origem?.snapshot as { indireto?: IndSnap[] } | undefined
    return snap?.indireto ?? []
  }, [origem])

  const itensFiltered = useMemo(() => {
    const q = buscaPlan.trim().toLowerCase()
    if (!q) return itensSnap
    return itensSnap.filter(
      (i) =>
        i.codigo.toLowerCase().includes(q) ||
        i.descricao.toLowerCase().includes(q)
    )
  }, [itensSnap, buscaPlan])

  const indiretosFiltered = useMemo(() => {
    const q = buscaInd.trim().toLowerCase()
    if (!q) return indiretosSnap
    return indiretosSnap.filter(
      (i) =>
        i.codigo.toLowerCase().includes(q) ||
        i.descricao.toLowerCase().includes(q)
    )
  }, [indiretosSnap, buscaInd])

  const semOrigem = origemId === ''
  // Se "do zero", força tudo para 'nao' (não há de onde copiar).
  const efetivoModoPlanilha = semOrigem ? 'nao' : modoPlanilha
  const efetivoModoIndireto = semOrigem ? 'nao' : modoIndireto
  const efetivoModoRecursos = semOrigem ? 'nao' : modoRecursos
  const efetivoModoCpus = semOrigem ? 'nao' : modoCpus

  const podeAvancar =
    step === 1 &&
    // Se selecionou "Selecionar itens", precisa ter pelo menos 1
    (efetivoModoPlanilha !== 'selecionar' || planSel.size > 0) &&
    (efetivoModoIndireto !== 'selecionar' || indSel.size > 0)

  const handleAvancar = (): void => {
    setError(null)
    setStep(2)
  }

  const buildPayload = (): Parameters<typeof copiar.mutateAsync>[0] => {
    const sel = (modo: ModoCategoria, ids: Set<string>): 'tudo' | string[] | null => {
      if (modo === 'nao') return null
      if (modo === 'tudo') return 'tudo'
      return Array.from(ids)
    }
    return {
      obra_id: obraId,
      origem_revisao_id: semOrigem ? null : origemId,
      rotulo: rotulo.trim() || undefined,
      observacao: observacao.trim() || undefined,
      copiar: semOrigem
        ? { planilha: null, indireto: null, recursos: null, cpus: null }
        : {
            planilha: sel(modoPlanilha, planSel),
            indireto: sel(modoIndireto, indSel),
            // recursos/cpus: snapshot não captura, então só "tudo" preserva os atuais.
            recursos: modoRecursos === 'nao' ? null : 'tudo',
            cpus: modoCpus === 'nao' ? null : 'tudo'
          }
    }
  }

  const handleConfirmar = async (): Promise<void> => {
    setError(null)
    try {
      const r = await copiar.mutateAsync(buildPayload())
      const partes: string[] = []
      if (r.itens_copiados) partes.push(`${r.itens_copiados} item(ns) da planilha`)
      if (r.indiretos_copiados) partes.push(`${r.indiretos_copiados} indireto(s)`)
      if (r.cpus_preservadas) partes.push('CPUs preservadas')
      if (r.recursos_preservados) partes.push('Recursos preservados')
      const msg = partes.length > 0
        ? `Nova versão criada. ${partes.join(', ')}.`
        : 'Nova versão criada (orçamento zerado).'
      toast.success(msg)
      if (r.snapshot_preservacao_id) {
        toast.info('Estado anterior preservado como revisão rascunho.', { duration: 5000 })
      }
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar versão')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={copiar.isPending}
    >
      <DialogHeader>
        <DialogTitle>
          Nova versão do orçamento
          <span className="ml-2 text-2xs font-mono font-normal text-text-dim">
            (passo {step} de 2)
          </span>
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4 max-h-[70vh] overflow-y-auto">
        <DialogErrorBanner message={error} />

        {step === 1 ? (
          <div className="space-y-4">
            {/* Origem */}
            <div>
              <Label htmlFor="nv-origem">Origem</Label>
              <select
                id="nv-origem"
                value={origemId}
                onChange={(e) => setOrigemId(e.target.value)}
                className="w-full h-8 rounded border border-border-strong bg-bg-elevated px-2 text-xs text-text"
              >
                <option value="">— Começar do zero —</option>
                {revisoes
                  .filter((r) => r.status !== 'cancelada')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      v{r.versao} · {r.rotulo ?? '(sem rótulo)'} · {r.status}
                    </option>
                  ))}
              </select>
              <p className="text-2xs text-text-dim font-mono mt-1">
                Selecione uma revisão pra aproveitar itens dela. Ou comece zerado.
              </p>
            </div>

            {/* Rótulo + observação */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="nv-rotulo">Rótulo desta versão (opcional)</Label>
                <Input
                  id="nv-rotulo"
                  value={rotulo}
                  onChange={(e) => setRotulo(e.target.value)}
                  placeholder="Ex.: v4 — pós-revisão"
                />
              </div>
              <div>
                <Label htmlFor="nv-obs">Observação (opcional)</Label>
                <Input
                  id="nv-obs"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Notas internas"
                />
              </div>
            </div>

            {/* Categorias */}
            {!semOrigem ? (
              <div className="space-y-3">
                <div className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                  Aproveitamento por categoria
                </div>

                <CategoriaRow
                  label="Planilha orçamentária"
                  hint={`${itensSnap.length} item(ns) na origem`}
                  modo={modoPlanilha}
                  setModo={setModoPlanilha}
                />
                {modoPlanilha === 'selecionar' ? (
                  <ListaSelecao
                    items={itensFiltered}
                    selected={planSel}
                    onToggle={(id) => {
                      setPlanSel((prev) => {
                        const n = new Set(prev)
                        if (n.has(id)) n.delete(id)
                        else n.add(id)
                        return n
                      })
                    }}
                    busca={buscaPlan}
                    onBuscaChange={setBuscaPlan}
                    renderItem={(i: ItemSnap) => (
                      <span>
                        <span className="text-text-dim font-mono mr-2">{i.codigo}</span>
                        <span className="text-text">{i.descricao}</span>
                      </span>
                    )}
                  />
                ) : null}

                <CategoriaRow
                  label="Indiretos"
                  hint={`${indiretosSnap.length} item(ns) na origem`}
                  modo={modoIndireto}
                  setModo={setModoIndireto}
                />
                {modoIndireto === 'selecionar' ? (
                  <ListaSelecao
                    items={indiretosFiltered}
                    selected={indSel}
                    onToggle={(id) => {
                      setIndSel((prev) => {
                        const n = new Set(prev)
                        if (n.has(id)) n.delete(id)
                        else n.add(id)
                        return n
                      })
                    }}
                    busca={buscaInd}
                    onBuscaChange={setBuscaInd}
                    renderItem={(i: IndSnap) => (
                      <span>
                        <span className="text-text-dim font-mono mr-2">{i.codigo}</span>
                        <span className="text-text">{i.descricao}</span>
                      </span>
                    )}
                  />
                ) : null}

                <CategoriaRow
                  label="Recursos"
                  hint="Hoje preserva os recursos atuais (não captura no snapshot)"
                  modo={modoRecursos}
                  setModo={setModoRecursos}
                  apenasNaoOuTudo
                />
                <CategoriaRow
                  label="CPUs"
                  hint="Hoje preserva as CPUs atuais (não captura no snapshot)"
                  modo={modoCpus}
                  setModo={setModoCpus}
                  apenasNaoOuTudo
                />
              </div>
            ) : (
              <div className="rounded border border-border bg-bg-elevated/40 p-3 text-2xs text-text-muted font-mono">
                Começando do zero — todas as tabelas serão zeradas. A revisão de
                preservação será criada automaticamente.
              </div>
            )}
          </div>
        ) : (
          // ─── Step 2: Confirmação ──────────────────────────────────────────
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded border border-warn/40 bg-warn/10 p-3">
              <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
              <div className="text-xs text-text">
                <strong className="text-warn">Operação destrutiva.</strong> O estado
                atual da obra (planilha, indireto{!apagarCpus(efetivoModoCpus) ? '' : ', CPUs'}
                {!apagarRecursos(efetivoModoRecursos) ? '' : ', recursos'}) será apagado.
                Uma revisão rascunho de preservação será criada automaticamente
                antes do reset.
              </div>
            </div>

            <div className="rounded border border-border bg-bg-elevated/40 p-3 space-y-2 text-xs">
              <SumarioLinha
                label="Origem"
                value={semOrigem ? 'Começar do zero' : `v${origem?.versao} — ${origem?.rotulo ?? '(sem rótulo)'}`}
              />
              <SumarioLinha
                label="Planilha"
                value={describe(efetivoModoPlanilha, planSel.size)}
              />
              <SumarioLinha
                label="Indireto"
                value={describe(efetivoModoIndireto, indSel.size)}
              />
              <SumarioLinha
                label="Recursos"
                value={efetivoModoRecursos === 'nao' ? 'APAGAR' : 'Preservar atuais'}
              />
              <SumarioLinha
                label="CPUs"
                value={efetivoModoCpus === 'nao' ? 'APAGAR' : 'Preservar atuais'}
              />
              {rotulo.trim() ? <SumarioLinha label="Rótulo" value={rotulo} /> : null}
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={copiar.isPending}
        >
          Cancelar
        </Button>
        {step === 1 ? (
          <Button
            type="button"
            variant="default"
            onClick={handleAvancar}
            disabled={!podeAvancar}
          >
            Continuar <ArrowRight size={11} />
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(1)}
              disabled={copiar.isPending}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleConfirmar}
              disabled={copiar.isPending}
            >
              {copiar.isPending ? 'Aplicando…' : 'Resetar e criar versão'}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}

// ─── Subcomponentes ────────────────────────────────────────────────────────

interface CategoriaRowProps {
  label: string
  hint?: string
  modo: ModoCategoria
  setModo: (m: ModoCategoria) => void
  /** Se true, esconde a opção "Selecionar itens" (categorias sem dados no snapshot). */
  apenasNaoOuTudo?: boolean
}
function CategoriaRow({
  label,
  hint,
  modo,
  setModo,
  apenasNaoOuTudo
}: CategoriaRowProps): ReactNode {
  const opcoes: { val: ModoCategoria; lbl: string }[] = apenasNaoOuTudo
    ? [
        { val: 'nao', lbl: 'Apagar' },
        { val: 'tudo', lbl: 'Preservar' }
      ]
    : [
        { val: 'nao', lbl: 'Não copiar' },
        { val: 'tudo', lbl: 'Tudo' },
        { val: 'selecionar', lbl: 'Selecionar itens' }
      ]
  return (
    <div className="flex items-start gap-3 py-1">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text font-medium">{label}</div>
        {hint ? <div className="text-2xs text-text-dim font-mono">{hint}</div> : null}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {opcoes.map((o) => (
          <button
            key={o.val}
            type="button"
            onClick={() => setModo(o.val)}
            className={
              modo === o.val
                ? 'px-2.5 py-1 text-2xs rounded bg-accent text-[color:var(--primary-foreground)] border border-accent'
                : 'px-2.5 py-1 text-2xs rounded border border-border-strong text-text-muted hover:text-text hover:bg-bg-hover'
            }
          >
            {o.lbl}
          </button>
        ))}
      </div>
    </div>
  )
}

interface ListaSelecaoProps<T extends { id: string }> {
  items: T[]
  selected: Set<string>
  onToggle: (id: string) => void
  busca: string
  onBuscaChange: (v: string) => void
  renderItem: (i: T) => ReactNode
}
function ListaSelecao<T extends { id: string }>({
  items,
  selected,
  onToggle,
  busca,
  onBuscaChange,
  renderItem
}: ListaSelecaoProps<T>): ReactNode {
  return (
    <div className="ml-6 -mt-1 mb-1 rounded border border-border bg-bg-elevated/30">
      <div className="relative px-2 pt-2 pb-1">
        <Search
          size={11}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
        />
        <input
          type="text"
          value={busca}
          onChange={(e) => onBuscaChange(e.target.value)}
          placeholder="Buscar…"
          className="w-full pl-6 pr-2 h-6 bg-bg border border-border rounded text-2xs text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
        />
      </div>
      <div className="max-h-40 overflow-y-auto px-2 pb-2 space-y-0.5">
        {items.length === 0 ? (
          <div className="text-2xs italic text-text-dim py-2 text-center">Vazio</div>
        ) : (
          items.map((i) => {
            const sel = selected.has(i.id)
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => onToggle(i.id)}
                className={
                  sel
                    ? 'w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs text-left bg-accent/15 text-text'
                    : 'w-full flex items-center gap-2 px-1.5 py-1 rounded text-xs text-left text-text-muted hover:bg-bg-hover hover:text-text'
                }
              >
                <span
                  className={
                    sel
                      ? 'w-3.5 h-3.5 inline-flex items-center justify-center rounded border border-accent bg-accent text-[color:var(--primary-foreground)]'
                      : 'w-3.5 h-3.5 inline-flex items-center justify-center rounded border border-border-strong'
                  }
                >
                  {sel ? <Check size={9} /> : null}
                </span>
                <span className="flex-1 truncate">{renderItem(i)}</span>
              </button>
            )
          })
        )}
      </div>
      <div className="text-2xs text-text-dim font-mono px-2 py-1 border-t border-border">
        {selected.size} selecionado(s)
      </div>
    </div>
  )
}

function SumarioLinha({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-2xs text-text-dim font-mono uppercase tracking-wider">{label}</div>
      <div className="flex-1 text-text">{value}</div>
    </div>
  )
}

function describe(modo: ModoCategoria, count: number): string {
  if (modo === 'nao') return 'Não copiar'
  if (modo === 'tudo') return 'Copiar tudo'
  return `Selecionados: ${count}`
}
function apagarRecursos(modo: ModoCategoria): boolean {
  return modo === 'nao'
}
function apagarCpus(modo: ModoCategoria): boolean {
  return modo === 'nao'
}
