import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useSession, useIsAuthenticated } from '@/core/auth/SessionStore'
import { PickerSheet } from '@/features/common/PickerSheet'
import { useCatalogo, useObra, useSessoesDaObra } from '@/core/db/daos'
import { cn } from '@/lib/cn'
import { formatBR, hojeLocal, ontemLocal } from '@/lib/datas'
import { useProducaoStore } from '@/features/producao/producaoStore'
import { loadSessionItensAsDrafts } from '@/features/producao/producaoRepo'

/**
 * Nova sessão de produção: a obra (escolhida no Home), o dia (hoje ou ontem), o encarregado e a equipe.
 * Encarregado e equipe valem para todos os apontamentos da sessão.
 */
export function ProducaoSetupRoute() {
  const authed = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()
  const store = useProducaoStore()
  const obra = useObra(session?.obraAtualId)
  const catalogo = useCatalogo(store.obraId)
  const sessoes = useSessoesDaObra(store.obraId)

  useEffect(() => {
    if (obra && store.obraId !== obra.id) store.setObra(obra.id, obra.codigo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obra?.id])

  const [picker, setPicker] = useState<'encarregado' | 'equipe' | null>(null)
  const [abrindo, setAbrindo] = useState(false)

  if (!authed) return <Navigate to="/login" replace />
  if (!session?.obraAtualId) return <Navigate to="/" replace />

  const encarregados = catalogo?.encarregados ?? []
  const equipes = catalogo?.equipes ?? []
  const existente =
    store.obraId != null
      ? (sessoes ?? []).find(
          (s) =>
            s.dt === store.dt &&
            (s.encarregadoId ?? null) === store.encarregadoId &&
            (s.equipeId ?? null) === store.equipeId,
        )
      : undefined

  async function abrirExistente() {
    if (!existente) return
    setAbrindo(true)
    try {
      store.setItens(
        await loadSessionItensAsDrafts({
          obraId: existente.obraId,
          dt: existente.dt,
          encarregadoId: existente.encarregadoId,
          equipeId: existente.equipeId,
        }),
      )
      navigate('/producao/session')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Falha ao carregar a sessão')
    } finally {
      setAbrindo(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base/95 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/producao')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold text-on-surface">Nova sessão de produção</h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-3 p-4">
        <InfoRow label="OBRA" value={obra ? `${obra.codigo} — ${obra.nome}` : '—'} />
        <div className="card-surface-variant px-4 py-3">
          <p className="text-xs font-medium uppercase text-on-surface-dim">DATA</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              { dt: hojeLocal(), r: 'Hoje' },
              { dt: ontemLocal(), r: 'Ontem' },
            ].map((o) => (
              <button
                key={o.dt}
                type="button"
                onClick={() => store.setDt(o.dt)}
                className={cn(
                  'min-h-touch rounded-lg border px-3 py-2 text-left',
                  store.dt === o.dt
                    ? 'border-accent bg-accent/10 text-on-surface'
                    : 'border-border text-on-surface-dim',
                )}
              >
                <span className="block text-sm font-medium">{o.r}</span>
                <span className="block text-xs">{formatBR(o.dt)}</span>
              </button>
            ))}
          </div>
        </div>
        <PickerField
          label="ENCARREGADO"
          value={store.encarregadoNome ?? 'Selecionar…'}
          onClick={() => setPicker('encarregado')}
          hint={encarregados.length === 0 ? 'Sem encarregados cadastrados na obra' : undefined}
        />
        <PickerField
          label="EQUIPE"
          value={store.equipeNome ?? 'Selecionar…'}
          onClick={() => setPicker('equipe')}
          hint={equipes.length === 0 ? 'Sem equipes cadastradas na obra' : undefined}
        />
        {catalogo === null && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-on-surface">
            O catálogo desta obra ainda não foi baixado. Conecte-se à internet uma vez para
            trabalhar sem sinal.
          </div>
        )}
        {existente && (
          <div className="flex gap-3 rounded-xl border border-warn/40 bg-warn/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warn" />
            <div className="flex-1">
              <p className="text-sm text-on-surface">
                Já existe sessão deste dia com este encarregado e equipe (
                <strong>{existente.total} apontamento(s)</strong>). Continuar abaixo cria uma sessão
                separada.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void abrirExistente()}
                disabled={abrindo}
                className="mt-2"
              >
                {abrindo ? 'Abrindo…' : 'Adicionar à sessão existente'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-border bg-bg-base/95 p-4 backdrop-blur pl-safe pr-safe pb-safe-plus-4">
        <Button
          variant="primary"
          size="lg"
          disabled={store.obraId == null || !catalogo}
          onClick={() => navigate('/producao/session')}
          className="w-full"
        >
          Continuar
        </Button>
      </div>

      {picker === 'encarregado' && (
        <PickerSheet
          open
          title="Encarregado"
          items={[{ id: '', nome: '— sem encarregado —', apelido: null }, ...encarregados]}
          label={(e) => (e.apelido ? `${e.nome} (${e.apelido})` : e.nome)}
          onPick={(e) => {
            store.setEncarregado(e.id || null, e.id ? e.nome : null)
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          searchHint="Buscar encarregado"
          emptyMessage="Sem encarregados na obra"
        />
      )}
      {picker === 'equipe' && (
        <PickerSheet
          open
          title="Equipe"
          items={[{ id: '', nome: '— sem equipe —' }, ...equipes]}
          label={(e) => e.nome}
          onPick={(e) => {
            store.setEquipe(e.id || null, e.id ? e.nome : null)
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          searchHint="Buscar equipe"
          emptyMessage="Sem equipes na obra"
        />
      )}
    </main>
  )
}

function PickerField({
  label,
  value,
  onClick,
  disabled,
  hint,
}: {
  label: string
  value: string
  onClick: () => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        'card-surface-variant w-full px-4 py-3 text-left',
        'flex min-h-touch items-center gap-3',
        disabled ? 'cursor-not-allowed opacity-50' : 'transition-colors hover:bg-surface-2/80',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase text-on-surface-dim">{label}</p>
        <p className="mt-0.5 truncate text-on-surface">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-on-surface-dim">{hint}</p>}
      </div>
      {!disabled && <ChevronRight className="h-5 w-5 flex-shrink-0 text-on-surface-dim" />}
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface-variant px-4 py-3">
      <p className="text-xs font-medium uppercase text-on-surface-dim">{label}</p>
      <p className="mt-0.5 text-on-surface">{value}</p>
    </div>
  )
}
