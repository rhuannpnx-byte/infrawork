import { useState, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Printer, Ruler, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetBody, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EstadoConsulta } from '@/components/ui/estado'
import { IconButton } from '@/components/ui/IconButton'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { formatNumber } from '@/lib/format'
import { printHtmlToPdf } from '@/lib/print/print-html'
import { htmlTabelaTanque } from '@/lib/print/tabela-tanque'
import {
  contar,
  rotuloEstoqueMovimento,
  rotuloEstoqueStatus,
  rotuloEstoqueTipo,
  rotuloTanqueForma
} from '@/lib/rotulos'
import { useExcluirLinhaExtrato, useExtratoEstoque, useTabelaTanque } from '../hooks/estoque'
import { descreverTanque } from '../lib/formulario-tanque'
import { linhasDaFolha, nivelParaVolume } from '../lib/tanque'
import { situacaoDoEstoque, type SituacaoEstoque } from '../lib/situacao'
import type { AtivoEstoque, LinhaExtrato } from '../tipos'
import { DesenhoNivel } from './DesenhoNivel'

const VARIANTE: Record<SituacaoEstoque, 'success' | 'warn' | 'danger' | 'default'> = {
  normal: 'success',
  atencao: 'warn',
  baixo: 'danger',
  zerado: 'danger',
  negativo: 'danger',
  sem_saldo: 'default'
}

const qtd = (v: number, unidade: string): string =>
  `${formatNumber(v, Number.isInteger(v) ? 0 : 2)} ${unidade}`
const quando = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/** O que a linha do extrato foi, em uma frase. */
function descricao(l: LinhaExtrato, a: AtivoEstoque): string {
  if (l.origem === 'leitura') {
    const lida =
      l.leitura_cm != null
        ? `${a.leitura_por === 'vazio' ? 'vazio de' : 'régua em'} ${formatNumber(l.leitura_cm, 1)} cm`
        : 'medição do monte'
    return `${l.ajusta_saldo ? 'Leitura' : 'Leitura de conferência'}, ${lida}`
  }
  const partes = [rotuloEstoqueMovimento(l.tipo)]
  if (l.documento) partes.push(l.documento)
  if (l.terceiro) partes.push(l.terceiro)
  if (l.quantidade_informada != null && l.unidade_informada)
    partes.push(`${formatNumber(l.quantidade_informada, 3)} ${l.unidade_informada} na nota`)
  return partes.join(' · ')
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ativo: AtivoEstoque | null
  obraNome: string
  podeLancar: boolean
  podeCadastrar: boolean
  aoEditar: () => void
  aoLancar: (tipo: 'entrada' | 'saida') => void
  aoLer: () => void
}

/** Ficha do tanque ou depósito: nível, números, ações e o extrato com movimentos e leituras. */
export function FichaAtivo({
  open,
  onOpenChange,
  ativo,
  obraNome,
  podeLancar,
  podeCadastrar,
  aoEditar,
  aoLancar,
  aoLer
}: Props): ReactNode {
  return (
    <Sheet open={open && !!ativo} onOpenChange={onOpenChange} className="w-[560px]">
      {ativo ? (
        <Conteudo
          ativo={ativo}
          obraNome={obraNome}
          podeLancar={podeLancar}
          podeCadastrar={podeCadastrar}
          aoEditar={aoEditar}
          aoLancar={aoLancar}
          aoLer={aoLer}
        />
      ) : null}
    </Sheet>
  )
}

function Conteudo({
  ativo,
  obraNome,
  podeLancar,
  podeCadastrar,
  aoEditar,
  aoLancar,
  aoLer
}: Omit<Props, 'open' | 'onOpenChange' | 'ativo'> & { ativo: AtivoEstoque }): ReactNode {
  const ehTanque = ativo.tipo === 'tanque'
  const extrato = useExtratoEstoque(ativo.id)
  const { data: tabela } = useTabelaTanque(ehTanque ? ativo.id : null)
  const excluir = useExcluirLinhaExtrato()
  const confirmar = useConfirm()
  const [imprimindo, setImprimindo] = useState(false)
  const linhas = extrato.data ?? []
  const saldo = ativo.saldo
  // no tanque o desenho enche pela altura do líquido que dá aquele volume; no depósito, pela proporção do saldo
  const fracao =
    saldo == null
      ? null
      : ehTanque && tabela && tabela.length > 1
        ? nivelParaVolume(tabela, saldo) / (tabela.length - 1)
        : ativo.capacidade > 0
          ? saldo / ativo.capacidade
          : null

  const imprimir = async (): Promise<void> => {
    if (!tabela || tabela.length < 2 || !ativo.dimensoes) return
    setImprimindo(true)
    try {
      const html = htmlTabelaTanque({
        obra: obraNome,
        tanque: ativo.nome,
        material: ativo.material,
        formato: rotuloTanqueForma(ativo.forma ?? ''),
        medidas: descreverTanque(ativo.dimensoes),
        capacidadeLitros: ativo.capacidade,
        leituraPor: ativo.leitura_por,
        alturaReferenciaCm: ativo.altura_referencia_cm,
        linhas: linhasDaFolha(tabela, ativo.leitura_por, ativo.altura_referencia_cm)
          .filter((l) => l.leitura >= 0)
          .sort((a, b) => a.leitura - b.leitura)
      })
      await printHtmlToPdf(html, `Tabela de arqueação - ${ativo.nome}`)
    } catch (e) {
      toast.error(`Não foi possível preparar a tabela.${e instanceof Error ? ` ${e.message}` : ''}`)
    } finally {
      setImprimindo(false)
    }
  }

  const apagar = async (l: LinhaExtrato): Promise<void> => {
    const oQue =
      l.origem === 'leitura' ? 'esta leitura' : `esta ${l.tipo === 'entrada' ? 'entrada' : 'saída'}`
    const ok = await confirmar({
      title: `Excluir ${oQue}?`,
      description:
        l.origem === 'leitura' && l.ajusta_saldo
          ? 'O saldo volta a ser calculado pela leitura anterior e pelos lançamentos depois dela.'
          : 'O saldo é recalculado sem este lançamento.',
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await excluir.mutateAsync({ origem: l.origem, id: l.id })
      toast.success('Lançamento excluído.')
    } catch (e) {
      toast.error(`Não foi possível excluir.${e instanceof Error ? ` ${e.message}` : ''}`)
    }
  }

  const pct = ativo.nivel == null ? null : Math.round(ativo.nivel * 100)
  const situacao = situacaoDoEstoque(ativo)
  return (
    <>
      <SheetHeader>
        <SheetTitle>{ativo.nome}</SheetTitle>
        <p className="mt-0.5 text-sm text-text-muted">
          {rotuloEstoqueTipo(ativo.tipo)} de {ativo.material}
          {ehTanque && ativo.forma ? ` · ${rotuloTanqueForma(ativo.forma).toLowerCase()}` : ''}
        </p>
      </SheetHeader>
      <SheetBody className="space-y-4">
        <div className="flex items-center gap-4">
          <DesenhoNivel
            tanque={ehTanque ? ativo.dimensoes : null}
            fracao={fracao}
            status={situacao}
            rotulo={`${ativo.nome}: ${pct == null ? 'sem saldo' : `${pct}% da capacidade`}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-2xl font-semibold tabular text-text" data-testid="estoque-saldo">
                {saldo == null ? 'Sem saldo' : qtd(saldo, ativo.unidade)}
              </p>
              <Badge variant={VARIANTE[situacao]}>{rotuloEstoqueStatus(situacao)}</Badge>
            </div>
            <p className="text-sm text-text-muted">
              de {qtd(ativo.capacidade, ativo.unidade)}
              {pct != null ? ` (${pct}%)` : ''}
              {saldo != null && ehTanque && ativo.densidade_kg_l
                ? ` · ${formatNumber((saldo * ativo.densidade_kg_l) / 1000, 2)} t`
                : ''}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-text-muted">Estoque mínimo</dt>
              <dd className="tabular text-right text-text">
                {ativo.estoque_minimo > 0 ? qtd(ativo.estoque_minimo, ativo.unidade) : '—'}
              </dd>
              <dt className="text-text-muted">Autonomia</dt>
              <dd className="tabular text-right text-text">
                {ativo.autonomia_dias != null
                  ? contar(Math.round(ativo.autonomia_dias), 'dia', 'dias')
                  : '—'}
              </dd>
              <dt className="text-text-muted">Última leitura</dt>
              <dd className="tabular text-right text-text">
                {ativo.leitura_momento ? quando(ativo.leitura_momento) : '—'}
              </dd>
            </dl>
          </div>
        </div>
        {ativo.status === 'negativo' ? (
          <p className="text-sm text-danger">
            O saldo está negativo: falta lançar uma entrada ou registrar uma leitura.
          </p>
        ) : null}
        {ehTanque && ativo.dimensoes ? (
          <p className="text-xs text-text-muted">{descreverTanque(ativo.dimensoes)}.</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {podeLancar ? (
            <>
              <Button size="sm" onClick={aoLer}>
                <Ruler size={14} aria-hidden /> Registrar leitura
              </Button>
              <Button size="sm" variant="secondary" onClick={() => aoLancar('entrada')}>
                <ArrowDownToLine size={14} aria-hidden /> Lançar entrada
              </Button>
              <Button size="sm" variant="secondary" onClick={() => aoLancar('saida')}>
                <ArrowUpFromLine size={14} aria-hidden /> Lançar saída
              </Button>
            </>
          ) : null}
          {ehTanque ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void imprimir()}
              disabled={imprimindo || !tabela || tabela.length < 2}
              title={!tabela ? 'Carregando a tabela do tanque…' : undefined}
            >
              <Printer size={14} aria-hidden /> {imprimindo ? 'Preparando…' : 'Imprimir tabela'}
            </Button>
          ) : null}
          {podeCadastrar ? (
            <Button size="sm" variant="ghost" onClick={aoEditar}>
              <Pencil size={14} aria-hidden /> Editar
            </Button>
          ) : null}
        </div>

        <section aria-label="Extrato" className="rounded border border-border">
          <h3 className="border-b border-border px-3 py-2 text-sm font-semibold text-text">
            Extrato{' '}
            <span className="font-normal text-text-muted">
              {linhas.length > 0 ? contar(linhas.length, 'lançamento', 'lançamentos') : ''}
            </span>
          </h3>
          <EstadoConsulta
            consulta={extrato}
            oQue="o extrato"
            vazio={linhas.length === 0}
            textoVazio="Nenhum lançamento ainda. Registre a primeira leitura para dar o saldo inicial."
            className="px-3 py-3"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="estoque-extrato">
                <thead>
                  <tr className="border-b border-border bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                    <th className="px-3 py-1.5 text-left font-semibold">Quando</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Lançamento</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Quantidade</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Saldo</th>
                    <th className="w-9 px-1 py-1.5">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr
                      key={`${l.origem}-${l.id}`}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 tabular text-text-muted">
                        {quando(l.momento)}
                      </td>
                      <td className="px-2 py-1.5 text-text">
                        {descricao(l, ativo)}
                        {l.origem === 'leitura' && l.diferenca != null && l.diferenca !== 0 ? (
                          <span className="block text-xs text-warn">
                            diferença de {l.diferenca > 0 ? '+' : ''}
                            {qtd(l.diferenca, ativo.unidade)}
                          </span>
                        ) : null}
                        {l.obs ? (
                          <span className="block text-xs text-text-muted">{l.obs}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular text-text">
                        {l.tipo === 'saida' ? '−' : l.tipo === 'entrada' ? '+' : ''}
                        {qtd(l.quantidade, ativo.unidade)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-2 py-1.5 text-right tabular font-semibold ${l.saldo < 0 ? 'text-danger' : 'text-text'}`}
                      >
                        {qtd(l.saldo, ativo.unidade)}
                      </td>
                      <td className="px-1 py-1 text-right">
                        {podeLancar ? (
                          <IconButton
                            size="sm"
                            aria-label={`Excluir o lançamento de ${quando(l.momento)}`}
                            title="Excluir"
                            onClick={() => void apagar(l)}
                            disabled={excluir.isPending}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </EstadoConsulta>
        </section>
      </SheetBody>
    </>
  )
}
