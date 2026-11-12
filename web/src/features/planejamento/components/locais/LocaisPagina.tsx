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
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Popover } from '@/components/ui/popover'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useObra } from '@/features/gerencial/hooks'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { downloadBlob, nomeComStamp } from '@/lib/files/download'
import { formatNumber } from '@/lib/format'
import { gerarPlanilhaQuantidades } from '@/lib/quantidades/boq-xlsx'
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

export function LocaisPagina(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnly = role === 'apoio'
  const { data: trechos = [], isPending } = useObraTrechos(obraId)
  const { data: obra } = useObra(obraId)
  const { data: agrupadores = [] } = useAgrupadoresTrecho(obraId)
  const templates = useTrechosQuantidadeTemplatesAtuais(trechos.map((t) => t.id))
  const confirm = useConfirm()
  const [novo, setNovo] = useState<null | 'eixo' | 'area'>(null)
  const [editar, setEditar] = useState<ObraTrecho | null>(null)
  const [importar, setImportar] = useState(false)
  const [quantidadesDe, setQuantidadesDe] = useState<ObraTrecho | null>(null)

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
      toast.error('O orçamento ainda não tem serviços agrupadores.')
      return
    }
    if (trechos.length === 0) {
      toast.error('Crie ao menos um local antes de exportar.')
      return
    }
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
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Locais"
        subtitle={`${obraNome} — eixos com estaqueamento e áreas sem estacas, cada um com as quantidades por serviço. As tarefas do cronograma apontam para estes locais.`}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => void exportar()}>
              <Download size={11} /> Exportar planilha
            </Button>
            {!readOnly ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setImportar(true)}>
                  <Upload size={11} /> Importar quantidades…
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNovo('area')}>
                  <Plus size={11} /> Nova área
                </Button>
                <Button size="sm" onClick={() => setNovo('eixo')}>
                  <Plus size={11} /> Novo eixo
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <CadeiaTravaBanner obraId={obraId} />
      <div className="flex-1 overflow-auto">
        <div className="px-4 py-4 space-y-4">
          {!isPending && trechos.length === 0 ? (
            <EmptyState
              icon="route"
              title="Nenhum local ainda"
              description="Crie um eixo (nome + estaca inicial e final; o mapa é opcional) ou uma área. Depois informe as quantidades por serviço — na grade ou importando a planilha — e crie as tarefas a partir delas."
              action={
                !readOnly ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setNovo('eixo')}>
                      <Plus size={11} /> Novo eixo
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setImportar(true)}>
                      <Upload size={11} /> Importar quantidades…
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : null}

          {eixos.length > 0 ? (
            <section className="rounded border border-border bg-bg-panel">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                <div className="text-2xs font-mono text-text-dim uppercase">
                  Eixos ({eixos.length})
                </div>
                <div className="text-2xs text-text-dim font-mono">
                  1 eixo = 1 estaqueamento · clique nas estacas para editar · o mapa é opcional
                </div>
              </div>
              <table className="w-full text-xs font-mono">
                <thead className="text-text-dim uppercase text-2xs">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-1.5 w-10">Cor</th>
                    <th className="text-left px-3 py-1.5 w-14">Ordem</th>
                    <th className="text-left px-3 py-1.5">Nome</th>
                    <th className="text-left px-3 py-1.5 w-[210px]">Estacas</th>
                    <th className="text-right px-3 py-1.5 w-[110px]">Comprimento</th>
                    <th className="text-left px-3 py-1.5 w-[90px]">Numeração</th>
                    <th className="text-left px-3 py-1.5 w-[110px]">Mapa</th>
                    <th className="text-left px-3 py-1.5 w-[170px]">Quantidades</th>
                    <th className="px-3 py-1.5 w-20" />
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
            </section>
          ) : null}

          {areas.length > 0 ? (
            <section className="rounded border border-border bg-bg-panel">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                <div className="text-2xs font-mono text-text-dim uppercase">
                  Áreas ({areas.length})
                </div>
                <div className="text-2xs text-text-dim font-mono">
                  locais sem estacas (OAE, jazida, canteiro…) · a tarefa ocupa a área inteira
                </div>
              </div>
              <table className="w-full text-xs font-mono">
                <thead className="text-text-dim uppercase text-2xs">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-1.5 w-10">Cor</th>
                    <th className="text-left px-3 py-1.5 w-14">Ordem</th>
                    <th className="text-left px-3 py-1.5">Nome</th>
                    <th className="text-left px-3 py-1.5 w-[170px]">Quantidades</th>
                    <th className="px-3 py-1.5 w-20" />
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
            </section>
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
  const comMapa = temGeometria(trecho)
  const comp = comprimentoEfetivo(trecho)
  const nServ = template?.colunas.length ?? 0

  const remover = async (): Promise<void> => {
    const ok = await confirm({
      title: `Remover ${ehEixo ? 'o eixo' : 'a área'} "${trecho.nome}"?`,
      description:
        'As quantidades deste local são apagadas. Locais usados por tarefas não podem ser removidos.',
      confirmLabel: 'Remover',
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
          ? 'Local em uso: há tarefas com locais neste trecho. Mude o trecho das tarefas antes de remover.'
          : 'Falha ao remover: ' + msg
      )
    }
  }

  return (
    <>
      <tr className="border-b border-border">
        <td className="px-3 py-1.5">
          <Popover
            open={corOpen}
            onOpenChange={setCorOpen}
            align="start"
            trigger={
              <button
                type="button"
                disabled={readOnly}
                onClick={() => setCorOpen((v) => !v)}
                aria-label={`Cor de ${trecho.nome}`}
                className="w-5 h-5 rounded-full border border-border-strong hover:ring-2 hover:ring-text-dim disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: trecho.cor }}
              />
            }
          >
            <div className="p-1.5 grid grid-cols-4 gap-1.5">
              {TRECHO_CORES_PADRAO.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={async () => {
                    setCorOpen(false)
                    if (c !== trecho.cor)
                      await updTrecho
                        .mutateAsync({ id: trecho.id, obra_id: obraId, cor: c })
                        .catch((e: Error) => toast.error('Falha ao mudar cor: ' + e.message))
                  }}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${c === trecho.cor ? 'border-text' : 'border-border'}`}
                  style={{ background: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </Popover>
        </td>
        <td className="px-3 py-1.5">
          <Input
            type="number"
            value={ordemDraft}
            disabled={readOnly}
            onChange={(e) => setOrdemDraft(Number(e.target.value))}
            onBlur={async () => {
              if (ordemDraft !== trecho.ordem)
                await updTrecho.mutateAsync({ id: trecho.id, obra_id: obraId, ordem: ordemDraft })
            }}
            className="w-14"
          />
        </td>
        <td className="px-3 py-1.5">
          <Input
            value={nomeDraft}
            disabled={readOnly}
            onChange={(e) => setNomeDraft(e.target.value)}
            onBlur={async () => {
              const n = nomeDraft.trim()
              if (!n) return setNomeDraft(trecho.nome)
              if (n === trecho.nome) return
              try {
                await updTrecho.mutateAsync({ id: trecho.id, obra_id: obraId, nome: n })
              } catch (e) {
                toast.error('Falha ao renomear: ' + (e as Error).message)
                setNomeDraft(trecho.nome)
              }
            }}
          />
        </td>
        {ehEixo ? (
          <>
            <td className="px-3 py-1.5">
              <button
                type="button"
                onClick={onEditar}
                className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-2xs hover:border-accent hover:text-accent transition-colors whitespace-nowrap"
                title="Editar estaca inicial, final e unidade"
              >
                {comp > 0 ? (
                  <>
                    {estacaInicialTexto(trecho)} <span className="text-text-dim">→</span>{' '}
                    {estacaFinalTexto(trecho)}
                  </>
                ) : (
                  <span className="text-warn">definir estacas</span>
                )}
              </button>
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-text-muted">
              {comp > 0 ? `${formatNumber(comp, 0)} m` : '—'}
            </td>
            <td className="px-3 py-1.5 text-text-muted">
              <span
                title={`unidade: ${rotuloUnidadeTrecho(trecho.unidade_espaco_padrao, trecho.unidade_custom_label)}`}
              >
                {trecho.geometry_sentido === 'invertido' ? 'decrescente' : 'crescente'}
              </span>
            </td>
            <td className="px-3 py-1.5">
              <button
                type="button"
                disabled={readOnly && !comMapa}
                onClick={() => setMapaDialog(comMapa ? 'visualizar' : 'novo')}
                className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                style={comMapa ? { borderColor: trecho.cor, color: trecho.cor } : undefined}
                title={comMapa ? 'Ver mapa' : 'Vincular polilinha KML/KMZ (opcional)'}
              >
                {comMapa ? (
                  <>
                    <MapPinned size={11} />{' '}
                    {(Number(trecho.geometry_comprimento_m) / 1000).toFixed(1)} km
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-text-dim hover:text-accent">
                    <MapIcon size={11} /> opcional
                  </span>
                )}
              </button>
            </td>
          </>
        ) : null}
        <td className="px-3 py-1.5">
          <button
            type="button"
            disabled={ehEixo && comp <= 0}
            onClick={onQuantidades}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-2xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              nServ === 0
                ? 'border-dashed border-border text-text-dim hover:border-accent hover:text-accent'
                : ''
            }`}
            style={nServ > 0 ? { borderColor: trecho.cor, color: trecho.cor } : undefined}
            title={
              ehEixo && comp <= 0
                ? 'Defina as estacas do eixo antes'
                : nServ === 0
                  ? 'Informar as quantidades por serviço'
                  : `v${template!.numero} · ${nServ} serviço${nServ === 1 ? '' : 's'} · ${template!.segmentos.length} faixa${template!.segmentos.length === 1 ? '' : 's'}`
            }
          >
            <ClipboardList size={11} />
            {ehEixo && comp <= 0
              ? 'Sem estacas'
              : nServ === 0
                ? 'Sem quantidades'
                : `${nServ} serviço${nServ === 1 ? '' : 's'} · v${template!.numero}`}
          </button>
        </td>
        <td className="px-3 py-1.5 text-right whitespace-nowrap">
          {!readOnly ? (
            <>
              <IconButton size="sm" variant="ghost" aria-label="Editar local" onClick={onEditar}>
                <Pencil size={11} />
              </IconButton>
              <IconButton
                size="sm"
                variant="danger"
                aria-label="Remover local"
                onClick={() => void remover()}
              >
                <Trash2 size={11} />
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
