import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { ErroConsulta } from '@/components/ui/estado'
import { useAuthStore } from '@/stores/auth-store'
import { useEmpresas, useObras, useUsuarios } from '@/features/gerencial/hooks'
import { contar, rotuloPapel } from '@/lib/rotulos'

export function GerencialIndex(): ReactNode {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const empresa = useAuthStore((s) => s.empresa)

  const isGod = profile?.role === 'god'
  const canSeeObras = profile?.role === 'god' || profile?.role === 'adm'

  const consultaEmpresas = useEmpresas()
  const consultaUsuarios = useUsuarios()
  const consultaObras = useObras()
  const empresas = consultaEmpresas.data ?? []
  const usuarios = consultaUsuarios.data ?? []
  const obras = consultaObras.data ?? []
  const falhas = [
    { consulta: consultaEmpresas, oQue: 'as empresas', mostra: isGod },
    { consulta: consultaUsuarios, oQue: 'os usuários', mostra: true },
    { consulta: consultaObras, oQue: 'as obras', mostra: canSeeObras }
  ].filter((f) => f.mostra && f.consulta.error)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Gerencial"
        subtitle={
          isGod
            ? 'Administração de empresas, usuários e obras do sistema.'
            : empresa
              ? `Administração de ${empresa.nome}.`
              : 'Sua conta está sem empresa atribuída.'
        }
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {falhas.map((f) => (
          <ErroConsulta
            key={f.oQue}
            erro={f.consulta.error}
            oQue={f.oQue}
            aoTentar={() => void f.consulta.refetch()}
          />
        ))}
        <FaixaIndicadores rotulo="Cadastros">
          {isGod ? (
            <Indicador
              rotulo="Empresas"
              valor={consultaEmpresas.error ? '—' : empresas.length.toLocaleString('pt-BR')}
              carregando={consultaEmpresas.isLoading}
              aoClicar={() => void navigate({ to: '/gerencial/empresas' })}
            >
              <span>{consultaEmpresas.error ? 'não carregadas' : 'cadastradas'}</span>
            </Indicador>
          ) : null}
          <Indicador
            rotulo="Usuários"
            valor={consultaUsuarios.error ? '—' : usuarios.length.toLocaleString('pt-BR')}
            carregando={consultaUsuarios.isLoading}
            aoClicar={() => void navigate({ to: '/gerencial/usuarios' })}
          >
            {consultaUsuarios.error ? (
              <span>não carregados</span>
            ) : (
              <span>
                {contar(
                  usuarios.filter((u) => u.role === 'adm').length,
                  'administrador',
                  'administradores'
                )}{' '}
                ·{' '}
                {contar(
                  usuarios.filter((u) => u.role === 'engenheiro').length,
                  'engenheiro',
                  'engenheiros'
                )}{' '}
                · {usuarios.filter((u) => u.role === 'apoio').length} de apoio
              </span>
            )}
          </Indicador>
          {canSeeObras ? (
            <Indicador
              rotulo="Obras"
              valor={consultaObras.error ? '—' : obras.length.toLocaleString('pt-BR')}
              carregando={consultaObras.isLoading}
              aoClicar={() => void navigate({ to: '/gerencial/obras' })}
            >
              <span>
                {consultaObras.error
                  ? 'não carregadas'
                  : isGod
                    ? 'em todas as empresas'
                    : 'na sua empresa'}
              </span>
            </Indicador>
          ) : null}
        </FaixaIndicadores>

        <div className="rounded border border-border bg-bg-panel p-4">
          <h2 className="text-lg font-semibold text-text mb-1">
            Seu papel: {labelRole(profile?.role)}
          </h2>
          <p className="text-sm text-text-muted max-w-[75ch]">{descricaoRole(profile?.role)}</p>
        </div>
      </div>
    </div>
  )
}

function labelRole(r: string | undefined): string {
  switch (r) {
    case 'god':
      return 'Administrador geral (todas as empresas)'
    case 'adm':
      return 'Administrador da empresa'
    case 'engenheiro':
      return 'Engenheiro'
    case 'apoio':
      return 'Apoio'
    default:
      return rotuloPapel(r)
  }
}

function descricaoRole(r: string | undefined): string {
  switch (r) {
    case 'god':
      return 'Você pode criar empresas, usuários de qualquer papel e obras em qualquer empresa, e conceder ou revogar o acesso a qualquer obra.'
    case 'adm':
      return 'Você pode criar usuários de qualquer papel da empresa (administrador, engenheiro, apoio, cliente e apontador) e obras, e conceder ou revogar o acesso de cada um às obras.'
    case 'engenheiro':
      return 'Você pode cadastrar apoios, vinculados a você, e apontadores do app de campo, e liberar as suas obras aos apontadores. O seu acesso às obras é concedido pelo administrador da empresa.'
    case 'apoio':
      return 'Você vê as obras do engenheiro a quem está vinculado. Este papel não tem ações administrativas.'
    default:
      return ''
  }
}
