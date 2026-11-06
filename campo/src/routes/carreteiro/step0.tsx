import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import { useCatalogo } from '@/core/db/daos'
import { PickerSheet } from '@/features/common/PickerSheet'
import { LabeledInput, NumericField, PickerField } from '@/features/common/fields'
import { parseNum } from '@/lib/numero'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import { cn } from '@/lib/cn'
import { formatBR, hojeLocal, ontemLocal } from '@/lib/datas'
import { ehMaquinaDeCarga } from '@/lib/frota'
import { equipesDoEncarregado, temEquipesVinculadas } from '@/lib/equipes'

/** Passo 1 — cabeçalho da ficha: dia, caminhão (frota), motorista, encarregado, equipe e km. */
export function CarreteiroStep0Route() {
  const authed = useIsAuthenticated()
  const navigate = useNavigate()
  const ficha = useCarreteiroStore((s) => s.ficha)
  const setCab = useCarreteiroStore((s) => s.setCabecalho)
  const catalogo = useCatalogo(ficha?.obraId)
  const [picker, setPicker] = useState<'veiculo' | 'encarregado' | 'equipe' | null>(null)
  const [kmIni, setKmIni] = useState(ficha?.kmInicial != null ? String(ficha.kmInicial) : '')
  const [kmFim, setKmFim] = useState(ficha?.kmFinal != null ? String(ficha.kmFinal) : '')
  const [erro, setErro] = useState<string | null>(null)

  if (!authed) return <Navigate to="/login" replace />
  if (!ficha) return <Navigate to="/carreteiro" replace />

  function continuar() {
    setErro(null)
    const a = parseNum(kmIni)
    const b = parseNum(kmFim)
    if (a != null && b != null && b < a)
      return setErro('O km final não pode ser menor que o inicial.')
    setCab({ kmInicial: a, kmFinal: b })
    navigate('/carreteiro/step1')
  }

  const veiculos = (catalogo?.veiculos ?? []).filter((v) => !ehMaquinaDeCarga(v))
  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base/95 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/carreteiro')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-on-surface">Ficha de viagens</h1>
            <p className="text-xs text-on-surface-dim">{ficha.obraCodigo} · cabeçalho</p>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-3 p-4">
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
                onClick={() => setCab({ dt: o.dt })}
                className={cn(
                  'min-h-touch rounded-lg border px-3 py-2 text-left',
                  ficha.dt === o.dt
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
          label="CAMINHÃO *"
          value={ficha.veiculoNome ?? 'Selecionar…'}
          onClick={() => setPicker('veiculo')}
          empty={!ficha.veiculoId}
          hint={veiculos.length === 0 ? 'Nenhum veículo cadastrado na frota da empresa' : undefined}
        />
        <LabeledInput
          label="Motorista"
          value={ficha.motorista ?? ''}
          onChange={(v) => setCab({ motorista: v || null })}
          placeholder="Nome do motorista"
        />
        <div className="grid grid-cols-2 gap-3">
          <PickerField
            label="ENCARREGADO"
            value={ficha.encarregadoNome ?? '—'}
            onClick={() => setPicker('encarregado')}
          />
          <PickerField
            label="EQUIPE"
            value={ficha.equipeNome ?? '—'}
            onClick={() => setPicker('equipe')}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumericField label="Km inicial" value={kmIni} onChange={setKmIni} />
          <NumericField label="Km final" value={kmFim} onChange={setKmFim} />
        </div>
        {erro && <p className="text-sm text-bad">{erro}</p>}
      </div>

      <div className="sticky bottom-0 border-t border-border bg-bg-base/95 p-4 backdrop-blur pl-safe pr-safe pb-safe-plus-4">
        <Button
          variant="primary"
          size="lg"
          disabled={!ficha.veiculoId}
          onClick={continuar}
          className="w-full"
        >
          Continuar para as viagens
        </Button>
      </div>

      {picker === 'veiculo' && (
        <PickerSheet
          open
          title="Caminhão"
          items={veiculos}
          label={(v) => `${v.prefixo}${v.placa ? ` · ${v.placa}` : ''}`}
          sublabel={(v) =>
            [
              v.modelo,
              v.proprietario === 'terceiro' ? 'terceiro' : 'frota própria',
              v.capacidade_m3 ? `${v.capacidade_m3} m³` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          }
          onPick={(v) => {
            setCab({
              veiculoId: v.id,
              veiculoNome: `${v.prefixo}${v.placa ? ` · ${v.placa}` : ''}`,
            })
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          searchHint="Buscar prefixo ou placa"
          emptyMessage="Nenhum veículo na frota (Gerencial › Frota no sistema web)."
        />
      )}
      {picker === 'encarregado' && (
        <PickerSheet
          open
          title="Encarregado"
          items={[
            { id: '', nome: '— sem encarregado —', apelido: null },
            ...(catalogo?.encarregados ?? []),
          ]}
          label={(e) => (e.apelido ? `${e.nome} (${e.apelido})` : e.nome)}
          onPick={(e) => {
            const id = e.id || null
            const todas = catalogo?.equipes ?? []
            const lista = equipesDoEncarregado(todas, id)
            const unica = temEquipesVinculadas(todas, id) && lista.length === 1 ? lista[0]! : null
            const manter = lista.some((q) => q.id === ficha.equipeId)
            setCab({
              encarregadoId: id,
              encarregadoNome: id ? e.nome : null,
              ...(unica
                ? { equipeId: unica.id, equipeNome: unica.nome }
                : manter
                  ? {}
                  : { equipeId: null, equipeNome: null }),
            })
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
        />
      )}
      {picker === 'equipe' && (
        <PickerSheet
          open
          title="Equipe"
          items={[
            { id: '', nome: '— sem equipe —' },
            ...equipesDoEncarregado(catalogo?.equipes ?? [], ficha.encarregadoId),
          ]}
          label={(e) => e.nome}
          onPick={(e) => {
            setCab({ equipeId: e.id || null, equipeNome: e.id ? e.nome : null })
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
        />
      )}
    </main>
  )
}
