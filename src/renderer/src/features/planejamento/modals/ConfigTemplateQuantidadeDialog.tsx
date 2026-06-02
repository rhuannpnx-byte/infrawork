// Cria template novo OU edita colunas da versão atual.
//
// Em modo create: pede nome + modo + colunas. Submeter cria template + versão v1.
// Em modo edit-colunas: nome e modo desabilitados (estáveis após criação).
// Mudar colunas zera segmentos+células da versão atual (avisado no UI).

import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Trash2, Plus } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  useCriarTemplateQuantidade,
  useEditarColunasVersaoAtual,
  useAgrupadoresOrcamento
} from '@/features/planejamento/hooks/quantidades'
import {
  type ModoQuantidade,
  type TrechoQuantidadeTemplate,
  type TrechoQuantidadeColuna
} from '@/types/quantidades'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  trechoId: string
  obraId: string
  /**
   * Modo 'create': cria novo template. Modo 'edit-colunas': edita colunas da
   * versão atual de um template existente (passa template + versao_id + colunas).
   */
  modo: 'create' | 'edit-colunas'
  template?: TrechoQuantidadeTemplate
  versaoId?: string
  colunasIniciais?: TrechoQuantidadeColuna[]
}

interface ColunaDraft {
  id?: string
  nome: string
  unidade: string
}

export function ConfigTemplateQuantidadeDialog({
  open,
  onOpenChange,
  trechoId,
  obraId,
  modo,
  template,
  versaoId,
  colunasIniciais
}: Props): ReactNode {
  const criar = useCriarTemplateQuantidade()
  const editarCols = useEditarColunasVersaoAtual()
  const { data: agrupadores = [], isFetching: loadingAgrup } =
    useAgrupadoresOrcamento(obraId)
  const isEdit = modo === 'edit-colunas'

  const [nome, setNome] = useState(template?.nome ?? '')
  const [modoTpl, setModoTpl] = useState<ModoQuantidade>(template?.modo ?? 'analitico')
  const [colunas, setColunas] = useState<ColunaDraft[]>(
    colunasIniciais && colunasIniciais.length > 0
      ? colunasIniciais.map((c) => ({ id: c.id, nome: c.nome, unidade: c.unidade }))
      : []
  )
  const [error, setError] = useState<string | null>(null)

  function carregarDefaults(): void {
    if (agrupadores.length === 0) {
      toast.info('Nenhum agrupador encontrado na planilha orçamentária da obra.')
      return
    }
    setColunas(
      agrupadores.map((a) => ({
        nome: `${a.codigo} ${a.descricao}`.trim(),
        unidade: a.unidade
      }))
    )
  }

  function addColuna(): void {
    setColunas((cs) => [...cs, { nome: '', unidade: '' }])
  }

  function removerColuna(idx: number): void {
    setColunas((cs) => cs.filter((_, i) => i !== idx))
  }

  function updateColuna(idx: number, patch: Partial<ColunaDraft>): void {
    setColunas((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    const colsLimpas = colunas
      .map((c) => ({ id: c.id, nome: c.nome.trim(), unidade: c.unidade.trim() }))
      .filter((c) => c.nome.length > 0 && c.unidade.length > 0)

    if (colsLimpas.length === 0) {
      setError('Adicione pelo menos uma coluna com nome e unidade.')
      return
    }
    const nomes = new Set<string>()
    for (const c of colsLimpas) {
      const k = c.nome.toLowerCase()
      if (nomes.has(k)) {
        setError(`Coluna "${c.nome}" duplicada — nomes devem ser únicos.`)
        return
      }
      nomes.add(k)
    }

    try {
      if (isEdit) {
        if (!versaoId) return
        await editarCols.mutateAsync({
          versao_id: versaoId,
          template_id: template!.id,
          colunas: colsLimpas
        })
        toast.success('Colunas atualizadas.')
      } else {
        if (!nome.trim()) {
          setError('Informe o nome do template.')
          return
        }
        await criar.mutateAsync({
          trecho_id: trechoId,
          nome: nome.trim(),
          modo: modoTpl,
          colunas: colsLimpas
        })
        toast.success('Template criado.')
      }
      onOpenChange(false)
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('uq_tqt_trecho_nome') || msg.includes('duplicate key')) {
        setError(`Já existe template chamado "${nome.trim()}" neste trecho.`)
      } else {
        setError(msg)
      }
    }
  }

  const pending = criar.isPending || editarCols.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" disableDismiss={pending}>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Editar colunas — ${template?.nome ?? ''}`
              : 'Novo template de quantidades'}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          {isEdit ? (
            <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-2xs font-mono text-warning">
              Remover uma coluna apaga as células daquela coluna. Renomear, alterar unidade e
              reordenar preservam os dados existentes. Se quiser guardar a versão atual antes
              de mexer, crie uma <strong>nova versão</strong> a partir do Histórico.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tpl-nome">Nome</Label>
              <Input
                id="tpl-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                disabled={isEdit}
                placeholder="Ex: Volumes de terraplanagem"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="tpl-modo">Modo</Label>
              <Select
                id="tpl-modo"
                value={modoTpl}
                onChange={(e) => setModoTpl(e.target.value as ModoQuantidade)}
                disabled={isEdit}
              >
                <option value="analitico">
                  Analítico (1 linha por unidade mínima)
                </option>
                <option value="simplificado">
                  Simplificado (faixas livres, distribui na grade)
                </option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Colunas</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={carregarDefaults}
                  disabled={pending || loadingAgrup}
                  title="Carrega os agrupadores (servico_grupo) da planilha orçamentária da obra"
                >
                  {loadingAgrup
                    ? 'Carregando…'
                    : `Carregar do orçamento${agrupadores.length > 0 ? ` (${agrupadores.length})` : ''}`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addColuna}
                  disabled={pending}
                >
                  <Plus size={11} /> Adicionar coluna
                </Button>
              </div>
            </div>
            {colunas.length === 0 ? (
              <div className="text-2xs text-text-dim italic p-3 border border-dashed border-border rounded">
                Sem colunas ainda. Use &quot;Carregar do orçamento&quot; pra puxar os
                agrupadores da planilha ou &quot;Adicionar coluna&quot; pra criar manual.
              </div>
            ) : (
              <div className="space-y-1.5">
                {colunas.map((c, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_120px_auto] gap-2 items-center">
                    <Input
                      value={c.nome}
                      onChange={(e) => updateColuna(idx, { nome: e.target.value })}
                      placeholder="Nome (ex: Escavação Corte)"
                      disabled={pending}
                    />
                    <Input
                      value={c.unidade}
                      onChange={(e) => updateColuna(idx, { unidade: e.target.value })}
                      placeholder="Unidade (ex: m³)"
                      disabled={pending}
                    />
                    <IconButton
                      type="button"
                      size="sm"
                      variant="danger"
                      aria-label="Remover coluna"
                      onClick={() => removerColuna(idx)}
                      disabled={pending}
                    >
                      <Trash2 size={11} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" size="sm" disabled={pending}>
            {pending ? 'Salvando…' : isEdit ? 'Salvar colunas' : 'Criar template'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
