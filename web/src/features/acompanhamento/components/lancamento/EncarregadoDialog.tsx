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
import type { Encarregado } from '@/types/acompanhamento'
import { useCreateEncarregado, useEncarregados, useUpdateEncarregado } from '../../hooks/lancamento'
import { useEquipes, useVincularEquipesEncarregado } from '@/features/planejamento/hooks/equipes'
import { useAuthStore } from '@/stores/auth-store'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** Quando informado, edita; senão cria. */
  encarregado?: Encarregado | null
  onCreated?: (e: Encarregado) => void
}

export function EncarregadoDialog({
  open,
  onOpenChange,
  obraId,
  encarregado = null,
  onCreated
}: Props): ReactNode {
  // O formulário só monta com o diálogo aberto: o estado inicial vem das props
  // a cada abertura, sem efeito de sincronização.
  if (!open) return null
  return (
    <FormDialog
      onOpenChange={onOpenChange}
      obraId={obraId}
      encarregado={encarregado}
      onCreated={onCreated}
    />
  )
}

function FormDialog({
  onOpenChange,
  obraId,
  encarregado,
  onCreated
}: Omit<Props, 'open'>): ReactNode {
  const create = useCreateEncarregado()
  const update = useUpdateEncarregado()
  const [nome, setNome] = useState(encarregado?.nome ?? '')
  const [apelido, setApelido] = useState(encarregado?.apelido ?? '')
  const [telefone, setTelefone] = useState(encarregado?.telefone ?? '')
  const [ativo, setAtivo] = useState(encarregado?.ativo ?? true)
  const [error, setError] = useState<string | null>(null)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const podeVincular = role === 'god' || role === 'adm' || role === 'engenheiro'
  const vincular = useVincularEquipesEncarregado()
  const { data: equipes = [], isSuccess: equipesProntas } = useEquipes(obraId)
  const { data: todos = [] } = useEncarregados(obraId, true)
  const [marcadas, setMarcadas] = useState<Set<string> | null>(null)
  const daquele = encarregado ? equipes.filter((q) => q.encarregado_id === encarregado.id) : []
  const selecionadas = marcadas ?? new Set(daquele.map((q) => q.id))
  const nomeEnc = new Map(todos.map((en) => [en.id, en.nome]))
  const pending = create.isPending || update.isPending || vincular.isPending

  const alternar = (id: string): void => {
    const s = new Set(selecionadas)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setMarcadas(s)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (nome.trim().length < 2) {
      setError('Informe o nome.')
      return
    }
    try {
      let id: string
      if (encarregado) {
        await update.mutateAsync({ id: encarregado.id, nome, apelido, telefone, ativo })
        id = encarregado.id
      } else {
        const novo = await create.mutateAsync({ obra_id: obraId, nome, apelido, telefone })
        id = novo.id
        onCreated?.(novo)
      }
      if (podeVincular && marcadas) {
        await vincular.mutateAsync({
          obra_id: obraId,
          encarregado_id: id,
          equipe_ids: [...marcadas]
        })
      }
      toast.success(
        encarregado ? 'Encarregado atualizado.' : `Encarregado "${nome.trim()}" criado.`
      )
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar'
      setError(
        /duplicate|unique/i.test(msg) ? 'Já existe um encarregado com esse nome nesta obra.' : msg
      )
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange} size="sm" disableDismiss={pending} topmost>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>{encarregado ? 'Editar encarregado' : 'Novo encarregado'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div>
            <Label htmlFor="enc-nome">Nome</Label>
            <Input
              id="enc-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              autoFocus
              placeholder="Ex.: João da Silva"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="enc-apelido">Apelido</Label>
              <Input
                id="enc-apelido"
                value={apelido}
                onChange={(e) => setApelido(e.target.value)}
                placeholder="opcional"
              />
            </div>
            <div>
              <Label htmlFor="enc-tel">Telefone</Label>
              <Input
                id="enc-tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                inputMode="tel"
                placeholder="(xx) xxxxx-xxxx"
              />
            </div>
          </div>
          {podeVincular && equipesProntas ? (
            <div>
              <Label>Equipes</Label>
              {equipes.length === 0 ? (
                <p className="text-2xs text-text-dim">Nenhuma equipe ativa na obra.</p>
              ) : (
                <div
                  className="max-h-44 overflow-auto rounded border border-border divide-y divide-border"
                  data-testid="enc-equipes"
                >
                  {equipes.map((q) => {
                    const outro =
                      q.encarregado_id && q.encarregado_id !== encarregado?.id
                        ? nomeEnc.get(q.encarregado_id)
                        : null
                    return (
                      <label
                        key={q.id}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs text-text cursor-pointer hover:bg-bg-hover"
                      >
                        <input
                          type="checkbox"
                          checked={selecionadas.has(q.id)}
                          onChange={() => alternar(q.id)}
                          className="accent-[var(--accent)]"
                        />
                        <span className="w-2 h-2 rounded-sm" style={{ background: q.cor }} />
                        <span className="flex-1 truncate">{q.nome}</span>
                        {outro && !selecionadas.has(q.id) ? (
                          <span className="text-2xs text-text-dim">com {outro}</span>
                        ) : null}
                        {outro && selecionadas.has(q.id) ? (
                          <span className="text-2xs text-warn">sai de {outro}</span>
                        ) : null}
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="mt-1 text-2xs text-text-dim">
                No app de campo, depois de escolher o encarregado aparecem só as equipes dele.
              </p>
            </div>
          ) : null}
          {encarregado ? (
            <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
              <input
                type="checkbox"
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Ativo (aparece nas listas de lançamento)
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : encarregado ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
