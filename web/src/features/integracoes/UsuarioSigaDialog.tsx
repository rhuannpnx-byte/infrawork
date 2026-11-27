import { useMemo, useState, type ReactNode } from 'react'
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
import { Button } from '@/components/ui/button'
import { Carregando } from '@/components/ui/estado'
import { ListaPesquisavel, type OpcaoLista } from '@/components/ui/lista-pesquisavel'
import {
  useUsuariosSiga,
  useVincularUsuarioSiga,
  type VinculoUsuarioSiga
} from '@/features/integracoes/hooks'
import type { UsuarioComEmpresa } from '@/types/gerencial'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: UsuarioComEmpresa | null
  /** Todos os vínculos da empresa: quem já está ligado a quem. */
  vinculos: VinculoUsuarioSiga[]
  /** Nome de cada usuário do InfraWork, para dizer a quem um usuário do SIGA já está ligado. */
  nomes: Map<string, string>
}

/**
 * Liga um usuário do InfraWork ao usuário dele no SIGA. O lançamento feito por ele em obra do SIGA é gravado lá
 * com o nome desse usuário.
 */
export function UsuarioSigaDialog(props: Props): ReactNode {
  const gravar = useVincularUsuarioSiga()
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="sm"
      disableDismiss={gravar.isPending}
    >
      {/* montado a cada abertura: a escolha começa do vínculo atual */}
      {props.open && props.usuario ? (
        <Corpo key={props.usuario.id} {...props} usuario={props.usuario} gravar={gravar} />
      ) : null}
    </Dialog>
  )
}

function Corpo({
  open,
  onOpenChange,
  usuario,
  vinculos,
  nomes,
  gravar
}: Props & {
  usuario: UsuarioComEmpresa
  gravar: ReturnType<typeof useVincularUsuarioSiga>
}): ReactNode {
  const atual = vinculos.find((v) => v.user_id === usuario.id) ?? null
  const peloSiga = atual?.origem === 'login'
  const lista = useUsuariosSiga(usuario.empresa_id, open && !peloSiga)
  const [escolha, setEscolha] = useState<string | null>(atual ? String(atual.externo_id) : null)
  const [erro, setErro] = useState<string | null>(null)

  const opcoes = useMemo<OpcaoLista[]>(() => {
    const donos = new Map(vinculos.map((v) => [v.externo_id, v.user_id]))
    return (lista.data ?? [])
      .filter((u) => {
        const dono = donos.get(u.id)
        return !dono || dono === usuario.id
      })
      .map((u) => ({ valor: String(u.id), rotulo: u.nome, dica: u.login }))
  }, [lista.data, vinculos, usuario.id])

  const ocupados = useMemo(
    () =>
      vinculos
        .filter((v) => v.user_id !== usuario.id)
        .map((v) => {
          const dono = nomes.get(v.user_id)
          // quem entra pelo SIGA tem aqui o mesmo nome de lá
          return dono && dono !== v.externo_nome ? `${v.externo_nome} (${dono})` : v.externo_nome
        }),
    [vinculos, usuario.id, nomes]
  )

  const salvar = async (externo: number | null): Promise<void> => {
    if (!usuario.empresa_id) return
    setErro(null)
    try {
      await gravar.mutateAsync({
        empresa_id: usuario.empresa_id,
        user_id: usuario.id,
        externo_id: externo
      })
      toast.success(
        externo == null
          ? `${usuario.nome} não está mais ligado ao SIGA.`
          : `${usuario.nome} ligado ao usuário do SIGA.`
      )
      onOpenChange(false)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar o vínculo.')
    }
  }

  const mudou = escolha != null && escolha !== (atual ? String(atual.externo_id) : null)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Usuário no SIGA</DialogTitle>
        <DialogDescription>{`${usuario.nome} · ${usuario.email}`}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        {peloSiga && atual ? (
          <p className="text-sm text-text-muted">
            Este usuário entra no app de campo com o usuário <strong>{atual.externo_login}</strong>{' '}
            do SIGA. As obras dele são as dos projetos liberados para ele no SIGA; para tirar o
            acesso, desative o usuário.
          </p>
        ) : lista.isLoading ? (
          <Carregando />
        ) : lista.error ? (
          <p role="alert" className="text-sm text-danger">
            {lista.error.message}
          </p>
        ) : (
          <>
            <p className="text-sm text-text-muted">
              O que {usuario.nome} lançar em obra do SIGA é gravado lá com o nome deste usuário.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted" aria-hidden>
                Usuário do SIGA
              </span>
              <ListaPesquisavel
                opcoes={opcoes}
                valor={escolha}
                aoEscolher={(o) => setEscolha(o.valor)}
                rotulo="Usuário do SIGA"
                placeholder="Escolha pelo nome ou pelo usuário"
              />
            </div>
            {atual && !atual.ativo ? (
              <p className="text-xs text-warn">
                O usuário ligado hoje ({atual.externo_nome}) está inativo no SIGA.
              </p>
            ) : null}
            {ocupados.length > 0 ? (
              <p className="text-xs text-text-dim">
                Fora da lista, por já estarem ligados: {ocupados.join('; ')}.
              </p>
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {atual && !peloSiga ? (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto text-danger hover:bg-danger/10 hover:text-danger"
            disabled={gravar.isPending}
            onClick={() => void salvar(null)}
          >
            Desfazer o vínculo
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          {peloSiga ? 'Fechar' : 'Cancelar'}
        </Button>
        {!peloSiga ? (
          <Button
            type="button"
            variant="default"
            disabled={!mudou || gravar.isPending}
            title={!mudou ? 'Escolha o usuário do SIGA' : undefined}
            onClick={() => void salvar(Number(escolha))}
          >
            {gravar.isPending ? 'Gravando…' : 'Salvar'}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}
