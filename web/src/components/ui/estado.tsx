import { type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

const mensagemDe = (erro: unknown): string =>
  erro instanceof Error ? erro.message : typeof erro === 'string' ? erro : 'Erro desconhecido'

/** Falha de consulta: diz o que não carregou, mostra a mensagem do servidor e oferece nova tentativa. */
export function ErroConsulta({
  erro,
  oQue = 'os dados',
  aoTentar,
  compacto,
  className
}: {
  erro: unknown
  /** Complemento de "Não foi possível carregar …". */
  oQue?: string
  aoTentar?: () => void
  compacto?: boolean
  className?: string
}): ReactNode {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded border border-danger/40 bg-danger/10 text-sm text-text',
        compacto ? 'px-3 py-2' : 'px-4 py-3',
        className
      )}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-[12rem] flex-1">
        <div className="font-semibold text-danger">Não foi possível carregar {oQue}.</div>
        <div className="text-text-muted break-words">{mensagemDe(erro)}</div>
      </div>
      {aoTentar ? (
        <Button variant="secondary" size="sm" onClick={aoTentar} className="shrink-0">
          <RotateCw size={12} /> Tentar de novo
        </Button>
      ) : null}
    </div>
  )
}

/** Linha de "carregando" para blocos e painéis (não para a página inteira). */
export function Carregando({
  texto = 'Carregando…',
  className
}: {
  texto?: string
  className?: string
}): ReactNode {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center gap-2 py-6 text-sm text-text-muted', className)}
    >
      <span
        aria-hidden
        className="h-3 w-3 rounded-full border-2 border-border-strong border-t-accent animate-spin"
      />
      {texto}
    </div>
  )
}

/** Vazio de um bloco: uma frase que diz o que falta e, se houver, o que fazer. */
export function Vazio({
  children,
  acao,
  className
}: {
  children: ReactNode
  acao?: ReactNode
  className?: string
}): ReactNode {
  return (
    <div className={cn('py-6 text-sm text-text-muted', className)}>
      <p className="max-w-[60ch]">{children}</p>
      {acao ? <div className="mt-3">{acao}</div> : null}
    </div>
  )
}

interface ConsultaLike {
  isLoading: boolean
  error: unknown
  refetch?: () => unknown
}

/**
 * Resolve os três estados de uma consulta antes do conteúdo: carregando, erro (com nova tentativa) e vazio.
 * `vazio` só vale depois que a consulta terminou, para a tela não dizer "sem dados" enquanto ainda carrega.
 */
export function EstadoConsulta({
  consulta,
  oQue,
  vazio,
  textoVazio,
  acaoVazio,
  className,
  children
}: {
  consulta: ConsultaLike
  oQue?: string
  vazio?: boolean
  textoVazio?: ReactNode
  acaoVazio?: ReactNode
  className?: string
  children: ReactNode
}): ReactNode {
  if (consulta.isLoading) return <Carregando className={className} />
  if (consulta.error)
    return (
      <ErroConsulta
        erro={consulta.error}
        oQue={oQue}
        aoTentar={consulta.refetch ? () => void consulta.refetch?.() : undefined}
        className={className}
      />
    )
  if (vazio)
    return (
      <Vazio acao={acaoVazio} className={className}>
        {textoVazio ?? 'Nada para mostrar.'}
      </Vazio>
    )
  return children
}
