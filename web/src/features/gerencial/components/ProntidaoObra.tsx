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
import { contar } from '@/lib/rotulos'
import { Button } from '@/components/ui/button'
import {
  useProntidaoObra,
  type EtapaProntidao,
  type SituacaoEtapa
} from '@/features/gerencial/hooks/prontidao'

const ICONE: Record<SituacaoEtapa, ReactNode> = {
  ok: <CircleCheck size={16} className="text-success" />,
  pendente: <CircleDot size={16} className="text-danger" />,
  aviso: <AlertTriangle size={16} className="text-warn" />,
  opcional: <CircleDashed size={16} className="text-text-dim" />
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
      <header className="flex items-baseline gap-3 border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold text-text">{titulo}</h2>
        {data ? (
          <span
            className={cn(
              'ml-auto text-sm font-semibold',
              pendentes ? 'text-danger' : avisos ? 'text-warn' : 'text-success'
            )}
          >
            {pendentes
              ? `${contar(pendentes, 'pendência', 'pendências')}${avisos ? ` e ${contar(avisos, 'aviso', 'avisos')}` : ''}`
              : avisos
                ? contar(avisos, 'aviso', 'avisos')
                : 'Obra pronta'}
          </span>
        ) : null}
      </header>
      {isLoading ? (
        <div className="px-4 py-3 text-sm text-text-muted">Conferindo a obra…</div>
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
    <li className="px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{ICONE[etapa.situacao]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text">{etapa.titulo}</div>
          <div className="text-sm text-text-muted">{etapa.resumo}</div>
          {temItens ? (
            <button
              type="button"
              onClick={() => setAberta((a) => !a)}
              aria-expanded={aberta}
              className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
            >
              {aberta ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {aberta ? 'Ocultar' : 'Ver'}{' '}
              {etapa.itens.length === 30
                ? 'os primeiros 30 itens'
                : contar(etapa.itens.length, 'item', 'itens')}
            </button>
          ) : null}
          {aberta ? (
            <ul className="mt-1.5 space-y-1 text-sm text-text-muted">
              {etapa.itens.map((i) => (
                <li key={i.id} className="flex gap-2">
                  {i.codigo ? (
                    <span className="tabular text-text-dim shrink-0">{i.codigo}</span>
                  ) : null}
                  <span className="truncate">{i.descricao}</span>
                  {i.orcado !== undefined ? (
                    <span className="ml-auto shrink-0 tabular">
                      {formatNumber(i.planejado ?? 0, 2)} de {formatNumber(i.orcado, 2)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {etapa.situacao !== 'ok' ? (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => {
              const m = getModuleByRoute(etapa.rota)
              if (m) openModule(m.key, etapa.rota)
            }}
          >
            Resolver <ArrowRight size={12} />
          </Button>
        ) : null}
      </div>
    </li>
  )
}
