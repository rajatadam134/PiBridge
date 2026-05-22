const { app, BrowserWindow, ipcMain, shell, clipboard, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const net = require('net');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const { Client } = require('ssh2');
const { autoUpdater } = require('electron-updater');

// Configure autoUpdater
autoUpdater.autoDownload = false;
autoUpdater.logger = console;

// Windows: Group taskbar button under the correct app name/icon
if (process.platform === 'win32') {
  app.setAppUserModelId('com.pibridge.app');
}

// Constants
const PI_OUIs = [
  'b8:27:eb',
  'dc:a6:32',
  'e4:5f:01',
  'd8:3a:dd',
  '2c:cf:67',
  '3a:35:41',
  'e8:16:56',
  'f8:c1:f1'
];

let mainWindow = null;
let splashWindow = null;

// Resolve icon path
const ICON_PATH = path.join(__dirname, 'src', 'icon.png');
const SPLASH_PATH = path.join(__dirname, 'splash.html');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// Load icon as a NativeImage to prevent packaging warnings on Windows
let appIcon = undefined;
try {
  if (fs.existsSync(ICON_PATH)) {
    const iconBuffer = fs.readFileSync(ICON_PATH);
    appIcon = nativeImage.createFromBuffer(iconBuffer);
  }
} catch (e) {
  console.error('Failed to load application icon:', e);
}

// Default Settings
let settings = {
  sshUsername: 'pi',
  sshPassword: 'raspberry',
  customVncPath: '',
  scanTimeout: 1000,
  scanConcurrency: 45,
  demoMode: false
};

// Load settings
try {
  if (fs.existsSync(settingsPath)) {
    const data = fs.readFileSync(settingsPath, 'utf8');
    settings = { ...settings, ...JSON.parse(data) };
  }
} catch (e) {
  console.error('Failed to load settings:', e);
}

function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function createMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Scan Network',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('trigger-scan');
            }
          }
        },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('trigger-settings');
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/raspberrypi/documentation');
          }
        },
        {
          label: 'PiBridge Documentation',
          click: async () => {
            await shell.openExternal('https://www.realvnc.com/en/connect/download/viewer/raspberrypi/');
          }
        },
        { type: 'separator' },
        {
          label: 'About PiBridge',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About PiBridge',
              message: 'PiBridge v1.2.0',
              detail: 'A premium remote management tool for Raspberry Pi devices on your network.\n\nDeveloped with electron & ssh2.',
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createSplashWindow() {
  const splashOptions = {
    width: 420,
    height: 320,
    frame: false,
    transparent: false,
    backgroundColor: '#07070f',
    show: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  if (appIcon) {
    splashOptions.icon = appIcon;
  }

  splashWindow = new BrowserWindow(splashOptions);

  splashWindow.loadFile(SPLASH_PATH);
  splashWindow.setMenuBarVisibility(false);

  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });
}

function getFriendlyErrorMessage(err) {
  if (!err) return 'An unknown error occurred.';
  const msg = typeof err === 'string' ? err : (err.message || err.toString());
  if (msg.includes('ERR_NAME_NOT_RESOLVED') || 
      msg.includes('ERR_CONNECTION_REFUSED') || 
      msg.includes('ERR_INTERNET_DISCONNECTED') || 
      msg.includes('ERR_TIMED_OUT') || 
      msg.includes('ERR_CONNECTION_TIMED_OUT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('EAI_AGAIN')) {
    return 'Could not reach the update server. Please check your network connection.';
  }
  return msg;
}

// Auto Updater Listeners
function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus('not-available', info);
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus('error', getFriendlyErrorMessage(err));
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', Math.round(progressObj.percent));
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('downloaded', info);
  });
}

function sendUpdateStatus(status, data = null) {
  logToUi(`[Updater] Status changed: ${status}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status-changed', { status, data });
  }
}

function createWindow() {
  const windowOptions = {
    width: 1080,
    height: 780,
    minWidth: 950,
    minHeight: 680,
    show: false, // Hidden until ready-to-show fires
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'PiBridge - Raspberry Pi Remote Manager'
  };

  if (appIcon) {
    windowOptions.icon = appIcon;
  }

  if (process.platform === 'win32') {
    windowOptions.titleBarOverlay = {
      color: '#07070f',
      symbolColor: '#f3f4f6',
      height: 40
    };
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Register developer shortcuts on window webContents
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      const isCtrlShiftI = input.control && input.shift && input.key.toLowerCase() === 'i';
      const isF12 = input.key === 'F12';
      if (isCtrlShiftI || isF12) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }

      const isCtrlR = input.control && input.key.toLowerCase() === 'r';
      const isF5 = input.key === 'F5';
      if (isCtrlR || isF5) {
        mainWindow.webContents.reload();
        event.preventDefault();
      }
    }
  });

  // Redirect renderer console messages to main process stdout
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [Level ${level}] ${message} (at ${path.basename(sourceId)}:${line})`);
  });

  mainWindow.loadFile('index.html');

  let isShown = false;
  const showMainWindow = (reason) => {
    if (isShown) return;
    isShown = true;
    console.log(`[System] Showing main window (triggered by ${reason})`);
    
    // Give splash a moment to finish its loading animation
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }, 400);
  };

  // Show main window and close splash when fully loaded
  mainWindow.once('ready-to-show', () => {
    showMainWindow('ready-to-show');
  });

  mainWindow.webContents.once('did-finish-load', () => {
    showMainWindow('did-finish-load');
  });

  // Safety fallback: force show main window after 3.5 seconds
  setTimeout(() => {
    if (!isShown) {
      showMainWindow('safety-timeout');
    }
  }, 3500);
}

app.whenReady().then(() => {
  createSplashWindow();
  createWindow();
  createMenu();
  setupAutoUpdater();

  // Initial check on launch
  setTimeout(() => {
    if (!settings.demoMode) {
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        console.error('Failed initial update check:', err);
      });
    }
  }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Helper: Send log to renderer
function logToUi(message) {
  console.log(message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', `[${new Date().toLocaleTimeString()}] ${message}`);
  }
}

// IP & Netmask Helpers
function ipToInt(ip) {
  return ip.split('.').reduce((int, octet) => (int << 8) + parseInt(octet, 10), 0) >>> 0;
}

// Netmask to prefix converter
function intToIp(int) {
  return [
    (int >>> 24) & 0xff,
    (int >>> 16) & 0xff,
    (int >>> 8) & 0xff,
    int & 0xff
  ].join('.');
}

function getIpRange(ip, netmask) {
  try {
    const ipInt = ipToInt(ip);
    const maskInt = ipToInt(netmask);
    const networkInt = (ipInt & maskInt) >>> 0;
    const broadcastInt = (networkInt | ~maskInt) >>> 0;
    const totalIps = broadcastInt - networkInt - 1;
    
    const ips = [];
    if (totalIps <= 0) return ips;
    
    if (totalIps > 1024) {
      logToUi(`Subnet too large (${totalIps} hosts). Scanning local /24 segment around ${ip}...`);
      const localNetworkInt = (ipInt & 0xffffff00) >>> 0;
      for (let i = 1; i <= 254; i++) {
        const currentIpInt = (localNetworkInt + i) >>> 0;
        if (currentIpInt !== ipInt) {
          ips.push(intToIp(currentIpInt));
        }
      }
    } else {
      for (let i = networkInt + 1; i < broadcastInt; i++) {
        if (i !== ipInt) {
          ips.push(intToIp(i));
        }
      }
    }
    return ips;
  } catch (err) {
    logToUi(`Error generating IP range: ${err.message}`);
    return [];
  }
}

function checkPort(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(true);
      }
    });

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    };

    socket.on('error', cleanup);
    socket.on('timeout', cleanup);
    socket.connect(port, host);
  });
}

// ARP Parser
function parseArpOutput(stdout, targetIp) {
  const lines = stdout.split('\n');
  const ipRegex = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/;
  const macRegex = /\b(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b/;

  for (const line of lines) {
    if (line.includes(targetIp)) {
      const ipMatch = line.match(ipRegex);
      const macMatch = line.match(macRegex);
      if (ipMatch && macMatch && ipMatch[0] === targetIp) {
        return macMatch[0].toLowerCase().replace(/-/g, ':');
      }
    }
  }
  return null;
}

function getMacForIp(ip) {
  return new Promise((resolve) => {
    let cmd = 'arp -a';
    if (process.platform === 'win32') {
      cmd = `arp -a ${ip}`;
    } else if (process.platform === 'darwin') {
      cmd = `arp ${ip}`;
    } else {
      cmd = `arp -n ${ip}`;
    }

    exec(cmd, (error, stdout) => {
      if (error) {
        exec('arp -a', (err2, stdout2) => {
          if (err2) {
            resolve(null);
          } else {
            resolve(parseArpOutput(stdout2, ip));
          }
        });
        return;
      }
      resolve(parseArpOutput(stdout, ip));
    });
  });
}

function checkIsRaspberryPi(mac) {
  if (!mac) return false;
  const prefix = mac.toLowerCase().substring(0, 8);
  return PI_OUIs.includes(prefix);
}

// Get network interfaces
function getLocalSubnets() {
  const interfaces = os.networkInterfaces();
  const subnets = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        subnets.push({
          interface: name,
          ip: iface.address,
          netmask: iface.netmask
        });
      }
    }
  }
  return subnets;
}

// Scan network handler
ipcMain.on('scan-network', async (event) => {
  logToUi('Starting network scan...');

  // DEMO MODE SIMULATION
  if (settings.demoMode) {
    logToUi('[Demo Mode] Simulating subnet discovery on Interface wlan0 (192.168.1.15)...');
    
    const demoDevices = [
      { ip: '192.168.1.102', mac: 'd8:3a:dd:2b:8c:1f', sshOpen: true, vncOpen: false, isPi: true },
      { ip: '192.168.1.121', mac: 'b8:27:eb:e4:af:2d', sshOpen: true, vncOpen: true, isPi: true },
      { ip: '192.168.1.155', mac: '4c:d5:77:fa:e8:11', sshOpen: true, vncOpen: false, isPi: false }
    ];

    for (let p = 10; p <= 100; p += 15) {
      await new Promise(r => setTimeout(r, 200));
      event.sender.send('scan-progress', { progress: p, deviceFound: null });
      
      // Inject device 1
      if (p === 25) {
        logToUi(`[Demo Mode] Found active SSH service on ${demoDevices[0].ip}. Retrieving MAC...`);
        logToUi(`[Demo Mode] MAC matched Pi OUI: ${demoDevices[0].mac}`);
        event.sender.send('scan-progress', { progress: p, deviceFound: demoDevices[0] });
      }
      
      // Inject device 2
      if (p === 55) {
        logToUi(`[Demo Mode] Found active SSH service on ${demoDevices[1].ip}. Retrieving MAC...`);
        logToUi(`[Demo Mode] MAC matched Pi OUI: ${demoDevices[1].mac}`);
        event.sender.send('scan-progress', { progress: p, deviceFound: demoDevices[1] });
      }

      // Inject device 3
      if (p === 85) {
        logToUi(`[Demo Mode] Found active SSH service on ${demoDevices[2].ip}. Retrieving MAC...`);
        logToUi(`[Demo Mode] MAC did not match Pi OUI. Labeling as potential target.`);
        event.sender.send('scan-progress', { progress: p, deviceFound: demoDevices[2] });
      }
    }

    event.sender.send('scan-complete', demoDevices);
    return;
  }

  // REAL MODE SCANNING
  const subnets = getLocalSubnets();
  if (subnets.length === 0) {
    logToUi('Error: No active network interfaces found.');
    event.sender.send('scan-complete', []);
    return;
  }

  let allIps = [];
  for (const subnet of subnets) {
    logToUi(`Found active network interface: ${subnet.interface} (${subnet.ip} / ${subnet.netmask})`);
    const ips = getIpRange(subnet.ip, subnet.netmask);
    allIps = allIps.concat(ips);
  }

  allIps = [...new Set(allIps)];
  const total = allIps.length;
  
  if (total === 0) {
    logToUi('Error: No valid subnet IP addresses calculated.');
    event.sender.send('scan-complete', []);
    return;
  }

  logToUi(`Total IPs to check: ${total}`);

  let completed = 0;
  const concurrency = settings.scanConcurrency;
  const timeout = settings.scanTimeout;

  const devicesFound = [];

  for (let i = 0; i < total; i += concurrency) {
    const chunk = allIps.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (ip) => {
      try {
        const isSshOpen = await checkPort(ip, 22, timeout);
        
        if (isSshOpen) {
          logToUi(`Found active SSH service on ${ip}. Retrieving MAC...`);
          const isVncOpen = await checkPort(ip, 5900, timeout);
          const mac = await getMacForIp(ip);
          const isPi = checkIsRaspberryPi(mac);
          
          const device = {
            ip,
            mac: mac || 'Unknown',
            sshOpen: true,
            vncOpen: isVncOpen,
            isPi: isPi
          };

          devicesFound.push(device);
          event.sender.send('scan-progress', {
            progress: Math.round((completed / total) * 100),
            deviceFound: device
          });
        }
      } catch (err) {
        logToUi(`Scan error on ${ip}: ${err.message}`);
      } finally {
        completed++;
      }
    }));

    event.sender.send('scan-progress', {
      progress: Math.round((completed / total) * 100),
      deviceFound: null
    });
  }

  logToUi(`Scan complete. Discovered ${devicesFound.length} device(s) with SSH enabled.`);
  event.sender.send('scan-complete', devicesFound);
});

// SSH Enable VNC handler
ipcMain.on('connect-vnc', async (event, data) => {
  const { ip, username, password } = data;
  logToUi(`Connecting to SSH at ${username}@${ip}...`);

  // DEMO MODE SIMULATION
  if (settings.demoMode) {
    await new Promise(r => setTimeout(r, 1500));
    logToUi(`[Demo Mode] SSH Connection successful with ${ip}.`);
    logToUi(`[Demo Mode] Activating VNC Server via raspi-config...`);
    await new Promise(r => setTimeout(r, 1000));
    logToUi(`[Demo Mode] VNC Server activated successfully! Port 5900 open.`);
    event.sender.send('vnc-result', { success: true, ip, vncOpen: true });
    return;
  }

  // REAL MODE SSH
  const conn = new Client();
  conn.on('ready', () => {
    logToUi(`SSH connection successful with ${ip}.`);
    const cmd = `echo '${password}' | sudo -S raspi-config nonint do_vnc 0`;
    logToUi(`Activating VNC Server...`);
    
    conn.exec(cmd, (err, stream) => {
      if (err) {
        logToUi(`Failed to execute VNC activation command: ${err.message}`);
        conn.end();
        event.sender.send('vnc-result', { success: false, ip, error: err.message });
        return;
      }
      
      let outData = '';
      let errData = '';
      
      stream.on('close', async (code) => {
        conn.end();
        logToUi(`VNC activation process exited with code: ${code}`);
        
        if (code === 0 || code === null) {
          logToUi(`Checking if VNC Server port 5900 is open...`);
          setTimeout(async () => {
            const isVncOpen = await checkPort(ip, 5900, 1500);
            if (isVncOpen) {
              logToUi(`Success! VNC Server is active and listening on port 5900 on ${ip}.`);
              event.sender.send('vnc-result', { success: true, ip, vncOpen: true });
            } else {
              logToUi(`VNC Server reported enabled but port 5900 is not responding yet.`);
              event.sender.send('vnc-result', { success: true, ip, vncOpen: false, warning: 'Service enabled, but port 5900 is not listening yet.' });
            }
          }, 1500);
        } else {
          const errMsg = errData.trim() || outData.trim() || 'Unknown error during config activation.';
          logToUi(`Error enabling VNC: ${errMsg}`);
          event.sender.send('vnc-result', { success: false, ip, error: errMsg });
        }
      });
      
      stream.on('data', (d) => { outData += d.toString(); });
      stream.stderr.on('data', (d) => { errData += d.toString(); });
    });
  });
  
  conn.on('error', (err) => {
    logToUi(`SSH Connection Error to ${ip}: ${err.message}`);
    event.sender.send('vnc-result', { success: false, ip, error: err.message });
  });
  
  conn.connect({
    host: ip,
    port: 22,
    username: username,
    password: password,
    readyTimeout: 10000
  });
});

// Launch VNC Viewer handler
ipcMain.on('launch-vnc', async (event, ip) => {
  logToUi(`Attempting to launch VNC Viewer for ${ip}...`);

  // DEMO MODE SIMULATION
  if (settings.demoMode) {
    logToUi(`[Demo Mode] Simulated VNC Viewer launch for IP: ${ip}`);
    clipboard.writeText(ip);
    logToUi(`[Demo Mode] Copied ${ip} to clipboard for convenience.`);
    event.sender.send('launch-result', { success: true, ip });
    return;
  }

  // REAL MODE LAUNCHER
  if (settings.customVncPath && fs.existsSync(settings.customVncPath)) {
    logToUi(`Launching custom VNC executable: ${settings.customVncPath}`);
    try {
      const child = spawn(settings.customVncPath, [ip], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      event.sender.send('launch-result', { success: true, ip });
      return;
    } catch (e) {
      logToUi(`Error spawning custom VNC Viewer: ${e.message}`);
    }
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '';
    const commonPaths = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'RealVNC', 'VNC Viewer', 'vncviewer.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'RealVNC', 'VNC Viewer', 'vncviewer.exe'),
      path.join(localAppData, 'Programs', 'RealVNC', 'VNC Viewer', 'vncviewer.exe'),
      'vncviewer.exe'
    ];

    for (const p of commonPaths) {
      if (p === 'vncviewer.exe' || fs.existsSync(p)) {
        logToUi(`Launching RealVNC Viewer: ${p}`);
        try {
          const child = spawn(p, [ip], {
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
          event.sender.send('launch-result', { success: true, ip });
          return;
        } catch (err) {
          // ignore
        }
      }
    }
    
    clipboard.writeText(ip);
    logToUi(`VNC Viewer not found. Copied ${ip} to clipboard.`);
    event.sender.send('launch-result', { 
      success: false, 
      ip, 
      error: 'VNC Viewer was not found in common paths. Connection details copied to clipboard instead!' 
    });
  } 
  else if (process.platform === 'darwin') {
    logToUi(`Launching macOS native Screen Sharing for vnc://${ip}`);
    exec(`open vnc://${ip}`, (err) => {
      if (err) {
        logToUi(`Failed to launch macOS Screen Sharing: ${err.message}`);
        clipboard.writeText(ip);
        event.sender.send('launch-result', { success: false, ip, error: `Screen Sharing failed: ${err.message}` });
      } else {
        event.sender.send('launch-result', { success: true, ip });
      }
    });
  } 
  else {
    const clients = ['vncviewer', 'tightvncviewer', 'vinagre', 'gvncviewer'];
    let launched = false;

    for (const client of clients) {
      try {
        const hasClient = await new Promise((res) => {
          exec(`which ${client}`, (e) => res(!e));
        });

        if (hasClient) {
          logToUi(`Launching Linux VNC Client: ${client} ${ip}`);
          const child = spawn(client, [ip], {
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
          event.sender.send('launch-result', { success: true, ip });
          launched = true;
          break;
        }
      } catch (e) {
        // ignore
      }
    }

    if (!launched) {
      clipboard.writeText(ip);
      logToUi(`No Linux VNC clients found in PATH. Copied ${ip} to clipboard.`);
      event.sender.send('launch-result', { 
        success: false, 
        ip, 
        error: 'No compatible VNC client was found in your system PATH. The IP has been copied to your clipboard.' 
      });
    }
  }
});

// IPC Handler: Get Stats over SSH
ipcMain.handle('get-pi-stats', async (event, data) => {
  const { ip, username, password } = data;

  // DEMO MODE SIMULATION
  if (settings.demoMode) {
    const mockTemp = (40 + Math.random() * 20).toFixed(1);
    const mockRamTotal = 3791;
    const mockRamUsed = Math.floor(1000 + Math.random() * 1500);
    const mockDiskTotal = '29G';
    const mockDiskUsed = '4.6G';
    const mockDiskPercent = Math.floor(15 + Math.random() * 3);
    const mockOS = 'Raspberry Pi OS (Bookworm) [Simulated]';

    return {
      success: true,
      temp: `${mockTemp}°C`,
      ramUsed: mockRamUsed,
      ramTotal: mockRamTotal,
      ramPercent: Math.round((mockRamUsed / mockRamTotal) * 100),
      diskUsed: mockDiskUsed,
      diskTotal: mockDiskTotal,
      diskPercent: mockDiskPercent,
      osVersion: mockOS
    };
  }

  // REAL MODE STATS FETCH
  return new Promise((resolve) => {
    const conn = new Client();
    
    conn.on('ready', () => {
      // Elegant unified Linux info extraction script
      const cmd = `vcgencmd measure_temp 2>/dev/null || (cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{print "temp="$1/1000}') || echo "temp=N/A"; echo "---MEM---"; free -m; echo "---DISK---"; df -h /; echo "---OS---"; cat /etc/os-release | grep PRETTY_NAME`;
      
      conn.exec(cmd, (err, stream) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }
        
        let rawOutput = '';
        stream.on('data', (chunk) => { rawOutput += chunk.toString(); });
        stream.on('close', () => {
          conn.end();
          
          try {
            // Parse stdout segments
            const stats = parseSshStats(rawOutput);
            resolve({ success: true, ...stats });
          } catch (e) {
            resolve({ success: false, error: `Parsing error: ${e.message}` });
          }
        });
      });
    });

    conn.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    conn.connect({
      host: ip,
      port: 22,
      username: username,
      password: password,
      readyTimeout: 7000
    });
  });
});

function parseSshStats(output) {
  const lines = output.split('\n');
  let temp = 'N/A';
  let ramTotal = 0, ramUsed = 0, ramPercent = 0;
  let diskUsed = '0', diskTotal = '0', diskPercent = 0;
  let osVersion = 'Linux Device';

  let currentSection = 'temp';

  for (let line of lines) {
    line = line.trim();
    if (line === '---MEM---') {
      currentSection = 'mem';
      continue;
    }
    if (line === '---DISK---') {
      currentSection = 'disk';
      continue;
    }
    if (line === '---OS---') {
      currentSection = 'os';
      continue;
    }

    if (currentSection === 'temp') {
      const match = line.match(/temp=(\d+\.?\d*)/);
      if (match) {
        temp = `${parseFloat(match[1]).toFixed(1)}°C`;
      }
    } else if (currentSection === 'mem') {
      if (line.startsWith('Mem:')) {
        const parts = line.split(/\s+/);
        ramTotal = parseInt(parts[1], 10);
        ramUsed = parseInt(parts[2], 10);
        ramPercent = ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : 0;
      }
    } else if (currentSection === 'disk') {
      if (line.startsWith('/') || line.includes('/dev/')) {
        const parts = line.split(/\s+/);
        diskTotal = parts[1];
        diskUsed = parts[2];
        diskPercent = parseInt(parts[4].replace('%', ''), 10) || 0;
      }
    } else if (currentSection === 'os') {
      const match = line.match(/PRETTY_NAME="([^"]+)"/);
      if (match) {
        osVersion = match[1];
      }
    }
  }

  return { temp, ramTotal, ramUsed, ramPercent, diskTotal, diskUsed, diskPercent, osVersion };
}

// IPC Handler: Reboot
ipcMain.handle('reboot-pi', async (event, data) => {
  const { ip, username, password } = data;
  logToUi(`Instructing Pi at ${ip} to reboot...`);

  if (settings.demoMode) {
    await new Promise(r => setTimeout(r, 1000));
    logToUi(`[Demo Mode] Simulated Reboot command sent to ${ip}`);
    return { success: true };
  }

  return new Promise((resolve) => {
    const conn = new Client();
    conn.on('ready', () => {
      const cmd = `echo '${password}' | sudo -S reboot`;
      conn.exec(cmd, () => {
        conn.end();
        resolve({ success: true });
      });
    });
    conn.on('error', (err) => resolve({ success: false, error: err.message }));
    conn.connect({ host: ip, port: 22, username, password, readyTimeout: 5000 });
  });
});

// IPC Handler: Shutdown
ipcMain.handle('shutdown-pi', async (event, data) => {
  const { ip, username, password } = data;
  logToUi(`Instructing Pi at ${ip} to power off...`);

  if (settings.demoMode) {
    await new Promise(r => setTimeout(r, 1000));
    logToUi(`[Demo Mode] Simulated Shutdown command sent to ${ip}`);
    return { success: true };
  }

  return new Promise((resolve) => {
    const conn = new Client();
    conn.on('ready', () => {
      const cmd = `echo '${password}' | sudo -S poweroff`;
      conn.exec(cmd, () => {
        conn.end();
        resolve({ success: true });
      });
    });
    conn.on('error', (err) => resolve({ success: false, error: err.message }));
    conn.connect({ host: ip, port: 22, username, password, readyTimeout: 5000 });
  });
});

// IPC Handler: Change Headless Resolution
ipcMain.handle('change-resolution', async (event, data) => {
  const { ip, username, password, resolution } = data;
  logToUi(`Setting headless resolution of ${ip} to ${resolution}...`);

  if (settings.demoMode) {
    await new Promise(r => setTimeout(r, 1200));
    logToUi(`[Demo Mode] Simulated resolution updated to ${resolution} on ${ip}`);
    return { success: true };
  }

  return new Promise((resolve) => {
    const conn = new Client();
    conn.on('ready', () => {
      let cmd = '';
      if (resolution === '1920x1080') {
        cmd = `echo '${password}' | sudo -S raspi-config nonint do_resolution 2 82 || (echo '${password}' | sudo -S sed -i 's/#hdmi_mode=.*/hdmi_mode=82/' /boot/firmware/config.txt || echo '${password}' | sudo -S sed -i 's/#hdmi_mode=.*/hdmi_mode=82/' /boot/config.txt)`;
      } else if (resolution === '1280x720') {
        cmd = `echo '${password}' | sudo -S raspi-config nonint do_resolution 2 85 || (echo '${password}' | sudo -S sed -i 's/#hdmi_mode=.*/hdmi_mode=85/' /boot/firmware/config.txt || echo '${password}' | sudo -S sed -i 's/#hdmi_mode=.*/hdmi_mode=85/' /boot/config.txt)`;
      } else {
        cmd = `echo '${password}' | sudo -S raspi-config nonint do_resolution 2 16 || (echo '${password}' | sudo -S sed -i 's/#hdmi_mode=.*/hdmi_mode=16/' /boot/firmware/config.txt || echo '${password}' | sudo -S sed -i 's/#hdmi_mode=.*/hdmi_mode=16/' /boot/config.txt)`;
      }

      conn.exec(cmd, (err, stream) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }
        stream.on('close', () => {
          conn.end();
          logToUi(`Headless resolution settings updated. Pi requires a reboot to apply resolution modifications.`);
          resolve({ success: true });
        });
      });
    });
    conn.on('error', (err) => resolve({ success: false, error: err.message }));
    conn.connect({ host: ip, port: 22, username, password, readyTimeout: 5000 });
  });
});

// Settings Handlers
ipcMain.handle('get-settings', () => {
  return settings;
});

ipcMain.handle('save-settings', (event, newSettings) => {
  saveSettings(newSettings);
  logToUi('Settings updated.');
  return settings;
});

// General handlers
ipcMain.on('copy-to-clipboard', (event, text) => {
  clipboard.writeText(text);
  logToUi(`Copied to clipboard: ${text}`);
});

ipcMain.on('open-url', (event, url) => {
  shell.openExternal(url);
});

// Auto Updater IPC Handlers
ipcMain.handle('updater-check', async () => {
  try {
    if (settings.demoMode) {
      sendUpdateStatus('checking');
      await new Promise(resolve => setTimeout(resolve, 1500));
      sendUpdateStatus('available', { version: '1.2.1', releaseDate: new Date().toISOString() });
      return { success: true };
    }
    
    const result = await autoUpdater.checkForUpdates();
    return { success: true, result };
  } catch (err) {
    // The autoUpdater.on('error') event handler has already sent the error status to the UI,
    // so we don't call sendUpdateStatus here to avoid duplication.
    return { success: false, error: getFriendlyErrorMessage(err) };
  }
});

ipcMain.handle('updater-download', async () => {
  try {
    if (settings.demoMode) {
      for (let percent = 0; percent <= 100; percent += 10) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-download-progress', percent);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      sendUpdateStatus('downloaded', { version: '1.2.1' });
      return { success: true };
    }
    
    const result = await autoUpdater.downloadUpdate();
    return { success: true, result };
  } catch (err) {
    // Similarly, autoUpdater.on('error') event handler has already sent the error status.
    return { success: false, error: getFriendlyErrorMessage(err) };
  }
});

ipcMain.handle('updater-install', () => {
  if (settings.demoMode) {
    logToUi('[Demo Mode] Simulating restart to install version 1.2.1...');
    app.relaunch();
    app.exit(0);
    return { success: true };
  }
  
  autoUpdater.quitAndInstall();
  return { success: true };
});

// =============================================================
// Register Enterprise v1.2.0 Module Backends
// =============================================================
try {
  const getSettingsHelper = () => settings;
  const getMainWindowHelper = () => mainWindow;

  // 1. SFTP Explorer
  require('./src/backend/sftp.js')(ipcMain, getSettingsHelper, logToUi);

  // 2. SSH Terminal
  require('./src/backend/terminal.js')(ipcMain, getSettingsHelper, logToUi, getMainWindowHelper);

  // 3. VNC Proxy
  require('./src/backend/vncProxy.js')(ipcMain, getSettingsHelper, logToUi);

  // 4. App Installer (destructured as it exports an object)
  const { registerInstallerHandlers } = require('./src/backend/installer.js');
  registerInstallerHandlers(ipcMain, getSettingsHelper, logToUi);

  // 5. SD Card Backup/Restore (destructured as it exports an object)
  const { registerBackupHandlers } = require('./src/backend/backup.js');
  registerBackupHandlers(ipcMain, getSettingsHelper, logToUi, getMainWindowHelper);

  logToUi('[System] All Enterprise Modules loaded into Main Process.');
} catch (err) {
  console.error('Failed to load one or more backend modules:', err);
  logToUi(`[ERROR] Backend modules failed to initialize: ${err.message}`);
}

