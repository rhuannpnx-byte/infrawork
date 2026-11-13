import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'
import { useNavigate, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  Plus,
  Save,
  Trash2,
  Wand2
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { IconButton } from '@/components/ui/IconButton'
import { Campo } from '@/components/ui/campo'
import { Secao } from '@/components/ui/secao'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
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
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { fmtBRL, fmtBRL4, fmtQtd, parseBR } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  CPU_ITEM_GRUPO_LABEL,
  CPU_ITEM_GRUPO_TO_RECURSO_GRUPOS,
  type CpuItemGrupo,
  type Recurso
} from '@/types/orcamento'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

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

const ROTULO_GRUPO = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const TH = `px-2 py-1.5 first:pl-4 ${ROTULO_GRUPO}`

interface ErrosCampos {
  codigo?: string
  nome?: string
  unidade?: string
  producao?: string
  itens?: string
  combLitros?: string
}

let seq = 0
const novaKey = (): string => `it-${Date.now()}-${seq++}`

/** Número do banco para o campo de edição, com vírgula decimal ("10,38"); vazio quando não há valor. */
function numeroBR(v: number | string | null | undefined): string {
  return v == null || v === '' ? '' : String(v).replace('.', ',')
}

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
  const { data: cadeiaTrava, isLoading: travaCarregando } = useCadeiaTrava(obraId)
  const podeEditar =
    (role === 'god' || role === 'adm' || role === 'engenheiro') && !travaCarregando && !cadeiaTrava
  const isNew = !cpuId

  const { data: cpu, isLoading, error, refetch } = useCpu(cpuId)
  const { data: recursos = [] } = useRecursos(obraId)
  const { data: servicos = [] } = useServicos(obraId)
  const { data: versoes = [] } = useCpus(obraId, cpu?.servico_id ?? null)
  const salvar = useSalvarComposicao()
  const publish = usePublishCpu()
  const confirm = useConfirm()

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
  const [tentouSalvar, setTentouSalvar] = useState(false)

  // Carrega a composição existente no estado local (uma vez por cpuId).
  useEffect(() => {
    if (!cpu || carregado) return
    setCodigo(cpu.servico?.codigo ?? '')
    setNome(cpu.nome ?? cpu.servico?.nome ?? '')
    setUnidade(cpu.servico?.unidade ?? cpu.producao_diaria_unidade ?? '')
    setProducao(numeroBR(cpu.producao_diaria_qtde))
    setObservacao(cpu.notas ?? '')
    const locais: ItemLocal[] = []
    for (const it of cpu.itens) {
      if (it.grupo === 'COMBUSTIVEL') {
        setCombRecursoId(it.recurso_id)
        const q = Number(it.quantidade ?? 0)
        setCombManual(q > 0)
        setCombLitros(q > 0 ? numeroBR(q) : '')
        continue
      }
      locais.push({
        key: novaKey(),
        grupo: it.grupo,
        recurso_id: it.recurso_id,
        quantidade: numeroBR(it.quantidade),
        horas_dia: numeroBR(it.horas_dia),
        consumo_lh: numeroBR(it.consumo_combustivel_lh),
        indice: numeroBR(it.indice_produtividade ?? 1),
        consumo_mat: numeroBR(it.consumo_material_por_unid)
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

  // Mesmas regras de antes, agora por campo, na ordem em que eram conferidas.
  const validar = (): ErrosCampos => {
    const e: ErrosCampos = {}
    if (!CODIGO_RE.test(codigo.trim()))
      e.codigo = 'Use números separados por ponto, como 01, 01.02 ou 01.02.03.'
    if (!nome.trim()) e.nome = 'Informe o nome do serviço.'
    if (!unidade.trim()) e.unidade = 'Informe a unidade.'
    else if (unidade.trim().toUpperCase() === 'DIA') e.unidade = 'A unidade "DIA" não é permitida.'
    if (!(prod > 0)) e.producao = 'Informe uma produção por dia maior que zero.'
    if (itens.some((it) => !it.recurso_id))
      e.itens = 'Há insumos sem recurso. Escolha o recurso de cada linha ou remova a linha.'
    if (combManual && combRecursoId && !(num(combLitros) > 0))
      e.combLitros = 'Informe os litros por dia ou desmarque para usar o cálculo automático.'
    return e
  }
  const erros: ErrosCampos = tentouSalvar ? validar() : {}

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
    const pendentes = Object.values(validar())
    if (pendentes.length > 0) {
      setTentouSalvar(true)
      toast.error(pendentes[0])
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus()
      )
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
          ? `Nova versão criada, com custo unitário de ${fmtBRL4(res.custo_unit ?? 0)}.`
          : `Composição salva, com custo unitário de ${fmtBRL4(res.custo_unit ?? 0)}.`
      )
      if (isNew || res.cpu_id !== cpuId) {
        navigate({ to: '/orcamento/composicoes/$id', params: { id: res.cpu_id } })
      }
    } catch (e) {
      toast.error(`Não foi possível salvar a composição. ${detalheDoErro(e) ?? ''}`.trim())
    }
  }

  const onTornarVigente = async (): Promise<void> => {
    if (!cpu) return
    try {
      await publish.mutateAsync({ id: cpu.id })
      toast.success('Esta versão passou a ser a vigente.')
    } catch (e) {
      toast.error(`Não foi possível tornar esta versão a vigente. ${detalheDoErro(e) ?? ''}`.trim())
    }
  }

  // sair pela tela com alteração por salvar pede confirmação
  const podeSair = async (): Promise<boolean> =>
    !dirty ||
    (await confirm({
      title: 'Descartar as alterações?',
      description: 'A composição tem alterações que ainda não foram salvas.',
      confirmLabel: 'Descartar',
      variant: 'danger'
    }))

  const voltar = (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (await podeSair()) void navigate({ to: '/orcamento/composicoes' })
      }}
    >
      <ArrowLeft size={12} aria-hidden /> Voltar para composições
    </Button>
  )

  if (!isNew && isLoading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Composição" actions={voltar} />
        <Carregando texto="Carregando a composição…" className="px-5" />
      </div>
    )
  }
  if (!isNew && (error || !cpu)) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Composição" actions={voltar} />
        {error ? (
          <div className="p-5">
            <ErroConsulta erro={error} oQue="a composição" aoTentar={() => void refetch()} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon="calculator"
              title="Composição não encontrada"
              description="Ela pode ter sido excluída. Volte para a lista e escolha outra composição."
              action={
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => navigate({ to: '/orcamento/composicoes' })}
                >
                  Abrir a lista de composições
                </Button>
              }
            />
          </div>
        )}
      </div>
    )
  }

  const readOnly = !podeEditar
  const motivoLeitura =
    !readOnly || travaCarregando
      ? undefined
      : cadeiaTrava
        ? `Somente leitura: ${cadeiaTrava.replace(/\s+[—–]\s+/g, ', ').replace(/\.$/, '')}.`
        : 'Seu perfil não permite editar composições.'
  const titulo = isNew ? 'Nova composição' : `${codigo} ${nome}`.trim() || 'Composição'
  const semAlteracao = !isNew && !dirty

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={titulo}
        subtitle={
          isNew
            ? 'Custo unitário a partir dos insumos e da produção por dia'
            : `Versão ${cpu?.versao ?? 1}${unidade ? `, unidade ${unidade}` : ''}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isNew ? (
              cpu?.is_vigente ? (
                <Badge variant="success">Vigente</Badge>
              ) : (
                <Badge>Versão anterior</Badge>
              )
            ) : null}
            {dirty ? <Badge variant="warn">Alterações não salvas</Badge> : null}
            {voltar}
            {!isNew && cpu && !cpu.is_vigente && podeEditar ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onTornarVigente()}
                disabled={publish.isPending}
                title="Passa a usar esta versão no orçamento"
              >
                <CheckCircle2 size={12} aria-hidden />{' '}
                {publish.isPending ? 'Aplicando…' : 'Tornar vigente'}
              </Button>
            ) : null}
            {!isNew && podeEditar ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onSalvar('nova_versao')}
                disabled={salvar.isPending}
                title="Guarda a versão atual no histórico e cria uma nova, que passa a ser a vigente"
              >
                <GitBranch size={12} aria-hidden /> Salvar como nova versão
              </Button>
            ) : null}
            {podeEditar ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => void onSalvar('salvar')}
                disabled={salvar.isPending || semAlteracao}
                title={semAlteracao ? 'Não há alterações para salvar' : undefined}
              >
                <Save size={12} aria-hidden />{' '}
                {salvar.isPending ? 'Salvando…' : isNew ? 'Criar composição' : 'Salvar'}
              </Button>
            ) : null}
          </div>
        }
      />
      <CadeiaTravaBanner obraId={obraId} />

      <div className="flex-1 overflow-auto p-5 space-y-4">
        <section
          aria-label="Dados da composição"
          className="rounded border border-border bg-bg-panel p-4"
        >
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 sm:col-span-3 lg:col-span-2 flex flex-col gap-1 min-w-0">
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
                  title={
                    motivoLeitura ?? (!isNew ? 'O código não muda depois de criado.' : undefined)
                  }
                  className="tabular"
                  placeholder="01.02"
                  aria-invalid={erros.codigo ? true : undefined}
                  aria-describedby={erros.codigo ? 'c-codigo-erro' : undefined}
                />
                {isNew && !readOnly ? (
                  <IconButton
                    variant="accent"
                    aria-label="Sugerir o próximo código"
                    title="Sugerir o próximo código"
                    className="shrink-0"
                    onClick={() => {
                      setCodigo(sugerirProximoCodigo(servicos.map((s) => s.codigo)))
                      marcar()
                    }}
                  >
                    <Wand2 size={14} aria-hidden />
                  </IconButton>
                ) : null}
              </div>
              <ErroCampo id="c-codigo-erro" erro={erros.codigo} />
            </div>
            <Campo
              rotulo="Nome do serviço"
              erro={erros.nome}
              className="col-span-12 sm:col-span-9 lg:col-span-5"
            >
              <Input
                id="c-nome"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value)
                  marcar()
                }}
                readOnly={readOnly}
                title={motivoLeitura}
                placeholder="Ex.: Base de brita graduada"
              />
            </Campo>
            <Campo rotulo="Unidade" erro={erros.unidade} className="col-span-6 lg:col-span-2">
              <Input
                id="c-unidade"
                value={unidade}
                onChange={(e) => {
                  setUnidade(e.target.value)
                  marcar()
                }}
                readOnly={readOnly}
                title={motivoLeitura}
                placeholder="m³, m², t, un"
              />
            </Campo>
            <div className="col-span-6 lg:col-span-3 flex flex-col gap-1 min-w-0">
              <Label htmlFor="c-prod">Produção por dia</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="c-prod"
                  value={producao}
                  onChange={(e) => {
                    setProducao(e.target.value)
                    marcar()
                  }}
                  readOnly={readOnly}
                  title={motivoLeitura}
                  inputMode="decimal"
                  className="tabular text-right"
                  aria-invalid={erros.producao ? true : undefined}
                  aria-describedby={erros.producao ? 'c-prod-erro' : undefined}
                />
                <span className="text-sm text-text-muted whitespace-nowrap">
                  {unidade || 'un'}/dia
                </span>
              </div>
              <ErroCampo id="c-prod-erro" erro={erros.producao} />
            </div>
            <Campo rotulo="Observações" className="col-span-12">
              <Input
                id="c-obs"
                value={observacao}
                onChange={(e) => {
                  setObservacao(e.target.value)
                  marcar()
                }}
                readOnly={readOnly}
                title={motivoLeitura}
                placeholder="Notas da composição (opcional)"
              />
            </Campo>
          </div>
        </section>

        <FaixaIndicadores rotulo="Custo da composição, calculado ao vivo">
          <Indicador rotulo="Equipamento" valor={fmtBRL(custos.eq)} tamanho="sm">
            <span>por dia</span>
          </Indicador>
          <Indicador rotulo="Combustível" valor={fmtBRL(custos.comb)} tamanho="sm">
            <span>{fmtQtd(custos.litros)} L/dia</span>
          </Indicador>
          <Indicador rotulo="Mão de obra" valor={fmtBRL(custos.mo)} tamanho="sm">
            <span>por dia</span>
          </Indicador>
          <Indicador rotulo="Material" valor={fmtBRL(custos.mat)} tamanho="sm">
            <span>por dia</span>
          </Indicador>
          <Indicador rotulo="Custo unitário" valor={fmtBRL4(custos.unit)} tamanho="sm">
            <span>{unidade ? `por ${unidade}` : 'por unidade'}</span>
          </Indicador>
        </FaixaIndicadores>
        {!isNew && cpu && Math.abs(Number(cpu.custo_unit_calc) - custos.unit) > 0.005 && !dirty ? (
          <p className="text-sm text-text-muted">
            Custo salvo na composição: {fmtBRL4(cpu.custo_unit_calc)}. Os preços dos recursos podem
            ter mudado desde a última vez que ela foi salva.
          </p>
        ) : null}

        <Secao
          titulo="Insumos"
          semRecuo
          acoes={
            podeEditar ? (
              <>
                {GRUPOS_ITEM.map((g) => (
                  <Button
                    key={g}
                    variant="secondary"
                    size="sm"
                    onClick={() => addItem(g)}
                    title={`Adicionar ${CPU_ITEM_GRUPO_LABEL[g].toLowerCase()} à composição`}
                  >
                    <Plus size={12} aria-hidden /> {CPU_ITEM_GRUPO_LABEL[g]}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNovoRecursoOpen(true)}
                  title="Cadastrar um recurso que ainda não existe"
                >
                  <Plus size={12} aria-hidden /> Cadastrar recurso
                </Button>
              </>
            ) : null
          }
        >
          <div
            tabIndex={0}
            role="region"
            aria-label="Tabela de insumos da composição"
            className="overflow-x-auto border-t border-border"
          >
            <table className="w-full min-w-[980px] text-sm tabular">
              <thead className="bg-bg-elevated border-b border-border-strong">
                <tr>
                  <th scope="col" className={cn(TH, 'text-left w-28')}>
                    Tipo
                  </th>
                  <th scope="col" className={cn(TH, 'text-left')}>
                    Recurso
                  </th>
                  <th scope="col" className={cn(TH, 'text-left w-14')}>
                    Un.
                  </th>
                  <th scope="col" className={cn(TH, 'text-right w-24')}>
                    Preço
                  </th>
                  <th
                    scope="col"
                    className={cn(TH, 'text-right w-24')}
                    title="Equipamento e mão de obra: número de unidades. Material: quantidade por dia, quando não há consumo."
                  >
                    Qtd.
                  </th>
                  <th scope="col" className={cn(TH, 'text-right w-20')}>
                    h/dia
                  </th>
                  <th
                    scope="col"
                    className={cn(TH, 'text-right w-20')}
                    title="Equipamento: litros de combustível por hora"
                  >
                    L/h
                  </th>
                  <th
                    scope="col"
                    className={cn(TH, 'text-right w-20')}
                    title="Equipamento: fração do tempo em operação (0 a 1)"
                  >
                    Índice
                  </th>
                  <th
                    scope="col"
                    className={cn(TH, 'text-right w-28')}
                    title={`Material: consumo por ${unidade || 'unidade'} produzida`}
                  >
                    Consumo/un.
                  </th>
                  <th scope="col" className={cn(TH, 'text-right w-28')}>
                    Custo/dia
                  </th>
                  <th scope="col" className="w-10" aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-6 text-text-muted">
                      {podeEditar
                        ? 'Esta composição ainda não tem insumos. Use os botões acima para adicionar equipamentos, mão de obra e materiais.'
                        : 'Esta composição não tem insumos.'}
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
                      motivoLeitura={motivoLeitura}
                      semRecurso={tentouSalvar && !it.recurso_id}
                      onPatch={(p) => patchItem(it.key, p)}
                      onRemove={() => removeItem(it.key)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {erros.itens ? (
            <p role="alert" className="px-4 py-2 text-xs font-medium text-danger">
              {erros.itens}
            </p>
          ) : null}

          <div className="border-t border-border px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 bg-bg-elevated">
            <label htmlFor="c-comb" className={ROTULO_GRUPO}>
              Combustível
            </label>
            <div className="w-72 max-w-full">
              <Select
                id="c-comb"
                value={combRecursoId}
                onChange={(e) => {
                  setCombRecursoId(e.target.value)
                  marcar()
                }}
                disabled={readOnly}
                title={motivoLeitura}
              >
                <option value="">Sem combustível</option>
                {combustiveis.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.unidade})
                    {c.preco_vigente != null ? `, ${fmtBRL4(c.preco_vigente)}` : ''}
                  </option>
                ))}
              </Select>
            </div>
            {combRecursoId ? (
              <>
                <label className="flex items-center gap-1.5 text-sm text-text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={combManual}
                    onChange={(e) => {
                      setCombManual(e.target.checked)
                      marcar()
                    }}
                    disabled={readOnly}
                    title={motivoLeitura}
                    className="accent-[var(--accent)]"
                  />
                  Informar os litros por dia
                </label>
                {combManual ? (
                  <div className="flex flex-col gap-1">
                    <Input
                      value={combLitros}
                      onChange={(e) => {
                        setCombLitros(e.target.value)
                        marcar()
                      }}
                      inputMode="decimal"
                      className="w-28 text-right tabular"
                      placeholder="L/dia"
                      aria-label="Litros de combustível por dia"
                      aria-invalid={erros.combLitros ? true : undefined}
                      aria-describedby={erros.combLitros ? 'c-comb-erro' : undefined}
                      readOnly={readOnly}
                    />
                    <ErroCampo id="c-comb-erro" erro={erros.combLitros} />
                  </div>
                ) : (
                  <span className="text-sm text-text-muted">
                    {fmtQtd(custos.litrosDerivados)} L/dia, soma dos equipamentos (qtd. × L/h ×
                    h/dia × índice)
                  </span>
                )}
                <span className="ml-auto text-sm font-semibold text-text tabular">
                  {fmtBRL(custos.comb)}/dia
                </span>
              </>
            ) : custos.litrosDerivados > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-text">
                <AlertTriangle size={14} aria-hidden className="shrink-0 text-warn" />
                Há equipamentos com L/h informado: selecione o combustível.
              </span>
            ) : null}
          </div>
        </Secao>

        {!isNew && versoes.length > 1 ? (
          <Secao titulo="Versões" nota="Abra uma versão para ver ou torná-la a vigente">
            <div className="flex flex-wrap gap-2">
              {versoes.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-current={v.id === cpuId ? 'true' : undefined}
                  onClick={async () => {
                    if (v.id !== cpuId && (await podeSair()))
                      void navigate({ to: '/orcamento/composicoes/$id', params: { id: v.id } })
                  }}
                  className={cn(
                    'h-8 rounded border px-2.5 text-sm tabular',
                    v.id === cpuId
                      ? 'border-accent-line bg-accent-glow font-semibold text-text'
                      : 'border-border-strong text-text-muted hover:border-border-accent hover:text-text'
                  )}
                >
                  Versão {v.versao}: {fmtBRL4(v.custo_unit_calc)}
                  {v.is_vigente ? ' (vigente)' : ''}
                </button>
              ))}
            </div>
          </Secao>
        ) : null}
      </div>

      <NewRecursoDialog open={novoRecursoOpen} onOpenChange={setNovoRecursoOpen} obraId={obraId} />
    </div>
  )
}

function ErroCampo({ id, erro }: { id: string; erro: string | undefined }): ReactNode {
  if (!erro) return null
  return (
    <span id={id} role="alert" className="text-xs font-medium text-danger">
      {erro}
    </span>
  )
}

function ItemRow({
  item,
  recursos,
  recurso,
  custo,
  producao,
  readOnly,
  motivoLeitura,
  semRecurso,
  onPatch,
  onRemove
}: {
  item: ItemLocal
  recursos: Recurso[]
  recurso: Recurso | undefined
  custo: number
  producao: number
  readOnly: boolean
  motivoLeitura?: string
  semRecurso: boolean
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
  const cell = 'h-7 px-1.5 text-right tabular'
  const nomeLinha = recurso?.nome ?? CPU_ITEM_GRUPO_LABEL[item.grupo].toLowerCase()
  const naoSeAplica = (
    <span className="block text-center text-text-dim" title="Não se aplica a este tipo de insumo">
      —
    </span>
  )
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="pl-4 pr-2 py-1">
        <Badge variant={ehEq ? 'accent' : ehMat ? 'default' : 'warn'}>
          {CPU_ITEM_GRUPO_LABEL[item.grupo]}
        </Badge>
      </td>
      <td className="px-2 py-1">
        <Select
          value={item.recurso_id}
          onChange={(e) => onPatch({ recurso_id: e.target.value })}
          disabled={readOnly}
          title={motivoLeitura}
          className="h-7"
          aria-label={`Recurso (${CPU_ITEM_GRUPO_LABEL[item.grupo].toLowerCase()})`}
          aria-invalid={semRecurso ? true : undefined}
        >
          <option value="">Selecione o recurso</option>
          {elegiveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-2 py-1 text-text-muted">{recurso?.unidade ?? '—'}</td>
      <td className="px-2 py-1 text-right text-text-muted whitespace-nowrap">
        {recurso?.preco_vigente != null ? (
          fmtBRL4(recurso.preco_vigente)
        ) : (
          <span className="font-semibold text-warn">Sem preço</span>
        )}
      </td>
      <td className="px-2 py-1">
        {ehMat && item.consumo_mat.trim() ? (
          <span
            className="block text-right text-text-muted"
            title="Consumo por unidade × produção por dia"
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
            aria-label={`Quantidade de ${nomeLinha}`}
          />
        )}
      </td>
      <td className="px-2 py-1">
        {ehMat ? (
          naoSeAplica
        ) : (
          <Input
            value={item.horas_dia}
            onChange={(e) => onPatch({ horas_dia: e.target.value })}
            inputMode="decimal"
            className={cell}
            readOnly={readOnly}
            aria-label={`Horas por dia de ${nomeLinha}`}
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
            aria-label={`Litros por hora de ${nomeLinha}`}
          />
        ) : (
          naoSeAplica
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
            aria-label={`Índice de operação de ${nomeLinha}`}
          />
        ) : (
          naoSeAplica
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
            aria-label={`Consumo por unidade de ${nomeLinha}`}
          />
        ) : (
          naoSeAplica
        )}
      </td>
      <td className="px-2 py-1 text-right text-text font-semibold whitespace-nowrap">
        {fmtBRL(custo)}
      </td>
      <td className="px-1 py-1 text-right">
        {!readOnly ? (
          <IconButton
            size="sm"
            variant="danger"
            onClick={onRemove}
            aria-label={`Remover ${nomeLinha} da composição`}
            title="Remover da composição"
          >
            <Trash2 size={12} aria-hidden />
          </IconButton>
        ) : null}
      </td>
    </tr>
  )
}
