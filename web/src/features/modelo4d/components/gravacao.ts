/**
 * Grava a simulação em vídeo: a cena é desenhada quadro a quadro numa tela à parte, com o texto por cima, e o
 * `MediaRecorder` do navegador monta o arquivo. O ritmo é o do relógio: se a máquina não der conta de um quadro no
 * tempo dele, o vídeo sai um pouco mais longo, nunca truncado.
 */

export interface PedidoDeVideo {
  largura: number
  altura: number
  /** Duração do vídeo, em segundos. */
  duracao: number
  inicio: number
  fim: number
  /** Põe a cena no instante `t` e devolve a tela já desenhada. */
  quadro: (t: number) => Promise<HTMLCanvasElement | null>
  /** Linhas escritas no canto do vídeo (vazio = sem texto). */
  texto: (t: number) => string[]
  aoAvancar: (fracao: number) => void
  sinal: AbortSignal
}

const QUADROS_POR_SEGUNDO = 24

const FORMATOS = ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=vp9', 'video/webm']

/** Formato que este navegador grava, ou `null` quando ele não grava vídeo. */
export function formatoDeVideo(): { tipo: string; extensao: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  const tipo = FORMATOS.find((f) => MediaRecorder.isTypeSupported(f))
  return tipo ? { tipo, extensao: tipo.startsWith('video/mp4') ? 'mp4' : 'webm' } : null
}

const espera = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, Math.max(0, ms)))

export async function gravarSimulacao(p: PedidoDeVideo): Promise<Blob | null> {
  const formato = formatoDeVideo()
  if (!formato) throw new Error('Este navegador não grava vídeo.')
  const tela = document.createElement('canvas')
  tela.width = p.largura
  tela.height = p.altura
  const ctx = tela.getContext('2d')
  if (!ctx) throw new Error('Não foi possível preparar a tela do vídeo.')
  const fluxo = tela.captureStream(0)
  const trilha = fluxo.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  const gravador = new MediaRecorder(fluxo, {
    mimeType: formato.tipo,
    videoBitsPerSecond: p.altura >= 1080 ? 12_000_000 : 7_000_000
  })
  const partes: Blob[] = []
  gravador.ondataavailable = (e) => {
    if (e.data.size) partes.push(e.data)
  }
  const fim = new Promise<void>((ok) => {
    gravador.onstop = () => ok()
  })
  gravador.start()

  const estilo = getComputedStyle(document.documentElement)
  // as mesmas cores dos textos sobre foto do tema; sem o tema, as cores de sistema do navegador
  const fundo = estilo.getPropertyValue('--sobre-foto').trim() || 'CanvasText'
  const letra = estilo.getPropertyValue('--na-foto').trim() || 'Canvas'
  const fonte = estilo.getPropertyValue('font-family') || 'sans-serif'
  const total = Math.max(2, Math.round(p.duracao * QUADROS_POR_SEGUNDO))
  const comeco = performance.now()
  try {
    for (let k = 0; k < total; k++) {
      if (p.sinal.aborted) return null
      const t = p.inicio + ((p.fim - p.inicio) * k) / (total - 1)
      const cena = await p.quadro(t)
      if (cena) {
        // a cena preenche o quadro, cortando as sobras (como "cover")
        const escala = Math.max(p.largura / cena.width, p.altura / cena.height)
        const l = cena.width * escala
        const a = cena.height * escala
        ctx.drawImage(cena, (p.largura - l) / 2, (p.altura - a) / 2, l, a)
      }
      const linhas = p.texto(t)
      if (linhas.length) {
        const corpo = Math.round(p.altura / 34)
        const alto = corpo * 1.45
        ctx.font = `600 ${corpo}px ${fonte}`
        const largo = Math.max(...linhas.map((x) => ctx.measureText(x).width)) + corpo * 1.4
        const x0 = corpo
        const y0 = p.altura - corpo - alto * linhas.length - corpo * 0.6
        ctx.fillStyle = fundo
        ctx.fillRect(x0, y0, largo, alto * linhas.length + corpo * 0.6)
        ctx.fillStyle = letra
        ctx.textBaseline = 'top'
        linhas.forEach((x, i) => {
          ctx.font = `${i === 0 ? 700 : 500} ${corpo}px ${fonte}`
          ctx.fillText(x, x0 + corpo * 0.7, y0 + corpo * 0.4 + alto * i)
        })
      }
      trilha.requestFrame?.()
      p.aoAvancar((k + 1) / total)
      await espera(comeco + ((k + 1) * 1000) / QUADROS_POR_SEGUNDO - performance.now())
    }
  } finally {
    gravador.stop()
    await fim
    for (const t of fluxo.getTracks()) t.stop()
  }
  return new Blob(partes, { type: formato.tipo.split(';')[0] })
}

/** Entrega o arquivo ao usuário pelo navegador. */
export function baixar(arquivo: Blob, nome: string): void {
  const url = URL.createObjectURL(arquivo)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
