import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Map as MapIcon, MapPinned } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Popover } from '@/components/ui/popover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import {
  useObraTrechos,
  useCreateTrecho,
  useUpdateTrecho,
  useDeleteTrecho
} from '@/features/planejamento/hooks/trechos'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { ImportarKmlTrechoDialog } from '@/features/planejamento/modals/ImportarKmlTrechoDialog'
import { VisualizarMapaTrechoDialog } from '@/features/planejamento/modals/VisualizarMapaTrechoDialog'
import { QuantidadesTrechoDialog } from '@/features/planejamento/modals/QuantidadesTrechoDialog'
import { useTemplatesQuantidade } from '@/features/planejamento/hooks/quantidades'
import { useObra } from '@/features/gerencial/hooks'
import { ClipboardList } from 'lucide-react'
import {
  TRECHO_CORES_PADRAO,
  type ObraTrecho,
  type UnidadeEspacoPadrao
} from '@/types/gerencial'

export function PlanejamentoTrechosPage(): ReactNode {
  return (
    <RequireObra pageTitle="Trechos">
      <TrechosInner />
    </RequireObra>
  )
}

function TrechosInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnly = role === 'apoio'

  const { data: trechos = [] } = useObraTrechos(obraId)
  const createTrecho = useCreateTrecho()
  const confirm = useConfirm()

  const [novoNome, setNovoNome] = useState('')
  const [novaUnidade, setNovaUnidade] = useState<UnidadeEspacoPadrao>('km')

  const proxOrdem =
    trechos.length === 0 ? 0 : Math.max(...trechos.map((t) => t.ordem)) + 1

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Trechos"
        subtitle={`${scope.obra?.nome ?? ''} — segmentos com estaqueamento independente. Cada tarefa pertence a um trecho.`}
      />
      <div className="flex-1 overflow-auto">
        <div className="px-4 py-4">
          <div className="rounded border border-border bg-bg-panel">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div className="text-2xs font-mono text-text-dim uppercase">
                Trechos desta obra
              </div>
              <div className="text-2xs text-text-dim font-mono">
                1 trecho = 1 estaqueamento independente · obras com BR-060 + BR-452 tem 2 trechos
              </div>
            </div>

            {!readOnly ? (
              <div className="grid grid-cols-[1fr_140px_auto] gap-2 p-3 border-b border-border bg-bg/40">
                <Input
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Nome do trecho (ex: BR-060)"
                />
                <Select
                  value={novaUnidade}
                  onChange={(e) =>
                    setNovaUnidade(e.target.value as UnidadeEspacoPadrao)
                  }
                >
                  <option value="km">km</option>
                  <option value="m">m</option>
                  <option value="estaca">estaca</option>
                </Select>
                <Button
                  size="sm"
                  variant="default"
                  disabled={!novoNome.trim() || createTrecho.isPending}
                  onClick={async () => {
                    try {
                      await createTrecho.mutateAsync({
                        obra_id: obraId,
                        nome: novoNome.trim(),
                        ordem: proxOrdem,
                        unidade_espaco_padrao: novaUnidade
                      })
                      setNovoNome('')
                      toast.success('Trecho criado.')
                    } catch (e) {
                      const msg = (e as Error).message
                      if (
                        msg.includes('uq_obra_trecho_obra_nome') ||
                        msg.includes('duplicate key')
                      ) {
                        toast.error(
                          'Já existe um trecho com esse nome nesta obra.'
                        )
                      } else {
                        toast.error('Falha ao criar trecho: ' + msg)
                      }
                    }
                  }}
                >
                  <Plus size={11} /> Adicionar
                </Button>
              </div>
            ) : null}

            {trechos.length === 0 ? (
              <div className="p-4 text-2xs text-text-dim italic">
                Nenhum trecho ainda — toda obra precisa de pelo menos um pra
                criar tarefas.
              </div>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead className="text-text-dim uppercase text-2xs">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-1.5 w-12">Cor</th>
                    <th className="text-left px-3 py-1.5 w-16">Ordem</th>
                    <th className="text-left px-3 py-1.5">Nome</th>
                    <th className="text-left px-3 py-1.5 w-24">Unidade</th>
                    <th className="text-left px-3 py-1.5 w-[120px]">Mapa</th>
                    <th className="text-left px-3 py-1.5 w-[120px]">Quantidades</th>
                    <th className="px-3 py-1.5 w-12" />
                  </tr>
                </thead>
                <tbody>
                  {trechos.map((t) => (
                    <TrechoRow
                      key={t.id}
                      trecho={t}
                      obraId={obraId}
                      readOnly={readOnly}
                      confirm={confirm}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TrechoRow({
  trecho,
  obraId,
  readOnly,
  confirm
}: {
  trecho: ObraTrecho
  obraId: string
  readOnly: boolean
  confirm: ReturnType<typeof useConfirm>
}): ReactNode {
  const updTrecho = useUpdateTrecho()
  const delTrecho = useDeleteTrecho()

  const [nomeDraft, setNomeDraft] = useState(trecho.nome)
  const [ordemDraft, setOrdemDraft] = useState(trecho.ordem)
  const [corOpen, setCorOpen] = useState(false)
  const [mapaDialog, setMapaDialog] = useState<
    null | 'visualizar' | 'novo' | 'trocar' | 'editar'
  >(null)
  const [quantidadesOpen, setQuantidadesOpen] = useState(false)

  const temGeometria =
    !!trecho.geometry_geojson && trecho.geometry_geojson.coordinates.length >= 2

  const { data: templates = [] } = useTemplatesQuantidade(temGeometria ? trecho.id : null)
  const { data: obra } = useObra(obraId)
  const empresaNome = obra?.empresa?.nome ?? ''
  const obraCodigo = obra?.codigo ?? ''
  const obraNome = obra?.nome ?? ''

  return (
    <>
      <tr className="border-b border-border/40">
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
              aria-label={`Cor do trecho ${trecho.nome}`}
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
                  if (c !== trecho.cor) {
                    try {
                      await updTrecho.mutateAsync({
                        id: trecho.id,
                        obra_id: obraId,
                        cor: c
                      })
                    } catch (e) {
                      toast.error('Falha ao mudar cor: ' + (e as Error).message)
                    }
                  }
                }}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                  c === trecho.cor ? 'border-text' : 'border-border'
                }`}
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
            if (ordemDraft !== trecho.ordem) {
              await updTrecho.mutateAsync({
                id: trecho.id,
                obra_id: obraId,
                ordem: ordemDraft
              })
            }
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
            const novo = nomeDraft.trim()
            if (novo && novo !== trecho.nome) {
              try {
                await updTrecho.mutateAsync({
                  id: trecho.id,
                  obra_id: obraId,
                  nome: novo
                })
              } catch (e) {
                toast.error('Falha ao renomear: ' + (e as Error).message)
                setNomeDraft(trecho.nome)
              }
            } else if (!novo) {
              setNomeDraft(trecho.nome)
            }
          }}
        />
      </td>
      <td className="px-3 py-1.5">
        <Select
          value={trecho.unidade_espaco_padrao}
          disabled={readOnly || trecho.unidade_espaco_padrao === 'custom'}
          title={
            trecho.unidade_espaco_padrao === 'custom'
              ? `Unidade personalizada (${trecho.unidade_custom_label} a cada ${trecho.unidade_custom_divisor_m} m). Edite via "Mapa".`
              : undefined
          }
          onChange={async (e) => {
            const v = e.target.value as UnidadeEspacoPadrao
            if (v === 'custom') return // 'custom' só pelo wizard
            await updTrecho.mutateAsync({
              id: trecho.id,
              obra_id: obraId,
              unidade_espaco_padrao: v,
              unidade_custom_label: null,
              unidade_custom_divisor_m: null
            })
          }}
        >
          <option value="km">km</option>
          <option value="m">m</option>
          <option value="estaca">estaca</option>
          {trecho.unidade_espaco_padrao === 'custom' ? (
            <option value="custom">
              {trecho.unidade_custom_label} ({trecho.unidade_custom_divisor_m} m)
            </option>
          ) : null}
        </Select>
      </td>
      <td className="px-3 py-1.5">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setMapaDialog(temGeometria ? 'visualizar' : 'novo')}
          className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
          style={
            temGeometria
              ? { borderColor: trecho.cor, color: trecho.cor }
              : undefined
          }
          title={
            temGeometria
              ? `Ver mapa · ${(Number(trecho.geometry_comprimento_m) / 1000).toFixed(2)} km`
              : 'Vincular polilinha KMZ/KML'
          }
        >
          {temGeometria ? (
            <>
              <MapPinned size={11} />
              {(Number(trecho.geometry_comprimento_m) / 1000).toFixed(1)} km
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-text-dim hover:text-accent">
              <MapIcon size={11} /> Sem mapa
            </span>
          )}
        </button>
      </td>
      <td className="px-3 py-1.5">
        <button
          type="button"
          disabled={!temGeometria}
          onClick={() => setQuantidadesOpen(true)}
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-2xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border ${
            templates.length === 0 && temGeometria
              ? 'border-dashed border-border text-text-dim hover:border-accent hover:text-accent'
              : ''
          }`}
          style={
            templates.length > 0
              ? { borderColor: trecho.cor, color: trecho.cor }
              : undefined
          }
          title={
            !temGeometria
              ? 'Vincule um mapa antes'
              : templates.length === 0
                ? 'Adicionar template de quantidades'
                : `Gerenciar quantidades · ${templates.length} template${
                    templates.length === 1 ? '' : 's'
                  }`
          }
        >
          <ClipboardList size={11} />
          {!temGeometria
            ? 'Sem mapa'
            : templates.length === 0
              ? 'Sem templates'
              : `${templates.length} template${templates.length === 1 ? '' : 's'}`}
        </button>
      </td>
      <td className="px-3 py-1.5 text-right">
        {!readOnly ? (
          <IconButton
            size="sm"
            variant="danger"
            aria-label="Remover trecho"
            onClick={async () => {
              const ok = await confirm({
                title: `Remover trecho "${trecho.nome}"?`,
                description:
                  'Tarefas vinculadas a este trecho impedem a remoção (proteção FK).',
                confirmLabel: 'Remover',
                variant: 'danger'
              })
              if (!ok) return
              try {
                await delTrecho.mutateAsync({ id: trecho.id, obra_id: obraId })
                toast.success('Trecho removido.')
              } catch (e) {
                const msg = (e as Error).message
                if (
                  msg.includes('23503') ||
                  msg.includes('foreign key') ||
                  msg.includes('fk_plan_tarefa_trecho')
                ) {
                  toast.error(
                    'Trecho em uso: tarefas referenciam este trecho. Remapeie as tarefas antes de deletar.'
                  )
                } else {
                  toast.error('Falha ao remover: ' + msg)
                }
              }
            }}
          >
            <Trash2 size={11} />
          </IconButton>
        ) : null}
      </td>
      </tr>
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
        modo={
          mapaDialog === 'editar' ? 'editar' : mapaDialog === 'trocar' ? 'trocar' : 'novo'
        }
      />
      {quantidadesOpen ? (
        <QuantidadesTrechoDialog
          open={quantidadesOpen}
          onOpenChange={setQuantidadesOpen}
          trecho={trecho}
          empresaNome={empresaNome}
          obraCodigo={obraCodigo}
          obraNome={obraNome}
        />
      ) : null}
    </>
  )
}
