import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { usePlanOrc, useReparentItem } from '../hooks/plan-orc'
import type { ItemTreeNode } from '@/types/orcamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** Item que será movido. */
  item: ItemTreeNode | null
}

/**
 * Junta todos os descendentes em um Set (incluindo o próprio).
 * Usado para impedir mover um item para dentro de si mesmo.
 */
function descendentes(node: ItemTreeNode, acc: Set<string> = new Set()): Set<string> {
  acc.add(node.id)
  for (const c of node.children) descendentes(c, acc)
  return acc
}

export function MoveItemDialog({ open, onOpenChange, obraId, item }: Props): ReactNode {
  const { data: plan } = usePlanOrc(obraId)
  const reparent = useReparentItem()
  const [novoPaiId, setNovoPaiId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const proibidos = useMemo(() => {
    if (!item) return new Set<string>()
    // Encontra o node correspondente na árvore para pegar descendentes
    const findNode = (nodes: ItemTreeNode[]): ItemTreeNode | null => {
      for (const n of nodes) {
        if (n.id === item.id) return n
        const inner = findNode(n.children)
        if (inner) return inner
      }
      return null
    }
    const node = findNode(plan?.tree ?? [])
    return node ? descendentes(node) : new Set([item.id])
  }, [item, plan])

  // Possíveis novos pais:
  //   - 'raiz' (parent_id = null) sempre
  //   - índices (etapas) da obra que NÃO são descendentes do item movido
  //   - servico_grupo aceita receita como filha (caso especial)
  const possiveisPais = useMemo(() => {
    if (!item) return []
    const todos = plan?.flat ?? []
    return todos.filter((n) => {
      if (proibidos.has(n.id)) return false
      // servico_grupo só aceita receita
      if (n.tipo === 'servico_grupo') return item.tipo === 'receita'
      // etapa aceita qualquer tipo
      if (n.tipo === 'etapa') return true
      // receita não tem filhos
      return false
    })
  }, [plan, item, proibidos])

  if (!item) return null

  const reset = (): void => {
    setNovoPaiId('')
    setError(null)
  }

  const onSubmit = async (): Promise<void> => {
    setError(null)
    const novo = novoPaiId === '__raiz__' ? null : novoPaiId || null
    if (novo === item.parent_id) {
      setError('Item já está sob este pai.')
      return
    }
    try {
      await reparent.mutateAsync({ id: item.id, obra_id: obraId, new_parent_id: novo })
      toast.success('Item movido.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao mover')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="md"
      disableDismiss={reparent.isPending}
    >
      <DialogHeader>
        <DialogTitle>Mover item</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        <div className="text-xs font-mono text-text-muted">
          Movendo: <span className="text-text">{item.codigo}</span>{' '}
          <span className="text-text">{item.descricao}</span>
        </div>

        <div>
          <Label htmlFor="m-pai" className="block">
            Novo pai
          </Label>
          <Select
            id="m-pai"
            value={novoPaiId}
            onChange={(e) => setNovoPaiId(e.target.value)}
            autoFocus
          >
            <option value="">— selecione —</option>
            <option value="__raiz__">↑ Mover para raiz</option>
            {possiveisPais.length > 0 ? (
              <optgroup label="Sob outro item">
                {possiveisPais.map((p) => (
                  <option key={p.id} value={p.id}>
                    {'  '.repeat(p.depth)}
                    {p.codigo} · {p.descricao}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
          <p className="text-2xs text-text-dim font-mono mt-1">
            Itens descendentes do que está sendo movido são ocultados (evita ciclo).
            {item.tipo === 'receita'
              ? ' Receita pode ser pendurada em índice ou em grupo de serviço.'
              : ' Índice e grupo de serviço só podem ir em índice ou raiz.'}
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={reparent.isPending}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={onSubmit}
          disabled={reparent.isPending || !novoPaiId}
        >
          {reparent.isPending ? 'Movendo…' : 'Mover'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
