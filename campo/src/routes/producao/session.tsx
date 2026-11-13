import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Plus, X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import { PickerSheet } from '@/features/common/PickerSheet'
import { servicosPorModo, useCatalogo } from '@/core/db/daos'
import { refreshAllCatalogs } from '@/core/sync/catalogSync'
import { SeloEnvio } from '@/features/common/SyncStatusIndicator'
import { useProducaoStore, type ApontamentoDraft } from '@/features/producao/producaoStore'
import { ServicoFormSheet } from '@/features/producao/ServicoFormSheet'
import { excluirApontamento, saveProducaoSession } from '@/features/producao/producaoRepo'
import type { ServicoDto } from '@/types/dtos'
import { formatBR, formatNumero } from '@/lib/datas'
import { contar } from '@/lib/texto'
import type { ContextoFoto } from '@/routes/fotos/capture'

/**
 * Sessão de produção: os lançamentos do dia (um por serviço).
 *
 * - "Adicionar serviço" → serviços da obra lançados por quantidade (os de viagens ficam no módulo Viagens)
 * - Cada lançamento abre o `ServicoFormSheet` (guiado pela parametrização do serviço)
 * - "Finalizar sessão" grava na fila e tenta enviar na hora
 */
export function ProducaoSessionRoute() {
  const authed = useIsAuthenticated()
  const navigate = useNavigate()

  const store = useProducaoStore()
  const catalogo = useCatalogo(store.obraId)
  const servicos = servicosPorModo(catalogo, 'quantidade')
  const locais = catalogo?.locais ?? []

  const [showServicoPicker, setShowServicoPicker] = useState(false)
  const [editingServico, setEditingServico] = useState<ServicoDto | null>(null)
  const [editingDraft, setEditingDraft] = useState<ApontamentoDraft | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)

  if (!authed) return <Navigate to="/login" replace />
  // Se o usuário entrou direto em /producao/session sem store, manda pra LISTA
  // (que é o ponto canônico). De lá ele pode criar nova OU continuar uma existente.
  if (store.obraId == null) return <Navigate to="/producao" replace />

  async function handleFinalize() {
    setFinalizing(true)
    setFinalizeError(null)
    try {
      await saveProducaoSession(store)
      store.reset()
      // Volta pra lista; o usuário vê a sessão dele já listada (sincronizada ou pendente).
      navigate('/producao', { replace: true })
    } catch (e) {
      setFinalizeError(
        e instanceof Error ? e.message : 'Não foi possível gravar a sessão. Tente de novo.',
      )
    } finally {
      setFinalizing(false)
    }
  }

  const totalServicos = servicos?.length ?? 0

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      {/* Top bar — Voltar vai pra LISTA, não pro Setup. Setup é só pra criar nova. */}
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
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-on-surface">Sessão de produção</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {[store.obraCodigo, store.encarregadoNome, store.equipeNome, formatBR(store.dt)]
                .filter(Boolean)
                .join(' · ')}{' '}
              · {contar(store.itens.length, 'lançamento', 'lançamentos')}
            </p>
          </div>
        </div>
      </header>

      {/* Lista de itens (ou estado vazio) */}
      <div className="flex-1 overflow-y-auto">
        {store.itens.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="text-center">
              <p className="font-medium text-on-surface">Nenhum serviço lançado ainda</p>
              <p className="mt-2 text-sm text-on-surface-dim">
                Toque em "Adicionar serviço" para começar.
              </p>
            </div>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl space-y-3 p-4">
            {store.itens.map((item) => (
              <li key={item.id}>
                <ApontamentoCard
                  item={item}
                  onClick={() => {
                    setEditingServico(item.servico)
                    setEditingDraft(item)
                  }}
                  onFoto={() =>
                    navigate('/fotos/capture', {
                      state: {
                        foto: {
                          producaoId: item.id,
                          servicoId: item.servico.id,
                          servicoNome: item.servico.descricao,
                          encarregadoId: store.encarregadoId,
                          encarregadoNome: store.encarregadoNome,
                          equipeId: store.equipeId,
                          equipeNome: store.equipeNome,
                        } satisfies ContextoFoto,
                      },
                    })
                  }
                  onDelete={() => {
                    if (!window.confirm(`Excluir o lançamento de ${item.servico.descricao}?`))
                      return
                    store.removeItem(item.id)
                    // já gravado (sessão reaberta): sai da fila ou vira exclusão no servidor
                    void excluirApontamento(item.id)
                  }}
                />
              </li>
            ))}
            {/* Espaço pro FAB não tampar o último card */}
            <li className="h-24" />
          </ul>
        )}
      </div>

      {/* FAB */}
      <button
        type="button"
        onClick={() => setShowServicoPicker(true)}
        className={
          store.itens.length > 0
            ? 'fixed bottom-28 right-4 z-20 inline-flex min-h-[48px] items-center gap-2 rounded-md bg-accent px-5 font-semibold text-accent-fg shadow-flutuante hover:bg-accent-dark active:bg-accent-dark'
            : 'fixed bottom-6 right-4 z-20 inline-flex min-h-[48px] items-center gap-2 rounded-md bg-accent px-5 font-semibold text-accent-fg shadow-flutuante hover:bg-accent-dark active:bg-accent-dark'
        }
      >
        <Plus className="h-5 w-5" />
        Adicionar serviço
      </button>

      {/* Bottom action */}
      {store.itens.length > 0 && (
        <div className="sticky bottom-0 space-y-2 border-t border-border bg-bg-base px-safe-4 pb-safe-plus-4 pt-4">
          {finalizeError && (
            <p role="alert" className="text-center text-sm text-bad">
              {finalizeError}
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            disabled={finalizing}
            onClick={handleFinalize}
            className="w-full"
          >
            {finalizing ? 'Salvando…' : `Finalizar sessão (${store.itens.length})`}
          </Button>
        </div>
      )}

      {showServicoPicker && (
        <PickerSheet
          open
          title="Selecionar serviço"
          items={servicos ?? []}
          label={(s) => `${s.codigo} ${s.descricao}`}
          sublabel={(s) =>
            [
              s.unidade ?? '—',
              s.controla_material ? `material: ${s.material?.nome ?? '?'}` : null,
              s.exige_local ? 'local obrigatório' : null,
            ]
              .filter(Boolean)
              .join(' · ')
          }
          onPick={(s) => {
            setShowServicoPicker(false)
            setEditingServico(s)
            setEditingDraft(null)
          }}
          onDismiss={() => setShowServicoPicker(false)}
          searchHint="Buscar serviço"
          emptyMessage={
            totalServicos === 0
              ? `Nenhum serviço lançado por quantidade na obra ${store.obraCodigo}.`
              : 'Nenhum serviço encontrado'
          }
          emptyAction={
            totalServicos === 0
              ? { label: 'Sincronizar agora', onClick: () => void refreshAllCatalogs() }
              : undefined
          }
        />
      )}

      {editingServico && (
        <ServicoFormSheet
          servico={editingServico}
          locais={locais}
          initial={editingDraft}
          onSave={(draft) => {
            store.addOrUpdateItem({ ...draft, syncStatus: undefined, failureReason: null })
            setEditingServico(null)
            setEditingDraft(null)
          }}
          onDismiss={() => {
            setEditingServico(null)
            setEditingDraft(null)
          }}
        />
      )}
    </main>
  )
}

// ----------------------------------------------------------------------------
//  Card de lançamento
// ----------------------------------------------------------------------------

function ApontamentoCard({
  item,
  onClick,
  onFoto,
  onDelete,
}: {
  item: ApontamentoDraft
  onClick: () => void
  onFoto: () => void
  onDelete: () => void
}) {
  const tags = [
    item.servico.controla_material && item.materialQtd != null
      ? `${formatNumero(item.materialQtd)} ${item.servico.material?.unidade ?? ''} ${item.servico.material?.nome ?? ''}`.trim()
      : null,
    item.localNome,
    item.estacaInicial && item.estacaFinal ? `${item.estacaInicial} – ${item.estacaFinal}` : null,
  ].filter((x): x is string => x != null)

  return (
    <div className="card-surface flex items-stretch overflow-hidden">
      <button type="button" onClick={onClick} className="min-w-0 flex-1 p-4 text-left">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate font-medium text-on-surface">
            {item.servico.descricao}
          </p>
          <Situacao item={item} />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          {item.qtd != null && (
            <span className="text-lg font-semibold text-accent tabular">
              {formatNumero(item.qtd)} {item.servico.unidade ?? ''}
            </span>
          )}
          {tags.length > 0 && (
            <span className="text-xs text-on-surface-dim">{tags.join('  ·  ')}</span>
          )}
        </div>
        {item.syncStatus === 'REJEITADA' && item.failureReason ? (
          <p className="mt-2 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">
            Motivo: {item.failureReason}
            <span className="block">Toque para corrigir.</span>
          </p>
        ) : null}
      </button>
      <button
        type="button"
        onClick={onFoto}
        className="flex w-12 flex-shrink-0 items-center justify-center border-l border-border text-accent transition-colors hover:bg-accent/10"
        aria-label="Foto deste lançamento"
      >
        <Camera className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex w-12 flex-shrink-0 items-center justify-center border-l border-border text-bad transition-colors hover:bg-bad/10"
        aria-label="Excluir lançamento"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

function Situacao({ item }: { item: ApontamentoDraft }) {
  return item.syncStatus ? <SeloEnvio status={item.syncStatus} /> : null
}
