import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'
import { formatNumber } from '@/lib/format'
import { hojeLocalISO } from '@/lib/format/local-date'
import { useEquipes } from '@/features/planejamento/hooks/equipes'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { useBaseline, usePlanejamentoAtivo } from '@/features/planejamento/hooks/planejamentos'
import { useQuantidadesEmTarefas } from '@/features/planejamento/hooks/quantidades'
import {
  parametroDe,
  useMateriaisObra,
  useParametrosServicos
} from '@/features/planejamento/hooks/parametros'
import { estacaFinalTexto, estacaInicialTexto } from '@/features/planejamento/lib/trecho'
import { resolverLocalProducao } from '../../lib/local-producao'
import { Select } from '@/components/ui/select'
import type { Encarregado, LancamentoInput, ProducaoEnriquecida } from '@/types/acompanhamento'
import {
  useCreateLancamento,
  useEncarregados,
  useFrentesObra,
  useItensLancaveis,
  useLancamentosDia,
  useMateriaisLancamento,
  useUpdateLancamento,
  useUploadFotosLancamento,
  type ItemLancavel
} from '../../hooks/lancamento'
import { parseQtd } from '../../lib/parse-qtd'
import { EncarregadoDialog } from './EncarregadoDialog'
import { ItemCombobox } from './ItemCombobox'

interface Props {
  obraId: string
  /** Lançamento em edição (null = novo). */
  editar?: ProducaoEnriquecida | null
  /** Data do lançamento (controlada pelo pai: compartilhada com "Do dia"). */
  data: string
  onDataChange: (iso: string) => void
  onSalvo?: (id: string) => void
  onCancelarEdicao?: () => void
  /** Layout de celular: campos empilhados e botão fixo no rodapé. */
  compacto?: boolean
}

interface MatRow {
  nome: string
  quantidade: string
  unidade: string
}

/** Campos lembrados entre lançamentos (equipe, encarregado, frente, local). */
interface Sticky {
  equipeId: string
  encarregadoId: string
  frente: string
  trechoId: string
}

type MaterialEdit = {
  id: string
  nome: string
  quantidade: number | null
  unidade: string | null
  recurso_id: string | null
}

const MAT_VAZIO: MatRow = { nome: '', quantidade: '', unidade: '' }

/**
 * Invólucro: mantém os campos "pegajosos" entre lançamentos e remonta o
 * formulário (via `key`) ao entrar/sair da edição, para que o estado inicial
 * venha das props sem efeitos de sincronização.
 */
export function LancamentoForm(props: Props): ReactNode {
  const editar = props.editar ?? null
  const [sticky, setSticky] = useState<Sticky>({
    equipeId: '',
    encarregadoId: '',
    frente: '',
    trechoId: ''
  })
  const { data: materiaisEdit, isFetched } = useMateriaisLancamento(editar?.id)
  if (editar && !isFetched) {
    return <div className="p-5 text-2xs font-mono text-text-dim">Carregando lançamento…</div>
  }
  return (
    <FormInner
      key={editar?.id ?? 'novo'}
      {...props}
      editar={editar}
      materiaisEdit={editar ? (materiaisEdit ?? []) : []}
      sticky={sticky}
      onSticky={setSticky}
    />
  )
}

function FormInner({
  obraId,
  editar,
  data,
  onDataChange,
  onSalvo,
  onCancelarEdicao,
  compacto = false,
  materiaisEdit,
  sticky,
  onSticky
}: Props & {
  editar: ProducaoEnriquecida | null
  materiaisEdit: MaterialEdit[]
  sticky: Sticky
  onSticky: (s: Sticky) => void
}): ReactNode {
  const { data: itens = [], isLoading: loadingItens } = useItensLancaveis(obraId)
  const { data: equipes = [] } = useEquipes(obraId)
  const { data: encarregados = [] } = useEncarregados(obraId)
  const { data: frentes = [] } = useFrentesObra(obraId)
  const create = useCreateLancamento()
  const update = useUpdateLancamento()
  const upload = useUploadFotosLancamento()

  const [equipeId, setEquipeId] = useState<string>(
    editar ? (editar.equipe_id ?? '') : sticky.equipeId
  )
  const [encarregadoId, setEncarregadoId] = useState<string>(
    editar ? (editar.encarregado_id ?? '') : sticky.encarregadoId
  )
  const [frente, setFrente] = useState(editar ? (editar.frente_raw ?? '') : sticky.frente)
  const [itemId, setItemId] = useState<string>(editar?.item_orcamentario_id ?? '')
  const [quantidade, setQuantidade] = useState(
    editar ? String(editar.qtd ?? '').replace('.', ',') : ''
  )
  const [estacaIni, setEstacaIni] = useState(editar?.estaca_inicial ?? '')
  const [estacaFim, setEstacaFim] = useState(editar?.estaca_final ?? '')
  // controle por estaca: o local (eixo/área) do lançamento; no eixo, as estacas viram a faixa em metros
  const [trechoId, setTrechoId] = useState<string>(
    editar ? (editar.trecho_id ?? '') : sticky.trechoId
  )
  const { data: trechos = [] } = useObraTrechos(obraId)
  const trecho = trechos.find((t) => t.id === trechoId) ?? null
  const [obs, setObs] = useState(editar?.obs ?? '')
  // material controlado pela parametrização do serviço (um só, com recurso); os demais são a lista livre
  const [matQtd, setMatQtd] = useState(() => {
    const m = materiaisEdit.find((x) => x.recurso_id)
    return m?.quantidade != null ? String(m.quantidade).replace('.', ',') : ''
  })
  const [materiais, setMateriais] = useState<MatRow[]>(() =>
    materiaisEdit
      .filter((m) => !m.recurso_id)
      .map((m) => ({
        nome: m.nome,
        quantidade: m.quantidade != null ? String(m.quantidade).replace('.', ',') : '',
        unidade: m.unidade ?? ''
      }))
  )
  const [fotos, setFotos] = useState<File[]>([])
  const [maisAberto, setMaisAberto] = useState(
    !!editar && !!(editar.obs || materiaisEdit.length > 0)
  )
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null)
  const [encDialog, setEncDialog] = useState(false)
  const qtdRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [tentou, setTentou] = useState(false)

  const item = useMemo(() => itens.find((i) => i.id === itemId) ?? null, [itens, itemId])
  // parametrização do serviço (Planejamento › Parametrização)
  const { data: parametros } = useParametrosServicos(obraId)
  const { data: materiaisObra = [] } = useMateriaisObra(obraId)
  const par = parametroDe(parametros, itemId)
  // serviço alimentado por viagens não recebe lançamento manual: nem aparece na lista (a não ser o já escolhido)
  const itensManuais = useMemo(
    () =>
      itens.filter(
        (i) => i.id === itemId || parametroDe(parametros, i.id).modo_lancamento !== 'viagens'
      ),
    [itens, itemId, parametros]
  )
  const porViagens = !!itemId && par.modo_lancamento === 'viagens'
  const matControlado = par.controla_material
    ? (materiaisObra.find((m) => m.id === par.material_recurso_id) ?? null)
    : null
  const matQtdNum = parseQtd(matQtd)

  // Locais em que o serviço tem tarefa no cronograma (plano em edição e linha de base vigente): marcados no
  // seletor e, quando é um só, escolhidos ao trocar o serviço.
  const { data: planoAtivo } = usePlanejamentoAtivo(obraId)
  const { data: planoLb } = useBaseline(obraId)
  const { data: locaisAtivo = [] } = useQuantidadesEmTarefas(planoAtivo?.id)
  const { data: locaisLb = [] } = useQuantidadesEmTarefas(
    planoLb && planoLb.id !== planoAtivo?.id ? planoLb.id : null
  )
  const locaisPorItem = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of [...locaisAtivo, ...locaisLb]) {
      const s = m.get(l.item_orcamentario_id) ?? new Set<string>()
      s.add(l.trecho_id)
      m.set(l.item_orcamentario_id, s)
    }
    return m
  }, [locaisAtivo, locaisLb])
  const locaisDoItem = locaisPorItem.get(itemId) ?? new Set<string>()
  const escolherItem = (id: string): void => {
    setItemId(id)
    const ls = locaisPorItem.get(id)
    if (ls?.size === 1) setTrechoId([...ls][0]!)
  }
  const unidade = item?.unidade_referencia ?? item?.servico_unidade ?? null
  const qtdNum = parseQtd(quantidade)

  // Duplicidade: mesmo item + mesma equipe no mesmo dia.
  const { data: doDia = [] } = useLancamentosDia(obraId, data)
  const duplicado = useMemo(() => {
    if (!itemId) return null
    const outros = doDia.filter(
      (p) =>
        p.id !== editar?.id &&
        p.item_orcamentario_id === itemId &&
        (p.equipe_id ?? '') === (equipeId || '')
    )
    if (outros.length === 0) return null
    const soma = outros.reduce((a, p) => a + Number(p.qtd ?? 0), 0)
    return { n: outros.length, soma }
  }, [doDia, itemId, equipeId, editar?.id])

  // Previews das fotos escolhidas.
  const previews = useMemo(
    () => fotos.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [fotos]
  )
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews])

  const salvando = create.isPending || update.isPending || upload.isPending

  const limparPorLancamento = (): void => {
    setItemId('')
    setQuantidade('')
    setEstacaIni('')
    setEstacaFim('')
    setObs('')
    setMatQtd('')
    setMateriais([])
    setFotos([])
    setProgresso(null)
    setTentou(false)
  }

  // eixo: as estacas digitadas (no padrão do eixo) viram a faixa em metros internos; área: sem faixa
  const loc = resolverLocalProducao(trecho, estacaIni, estacaFim)
  const erros: Partial<Record<CampoComErro, string>> = {}
  if (!itemId) erros.servico = 'Escolha o serviço.'
  else if (porViagens)
    erros.servico = 'Este serviço é lançado por viagens: registre as viagens do dia.'
  if (qtdNum == null || qtdNum < 0)
    erros.quantidade = quantidade ? 'Digite um número, como 1.250,5.' : 'Informe a quantidade.'
  if (data > hojeLocalISO()) erros.data = 'A data não pode ser no futuro.'
  if (par.exige_local && !trecho) erros.local = 'Este serviço exige o local do lançamento.'
  else if (!loc.ok) erros.estacas = loc.erro
  if (par.controla_material && par.material_obrigatorio && matQtdNum == null)
    erros.material = `Informe a quantidade de ${matControlado?.nome ?? 'material'} aplicada.`
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const primeiro = ORDEM_ERROS.find((c) => erros[c])
    if (primeiro || !loc.ok || qtdNum == null) {
      setTentou(true)
      const alvo = formRef.current?.querySelector<HTMLElement>(`[data-campo="${primeiro}"]`)
      alvo?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      alvo?.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true })
      return
    }
    const input: LancamentoInput = {
      obra_id: obraId,
      data,
      item_orcamentario_id: itemId,
      equipe_id: equipeId || null,
      encarregado_id: encarregadoId || null,
      quantidade: qtdNum,
      frente: frente || null,
      estaca_inicial: estacaIni || null,
      estaca_final: estacaFim || null,
      trecho_id: loc.trecho_id,
      posicao_inicio_m: loc.posicao_inicio_m,
      posicao_fim_m: loc.posicao_fim_m,
      obs: par.habilita_obs ? obs || null : null,
      materiais: par.controla_material
        ? matQtdNum != null && par.material_recurso_id
          ? [
              {
                nome: matControlado?.nome ?? '',
                quantidade: matQtdNum,
                unidade: par.material_unidade,
                recurso_id: par.material_recurso_id
              }
            ]
          : []
        : materiais
            .filter((m) => m.nome.trim())
            .map((m) => ({
              nome: m.nome,
              quantidade: parseQtd(m.quantidade),
              unidade: m.unidade || null
            }))
    }
    try {
      let id: string
      if (editar) {
        await update.mutateAsync({ id: editar.id, ...input })
        id = editar.id
      } else {
        id = (await create.mutateAsync(input)).id
      }
      if (fotos.length > 0) {
        setProgresso({ feitas: 0, total: fotos.length })
        const r = await upload.mutateAsync({
          obra_id: obraId,
          producao_id: id,
          files: fotos,
          onProgress: (feitas, total) => setProgresso({ feitas, total })
        })
        if (r.erros.length > 0)
          toast.warning(
            `${contar(r.enviadas, 'foto enviada', 'fotos enviadas')}; ${contar(r.erros.length, 'falhou', 'falharam')}.`,
            {
              description: r.erros.slice(0, 3).join('\n')
            }
          )
      }
      toast.success(
        editar
          ? 'Lançamento atualizado.'
          : `Lançado: ${formatNumber(qtdNum, 2)} ${unidade ?? ''} de ${item?.descricao ?? 'serviço'}.`
      )
      onSticky({ equipeId, encarregadoId, frente, trechoId })
      limparPorLancamento()
      onSalvo?.(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível salvar o lançamento.')
    }
  }

  const onPickFotos = (files: FileList | null): void => {
    if (!files) return
    const novas = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)
    )
    setFotos((prev) => [...prev, ...novas].slice(0, 20))
  }

  const campo =
    'h-10 w-full rounded border border-border-strong bg-bg-panel px-3 text-md text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger'

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={onSubmit}
      className={cn('flex flex-col', compacto ? 'min-h-full' : '')}
    >
      <div className={cn('space-y-4', compacto ? 'p-4 pb-28' : 'p-5')}>
        {editar ? (
          <div className="rounded border border-accent/40 bg-accent-glow px-3 py-2 text-sm text-accent flex items-center justify-between gap-2">
            <span>Editando lançamento de {fmtBR(editar.data)}</span>
            <button
              type="button"
              onClick={onCancelarEdicao}
              className="inline-flex items-center gap-1 hover:underline"
            >
              <X size={12} /> Cancelar edição
            </button>
          </div>
        ) : null}

        <div className={cn('grid gap-3', compacto ? 'grid-cols-1' : 'grid-cols-2')}>
          <div data-campo="data">
            <Label htmlFor="lc-data">Data</Label>
            <input
              id="lc-data"
              type="date"
              value={data}
              max={hojeLocalISO()}
              onChange={(e) => onDataChange(e.target.value)}
              className={campo}
              aria-invalid={erro('data') ? true : undefined}
              required
            />
            <ErroCampo texto={erro('data')} />
          </div>
          <div>
            <Label htmlFor="lc-equipe">Equipe</Label>
            <select
              id="lc-equipe"
              value={equipeId}
              onChange={(e) => {
                setEquipeId(e.target.value)
                const enc = equipes.find((eq) => eq.id === e.target.value)?.encarregado_id
                if (enc && encarregados.some((en) => en.id === enc)) setEncarregadoId(enc)
              }}
              className={campo}
            >
              <option value="">Sem equipe</option>
              {equipes.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.nome}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div data-campo="servico">
          <Label>Serviço</Label>
          <ItemCombobox
            itens={itensManuais}
            value={itemId}
            onChange={escolherItem}
            loading={loadingItens}
          />
          <ErroCampo texto={erro('servico')} />
          {item ? (
            <div className="mt-1 text-xs text-text-muted flex items-center gap-2">
              <ProgressoItem item={item} />
            </div>
          ) : null}
        </div>

        <div className={cn('grid gap-3', compacto ? 'grid-cols-1' : 'grid-cols-2')}>
          <div data-campo="quantidade">
            <Label htmlFor="lc-qtd">Quantidade{unidade ? ` (${unidade})` : ''}</Label>
            <div className="relative">
              <input
                id="lc-qtd"
                ref={qtdRef}
                type="text"
                inputMode="decimal"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="0,00"
                className={cn(campo, 'tabular pr-14')}
                aria-invalid={
                  erro('quantidade') || (quantidade && qtdNum == null) ? true : undefined
                }
                required
              />
              {unidade ? (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">
                  {unidade}
                </span>
              ) : null}
            </div>
            <ErroCampo
              texto={
                erro('quantidade') ??
                (quantidade && qtdNum == null ? 'Digite um número, como 1.250,5.' : undefined)
              }
            />
          </div>
          <div>
            <Label htmlFor="lc-encarregado">Encarregado</Label>
            <div className="flex gap-1.5">
              <select
                id="lc-encarregado"
                value={encarregadoId}
                onChange={(e) => setEncarregadoId(e.target.value)}
                className={campo}
              >
                <option value="">Sem encarregado</option>
                {encarregados.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.apelido ? `${en.nome} (${en.apelido})` : en.nome}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-10 p-0 shrink-0"
                title="Novo encarregado"
                aria-label="Novo encarregado"
                onClick={() => setEncDialog(true)}
              >
                <UserPlus size={14} />
              </Button>
            </div>
          </div>
        </div>

        {porViagens ? (
          <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-warn" />
            <span>
              Este serviço é <strong>alimentado por viagens</strong>: a produção do dia é a soma das
              viagens lançadas (app de campo ou Acompanhamento › Viagens).
            </span>
          </div>
        ) : null}

        {par.controla_material && itemId ? (
          <div data-campo="material">
            <Label htmlFor="lc-mat">
              Material aplicado: {matControlado?.nome ?? 'material'}
              {par.material_obrigatorio ? '' : ' (opcional)'}
            </Label>
            <div className="relative">
              <input
                id="lc-mat"
                type="text"
                inputMode="decimal"
                value={matQtd}
                onChange={(e) => setMatQtd(e.target.value)}
                placeholder="0,00"
                className={cn(campo, 'tabular pr-14')}
                aria-invalid={erro('material') || (matQtd && matQtdNum == null) ? true : undefined}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">
                {par.material_unidade ?? ''}
              </span>
            </div>
            {erro('material') || (matQtd && matQtdNum == null) ? (
              <ErroCampo texto={erro('material') ?? 'Digite um número, como 1.250,5.'} />
            ) : qtdNum && matQtdNum != null && qtdNum > 0 ? (
              <div className="text-xs text-text-muted mt-1 tabular">
                {formatNumber(matQtdNum / qtdNum, 3)} {par.material_unidade ?? ''} por{' '}
                {unidade ?? 'unidade'}
              </div>
            ) : null}
          </div>
        ) : null}

        <div data-campo="local">
          <Label htmlFor="lc-local">
            Local
            {par.exige_local ? (
              <span className="text-danger" aria-hidden>
                {' '}
                *
              </span>
            ) : null}
          </Label>
          <Select
            id="lc-local"
            value={trechoId}
            onChange={(e) => setTrechoId(e.target.value)}
            className="h-10 text-md"
            aria-invalid={erro('local') ? true : undefined}
            aria-required={par.exige_local || undefined}
          >
            <option value="">Sem local</option>
            {trechos.some((t) => t.tipo === 'eixo') ? (
              <optgroup label="Eixos">
                {trechos
                  .filter((t) => t.tipo === 'eixo')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome} ({estacaInicialTexto(t)} – {estacaFinalTexto(t)})
                      {locaisDoItem.has(t.id) ? ' · no cronograma' : ''}
                    </option>
                  ))}
              </optgroup>
            ) : null}
            {trechos.some((t) => t.tipo === 'area') ? (
              <optgroup label="Áreas">
                {trechos
                  .filter((t) => t.tipo === 'area')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      Área {t.nome}
                      {locaisDoItem.has(t.id) ? ' · no cronograma' : ''}
                    </option>
                  ))}
              </optgroup>
            ) : null}
          </Select>
          <ErroCampo texto={erro('local')} />
          {erro('local') ? null : trechos.length === 0 ? (
            <p className="text-xs text-warn mt-1">
              A obra não tem locais cadastrados (Planejamento › Locais): o realizado vai para as
              tarefas do serviço pela ordem de início, sem posição.
            </p>
          ) : !trecho ? (
            <p className="text-xs text-warn mt-1">
              Sem local, o realizado vai para as tarefas do serviço pela ordem de início, sem
              posição no tempo-caminho. Informe o local e as estacas.
            </p>
          ) : (
            <p className="text-xs text-text-muted mt-1">
              O realizado cai na tarefa do cronograma que cobre{' '}
              {trecho.tipo === 'area' ? 'esta área' : 'esta faixa de estacas'}.
              {item && !locaisDoItem.has(trecho.id)
                ? ' Atenção: este serviço não tem tarefa neste local no cronograma.'
                : ''}
            </p>
          )}
        </div>
        <div
          data-campo="estacas"
          className={cn('grid grid-cols-2 gap-x-3', trecho?.tipo === 'area' ? 'hidden' : '')}
        >
          <div>
            <Label htmlFor="lc-est-i">Estaca inicial</Label>
            <Input
              id="lc-est-i"
              value={estacaIni}
              onChange={(e) => setEstacaIni(e.target.value)}
              placeholder={trecho?.tipo === 'eixo' ? estacaInicialTexto(trecho) : 'Ex.: 12+300'}
              disabled={trecho?.tipo === 'area'}
              className="h-10 text-md tabular"
              aria-invalid={erro('estacas') ? true : undefined}
            />
          </div>
          <div>
            <Label htmlFor="lc-est-f">Estaca final</Label>
            <Input
              id="lc-est-f"
              value={estacaFim}
              onChange={(e) => setEstacaFim(e.target.value)}
              placeholder={trecho?.tipo === 'eixo' ? estacaFinalTexto(trecho) : 'Ex.: 12+500'}
              disabled={trecho?.tipo === 'area'}
              className="h-10 text-md tabular"
              aria-invalid={erro('estacas') ? true : undefined}
            />
          </div>
          <div className="col-span-2">
            <ErroCampo texto={erro('estacas')} />
          </div>
        </div>
        <div>
          <Label htmlFor="lc-frente">Frente</Label>
          <Input
            id="lc-frente"
            list="lc-frentes"
            value={frente}
            onChange={(e) => setFrente(e.target.value)}
            placeholder="Ex.: Pista direita · Lado esquerdo"
            className="h-10 text-md"
          />
          <datalist id="lc-frentes">
            {frentes.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>

        {duplicado ? (
          <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-warn" />
            <span>
              Já existe {duplicado.n === 1 ? 'um lançamento' : `${duplicado.n} lançamentos`} deste
              serviço
              {equipeId ? ' para esta equipe' : ' sem equipe'} em {fmtBR(data)} (
              {formatNumber(duplicado.soma, 2)} {unidade ?? ''}). Salvar cria um registro adicional.
            </span>
          </div>
        ) : null}

        {/* Fotos */}
        <div>
          <Label>Fotos</Label>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex items-center gap-1.5 h-10 px-3 rounded border border-border-strong bg-bg-elevated text-sm text-text cursor-pointer hover:border-accent">
              <Camera size={16} /> Tirar foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  onPickFotos(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
            <label className="inline-flex items-center gap-1.5 h-10 px-3 rounded border border-border-strong bg-bg-elevated text-sm text-text cursor-pointer hover:border-accent">
              <ImagePlus size={16} /> Da galeria
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  onPickFotos(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          {previews.length > 0 ? (
            <div className="mt-2 grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {previews.map((p, i) => (
                <div
                  key={p.url}
                  className="relative aspect-square rounded overflow-hidden border border-border bg-bg-elevated"
                >
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setFotos((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 size-6 rounded-full bg-[color:var(--sobre-foto)] text-[color:var(--na-foto)] flex items-center justify-center"
                    title="Remover a foto"
                    aria-label="Remover a foto"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-2xs text-text-dim mt-1">
            As fotos são comprimidas no aparelho (máx. 1920 px). Localização e hora vêm do EXIF
            quando existirem.
          </p>
        </div>

        {/* Mais detalhes */}
        {par.habilita_obs || !par.controla_material ? (
          <div className="rounded border border-border">
            <button
              type="button"
              onClick={() => setMaisAberto((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs text-text-muted hover:text-text"
            >
              <span>
                Mais detalhes (
                {[
                  par.habilita_obs ? 'observação' : null,
                  par.controla_material ? null : 'materiais'
                ]
                  .filter(Boolean)
                  .join(', ')}
                )
              </span>
              {maisAberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {maisAberto ? (
              <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                {par.habilita_obs ? (
                  <div>
                    <Label htmlFor="lc-obs">Observação</Label>
                    <textarea
                      id="lc-obs"
                      value={obs}
                      onChange={(e) => setObs(e.target.value)}
                      rows={3}
                      className={cn(campo, 'h-auto py-2')}
                      placeholder="Condições, intercorrências, etc."
                    />
                  </div>
                ) : null}
                {!par.controla_material ? (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label>Materiais aplicados</Label>
                      <button
                        type="button"
                        onClick={() => setMateriais((m) => [...m, { ...MAT_VAZIO }])}
                        className="text-2xs text-accent inline-flex items-center gap-1 hover:underline"
                      >
                        <Plus size={12} /> adicionar
                      </button>
                    </div>
                    {materiais.length === 0 ? (
                      <div className="text-2xs text-text-dim">Nenhum material informado.</div>
                    ) : null}
                    <div className="space-y-1.5">
                      {materiais.map((m, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[1fr_80px_64px_28px] gap-1.5 items-center"
                        >
                          <Input
                            value={m.nome}
                            onChange={(e) =>
                              setMateriais((arr) =>
                                arr.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x))
                              )
                            }
                            placeholder="Material"
                            className="h-9 text-sm"
                          />
                          <Input
                            value={m.quantidade}
                            inputMode="decimal"
                            onChange={(e) =>
                              setMateriais((arr) =>
                                arr.map((x, j) =>
                                  j === i ? { ...x, quantidade: e.target.value } : x
                                )
                              )
                            }
                            placeholder="qtd"
                            className="h-9 text-sm font-mono"
                          />
                          <Input
                            value={m.unidade}
                            onChange={(e) =>
                              setMateriais((arr) =>
                                arr.map((x, j) => (j === i ? { ...x, unidade: e.target.value } : x))
                              )
                            }
                            placeholder="un"
                            className="h-9 text-sm font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setMateriais((arr) => arr.filter((_, j) => j !== i))}
                            className="text-text-dim hover:text-danger flex items-center justify-center"
                            title="Remover"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Barra de ação */}
      <div
        className={cn(
          'border-t border-border bg-bg-panel px-4 py-3 flex items-center gap-2',
          compacto
            ? 'fixed bottom-0 left-0 right-0 z-30 shadow-[0_-4px_12px_rgba(0,0,0,.25)]'
            : 'sticky bottom-0'
        )}
      >
        {progresso ? (
          <span className="text-2xs font-mono text-text-dim inline-flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> fotos {progresso.feitas}/
            {progresso.total}
          </span>
        ) : null}
        <div className="flex-1" />
        {editar && !compacto ? (
          <Button type="button" variant="ghost" onClick={onCancelarEdicao} disabled={salvando}>
            Cancelar
          </Button>
        ) : null}
        <Button
          type="submit"
          size="lg"
          disabled={salvando}
          className={cn('min-h-11', compacto ? 'flex-1' : 'min-w-[180px]')}
        >
          {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {salvando ? 'Salvando…' : editar ? 'Salvar alterações' : 'Lançar produção'}
        </Button>
      </div>

      <EncarregadoDialog
        open={encDialog}
        onOpenChange={setEncDialog}
        obraId={obraId}
        onCreated={(e: Encarregado) => setEncarregadoId(e.id)}
      />
    </form>
  )
}

type CampoComErro = 'data' | 'servico' | 'quantidade' | 'material' | 'local' | 'estacas'
const ORDEM_ERROS: CampoComErro[] = [
  'data',
  'servico',
  'quantidade',
  'material',
  'local',
  'estacas'
]

function ErroCampo({ texto }: { texto?: string }): ReactNode {
  if (!texto) return null
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-danger">
      {texto}
    </p>
  )
}

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function ProgressoItem({ item }: { item: ItemLancavel }): ReactNode {
  const orc = Number(item.quantidade_referencia ?? 0)
  const real = Number(item.qtd_real ?? 0)
  const pct = orc > 0 ? Math.min(1, real / orc) : 0
  const un = item.unidade_referencia ?? item.servico_unidade ?? ''
  return (
    <>
      <span className="h-1.5 w-24 rounded bg-bg-elevated overflow-hidden inline-block">
        <span className="block h-full bg-accent" style={{ width: `${pct * 100}%` }} />
      </span>
      <span>
        executado {formatNumber(real, 2)} / {orc > 0 ? formatNumber(orc, 2) : '—'} {un}
        {orc > 0 ? ` · ${Math.round(pct * 100)}%` : ''}
      </span>
    </>
  )
}
