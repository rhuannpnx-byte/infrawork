import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Save, RotateCcw, Copy, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { nomeCategoria } from '@/types/documentacao'
import {
  derivarDocCategorias,
  type TemplateCampo,
  type CampoTipo,
  type CampoCardinalidade,
  type GrupoTemplate,
  type GrupoCardinalidade,
  type GrupoCriticidade
} from '@/types/documentacao-template'
import {
  useTemplate,
  useSalvarTemplate,
  useResetTemplate,
  useCopiarTemplate,
  useObrasComTemplate
} from '@/features/documentacao/hooks/template'

const TIPOS: CampoTipo[] = ['texto', 'data', 'moeda', 'numero', 'booleano', 'entidade', 'lista']
const CRITICIDADES: GrupoCriticidade[] = [
  'essencial',
  'recomendado',
  'condicional',
  'operacional',
  'final',
  'apoio'
]
type Aba = 'campos' | 'grupos'

interface Props {
  obraId: string
}

export function TemplateEditor({ obraId }: Props): ReactNode {
  const { data: template, isLoading } = useTemplate(obraId)
  const salvar = useSalvarTemplate()
  const reset = useResetTemplate()
  const copiar = useCopiarTemplate()
  const { data: obras } = useObrasComTemplate(obraId)

  const [aba, setAba] = useState<Aba>('grupos')
  const [campos, setCampos] = useState<TemplateCampo[] | null>(null)
  const [grupos, setGrupos] = useState<GrupoTemplate[] | null>(null)
  const [copiarDe, setCopiarDe] = useState('')
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set())

  const atuais = useMemo(() => campos ?? template?.campos ?? [], [campos, template])
  const gruposAtuais = useMemo(() => grupos ?? template?.grupos ?? [], [grupos, template])

  const porSecao = useMemo(() => {
    const map = new Map<string, TemplateCampo[]>()
    for (const c of [...atuais].sort((a, b) => a.ordem - b.ordem)) {
      const arr = map.get(c.secao) ?? []
      arr.push(c)
      map.set(c.secao, arr)
    }
    return Array.from(map.entries())
  }, [atuais])

  const mut = (chave: string, patch: Partial<TemplateCampo>): void =>
    setCampos(atuais.map((c) => (c.chave === chave ? { ...c, ...patch } : c)))

  const remover = (chave: string): void => setCampos(atuais.filter((c) => c.chave !== chave))

  const adicionar = (secao: string): void => {
    const nova: TemplateCampo = {
      chave: `campo_${Date.now()}`,
      secao,
      rotulo: 'Novo campo',
      pergunta: '',
      tipo: 'texto',
      cardinalidade: 'escalar',
      doc_categorias: [],
      alvo: 'campo_dossie',
      obrigatorio: false,
      validacoes: [],
      ordem: (atuais.reduce((m, c) => Math.max(m, c.ordem), 0) || 0) + 1
    }
    setCampos([...atuais, nova])
  }

  const mutG = (codigo: string, patch: Partial<GrupoTemplate>): void =>
    setGrupos(gruposAtuais.map((g) => (g.codigo === codigo ? { ...g, ...patch } : g)))

  const removerG = (codigo: string): void =>
    setGrupos(gruposAtuais.filter((g) => g.codigo !== codigo))

  const adicionarG = (): void => {
    const novo: GrupoTemplate = {
      codigo: `grupo_${Date.now()}`,
      nome: 'Novo grupo',
      tipo_codigo_base: '20',
      regras: '',
      contribuicao: '',
      campos_chaves: [],
      cardinalidade: 'multiplo',
      criticidade: 'apoio',
      vence: false,
      aplicavel_se: {},
      aliases: [],
      ordem: (gruposAtuais.reduce((m, g) => Math.max(m, g.ordem), 0) || 0) + 1
    }
    setGrupos([...gruposAtuais, novo])
  }

  const onSalvar = (): void => {
    if (!template) return
    // Grupo dita os campos: re-deriva doc_categorias dos campos a partir dos grupos
    // (mantém a âncora do resolver/consolidador em sincronia com campos_chaves).
    const camposFinais = derivarDocCategorias(atuais, gruposAtuais)
    salvar.mutate(
      {
        obra_id: obraId,
        campos: camposFinais,
        grupos: gruposAtuais,
        versao: template.versao
      },
      {
        onSuccess: () => {
          setCampos(null)
          setGrupos(null)
          toast.success('Template salvo. Vale para as próximas classificações/extrações.')
        },
        onError: (e) => toast.error(e.message)
      }
    )
  }

  const onReset = (): void =>
    reset.mutate(
      { obra_id: obraId },
      {
        onSuccess: () => {
          setCampos(null)
          setGrupos(null)
          toast.success('Template restaurado para o padrão.')
        }
      }
    )

  const onCopiar = (): void => {
    if (!copiarDe) return
    copiar.mutate(
      { de_obra_id: copiarDe, para_obra_id: obraId },
      {
        onSuccess: () => {
          setCampos(null)
          setGrupos(null)
          setCopiarDe('')
          toast.success('Template copiado da obra selecionada.')
        },
        onError: (e) => toast.error(e.message)
      }
    )
  }

  const toggleSecao = (s: string): void =>
    setColapsadas((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-2xs font-mono text-text-dim">
        Carregando template…
      </div>
    )
  }

  const dirty = campos != null || grupos != null

  return (
    <div className="h-full overflow-auto p-5 space-y-4 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSalvar} disabled={!dirty || salvar.isPending}>
          <Save size={13} /> Salvar
        </Button>
        {aba === 'campos' ? (
          <Button variant="ghost" onClick={() => adicionar(porSecao[0]?.[0] ?? 'Novos campos')}>
            <Plus size={13} /> Novo campo
          </Button>
        ) : (
          <Button variant="ghost" onClick={adicionarG}>
            <Plus size={13} /> Novo grupo
          </Button>
        )}
        <Button variant="ghost" onClick={onReset} disabled={reset.isPending}>
          <RotateCcw size={13} /> Restaurar padrão
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={copiarDe}
            onChange={(e) => setCopiarDe(e.target.value)}
            className="rounded border border-border bg-bg-panel px-2 py-1.5 text-xs text-text"
          >
            <option value="">Copiar de outra obra…</option>
            {(obras ?? []).map((o) => (
              <option key={o.obra_id} value={o.obra_id}>
                {o.codigo ? `${o.codigo} · ` : ''}
                {o.nome}
              </option>
            ))}
          </select>
          <Button variant="ghost" onClick={onCopiar} disabled={!copiarDe || copiar.isPending}>
            <Copy size={13} /> Copiar
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {(['grupos', 'campos'] as Aba[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium border-b-2 -mb-px',
              aba === a
                ? 'border-accent text-accent'
                : 'border-transparent text-text-dim hover:text-text'
            )}
          >
            {a === 'grupos' ? `Grupos · ${gruposAtuais.length}` : `Campos · ${atuais.length}`}
          </button>
        ))}
      </div>

      {aba === 'grupos' ? (
        <>
          <p className="text-2xs text-text-dim">
            <b>Grupos</b> definem como os documentos são classificados e o que cada um contribui
            para o contexto do contrato. As <b>regras</b> guiam a classificação automática. Grupos
            com <b>aplicável só se</b> aparecem conforme o perfil da obra (consórcio,
            público/privado).
          </p>
          <div className="rounded-lg border border-border divide-y divide-border/60">
            {[...gruposAtuais]
              .sort((a, b) => a.ordem - b.ordem)
              .map((g) => (
                <GrupoRow
                  key={g.codigo}
                  g={g}
                  campos={atuais}
                  onChange={(p) => mutG(g.codigo, p)}
                  onRemove={() => removerG(g.codigo)}
                />
              ))}
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={adicionarG}
                className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
              >
                <Plus size={11} /> Adicionar grupo
              </button>
            </div>
          </div>
        </>
      ) : null}

      {aba === 'campos' ? (
        <p className="text-2xs text-text-dim">
          Estrutura FIXA do que a IA extrai dos documentos — nada além destes campos é obtido. A{' '}
          <b>pergunta</b> guia a extração. Campos <b>incrementais</b> (aditivos, reajustes,
          licenças…) acumulam entre documentos.
        </p>
      ) : null}

      {aba === 'campos' &&
        porSecao.map(([secao, lista]) => {
          const col = colapsadas.has(secao)
          return (
            <div key={secao} className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSecao(secao)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-bg-panel border-b border-border text-xs font-semibold text-accent/90"
              >
                {col ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                {secao}
                <span className="text-2xs font-mono text-text-dim">· {lista.length}</span>
              </button>
              {!col ? (
                <div className="divide-y divide-border/60">
                  {lista.map((c) => (
                    <CampoRow
                      key={c.chave}
                      c={c}
                      onChange={(p) => mut(c.chave, p)}
                      onRemove={() => remover(c.chave)}
                    />
                  ))}
                  <div className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => adicionar(secao)}
                      className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
                    >
                      <Plus size={11} /> Adicionar campo nesta seção
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
    </div>
  )
}

function CampoRow({
  c,
  onChange,
  onRemove
}: {
  c: TemplateCampo
  onChange: (p: Partial<TemplateCampo>) => void
  onRemove: () => void
}): ReactNode {
  // Seção comita no blur (evita reagrupar a lista a cada tecla e perder o foco).
  const [secaoLocal, setSecaoLocal] = useState(c.secao)
  return (
    <div className="px-3 py-2.5 space-y-2 hover:bg-bg-hover/40">
      <div className="flex items-center gap-2">
        <input
          value={c.rotulo}
          onChange={(e) => onChange({ rotulo: e.target.value })}
          className="flex-1 rounded border border-border bg-bg px-2 py-1 text-xs font-medium text-text"
          placeholder="Rótulo"
        />
        <code className="text-[10px] font-mono text-text-dim">{c.chave}</code>
        <button
          type="button"
          onClick={onRemove}
          className="text-text-dim hover:text-danger"
          aria-label="Remover"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <textarea
        value={c.pergunta}
        onChange={(e) => onChange({ pergunta: e.target.value })}
        rows={2}
        className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text-muted resize-y"
        placeholder="Pergunta que buscamos responder nos documentos…"
      />
      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <label className="flex items-center gap-1">
          <span className="text-text-dim">Tipo</span>
          <select
            value={c.tipo}
            onChange={(e) => onChange({ tipo: e.target.value as CampoTipo })}
            className="rounded border border-border bg-bg-panel px-1.5 py-1 text-text"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-text-dim">Cardinalidade</span>
          <select
            value={c.cardinalidade}
            onChange={(e) => onChange({ cardinalidade: e.target.value as CampoCardinalidade })}
            className="rounded border border-border bg-bg-panel px-1.5 py-1 text-text"
          >
            <option value="escalar">escalar</option>
            <option value="incremental">incremental</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-text-dim">Seção</span>
          <input
            value={secaoLocal}
            onChange={(e) => setSecaoLocal(e.target.value)}
            onBlur={() => onChange({ secao: secaoLocal.trim() || 'Outros' })}
            className="w-32 rounded border border-border bg-bg-panel px-1.5 py-1 text-text"
            placeholder="Seção"
          />
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={c.obrigatorio}
            onChange={(e) => onChange({ obrigatorio: e.target.checked })}
          />
          <span className={c.obrigatorio ? 'text-warn font-medium' : 'text-text-dim'}>
            obrigatório
          </span>
        </label>
      </div>
      {c.doc_categorias.length ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[9px] text-text-dim/70">alimentado por (grupos →):</span>
          {c.doc_categorias.map((cat) => (
            <span
              key={cat}
              className={cn(
                'text-[9px] font-mono rounded px-1 py-0.5 bg-bg-panel text-text-dim border border-border/60'
              )}
            >
              {cat} {nomeCategoria(cat)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function GrupoRow({
  g,
  campos,
  onChange,
  onRemove
}: {
  g: GrupoTemplate
  campos: TemplateCampo[]
  onChange: (p: Partial<GrupoTemplate>) => void
  onRemove: () => void
}): ReactNode {
  const aliases = (g.aliases ?? []).join(', ')
  const chaves = new Set(g.campos_chaves ?? [])
  const toggleCampo = (chave: string): void => {
    const next = new Set(chaves)
    if (next.has(chave)) next.delete(chave)
    else next.add(chave)
    onChange({ campos_chaves: [...next] })
  }
  return (
    <div className="px-3 py-2.5 space-y-2 hover:bg-bg-hover/40">
      <div className="flex items-center gap-2">
        <input
          value={g.nome}
          onChange={(e) => onChange({ nome: e.target.value })}
          className="flex-1 rounded border border-border bg-bg px-2 py-1 text-xs font-medium text-text"
          placeholder="Nome do grupo"
        />
        <code className="text-[10px] font-mono text-text-dim">{g.codigo}</code>
        <button
          type="button"
          onClick={onRemove}
          className="text-text-dim hover:text-danger"
          aria-label="Remover"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <textarea
        value={g.regras ?? ''}
        onChange={(e) => onChange({ regras: e.target.value })}
        rows={2}
        className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text-muted resize-y"
        placeholder="Regras: o que pertence a este grupo (guia a classificação)…"
      />
      <textarea
        value={g.contribuicao ?? ''}
        onChange={(e) => onChange({ contribuicao: e.target.value })}
        rows={1}
        className="w-full rounded border border-border bg-bg px-2 py-1 text-2xs text-text-muted resize-y"
        placeholder="O que este grupo contribui para o contexto do contrato…"
      />
      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <label className="flex items-center gap-1">
          <span className="text-text-dim">Cat. base</span>
          <input
            value={g.tipo_codigo_base}
            onChange={(e) => onChange({ tipo_codigo_base: e.target.value.trim() || '20' })}
            className="w-14 rounded border border-border bg-bg-panel px-1.5 py-1 font-mono text-text"
            placeholder="20"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-text-dim">Cardinalidade</span>
          <select
            value={g.cardinalidade}
            onChange={(e) => onChange({ cardinalidade: e.target.value as GrupoCardinalidade })}
            className="rounded border border-border bg-bg-panel px-1.5 py-1 text-text"
          >
            <option value="unico">único</option>
            <option value="multiplo">múltiplo</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-text-dim">Criticidade</span>
          <select
            value={g.criticidade}
            onChange={(e) => onChange({ criticidade: e.target.value as GrupoCriticidade })}
            className="rounded border border-border bg-bg-panel px-1.5 py-1 text-text"
          >
            {CRITICIDADES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={g.vence ?? false}
            onChange={(e) => onChange({ vence: e.target.checked })}
          />
          <span className={g.vence ? 'text-warn font-medium' : 'text-text-dim'}>vence</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={g.aplicavel_se?.consorcio === true}
            onChange={(e) =>
              onChange({
                aplicavel_se: { ...g.aplicavel_se, consorcio: e.target.checked ? true : undefined }
              })
            }
          />
          <span className={g.aplicavel_se?.consorcio ? 'text-accent font-medium' : 'text-text-dim'}>
            só se consórcio
          </span>
        </label>
      </div>
      <label className="flex items-center gap-1 text-2xs">
        <span className="text-text-dim whitespace-nowrap">Dicas (aliases)</span>
        <input
          value={aliases}
          onChange={(e) =>
            onChange({
              aliases: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            })
          }
          className="flex-1 rounded border border-border bg-bg-panel px-1.5 py-1 text-text"
          placeholder="ofício, carta, comunicação…"
        />
      </label>
      <details className="text-2xs">
        <summary className="cursor-pointer text-text-dim hover:text-text">
          Campos que este grupo alimenta · <b className="text-accent">{chaves.size}</b>
        </summary>
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 pl-1">
          {[...campos]
            .sort((a, b) => a.ordem - b.ordem)
            .map((c) => (
              <label key={c.chave} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chaves.has(c.chave)}
                  onChange={() => toggleCampo(c.chave)}
                />
                <span className={chaves.has(c.chave) ? 'text-text' : 'text-text-dim'}>
                  {c.rotulo}
                </span>
                <code className="text-[9px] font-mono text-text-dim/70">{c.chave}</code>
              </label>
            ))}
          {!campos.length ? <span className="text-text-dim">Nenhum campo no template.</span> : null}
        </div>
      </details>
    </div>
  )
}
