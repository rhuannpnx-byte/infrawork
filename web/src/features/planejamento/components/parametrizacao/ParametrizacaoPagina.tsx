/**
 * Parametrização dos serviços — antes do cronograma: como cada serviço do orçamento é lançado no campo (app de campo e
 * Lançar produção). Por serviço: modo (quantidade ou viagens; a viagem medida por volume ou por peso, que exige o
 * ticket), material controlado (qual material e unidade; o sistema
 * grava o material aplicado e calcula a média por unidade produzida), observação e local obrigatório.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Search, Truck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { ErroConsulta } from '@/components/ui/estado'
import { Input } from '@/components/ui/input'
import { Secao } from '@/components/ui/secao'
import { Select } from '@/components/ui/select'
import { useAuthStore } from '@/stores/auth-store'
import { formatNumber } from '@/lib/format/number'
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import { useComposicoesServicos } from '@/features/cronograma/hooks/composicoes'
import {
  parametroDe,
  useConsumoMaterial,
  useMateriaisObra,
  useParametrosServicos,
  useSalvarParametro,
  useServicosParametrizaveis,
  type MaterialObra,
  type ServicoParametrizavel,
  type ServicoParametro
} from '../../hooks/parametros'

interface Previsto {
  recurso_id: string
  porUnidade: number
}

const aplicarFator = (v: number, fator: number, operacao: 'dividir' | 'multiplicar'): number => {
  const f = Number(fator) || 1
  return operacao === 'multiplicar' ? v * f : v / f
}

const ROTULO = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

function Marca({
  rotulo,
  checked,
  onChange,
  disabled,
  title
}: {
  rotulo: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  title?: string
}): ReactNode {
  return (
    <input
      type="checkbox"
      aria-label={rotulo}
      checked={checked}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer align-middle accent-[var(--accent)] disabled:cursor-default"
    />
  )
}

export function ParametrizacaoPagina({ obraId }: { obraId: string }): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const ro = role === 'apoio' || role === 'cliente'
  const servicos = useServicosParametrizaveis(obraId)
  const parametros = useParametrosServicos(obraId)
  const materiais = useMateriaisObra(obraId)
  const consumo = useConsumoMaterial(obraId)
  const comps = useComposicoesServicos(
    obraId,
    (servicos.data ?? []).map((s) => s.servico_id)
  )
  const salvar = useSalvarParametro(obraId)
  const [busca, setBusca] = useState('')

  // material previsto na composição do serviço (por unidade do serviço, com o fator do vínculo)
  const previstos = useMemo(() => {
    const m = new Map<string, Previsto[]>()
    for (const [servicoId, unidades] of comps.data ?? []) {
      const l: Previsto[] = []
      for (const u of unidades)
        for (const it of u.itens) {
          if (it.grupo !== 'MATERIAL') continue
          const pCpu = u.producao > 0 ? u.producao : 1
          const porCpu =
            it.consumo_material_por_unid !== null
              ? it.consumo_material_por_unid
              : it.quantidade / pCpu
          l.push({
            recurso_id: it.recurso.id,
            porUnidade: porCpu * aplicarFator(1, u.fator, u.operacao)
          })
        }
      m.set(servicoId, l)
    }
    return m
  }, [comps.data])
  const consumoDe = (
    itemId: string,
    recursoId: string | null
  ): ReturnType<typeof useConsumoMaterial>['data'] =>
    (consumo.data ?? []).filter(
      (c) => c.item_orcamentario_id === itemId && (!recursoId || c.recurso_id === recursoId)
    )

  const gravar = (p: ServicoParametro): void => {
    const codigo = servicos.data?.find((s) => s.id === p.item_orcamentario_id)?.codigo
    salvar.mutate(p, {
      onError: (e) =>
        toast.error(
          `Não foi possível salvar a parametrização do serviço${codigo ? ` ${codigo}` : ''}. ${e.message}`
        )
    })
  }
  const salvandoId = salvar.isPending ? salvar.variables?.item_orcamentario_id : null

  const total = servicos.data?.length ?? 0
  const lista = (servicos.data ?? []).filter(
    (s) =>
      !busca.trim() ||
      `${s.codigo} ${s.descricao}`.toLowerCase().includes(busca.trim().toLowerCase())
  )
  const nViagens = (servicos.data ?? []).filter(
    (s) => parametroDe(parametros.data, s.id).modo_lancamento === 'viagens'
  ).length
  const nMaterial = (servicos.data ?? []).filter(
    (s) => parametroDe(parametros.data, s.id).controla_material
  ).length
  const erroConsulta = servicos.error ?? parametros.error

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Parametrização dos serviços"
        subtitle="Como cada serviço é lançado no campo. Defina antes de montar o cronograma."
      />
      {servicos.isLoading || parametros.isLoading ? (
        <PulseBlock h={420} className="m-4" />
      ) : erroConsulta ? (
        <ErroConsulta
          erro={erroConsulta}
          oQue="a parametrização dos serviços"
          aoTentar={() => {
            void servicos.refetch()
            void parametros.refetch()
          }}
          className="m-4"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          <dl className="grid shrink-0 grid-cols-[max-content_minmax(0,75ch)] gap-x-4 gap-y-1.5 text-sm text-text-muted">
            <dt className={cn(ROTULO, 'pt-0.5')}>Lançamento</dt>
            <dd>
              Por quantidade, o apontador informa a produção do dia. Por viagens, cada viagem tem
              origem e destino e a produção do dia é a soma das viagens.
            </dd>
            <dt className={cn(ROTULO, 'pt-0.5')}>Medição da viagem</dt>
            <dd>
              Por volume ou por peso; por peso, o ticket da balança passa a ser obrigatório. A
              quantidade da viagem é lançada na unidade do serviço; empolamento e densidade ficam
              com quem lança.
            </dd>
            <dt className={cn(ROTULO, 'pt-0.5')}>Material</dt>
            <dd>
              O lançamento passa a pedir a quantidade do material escolhido. A média lançada por
              unidade produzida aparece na última coluna, ao lado do previsto na composição.
            </dd>
          </dl>

          <Secao
            titulo="Serviços do orçamento"
            nota={
              <span className="tabular">
                {contar(total, 'serviço', 'serviços')}, {nMaterial} com material controlado,{' '}
                {nViagens} por viagens
              </span>
            }
            semRecuo
            className="min-h-0 flex-1"
            corpoClassName="flex flex-col"
            acoes={
              <>
                <span role="status" aria-live="polite" className="text-sm text-text-muted">
                  {salvar.isPending ? 'Salvando…' : ''}
                </span>
                <div className="relative w-64">
                  <Search
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim"
                    aria-hidden
                  />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Filtrar por código ou descrição"
                    aria-label="Filtrar serviços por código ou descrição"
                    className="h-7 pl-8"
                  />
                </div>
              </>
            }
          >
            <div className="min-h-0 flex-1 overflow-auto border-t border-border">
              <table className="w-full min-w-[1360px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-bg-elevated shadow-[inset_0_-1px_0_var(--border-strong)]">
                  <tr className={cn('text-left', ROTULO)}>
                    <th className="px-3 py-2 font-semibold">Serviço</th>
                    <th className="px-2 py-2 font-semibold">Unidade</th>
                    <th className="px-2 py-2 font-semibold">Lançamento</th>
                    <th
                      className="px-2 py-2 font-semibold"
                      title="Volume ou peso (peso exige o ticket da balança)"
                    >
                      Medição da viagem
                    </th>
                    <th className="px-2 py-2 text-center font-semibold">Controla material</th>
                    <th className="px-2 py-2 font-semibold">Material controlado</th>
                    <th className="min-w-[6.5rem] px-2 py-2 font-semibold">Unidade do material</th>
                    <th className="px-2 py-2 text-center font-semibold">Material obrigatório</th>
                    <th className="px-2 py-2 text-center font-semibold">Observação</th>
                    <th
                      className="px-2 py-2 text-center font-semibold"
                      title="Local e estacas obrigatórios no lançamento"
                    >
                      Local obrigatório
                    </th>
                    <th className="px-3 py-2 font-semibold">Consumo (lançado × previsto)</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((s) => (
                    <Linha
                      key={s.id}
                      s={s}
                      p={parametroDe(parametros.data, s.id)}
                      materiais={materiais.data ?? []}
                      previstos={previstos.get(s.servico_id) ?? []}
                      consumo={
                        consumoDe(s.id, parametroDe(parametros.data, s.id).material_recurso_id) ??
                        []
                      }
                      ro={ro}
                      salvando={salvandoId === s.id}
                      gravar={gravar}
                    />
                  ))}
                  {!lista.length ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-4 text-sm text-text-muted">
                        {total
                          ? 'Nenhum serviço neste filtro. Apague o texto do filtro para ver todos.'
                          : 'O orçamento ainda não tem serviço com composição. Vincule as composições aos serviços no orçamento para definir como cada um é lançado.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Secao>
        </div>
      )}
    </div>
  )
}

function Linha({
  s,
  p,
  materiais,
  previstos,
  consumo,
  ro,
  salvando,
  gravar
}: {
  s: ServicoParametrizavel
  p: ServicoParametro
  materiais: MaterialObra[]
  previstos: Previsto[]
  consumo: NonNullable<ReturnType<typeof useConsumoMaterial>['data']>
  ro: boolean
  salvando: boolean
  gravar: (p: ServicoParametro) => void
}): ReactNode {
  const mat = materiais.find((m) => m.id === p.material_recurso_id) ?? null
  const prev = previstos.find((x) => x.recurso_id === p.material_recurso_id) ?? null
  const lanc = consumo[0] ?? null
  const set = (patch: Partial<ServicoParametro>): void => gravar({ ...p, ...patch })
  const ligarMaterial = (v: boolean): void => {
    if (!v) return set({ controla_material: false })
    // sugestão: o material da composição do serviço
    const sugerido = materiais.find((m) => previstos.some((x) => x.recurso_id === m.id)) ?? null
    const escolhido = mat ?? sugerido
    if (!escolhido) {
      toast.error('Cadastre o material nos recursos da obra (grupo Material) antes de controlá-lo.')
      return
    }
    set({
      controla_material: true,
      material_recurso_id: escolhido.id,
      material_unidade: escolhido.unidade
    })
  }
  return (
    <tr
      aria-busy={salvando || undefined}
      className="border-b border-border last:border-b-0 hover:bg-bg-hover"
    >
      <td className="px-3 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="tabular text-text-dim">{s.codigo}</span>
          <span className="truncate text-text">{s.descricao}</span>
          {p.modo_lancamento === 'viagens' ? (
            <Truck
              size={13}
              role="img"
              aria-label="Lançado por viagens"
              className="shrink-0 self-center text-accent"
            >
              <title>Lançado por viagens</title>
            </Truck>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-1.5 text-text-muted">{s.unidade ?? '—'}</td>
      <td className="px-2 py-1.5">
        <Select
          value={p.modo_lancamento}
          disabled={ro}
          aria-label={`Lançamento do serviço ${s.codigo}`}
          onChange={(e) =>
            set({ modo_lancamento: e.target.value as ServicoParametro['modo_lancamento'] })
          }
          className="h-7 w-32"
        >
          <option value="quantidade">Quantidade</option>
          <option value="viagens">Viagens</option>
        </Select>
      </td>
      <td className="px-2 py-1.5">
        {p.modo_lancamento === 'viagens' ? (
          <div className="flex items-center gap-2">
            <Select
              value={p.medicao_viagem}
              disabled={ro}
              aria-label={`Medição da viagem do serviço ${s.codigo}`}
              onChange={(e) =>
                set({ medicao_viagem: e.target.value as ServicoParametro['medicao_viagem'] })
              }
              className="h-7 w-28"
            >
              <option value="volume">Volume</option>
              <option value="peso">Peso</option>
            </Select>
            {p.medicao_viagem === 'peso' ? (
              <span className="whitespace-nowrap text-text-muted">Ticket obrigatório</span>
            ) : null}
          </div>
        ) : (
          <span className="text-text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        <Marca
          rotulo={`Controlar material no serviço ${s.codigo}`}
          checked={p.controla_material}
          disabled={ro}
          onChange={ligarMaterial}
        />
      </td>
      <td className="px-2 py-1.5">
        {p.controla_material ? (
          <Select
            value={p.material_recurso_id ?? ''}
            disabled={ro}
            aria-label={`Material controlado do serviço ${s.codigo}`}
            onChange={(e) => {
              const m = materiais.find((x) => x.id === e.target.value)
              if (m) set({ material_recurso_id: m.id, material_unidade: m.unidade })
            }}
            className="h-7 w-56"
          >
            {materiais.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
                {previstos.some((x) => x.recurso_id === m.id) ? ' (na composição)' : ''}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {p.controla_material ? (
          <Input
            key={`${p.material_recurso_id}-${p.material_unidade}`}
            defaultValue={p.material_unidade ?? mat?.unidade ?? ''}
            disabled={ro}
            aria-label={`Unidade do material do serviço ${s.codigo}`}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== p.material_unidade) set({ material_unidade: v })
              else e.currentTarget.value = e.currentTarget.defaultValue
            }}
            className="h-7 w-20"
          />
        ) : (
          <span className="text-text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        <Marca
          rotulo={`Material obrigatório no serviço ${s.codigo}`}
          checked={p.controla_material && p.material_obrigatorio}
          disabled={ro || !p.controla_material}
          title={!ro && !p.controla_material ? 'Marque "Controla material" antes' : undefined}
          onChange={(v) => set({ material_obrigatorio: v })}
        />
      </td>
      <td className="px-2 py-1.5 text-center">
        <Marca
          rotulo={`Observação habilitada no serviço ${s.codigo}`}
          checked={p.habilita_obs}
          disabled={ro}
          onChange={(v) => set({ habilita_obs: v })}
        />
      </td>
      <td className="px-2 py-1.5 text-center">
        <Marca
          rotulo={`Local obrigatório no serviço ${s.codigo}`}
          checked={p.exige_local}
          disabled={ro || p.modo_lancamento === 'viagens'}
          title={
            p.modo_lancamento === 'viagens'
              ? 'Nas viagens o local vem da ponta na pista (estaca de descarga ou de carga)'
              : undefined
          }
          onChange={(v) => set({ exige_local: v })}
        />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        {p.controla_material ? (
          <span className="tabular">
            <span className={cn(lanc?.media_por_unidade != null ? 'text-text' : 'text-text-muted')}>
              {lanc?.media_por_unidade != null
                ? `${formatNumber(lanc.media_por_unidade, 3)} ${p.material_unidade ?? ''}/${s.unidade ?? 'un'}`
                : 'sem lançamentos'}
            </span>
            {lanc ? (
              <span className="text-text-muted">
                {' '}
                ({contar(lanc.lancamentos, 'lançamento', 'lançamentos')})
              </span>
            ) : null}
            <span className="text-text-dim"> × </span>
            <span className="text-text-muted">
              {prev ? `${formatNumber(prev.porUnidade, 3)} previsto` : 'fora da composição'}
            </span>
          </span>
        ) : (
          <span className="text-text-dim">—</span>
        )}
      </td>
    </tr>
  )
}
