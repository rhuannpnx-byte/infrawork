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
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EQUIPE_TIPOS, EQUIPE_CORES_PADRAO } from '@/types/planejamento'
import { useCreateEquipe } from '../hooks/equipes'
import { useEncarregados } from '@/features/acompanhamento/hooks/lancamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

type CampoComErro = 'nome' | 'tipo'

export function NewEquipeDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const create = useCreateEquipe()
  const { data: encarregados = [] } = useEncarregados(obraId, true)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<string>(EQUIPE_TIPOS[0])
  const [tipoCustom, setTipoCustom] = useState('')
  const [cor, setCor] = useState<string>(EQUIPE_CORES_PADRAO[0])
  const [encarregadoId, setEncarregadoId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const reset = (): void => {
    setNome('')
    setTipo(EQUIPE_TIPOS[0])
    setTipoCustom('')
    setCor(EQUIPE_CORES_PADRAO[0])
    setEncarregadoId('')
    setError(null)
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  const tipoFinal = tipo === '__custom' ? tipoCustom : tipo

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
      await create.mutateAsync({
        obra_id: obraId,
        nome: nome.trim(),
        tipo: tipoFinal.trim(),
        cor,
        encarregado_id: encarregadoId || null
      })
      toast.success(`Equipe "${nome}" criada.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível criar a equipe. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={create.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Nova equipe</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              autoFocus
              placeholder="Ex.: Pavimentação 01"
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
              {EQUIPE_CORES_PADRAO.map((c, i) => (
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
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => aoMudar(false)}
            disabled={create.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar equipe'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
