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
import { parseBR } from '@/lib/money'
import { useCreateRecurso } from '../hooks/recursos'
import { RECURSO_GRUPO_LABEL, type RecursoGrupo } from '@/types/orcamento'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

const GRUPOS: RecursoGrupo[] = ['MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM']

/** Só algarismos, ponto e vírgula: o que o `parseBR` entende como número. */
const NUMERO = /^\d[\d.,]*$/

type CampoComErro = 'nome' | 'unidade' | 'preco'

export function NewRecursoDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const create = useCreateRecurso()
  const [grupo, setGrupo] = useState<RecursoGrupo>('MATERIAL')
  const [nome, setNome] = useState('')
  const [codigo, setCodigo] = useState('')
  const [unidade, setUnidade] = useState('')
  const [precoInicial, setPrecoInicial] = useState('')
  const [observacao, setObservacao] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const reset = (): void => {
    setGrupo('MATERIAL')
    setNome('')
    setCodigo('')
    setUnidade('')
    setPrecoInicial('')
    setObservacao('')
    setError(null)
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  const preco = precoInicial.trim() ? parseBR(precoInicial).toNumber() : undefined

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (nome.trim().length < 2) erros.nome = 'Informe o nome do recurso.'
  if (!unidade.trim()) erros.unidade = 'Informe a unidade, como h, L, m³ ou kg.'
  if (preco !== undefined && (!NUMERO.test(precoInicial.trim()) || isNaN(preco) || preco < 0))
    erros.preco = 'Digite o preço como um número, por exemplo 1.250,50.'
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
        grupo,
        nome: nome.trim(),
        codigo: codigo.trim() || undefined,
        unidade: unidade.trim(),
        observacao: observacao.trim() || undefined,
        preco_inicial: preco
      })
      toast.success(`Recurso "${nome}" criado.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(`Não foi possível criar o recurso. ${detalheDoErro(err) ?? 'Tente de novo.'}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={create.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Novo recurso</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              data-foco-inicial=""
              placeholder="Ex.: Diesel S10, Servente, Caminhão basculante 14 m³"
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Grupo" obrigatorio>
              <Select value={grupo} onChange={(e) => setGrupo(e.target.value as RecursoGrupo)}>
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
                placeholder="Ex.: h, L, m³, kg"
              />
            </Campo>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Código" dica="Opcional.">
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                autoComplete="off"
                placeholder="Ex.: SINAPI 87.412"
              />
            </Campo>
            <Campo
              rotulo="Preço inicial (R$ por unidade)"
              dica="Opcional. Pode ser informado depois, no histórico de preços."
              erro={erro('preco')}
            >
              <Input
                value={precoInicial}
                onChange={(e) => setPrecoInicial(e.target.value)}
                placeholder="Ex.: 6,40"
                inputMode="decimal"
                autoComplete="off"
                className="tabular text-right"
              />
            </Campo>
          </div>

          <Campo rotulo="Observação" dica="Opcional. Fonte do preço, contexto.">
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
            onClick={() => aoMudar(false)}
            disabled={create.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar recurso'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
