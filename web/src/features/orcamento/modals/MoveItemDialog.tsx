import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Campo } from '@/components/ui/campo'
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
  const [tentou, setTentou] = useState(false)

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
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  const novo = novoPaiId === '__raiz__' ? null : novoPaiId || null
  const erroDestino = !novoPaiId
    ? 'Escolha para onde mover o item.'
    : novo === item.parent_id
      ? 'O item já está nesse lugar. Escolha outro destino.'
      : undefined

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (erroDestino) {
      setTentou(true)
      e.currentTarget.querySelector<HTMLElement>('select')?.focus()
      return
    }
    try {
      await reparent.mutateAsync({ id: item.id, obra_id: obraId, new_parent_id: novo })
      toast.success('Item movido.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível mover o item. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={reparent.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Mover item</DialogTitle>
          <DialogDescription>
            {item.codigo} {item.descricao}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <Campo
            rotulo="Mover para"
            obrigatorio
            erro={tentou ? erroDestino : undefined}
            dica={
              (item.tipo === 'receita'
                ? 'Uma receita pode ficar dentro de um índice ou de um serviço.'
                : 'Índice e serviço só podem ficar dentro de um índice ou na raiz.') +
              ' Os itens que estão dentro deste não aparecem na lista.'
            }
          >
            <Select value={novoPaiId} onChange={(e) => setNovoPaiId(e.target.value)} autoFocus>
              <option value="">Selecione…</option>
              <option value="__raiz__">Raiz da planilha</option>
              {possiveisPais.length > 0 ? (
                <optgroup label="Dentro de outro item">
                  {possiveisPais.map((p) => (
                    <option key={p.id} value={p.id}>
                      {'  '.repeat(p.depth)}
                      {p.codigo} · {p.descricao}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Campo>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => aoMudar(false)}
            disabled={reparent.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={reparent.isPending}>
            {reparent.isPending ? 'Movendo…' : 'Mover item'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
