import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireRole } from '@/components/layout/RequireRole'
import { Carregando, ErroConsulta, Vazio } from '@/components/ui/estado'
import { Secao } from '@/components/ui/secao'
import { CAPACIDADES, CHAVES_CAPACIDADE, type Capacidade } from '@/config/capacidades'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useCapacidades, useDefinirCapacidade } from '@/features/integracoes/hooks'
import { SigaIntegracao } from '@/features/integracoes/SigaIntegracao'

/**
 * Integrações da empresa: o que está habilitado para ela e a conexão com os sistemas de fora. É aqui que uma
 * empresa passa a ter a produção vinda do SIGA, por exemplo, sem que o resto do sistema mude.
 */
export function GerencialIntegracoesPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm']} pageTitle="Integrações">
      <Inner />
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const empresaId = scope.empresaId
  const role = useAuthStore((s) => s.profile?.role)
  const god = role === 'god'
  const { data: capacidades, isLoading, error, refetch } = useCapacidades(empresaId)
  const definir = useDefinirCapacidade()
  // a marcação aparece no clique; a gravação confirma (ou desfaz, se o servidor recusar)
  const [escolha, setEscolha] = useState<{ chave: Capacidade; ligada: boolean } | null>(null)

  const alternar = (chave: Capacidade, ligada: boolean): void => {
    if (!empresaId) return
    setEscolha({ chave, ligada })
    definir.mutate(
      { empresa_id: empresaId, chave, ligada },
      {
        onSuccess: () =>
          void toast.success(
            `${CAPACIDADES[chave].rotulo}: ${ligada ? 'habilitada' : 'desabilitada'} para a empresa.`
          ),
        onError: (e) => void toast.error(`Não foi possível alterar. ${e.message}`),
        onSettled: () => setEscolha(null)
      }
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Integrações"
        subtitle="O que a empresa tem habilitado e as conexões com sistemas de fora."
      />
      <div className="flex-1 space-y-5 overflow-auto p-5">
        {!empresaId ? (
          <Vazio>Escolha a empresa no alto da tela para ver as integrações dela.</Vazio>
        ) : isLoading ? (
          <Carregando />
        ) : error || !capacidades ? (
          <ErroConsulta erro={error} oQue="as integrações" aoTentar={() => void refetch()} />
        ) : (
          <>
            {god ? (
              <Secao
                titulo="Habilitado para a empresa"
                nota="O que foge do padrão do sistema. Só o suporte do InfraWork altera."
              >
                <ul className="divide-y divide-border">
                  {CHAVES_CAPACIDADE.map((chave) => (
                    <li key={chave} className="flex items-start gap-3 py-2.5">
                      <input
                        id={`cap-${chave}`}
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[var(--accent)]"
                        checked={escolha?.chave === chave ? escolha.ligada : capacidades[chave]}
                        disabled={escolha !== null}
                        title={escolha !== null ? 'Gravando a alteração…' : undefined}
                        onChange={(e) => alternar(chave, e.target.checked)}
                      />
                      <label htmlFor={`cap-${chave}`} className="min-w-0">
                        <span className="block text-sm font-medium text-text">
                          {CAPACIDADES[chave].rotulo}
                        </span>
                        <span className="block max-w-[75ch] text-sm text-text-muted">
                          {CAPACIDADES[chave].descricao}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Secao>
            ) : null}

            <Secao titulo="Conexões" nota="A conta da FleetHub é conectada em Gerencial › Frota.">
              {capacidades.integracao_siga ? (
                <SigaIntegracao empresaId={empresaId} podeGerenciar podeDiagnosticar={god} />
              ) : (
                <Vazio>
                  {god
                    ? 'Nenhuma conexão habilitada. Marque acima o que esta empresa usa.'
                    : 'Nenhuma conexão está habilitada para a empresa. Para integrar com outro sistema, fale com o suporte do InfraWork.'}
                </Vazio>
              )}
            </Secao>
          </>
        )}
      </div>
    </div>
  )
}
