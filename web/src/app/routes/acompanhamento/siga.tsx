import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Link2, RefreshCw, Unlink, UsersRound } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Carregando, ErroConsulta, Vazio } from '@/components/ui/estado'
import { Input } from '@/components/ui/input'
import { InputMascara } from '@/components/ui/input-mascara'
import { Secao } from '@/components/ui/secao'
import { Segmentado } from '@/components/ui/segmentado'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { GravacaoSiga } from '@/features/integracoes/GravacaoSiga'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { parseNumero } from '@/lib/format/number'
import { numeroParaCampo } from '@/lib/mascara/numero'
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import {
  useCadastrosSiga,
  useCapacidadesDoEscopo,
  useDeParaSiga,
  useInternosDaObra,
  useProjetosSiga,
  useVinculoSiga,
  useVinculoSigaAcao,
  type CadastroSiga,
  type DeParaSiga,
  type TipoDePara,
  type VinculoSiga
} from '@/features/integracoes/hooks'

/**
 * Vínculo da obra com o SIGA: de qual projeto vem a produção e a que serviço, equipe, encarregado e local do
 * InfraWork corresponde cada cadastro de lá. O que fica sem vínculo entra com o nome do SIGA e aparece aqui.
 */
export function AcompanhamentoSigaPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro']} pageTitle="Vínculo com o SIGA">
      <RequireObra pageTitle="Vínculo com o SIGA">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

const dataHora = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
const dia = (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR')
const CABECALHO =
  'border-b border-border bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

const ABAS: Array<{ tipo: TipoDePara; rotulo: string; lista: keyof ListasSiga; destino: string }> =
  [
    { tipo: 'servico', rotulo: 'Serviços', lista: 'servicos', destino: 'Serviço do orçamento' },
    { tipo: 'equipe', rotulo: 'Equipes', lista: 'equipes', destino: 'Equipe' },
    { tipo: 'encarregado', rotulo: 'Encarregados', lista: 'encarregados', destino: 'Encarregado' },
    { tipo: 'local', rotulo: 'Locais', lista: 'locais', destino: 'Local' }
  ]
interface ListasSiga {
  servicos: CadastroSiga[]
  equipes: CadastroSiga[]
  encarregados: CadastroSiga[]
  locais: CadastroSiga[]
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const capacidades = useCapacidadesDoEscopo()
  const vinculo = useVinculoSiga(obraId)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Vínculo com o SIGA"
        subtitle="De qual projeto do SIGA vem a produção desta obra e como os cadastros de lá se ligam aos daqui."
      />
      <div className="flex-1 space-y-5 overflow-auto p-5">
        {capacidades === null || vinculo.isLoading ? (
          <Carregando />
        ) : !capacidades.integracao_siga ? (
          <Vazio>
            A integração com o SIGA não está habilitada para esta empresa. A produção desta obra é
            lançada no InfraWork.
          </Vazio>
        ) : vinculo.error ? (
          <ErroConsulta
            erro={vinculo.error}
            oQue="o vínculo com o SIGA"
            aoTentar={() => void vinculo.refetch()}
          />
        ) : (
          <>
            <Projeto obraId={obraId} vinculo={vinculo.data ?? null} />
            {vinculo.data ? <GravacaoSiga obraId={obraId} vinculo={vinculo.data} /> : null}
            {vinculo.data ? <DePara obraId={obraId} /> : null}
          </>
        )}
      </div>
    </div>
  )
}

function resumoSync(v: VinculoSiga): string {
  const r = v.ultimo_sync_resumo
  if (!r) return ''
  const partes = [
    contar(r.lidos, 'lançamento lido', 'lançamentos lidos'),
    r.novos > 0 ? contar(r.novos, 'novo', 'novos') : null,
    r.alterados > 0 ? contar(r.alterados, 'alterado', 'alterados') : null,
    r.removidos > 0 ? contar(r.removidos, 'removido', 'removidos') : null,
    r.erros.length > 0 ? contar(r.erros.length, 'com erro', 'com erro') : null
  ].filter(Boolean)
  return partes.join(', ')
}

/** O projeto do SIGA ligado à obra: escolher, trocar, desfazer e sincronizar. */
function Projeto({ obraId, vinculo }: { obraId: string; vinculo: VinculoSiga | null }): ReactNode {
  const acao = useVinculoSigaAcao()
  const confirm = useConfirm()
  const [escolhendo, setEscolhendo] = useState(false)
  const [projeto, setProjeto] = useState('')
  const [corte, setCorte] = useState(vinculo?.data_corte ?? '')
  const [tentou, setTentou] = useState(false)
  const abrir = !vinculo || escolhendo
  const projetos = useProjetosSiga(obraId, abrir)
  const fazendo = acao.isPending ? acao.variables?.acao : null

  const vincular = async (): Promise<void> => {
    setTentou(true)
    const p = (projetos.data ?? []).find((x) => String(x.id) === projeto)
    if (!p) return
    if (vinculo && vinculo.externo_projeto_id !== p.id) {
      const ok = await confirm({
        title: 'Trocar o projeto do SIGA?',
        description:
          'A produção trazida do projeto atual e os vínculos de serviço, equipe, encarregado e local saem desta obra. Os lançamentos continuam no SIGA.',
        confirmLabel: 'Trocar o projeto',
        variant: 'danger'
      })
      if (!ok) return
    }
    acao.mutate(
      {
        acao: 'vincular',
        obra_id: obraId,
        projeto_id: p.id,
        projeto_codigo: p.codigo,
        data_corte: corte || null
      },
      {
        onSuccess: () => {
          toast.success(`Obra ligada ao projeto ${p.codigo} do SIGA.`)
          setEscolhendo(false)
        },
        onError: (e) => void toast.error(`Não foi possível vincular. ${e.message}`)
      }
    )
  }
  const desvincular = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Desfazer o vínculo com o SIGA?',
      description:
        'A produção que veio do SIGA e os vínculos de serviço, equipe, encarregado e local saem desta obra. Os lançamentos continuam no SIGA, e a obra volta a ser lançada no InfraWork.',
      confirmLabel: 'Desfazer o vínculo',
      variant: 'danger'
    })
    if (!ok) return
    acao.mutate(
      { acao: 'desvincular', obra_id: obraId },
      {
        onSuccess: () => void toast.success('Vínculo com o SIGA desfeito.'),
        onError: (e) => void toast.error(`Não foi possível desfazer o vínculo. ${e.message}`)
      }
    )
  }
  const sincronizar = (): void =>
    acao.mutate(
      { acao: 'sincronizar', obra_id: obraId },
      {
        onSuccess: (r) =>
          void toast.success(
            r.resumo
              ? `SIGA lido: ${contar(r.resumo.novos, 'lançamento novo', 'lançamentos novos')}, ${contar(r.resumo.alterados, 'alterado', 'alterados')}, ${contar(r.resumo.removidos, 'removido', 'removidos')}.`
              : 'SIGA lido.'
          ),
        onError: (e) => void toast.error(`Não foi possível ler o SIGA. ${e.message}`)
      }
    )

  return (
    <Secao titulo="Projeto do SIGA">
      {vinculo && !escolhendo ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold text-text">
                {vinculo.externo_projeto_codigo ?? `Projeto ${vinculo.externo_projeto_id}`}
              </p>
              <Badge variant="success">Vinculada</Badge>
            </div>
            <p className="mt-0.5 max-w-[75ch] text-sm text-text-muted">
              {vinculo.data_corte
                ? `Traz os lançamentos a partir de ${dia(vinculo.data_corte)}.`
                : 'Traz todos os lançamentos do projeto.'}
            </p>
            <p
              className={cn(
                'mt-0.5 max-w-[75ch] text-sm',
                vinculo.ultimo_sync_ok === false ? 'text-danger' : 'text-text-muted'
              )}
              data-testid="siga-ultima-sync"
            >
              {vinculo.ultimo_sync_em
                ? vinculo.ultimo_sync_ok === false
                  ? `A leitura de ${dataHora(vinculo.ultimo_sync_em)} falhou: ${vinculo.ultimo_sync_erro ?? 'sem mensagem do servidor'}`
                  : `Lido em ${dataHora(vinculo.ultimo_sync_em)}: ${resumoSync(vinculo)}.`
                : 'Ainda não foi lido. A leitura automática roda a cada 10 minutos.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={acao.isPending} onClick={sincronizar}>
              <RefreshCw size={12} className={cn(fazendo === 'sincronizar' && 'animate-spin')} />
              {fazendo === 'sincronizar' ? 'Lendo o SIGA…' : 'Atualizar agora'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={acao.isPending}
              onClick={() => {
                setProjeto(String(vinculo.externo_projeto_id))
                setCorte(vinculo.data_corte ?? '')
                setEscolhendo(true)
              }}
            >
              Trocar projeto
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={acao.isPending}
              onClick={() => void desvincular()}
            >
              <Unlink size={12} /> Desfazer o vínculo
            </Button>
          </div>
        </div>
      ) : projetos.isLoading ? (
        <Carregando texto="Lendo os projetos do SIGA…" />
      ) : projetos.error ? (
        <ErroConsulta
          erro={projetos.error}
          oQue="os projetos do SIGA"
          aoTentar={() => void projetos.refetch()}
          compacto
        />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Campo
            rotulo="Projeto"
            obrigatorio
            erro={tentou && !projeto ? 'Escolha o projeto do SIGA.' : null}
            className="min-w-[280px] flex-1"
          >
            <Select value={projeto} onChange={(e) => setProjeto(e.target.value)}>
              <option value="">Escolha o projeto</option>
              {(projetos.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo}
                  {p.obras ? ` · ${p.obras}` : ''}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo
            rotulo="Trazer a partir de"
            dica="Em branco, traz todos os lançamentos do projeto."
          >
            <Input type="date" value={corte} onChange={(e) => setCorte(e.target.value)} />
          </Campo>
          <div className="flex items-center gap-2 pb-0.5">
            <Button disabled={acao.isPending} onClick={() => void vincular()}>
              <Link2 size={13} /> {fazendo === 'vincular' ? 'Vinculando…' : 'Vincular'}
            </Button>
            {escolhendo ? (
              <Button
                variant="ghost"
                onClick={() => setEscolhendo(false)}
                disabled={acao.isPending}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </Secao>
  )
}

interface LinhaDePara {
  externo: CadastroSiga
  atual: DeParaSiga | null
}

/** Os cadastros do SIGA usados pelo projeto e o registro do InfraWork ligado a cada um. */
function DePara({ obraId }: { obraId: string }): ReactNode {
  const [aba, setAba] = useState<TipoDePara>('servico')
  const cadastros = useCadastrosSiga(obraId, true)
  const dePara = useDeParaSiga(obraId)
  const internos = useInternosDaObra(obraId)
  const acao = useVinculoSigaAcao()
  const info = ABAS.find((a) => a.tipo === aba)!

  const porAba = useMemo(() => {
    const out = {} as Record<TipoDePara, LinhaDePara[]>
    for (const a of ABAS) {
      const gravados = new Map(
        (dePara.data ?? []).filter((d) => d.tipo === a.tipo).map((d) => [d.externo_id, d])
      )
      out[a.tipo] = (cadastros.data?.[a.lista] ?? []).map((externo) => ({
        externo,
        atual: gravados.get(externo.id) ?? null
      }))
    }
    return out
  }, [cadastros.data, dePara.data])
  const faltam = (tipo: TipoDePara): number =>
    (porAba[tipo] ?? []).filter(
      (l) => l.externo.lancamentos > 0 && !l.atual?.interno_id && !l.atual?.ignorado
    ).length

  if (cadastros.isLoading || dePara.isLoading || internos.isLoading)
    return (
      <Secao titulo="Cadastros">
        <Carregando texto="Lendo os cadastros do projeto no SIGA…" />
      </Secao>
    )
  const erro = cadastros.error ?? dePara.error ?? internos.error
  if (erro || !cadastros.data || !internos.data)
    return (
      <Secao titulo="Cadastros">
        <ErroConsulta
          erro={erro}
          oQue="os cadastros do SIGA"
          aoTentar={() => {
            void cadastros.refetch()
            void dePara.refetch()
            void internos.refetch()
          }}
          compacto
        />
      </Secao>
    )

  const gravar = (linhas: Array<Record<string, unknown>>, ok: string): void =>
    acao.mutate(
      { acao: 'de_para', obra_id: obraId, linhas },
      {
        onSuccess: () => void toast.success(ok),
        onError: (e) => void toast.error(`Não foi possível gravar o vínculo. ${e.message}`)
      }
    )
  const linhaDe = (l: LinhaDePara, mudanca: Record<string, unknown>): Record<string, unknown> => ({
    tipo: aba,
    externo_id: l.externo.id,
    externo_nome: l.externo.nome,
    externo_unidade: l.externo.unidade ?? null,
    interno_id: l.atual?.interno_id ?? null,
    fator_conversao: l.atual?.fator_conversao ?? 1,
    principal: l.atual?.principal ?? true,
    ignorado: l.atual?.ignorado ?? false,
    ...(aba === 'equipe' && l.externo.encarregado_id
      ? { dados: { encarregado_id: l.externo.encarregado_id } }
      : {}),
    ...mudanca
  })
  // equipes e encarregados do SIGA que ainda não existem aqui: cria todos de uma vez, já vinculados
  const trazer = (): void => {
    const novas = (tipo: TipoDePara, lista: keyof ListasSiga): Array<Record<string, unknown>> =>
      (porAba[tipo] ?? [])
        .filter((l) => !l.atual?.interno_id)
        .map((l) => ({
          tipo,
          externo_id: l.externo.id,
          externo_nome: l.externo.nome,
          criar: true,
          principal: true,
          ...(lista === 'equipes' && l.externo.encarregado_id
            ? { dados: { encarregado_id: l.externo.encarregado_id } }
            : {})
        }))
    const linhas = [...novas('encarregado', 'encarregados'), ...novas('equipe', 'equipes')]
    if (linhas.length === 0) {
      toast.info('Todas as equipes e encarregados do SIGA já estão vinculados.')
      return
    }
    gravar(linhas, 'Equipes e encarregados do SIGA trazidos e vinculados.')
  }
  const linhas = porAba[aba] ?? []
  const opcoes = internos.data[aba]
  const totalFaltam = ABAS.reduce((s, a) => s + faltam(a.tipo), 0)

  return (
    <Secao
      titulo="Cadastros"
      nota={
        totalFaltam > 0
          ? `${contar(totalFaltam, 'cadastro com lançamento está sem vínculo', 'cadastros com lançamento estão sem vínculo')}.`
          : 'Tudo que tem lançamento está vinculado.'
      }
      acoes={
        <Button
          size="sm"
          variant="secondary"
          disabled={acao.isPending}
          onClick={trazer}
          title="Cria no InfraWork as equipes e os encarregados do SIGA que ainda não existem, já vinculados"
        >
          <UsersRound size={12} /> Trazer equipes e encarregados do SIGA
        </Button>
      }
    >
      <Segmentado<TipoDePara>
        rotulo="Tipo de cadastro"
        valor={aba}
        aoMudar={setAba}
        tamanho="sm"
        opcoes={ABAS.map((a) => ({
          valor: a.tipo,
          rotulo: faltam(a.tipo) > 0 ? `${a.rotulo} (${faltam(a.tipo)})` : a.rotulo,
          titulo:
            faltam(a.tipo) > 0
              ? `${contar(faltam(a.tipo), 'sem vínculo', 'sem vínculo')}`
              : undefined
        }))}
      />
      {linhas.length === 0 ? (
        <Vazio className="mt-3">O projeto não tem {info.rotulo.toLowerCase()} no SIGA.</Vazio>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-border">
          <table className="w-full min-w-[720px] text-sm" data-testid={`siga-de-para-${aba}`}>
            <thead>
              <tr className={CABECALHO}>
                <th className="px-4 py-2 text-left font-semibold">No SIGA</th>
                <th className="px-2 py-2 text-right font-semibold">Lançamentos</th>
                <th className="w-[38%] px-2 py-2 text-left font-semibold">{info.destino}</th>
                {aba === 'servico' ? (
                  <th
                    className="px-2 py-2 text-right font-semibold"
                    title="Quantidade no InfraWork = quantidade do SIGA × fator"
                  >
                    Fator
                  </th>
                ) : null}
                <th className="px-4 py-2 text-left font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const nome = `${l.externo.nome}${l.externo.unidade ? ` (${l.externo.unidade})` : ''}`
                const ligado = !!l.atual?.interno_id
                return (
                  <tr key={l.externo.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2">
                      <span className="font-medium text-text">{nome}</span>
                      {l.externo.encarregado ? (
                        <span className="block text-xs text-text-muted">
                          Encarregado: {l.externo.encarregado}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular text-text-muted">
                      {l.externo.lancamentos > 0
                        ? l.externo.lancamentos.toLocaleString('pt-BR')
                        : '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        aria-label={`${info.destino} de ${l.externo.nome}`}
                        value={l.atual?.ignorado ? '__fora' : (l.atual?.interno_id ?? '')}
                        disabled={acao.isPending}
                        title={acao.isPending ? 'Gravando…' : undefined}
                        onChange={(e) => {
                          const v = e.target.value
                          gravar(
                            [
                              linhaDe(
                                l,
                                v === '__fora'
                                  ? { interno_id: null, ignorado: true }
                                  : { interno_id: v || null, ignorado: false }
                              )
                            ],
                            v === '__fora'
                              ? `${l.externo.nome} fica fora do orçamento.`
                              : v
                                ? `${l.externo.nome} vinculado.`
                                : `Vínculo de ${l.externo.nome} desfeito.`
                          )
                        }}
                        className="h-8 w-full"
                      >
                        <option value="">Sem vínculo</option>
                        {opcoes.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nome}
                          </option>
                        ))}
                        {aba === 'servico' ? (
                          <option value="__fora">Fora do orçamento (não é pendência)</option>
                        ) : null}
                      </Select>
                    </td>
                    {aba === 'servico' ? (
                      <td className="px-2 py-1.5 text-right">
                        <Fator
                          key={`${l.externo.id}:${l.atual?.fator_conversao ?? 1}`}
                          nome={l.externo.nome}
                          valor={l.atual?.fator_conversao ?? 1}
                          desabilitado={!ligado || acao.isPending}
                          aoMudar={(f) =>
                            gravar(
                              [linhaDe(l, { fator_conversao: f })],
                              `Fator de ${l.externo.nome} alterado.`
                            )
                          }
                        />
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap px-4 py-2">
                      {l.atual?.ignorado ? (
                        <Badge variant="outline">Fora do orçamento</Badge>
                      ) : ligado ? (
                        <Badge variant="success">Vinculado</Badge>
                      ) : l.externo.lancamentos > 0 ? (
                        <Badge variant="warn">Sem vínculo</Badge>
                      ) : (
                        <span className="text-text-muted">Sem uso</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Secao>
  )
}

/** Fator de conversão do serviço: grava ao sair do campo, se mudou. */
function Fator({
  nome,
  valor,
  desabilitado,
  aoMudar
}: {
  nome: string
  valor: number
  desabilitado: boolean
  aoMudar: (fator: number) => void
}): ReactNode {
  const [texto, setTexto] = useState(numeroParaCampo(valor, 6))
  return (
    <InputMascara
      mascara="decimal"
      casas={6}
      aria-label={`Fator de conversão de ${nome}`}
      value={texto}
      disabled={desabilitado}
      title={desabilitado ? 'Vincule o serviço para informar o fator' : undefined}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        const n = parseNumero(texto)
        if (n == null || n <= 0) {
          setTexto(numeroParaCampo(valor, 6))
          return
        }
        if (Math.abs(n - valor) > 1e-9) aoMudar(n)
      }}
      className="h-8 w-28 text-right"
    />
  )
}
