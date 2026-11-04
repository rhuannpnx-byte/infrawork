import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import { PickerSheet } from '@/features/common/PickerSheet'
import { servicosPorModo, useCatalogo } from '@/core/db/daos'
import { refreshAllCatalogs } from '@/core/sync/catalogSync'
import { cn } from '@/lib/cn'
import { useProducaoStore, type ApontamentoDraft } from '@/features/producao/producaoStore'
import { ServicoFormSheet } from '@/features/producao/ServicoFormSheet'
import { excluirApontamento, saveProducaoSession } from '@/features/producao/producaoRepo'
import type { ServicoDto } from '@/types/dtos'
import { formatBR, formatNumero } from '@/lib/datas'

/**
 * Sessão de produção: os apontamentos do dia (um por serviço).
 *
 * - "Adicionar serviço" → serviços da obra lançados por quantidade (os de viagens ficam no módulo Viagens)
 * - Cada apontamento abre o `ServicoFormSheet` (guiado pela parametrização do serviço)
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
      setFinalizeError(e instanceof Error ? e.message : 'Erro ao finalizar')
    } finally {
      setFinalizing(false)
    }
  }

  const totalServicos = servicos?.length ?? 0

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      {/* Top bar — Voltar vai pra LISTA, não pro Setup. Setup é só pra criar nova. */}
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
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-on-surface">Sessão de produção</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {[store.obraCodigo, store.encarregadoNome, store.equipeNome, formatBR(store.dt)]
                .filter(Boolean)
                .join(' · ')}{' '}
              · {store.itens.length} apontamento(s)
            </p>
          </div>
        </div>
      </header>

      {/* Lista de itens (ou estado vazio) */}
      <div className="flex-1 overflow-y-auto">
        {store.itens.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="text-center">
              <p className="font-medium text-on-surface">Nenhum serviço apontado ainda</p>
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
                  onDelete={() => {
                    if (!window.confirm(`Excluir o apontamento de ${item.servico.descricao}?`))
                      return
                    store.removeItem(item.id)
                    // já gravado (sessão reaberta): sai da fila ou vira exclusão no servidor
                    void excluirApontamento(item.id)
                  }}
                />
              </li>
            ))}
            {/* Espaço pro FAB não tampar o último card */}
            <li className="h-20" />
          </ul>
        )}
      </div>

      {/* FAB */}
      <button
        type="button"
        onClick={() => setShowServicoPicker(true)}
        className={cn(
          'fixed bottom-24 right-4 z-20 sm:right-1/2 sm:w-full sm:max-w-md sm:translate-x-1/2 sm:pr-4',
          'flex justify-end',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full bg-accent text-bg-base',
            'px-5 py-3 font-semibold shadow-lg',
            'transition-opacity hover:opacity-90 active:opacity-80',
          )}
        >
          <Plus className="h-5 w-5" />
          Adicionar serviço
        </span>
      </button>

      {/* Bottom action */}
      {store.itens.length > 0 && (
        <div className="sticky bottom-0 space-y-2 border-t border-border bg-bg-base/95 p-4 backdrop-blur pl-safe pr-safe pb-safe-plus-4">
          {finalizeError && <p className="text-center text-sm text-bad">{finalizeError}</p>}
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
            store.addOrUpdateItem(draft)
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
//  Card de apontamento
// ----------------------------------------------------------------------------

function ApontamentoCard({
  item,
  onClick,
  onDelete,
}: {
  item: ApontamentoDraft
  onClick: () => void
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
        <p className="truncate font-medium text-on-surface">{item.servico.descricao}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          {item.qtd != null && (
            <span className="text-lg font-bold text-accent">
              {formatNumero(item.qtd)} {item.servico.unidade ?? ''}
            </span>
          )}
          {tags.length > 0 && (
            <span className="text-xs text-on-surface-dim">{tags.join('  ·  ')}</span>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center px-3 text-bad transition-colors hover:bg-bad/10"
        aria-label="Excluir"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}
