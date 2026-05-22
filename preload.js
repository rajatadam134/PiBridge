const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pibridge', {
  // ===== Network Scanning =====
  scan: () => ipcRenderer.send('scan-network'),
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, data) => callback(data)),
  onScanComplete: (callback) => ipcRenderer.on('scan-complete', (event, data) => callback(data)),
  onTriggerScan: (callback) => ipcRenderer.on('trigger-scan', (event) => callback()),
  onTriggerSettings: (callback) => ipcRenderer.on('trigger-settings', (event) => callback()),

  // ===== SSH & VNC Enable =====
  connectVnc: (data) => ipcRenderer.send('connect-vnc', data),
  onVncResult: (callback) => ipcRenderer.on('vnc-result', (event, data) => callback(data)),

  // ===== VNC Launcher =====
  launchVnc: (ip) => ipcRenderer.send('launch-vnc', ip),
  onLaunchResult: (callback) => ipcRenderer.on('launch-result', (event, data) => callback(data)),

  // ===== Stats & System Control =====
  getPiStats: (data) => ipcRenderer.invoke('get-pi-stats', data),
  rebootPi: (data) => ipcRenderer.invoke('reboot-pi', data),
  shutdownPi: (data) => ipcRenderer.invoke('shutdown-pi', data),
  changeResolution: (data) => ipcRenderer.invoke('change-resolution', data),

  // ===== Settings =====
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // ===== Clipboard & External URLs =====
  copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
  openUrl: (url) => ipcRenderer.send('open-url', url),

  // ===== System Logs =====
  onLog: (callback) => ipcRenderer.on('log-message', (event, data) => callback(data)),

  // ===== SFTP File Explorer (v1.2.0) =====
  sftpListDir: (data) => ipcRenderer.invoke('sftp-list-dir', data),
  sftpReadFile: (data) => ipcRenderer.invoke('sftp-read-file', data),
  sftpWriteFile: (data) => ipcRenderer.invoke('sftp-write-file', data),
  sftpDelete: (data) => ipcRenderer.invoke('sftp-delete', data),
  sftpRename: (data) => ipcRenderer.invoke('sftp-rename', data),
  sftpMkdir: (data) => ipcRenderer.invoke('sftp-mkdir', data),
  sftpDownload: (data) => ipcRenderer.invoke('sftp-download', data),
  sftpUpload: (data) => ipcRenderer.invoke('sftp-upload', data),

  // ===== SSH Terminal (v1.2.0) =====
  terminalStart: (data) => ipcRenderer.invoke('terminal-start', data),
  terminalSend: (data) => ipcRenderer.invoke('terminal-send', data),
  terminalResize: (data) => ipcRenderer.invoke('terminal-resize', data),
  terminalClose: (data) => ipcRenderer.invoke('terminal-close', data),
  onTerminalData: (callback) => ipcRenderer.on('terminal-data', (event, data) => callback(data)),

  // ===== VNC Proxy (v1.2.0) =====
  vncProxyStart: (data) => ipcRenderer.invoke('vnc-proxy-start', data),
  vncProxyStop: (data) => ipcRenderer.invoke('vnc-proxy-stop', data),

  // ===== App Installer (v1.2.0) =====
  installerGetCatalog: () => ipcRenderer.invoke('installer-get-catalog'),
  installerCheckStatus: (data) => ipcRenderer.invoke('installer-check-status', data),
  installerInstall: (data) => ipcRenderer.invoke('installer-install', data),
  installerUninstall: (data) => ipcRenderer.invoke('installer-uninstall', data),

  // ===== SD Card Backup (v1.2.0) =====
  backupGetDiskInfo: (data) => ipcRenderer.invoke('backup-get-disk-info', data),
  backupStart: (data) => ipcRenderer.invoke('backup-start', data),
  backupCancel: (data) => ipcRenderer.invoke('backup-cancel', data),
  backupRestoreStart: (data) => ipcRenderer.invoke('backup-restore-start', data),
  backupSelectSavePath: () => ipcRenderer.invoke('backup-select-save-path'),
  backupSelectRestorePath: () => ipcRenderer.invoke('backup-select-restore-path'),
  onBackupProgress: (callback) => ipcRenderer.on('backup-progress', (event, data) => callback(data)),

  // ===== Auto Updater =====
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  updaterDownload: () => ipcRenderer.invoke('updater-download'),
  updaterInstall: () => ipcRenderer.invoke('updater-install'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status-changed', (event, data) => callback(data)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, percent) => callback(percent)),

  // ===== Platform Info =====
  platform: process.platform
});
