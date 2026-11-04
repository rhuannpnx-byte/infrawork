import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'
import { useNavigate, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, GitBranch, Plus, Save, Trash2, Wand2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useCpu, useCpus, usePublishCpu } from '@/features/orcamento/hooks/cpus'
import { useRecursos } from '@/features/orcamento/hooks/recursos'
import { useServicos } from '@/features/orcamento/hooks/servicos'
import {
  useSalvarComposicao,
  sugerirProximoCodigo,
  type ComposicaoItemInput
} from '@/features/orcamento/hooks/composicoes'
import { NewRecursoDialog } from '@/features/orcamento/modals/NewRecursoDialog'
import { fmtBRL, fmtBRL4, fmtQtd, parseBR } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  CPU_ITEM_GRUPO_LABEL,
  CPU_ITEM_GRUPO_TO_RECURSO_GRUPOS,
  type CpuItemGrupo,
  type Recurso
} from '@/types/orcamento'

interface ItemLocal {
  key: string
  grupo: Exclude<CpuItemGrupo, 'COMBUSTIVEL'>
  recurso_id: string
  quantidade: string
  horas_dia: string
  consumo_lh: string
  indice: string
  consumo_mat: string
}

const GRUPOS_ITEM: Array<Exclude<CpuItemGrupo, 'COMBUSTIVEL'>> = ['EQUIPAMENTO', 'MO', 'MATERIAL']
const CODIGO_RE = /^[0-9]{1,3}(\.[0-9]{1,3})*$/

let seq = 0
const novaKey = (): string => `it-${Date.now()}-${seq++}`

function num(s: string): number {
  const n = parseBR(s ?? '').toNumber()
  return Number.isFinite(n) ? n : 0
}
function numOpt(s: string): number | null {
  if (!s?.trim()) return null
  return num(s)
}

export function ComposicaoNovaPage(): ReactNode {
  return (
    <RequireObra pageTitle="Nova composição">
      <ComposicaoEditor cpuId={undefined} />
    </RequireObra>
  )
}

export function ComposicaoEditorPage(): ReactNode {
  const { id } = useParams({ from: '/orcamento/composicoes/$id' })
  return (
    <RequireObra pageTitle="Composição">
      <ComposicaoEditor key={id} cpuId={id} />
    </RequireObra>
  )
}

function ComposicaoEditor({ cpuId }: { cpuId: string | undefined }): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role)
  const { data: cadeiaTrava } = useCadeiaTrava(obraId)
  const podeEditar = (role === 'god' || role === 'adm' || role === 'engenheiro') && !cadeiaTrava
  const isNew = !cpuId

  const { data: cpu, isLoading, error } = useCpu(cpuId)
  const { data: recursos = [] } = useRecursos(obraId)
  const { data: servicos = [] } = useServicos(obraId)
  const { data: versoes = [] } = useCpus(obraId, cpu?.servico_id ?? null)
  const salvar = useSalvarComposicao()
  const publish = usePublishCpu()

  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [unidade, setUnidade] = useState('')
  const [producao, setProducao] = useState('')
  const [observacao, setObservacao] = useState('')
  const [itens, setItens] = useState<ItemLocal[]>([])
  const [combRecursoId, setCombRecursoId] = useState('')
  const [combManual, setCombManual] = useState(false)
  const [combLitros, setCombLitros] = useState('')
  const [carregado, setCarregado] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [novoRecursoOpen, setNovoRecursoOpen] = useState(false)

  // Carrega a composição existente no estado local (uma vez por cpuId).
  useEffect(() => {
    if (!cpu || carregado) return
    setCodigo(cpu.servico?.codigo ?? '')
    setNome(cpu.nome ?? cpu.servico?.nome ?? '')
    setUnidade(cpu.servico?.unidade ?? cpu.producao_diaria_unidade ?? '')
    setProducao(String(cpu.producao_diaria_qtde ?? ''))
    setObservacao(cpu.notas ?? '')
    const locais: ItemLocal[] = []
    for (const it of cpu.itens) {
      if (it.grupo === 'COMBUSTIVEL') {
        setCombRecursoId(it.recurso_id)
        const q = Number(it.quantidade ?? 0)
        setCombManual(q > 0)
        setCombLitros(q > 0 ? String(q) : '')
        continue
      }
      locais.push({
        key: novaKey(),
        grupo: it.grupo,
        recurso_id: it.recurso_id,
        quantidade: String(it.quantidade ?? ''),
        horas_dia: it.horas_dia != null ? String(it.horas_dia) : '',
        consumo_lh: it.consumo_combustivel_lh != null ? String(it.consumo_combustivel_lh) : '',
        indice: String(it.indice_produtividade ?? 1),
        consumo_mat:
          it.consumo_material_por_unid != null ? String(it.consumo_material_por_unid) : ''
      })
    }
    setItens(locais)
    setCarregado(true)
  }, [cpu, carregado])

  const recursosPorId = useMemo(() => new Map(recursos.map((r) => [r.id, r])), [recursos])
  const combustiveis = useMemo(
    () => recursos.filter((r) => r.grupo === 'COMBUSTIVEL' && r.ativo),
    [recursos]
  )
  const prod = num(producao)

  // ─── Preview de custo (espelha fn_cpu_item_calc) ───────────────────────
  const custos = useMemo(() => {
    let eq = 0
    let mo = 0
    let mat = 0
    let litrosDerivados = 0
    const porItem = new Map<string, number>()
    for (const it of itens) {
      const preco = Number(recursosPorId.get(it.recurso_id)?.preco_vigente ?? 0)
      let c = 0
      if (it.grupo === 'EQUIPAMENTO' || it.grupo === 'MO') {
        c = num(it.quantidade) * preco * num(it.horas_dia)
        if (it.grupo === 'EQUIPAMENTO') {
          litrosDerivados +=
            num(it.quantidade) *
            num(it.consumo_lh) *
            num(it.horas_dia) *
            (it.indice.trim() ? num(it.indice) : 1)
          eq += c
        } else mo += c
      } else {
        c = it.consumo_mat.trim() ? num(it.consumo_mat) * prod * preco : num(it.quantidade) * preco
        mat += c
      }
      porItem.set(it.key, c)
    }
    const precoComb = Number(recursosPorId.get(combRecursoId)?.preco_vigente ?? 0)
    const litros = combRecursoId ? (combManual ? num(combLitros) : litrosDerivados) : 0
    const comb = litros * precoComb
    const total = eq + mo + mat + comb
    return {
      eq,
      mo,
      mat,
      comb,
      litros,
      litrosDerivados,
      total,
      unit: prod > 0 ? total / prod : 0,
      porItem
    }
  }, [itens, recursosPorId, prod, combRecursoId, combManual, combLitros])

  const marcar = (): void => setDirty(true)

  const addItem = (grupo: ItemLocal['grupo']): void => {
    const elegiveis = recursos.filter(
      (r) => CPU_ITEM_GRUPO_TO_RECURSO_GRUPOS[grupo].includes(r.grupo) && r.ativo
    )
    setItens((s) => [
      ...s,
      {
        key: novaKey(),
        grupo,
        recurso_id: elegiveis[0]?.id ?? '',
        quantidade: grupo === 'MATERIAL' ? '' : '1',
        horas_dia: grupo === 'MATERIAL' ? '' : '8',
        consumo_lh: '',
        indice: '1',
        consumo_mat: ''
      }
    ])
    marcar()
  }

  const patchItem = (key: string, patch: Partial<ItemLocal>): void => {
    setItens((s) => s.map((it) => (it.key === key ? { ...it, ...patch } : it)))
    marcar()
  }

  const removeItem = (key: string): void => {
    setItens((s) => s.filter((it) => it.key !== key))
    marcar()
  }

  const validar = (): string | null => {
    if (!CODIGO_RE.test(codigo.trim())) return 'Código inválido (use 01, 01.02, 01.02.03).'
    if (!nome.trim()) return 'Informe o nome do serviço.'
    if (!unidade.trim()) return 'Informe a unidade.'
    if (unidade.trim().toUpperCase() === 'DIA') return 'Unidade "DIA" não é permitida.'
    if (!(prod > 0)) return 'Produção por dia deve ser maior que zero.'
    if (itens.some((it) => !it.recurso_id)) return 'Há insumos sem recurso selecionado.'
    if (combManual && combRecursoId && !(num(combLitros) > 0))
      return 'Informe os litros/dia do combustível ou volte ao modo automático.'
    return null
  }

  const montarItens = (): ComposicaoItemInput[] => {
    const out: ComposicaoItemInput[] = itens.map((it) => ({
      grupo: it.grupo,
      recurso_id: it.recurso_id,
      quantidade:
        it.grupo === 'MATERIAL'
          ? it.consumo_mat.trim()
            ? 0
            : num(it.quantidade)
          : num(it.quantidade),
      horas_dia: it.grupo === 'MATERIAL' ? null : num(it.horas_dia),
      consumo_combustivel_lh: it.grupo === 'EQUIPAMENTO' ? numOpt(it.consumo_lh) : null,
      indice_produtividade:
        it.grupo === 'EQUIPAMENTO' ? (it.indice.trim() ? num(it.indice) : 1) : 1,
      consumo_material_por_unid: it.grupo === 'MATERIAL' ? numOpt(it.consumo_mat) : null
    }))
    if (combRecursoId) {
      out.push({
        grupo: 'COMBUSTIVEL',
        recurso_id: combRecursoId,
        quantidade: combManual ? num(combLitros) : 0,
        horas_dia: null,
        consumo_combustivel_lh: null,
        indice_produtividade: 1,
        consumo_material_por_unid: null
      })
    }
    return out
  }

  const onSalvar = async (modo: 'salvar' | 'nova_versao'): Promise<void> => {
    const err = validar()
    if (err) {
      toast.error(err)
      return
    }
    try {
      const res = await salvar.mutateAsync({
        obra_id: obraId,
        codigo: codigo.trim(),
        nome: nome.trim(),
        unidade: unidade.trim(),
        producao_qtde: prod,
        observacao: observacao.trim() || null,
        itens: montarItens(),
        modo: isNew ? 'erro' : modo === 'nova_versao' ? 'nova_versao' : 'substituir_itens'
      })
      setDirty(false)
      toast.success(
        modo === 'nova_versao'
          ? `Nova versão criada (custo ${fmtBRL4(res.custo_unit ?? 0)}).`
          : `Composição salva (custo ${fmtBRL4(res.custo_unit ?? 0)}).`
      )
      if (isNew || res.cpu_id !== cpuId) {
        navigate({ to: '/orcamento/composicoes/$id', params: { id: res.cpu_id } })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    }
  }

  const onTornarVigente = async (): Promise<void> => {
    if (!cpu) return
    try {
      await publish.mutateAsync({ id: cpu.id })
      toast.success('Esta versão passou a ser a vigente.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao publicar.')
    }
  }

  if (!isNew && isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Composição" />
        <div className="flex-1 flex items-center justify-center text-xs text-text-muted font-mono">
          Carregando…
        </div>
      </div>
    )
  }
  if (!isNew && (error || !cpu)) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Composição" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="alert-triangle"
            title="Composição não encontrada"
            description={error?.message ?? 'Verifique o link.'}
            action={
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate({ to: '/orcamento/composicoes' })}
              >
                Voltar
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const readOnly = !podeEditar
  const titulo = isNew ? 'Nova composição' : `${codigo || '—'} — ${nome || 'Composição'}`

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={titulo}
        subtitle={
          isNew
            ? 'Serviço + insumos + produção por dia = custo unitário.'
            : `Versão v${cpu?.versao ?? 1}${unidade ? ` · unidade ${unidade}` : ''}`
        }
        actions={
          <div className="flex items-center gap-2">
            {!isNew ? (
              cpu?.is_vigente ? (
                <Badge variant="success">vigente</Badge>
              ) : (
                <Badge>histórico</Badge>
              )
            ) : null}
            {dirty ? <Badge variant="warn">não salvo</Badge> : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ to: '/orcamento/composicoes' })}
            >
              <ArrowLeft size={11} /> Voltar
            </Button>
            {!isNew && cpu && !cpu.is_vigente && podeEditar ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onTornarVigente()}
                disabled={publish.isPending}
              >
                <CheckCircle2 size={11} /> Tornar vigente
              </Button>
            ) : null}
            {!isNew && podeEditar ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onSalvar('nova_versao')}
                disabled={salvar.isPending}
                title="Guarda a versão atual no histórico e cria uma nova vigente"
              >
                <GitBranch size={11} /> Nova versão
              </Button>
            ) : null}
            {podeEditar ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => void onSalvar('salvar')}
                disabled={salvar.isPending || (!isNew && !dirty)}
              >
                <Save size={11} />{' '}
                {salvar.isPending ? 'Salvando…' : isNew ? 'Criar composição' : 'Salvar'}
              </Button>
            ) : null}
          </div>
        }
      />
      <CadeiaTravaBanner obraId={obraId} />

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* ─── Cabeçalho ─── */}
        <div className="rounded border border-border bg-bg-panel p-4">
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-2">
              <Label htmlFor="c-codigo">Código</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="c-codigo"
                  value={codigo}
                  onChange={(e) => {
                    setCodigo(e.target.value)
                    marcar()
                  }}
                  readOnly={readOnly || !isNew}
                  className="font-mono"
                  placeholder="01.02"
                />
                {isNew ? (
                  <button
                    type="button"
                    className="h-7 w-7 grid place-items-center rounded text-text-dim hover:text-accent hover:bg-bg-hover"
                    title="Sugerir próximo código"
                    onClick={() => {
                      setCodigo(sugerirProximoCodigo(servicos.map((s) => s.codigo)))
                      marcar()
                    }}
                  >
                    <Wand2 size={12} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="col-span-5">
              <Label htmlFor="c-nome">Nome do serviço</Label>
              <Input
                id="c-nome"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value)
                  marcar()
                }}
                readOnly={readOnly}
                placeholder="Ex.: Base de brita graduada"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="c-unidade">Unidade</Label>
              <Input
                id="c-unidade"
                value={unidade}
                onChange={(e) => {
                  setUnidade(e.target.value)
                  marcar()
                }}
                readOnly={readOnly}
                placeholder="m³, m², t, un"
                className="font-mono"
              />
            </div>
            <div className="col-span-3">
              <Label htmlFor="c-prod">Produção por dia</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="c-prod"
                  value={producao}
                  onChange={(e) => {
                    setProducao(e.target.value)
                    marcar()
                  }}
                  readOnly={readOnly}
                  inputMode="decimal"
                  className="font-mono text-right"
                />
                <span className="text-2xs font-mono text-text-dim whitespace-nowrap">
                  {unidade || 'un'}/dia
                </span>
              </div>
            </div>
            <div className="col-span-12">
              <Label htmlFor="c-obs">Observações</Label>
              <Input
                id="c-obs"
                value={observacao}
                onChange={(e) => {
                  setObservacao(e.target.value)
                  marcar()
                }}
                readOnly={readOnly}
                placeholder="Notas da composição (opcional)"
              />
            </div>
          </div>
        </div>

        {/* ─── Resumo de custo (ao vivo) ─── */}
        <div className="grid grid-cols-5 gap-3">
          <CustoCard label="Equipamento" value={custos.eq} hint="por dia" />
          <CustoCard
            label="Combustível"
            value={custos.comb}
            hint={`${fmtQtd(custos.litros)} L/dia`}
          />
          <CustoCard label="Mão de obra" value={custos.mo} hint="por dia" />
          <CustoCard label="Material" value={custos.mat} hint="por dia" />
          <CustoCard
            label="Custo unitário"
            value={custos.unit}
            hint={unidade ? `por ${unidade}` : 'unitário'}
            highlight
            precise
          />
        </div>
        {!isNew && cpu && Math.abs(Number(cpu.custo_unit_calc) - custos.unit) > 0.005 && !dirty ? (
          <div className="text-2xs font-mono text-text-dim">
            Custo gravado no banco: {fmtBRL4(cpu.custo_unit_calc)} (preços vigentes podem ter mudado
            desde o último salvamento).
          </div>
        ) : null}

        {/* ─── Insumos ─── */}
        <div className="rounded border border-border bg-bg-panel">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated">
            <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">Insumos</h3>
            {podeEditar ? (
              <div className="flex items-center gap-1">
                {GRUPOS_ITEM.map((g) => (
                  <Button key={g} variant="ghost" size="sm" onClick={() => addItem(g)}>
                    <Plus size={11} /> {CPU_ITEM_GRUPO_LABEL[g]}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNovoRecursoOpen(true)}
                  title="Cadastrar um recurso que ainda não existe"
                >
                  <Plus size={11} /> Novo recurso
                </Button>
              </div>
            ) : null}
          </div>
          <table className="w-full text-xs font-mono">
            <thead className="text-2xs text-text-dim uppercase">
              <tr className="border-b border-border">
                <th className="text-left px-2 py-1.5 font-normal w-28">Tipo</th>
                <th className="text-left px-2 py-1.5 font-normal">Recurso</th>
                <th className="text-left px-2 py-1.5 font-normal w-14">Un.</th>
                <th className="text-right px-2 py-1.5 font-normal w-24">Preço vig.</th>
                <th
                  className="text-right px-2 py-1.5 font-normal w-24"
                  title="Equipamento/MO: nº de unidades. Material: quantidade/dia (quando não há consumo)."
                >
                  Qtd
                </th>
                <th className="text-right px-2 py-1.5 font-normal w-20">h/dia</th>
                <th
                  className="text-right px-2 py-1.5 font-normal w-20"
                  title="Equipamento: litros de combustível por hora"
                >
                  L/h
                </th>
                <th
                  className="text-right px-2 py-1.5 font-normal w-20"
                  title="Equipamento: fração do tempo em operação (0 a 1)"
                >
                  Índice
                </th>
                <th
                  className="text-right px-2 py-1.5 font-normal w-28"
                  title={`Material: consumo por ${unidade || 'unidade'} produzida`}
                >
                  Consumo/un
                </th>
                <th className="text-right px-2 py-1.5 font-normal w-28">Custo/dia</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-4 text-text-dim text-center">
                    Nenhum insumo. Adicione equipamentos, mão de obra e materiais.
                  </td>
                </tr>
              ) : (
                itens.map((it) => (
                  <ItemRow
                    key={it.key}
                    item={it}
                    recursos={recursos}
                    recurso={recursosPorId.get(it.recurso_id)}
                    custo={custos.porItem.get(it.key) ?? 0}
                    producao={prod}
                    readOnly={readOnly}
                    onPatch={(p) => patchItem(it.key, p)}
                    onRemove={() => removeItem(it.key)}
                  />
                ))
              )}
            </tbody>
          </table>

          {/* ─── Combustível ─── */}
          <div className="border-t border-border px-3 py-2 flex flex-wrap items-center gap-3 bg-bg-elevated/40">
            <span className="text-2xs font-mono uppercase tracking-wider text-text-muted w-24">
              Combustível
            </span>
            <div className="w-64">
              <Select
                value={combRecursoId}
                onChange={(e) => {
                  setCombRecursoId(e.target.value)
                  marcar()
                }}
                disabled={readOnly}
              >
                <option value="">— sem combustível —</option>
                {combustiveis.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.unidade})
                    {c.preco_vigente != null ? ` · ${fmtBRL4(c.preco_vigente)}` : ''}
                  </option>
                ))}
              </Select>
            </div>
            {combRecursoId ? (
              <>
                <label className="flex items-center gap-1.5 text-2xs text-text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={combManual}
                    onChange={(e) => {
                      setCombManual(e.target.checked)
                      marcar()
                    }}
                    disabled={readOnly}
                    className="accent-[var(--accent)]"
                  />
                  informar litros/dia manualmente
                </label>
                {combManual ? (
                  <Input
                    value={combLitros}
                    onChange={(e) => {
                      setCombLitros(e.target.value)
                      marcar()
                    }}
                    inputMode="decimal"
                    className="w-28 text-right font-mono"
                    placeholder="L/dia"
                    readOnly={readOnly}
                  />
                ) : (
                  <span className="text-2xs font-mono text-text-dim">
                    {fmtQtd(custos.litrosDerivados)} L/dia = Σ equipamentos (qtd × L/h × h/dia ×
                    índice)
                  </span>
                )}
                <span className="ml-auto text-xs font-mono text-text tabular-nums">
                  {fmtBRL(custos.comb)}/dia
                </span>
              </>
            ) : custos.litrosDerivados > 0 ? (
              <span className="text-2xs font-mono text-warn">
                Há equipamentos com L/h informado — selecione o combustível.
              </span>
            ) : null}
          </div>
        </div>

        {/* ─── Versões ─── */}
        {!isNew && versoes.length > 1 ? (
          <div className="rounded border border-border bg-bg-panel p-3">
            <div className="text-2xs font-mono uppercase tracking-wider text-text-muted mb-2">
              Histórico de versões
            </div>
            <div className="flex flex-wrap gap-1.5">
              {versoes.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    navigate({ to: '/orcamento/composicoes/$id', params: { id: v.id } })
                  }
                  className={cn(
                    'rounded border px-2 py-1 text-2xs font-mono',
                    v.id === cpuId
                      ? 'border-accent text-accent bg-accent-glow'
                      : 'border-border text-text-muted hover:border-border-accent'
                  )}
                >
                  v{v.versao} · {fmtBRL4(v.custo_unit_calc)} {v.is_vigente ? '· vigente' : ''}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <NewRecursoDialog open={novoRecursoOpen} onOpenChange={setNovoRecursoOpen} obraId={obraId} />
    </div>
  )
}

function ItemRow({
  item,
  recursos,
  recurso,
  custo,
  producao,
  readOnly,
  onPatch,
  onRemove
}: {
  item: ItemLocal
  recursos: Recurso[]
  recurso: Recurso | undefined
  custo: number
  producao: number
  readOnly: boolean
  onPatch: (p: Partial<ItemLocal>) => void
  onRemove: () => void
}): ReactNode {
  const elegiveis = recursos.filter(
    (r) =>
      CPU_ITEM_GRUPO_TO_RECURSO_GRUPOS[item.grupo].includes(r.grupo) &&
      (r.ativo || r.id === item.recurso_id)
  )
  const ehEq = item.grupo === 'EQUIPAMENTO'
  const ehMat = item.grupo === 'MATERIAL'
  const cell = 'h-6 text-right font-mono'
  return (
    <tr className="border-b border-border/40">
      <td className="px-2 py-1">
        <Badge variant={ehEq ? 'accent' : ehMat ? 'default' : 'warn'}>
          {CPU_ITEM_GRUPO_LABEL[item.grupo]}
        </Badge>
      </td>
      <td className="px-2 py-1">
        <Select
          value={item.recurso_id}
          onChange={(e) => onPatch({ recurso_id: e.target.value })}
          disabled={readOnly}
          className="h-6"
        >
          <option value="">— selecionar —</option>
          {elegiveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-2 py-1 text-text-dim">{recurso?.unidade ?? '—'}</td>
      <td className="px-2 py-1 text-right text-text-muted tabular-nums">
        {recurso?.preco_vigente != null ? (
          fmtBRL4(recurso.preco_vigente)
        ) : (
          <span className="text-warn">sem preço</span>
        )}
      </td>
      <td className="px-2 py-1">
        {ehMat && item.consumo_mat.trim() ? (
          <span
            className="block text-right text-text-dim tabular-nums"
            title="= consumo × produção/dia"
          >
            {fmtQtd(num(item.consumo_mat) * producao)}
          </span>
        ) : (
          <Input
            value={item.quantidade}
            onChange={(e) => onPatch({ quantidade: e.target.value })}
            inputMode="decimal"
            className={cell}
            readOnly={readOnly}
          />
        )}
      </td>
      <td className="px-2 py-1">
        {ehMat ? (
          <span className="block text-center text-text-faint">—</span>
        ) : (
          <Input
            value={item.horas_dia}
            onChange={(e) => onPatch({ horas_dia: e.target.value })}
            inputMode="decimal"
            className={cell}
            readOnly={readOnly}
          />
        )}
      </td>
      <td className="px-2 py-1">
        {ehEq ? (
          <Input
            value={item.consumo_lh}
            onChange={(e) => onPatch({ consumo_lh: e.target.value })}
            inputMode="decimal"
            className={cell}
            readOnly={readOnly}
          />
        ) : (
          <span className="block text-center text-text-faint">—</span>
        )}
      </td>
      <td className="px-2 py-1">
        {ehEq ? (
          <Input
            value={item.indice}
            onChange={(e) => onPatch({ indice: e.target.value })}
            inputMode="decimal"
            className={cell}
            readOnly={readOnly}
          />
        ) : (
          <span className="block text-center text-text-faint">—</span>
        )}
      </td>
      <td className="px-2 py-1">
        {ehMat ? (
          <Input
            value={item.consumo_mat}
            onChange={(e) => onPatch({ consumo_mat: e.target.value })}
            inputMode="decimal"
            className={cell}
            readOnly={readOnly}
            placeholder="por un."
          />
        ) : (
          <span className="block text-center text-text-faint">—</span>
        )}
      </td>
      <td className="px-2 py-1 text-right text-text font-medium tabular-nums">{fmtBRL(custo)}</td>
      <td className="px-1 py-1 text-right">
        {!readOnly ? (
          <button
            type="button"
            onClick={onRemove}
            className="w-5 h-5 inline-flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-danger/10"
            title="Remover"
          >
            <Trash2 size={11} />
          </button>
        ) : null}
      </td>
    </tr>
  )
}

function CustoCard({
  label,
  value,
  hint,
  highlight,
  precise
}: {
  label: string
  value: number
  hint?: string
  highlight?: boolean
  precise?: boolean
}): ReactNode {
  return (
    <div
      className={
        highlight
          ? 'rounded border border-accent-line bg-accent/5 p-3'
          : 'rounded border border-border bg-bg-panel p-3'
      }
    >
      <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1">{label}</div>
      <div
        className={
          highlight
            ? 'text-lg font-semibold font-mono text-accent tabular-nums'
            : 'text-md font-mono text-text tabular-nums'
        }
      >
        {precise ? fmtBRL4(value) : fmtBRL(value)}
      </div>
      {hint ? <div className="text-2xs text-text-dim font-mono mt-0.5">{hint}</div> : null}
    </div>
  )
}
