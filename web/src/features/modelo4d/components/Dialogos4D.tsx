import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Copy, Download, Upload } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'
import type { ObraTrecho } from '@/types/gerencial'
import {
  useImportarModelo4D,
  useVincularModelo4D,
  type ModeloRegistro,
  type ServicoDaObra,
  type VinculosGravados
} from '../hooks/modelo4d'
import { lerModelo } from '../lib/arquivo'
import type { Modelo4D } from '../lib/contrato'
import { prepararModelo, resumirModelo, type ResumoModelo } from '../lib/preparar'
import { sugerirVinculos } from '../lib/prompt'
import { paraGravar, VinculosForm, type VinculosEdicao } from './VinculosForm'

const mensagem = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function sugerir(
  resumo: ResumoModelo,
  trechos: ObraTrecho[],
  servicos: ServicoDaObra[]
): VinculosEdicao {
  const eixos = trechos.filter((t) => t.tipo === 'eixo')
  return {
    // um eixo no modelo e um local na obra: só pode ser ele
    eixos:
      resumo.eixos.length === 1 && eixos.length === 1 ? { [resumo.eixos[0].id]: eixos[0].id } : {},
    classes: sugerirVinculos(resumo.classes, servicos)
  }
}

interface Lido {
  modelo: Modelo4D
  origem: 'html' | 'iw4d'
  resumo: ResumoModelo
  /** Conferência da montagem, quando o arquivo traz dados de projeto. */
  avisos: string[]
}

export function ImportarModeloDialog({
  open,
  onOpenChange,
  obraId,
  trechos,
  servicos
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  trechos: ObraTrecho[]
  servicos: ServicoDaObra[]
}): ReactNode {
  const importar = useImportarModelo4D()
  const entrada = useRef<HTMLInputElement>(null)
  const [lido, setLido] = useState<Lido | null>(null)
  const [nome, setNome] = useState('')
  const [vinculos, setVinculos] = useState<VinculosEdicao>({ eixos: {}, classes: {} })
  const [erros, setErros] = useState<string[]>([])
  const [lendo, setLendo] = useState(false)
  const [sobre, setSobre] = useState(false)
  const [tentou, setTentou] = useState(false)

  useEffect(() => {
    if (!open) return
    setLido(null)
    setNome('')
    setErros([])
    setTentou(false)
  }, [open])

  async function abrir(arquivo: File): Promise<void> {
    setLendo(true)
    setErros([])
    try {
      const r = lerModelo(await arquivo.text())
      if ('erros' in r) {
        setErros(r.erros)
        return
      }
      const resumo = resumirModelo(prepararModelo(r.modelo))
      setLido({ modelo: r.modelo, origem: r.origem, resumo, avisos: r.avisos ?? [] })
      setNome(r.modelo.nome || arquivo.name.replace(/\.[^.]+$/, ''))
      setVinculos(sugerir(resumo, trechos, servicos))
    } catch (e) {
      setErros([`Não consegui ler o arquivo: ${mensagem(e)}`])
    } finally {
      setLendo(false)
    }
  }

  function soltar(e: DragEvent): void {
    e.preventDefault()
    setSobre(false)
    const f = e.dataTransfer.files[0]
    if (f) void abrir(f)
  }

  const gravar = paraGravar(vinculos)
  const semEixo = !!lido && gravar.eixos.length === 0
  const erroNome = tentou && !nome.trim() ? 'Dê um nome ao modelo.' : null

  async function salvar(): Promise<void> {
    setTentou(true)
    if (!lido || !nome.trim()) return
    try {
      await importar.mutateAsync({
        obraId,
        nome: nome.trim(),
        origem: lido.origem,
        modelo: lido.modelo,
        resumo: lido.resumo,
        ...gravar
      })
      toast.success('Modelo importado.')
      onOpenChange(false)
    } catch (e) {
      setErros([`O modelo não foi gravado: ${mensagem(e)}`])
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl" disableDismiss={importar.isPending}>
      <DialogHeader>
        <DialogTitle>Importar modelo 4D</DialogTitle>
        <DialogDescription>
          O HTML da construção digital ou um arquivo no contrato infrawork-4d (.json).
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="max-h-[70vh] overflow-y-auto">
        <DialogErrorBanner message={erros.length ? erros.join(' ') : null} />
        {!lido ? (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setSobre(true)
            }}
            onDragLeave={() => setSobre(false)}
            onDrop={soltar}
            className={cn(
              'flex flex-col items-center gap-3 rounded border border-dashed px-6 py-10 text-center',
              sobre ? 'border-accent bg-accent/10' : 'border-border-strong'
            )}
          >
            <Upload size={22} className="text-text-muted" aria-hidden />
            <p className="text-sm text-text">
              {lendo ? 'Lendo o modelo…' : 'Arraste o arquivo para cá ou escolha no computador.'}
            </p>
            <input
              ref={entrada}
              type="file"
              accept=".html,.htm,.json"
              className="sr-only"
              aria-label="Arquivo do modelo"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void abrir(f)
                e.target.value = ''
              }}
            />
            <Button variant="secondary" disabled={lendo} onClick={() => entrada.current?.click()}>
              Escolher arquivo
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Campo rotulo="Nome do modelo" erro={erroNome} obrigatorio>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} />
              </Campo>
              <p className="pb-1.5 text-sm text-text-muted">
                {contar(lido.resumo.classes.length, 'classe', 'classes')} ·{' '}
                {contar(
                  lido.resumo.classes.reduce((t, c) => t + c.pecas, 0),
                  'peça',
                  'peças'
                )}{' '}
                ·{' '}
                {(lido.resumo.extensao_m / 1000).toLocaleString('pt-BR', {
                  maximumFractionDigits: 2
                })}{' '}
                km{lido.resumo.terreno ? ' · com terreno' : ''}
              </p>
            </div>
            {lido.avisos.length > 0 && (
              <section
                aria-label="Conferência do projeto"
                className="rounded border border-border bg-bg-elevated px-3 py-2"
              >
                <h3 className="text-sm font-medium text-text">Conferência do projeto</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-text-muted">
                  {lido.avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </section>
            )}
            <VinculosForm
              resumo={lido.resumo}
              trechos={trechos}
              servicos={servicos}
              valor={vinculos}
              aoMudar={setVinculos}
              desabilitado={importar.isPending}
            />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        {lido ? (
          <Button
            variant="ghost"
            className="mr-auto"
            disabled={importar.isPending}
            onClick={() => setLido(null)}
          >
            Trocar arquivo
          </Button>
        ) : null}
        <Button
          variant="secondary"
          disabled={importar.isPending}
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button
          disabled={!lido || importar.isPending}
          title={
            !lido
              ? 'Escolha o arquivo do modelo'
              : semEixo
                ? 'Sem local vinculado ao eixo, o modelo entra só como cena, sem previsto nem realizado'
                : undefined
          }
          onClick={() => void salvar()}
        >
          {importar.isPending ? 'Enviando…' : 'Importar'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function VincularModeloDialog({
  open,
  onOpenChange,
  registro,
  atuais,
  trechos,
  servicos
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  registro: ModeloRegistro
  atuais: VinculosGravados | undefined
  trechos: ObraTrecho[]
  servicos: ServicoDaObra[]
}): ReactNode {
  const vincular = useVincularModelo4D()
  const [vinculos, setVinculos] = useState<VinculosEdicao>({ eixos: {}, classes: {} })
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setErro(null)
    setVinculos({
      eixos: Object.fromEntries((atuais?.eixos ?? []).map((e) => [e.eixo, e.trecho_id])),
      classes: Object.fromEntries(
        (atuais?.classes ?? []).map((c) => [c.classe, c.item_orcamentario_id])
      )
    })
  }, [open, atuais])

  async function salvar(): Promise<void> {
    try {
      await vincular.mutateAsync({ modeloId: registro.id, ...paraGravar(vinculos) })
      toast.success('Vínculos gravados.')
      onOpenChange(false)
    } catch (e) {
      setErro(`Os vínculos não foram gravados: ${mensagem(e)}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl" disableDismiss={vincular.isPending}>
      <DialogHeader>
        <DialogTitle>Vincular ao plano</DialogTitle>
        <DialogDescription>{registro.nome}</DialogDescription>
      </DialogHeader>
      <DialogBody className="max-h-[70vh] overflow-y-auto">
        <DialogErrorBanner message={erro} />
        <VinculosForm
          resumo={registro.resumo}
          trechos={trechos}
          servicos={servicos}
          valor={vinculos}
          aoMudar={setVinculos}
          desabilitado={vincular.isPending}
        />
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          className="mr-auto"
          disabled={vincular.isPending}
          title="Preenche o que está vazio com o serviço de nome ou código igual"
          onClick={() => {
            const s = sugerir(registro.resumo, trechos, servicos)
            setVinculos((v) => ({
              eixos: {
                ...s.eixos,
                ...Object.fromEntries(Object.entries(v.eixos).filter(([, x]) => x))
              },
              classes: {
                ...s.classes,
                ...Object.fromEntries(Object.entries(v.classes).filter(([, x]) => x))
              }
            }))
          }}
        >
          Sugerir vínculos
        </Button>
        <Button
          variant="secondary"
          disabled={vincular.isPending}
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button disabled={vincular.isPending} onClick={() => void salvar()}>
          {vincular.isPending ? 'Gravando…' : 'Gravar vínculos'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function PromptModeloDialog({
  open,
  onOpenChange,
  texto,
  semLinhaBase
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  texto: string
  semLinhaBase: boolean
}): ReactNode {
  const linhas = useMemo(() => texto.split('\n').length, [texto])

  function baixar(): void {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'prompt-modelo-4d.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl">
      <DialogHeader>
        <DialogTitle>Prompt para gerar o modelo</DialogTitle>
        <DialogDescription>
          Cole no Claude aberto na pasta de projeto da obra. O texto leva o contrato do arquivo, o
          estaqueamento e os serviços do plano, para o modelo já sair vinculado.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {semLinhaBase ? (
          <p className="mb-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text">
            A obra não tem linha de base vigente: o prompt vai sem as faixas de estaca do plano.
          </p>
        ) : null}
        <textarea
          readOnly
          aria-label="Prompt para gerar o modelo"
          value={texto}
          rows={Math.min(22, linhas)}
          className="block w-full resize-y rounded border border-border-strong bg-bg-elevated p-3 font-mono text-xs text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={baixar}>
          <Download size={14} aria-hidden /> Baixar
        </Button>
        <Button
          onClick={() =>
            void navigator.clipboard
              .writeText(texto)
              .then(() => toast.success('Prompt copiado.'))
              .catch(() => toast.error('Não consegui copiar. Use Baixar.'))
          }
        >
          <Copy size={14} aria-hidden /> Copiar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
