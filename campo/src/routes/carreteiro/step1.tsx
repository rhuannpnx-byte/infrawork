import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Plus, X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import { useCatalogo } from '@/core/db/daos'
import type { ViagemLocal } from '@/core/db/entities'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import { ViagemFormSheet } from '@/features/carreteiro/ViagemFormSheet'
import { cn } from '@/lib/cn'
import { formatBR, formatNumero } from '@/lib/datas'
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
        quantidade: 0,
        volumeM3: ult?.volumeM3 ?? null,
        pesoT: null,
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

  const total = ficha.viagens.reduce((s, v) => s + v.quantidade, 0)

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base/95 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/carreteiro/step0')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-on-surface">Viagens</h1>
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
                  <p className="text-xs text-on-surface-dim">
                    #{i + 1}
                    {v.horaCarga ? ` · ${v.horaCarga}` : ''}
                    {v.horaDescarga ? ` → ${v.horaDescarga}` : ''}
                  </p>
                  <p className="truncate font-medium text-on-surface">{v.servicoNome}</p>
                  <p className="truncate text-xs text-on-surface-dim">
                    {(v.origemNome ?? '—') +
                      (v.estacaCarga ? ` (${v.estacaCarga})` : '') +
                      ' → ' +
                      (v.destinoNome ?? '—') +
                      (v.estacaDescarga ? ` (${v.estacaDescarga})` : '') +
                      (v.estaca && v.estacaCarga === undefined ? ` · est. ${v.estaca}` : '')}
                  </p>
                  <p className="mt-0.5 font-bold text-accent">
                    {formatNumero(v.quantidade, 2)} {v.unidade ?? ''}
                    <span className="text-xs font-normal text-on-surface-dim">
                      {v.pesoT != null
                        ? ` · ${formatNumero(v.pesoT, 2)} t`
                        : v.volumeM3 != null
                          ? ` · ${formatNumero(v.volumeM3, 2)} m³`
                          : ''}
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
                  className="flex items-center px-3 text-on-surface-dim hover:text-accent"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Excluir viagem"
                  onClick={() =>
                    window.confirm(`Excluir a viagem #${i + 1}?`) && removerViagem(v.id)
                  }
                  className="flex items-center px-3 text-bad hover:bg-bad/10"
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
        className={cn('fixed bottom-24 right-4 z-20 flex justify-end')}
      >
        <span className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 font-semibold text-bg-base shadow-lg hover:opacity-90 active:opacity-80">
          <Plus className="h-5 w-5" />
          Nova viagem
        </span>
      </button>

      <div className="sticky bottom-0 border-t border-border bg-bg-base/95 p-4 backdrop-blur pl-safe pr-safe pb-safe-plus-4">
        <Button
          variant="primary"
          size="lg"
          disabled={ficha.viagens.length === 0}
          onClick={() => navigate('/carreteiro/step2')}
          className="w-full"
        >
          Revisar ({ficha.viagens.length} viagem(ns) · {formatNumero(total, 2)})
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
