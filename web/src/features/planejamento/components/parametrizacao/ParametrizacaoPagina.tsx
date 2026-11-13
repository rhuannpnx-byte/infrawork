/**
 * Parametrização dos serviços — antes do cronograma: como cada serviço do orçamento é lançado no campo (app de campo e
 * Lançar produção). Por serviço: modo (quantidade ou viagens; a viagem medida por volume ou por peso, que exige o
 * ticket), material controlado (qual material e unidade; o sistema
 * grava o material aplicado e calcula a média por unidade produzida), observação e local obrigatório.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Info, Search, Truck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAuthStore } from '@/stores/auth-store'
import { formatNumber } from '@/lib/format/number'
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

function Marca({
  checked,
  onChange,
  disabled,
  title
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  title?: string
}): ReactNode {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)] disabled:cursor-default"
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
    salvar.mutate(p, {
      onError: (e) => toast.error(e.message)
    })
  }

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Parametrização dos serviços"
        subtitle="Como cada serviço é lançado no campo. Defina antes de montar o cronograma."
      />
      {servicos.isLoading || parametros.isLoading ? (
        <PulseBlock h={420} className="m-4" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          <div className="flex flex-wrap items-start gap-3 rounded border border-border bg-bg-panel px-3 py-2 text-2xs text-text-muted">
            <Info size={13} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p>
                <strong className="text-text">Lançamento</strong>: por quantidade (o apontador
                informa a produção do dia) ou por <strong className="text-text">viagens</strong>{' '}
                (cada viagem com origem e destino; a produção do dia é a soma das viagens).
              </p>
              <p>
                <strong className="text-text">Medição da viagem</strong>: por volume ou por peso (o
                ticket da balança passa a ser obrigatório). A quantidade da viagem é lançada na
                unidade do serviço; empolamento e densidade ficam com quem lança.
              </p>
              <p>
                <strong className="text-text">Material</strong>: o lançamento passa a pedir a
                quantidade do material escolhido; a média lançada por unidade produzida aparece aqui
                ao lado do previsto na composição.
              </p>
            </div>
            <div className="flex shrink-0 gap-3 font-mono">
              <span>{servicos.data?.length ?? 0} serviços</span>
              <span>{nMaterial} com material</span>
              <span>{nViagens} por viagens</span>
            </div>
          </div>

          <section className="flex min-h-0 flex-1 flex-col rounded border border-border bg-bg-panel">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">
                Serviços do orçamento
              </h3>
              <div className="relative ml-auto w-56">
                <Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
                />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Filtrar"
                  className="h-6 pl-7"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1280px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-bg-panel">
                  <tr className="border-b border-border text-left text-2xs font-mono uppercase tracking-wider text-text-dim">
                    <th className="px-3 py-2 font-normal">Serviço</th>
                    <th className="px-2 py-2 font-normal">Un.</th>
                    <th className="px-2 py-2 font-normal">Lançamento</th>
                    <th
                      className="px-2 py-2 font-normal"
                      title="Volume ou peso (peso exige o ticket da balança)"
                    >
                      Medição da viagem
                    </th>
                    <th className="px-2 py-2 text-center font-normal">Material</th>
                    <th className="px-2 py-2 font-normal">Material controlado</th>
                    <th className="px-2 py-2 font-normal">Unid. material</th>
                    <th className="px-2 py-2 text-center font-normal" title="Material obrigatório">
                      Obrig.
                    </th>
                    <th className="px-2 py-2 text-center font-normal" title="Observação habilitada">
                      Obs.
                    </th>
                    <th
                      className="px-2 py-2 text-center font-normal"
                      title="Local e estacas obrigatórios no lançamento"
                    >
                      Local obrig.
                    </th>
                    <th className="px-3 py-2 font-normal">Consumo (lançado × previsto)</th>
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
                      gravar={gravar}
                    />
                  ))}
                  {!lista.length ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-4 text-text-dim">
                        Nenhum serviço com composição no orçamento.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
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
  gravar
}: {
  s: ServicoParametrizavel
  p: ServicoParametro
  materiais: MaterialObra[]
  previstos: Previsto[]
  consumo: NonNullable<ReturnType<typeof useConsumoMaterial>['data']>
  ro: boolean
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
    <tr className="border-b border-border last:border-b-0 hover:bg-bg-hover/40">
      <td className="px-3 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xs text-text-dim">{s.codigo}</span>
          <span className="truncate text-text">{s.descricao}</span>
          {p.modo_lancamento === 'viagens' ? (
            <Truck size={12} className="shrink-0 text-accent" aria-label="por viagens" />
          ) : null}
        </div>
      </td>
      <td className="px-2 py-1.5 font-mono text-2xs text-text-muted">{s.unidade ?? '—'}</td>
      <td className="px-2 py-1.5">
        <Select
          value={p.modo_lancamento}
          disabled={ro}
          onChange={(e) =>
            set({ modo_lancamento: e.target.value as ServicoParametro['modo_lancamento'] })
          }
          className="h-7 w-32 text-xs"
        >
          <option value="quantidade">Quantidade</option>
          <option value="viagens">Viagens</option>
        </Select>
      </td>
      <td className="px-2 py-1.5">
        {p.modo_lancamento === 'viagens' ? (
          <div className="flex items-center gap-1.5">
            <Select
              value={p.medicao_viagem}
              disabled={ro}
              onChange={(e) =>
                set({ medicao_viagem: e.target.value as ServicoParametro['medicao_viagem'] })
              }
              className="h-7 w-24 text-xs"
              aria-label="Medição da viagem"
            >
              <option value="volume">Volume</option>
              <option value="peso">Peso</option>
            </Select>
            {p.medicao_viagem === 'peso' ? (
              <span className="text-2xs text-text-dim">ticket obrigatório</span>
            ) : null}
          </div>
        ) : (
          <span className="text-2xs text-text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        <Marca checked={p.controla_material} disabled={ro} onChange={ligarMaterial} />
      </td>
      <td className="px-2 py-1.5">
        {p.controla_material ? (
          <Select
            value={p.material_recurso_id ?? ''}
            disabled={ro}
            onChange={(e) => {
              const m = materiais.find((x) => x.id === e.target.value)
              if (m) set({ material_recurso_id: m.id, material_unidade: m.unidade })
            }}
            className="h-7 w-52 text-xs"
          >
            {materiais.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
                {previstos.some((x) => x.recurso_id === m.id) ? ' · na composição' : ''}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-2xs text-text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        {p.controla_material ? (
          <Input
            key={`${p.material_recurso_id}-${p.material_unidade}`}
            defaultValue={p.material_unidade ?? mat?.unidade ?? ''}
            disabled={ro}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== p.material_unidade) set({ material_unidade: v })
            }}
            className="h-7 w-20 font-mono text-xs"
          />
        ) : (
          <span className="text-2xs text-text-dim">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-center">
        <Marca
          checked={p.controla_material && p.material_obrigatorio}
          disabled={ro || !p.controla_material}
          onChange={(v) => set({ material_obrigatorio: v })}
        />
      </td>
      <td className="px-2 py-1.5 text-center">
        <Marca checked={p.habilita_obs} disabled={ro} onChange={(v) => set({ habilita_obs: v })} />
      </td>
      <td className="px-2 py-1.5 text-center">
        <Marca
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
      <td className="px-3 py-1.5 text-2xs">
        {p.controla_material ? (
          <span className="font-mono">
            <span className={cn(lanc?.media_por_unidade != null ? 'text-text' : 'text-text-dim')}>
              {lanc?.media_por_unidade != null
                ? `${formatNumber(lanc.media_por_unidade, 3)} ${p.material_unidade ?? ''}/${s.unidade ?? 'un'}`
                : 'sem lançamentos'}
            </span>
            {lanc ? <span className="text-text-dim"> ({lanc.lancamentos} lanç.)</span> : null}
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
