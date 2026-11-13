import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useSession, useIsAuthenticated } from '@/core/auth/SessionStore'
import { PickerSheet } from '@/features/common/PickerSheet'
import { useCatalogo, useObra, useSessoesDaObra } from '@/core/db/daos'
import { cn } from '@/lib/cn'
import { formatBR, hojeLocal, ontemLocal } from '@/lib/datas'
import { contar } from '@/lib/texto'
import { useProducaoStore } from '@/features/producao/producaoStore'
import { loadSessionItensAsDrafts } from '@/features/producao/producaoRepo'
import { equipesDoEncarregado, temEquipesVinculadas } from '@/lib/equipes'
import type { EncarregadoDto } from '@/types/dtos'

/**
 * Nova sessão de produção: a obra (escolhida no Home), o dia (hoje ou ontem), o encarregado e depois uma das equipes
 * dele. Encarregado e equipe valem para todos os lançamentos da sessão.
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
  const todasEquipes = catalogo?.equipes ?? []
  const exigeEncarregado = encarregados.length > 0
  const semEncarregado = exigeEncarregado && !store.encarregadoId
  const equipes = equipesDoEncarregado(todasEquipes, store.encarregadoId)

  function escolherEncarregado(e: EncarregadoDto) {
    const id = e.id || null
    store.setEncarregado(id, id ? e.nome : null)
    const lista = equipesDoEncarregado(todasEquipes, id)
    if (temEquipesVinculadas(todasEquipes, id) && lista.length === 1) {
      store.setEquipe(lista[0]!.id, lista[0]!.nome)
    } else if (store.equipeId && !lista.some((q) => q.id === store.equipeId)) {
      store.setEquipe(null, null)
    }
  }
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
      window.alert(
        e instanceof Error ? e.message : 'Não foi possível abrir a sessão. Tente de novo.',
      )
    } finally {
      setAbrindo(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pl-safe pr-safe pt-safe">
        <div className="flex items-center gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/producao')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold text-on-surface">Nova sessão de produção</h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-3 p-4">
        <InfoRow label="Obra" value={obra ? `${obra.codigo} · ${obra.nome}` : '—'} />
        <div>
          <p className="rotulo">Data</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {[
              { dt: hojeLocal(), r: 'Hoje' },
              { dt: ontemLocal(), r: 'Ontem' },
            ].map((o) => (
              <button
                key={o.dt}
                type="button"
                aria-pressed={store.dt === o.dt}
                onClick={() => store.setDt(o.dt)}
                className={cn(
                  'min-h-touch rounded-md border px-3 py-2 text-left',
                  store.dt === o.dt
                    ? 'border-accent bg-accent/10 text-on-surface'
                    : 'border-border-strong bg-bg-panel text-on-surface-dim',
                )}
              >
                <span className="block text-sm font-semibold">{o.r}</span>
                <span className="block text-xs tabular">{formatBR(o.dt)}</span>
              </button>
            ))}
          </div>
        </div>
        <PickerField
          label="Encarregado"
          value={store.encarregadoNome ?? 'Selecionar…'}
          onClick={() => setPicker('encarregado')}
          hint={encarregados.length === 0 ? 'Sem encarregados cadastrados na obra' : undefined}
        />
        <PickerField
          label="Equipe"
          value={store.equipeNome ?? 'Selecionar…'}
          onClick={() => setPicker('equipe')}
          disabled={semEncarregado}
          hint={
            semEncarregado
              ? 'Escolha o encarregado primeiro'
              : todasEquipes.length === 0
                ? 'Sem equipes cadastradas na obra'
                : store.encarregadoId && !temEquipesVinculadas(todasEquipes, store.encarregadoId)
                  ? 'Encarregado sem equipes vinculadas: a lista mostra as equipes sem encarregado'
                  : undefined
          }
        />
        {catalogo === null && (
          <div className="rounded-md border border-warn/50 bg-warn/10 p-4 text-sm text-on-surface">
            Os dados desta obra ainda não foram baixados. Conecte-se à internet uma vez para
            trabalhar sem sinal.
          </div>
        )}
        {existente && (
          <div className="flex gap-3 rounded-md border border-warn/50 bg-warn/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-warn" />
            <div className="flex-1">
              <p className="text-sm text-on-surface">
                Já existe sessão deste dia com este encarregado e equipe (
                <strong>{contar(existente.total, 'lançamento', 'lançamentos')}</strong>). Continuar
                abaixo cria uma sessão
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

      <div className="sticky bottom-0 border-t border-border bg-bg-base px-safe-4 pb-safe-plus-4 pt-4">
        <Button
          variant="primary"
          size="lg"
          disabled={store.obraId == null || !catalogo || semEncarregado}
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
          items={encarregados}
          label={(e) => (e.apelido ? `${e.nome} (${e.apelido})` : e.nome)}
          onPick={(e) => {
            escolherEncarregado(e)
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
          items={[{ id: '', nome: 'Sem equipe' }, ...equipes]}
          label={(e) => e.nome}
          onPick={(e) => {
            store.setEquipe(e.id || null, e.id ? e.nome : null)
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          searchHint="Buscar equipe"
          emptyMessage={
            store.encarregadoId ? 'Nenhuma equipe deste encarregado' : 'Sem equipes na obra'
          }
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
        'w-full rounded-md border border-border-strong bg-bg-panel px-4 py-3 text-left',
        'flex min-h-touch items-center gap-3',
        disabled ? 'cursor-not-allowed opacity-50' : 'transition-colors hover:border-accent',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="rotulo">{label}</p>
        <p className="mt-0.5 truncate text-base text-on-surface">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-on-surface-dim">{hint}</p>}
      </div>
      {!disabled && <ChevronRight className="h-5 w-5 flex-shrink-0 text-on-surface-dim" />}
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface-variant px-4 py-3">
      <p className="rotulo">{label}</p>
      <p className="mt-0.5 text-on-surface">{value}</p>
    </div>
  )
}
