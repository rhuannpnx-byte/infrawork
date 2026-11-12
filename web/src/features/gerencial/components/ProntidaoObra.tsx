import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot
} from 'lucide-react'
import { getModuleByRoute } from '@/config/modules'
import { formatNumber } from '@/lib/format'
import { useTabsStore } from '@/stores/tabs-store'
import { cn } from '@/lib/utils'
import {
  useProntidaoObra,
  type EtapaProntidao,
  type SituacaoEtapa
} from '@/features/gerencial/hooks/prontidao'

const ICONE: Record<SituacaoEtapa, ReactNode> = {
  ok: <CircleCheck size={14} className="text-success" />,
  pendente: <CircleDot size={14} className="text-danger" />,
  aviso: <AlertTriangle size={14} className="text-warn" />,
  opcional: <CircleDashed size={14} className="text-text-dim" />
}

/** Etapas da obra até ter previsto e realizado, com o que falta em cada uma e o atalho para resolver. */
export function ProntidaoObra({
  obraId,
  titulo = 'O que falta nesta obra'
}: {
  obraId: string
  titulo?: string
}): ReactNode {
  const { data, isLoading, error } = useProntidaoObra(obraId)
  if (error) return null
  const pendentes = data?.pendentes ?? 0
  const avisos = data?.avisos ?? 0
  return (
    <section className="rounded border border-border bg-bg-panel">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold text-text">{titulo}</h3>
        {data ? (
          <span
            className={cn(
              'ml-auto text-2xs font-mono',
              pendentes ? 'text-danger' : avisos ? 'text-warn' : 'text-success'
            )}
          >
            {pendentes
              ? `${pendentes} pendência(s)${avisos ? ` · ${avisos} aviso(s)` : ''}`
              : avisos
                ? `${avisos} aviso(s)`
                : 'Obra pronta'}
          </span>
        ) : null}
      </header>
      {isLoading ? (
        <div className="px-4 py-3 text-2xs text-text-dim">Conferindo a obra…</div>
      ) : (
        <ol className="divide-y divide-border">
          {(data?.etapas ?? []).map((e) => (
            <Etapa key={e.chave} etapa={e} />
          ))}
        </ol>
      )}
    </section>
  )
}

function Etapa({ etapa }: { etapa: EtapaProntidao }): ReactNode {
  const openModule = useTabsStore((s) => s.openModule)
  const [aberta, setAberta] = useState(false)
  const temItens = etapa.itens.length > 0 && etapa.situacao !== 'ok'
  return (
    <li className="px-4 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{ICONE[etapa.situacao]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-text">{etapa.titulo}</div>
          <div className="text-2xs text-text-muted leading-snug">{etapa.resumo}</div>
          {temItens ? (
            <button
              type="button"
              onClick={() => setAberta((a) => !a)}
              className="mt-1 inline-flex items-center gap-1 text-2xs text-accent hover:underline"
            >
              {aberta ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {aberta ? 'Ocultar' : 'Ver'}{' '}
              {etapa.itens.length === 30 ? 'os primeiros 30' : etapa.itens.length} item(ns)
            </button>
          ) : null}
          {aberta ? (
            <ul className="mt-1 space-y-0.5 text-2xs text-text-muted">
              {etapa.itens.map((i) => (
                <li key={i.id} className="flex gap-2">
                  {i.codigo ? <span className="font-mono text-text-dim">{i.codigo}</span> : null}
                  <span className="truncate">{i.descricao}</span>
                  {i.orcado !== undefined ? (
                    <span className="ml-auto shrink-0 font-mono tabular-nums">
                      {formatNumber(i.planejado ?? 0, 2)} de {formatNumber(i.orcado, 2)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {etapa.situacao !== 'ok' ? (
          <button
            type="button"
            onClick={() => {
              const m = getModuleByRoute(etapa.rota)
              if (m) openModule(m.key, etapa.rota)
            }}
            className="shrink-0 inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-2xs text-text-muted hover:border-border-accent hover:text-accent"
          >
            Resolver <ArrowRight size={11} />
          </button>
        ) : null}
      </div>
    </li>
  )
}
