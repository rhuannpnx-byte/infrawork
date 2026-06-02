import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { parseBR } from '@/lib/money'
import { useUpsertItem } from '../hooks/plan-orc'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  parentId: string | null
  /** Pré-seleciona o tipo (etapa/receita). Não cria servico_grupo aqui — use o modal "Agrupar como serviço". */
  tipoInicial?: 'etapa' | 'receita'
}

export function NewItemOrcamentarioDialog({
  open,
  onOpenChange,
  obraId,
  parentId,
  tipoInicial
}: Props): ReactNode {
  const upsert = useUpsertItem()

  const [tipo, setTipo] = useState<'etapa' | 'receita'>(tipoInicial ?? 'receita')
  const [descricao, setDescricao] = useState('')
  const [unidade, setUnidade] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [vendaUnit, setVendaUnit] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setTipo(tipoInicial ?? 'receita')
    setDescricao('')
    setUnidade('')
    setQuantidade('')
    setVendaUnit('')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      if (tipo === 'receita') {
        // parseBR: remove separador de milhar (.) ANTES de trocar a vírgula.
        // O .replace(',', '.') ingênuo deixava "1.234,56" virar "1.234.56" → NaN/1.
        const qtd = parseBR(quantidade).toNumber()
        const venda = parseBR(vendaUnit).toNumber()
        if (!unidade.trim()) {
          setError('Unidade é obrigatória para receita.')
          return
        }
        if (!Number.isFinite(qtd) || qtd <= 0) {
          setError('Quantidade deve ser > 0.')
          return
        }
        if (!Number.isFinite(venda) || venda < 0) {
          setError('Venda unitária inválida.')
          return
        }
        await upsert.mutateAsync({
          obra_id: obraId,
          parent_id: parentId,
          tipo: 'receita',
          descricao: descricao.trim() || 'Sem descrição',
          unidade: unidade.trim(),
          quantidade: qtd,
          venda_unitaria: venda
        })
      } else {
        await upsert.mutateAsync({
          obra_id: obraId,
          parent_id: parentId,
          tipo: 'etapa',
          descricao: descricao.trim() || 'Sem descrição'
        })
      }

      toast.success(tipo === 'receita' ? 'Receita criada.' : 'Índice criado.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar item')
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
      disableDismiss={upsert.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Novo item</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div className="flex items-center gap-2 text-xs text-text-muted font-mono">
            Pai:{' '}
            {parentId ? (
              <span className="text-text">(item)</span>
            ) : (
              <span className="text-text">raiz</span>
            )}
          </div>

          <div>
            <Label>Tipo</Label>
            <div className="flex gap-2">
              {(['receita', 'etapa'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={
                    tipo === t
                      ? 'px-3 py-1 text-xs rounded bg-accent text-[color:var(--primary-foreground)] border border-accent-line'
                      : 'px-3 py-1 text-xs rounded border border-border-strong text-text-muted hover:text-text hover:bg-bg-hover'
                  }
                >
                  {t === 'receita' ? 'Receita (cobra cliente)' : 'Índice (estrutural)'}
                </button>
              ))}
            </div>
            <p className="text-2xs text-text-dim font-mono mt-1 leading-snug">
              {tipo === 'receita'
                ? 'Linha de receita: tem unidade + quantidade + venda unitária. Sem CPU/custo.'
                : 'Índice estrutural da EAP. Agrupa filhos sem cálculo próprio.'}
            </p>
            <p className="text-2xs text-text-dim font-mono mt-1 leading-snug">
              Para criar um <span className="text-accent">Grupo de Serviço</span> (com CPU + custo),
              selecione N receitas na planilha e use &ldquo;Agrupar como serviço&rdquo;.
            </p>
          </div>

          <div>
            <Label htmlFor="i-desc" className="block">
              Descrição
            </Label>
            <Input
              id="i-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              required
              autoFocus
              placeholder={tipo === 'etapa' ? 'Ex.: PAVIMENTAÇÃO' : 'Ex.: Aplicação CBUQ'}
            />
          </div>

          {tipo === 'receita' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="i-unid" className="block">
                    Unidade
                  </Label>
                  <Input
                    id="i-unid"
                    value={unidade}
                    onChange={(e) => setUnidade(e.target.value)}
                    required
                    placeholder="t, m³, m², km, VB"
                  />
                </div>
                <div>
                  <Label htmlFor="i-qtd" className="block">
                    Quantidade
                  </Label>
                  <Input
                    id="i-qtd"
                    value={quantidade}
                    onChange={(e) => setQuantidade(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="i-vu" className="block">
                  Venda unitária (R$) — já com BDI embutido
                </Label>
                <Input
                  id="i-vu"
                  value={vendaUnit}
                  onChange={(e) => setVendaUnit(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </div>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={upsert.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={upsert.isPending}>
            {upsert.isPending ? 'Criando…' : 'Criar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
