import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Plus, X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import { useCatalogo } from '@/core/db/daos'
import type { ViagemLocal } from '@/core/db/entities'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import { ViagemFormSheet } from '@/features/carreteiro/ViagemFormSheet'
import { totalDasViagens } from '@/features/carreteiro/totalViagens'
import { formatBR, formatNumero } from '@/lib/datas'
import { contar } from '@/lib/texto'
import { uuidv7 } from '@/lib/uuidv7'

/**
 * Passo 2 — as viagens da ficha. "Nova viagem" repete serviço, origem e destino da anterior (o padrão do dia);
 * "Repetir" duplica uma viagem inteira (mesma carga, outra hora).
 */
export function CarreteiroStep1Route() {
  const authed = useIsAuthenticated()
  const navigate = useNavigate()
  const ficha = useCarreteiroStore((s) => s.ficha)
  const salvarViagem = useCarreteiroStore((s) => s.salvarViagem)
  const removerViagem = useCarreteiroStore((s) => s.removerViagem)
  const catalogo = useCatalogo(ficha?.obraId)
  const [editando, setEditando] = useState<{ v: ViagemLocal; nova: boolean } | null>(null)

  if (!authed) return <Navigate to="/login" replace />
  if (!ficha) return <Navigate to="/carreteiro" replace />

  const veiculo = catalogo?.veiculos.find((v) => v.id === ficha.veiculoId)
  const capacidade = veiculo?.capacidade_m3 ?? null

  function novaViagem() {
    const ult = ficha!.viagens[ficha!.viagens.length - 1]
    const padrao = catalogo?.servicos.find((s) => s.modo_lancamento === 'viagens')
    setEditando({
      nova: true,
      v: {
        id: uuidv7(),
        servicoId: ult?.servicoId ?? padrao?.id ?? '',
        servicoNome: ult?.servicoNome ?? padrao?.descricao ?? '',
        unidade: ult?.unidade ?? padrao?.unidade ?? null,
        origemId: ult?.origemId ?? null,
        origemNome: ult?.origemNome ?? null,
        destinoId: ult?.destinoId ?? null,
        destinoNome: ult?.destinoNome ?? null,
        horaCarga: null,
        horaDescarga: null,
        quantidade: ult?.quantidade ?? 0,
        materialQtd: null,
        dmtKm: null,
        nfTicket: null,
        estacaCarga: ult?.estacaCarga ?? null,
        estacaCargaM: ult?.estacaCargaM ?? null,
        estacaDescarga: ult?.estacaDescarga ?? null,
        estacaDescargaM: ult?.estacaDescargaM ?? null,
        obs: null,
        carregadorId: ult?.carregadorId ?? null,
        carregadorNome: ult?.carregadorNome ?? null,
      },
    })
  }

  const total = totalDasViagens(ficha.viagens)

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/carreteiro/step0')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-on-surface">Viagens</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {[formatBR(ficha.dt), ficha.veiculoNome, ficha.motorista].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {ficha.viagens.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <p className="font-medium text-on-surface">Nenhuma viagem ainda</p>
              <p className="mt-2 text-sm text-on-surface-dim">
                Toque em "Nova viagem" a cada carga entregue.
              </p>
            </div>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl space-y-2 p-4">
            {ficha.viagens.map((v, i) => (
              <li key={v.id} className="card-surface flex items-stretch overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEditando({ v, nova: false })}
                  className="min-w-0 flex-1 p-3 text-left"
                >
                  <p className="tabular text-xs text-on-surface-dim">
                    #{i + 1}
                    {v.horaCarga ? ` · ${v.horaCarga}` : ''}
                    {v.horaDescarga ? ` → ${v.horaDescarga}` : ''}
                  </p>
                  <p className="font-medium text-on-surface">{v.servicoNome}</p>
                  <p className="text-xs text-on-surface-dim">
                    {(v.origemNome ?? '—') +
                      (v.estacaCarga ? ` (${v.estacaCarga})` : '') +
                      ' → ' +
                      (v.destinoNome ?? '—') +
                      (v.estacaDescarga ? ` (${v.estacaDescarga})` : '') +
                      (v.estaca && v.estacaCarga === undefined ? ` · est. ${v.estaca}` : '')}
                  </p>
                  <p className="tabular mt-0.5 font-semibold text-accent">
                    {formatNumero(v.quantidade, 2)} {v.unidade ?? ''}
                    <span className="text-xs font-normal text-on-surface-dim">
                      {v.dmtKm != null
                        ? ` · DMT ${formatNumero(v.dmtKm, 2)} km${v.dmtManual ? ' (ajustada)' : ''}`
                        : ''}
                    </span>
                  </p>
                </button>
                <button
                  type="button"
                  aria-label="Repetir viagem"
                  title="Repetir viagem"
                  onClick={() =>
                    salvarViagem({
                      ...v,
                      id: uuidv7(),
                      horaCarga: null,
                      horaDescarga: null,
                      nfTicket: null,
                    })
                  }
                  className="flex w-12 flex-shrink-0 items-center justify-center border-l border-border text-on-surface-dim hover:text-accent"
                >
                  <Copy className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Excluir viagem"
                  onClick={() =>
                    window.confirm(`Excluir a viagem #${i + 1}?`) && removerViagem(v.id)
                  }
                  className="flex w-12 flex-shrink-0 items-center justify-center border-l border-border text-bad hover:bg-bad/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </li>
            ))}
            <li className="h-24" />
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={novaViagem}
        className="fixed bottom-28 right-4 z-20 inline-flex min-h-[48px] items-center gap-2 rounded-md bg-accent px-5 font-semibold text-accent-fg shadow-flutuante hover:bg-accent-dark active:bg-accent-dark"
      >
        <Plus className="h-5 w-5" />
        Nova viagem
      </button>

      <div className="sticky bottom-0 border-t border-border bg-bg-base pt-4 pb-safe-plus-4 px-safe-4">
        <Button
          variant="primary"
          size="lg"
          disabled={ficha.viagens.length === 0}
          title={ficha.viagens.length === 0 ? 'Adicione ao menos uma viagem' : undefined}
          onClick={() => navigate('/carreteiro/step2')}
          className="w-full"
        >
          Revisar ({contar(ficha.viagens.length, 'viagem', 'viagens')}
          {total ? ` · ${total}` : ''})
        </Button>
      </div>

      {editando && catalogo && (
        <ViagemFormSheet
          catalogo={catalogo}
          inicial={editando.v}
          nova={editando.nova}
          capacidade={capacidade}
          onSave={(v) => {
            salvarViagem(v)
            setEditando(null)
          }}
          onDismiss={() => setEditando(null)}
        />
      )}
    </main>
  )
}
