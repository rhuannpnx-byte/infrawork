/**
 * Locais da obra (as "locations" do DynaRoad): eixos com estaqueamento (mapa opcional) e áreas sem estacas, cada um
 * com a sua planilha de quantidades por serviço. É daqui que as tarefas tiram posição e quantidade.
 */
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ClipboardList,
  Download,
  Map as MapIcon,
  MapPinned,
  Pencil,
  Plus,
  Trash2,
  Upload
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Popover } from '@/components/ui/popover'
import { Secao } from '@/components/ui/secao'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useObra } from '@/features/gerencial/hooks'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { downloadBlob, nomeComStamp } from '@/lib/files/download'
import { formatNumber } from '@/lib/format'
import { gerarPlanilhaQuantidades } from '@/lib/quantidades/boq-xlsx'
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import { TRECHO_CORES_PADRAO, type ObraTrecho } from '@/types/gerencial'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'
import {
  useDeleteTrecho,
  useObraTrechos,
  useTrechosQuantidadeTemplatesAtuais,
  useUpdateTrecho
} from '../../hooks/trechos'
import { useAgrupadoresTrecho } from '../../hooks/quantidades'
import {
  comprimentoEfetivo,
  estacaFinalTexto,
  estacaInicialTexto,
  rotuloUnidadeTrecho,
  segmentosDoTemplate,
  temGeometria
} from '../../lib/trecho'
import { EixoDialog } from '../../modals/EixoDialog'
import { ImportarKmlTrechoDialog } from '../../modals/ImportarKmlTrechoDialog'
import { VisualizarMapaTrechoDialog } from '../../modals/VisualizarMapaTrechoDialog'
import { QuantidadesTrechoDialog } from '../../modals/QuantidadesTrechoDialog'
import { ImportarQuantidadesDialog } from '../../modals/ImportarQuantidadesDialog'

const CABECALHO =
  'border-y border-border bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
// botão de célula: abre a edição das estacas, do mapa ou das quantidades
const BOTAO_CELULA =
  'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded border px-2 text-xs text-text transition-colors hover:border-border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50'

export function LocaisPagina(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnly = role === 'apoio'
  const { data: trechos = [], isPending, error, refetch } = useObraTrechos(obraId)
  const { data: obra } = useObra(obraId)
  const { data: agrupadores = [] } = useAgrupadoresTrecho(obraId)
  const templates = useTrechosQuantidadeTemplatesAtuais(trechos.map((t) => t.id))
  const confirm = useConfirm()
  const [novo, setNovo] = useState<null | 'eixo' | 'area'>(null)
  const [editar, setEditar] = useState<ObraTrecho | null>(null)
  const [importar, setImportar] = useState(false)
  const [quantidadesDe, setQuantidadesDe] = useState<ObraTrecho | null>(null)
  const [exportando, setExportando] = useState(false)

  const eixos = trechos.filter((t) => t.tipo === 'eixo')
  const areas = trechos.filter((t) => t.tipo === 'area')
  const proxOrdem = trechos.length ? Math.max(...trechos.map((t) => t.ordem)) + 1 : 0
  const obraNome = obra?.nome ?? scope.obra?.nome ?? ''

  const exportar = async (): Promise<void> => {
    const usados = new Set<string>()
    templates.forEach((tpl) => tpl?.colunas.forEach((c) => usados.add(c.item_orcamentario_id)))
    const servicos = (usados.size ? agrupadores.filter((a) => usados.has(a.id)) : agrupadores).map(
      (a) => ({ id: a.id, codigo: a.codigo, descricao: a.descricao, unidade: a.unidade })
    )
    if (servicos.length === 0) {
      toast.error('O orçamento ainda não tem serviços para levar à planilha.')
      return
    }
    if (trechos.length === 0) {
      toast.error('Crie ao menos um local antes de exportar.')
      return
    }
    setExportando(true)
    try {
      const blob = await gerarPlanilhaQuantidades({
        obraNome,
        servicos,
        locais: trechos.map((t) => ({
          nome: t.nome,
          tipo: t.tipo,
          segmentos: segmentosDoTemplate(templates.get(t.id))
        }))
      })
      downloadBlob(blob, nomeComStamp(`quantidades-${obra?.codigo ?? 'obra'}`, 'xlsx'))
    } catch (e) {
      toast.error(`Não foi possível gerar a planilha de quantidades. ${(e as Error).message}`)
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Locais"
        subtitle="Eixos e áreas da obra, com as quantidades por serviço."
        actions={
          <>
            <Button size="sm" variant="ghost" disabled={exportando} onClick={() => void exportar()}>
              <Download size={12} /> {exportando ? 'Exportando…' : 'Exportar planilha'}
            </Button>
            {!readOnly ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setImportar(true)}>
                  <Upload size={12} /> Importar quantidades…
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNovo('area')}>
                  <Plus size={12} /> Nova área
                </Button>
                <Button size="sm" onClick={() => setNovo('eixo')}>
                  <Plus size={12} /> Novo eixo
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <CadeiaTravaBanner obraId={obraId} />
      <div className="flex-1 overflow-auto">
        <div className="space-y-4 p-5">
          <p className="max-w-[75ch] text-sm text-text-muted">
            Um eixo tem estaqueamento; uma área não tem estacas. As tarefas do cronograma tiram a
            posição e a quantidade destes locais.
          </p>
          {isPending ? (
            <Carregando texto="Carregando os locais…" />
          ) : error ? (
            <ErroConsulta erro={error} oQue="os locais" aoTentar={() => void refetch()} />
          ) : trechos.length === 0 ? (
            <EmptyState
              icon="route"
              title="Nenhum local ainda"
              description="Crie um eixo (nome, estaca inicial e estaca final; o mapa é opcional) ou uma área. Depois informe as quantidades por serviço, na grade ou importando a planilha, e crie as tarefas a partir delas."
              action={
                !readOnly ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setNovo('eixo')}>
                      <Plus size={12} /> Novo eixo
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setImportar(true)}>
                      <Upload size={12} /> Importar quantidades…
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : null}

          {eixos.length > 0 ? (
            <Secao
              titulo="Eixos"
              nota={`${contar(eixos.length, 'eixo', 'eixos')}, cada um com o seu estaqueamento. Clique nas estacas para editar; o mapa é opcional.`}
              semRecuo
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-sm">
                  <thead>
                    <tr className={CABECALHO}>
                      <th className="w-14 px-4 py-2 text-left font-semibold">Cor</th>
                      <th className="w-20 px-2 py-2 text-left font-semibold">Ordem</th>
                      <th className="w-full px-2 py-2 text-left font-semibold">Nome</th>
                      <th className="w-[210px] px-2 py-2 text-left font-semibold">Estacas</th>
                      <th className="w-[120px] px-2 py-2 text-right font-semibold">Comprimento</th>
                      <th className="w-[110px] px-2 py-2 text-left font-semibold">Numeração</th>
                      <th className="w-[140px] px-2 py-2 text-left font-semibold">Mapa</th>
                      <th className="w-[190px] px-2 py-2 text-left font-semibold">Quantidades</th>
                      <th className="w-24 px-2 py-2">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {eixos.map((t) => (
                      <LinhaLocal
                        key={t.id}
                        trecho={t}
                        obraId={obraId}
                        readOnly={readOnly}
                        template={templates.get(t.id) ?? null}
                        onEditar={() => setEditar(t)}
                        onQuantidades={() => setQuantidadesDe(t)}
                        confirm={confirm}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Secao>
          ) : null}

          {areas.length > 0 ? (
            <Secao
              titulo="Áreas"
              nota={`${contar(areas.length, 'área', 'áreas')} sem estacas (OAE, jazida, canteiro…). A tarefa ocupa a área inteira.`}
              semRecuo
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className={CABECALHO}>
                      <th className="w-14 px-4 py-2 text-left font-semibold">Cor</th>
                      <th className="w-20 px-2 py-2 text-left font-semibold">Ordem</th>
                      <th className="w-full px-2 py-2 text-left font-semibold">Nome</th>
                      <th className="w-[190px] px-2 py-2 text-left font-semibold">Quantidades</th>
                      <th className="w-24 px-2 py-2">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {areas.map((t) => (
                      <LinhaLocal
                        key={t.id}
                        trecho={t}
                        obraId={obraId}
                        readOnly={readOnly}
                        template={templates.get(t.id) ?? null}
                        onEditar={() => setEditar(t)}
                        onQuantidades={() => setQuantidadesDe(t)}
                        confirm={confirm}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Secao>
          ) : null}
        </div>
      </div>

      <EixoDialog
        open={novo !== null || editar !== null}
        onOpenChange={(o) => {
          if (!o) {
            setNovo(null)
            setEditar(null)
          }
        }}
        obraId={obraId}
        trecho={editar}
        tipoNovo={novo ?? 'eixo'}
        proxOrdem={proxOrdem}
      />
      <ImportarQuantidadesDialog open={importar} onOpenChange={setImportar} obraId={obraId} />
      {quantidadesDe ? (
        <QuantidadesTrechoDialog
          open
          onOpenChange={(o) => {
            if (!o) setQuantidadesDe(null)
          }}
          trecho={trechos.find((t) => t.id === quantidadesDe.id) ?? quantidadesDe}
          obraNome={obraNome}
        />
      ) : null}
    </div>
  )
}

function LinhaLocal({
  trecho,
  obraId,
  readOnly,
  template,
  onEditar,
  onQuantidades,
  confirm
}: {
  trecho: ObraTrecho
  obraId: string
  readOnly: boolean
  template: TrechoQuantidadeVersaoCompleta | null
  onEditar: () => void
  onQuantidades: () => void
  confirm: ReturnType<typeof useConfirm>
}): ReactNode {
  const updTrecho = useUpdateTrecho()
  const delTrecho = useDeleteTrecho()
  const [nomeDraft, setNomeDraft] = useState(trecho.nome)
  const [ordemDraft, setOrdemDraft] = useState(trecho.ordem)
  const [corOpen, setCorOpen] = useState(false)
  const [mapaDialog, setMapaDialog] = useState<null | 'visualizar' | 'novo' | 'trocar' | 'editar'>(
    null
  )
  const ehEixo = trecho.tipo === 'eixo'
  const oLocal = ehEixo ? 'o eixo' : 'a área'
  const comMapa = temGeometria(trecho)
  const comp = comprimentoEfetivo(trecho)
  const nServ = template?.colunas.length ?? 0
  const ocupado = updTrecho.isPending || delTrecho.isPending

  const remover = async (): Promise<void> => {
    const ok = await confirm({
      title: `Remover ${oLocal} "${trecho.nome}"?`,
      description:
        'As quantidades deste local são apagadas. Locais usados por tarefas não podem ser removidos.',
      confirmLabel: ehEixo ? 'Remover eixo' : 'Remover área',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await delTrecho.mutateAsync({ id: trecho.id, obra_id: obraId })
      toast.success('Local removido.')
    } catch (e) {
      const msg = (e as Error).message
      toast.error(
        msg.includes('23503') || msg.includes('foreign key') || msg.includes('violates')
          ? `Não foi possível remover ${oLocal} "${trecho.nome}": há tarefas do cronograma neste local. Mude o local dessas tarefas antes de remover.`
          : `Não foi possível remover ${oLocal} "${trecho.nome}". ${msg}`
      )
    }
  }

  return (
    <>
      <tr aria-busy={ocupado || undefined} className="border-b border-border last:border-b-0">
        <td className="px-4 py-1.5">
          <Popover
            open={corOpen}
            onOpenChange={setCorOpen}
            align="start"
            trigger={
              <button
                type="button"
                disabled={readOnly}
                onClick={() => setCorOpen((v) => !v)}
                aria-label={`Mudar a cor de ${trecho.nome}`}
                title="Mudar a cor"
                className="block h-5 w-5 rounded-full border border-border-strong hover:ring-2 hover:ring-text-dim disabled:cursor-not-allowed"
                style={{ background: trecho.cor }}
              />
            }
          >
            <div className="grid grid-cols-4 gap-1.5 p-1.5">
              {TRECHO_CORES_PADRAO.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={c === trecho.cor}
                  onClick={async () => {
                    setCorOpen(false)
                    if (c !== trecho.cor)
                      await updTrecho
                        .mutateAsync({ id: trecho.id, obra_id: obraId, cor: c })
                        .catch((e: Error) =>
                          toast.error(
                            `Não foi possível mudar a cor de "${trecho.nome}". ${e.message}`
                          )
                        )
                  }}
                  className={cn(
                    'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110',
                    c === trecho.cor ? 'border-text' : 'border-border'
                  )}
                  style={{ background: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </Popover>
        </td>
        <td className="px-2 py-1.5">
          <Input
            type="number"
            value={ordemDraft}
            disabled={readOnly}
            aria-label={`Ordem de ${trecho.nome}`}
            onChange={(e) => setOrdemDraft(Number(e.target.value))}
            onBlur={async () => {
              if (ordemDraft === trecho.ordem) return
              try {
                await updTrecho.mutateAsync({ id: trecho.id, obra_id: obraId, ordem: ordemDraft })
              } catch (e) {
                toast.error(
                  `Não foi possível mudar a ordem de "${trecho.nome}". ${(e as Error).message}`
                )
                setOrdemDraft(trecho.ordem)
              }
            }}
            className="h-7 w-16 text-right tabular"
          />
        </td>
        <td className="px-2 py-1.5">
          <Input
            value={nomeDraft}
            disabled={readOnly}
            aria-label={`Nome d${oLocal} ${trecho.nome}`}
            onChange={(e) => setNomeDraft(e.target.value)}
            onBlur={async () => {
              const n = nomeDraft.trim()
              if (!n) return setNomeDraft(trecho.nome)
              if (n === trecho.nome) return
              try {
                await updTrecho.mutateAsync({ id: trecho.id, obra_id: obraId, nome: n })
              } catch (e) {
                toast.error(
                  `Não foi possível renomear ${oLocal} "${trecho.nome}". ${(e as Error).message}`
                )
                setNomeDraft(trecho.nome)
              }
            }}
            className="h-7 min-w-[12rem]"
          />
        </td>
        {ehEixo ? (
          <>
            <td className="px-2 py-1.5">
              <button
                type="button"
                onClick={onEditar}
                className={cn(BOTAO_CELULA, 'border-border-strong tabular')}
                title="Editar a estaca inicial, a final e a unidade"
              >
                {comp > 0 ? (
                  <>
                    {estacaInicialTexto(trecho)}{' '}
                    <span className="text-text-dim" aria-hidden>
                      →
                    </span>
                    <span className="sr-only">até</span> {estacaFinalTexto(trecho)}
                  </>
                ) : (
                  <span className="text-warn">Definir estacas</span>
                )}
              </button>
            </td>
            <td className="px-2 py-1.5 text-right tabular text-text-muted">
              {comp > 0 ? `${formatNumber(comp, 0)} m` : '—'}
            </td>
            <td className="px-2 py-1.5 text-text-muted">
              <span
                title={`Unidade: ${rotuloUnidadeTrecho(trecho.unidade_espaco_padrao, trecho.unidade_custom_label)}`}
              >
                {trecho.geometry_sentido === 'invertido' ? 'Decrescente' : 'Crescente'}
              </span>
            </td>
            <td className="px-2 py-1.5">
              <button
                type="button"
                disabled={readOnly && !comMapa}
                onClick={() => setMapaDialog(comMapa ? 'visualizar' : 'novo')}
                className={cn(
                  BOTAO_CELULA,
                  'tabular',
                  !comMapa && 'border-dashed border-border-strong text-text-muted'
                )}
                style={comMapa ? { borderColor: trecho.cor } : undefined}
                title={
                  comMapa
                    ? 'Ver o mapa do eixo'
                    : 'Vincular a polilinha de um arquivo KML ou KMZ (opcional)'
                }
              >
                {comMapa ? (
                  <>
                    <MapPinned size={12} />{' '}
                    {(Number(trecho.geometry_comprimento_m) / 1000).toFixed(1).replace('.', ',')} km
                  </>
                ) : (
                  <>
                    <MapIcon size={12} /> Vincular mapa
                  </>
                )}
              </button>
            </td>
          </>
        ) : null}
        <td className="px-2 py-1.5">
          <button
            type="button"
            disabled={ehEixo && comp <= 0}
            onClick={onQuantidades}
            className={cn(
              BOTAO_CELULA,
              nServ === 0 && 'border-dashed border-border-strong text-text-muted'
            )}
            style={nServ > 0 ? { borderColor: trecho.cor } : undefined}
            title={
              ehEixo && comp <= 0
                ? 'Defina as estacas do eixo antes'
                : nServ === 0
                  ? 'Informar as quantidades por serviço'
                  : `Versão ${template!.numero}: ${contar(nServ, 'serviço', 'serviços')} em ${contar(template!.segmentos.length, 'faixa', 'faixas')}`
            }
          >
            <ClipboardList size={12} />
            {ehEixo && comp <= 0
              ? 'Sem estacas'
              : nServ === 0
                ? 'Sem quantidades'
                : `${contar(nServ, 'serviço', 'serviços')}, versão ${template!.numero}`}
          </button>
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right">
          {ocupado ? (
            <span role="status" className="text-xs text-text-muted">
              {delTrecho.isPending ? 'Removendo…' : 'Salvando…'}
            </span>
          ) : !readOnly ? (
            <>
              <IconButton
                size="sm"
                variant="accent"
                aria-label={`Editar ${oLocal} ${trecho.nome}`}
                title={`Editar ${oLocal}`}
                onClick={onEditar}
              >
                <Pencil size={14} />
              </IconButton>
              <IconButton
                size="sm"
                variant="danger"
                aria-label={`Remover ${oLocal} ${trecho.nome}`}
                title={`Remover ${oLocal}`}
                onClick={() => void remover()}
              >
                <Trash2 size={14} />
              </IconButton>
            </>
          ) : null}
        </td>
      </tr>
      {ehEixo ? (
        <>
          <VisualizarMapaTrechoDialog
            open={mapaDialog === 'visualizar'}
            onOpenChange={(o) => {
              if (!o) setMapaDialog(null)
            }}
            trecho={trecho}
            onEditar={() => setMapaDialog('editar')}
            onTrocar={() => setMapaDialog('trocar')}
          />
          <ImportarKmlTrechoDialog
            open={mapaDialog === 'novo' || mapaDialog === 'trocar' || mapaDialog === 'editar'}
            onOpenChange={(o) => {
              if (!o) setMapaDialog(null)
            }}
            trecho={trecho}
            modo={mapaDialog === 'editar' ? 'editar' : mapaDialog === 'trocar' ? 'trocar' : 'novo'}
          />
        </>
      ) : null}
    </>
  )
}
