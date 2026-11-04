import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { parseQtd } from '@/features/acompanhamento/lib/parse-qtd'
import {
  TIPO_VEICULO_LABEL,
  useAplicarCapacidadeModelo,
  useExcluirVeiculo,
  useFleetObras,
  useFrota,
  useSalvarVeiculo,
  type TipoVeiculo,
  type Veiculo
} from '@/features/acompanhamento/hooks/viagens'
import { cn } from '@/lib/utils'
import { FleethubIntegracao } from '@/features/frota/FleethubIntegracao'

export function GerencialFrotaPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro']} pageTitle="Frota">
      <Inner />
    </RequireRole>
  )
}

const TIPOS = Object.keys(TIPO_VEICULO_LABEL) as TipoVeiculo[]
const txt = (v: number | null): string => (v === null ? '' : String(v).replace('.', ','))
function Inner(): ReactNode {
  const scope = useCurrentScope()
  const empresaId = scope.empresaId
  const role = useAuthStore((s) => s.profile?.role)
  const { data: frota = [], isLoading } = useFrota(empresaId)
  const { data: fleetObras = [] } = useFleetObras(empresaId)
  const salvar = useSalvarVeiculo()
  const excluir = useExcluirVeiculo()
  const aplicarModelo = useAplicarCapacidadeModelo()
  const [novo, setNovo] = useState({ prefixo: '', placa: '', tipo: 'basculante' as TipoVeiculo })
  const [filtroObra, setFiltroObra] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [semCapacidade, setSemCapacidade] = useState(false)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [busca, setBusca] = useState('')
  const erro = (e: Error): void => void toast.error(e.message)

  const nomeObra = useMemo(() => new Map(fleetObras.map((o) => [o.id, o.nome])), [fleetObras])
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return frota.filter(
      (v) =>
        (mostrarInativos || v.ativo) &&
        (!filtroObra ||
          (filtroObra === 'manual' ? v.origem === 'manual' : v.fleet_obra_id === filtroObra)) &&
        (!filtroTipo || v.tipo === filtroTipo) &&
        (!semCapacidade || (v.capacidade_m3 === null && v.capacidade_t === null)) &&
        (!t || `${v.prefixo} ${v.placa ?? ''} ${v.modelo ?? ''}`.toLowerCase().includes(t))
    )
  }, [frota, busca, filtroObra, filtroTipo, semCapacidade, mostrarInativos])
  const obrasComVeiculo = fleetObras.filter((o) => frota.some((v) => v.fleet_obra_id === o.id))

  if (!empresaId)
    return (
      <div className="p-6 text-xs text-text-muted">Selecione a empresa para cadastrar a frota.</div>
    )
  const set = (v: Veiculo, patch: Partial<Veiculo>): void =>
    salvar.mutate(
      { ...patch, id: v.id, empresa_id: v.empresa_id, prefixo: patch.prefixo ?? v.prefixo },
      { onError: erro }
    )
  const copiarParaModelo = (v: Veiculo): void => {
    if (!v.modelo) return
    aplicarModelo.mutate(
      {
        empresa_id: v.empresa_id,
        modelo: v.modelo,
        capacidade_m3: v.capacidade_m3,
        capacidade_t: v.capacidade_t
      },
      {
        onSuccess: (n) => void toast.success(`Capacidade aplicada a ${n} veículo(s) ${v.modelo}.`),
        onError: erro
      }
    )
  }
  const podeGerenciar = role === 'god' || role === 'adm'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Frota"
        subtitle="Caminhões e máquinas de carga usados no registro de viagens."
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <FleethubIntegracao empresaId={empresaId} podeGerenciar={podeGerenciar} />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar código, placa ou modelo"
            className="h-7 w-56 text-xs"
          />
          <div className="w-48">
            <Select
              value={filtroObra}
              onChange={(e) => setFiltroObra(e.target.value)}
              className="h-7 text-xs"
            >
              <option value="">Todas as obras FleetHub</option>
              {obrasComVeiculo.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
              <option value="manual">Cadastrados no InfraWork</option>
            </Select>
          </div>
          <div className="w-40">
            <Select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="h-7 text-xs"
            >
              <option value="">Todos os tipos</option>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {TIPO_VEICULO_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={semCapacidade}
              onChange={(e) => setSemCapacidade(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Sem capacidade
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={mostrarInativos}
              onChange={(e) => setMostrarInativos(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Inativos
          </label>
          <span className="ml-auto font-mono text-2xs text-text-dim">
            {lista.length} de {frota.length}
          </span>
        </div>

        <table
          className="w-full min-w-[1100px] border-collapse rounded border border-border bg-bg-panel text-xs"
          data-testid="tabela-frota"
        >
          <thead>
            <tr className="border-b border-border text-left text-2xs font-mono uppercase tracking-wider text-text-dim">
              <th className="px-3 py-2 font-normal">Código</th>
              <th className="px-2 py-2 font-normal">Placa</th>
              <th className="px-2 py-2 font-normal">Tipo</th>
              <th className="px-2 py-2 font-normal">Modelo</th>
              <th className="px-2 py-2 font-normal">Obra FleetHub</th>
              <th className="px-2 py-2 font-normal">Propriedade</th>
              <th className="px-2 py-2 font-normal">Fornecedor</th>
              <th className="px-2 py-2 font-normal">Cap. m³</th>
              <th className="px-2 py-2 font-normal">Cap. t</th>
              <th className="px-2 py-2 font-normal">Ativo</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody>
            {lista.map((v) => {
              const fh = v.origem === 'fleethub'
              return (
                <tr
                  key={v.id}
                  className={cn('border-b border-border/50', !v.ativo && 'opacity-50')}
                >
                  <td className="px-2 py-1">
                    {fh ? (
                      <span className="flex items-center gap-1.5 px-1 font-mono">
                        {v.prefixo}
                        <span
                          className="rounded bg-accent/15 px-1 text-2xs text-accent"
                          title={`FleetHub · ${v.fleet_tipo ?? ''}${v.fleet_status ? ` · ${v.fleet_status}` : ''}`}
                        >
                          FH
                        </span>
                      </span>
                    ) : (
                      <Input
                        key={`${v.id}-${v.prefixo}`}
                        defaultValue={v.prefixo}
                        onBlur={(e) => {
                          const x = e.target.value.trim()
                          if (x && x !== v.prefixo) set(v, { prefixo: x })
                        }}
                        className="h-7 font-mono text-xs"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {fh ? (
                      <span className="px-1 font-mono">{v.placa ?? '—'}</span>
                    ) : (
                      <Input
                        key={`${v.id}-${v.placa}`}
                        defaultValue={v.placa ?? ''}
                        onBlur={(e) =>
                          e.target.value.trim() !== (v.placa ?? '') &&
                          set(v, { placa: e.target.value.trim() || null })
                        }
                        className="h-7 font-mono text-xs"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={v.tipo}
                      onChange={(e) => set(v, { tipo: e.target.value as TipoVeiculo })}
                      className="h-7 text-xs"
                    >
                      {TIPOS.map((t) => (
                        <option key={t} value={t}>
                          {TIPO_VEICULO_LABEL[t]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    {fh ? (
                      <span className="px-1">
                        {[v.marca, v.modelo, v.ano].filter(Boolean).join(' · ') || '—'}
                      </span>
                    ) : (
                      <Input
                        key={`${v.id}-${v.modelo}`}
                        defaultValue={v.modelo ?? ''}
                        onBlur={(e) =>
                          e.target.value.trim() !== (v.modelo ?? '') &&
                          set(v, { modelo: e.target.value.trim() || null })
                        }
                        className="h-7 text-xs"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1 text-text-muted">
                    {v.fleet_obra_id ? (nomeObra.get(v.fleet_obra_id) ?? '—') : '—'}
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={v.proprietario}
                      onChange={(e) =>
                        set(v, { proprietario: e.target.value as Veiculo['proprietario'] })
                      }
                      className="h-7 text-xs"
                    >
                      <option value="proprio">Próprio</option>
                      <option value="terceiro">Terceiro</option>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      key={`${v.id}-${v.fornecedor}`}
                      defaultValue={v.fornecedor ?? ''}
                      disabled={v.proprietario === 'proprio'}
                      onBlur={(e) =>
                        e.target.value.trim() !== (v.fornecedor ?? '') &&
                        set(v, { fornecedor: e.target.value.trim() || null })
                      }
                      className="h-7 text-xs"
                    />
                  </td>
                  {(['capacidade_m3', 'capacidade_t'] as const).map((k) => (
                    <td key={k} className="px-2 py-1">
                      <Input
                        key={`${v.id}-${v[k]}`}
                        defaultValue={txt(v[k])}
                        inputMode="decimal"
                        aria-label={k === 'capacidade_m3' ? 'Capacidade m³' : 'Capacidade t'}
                        onBlur={(e) => {
                          const x = parseQtd(e.target.value)
                          if (x !== v[k]) set(v, { [k]: x })
                        }}
                        className="h-7 w-20 text-right font-mono text-xs"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={v.ativo}
                      disabled={fh}
                      title={fh ? 'Vem da FleetHub' : undefined}
                      onChange={(e) => set(v, { ativo: e.target.checked })}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                  </td>
                  <td className="px-1">
                    <span className="flex items-center gap-2">
                      {v.modelo && (v.capacidade_m3 !== null || v.capacidade_t !== null) ? (
                        <button
                          type="button"
                          title={`Aplicar esta capacidade a todos os ${v.modelo}`}
                          onClick={() => copiarParaModelo(v)}
                          className="text-text-dim hover:text-accent"
                        >
                          <Copy size={13} />
                        </button>
                      ) : null}
                      {!fh ? (
                        <button
                          type="button"
                          title="Excluir (fichas antigas ficam sem veículo; prefira desativar)"
                          onClick={() => excluir.mutate(v.id, { onError: erro })}
                          className="text-text-dim hover:text-danger"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              )
            })}
            {!lista.length && !isLoading ? (
              <tr>
                <td colSpan={11} className="px-3 py-4 text-text-dim">
                  {frota.length ? 'Nenhum veículo neste filtro.' : 'Nenhum veículo cadastrado.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="mt-4 text-2xs font-mono uppercase tracking-wider text-text-dim">
          Cadastro manual (veículos fora da FleetHub)
        </p>
        <form
          className="mt-1 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!novo.prefixo.trim()) return
            salvar.mutate(
              {
                empresa_id: empresaId,
                prefixo: novo.prefixo.trim(),
                placa: novo.placa.trim() || null,
                tipo: novo.tipo
              },
              { onSuccess: () => setNovo({ ...novo, prefixo: '', placa: '' }), onError: erro }
            )
          }}
        >
          <Input
            value={novo.prefixo}
            onChange={(e) => setNovo({ ...novo, prefixo: e.target.value })}
            placeholder="Prefixo (ex.: CB-12)"
            className="h-7 w-40 font-mono text-xs"
          />
          <Input
            value={novo.placa}
            onChange={(e) => setNovo({ ...novo, placa: e.target.value })}
            placeholder="Placa"
            className="h-7 w-32 font-mono text-xs"
          />
          <Select
            value={novo.tipo}
            onChange={(e) => setNovo({ ...novo, tipo: e.target.value as TipoVeiculo })}
            className="h-7 w-36 text-xs"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {TIPO_VEICULO_LABEL[t]}
              </option>
            ))}
          </Select>
          <Button size="sm" type="submit">
            <Plus size={12} /> Incluir veículo
          </Button>
        </form>
      </div>
    </div>
  )
}
