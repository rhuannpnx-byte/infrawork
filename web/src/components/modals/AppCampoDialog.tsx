import { useMemo, type ReactNode } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { encode } from 'uqr'
import { toast } from 'sonner'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { URL_APP_CAMPO } from '@/config/app-campo'
import { cn } from '@/lib/utils'

/** Janela do menu do usuário com o QR code do endereço do app de campo, para abrir e instalar no celular. */
export default function AppCampoDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactNode {
  const enderecoCurto = URL_APP_CAMPO.replace(/^https?:\/\//, '').replace(/\/$/, '')

  const copiar = (): void => {
    void navigator.clipboard
      ?.writeText(URL_APP_CAMPO)
      .then(() => toast.success('Endereço do app copiado.'))
      .catch(() => toast.error('Não foi possível copiar. Selecione o endereço e copie.'))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      <DialogHeader>
        <DialogTitle>App de campo</DialogTitle>
        <DialogDescription>
          Produção, viagens e fotos lançadas no celular, na frente de serviço, inclusive sem
          internet.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <QrCode
          texto={URL_APP_CAMPO}
          rotulo={`QR code do endereço do app de campo: ${enderecoCurto}`}
          className="w-44 shrink-0 sm:w-48"
        />
        <div className="min-w-0 flex-1 space-y-3 text-sm text-text">
          <ol className="list-decimal space-y-1.5 pl-4 marker:font-mono marker:text-text-dim">
            <li>Aponte a câmera do celular para o código e abra o endereço.</li>
            <li>Entre com o mesmo e-mail e a mesma senha do InfraWork.</li>
            <li>
              Instale na tela inicial: no Android, toque em <strong>Instalar</strong> (Chrome); no
              iPhone, use <strong>Compartilhar › Adicionar à Tela de Início</strong> (Safari).
            </li>
          </ol>
          <p className="text-xs text-text-muted">
            O apontador só vê as obras liberadas para ele em Gerencial › Usuários.
          </p>
          <div className="flex items-center gap-1.5 rounded border border-border bg-bg px-2 py-1.5">
            <a
              href={URL_APP_CAMPO}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate font-mono text-xs text-accent hover:underline"
            >
              {enderecoCurto}
            </a>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={copiar}
              aria-label="Copiar o endereço do app"
              title="Copiar o endereço do app"
            >
              <Copy size={13} />
            </Button>
            <a
              href={URL_APP_CAMPO}
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir o app de campo numa nova aba"
              title="Abrir numa nova aba"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text"
            >
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

/**
 * QR code em SVG, módulo escuro sobre fundo claro nos dois temas (leitores de celular nem sempre leem o invertido).
 * A borda de 4 módulos é a zona de silêncio pedida pela norma.
 */
function QrCode({
  texto,
  rotulo,
  className
}: {
  texto: string
  rotulo: string
  className?: string
}): ReactNode {
  const { caminho, lado } = useMemo(() => {
    const qr = encode(texto, { ecc: 'M', border: 4 })
    let d = ''
    qr.data.forEach((linha, y) =>
      linha.forEach((escuro, x) => {
        if (escuro) d += `M${x} ${y}h1v1h-1z`
      })
    )
    return { caminho: d, lado: qr.size }
  }, [texto])

  return (
    <svg
      role="img"
      aria-label={rotulo}
      viewBox={`0 0 ${lado} ${lado}`}
      shapeRendering="crispEdges"
      className={cn('aspect-square rounded border border-border', className)}
    >
      <rect width={lado} height={lado} fill="var(--qr-fundo)" />
      <path d={caminho} fill="var(--qr-modulo)" />
    </svg>
  )
}
