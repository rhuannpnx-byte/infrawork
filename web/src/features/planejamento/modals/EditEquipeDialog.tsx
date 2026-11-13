import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EQUIPE_TIPOS, EQUIPE_CORES_PADRAO, type Equipe } from '@/types/planejamento'
import { useUpdateEquipe, useDeleteEquipe } from '../hooks/equipes'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useEncarregados } from '@/features/acompanhamento/hooks/lancamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  equipe: Equipe | null
}

type CampoComErro = 'nome' | 'tipo'

export function EditEquipeDialog({ open, onOpenChange, equipe }: Props): ReactNode {
  const update = useUpdateEquipe()
  const del = useDeleteEquipe()
  const confirm = useConfirm()
  const { data: encarregados = [] } = useEncarregados(equipe?.obra_id, true)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('')
  const [tipoCustom, setTipoCustom] = useState('')
  const [cor, setCor] = useState(EQUIPE_CORES_PADRAO[0])
  const [ativo, setAtivo] = useState(true)
  const [encarregadoId, setEncarregadoId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  useEffect(() => {
    if (equipe && open) {
      setNome(equipe.nome)
      const isPadrao = (EQUIPE_TIPOS as readonly string[]).includes(equipe.tipo)
      setTipo(isPadrao ? equipe.tipo : '__custom')
      setTipoCustom(isPadrao ? '' : equipe.tipo)
      setCor(equipe.cor)
      setAtivo(equipe.ativo)
      setEncarregadoId(equipe.encarregado_id ?? '')
      setError(null)
      setTentou(false)
    }
  }, [equipe, open])

  if (!equipe) return null

  const tipoFinal = tipo === '__custom' ? tipoCustom : tipo
  const gravando = update.isPending || del.isPending
  // a cor gravada pode não estar entre as padrão: continua aparecendo como opção
  const cores = EQUIPE_CORES_PADRAO.includes(cor)
    ? EQUIPE_CORES_PADRAO
    : [cor, ...EQUIPE_CORES_PADRAO]

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (nome.trim().length < 2) erros.nome = 'Informe o nome da equipe.'
  if (!tipoFinal.trim()) erros.tipo = 'Informe o tipo da equipe.'
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await update.mutateAsync({
        id: equipe.id,
        obra_id: equipe.obra_id,
        nome: nome.trim(),
        tipo: tipoFinal.trim(),
        cor,
        ativo,
        encarregado_id: encarregadoId || null
      })
      toast.success('Equipe atualizada.')
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível salvar a equipe. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  const onDelete = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Excluir equipe?',
      description: `A equipe "${equipe.nome}" é apagada e não dá para desfazer. As alocações dela no cronograma ficam sem equipe. Para só tirá-la de uso, desmarque "Equipe ativa".`,
      confirmLabel: 'Excluir equipe',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await del.mutateAsync({ id: equipe.id, obra_id: equipe.obra_id })
      toast.success('Equipe excluída.')
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível excluir a equipe. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={gravando}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Editar equipe</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              data-foco-inicial
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Tipo" obrigatorio>
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {EQUIPE_TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="__custom">Outro…</option>
              </Select>
            </Campo>
            {tipo === '__custom' ? (
              <Campo rotulo="Qual tipo?" obrigatorio erro={erro('tipo')}>
                <Input
                  value={tipoCustom}
                  onChange={(e) => setTipoCustom(e.target.value)}
                  autoComplete="off"
                  placeholder="Ex.: Obras de arte"
                />
              </Campo>
            ) : null}
          </div>

          <Campo
            rotulo="Encarregado"
            dica="Opcional. No app de campo, a equipe aparece para o encarregado escolhido."
          >
            <Select value={encarregadoId} onChange={(e) => setEncarregadoId(e.target.value)}>
              <option value="">Sem encarregado</option>
              {encarregados
                .filter((en) => en.ativo || en.id === encarregadoId)
                .map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.apelido ? `${en.nome} (${en.apelido})` : en.nome}
                    {en.ativo ? '' : ' (inativo)'}
                  </option>
                ))}
            </Select>
          </Campo>

          <div className="flex flex-col gap-1">
            <span id="eq-cor-rotulo" className="text-sm font-medium text-text">
              Cor no cronograma
            </span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="eq-cor-rotulo">
              {cores.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cor === c}
                  aria-label={`Cor ${i + 1}`}
                  onClick={() => setCor(c)}
                  className={cn(
                    'h-7 w-7 rounded border-2',
                    cor === c ? 'border-text' : 'border-border-strong'
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Equipe ativa
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="danger" onClick={onDelete} disabled={gravando}>
            {del.isPending ? 'Excluindo…' : 'Excluir equipe'}
          </Button>
          <div className="flex-1" />
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={gravando}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={gravando}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
