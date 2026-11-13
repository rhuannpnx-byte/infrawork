import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
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
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { contar } from '@/lib/rotulos'
import { useUpdateRecurso } from '../hooks/recursos'
import { RECURSO_GRUPO_LABEL, type Recurso, type RecursoGrupo } from '@/types/orcamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  recurso: Recurso | null
}

const GRUPOS: RecursoGrupo[] = ['MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM']

type CampoComErro = 'nome' | 'unidade' | 'grupo'

export function EditRecursoDialog({ open, onOpenChange, recurso }: Props): ReactNode {
  const update = useUpdateRecurso()
  const [grupo, setGrupo] = useState<RecursoGrupo>('MATERIAL')
  const [nome, setNome] = useState('')
  const [codigo, setCodigo] = useState('')
  const [unidade, setUnidade] = useState('')
  const [observacao, setObservacao] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [erroGrupo, setErroGrupo] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)
  const [conferindo, setConferindo] = useState(false)

  useEffect(() => {
    if (!recurso) return
    setGrupo(recurso.grupo)
    setNome(recurso.nome)
    setCodigo(recurso.codigo ?? '')
    setUnidade(recurso.unidade)
    setObservacao(recurso.observacao ?? '')
    setError(null)
    setErroGrupo(null)
    setTentou(false)
  }, [recurso, open])

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (nome.trim().length < 2) erros.nome = 'Informe o nome do recurso.'
  if (!unidade.trim()) erros.unidade = 'Informe a unidade, como h, L, m³ ou kg.'
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const focarInvalido = (form: HTMLFormElement): void => {
    requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!recurso) return
    const form = e.currentTarget
    setError(null)
    setErroGrupo(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      focarInvalido(form)
      return
    }
    try {
      if (grupo !== recurso.grupo) {
        // O grupo define em que bloco da composição o recurso entra; trocar
        // com uso em composições deixaria o cálculo incoerente.
        setConferindo(true)
        const { count } = await supabase
          .from('cpu_item')
          .select('id', { count: 'exact', head: true })
          .eq('recurso_id', recurso.id)
        setConferindo(false)
        if ((count ?? 0) > 0) {
          setErroGrupo(
            `Este recurso é usado em ${contar(count ?? 0, 'insumo', 'insumos')} de composição, por isso o grupo não pode ser trocado.`
          )
          focarInvalido(form)
          return
        }
      }
      await update.mutateAsync({
        id: recurso.id,
        grupo,
        nome: nome.trim(),
        codigo: codigo.trim() || null,
        unidade: unidade.trim(),
        observacao: observacao.trim() || null
      })
      toast.success('Recurso atualizado.')
      onOpenChange(false)
    } catch (err) {
      setConferindo(false)
      setError(
        `Não foi possível salvar o recurso. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  const gravando = update.isPending || conferindo

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={gravando}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Editar recurso</DialogTitle>
          <DialogDescription>
            O preço é alterado no histórico de preços, pelo ícone de relógio na lista.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Grupo" obrigatorio erro={erroGrupo}>
              <Select
                value={grupo}
                onChange={(e) => {
                  setGrupo(e.target.value as RecursoGrupo)
                  setErroGrupo(null)
                }}
              >
                {GRUPOS.map((g) => (
                  <option key={g} value={g}>
                    {RECURSO_GRUPO_LABEL[g]}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Unidade" obrigatorio erro={erro('unidade')}>
              <Input
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                autoComplete="off"
              />
            </Campo>
          </div>
          <Campo rotulo="Código" dica="Opcional.">
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="off" />
          </Campo>
          <Campo rotulo="Observação" dica="Opcional.">
            <Input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              autoComplete="off"
            />
          </Campo>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={gravando}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={gravando}>
            {gravando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
