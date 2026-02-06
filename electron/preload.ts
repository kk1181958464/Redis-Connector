/**
 * Electron 预加载脚本
 * 在渲染进程中暴露安全的 API
 */

import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染进程的 API
const electronAPI = {
  // Redis 连接管理
  redis: {
    connect: (config: any) => ipcRenderer.invoke('redis:connect', config),
    disconnect: (connectionId: string) => ipcRenderer.invoke('redis:disconnect', connectionId),
    execute: (connectionId: string, command: string) => ipcRenderer.invoke('redis:execute', connectionId, command),
    pipeline: (connectionId: string, commands: string[]) => ipcRenderer.invoke('redis:pipeline', connectionId, commands),
    getStatus: (connectionId: string) => ipcRenderer.invoke('redis:getStatus', connectionId),
    listConnections: () => ipcRenderer.invoke('redis:listConnections'),
    test: (config: any) => ipcRenderer.invoke('redis:test', config),
    // Pub/Sub 订阅功能
    subscribe: (connectionId: string, channels: string[]) => ipcRenderer.invoke('redis:subscribe', connectionId, channels),
    unsubscribe: (connectionId: string, channels: string[]) => ipcRenderer.invoke('redis:unsubscribe', connectionId, channels),
    unsubscribeAll: (connectionId: string) => ipcRenderer.invoke('redis:unsubscribe-all', connectionId),
    getSubscriptions: (connectionId: string) => ipcRenderer.invoke('redis:get-subscriptions', connectionId),
  },

  // 连接配置存储
  config: {
    save: (configs: any[]) => ipcRenderer.invoke('config:save', configs),
    load: () => ipcRenderer.invoke('config:load'),
    export: () => ipcRenderer.invoke('config:export'),
    import: (data: any) => ipcRenderer.invoke('config:import', data),
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    quit: () => ipcRenderer.send('window:quit'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => {
      const subscription = (_event: any, isMaximized: boolean) => callback(isMaximized);
      ipcRenderer.on('window:maximized-change', subscription);
      return () => ipcRenderer.removeListener('window:maximized-change', subscription);
    },
  },

  // 事件监听
  on: (channel: string, callback: (...args: any[]) => void) => {
    const validChannels = ['redis:status', 'redis:error', 'redis:message', 'redis:pubsub-message'];
    if (validChannels.includes(channel)) {
      const subscription = (_event: any, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  },
};

// 暴露到 window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// TypeScript 类型声明
export type ElectronAPI = typeof electronAPI;
