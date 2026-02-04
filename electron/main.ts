/**
 * Electron 主进程入口
 */

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { setupRedisHandlers } from './ipc/redis-handler';

// 开发模式判断
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// 获取图标路径
function getIconPath(): string {
  if (isDev) {
    // 开发模式：从项目根目录的 public 文件夹加载
    // __dirname 是 dist/electron/electron/，需要回退到项目根目录
    return path.join(__dirname, '../../../public/icon.png');
  }
  // 打包后的路径
  return path.join(process.resourcesPath, 'icon.png');
}

async function createWindow(): Promise<void> {
  const iconPath = getIconPath();
  console.log('Icon path:', iconPath);
  console.log('__dirname:', __dirname);

  // 使用 nativeImage 加载图标并调整大小
  let icon = nativeImage.createFromPath(iconPath);
  console.log('Icon loaded:', !icon.isEmpty(), 'Original size:', icon.getSize());

  // 调整图标大小为 256x256（Windows 推荐尺寸）
  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 256, height: 256 });
    console.log('Icon resized to:', icon.getSize());
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Redis Connector',
    icon: icon.isEmpty() ? undefined : icon,
    frame: false,  // 无边框窗口
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  // 窗口准备好后显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 加载页面
  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
    // DevTools 可手动通过 Ctrl+Shift+I 打开
    // mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 点击关闭按钮时最小化到托盘而不是退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

// 创建系统托盘
function createTray(): void {
  const iconPath = getIconPath();
  let icon = nativeImage.createFromPath(iconPath);

  // 托盘图标需要较小尺寸，调整大小
  if (!icon.isEmpty()) {
    // Windows 托盘图标推荐 16x16 或 32x32
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip('Redis Connector');

  // 托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      type: 'separator',
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 点击托盘图标显示窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// 应用就绪
app.whenReady().then(async () => {
  // 隐藏默认菜单栏
  Menu.setApplicationMenu(null);

  // 设置 IPC 处理器
  setupRedisHandlers();

  // 设置窗口控制 IPC
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  await createWindow();

  // 监听窗口最大化状态变化
  mainWindow?.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-change', true);
  });

  mainWindow?.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-change', false);
  });

  // 创建系统托盘
  createTray();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// 所有窗口关闭时的处理
app.on('window-all-closed', () => {
  // 不退出应用，保持托盘运行
  // 仅在 isQuitting 为 true 时才真正退出
  if (isQuitting) {
    app.quit();
  }
});

// 应用退出前清理托盘
app.on('before-quit', () => {
  isQuitting = true;
});

// 安全：阻止新窗口创建
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
