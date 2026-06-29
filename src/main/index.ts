import { app, shell, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import { join } from 'path'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { parseExcelFile, type ParseMapping } from './import/parse-excel'
import { parseCpuExcelFile } from './import/parse-cpu-excel'
import { gerarMedicaoXlsx, type MedicaoExportPayload } from './export/medicao-xlsx'
import { gerarTabelaXlsx, type TabelaXlsxPayload } from './export/tabela-xlsx'
import { gerarRelatorioPdf } from './export/relatorio-pdf'
import { parseMsProjectXml } from './import/parse-msproject'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

const store = new Store<{
  window: WindowState
  preferences: Record<string, unknown>
}>({
  defaults: {
    window: { width: 1440, height: 900 },
    preferences: {}
  }
})

const windows = new Set<BrowserWindow>()

function createWindow(routeHash = ''): BrowserWindow {
  const saved = store.get('window')

  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    backgroundColor: '#08090b',
    // Win/Linux: frameless — barra de título customizada (estilo VSCode).
    // macOS mantém a moldura + hiddenInset, preservando os traffic lights nativos.
    frame: process.platform === 'darwin',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  windows.add(win)

  win.on('ready-to-show', () => {
    if (saved.maximized) win.maximize()
    win.show()
  })

  win.on('close', () => {
    if (!win.isDestroyed()) {
      const bounds = win.getBounds()
      store.set('window', {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized()
      })
    }
  })

  win.on('closed', () => {
    windows.delete(win)
  })

  // Notifica o renderer p/ alternar o ícone maximizar/restaurar nos controles custom.
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${routeHash ? `#${routeHash}` : ''}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: routeHash || undefined
    })
  }

  return win
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'InfraWork',
            submenu: [
              { role: 'about' as const, label: 'Sobre o InfraWork' },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Sair' }
            ]
          }
        ]
      : []),
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Nova janela',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow()
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Fechar janela' } : { role: 'quit', label: 'Sair' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' }
      ]
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'forceReload', label: 'Forçar recarregar' },
        { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom padrão' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' }
      ]
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'close', label: 'Fechar' }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Aprender mais',
          click: () => shell.openExternal('https://github.com')
        }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('br.com.tecpav.infrawork')

  app.on('browser-window-created', (_, w) => {
    optimizer.watchWindowShortcuts(w)
  })

  Menu.setApplicationMenu(buildMenu())

  // IPC channels — window
  ipcMain.handle('window:open', (_e, route: string) => {
    createWindow(route)
  })
  ipcMain.on('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.on('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
  ipcMain.handle(
    'window:is-maximized',
    (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false
  )

  // IPC channels — settings
  ipcMain.handle('settings:get', (_e, key: string) => {
    return store.get(`preferences.${key}`)
  })
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    store.set(`preferences.${key}`, value)
  })

  // IPC channels — orçamento/importação
  ipcMain.handle(
    'orcamento:escolher-arquivo',
    async (e): Promise<{ canceled: boolean; path?: string; name?: string; size?: number }> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return { canceled: true }
      const res = await dialog.showOpenDialog(win, {
        title: 'Selecione a planilha de orçamento',
        properties: ['openFile'],
        filters: [
          { name: 'Excel', extensions: ['xlsx', 'xlsm', 'xls'] },
          { name: 'Todos', extensions: ['*'] }
        ]
      })
      if (res.canceled || res.filePaths.length === 0) return { canceled: true }
      const file = res.filePaths[0]
      const st = await stat(file)
      return {
        canceled: false,
        path: file,
        name: file.split(/[\\/]/).pop() ?? file,
        size: st.size
      }
    }
  )

  ipcMain.handle(
    'orcamento:parse-excel',
    async (_e, params: { path: string; mapping: ParseMapping }) => {
      try {
        const result = await parseExcelFile(params.path, params.mapping)
        return { ok: true, result }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  ipcMain.handle('orcamento:parse-cpu-excel', async (_e, params: { path: string }) => {
    try {
      const result = await parseCpuExcelFile(params.path)
      return { ok: true, result }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle(
    'orcamento:upload-arquivo-bytes',
    async (_e, path: string): Promise<{ bytes: number[]; name: string; size: number }> => {
      const buf = await readFile(path)
      const st = await stat(path)
      return {
        bytes: Array.from(buf),
        name: path.split(/[\\/]/).pop() ?? path,
        size: st.size
      }
    }
  )

  // IPC channels — Documentação Oficial / ingestão
  // Lê os bytes do arquivo. Para placeholders OneDrive "apenas online", a própria
  // leitura força a HIDRATAÇÃO (o OneDrive baixa o arquivo) antes de devolver.
  ipcMain.handle(
    'documentacao:ler-arquivo-bytes',
    async (_e, path: string): Promise<{ bytes: number[]; name: string; size: number }> => {
      const buf = await readFile(path)
      return {
        bytes: Array.from(buf),
        name: path.split(/[\\/]/).pop() ?? path,
        size: buf.length
      }
    }
  )

  // IPC — export da medição (Valor Agregado) em .xlsx via dialog de salvar.
  ipcMain.handle(
    'medicao:export-xlsx',
    async (
      e,
      payload: MedicaoExportPayload
    ): Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return { ok: false, canceled: true }
      const limpar = (s: string): string => (s || '').replace(/[\\/:*?"<>|]/g, '-').trim()
      const nomeSeguro = limpar(payload.obraNome || 'obra').slice(0, 60)
      const periodo = limpar(payload.periodoArquivo)
      // Timestamp atual (YYYY-MM-DD HH-MM-SS) — garante nome único sempre.
      const ts = new Date()
      const p2 = (n: number): string => String(n).padStart(2, '0')
      const stamp =
        `${ts.getFullYear()}-${p2(ts.getMonth() + 1)}-${p2(ts.getDate())} ` +
        `${p2(ts.getHours())}-${p2(ts.getMinutes())}-${p2(ts.getSeconds())}`
      const base = periodo ? `Medição ${nomeSeguro} ${periodo}` : `Medição ${nomeSeguro}`
      const nomeArquivo = `${base} - ${stamp}.xlsx`
      const res = await dialog.showSaveDialog(win, {
        title: 'Exportar medição',
        defaultPath: nomeArquivo,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      try {
        await gerarMedicaoXlsx(payload, res.filePath)
        return { ok: true, canceled: false, path: res.filePath }
      } catch (err) {
        return {
          ok: false,
          canceled: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  // Nome de arquivo seguro com timestamp.
  const nomeComStamp = (base: string, ext: string): string => {
    const limpo = (base || 'export').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80)
    const ts = new Date()
    const p2 = (n: number): string => String(n).padStart(2, '0')
    const stamp =
      `${ts.getFullYear()}-${p2(ts.getMonth() + 1)}-${p2(ts.getDate())} ` +
      `${p2(ts.getHours())}-${p2(ts.getMinutes())}-${p2(ts.getSeconds())}`
    return `${limpo} - ${stamp}.${ext}`
  }

  // IPC — export genérico de tabela (Previsto × Realizado) em .xlsx.
  ipcMain.handle(
    'tabela:export-xlsx',
    async (
      e,
      payload: TabelaXlsxPayload
    ): Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return { ok: false, canceled: true }
      const res = await dialog.showSaveDialog(win, {
        title: 'Exportar tabela',
        defaultPath: nomeComStamp(payload.filenameBase, 'xlsx'),
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      try {
        await gerarTabelaXlsx(payload, res.filePath)
        return { ok: true, canceled: false, path: res.filePath }
      } catch (err) {
        return { ok: false, canceled: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // IPC — export do relatório por serviço em .pdf (HTML montado no renderer).
  ipcMain.handle(
    'relatorio:export-pdf',
    async (
      e,
      payload: { html: string; filenameBase: string }
    ): Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return { ok: false, canceled: true }
      const res = await dialog.showSaveDialog(win, {
        title: 'Exportar relatório',
        defaultPath: nomeComStamp(payload.filenameBase, 'pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      try {
        await gerarRelatorioPdf(payload.html, res.filePath)
        return { ok: true, canceled: false, path: res.filePath }
      } catch (err) {
        return { ok: false, canceled: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // IPC — cronograma ↔ MS Project XML
  ipcMain.handle(
    'cronograma:escolher-arquivo',
    async (e): Promise<{ canceled: boolean; path?: string; name?: string }> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return { canceled: true }
      const res = await dialog.showOpenDialog(win, {
        title: 'Importar cronograma do MS Project',
        filters: [{ name: 'MS Project XML', extensions: ['xml'] }],
        properties: ['openFile']
      })
      if (res.canceled || !res.filePaths[0]) return { canceled: true }
      const p = res.filePaths[0]
      return { canceled: false, path: p, name: p.split(/[\\/]/).pop() }
    }
  )

  ipcMain.handle('cronograma:parse-msproject', async (_e, params: { path: string }) => {
    try {
      const result = await parseMsProjectXml(params.path)
      return { ok: true as const, result }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'cronograma:export-xml',
    async (
      e,
      payload: { xml: string; filenameBase: string }
    ): Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return { ok: false, canceled: true }
      const res = await dialog.showSaveDialog(win, {
        title: 'Exportar cronograma para MS Project',
        defaultPath: nomeComStamp(payload.filenameBase, 'xml'),
        filters: [{ name: 'MS Project XML', extensions: ['xml'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      try {
        await writeFile(res.filePath, payload.xml, 'utf8')
        return { ok: true, canceled: false, path: res.filePath }
      } catch (err) {
        return { ok: false, canceled: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Auto-update via GitHub Releases. Em dev pulamos porque o electron-builder
  // só injeta `app-update.yml` em builds empacotados.
  if (!is.dev) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('update:available', { version: info.version })
      }
    })
    autoUpdater.on('update-downloaded', (info) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('update:downloaded', { version: info.version })
      }
    })
    autoUpdater.on('error', (err) => {
      console.warn('[updater] erro:', err?.message ?? err)
    })

    // Check inicial + a cada 4h enquanto o app estiver aberto.
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] check inicial falhou:', err?.message ?? err)
    })
    setInterval(
      () => {
        autoUpdater.checkForUpdates().catch(() => {})
      },
      4 * 60 * 60 * 1000
    )

    ipcMain.handle('update:check', async () => {
      try {
        const r = await autoUpdater.checkForUpdates()
        return { ok: true, version: r?.updateInfo?.version ?? null }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
    ipcMain.on('update:quit-and-install', () => {
      autoUpdater.quitAndInstall()
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
