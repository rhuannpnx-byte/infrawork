import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Plus, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireRole } from '@/components/layout/RequireRole'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Carregando, ErroConsulta, Vazio } from '@/components/ui/estado'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/modals/ConfirmDialog'
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
import { contar } from '@/lib/rotulos'
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
const ROTULO_COLUNA = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const MARCA = 'h-4 w-4 accent-[var(--accent)]'

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const empresaId = scope.empresaId
  const role = useAuthStore((s) => s.profile?.role)
  const { data: frota = [], isLoading, error, refetch, dataUpdatedAt } = useFrota(empresaId)
  const { data: fleetObras = [] } = useFleetObras(empresaId)
  const salvar = useSalvarVeiculo()
  const excluir = useExcluirVeiculo()
  const aplicarModelo = useAplicarCapacidadeModelo()
  const confirm = useConfirm()
  const [novo, setNovo] = useState({ prefixo: '', placa: '', tipo: 'basculante' as TipoVeiculo })
  const [erroCodigo, setErroCodigo] = useState<string | null>(null)
  const [incluindo, setIncluindo] = useState(false)
  // linhas com gravação em andamento
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set())
  const ocupadosAgora = useRef(ocupados)
  ocupadosAgora.current = ocupados
  // tipo, propriedade e ativo mostram a escolha na hora; a lista relida (ou a falha) tira a marcação
  const [escolhidos, setEscolhidos] = useState<ReadonlyMap<string, Partial<Veiculo>>>(new Map())
  useEffect(() => {
    setEscolhidos((m) => {
      const n = new Map([...m].filter(([id]) => ocupadosAgora.current.has(id)))
      return n.size === m.size ? m : n
    })
  }, [dataUpdatedAt])
  const codigoNovo = useRef<HTMLInputElement>(null)
  const [filtroObra, setFiltroObra] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [semCapacidade, setSemCapacidade] = useState(false)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [busca, setBusca] = useState('')

  const nomeObra = useMemo(() => new Map(fleetObras.map((o) => [o.id, o.nome])), [fleetObras])
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return frota.filter(
      (v) =>
        (mostrarInativos || v.ativo) &&
        (!filtroObra ||
          (filtroObra === 'manual' ? v.origem === 'manual' : v.fleet_obra_id === filtroObra)) &&
        (!filtroTipo || v.tipo === filtroTipo) &&
        (!semCapacidade || v.capacidade_m3 === null) &&
        (!t || `${v.prefixo} ${v.placa ?? ''} ${v.modelo ?? ''}`.toLowerCase().includes(t))
    )
  }, [frota, busca, filtroObra, filtroTipo, semCapacidade, mostrarInativos])
  const obrasComVeiculo = fleetObras.filter((o) => frota.some((v) => v.fleet_obra_id === o.id))

  if (!empresaId) return <Vazio className="px-5">Selecione a empresa para cadastrar a frota.</Vazio>

  const ocupar = (id: string, sim: boolean): void =>
    setOcupados((s) => {
      const n = new Set(s)
      if (sim) n.add(id)
      else n.delete(id)
      return n
    })
  const esquecer = (id: string): void =>
    setEscolhidos((m) => {
      if (!m.has(id)) return m
      const n = new Map(m)
      n.delete(id)
      return n
    })
  const codigoEmUso = (codigo: string, menosId?: string): boolean =>
    frota.some((x) => x.id !== menosId && x.prefixo.toLowerCase() === codigo.toLowerCase())
  // grava ao sair do campo; se a gravação falhar, o campo de texto volta ao valor gravado
  const set = (v: Veiculo, patch: Partial<Veiculo>, campo?: HTMLInputElement): void => {
    if (patch.prefixo !== undefined && codigoEmUso(patch.prefixo, v.id)) {
      toast.error(`Já existe um veículo com o código ${patch.prefixo}. Use outro código.`)
      if (campo) campo.value = campo.defaultValue
      return
    }
    ocupar(v.id, true)
    if (!campo) setEscolhidos((m) => new Map(m).set(v.id, { ...m.get(v.id), ...patch }))
    void salvar
      .mutateAsync({
        ...patch,
        id: v.id,
        empresa_id: v.empresa_id,
        prefixo: patch.prefixo ?? v.prefixo
      })
      .catch((e: Error) => {
        toast.error(
          `Não foi possível salvar o veículo ${v.prefixo}. ${e.message.replace('com o prefixo', 'com o código')}`
        )
        if (campo) campo.value = campo.defaultValue
        else esquecer(v.id)
      })
      .finally(() => ocupar(v.id, false))
  }
  const copiarParaModelo = (v: Veiculo): void => {
    if (!v.modelo) return
    ocupar(v.id, true)
    void aplicarModelo
      .mutateAsync({ empresa_id: v.empresa_id, modelo: v.modelo, capacidade_m3: v.capacidade_m3 })
      .then((n) =>
        toast.success(`Capacidade aplicada a ${contar(n, 'veículo', 'veículos')} ${v.modelo}.`)
      )
      .catch((e: Error) =>
        toast.error(`Não foi possível aplicar a capacidade aos ${v.modelo}. ${e.message}`)
      )
      .finally(() => ocupar(v.id, false))
  }
  const remover = async (v: Veiculo): Promise<void> => {
    const ok = await confirm({
      title: `Excluir o veículo ${v.prefixo}?`,
      description:
        'As fichas de viagem antigas deste veículo ficam sem veículo. Se ele só saiu de uso, prefira desmarcar "Ativo".',
      confirmLabel: 'Excluir veículo',
      variant: 'danger'
    })
    if (!ok) return
    ocupar(v.id, true)
    void excluir
      .mutateAsync(v.id)
      .then(() => toast.success(`Veículo ${v.prefixo} excluído.`))
      .catch((e: Error) =>
        toast.error(`Não foi possível excluir o veículo ${v.prefixo}. ${e.message}`)
      )
      .finally(() => ocupar(v.id, false))
  }
  const incluir = (e: FormEvent): void => {
    e.preventDefault()
    const prefixo = novo.prefixo.trim()
    const erro = !prefixo
      ? 'Informe o código do veículo.'
      : codigoEmUso(prefixo)
        ? `Já existe um veículo com o código ${prefixo}. Use outro código.`
        : null
    if (erro) {
      setErroCodigo(erro)
      codigoNovo.current?.focus()
      return
    }
    setErroCodigo(null)
    setIncluindo(true)
    void salvar
      .mutateAsync({
        empresa_id: empresaId,
        prefixo,
        placa: novo.placa.trim() || null,
        tipo: novo.tipo
      })
      .then(() => {
        setNovo((n) => ({ ...n, prefixo: '', placa: '' }))
        toast.success(`Veículo ${prefixo} incluído.`)
      })
      .catch((err: Error) => {
        if (err.message.startsWith('Já existe')) {
          setErroCodigo(`Já existe um veículo com o código ${prefixo}. Use outro código.`)
          codigoNovo.current?.focus()
        } else toast.error(`Não foi possível incluir o veículo ${prefixo}. ${err.message}`)
      })
      .finally(() => setIncluindo(false))
  }
  const podeGerenciar = role === 'god' || role === 'adm'
  const temFiltro = !!(busca.trim() || filtroObra || filtroTipo || semCapacidade || mostrarInativos)
  const limparFiltros = (): void => {
    setBusca('')
    setFiltroObra('')
    setFiltroTipo('')
    setSemCapacidade(false)
    setMostrarInativos(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <PageHeader
        title="Frota"
        subtitle="Caminhões e máquinas de carga usados no registro de viagens."
      />
      <div className="shrink-0 px-4 pt-4">
        <FleethubIntegracao empresaId={empresaId} podeGerenciar={podeGerenciar} />

        <div
          role="group"
          aria-label="Filtros"
          className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2"
        >
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar código, placa ou modelo"
            aria-label="Buscar veículo por código, placa ou modelo"
            className="w-64"
          />
          {obrasComVeiculo.length > 0 || frota.some((v) => v.origem === 'fleethub') ? (
            <div className="w-56">
              <Select
                value={filtroObra}
                onChange={(e) => setFiltroObra(e.target.value)}
                aria-label="Filtrar por obra da FleetHub"
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
          ) : null}
          <div className="w-44">
            <Select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              aria-label="Filtrar por tipo de veículo"
            >
              <option value="">Todos os tipos</option>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {TIPO_VEICULO_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={semCapacidade}
              onChange={(e) => setSemCapacidade(e.target.checked)}
              className={MARCA}
            />
            Sem capacidade
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={mostrarInativos}
              onChange={(e) => setMostrarInativos(e.target.checked)}
              className={MARCA}
            />
            Mostrar inativos
          </label>
          {temFiltro ? (
            <Button variant="ghost" size="sm" onClick={limparFiltros}>
              <X size={12} /> Limpar filtros
            </Button>
          ) : null}
          <span className="ml-auto flex items-center gap-3 text-sm text-text-muted">
            <span role="status" aria-live="polite">
              {ocupados.size > 0 ? 'Salvando…' : ''}
            </span>
            {isLoading || error ? null : (
              <span className="tabular">
                {lista.length.toLocaleString('pt-BR')} de{' '}
                {contar(frota.length, 'veículo', 'veículos')}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="mx-4 min-h-[16rem] flex-1 overflow-auto rounded border border-border bg-bg-panel">
        {isLoading ? (
          <Carregando texto="Carregando a frota…" className="px-4" />
        ) : error ? (
          <ErroConsulta
            erro={error}
            oQue="a frota"
            aoTentar={() => void refetch()}
            className="m-4"
          />
        ) : (
          <table
            className="w-full min-w-[1140px] border-collapse text-sm"
            data-testid="tabela-frota"
          >
            <thead className="sticky top-0 z-10 bg-bg-elevated shadow-[inset_0_-1px_0_var(--border-strong)]">
              <tr className={cn('text-left', ROTULO_COLUNA)}>
                <th className="px-3 py-2 font-semibold">Código</th>
                <th className="px-2 py-2 font-semibold">Placa</th>
                <th className="px-2 py-2 font-semibold">Tipo</th>
                <th className="px-2 py-2 font-semibold">Modelo</th>
                <th className="px-2 py-2 font-semibold">Obra FleetHub</th>
                <th className="px-2 py-2 font-semibold">Propriedade</th>
                <th className="px-2 py-2 font-semibold">Fornecedor</th>
                <th className="px-2 py-2 text-right font-semibold">Capacidade (m³)</th>
                <th className="px-2 py-2 text-center font-semibold">Ativo</th>
                <th className="w-16 px-1 py-2 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((gravado) => {
                const v = { ...gravado, ...escolhidos.get(gravado.id) }
                const fh = v.origem === 'fleethub'
                const ocupado = ocupados.has(v.id)
                return (
                  <tr
                    key={v.id}
                    aria-busy={ocupado || undefined}
                    className={cn('border-b border-border', !v.ativo && 'text-text-dim')}
                  >
                    <td className="px-2 py-1">
                      {fh ? (
                        <span className="flex items-center gap-1.5 px-1 tabular">
                          {v.prefixo}
                          <Badge
                            variant="accent"
                            title={`Veículo da FleetHub${v.fleet_tipo ? `: ${v.fleet_tipo}` : ''}${v.fleet_status ? `, ${v.fleet_status}` : ''}`}
                          >
                            FH
                          </Badge>
                        </span>
                      ) : (
                        <Input
                          key={`${v.id}-${v.prefixo}`}
                          defaultValue={v.prefixo}
                          aria-label={`Código do veículo ${v.prefixo}`}
                          onBlur={(e) => {
                            const x = e.target.value.trim()
                            if (x && x !== v.prefixo) set(v, { prefixo: x }, e.currentTarget)
                            else e.currentTarget.value = v.prefixo
                          }}
                          className="h-7 tabular"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {fh ? (
                        <span className="px-1 tabular">{v.placa ?? '—'}</span>
                      ) : (
                        <Input
                          key={`${v.id}-${v.placa}`}
                          defaultValue={v.placa ?? ''}
                          aria-label={`Placa do veículo ${v.prefixo}`}
                          onBlur={(e) =>
                            e.target.value.trim() !== (v.placa ?? '') &&
                            set(v, { placa: e.target.value.trim() || null }, e.currentTarget)
                          }
                          className="h-7 tabular"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <Select
                        value={v.tipo}
                        aria-label={`Tipo do veículo ${v.prefixo}`}
                        onChange={(e) => set(v, { tipo: e.target.value as TipoVeiculo })}
                        className="h-7 min-w-[10rem]"
                      >
                        {TIPOS.map((t) => (
                          <option key={t} value={t}>
                            {TIPO_VEICULO_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="max-w-[13rem] px-2 py-1">
                      {fh ? (
                        <span
                          className="block truncate px-1"
                          title={[v.marca, v.modelo, v.ano].filter(Boolean).join(' · ')}
                        >
                          {[v.marca, v.modelo, v.ano].filter(Boolean).join(' · ') || '—'}
                        </span>
                      ) : (
                        <Input
                          key={`${v.id}-${v.modelo}`}
                          defaultValue={v.modelo ?? ''}
                          aria-label={`Modelo do veículo ${v.prefixo}`}
                          onBlur={(e) =>
                            e.target.value.trim() !== (v.modelo ?? '') &&
                            set(v, { modelo: e.target.value.trim() || null }, e.currentTarget)
                          }
                          className="h-7"
                        />
                      )}
                    </td>
                    <td className={cn('px-2 py-1', v.ativo && 'text-text-muted')}>
                      {v.fleet_obra_id ? (nomeObra.get(v.fleet_obra_id) ?? '—') : '—'}
                    </td>
                    <td className="px-2 py-1">
                      <Select
                        value={v.proprietario}
                        aria-label={`Propriedade do veículo ${v.prefixo}`}
                        onChange={(e) =>
                          set(v, { proprietario: e.target.value as Veiculo['proprietario'] })
                        }
                        className="h-7 min-w-[6.75rem]"
                      >
                        <option value="proprio">Próprio</option>
                        <option value="terceiro">Terceiro</option>
                      </Select>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        key={`${v.id}-${v.fornecedor}`}
                        defaultValue={v.fornecedor ?? ''}
                        aria-label={`Fornecedor do veículo ${v.prefixo}`}
                        disabled={v.proprietario === 'proprio'}
                        title={
                          v.proprietario === 'proprio' ? 'Só para veículo de terceiro' : undefined
                        }
                        onBlur={(e) =>
                          e.target.value.trim() !== (v.fornecedor ?? '') &&
                          set(v, { fornecedor: e.target.value.trim() || null }, e.currentTarget)
                        }
                        className="h-7 min-w-[6rem]"
                      />
                    </td>
                    <td className="px-2 py-1">
                      {v.capacidade_fleethub ? (
                        <span
                          className="flex items-center justify-end gap-1.5 pr-2.5 tabular"
                          title={`Cubagem da FleetHub (${v.fleet_capacidade ?? ''}). Para mudar, altere lá e sincronize.`}
                          data-testid="cap-fleethub"
                        >
                          <Badge variant="accent">FH</Badge>
                          {txt(v.capacidade_m3)}
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-1.5">
                          {v.fleet_capacidade ? (
                            <AlertTriangle
                              size={14}
                              role="img"
                              className="shrink-0 text-warn"
                              aria-label={`Na FleetHub a capacidade está "${v.fleet_capacidade}", que não é uma cubagem em m³. Corrija lá ou informe aqui.`}
                            >
                              <title>{`Na FleetHub a capacidade está "${v.fleet_capacidade}", que não é uma cubagem em m³. Corrija lá ou informe aqui.`}</title>
                            </AlertTriangle>
                          ) : null}
                          <Input
                            key={`${v.id}-${v.capacidade_m3}`}
                            defaultValue={txt(v.capacidade_m3)}
                            inputMode="decimal"
                            aria-label={`Capacidade em m³ do veículo ${v.prefixo}`}
                            onBlur={(e) => {
                              const x = parseQtd(e.target.value)
                              if (e.target.value.trim() && (x === null || x < 0)) {
                                toast.error(
                                  `A capacidade do veículo ${v.prefixo} precisa ser um número em m³, como 12,5.`
                                )
                                e.currentTarget.value = txt(v.capacidade_m3)
                                return
                              }
                              if (x !== v.capacidade_m3)
                                set(v, { capacidade_m3: x }, e.currentTarget)
                            }}
                            className="h-7 w-20 text-right tabular"
                          />
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={v.ativo}
                        disabled={fh}
                        aria-label={`Veículo ${v.prefixo} ativo`}
                        title={fh ? 'Vem da FleetHub' : undefined}
                        onChange={(e) => set(v, { ativo: e.target.checked })}
                        className={cn(MARCA, 'align-middle')}
                      />
                    </td>
                    <td className="px-1">
                      <span className="flex items-center justify-end">
                        {v.modelo && v.capacidade_m3 !== null ? (
                          <IconButton
                            size="sm"
                            variant="accent"
                            disabled={ocupado}
                            aria-label={`Aplicar a capacidade do veículo ${v.prefixo} aos ${v.modelo} sem cubagem da FleetHub`}
                            title={`Aplicar esta capacidade aos ${v.modelo} sem cubagem da FleetHub`}
                            onClick={() => copiarParaModelo(v)}
                          >
                            <Copy size={14} />
                          </IconButton>
                        ) : null}
                        {!fh ? (
                          <IconButton
                            size="sm"
                            variant="danger"
                            disabled={ocupado}
                            aria-label={`Excluir o veículo ${v.prefixo}`}
                            title="Excluir o veículo"
                            onClick={() => void remover(v)}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {!lista.length ? (
                <tr>
                  <td colSpan={10} className="px-3 py-4 text-sm text-text-muted">
                    {frota.length
                      ? 'Nenhum veículo neste filtro. Limpe os filtros para ver a frota inteira.'
                      : 'Nenhum veículo cadastrado. Conecte a FleetHub ou inclua o veículo no cadastro manual abaixo.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      <section aria-labelledby="frota-manual" className="shrink-0 px-4 pb-4 pt-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 id="frota-manual" className="text-md font-semibold text-text">
            Cadastro manual
          </h2>
          <p className="text-sm text-text-muted">Para veículos que não vêm da FleetHub.</p>
        </div>
        <form className="mt-2 flex flex-wrap items-start gap-3" noValidate onSubmit={incluir}>
          <Campo rotulo="Código" obrigatorio erro={erroCodigo} className="w-44">
            <Input
              ref={codigoNovo}
              value={novo.prefixo}
              onChange={(e) => {
                setNovo({ ...novo, prefixo: e.target.value })
                if (erroCodigo) setErroCodigo(null)
              }}
              placeholder="ex.: CB-12"
              className="tabular"
            />
          </Campo>
          <Campo rotulo="Placa" className="w-32">
            <Input
              value={novo.placa}
              onChange={(e) => setNovo({ ...novo, placa: e.target.value })}
              className="tabular"
            />
          </Campo>
          <Campo rotulo="Tipo" className="w-44">
            <Select
              value={novo.tipo}
              onChange={(e) => setNovo({ ...novo, tipo: e.target.value as TipoVeiculo })}
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {TIPO_VEICULO_LABEL[t]}
                </option>
              ))}
            </Select>
          </Campo>
          <div className="flex flex-col gap-1">
            <span aria-hidden className="invisible text-sm font-medium">
              .
            </span>
            <Button type="submit" disabled={incluindo}>
              <Plus size={13} /> {incluindo ? 'Incluindo…' : 'Incluir veículo'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
