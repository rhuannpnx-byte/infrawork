import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import { useCatalogo } from '@/core/db/daos'
import { PickerSheet } from '@/features/common/PickerSheet'
import { LabeledInput, PickerField } from '@/features/common/fields'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import {
  lembrarCabecalho,
  motoristaDoVeiculo,
  ultimoCabecalho,
} from '@/features/carreteiro/ultimoCabecalho'
import { cn } from '@/lib/cn'
import { formatBR, hojeLocal, ontemLocal } from '@/lib/datas'
import { ehMaquinaDeCarga, rotuloVeiculo } from '@/lib/frota'
import { equipesDoEncarregado, temEquipesVinculadas } from '@/lib/equipes'

/** Passo 1 — cabeçalho da ficha: dia, caminhão (frota), motorista, encarregado e equipe. */
export function CarreteiroStep0Route() {
  const authed = useIsAuthenticated()
  const navigate = useNavigate()
  const ficha = useCarreteiroStore((s) => s.ficha)
  const setCab = useCarreteiroStore((s) => s.setCabecalho)
  const catalogo = useCatalogo(ficha?.obraId)
  const [picker, setPicker] = useState<'veiculo' | 'encarregado' | 'equipe' | null>(null)
  // Ficha nova: sugere o caminhão e o motorista da última ficha. A sugestão só entra na ficha quando o operador
  // continua ou mexe num dos dois campos (abrir e voltar não deixa rascunho para trás).
  const [lembrado] = useState(() =>
    ficha && !ficha.veiculoId && !ficha.motorista && ficha.viagens.length === 0
      ? ultimoCabecalho(ficha.obraId)
      : null,
  )
  const [tocou, setTocou] = useState(false)

  if (!authed) return <Navigate to="/login" replace />
  if (!ficha) return <Navigate to="/carreteiro" replace />

  const veiculos = (catalogo?.veiculos ?? []).filter((v) => !ehMaquinaDeCarga(v))
  const sugerindo = lembrado != null && !tocou && !ficha.veiculoId && !ficha.motorista
  const veiculoSugerido = sugerindo ? (veiculos.find((v) => v.id === lembrado.veiculoId) ?? null) : null
  const sugestao = sugerindo
    ? {
        ...(veiculoSugerido
          ? { veiculoId: veiculoSugerido.id, veiculoNome: rotuloVeiculo(veiculoSugerido) }
          : {}),
        motorista: lembrado.motorista,
      }
    : {}
  const veiculoId = ficha.veiculoId ?? veiculoSugerido?.id ?? null
  const veiculoNome = ficha.veiculoNome ?? (veiculoSugerido ? rotuloVeiculo(veiculoSugerido) : null)
  const motorista = ficha.motorista ?? (sugerindo ? lembrado.motorista : null) ?? ''

  function continuar() {
    if (!veiculoId) return
    if (sugerindo) setCab(sugestao)
    lembrarCabecalho(ficha!.obraId, { veiculoId, motorista: motorista || null })
    navigate('/carreteiro/step1')
  }

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pl-safe pr-safe pt-safe">
        <div className="flex items-center gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/carreteiro')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-on-surface">Ficha de viagens</h1>
            <p className="text-xs text-on-surface-dim">{ficha.obraCodigo} · cabeçalho</p>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-3 p-4">
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
                aria-pressed={ficha.dt === o.dt}
                onClick={() => setCab({ dt: o.dt })}
                className={cn(
                  'min-h-touch rounded-md border px-3 py-2 text-left',
                  ficha.dt === o.dt
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
          label="Caminhão *"
          value={veiculoNome ?? 'Selecionar…'}
          onClick={() => setPicker('veiculo')}
          empty={!veiculoId}
          hint={
            veiculos.length === 0
              ? 'Nenhum veículo cadastrado na frota da empresa'
              : veiculoSugerido
                ? 'O mesmo caminhão da última ficha. Toque para trocar.'
                : undefined
          }
        />
        <LabeledInput
          label="Motorista"
          value={motorista}
          onChange={(v) => {
            setTocou(true)
            // mexer no motorista confirma o caminhão sugerido
            setCab({ ...sugestao, motorista: v || null })
          }}
          placeholder="Nome do motorista"
          autoComplete="off"
        />
        <div className="grid grid-cols-2 gap-3">
          <PickerField
            label="Encarregado"
            value={ficha.encarregadoNome ?? '—'}
            onClick={() => setPicker('encarregado')}
          />
          <PickerField
            label="Equipe"
            value={ficha.equipeNome ?? '—'}
            onClick={() => setPicker('equipe')}
          />
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border bg-bg-base px-safe-4 pb-safe-plus-4 pt-4">
        <Button
          variant="primary"
          size="lg"
          disabled={!veiculoId}
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
          label={rotuloVeiculo}
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
            // o motorista acompanha o caminhão enquanto for o lembrado (ou estiver vazio); digitado à mão fica
            const doAnterior = veiculoId ? motoristaDoVeiculo(ficha.obraId, veiculoId) : null
            const acompanha = !motorista || motorista === doAnterior
            setTocou(true)
            setCab({
              veiculoId: v.id,
              veiculoNome: rotuloVeiculo(v),
              motorista: acompanha
                ? motoristaDoVeiculo(ficha.obraId, v.id)
                : motorista || null,
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
            { id: '', nome: 'Sem encarregado', apelido: null },
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
            { id: '', nome: 'Sem equipe' },
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
