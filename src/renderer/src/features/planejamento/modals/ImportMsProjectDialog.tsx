import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileUp, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'
import {
  Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useItensSincronizaveis } from '@/features/planejamento/hooks/tarefas'
import { usePlanejamentoAtivo, usePlanejamentos } from '@/features/planejamento/hooks/planejamentos'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { useEquipes } from '@/features/planejamento/hooks/equipes'
import { melhorCandidato, normalize } from '@/features/planejamento/lib/fuzzy-match'
import { aplicarImportacao, type AplicarImportacaoResult, type LeafMap } from '@/features/planejamento/hooks/msproject'
import { formatNumber } from '@/lib/format'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  onImported?: (planejamentoId: string) => void
}

type Step = 'upload' | 'preview' | 'mapeamento' | 'aplicando' | 'resultado'
interface LinhaMap { itemId: string; trechoId: string; quantidade: string; equipeId: string }

export function ImportMsProjectDialog({ open, onOpenChange, obraId, onImported }: Props): ReactNode {
  const { data: planoAtivo } = usePlanejamentoAtivo(obraId)
  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const { data: itens = [] } = useItensSincronizaveis(planoAtivo?.id, obraId)
  const { data: trechos = [] } = useObraTrechos(obraId)
  const { data: equipes = [] } = useEquipes(obraId)

  const [step, setStep] = useState<Step>('upload')
  const [arquivoNome, setArquivoNome] = useState('')
  const [tasks, setTasks] = useState<MspTask[]>([])
  const [projectName, setProjectName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mapa, setMapa] = useState<Record<number, LinhaMap>>({})
  const [destinoMode, setDestinoMode] = useState<'novo' | 'existente'>('novo')
  const [novoNome, setNovoNome] = useState('')
  const [destinoPlanoId, setDestinoPlanoId] = useState('')
  const [resultado, setResultado] = useState<AplicarImportacaoResult | null>(null)

  const planosEditaveis = useMemo(
    () => planejamentos.filter((p) => !p.is_baseline && p.status !== 'arquivado'),
    [planejamentos]
  )
  const folhas = useMemo(() => tasks.filter((t) => !t.summary && !t.milestone), [tasks])
  const grupos = tasks.filter((t) => t.summary).length
  const marcos = tasks.filter((t) => t.milestone).length
  const itemOpcoes = useMemo(
    () => itens.map((i) => ({ id: i.id, nome: `${i.codigo} ${i.descricao}` })),
    [itens]
  )

  const reset = (): void => {
    setStep('upload'); setArquivoNome(''); setTasks([]); setProjectName('')
    setError(null); setMapa({}); setResultado(null); setDestinoMode('novo'); setNovoNome(''); setDestinoPlanoId('')
  }

  const escolherArquivo = async (): Promise<void> => {
    setError(null)
    try {
      const r = await window.infrawork.cronograma.escolherArquivo()
      if (r.canceled || !r.path) return
      setArquivoNome(r.name ?? r.path)
      const parsed = await window.infrawork.cronograma.parseMsProject({ path: r.path })
      if (!parsed.ok) { setError(parsed.error); return }
      if (parsed.result.tasks.length === 0) { setError('Nenhuma tarefa encontrada no arquivo.'); return }
      setTasks(parsed.result.tasks)
      setProjectName(parsed.result.projectName)
      setNovoNome(parsed.result.projectName || 'Importado do MS Project')
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao ler arquivo')
    }
  }

  // Inicializa o mapeamento das folhas ao entrar no passo (defaults: ext → fuzzy).
  useEffect(() => {
    if (step !== 'mapeamento' || folhas.length === 0) return
    setMapa((prev) => {
      if (Object.keys(prev).length) return prev
      const trechoPadrao = trechos[0]?.id ?? ''
      const next: Record<number, LinhaMap> = {}
      for (const f of folhas) {
        // item: por código (round-trip) → senão fuzzy pelo nome.
        let itemId = ''
        if (f.ext.itemCodigo) {
          const found = itens.find((i) => i.codigo === f.ext.itemCodigo)
          if (found) itemId = found.id
        }
        if (!itemId) itemId = melhorCandidato(f.name, itemOpcoes, 0.6)?.id ?? ''
        // trecho: por nome → senão padrão.
        let trechoId = trechoPadrao
        if (f.ext.trecho) {
          const tr = trechos.find((t) => normalize(t.nome) === normalize(f.ext.trecho!))
          if (tr) trechoId = tr.id
        }
        // quantidade: ext → referência do item.
        const it = itens.find((i) => i.id === itemId)
        const qtd = f.ext.quantidade ?? it?.quantidade_referencia ?? 0
        // equipe: por nome (1ª se múltiplas).
        let equipeId = ''
        if (f.ext.equipes) {
          const primeira = f.ext.equipes.split(',')[0]?.trim()
          const eq = primeira ? equipes.find((e) => normalize(e.nome) === normalize(primeira)) : undefined
          if (eq) equipeId = eq.id
        }
        next[f.uid] = { itemId, trechoId, quantidade: String(qtd), equipeId }
      }
      return next
    })
  }, [step, folhas, itens, trechos, equipes, itemOpcoes])

  const setLinha = (uid: number, patch: Partial<LinhaMap>): void =>
    setMapa((m) => ({ ...m, [uid]: { ...m[uid], ...patch } }))

  const mapeamentoValido = folhas.length > 0 && folhas.every((f) => {
    const l = mapa[f.uid]
    return l && l.itemId && l.trechoId && Number(l.quantidade) > 0
  })
  const destinoValido =
    (destinoMode === 'novo' && novoNome.trim().length > 0) ||
    (destinoMode === 'existente' && !!destinoPlanoId)

  const aplicar = async (): Promise<void> => {
    setError(null); setStep('aplicando')
    try {
      const mapeamento = new Map<number, LeafMap>()
      for (const f of folhas) {
        const l = mapa[f.uid]
        mapeamento.set(f.uid, {
          itemId: l.itemId,
          trechoId: l.trechoId,
          quantidade: Number(l.quantidade),
          equipeIds: l.equipeId ? [l.equipeId] : []
        })
      }
      const startMin = tasks.map((t) => t.startISO).filter(Boolean).sort()[0] as string | undefined
      const res = await aplicarImportacao({
        obraId,
        destino:
          destinoMode === 'novo'
            ? { mode: 'novo', nome: novoNome, dataReferencia: startMin ?? new Date().toISOString().slice(0, 10) }
            : { mode: 'existente', planejamentoId: destinoPlanoId },
        tasks,
        mapeamento
      })
      setResultado(res)
      setStep('resultado')
      if (res.tarefasCriadas > 0) toast.success(`${res.tarefasCriadas} tarefa(s) importadas.`)
      onImported?.(res.planejamentoId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar')
      setStep('mapeamento')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}
      size="xl"
      disableDismiss={step === 'aplicando'}
    >
      <DialogHeader>
        <DialogTitle>Importar cronograma do MS Project</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        {step === 'upload' ? (
          <div className="space-y-3 py-4">
            <div className="text-2xs font-mono text-text-dim">
              Selecione o arquivo <span className="text-text">.xml</span> exportado do MS Project
              (Arquivo → Salvar como → XML). Tarefas-folha serão <strong>mapeadas</strong> para
              serviços do orçamento; grupos e marcos entram como estrutura.
            </div>
            <Button variant="default" onClick={escolherArquivo}>
              <FileUp size={11} /> Selecionar arquivo
            </Button>
          </div>
        ) : null}

        {step === 'preview' ? (
          <div className="space-y-2">
            <div className="text-2xs font-mono text-text-dim">
              Arquivo: <span className="text-text">{arquivoNome}</span> · projeto:{' '}
              <span className="text-text">{projectName || '—'}</span>
            </div>
            <div className="flex gap-2 text-2xs font-mono">
              <Badge variant="success">{folhas.length} tarefas</Badge>
              <Badge>{grupos} grupos</Badge>
              <Badge>{marcos} marcos</Badge>
            </div>
            <div className="max-h-[360px] overflow-auto rounded border border-border">
              <table className="w-full text-xs font-mono">
                <thead className="text-2xs text-text-dim bg-bg-elevated sticky top-0">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 text-left">Tarefa</th>
                    <th className="px-2 py-1 text-left">Tipo</th>
                    <th className="px-2 py-1 text-right">Dur. (d.ú.)</th>
                    <th className="px-2 py-1 text-right">Preds</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.uid} className="border-b border-border/40">
                      <td className="px-2 py-1 text-text truncate max-w-[360px]" title={t.name}>
                        <span style={{ paddingLeft: `${(t.outlineLevel - 1) * 10}px` }}>{t.name}</span>
                      </td>
                      <td className="px-2 py-1 text-text-muted text-2xs">
                        {t.summary ? 'grupo' : t.milestone ? 'marco' : 'tarefa'}
                      </td>
                      <td className="px-2 py-1 text-right text-text-muted tabular-nums">
                        {t.summary || t.milestone ? '—' : formatNumber(t.durationDias ?? 0, 0)}
                      </td>
                      <td className="px-2 py-1 text-right text-text-dim tabular-nums">
                        {t.predecessors.length || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {step === 'mapeamento' ? (
          <div className="space-y-3">
            {/* Destino */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-2xs font-mono uppercase text-text-dim">Destino</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={destinoMode === 'novo'} onChange={() => setDestinoMode('novo')} className="accent-[var(--accent)]" />
                Novo plano
              </label>
              {destinoMode === 'novo' ? (
                <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className="w-[220px]" placeholder="Nome do plano" />
              ) : null}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={destinoMode === 'existente'} onChange={() => setDestinoMode('existente')} className="accent-[var(--accent)]" />
                Plano existente
              </label>
              {destinoMode === 'existente' ? (
                <select
                  value={destinoPlanoId}
                  onChange={(e) => setDestinoPlanoId(e.target.value)}
                  className="h-7 px-2 rounded text-2xs font-mono bg-bg-elevated border border-border-strong text-text"
                >
                  <option value="">Selecione…</option>
                  {planosEditaveis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              ) : null}
            </div>

            {itens.length === 0 ? (
              <div className="text-2xs font-mono text-warn">
                <AlertTriangle size={11} className="inline mr-1" />
                Nenhum serviço do orçamento encontrado — importe o orçamento antes.
              </div>
            ) : null}

            <div className="max-h-[360px] overflow-auto rounded border border-border">
              <table className="w-full text-xs">
                <thead className="text-2xs text-text-dim bg-bg-elevated sticky top-0">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 text-left">Tarefa (MSP)</th>
                    <th className="px-2 py-1 text-left">Serviço (orçamento)</th>
                    <th className="px-2 py-1 text-left">Trecho</th>
                    <th className="px-2 py-1 text-right">Quantidade</th>
                    <th className="px-2 py-1 text-left">Equipe</th>
                  </tr>
                </thead>
                <tbody>
                  {folhas.map((f) => {
                    const l = mapa[f.uid] ?? { itemId: '', trechoId: '', quantidade: '0', equipeId: '' }
                    const sug = !f.ext.itemCodigo && !l.itemId ? melhorCandidato(f.name, itemOpcoes, 0.6) : null
                    return (
                      <tr key={f.uid} className="border-b border-border/40 align-top">
                        <td className="px-2 py-1 text-text truncate max-w-[220px]" title={f.name}>{f.name}</td>
                        <td className="px-2 py-1">
                          <select
                            value={l.itemId}
                            onChange={(e) => setLinha(f.uid, { itemId: e.target.value })}
                            className="h-6 w-full max-w-[260px] px-1 rounded text-2xs font-mono bg-bg-elevated border border-border-strong text-text"
                          >
                            <option value="">— Selecionar —</option>
                            {itens.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.descricao}</option>)}
                          </select>
                          {sug ? <span className="text-2xs text-text-dim">sugestão: {itens.find((i) => i.id === sug.id)?.codigo}</span> : null}
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={l.trechoId}
                            onChange={(e) => setLinha(f.uid, { trechoId: e.target.value })}
                            className="h-6 w-full max-w-[140px] px-1 rounded text-2xs font-mono bg-bg-elevated border border-border-strong text-text"
                          >
                            <option value="">—</option>
                            {trechos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-right">
                          <input
                            type="number" value={l.quantidade}
                            onChange={(e) => setLinha(f.uid, { quantidade: e.target.value })}
                            className="h-6 w-[90px] px-1 rounded text-2xs font-mono text-right bg-bg-elevated border border-border-strong text-text"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={l.equipeId}
                            onChange={(e) => setLinha(f.uid, { equipeId: e.target.value })}
                            className="h-6 w-full max-w-[140px] px-1 rounded text-2xs font-mono bg-bg-elevated border border-border-strong text-text"
                          >
                            <option value="">—</option>
                            {equipes.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-2xs font-mono text-text-dim">
              Datas e perfil semanal são recalculados pelo CPM após importar. {marcos} marco(s) e {grupos} grupo(s) entram como estrutura.
            </div>
          </div>
        ) : null}

        {step === 'aplicando' ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="animate-spin text-accent" size={32} />
            <div className="text-xs font-mono text-text-muted">Importando e recalculando…</div>
          </div>
        ) : null}

        {step === 'resultado' && resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-accent">
              <CheckCircle2 size={16} /><span className="text-sm font-mono">Importação concluída</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <Metric label="Tarefas criadas" value={resultado.tarefasCriadas} />
              <Metric label="Dependências" value={resultado.dependenciasCriadas} />
            </div>
            {resultado.avisos.length > 0 ? (
              <details className="text-2xs font-mono text-warn" open>
                <summary className="cursor-pointer">Avisos ({resultado.avisos.length})</summary>
                <ul className="pl-3 mt-1 space-y-0.5 max-h-32 overflow-auto">
                  {resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </details>
            ) : null}
            {resultado.erros.length > 0 ? (
              <details className="text-2xs font-mono text-danger">
                <summary className="cursor-pointer">Erros ({resultado.erros.length})</summary>
                <ul className="pl-3 mt-1 space-y-0.5 max-h-32 overflow-auto">
                  {resultado.erros.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {step === 'upload' ? (
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
        ) : null}
        {step === 'preview' ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setStep('upload')}>Voltar</Button>
            <Button type="button" variant="default" onClick={() => setStep('mapeamento')}>Mapear {folhas.length} tarefa(s)</Button>
          </>
        ) : null}
        {step === 'mapeamento' ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setStep('preview')}>Voltar</Button>
            <Button type="button" variant="default" onClick={aplicar} disabled={!mapeamentoValido || !destinoValido}>
              Importar
            </Button>
          </>
        ) : null}
        {step === 'resultado' ? (
          <Button type="button" variant="default" onClick={() => onOpenChange(false)}>Fechar</Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  )
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-elevated px-3 py-2">
      <div className="text-2xs uppercase tracking-wider text-text-dim">{label}</div>
      <div className="text-text tabular-nums text-base">{value}</div>
    </div>
  )
}
