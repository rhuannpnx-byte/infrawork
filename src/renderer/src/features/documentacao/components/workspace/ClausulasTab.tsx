import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, FileSearch, Sparkles, Loader2, AlertTriangle, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/layout/EmptyState'
import { cn } from '@/lib/utils'
import { adminApi } from '@/lib/supabase/functions'
import type { ObraDossier, ClausulaAnalise } from '@/types/documentacao'

const riscoBadge: Record<string, { variant: 'danger' | 'warn' | 'success'; label: string }> = {
  alto: { variant: 'danger', label: 'RISCO ALTO' },
  medio: { variant: 'warn', label: 'ATENÇÃO' },
  baixo: { variant: 'success', label: 'BAIXO' }
}

interface Props {
  dossie: ObraDossier
  onAbrirFonte: (docId: string | null, pagina: number | null) => void
}

export function ClausulasTab({ dossie, onAbrirFonte }: Props): ReactNode {
  const obraId = dossie.obra.obra_id
  const [aberta, setAberta] = useState<string | null>(null)
  const [analises, setAnalises] = useState<Record<string, ClausulaAnalise>>({})
  const [carregando, setCarregando] = useState<Set<string>>(new Set())

  // Análises já cacheadas no dossiê.
  const cacheInicial = useMemo(() => {
    const m: Record<string, ClausulaAnalise> = {}
    for (const c of dossie.clausulas) if (c.id && c.analise) m[c.id] = c.analise
    return m
  }, [dossie.clausulas])

  const analiseDe = (id: string | null | undefined): ClausulaAnalise | null =>
    (id && (analises[id] ?? cacheInicial[id])) || null

  const analisar = async (id: string, refresh = false): Promise<void> => {
    setCarregando((p) => new Set(p).add(id))
    try {
      const r = await adminApi.analisarClausula({ obra_id: obraId, clausula_id: id, refresh })
      setAnalises((p) => ({ ...p, [id]: r.analise }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao analisar cláusula')
    } finally {
      setCarregando((p) => {
        const n = new Set(p)
        n.delete(id)
        return n
      })
    }
  }

  if (dossie.clausulas.length === 0) {
    return (
      <EmptyState
        icon="scale"
        title="Sem cláusulas extraídas"
        description="Todas as cláusulas do contrato aparecem aqui após a ingestão. A análise de risco de cada cláusula é gerada por IA sob demanda."
      />
    )
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-2 max-w-3xl mx-auto">
      <p className="text-2xs text-text-dim">
        {dossie.clausulas.length} cláusulas. Clique para abrir; use{' '}
        <b className="text-accent">Analisar com IA</b> para o risco e as implicações (integrado ao
        contexto do contrato e das demais cláusulas).
      </p>
      {dossie.clausulas.map((cl, i) => {
        const id = cl.id ?? String(i)
        const open = aberta === id
        const analise = analiseDe(cl.id)
        const risco = analise?.risco ?? cl.risco ?? null
        const rb = risco ? riscoBadge[risco] : null
        const loading = cl.id ? carregando.has(cl.id) : false
        return (
          <div key={id} className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setAberta(open ? null : id)}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-bg-panel hover:bg-bg-hover text-left"
            >
              <ChevronDown
                size={14}
                className={cn('shrink-0 text-text-dim transition-transform', open && 'rotate-180')}
              />
              {cl.numero ? (
                <span className="text-2xs font-mono text-text-dim shrink-0">{cl.numero}</span>
              ) : null}
              <span className="flex-1 text-xs font-semibold text-text">{cl.titulo}</span>
              {cl.categoria ? (
                <span className="text-[9px] rounded px-1.5 py-0.5 bg-bg text-text-dim border border-border/60">
                  {cl.categoria}
                </span>
              ) : null}
              {rb ? <Badge variant={rb.variant}>{rb.label}</Badge> : null}
            </button>
            {open ? (
              <div className="px-3.5 py-3 text-xs leading-relaxed text-text-muted border-t border-border bg-bg space-y-3">
                {cl.texto ? <p className="whitespace-pre-wrap">{cl.texto}</p> : null}

                {/* Análise IA */}
                {analise ? (
                  <div className="rounded-lg border border-border bg-bg-panel p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-accent" />
                      <span className="text-2xs font-semibold text-text">Análise (IA)</span>
                      {rb ? <Badge variant={rb.variant}>{rb.label}</Badge> : null}
                      {cl.id ? (
                        <button
                          type="button"
                          onClick={() => void analisar(cl.id!, true)}
                          className="ml-auto text-2xs text-text-dim hover:text-accent"
                        >
                          {loading ? 'analisando…' : 'reanalisar'}
                        </button>
                      ) : null}
                    </div>
                    {analise.resumo ? <p className="text-xs text-text">{analise.resumo}</p> : null}
                    {analise.implicacoes.length ? (
                      <div>
                        <div className="text-2xs font-semibold text-text-dim mb-0.5">
                          Implicações
                        </div>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {analise.implicacoes.map((x, k) => (
                            <li key={k} className="text-2xs">
                              {x}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {analise.pontos_atencao.length ? (
                      <div>
                        <div className="text-2xs font-semibold text-warn mb-0.5 flex items-center gap-1">
                          <AlertTriangle size={11} /> Pontos de atenção
                        </div>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {analise.pontos_atencao.map((x, k) => (
                            <li key={k} className="text-2xs text-warn">
                              {x}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {analise.referencias.length ? (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <Link2 size={11} className="text-text-dim" />
                        {analise.referencias.map((x, k) => (
                          <span
                            key={k}
                            className="text-[9px] rounded px-1.5 py-0.5 bg-bg text-text-dim border border-border/60"
                          >
                            {x}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : cl.id ? (
                  <button
                    type="button"
                    onClick={() => void analisar(cl.id!)}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded border border-accent/50 px-2.5 py-1 text-2xs text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Sparkles size={12} />
                    )}
                    {loading ? 'Analisando…' : 'Analisar com IA'}
                  </button>
                ) : null}

                {cl.doc_id ? (
                  <button
                    type="button"
                    onClick={() => onAbrirFonte(cl.doc_id ?? null, cl.pagina ?? null)}
                    className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
                  >
                    <FileSearch size={11} /> Ver no documento{cl.pagina ? ` (p. ${cl.pagina})` : ''}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
