import { app, shell, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import { join } from 'path'
import { readFile, stat } from 'node:fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import icon from '../../resources/icon.png?asset'
import { parseExcelFile, type ParseMapping } from './import/parse-excel'
import { parseCpuExcelFile } from './import/parse-cpu-excel'

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
    frame: true,
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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
