import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Paperclip, Upload, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { EstadoConsulta } from '@/components/ui/estado'
import { getAnexoSignedUrl, useAnexos, useDeleteAnexo, useUploadAnexo } from '../hooks/anexos'
import { formatDate } from '@/lib/format'
import type { AnexoEscopo } from '@/types/orcamento'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Props {
  obraId: string
  escopo: AnexoEscopo
  escopoId: string
  podeEditar: boolean
}

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function AnexosList({ obraId, escopo, escopoId, podeEditar }: Props): ReactNode {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const consulta = useAnexos(escopo, escopoId)
  const anexos = consulta.data ?? []
  const upload = useUploadAnexo()
  const remove = useDeleteAnexo()
  const confirm = useConfirm()

  const onPick = (): void => fileInputRef.current?.click()

  const onChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await upload.mutateAsync({
        obra_id: obraId,
        escopo,
        escopo_id: escopoId,
        file
      })
      toast.success(`Anexo "${file.name}" enviado.`)
    } catch (err) {
      toast.error(`Não foi possível enviar "${file.name}". ${detalheDoErro(err) ?? ''}`.trim())
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const openSigned = async (path: string): Promise<void> => {
    const url = await getAnexoSignedUrl(path)
    if (url) {
      window.open(url, '_blank')
    } else {
      toast.error('Não foi possível abrir o anexo. Tente de novo em instantes.')
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
          <Paperclip size={12} aria-hidden /> Anexos
          {consulta.isLoading ? null : <span className="tabular">({anexos.length})</span>}
        </h3>
        {podeEditar ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onPick}
            disabled={upload.isPending}
          >
            <Upload size={12} aria-hidden /> {upload.isPending ? 'Enviando…' : 'Enviar arquivo'}
          </Button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          onChange={onChange}
          className="hidden"
          tabIndex={-1}
          aria-label="Arquivo para anexar"
        />
      </div>

      <EstadoConsulta
        consulta={consulta}
        oQue="os anexos"
        vazio={anexos.length === 0}
        textoVazio={
          podeEditar
            ? 'Nenhum arquivo anexado. Use "Enviar arquivo" para anexar projeto, memória ou foto.'
            : 'Nenhum arquivo anexado.'
        }
        className="py-2"
      >
        <ul className="rounded border border-border bg-bg-elevated divide-y divide-border">
          {anexos.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <Paperclip size={14} aria-hidden className="text-text-dim shrink-0" />
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => openSigned(a.storage_path)}
                  className="block w-full truncate rounded text-left font-medium text-text hover:text-accent hover:underline"
                  title={`Abrir ${a.nome}`}
                >
                  {a.nome}
                </button>
                <div className="text-xs text-text-muted tabular">
                  {fmtBytes(a.tamanho_bytes)}, enviado em {formatDate(a.created_at)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  size="sm"
                  variant="accent"
                  onClick={() => openSigned(a.storage_path)}
                  aria-label={`Abrir ${a.nome} em outra aba`}
                  title="Abrir em outra aba"
                >
                  <ExternalLink size={12} aria-hidden />
                </IconButton>
                {podeEditar ? (
                  <IconButton
                    size="sm"
                    variant="danger"
                    disabled={remove.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Excluir "${a.nome}"?`,
                        description: 'O arquivo é apagado e não pode ser recuperado.',
                        confirmLabel: 'Excluir anexo',
                        variant: 'danger'
                      })
                      if (ok) {
                        remove.mutate({
                          id: a.id,
                          escopo,
                          escopo_id: escopoId,
                          storage_path: a.storage_path
                        })
                      }
                    }}
                    aria-label={`Excluir ${a.nome}`}
                    title="Excluir"
                  >
                    <Trash2 size={12} aria-hidden />
                  </IconButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </EstadoConsulta>
    </div>
  )
}
