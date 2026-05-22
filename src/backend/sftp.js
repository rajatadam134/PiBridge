// =============================================================
// PiBridge SFTP Backend Module
// Handles file operations over SSH SFTP with full demo mode support
// =============================================================

const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');

// -------------------------------------------------------------
// Mock Filesystem for Demo Mode
// -------------------------------------------------------------
const MOCK_FILE_CONTENTS = {
  '/home/pi/config.txt': `# PiBridge Configuration File
# Last updated: ${new Date().toISOString().split('T')[0]}

HOSTNAME=raspberrypi
WIFI_COUNTRY=US
ENABLE_VNC=1
GPU_MEM=128
HDMI_FORCE_HOTPLUG=1
HDMI_GROUP=2
HDMI_MODE=82
`,
  '/home/pi/README.txt': `Welcome to PiBridge!
====================
This Raspberry Pi is managed via PiBridge Remote Manager.
For documentation visit: https://github.com/raspberrypi/documentation
`,
  '/home/pi/Documents/project_notes.md': `# Project Notes

## Sensor Array
- Temperature sensor on GPIO 4
- Humidity sensor on GPIO 17
- LED indicator on GPIO 27

## TODO
- [ ] Calibrate temperature offset
- [ ] Add data logging to CSV
- [x] Install required packages
- [x] Configure I2C bus

## Dependencies
\`\`\`
pip install adafruit-circuitpython-dht
pip install RPi.GPIO
\`\`\`
`,
  '/home/pi/Documents/todo.txt': `Shopping List:
1. Raspberry Pi 5 (8GB)
2. Official Pi 5 case
3. 27W USB-C power supply
4. 64GB microSD card
5. Cooling fan module
`,
  '/home/pi/Downloads/pibridge_installer.sh': `#!/bin/bash
# PiBridge Remote Agent Installer
# Version 1.1.0

echo "Installing PiBridge agent..."
sudo apt-get update
sudo apt-get install -y realvnc-vnc-server
sudo raspi-config nonint do_vnc 0
sudo systemctl enable vncserver-x11-serviced
echo "PiBridge agent installation complete!"
`,
  '/home/pi/Desktop/VNC_Viewer.desktop': `[Desktop Entry]
Name=VNC Viewer
Comment=VNC Viewer from RealVNC
Exec=/usr/bin/vncviewer
Icon=vncviewer
Terminal=false
Type=Application
Categories=Network;RemoteAccess;
`,
  '/home/pi/scripts/backup.sh': `#!/bin/bash
# Daily backup script for Pi projects
DATE=$(date +%Y-%m-%d)
BACKUP_DIR="/home/pi/backups/$DATE"
mkdir -p "$BACKUP_DIR"
cp -r /home/pi/Documents "$BACKUP_DIR/"
cp -r /home/pi/scripts "$BACKUP_DIR/"
echo "Backup completed: $BACKUP_DIR"
`,
  '/home/pi/scripts/monitor.py': `#!/usr/bin/env python3
"""System monitoring script for Raspberry Pi."""

import psutil
import time
import json

def get_stats():
    return {
        "cpu_percent": psutil.cpu_percent(interval=1),
        "memory": dict(psutil.virtual_memory()._asdict()),
        "disk": dict(psutil.disk_usage('/')._asdict()),
        "temperature": get_cpu_temp()
    }

def get_cpu_temp():
    try:
        with open('/sys/class/thermal/thermal_zone0/temp') as f:
            return float(f.read().strip()) / 1000.0
    except:
        return None

if __name__ == "__main__":
    while True:
        stats = get_stats()
        print(json.dumps(stats, indent=2))
        time.sleep(5)
`,
  '/home/pi/.bashrc': `# ~/.bashrc: executed by bash(1) for non-login shells.

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

export PATH="/home/pi/.local/bin:$PATH"
export EDITOR=nano

alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
alias pi='cd /home/pi'
`
};

let mockFs = {
  '/': [
    { name: 'home', size: 4096, isDirectory: true, mtime: Date.now() - 86400000 * 30, permissions: 'drwxr-xr-x' },
    { name: 'etc', size: 4096, isDirectory: true, mtime: Date.now() - 86400000 * 60, permissions: 'drwxr-xr-x' },
    { name: 'var', size: 4096, isDirectory: true, mtime: Date.now() - 86400000 * 45, permissions: 'drwxr-xr-x' },
    { name: 'tmp', size: 4096, isDirectory: true, mtime: Date.now() - 3600000, permissions: 'drwxrwxrwt' },
    { name: 'boot', size: 4096, isDirectory: true, mtime: Date.now() - 86400000 * 10, permissions: 'drwxr-xr-x' }
  ],
  '/home': [
    { name: 'pi', size: 4096, isDirectory: true, mtime: Date.now() - 600000, permissions: 'drwxr-xr-x' }
  ],
  '/home/pi': [
    { name: 'Documents', size: 4096, isDirectory: true, mtime: Date.now() - 3600000, permissions: 'drwxr-xr-x' },
    { name: 'Downloads', size: 4096, isDirectory: true, mtime: Date.now() - 7200000, permissions: 'drwxr-xr-x' },
    { name: 'Desktop', size: 4096, isDirectory: true, mtime: Date.now() - 10800000, permissions: 'drwxr-xr-x' },
    { name: 'scripts', size: 4096, isDirectory: true, mtime: Date.now() - 14400000, permissions: 'drwxr-xr-x' },
    { name: 'config.txt', size: 1048, isDirectory: false, mtime: Date.now() - 86400000, permissions: '-rw-r--r--' },
    { name: 'README.txt', size: 245, isDirectory: false, mtime: Date.now() - 172800000, permissions: '-rw-r--r--' },
    { name: '.bashrc', size: 430, isDirectory: false, mtime: Date.now() - 604800000, permissions: '-rw-r--r--' }
  ],
  '/home/pi/Documents': [
    { name: 'project_notes.md', size: 2048, isDirectory: false, mtime: Date.now() - 1200000, permissions: '-rw-r--r--' },
    { name: 'todo.txt', size: 120, isDirectory: false, mtime: Date.now() - 2400000, permissions: '-rw-r--r--' }
  ],
  '/home/pi/Downloads': [
    { name: 'pibridge_installer.sh', size: 40960, isDirectory: false, mtime: Date.now() - 600000, permissions: '-rwxr-xr-x' }
  ],
  '/home/pi/Desktop': [
    { name: 'VNC_Viewer.desktop', size: 320, isDirectory: false, mtime: Date.now() - 300000, permissions: '-rwxr-xr-x' }
  ],
  '/home/pi/scripts': [
    { name: 'backup.sh', size: 512, isDirectory: false, mtime: Date.now() - 43200000, permissions: '-rwxr-xr-x' },
    { name: 'monitor.py', size: 890, isDirectory: false, mtime: Date.now() - 86400000, permissions: '-rwxr-xr-x' }
  ]
};

function normalizePath(p) {
  let normalized = path.posix.normalize(p.replace(/\\/g, '/'));
  if (normalized.endsWith('/') && normalized !== '/') {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function joinPath(base, part) {
  if (base === '/') return '/' + part;
  return base + '/' + part;
}

function demoListDir(dirPath) {
  const normPath = normalizePath(dirPath);
  console.log(`[SFTP Demo] Listing directory: ${normPath}`);

  if (mockFs[normPath]) {
    return mockFs[normPath].map(item => ({
      name: item.name,
      type: item.isDirectory ? 'directory' : 'file',
      size: item.size,
      modified: item.mtime
    }));
  }

  // Check if the directory exists as a child entry in its parent
  const parentPath = normalizePath(path.posix.dirname(normPath));
  const dirName = path.posix.basename(normPath);
  if (mockFs[parentPath]) {
    const found = mockFs[parentPath].find(item => item.name === dirName && item.isDirectory);
    if (found) {
      mockFs[normPath] = [];
      return [];
    }
  }
  throw new Error(`Directory not found: ${dirPath}`);
}

function demoReadFile(filePath) {
  const normPath = normalizePath(filePath);
  console.log(`[SFTP Demo] Reading file: ${normPath}`);

  if (MOCK_FILE_CONTENTS[normPath]) {
    return MOCK_FILE_CONTENTS[normPath];
  }

  // Check the file exists in the mock filesystem
  const parentPath = normalizePath(path.posix.dirname(normPath));
  const fileName = path.posix.basename(normPath);
  if (mockFs[parentPath]) {
    const found = mockFs[parentPath].find(item => item.name === fileName && !item.isDirectory);
    if (found) {
      return `[Simulated content of ${fileName}]\nThis is a demo mode placeholder.\nFile size: ${found.size} bytes\nLast modified: ${new Date(found.mtime).toLocaleString()}\n`;
    }
  }
  throw new Error(`File not found: ${filePath}`);
}

function demoWriteFile(filePath, content) {
  const normPath = normalizePath(filePath);
  const parentPath = normalizePath(path.posix.dirname(normPath));
  const fileName = path.posix.basename(normPath);
  console.log(`[SFTP Demo] Writing file: ${normPath} (${content.length} bytes)`);

  if (!mockFs[parentPath]) {
    throw new Error(`Parent directory does not exist: ${parentPath}`);
  }

  MOCK_FILE_CONTENTS[normPath] = content;

  const existingIndex = mockFs[parentPath].findIndex(item => item.name === fileName);
  const fileEntry = {
    name: fileName,
    size: content.length,
    isDirectory: false,
    mtime: Date.now(),
    permissions: '-rw-r--r--'
  };

  if (existingIndex !== -1) {
    mockFs[parentPath][existingIndex] = fileEntry;
  } else {
    mockFs[parentPath].push(fileEntry);
  }
  return true;
}

function demoDelete(remotePath) {
  const normPath = normalizePath(remotePath);
  const parentPath = normalizePath(path.posix.dirname(normPath));
  const name = path.posix.basename(normPath);
  console.log(`[SFTP Demo] Deleting: ${normPath}`);

  if (!mockFs[parentPath]) {
    throw new Error(`No such file or directory: ${remotePath}`);
  }

  const item = mockFs[parentPath].find(i => i.name === name);
  if (!item) {
    throw new Error(`No such file or directory: ${remotePath}`);
  }

  mockFs[parentPath] = mockFs[parentPath].filter(i => i.name !== name);

  if (item.isDirectory) {
    delete mockFs[normPath];
  }
  if (MOCK_FILE_CONTENTS[normPath]) {
    delete MOCK_FILE_CONTENTS[normPath];
  }
  return true;
}

function demoRename(oldPath, newPath) {
  const normOld = normalizePath(oldPath);
  const normNew = normalizePath(newPath);
  const oldParent = normalizePath(path.posix.dirname(normOld));
  const newParent = normalizePath(path.posix.dirname(normNew));
  const oldName = path.posix.basename(normOld);
  const newName = path.posix.basename(normNew);
  console.log(`[SFTP Demo] Renaming: ${normOld} -> ${normNew}`);

  if (!mockFs[oldParent]) {
    throw new Error(`Source not found: ${oldPath}`);
  }

  const item = mockFs[oldParent].find(i => i.name === oldName);
  if (!item) {
    throw new Error(`Source not found: ${oldPath}`);
  }

  // Remove from old parent
  mockFs[oldParent] = mockFs[oldParent].filter(i => i.name !== oldName);

  // Add to new parent
  if (!mockFs[newParent]) {
    throw new Error(`Destination parent does not exist: ${newParent}`);
  }
  item.name = newName;
  item.mtime = Date.now();
  mockFs[newParent].push(item);

  // Move directory contents if it was a directory
  if (item.isDirectory && mockFs[normOld]) {
    mockFs[normNew] = mockFs[normOld];
    delete mockFs[normOld];
  }

  // Move file content reference
  if (MOCK_FILE_CONTENTS[normOld]) {
    MOCK_FILE_CONTENTS[normNew] = MOCK_FILE_CONTENTS[normOld];
    delete MOCK_FILE_CONTENTS[normOld];
  }

  return true;
}

function demoMkdir(remotePath) {
  const normPath = normalizePath(remotePath);
  const parentPath = normalizePath(path.posix.dirname(normPath));
  const dirName = path.posix.basename(normPath);
  console.log(`[SFTP Demo] Creating directory: ${normPath}`);

  if (!mockFs[parentPath]) {
    throw new Error(`Parent directory does not exist: ${parentPath}`);
  }

  const exists = mockFs[parentPath].some(item => item.name === dirName);
  if (exists) {
    throw new Error(`File or directory already exists: ${dirName}`);
  }

  mockFs[parentPath].push({
    name: dirName,
    size: 4096,
    isDirectory: true,
    mtime: Date.now(),
    permissions: 'drwxr-xr-x'
  });

  mockFs[normPath] = [];
  return true;
}

// -------------------------------------------------------------
// Real SFTP Helpers
// -------------------------------------------------------------

/**
 * Create an SSH connection and open an SFTP session.
 * Returns { conn, sftp } — caller must close conn when done.
 */
function getSftpSession(ip, username, password) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          reject(err);
        } else {
          resolve({ conn, sftp });
        }
      });
    });

    conn.on('error', (err) => {
      reject(err);
    });

    conn.connect({
      host: ip,
      port: 22,
      username: username,
      password: password,
      readyTimeout: 10000
    });
  });
}

/**
 * Convert a numeric file mode into a human-readable permissions string.
 */
function modeToType(mode) {
  if (typeof mode !== 'number') return 'file';
  return (mode & 0o170000) === 0o040000 ? 'directory' : 'file';
}

// =============================================================
// Module Export — registerSftpHandlers
// =============================================================
module.exports = function registerSftpHandlers(ipcMain, getSettings, logToUi) {

  // ---------------------------------------------------------
  // 1. sftp-list-dir
  // ---------------------------------------------------------
  ipcMain.handle('sftp-list-dir', async (event, data) => {
    const { ip, username, password, remotePath } = data;
    const dirPath = remotePath || '/home/pi';
    const settings = getSettings();
    console.log(`[SFTP] sftp-list-dir called for ${dirPath} on ${ip}`);

    if (settings.demoMode) {
      logToUi(`[SFTP Demo] Listing directory: ${dirPath}`);
      try {
        const files = demoListDir(dirPath);
        logToUi(`[SFTP Demo] Found ${files.length} items in ${dirPath}`);
        return { success: true, files };
      } catch (err) {
        logToUi(`[SFTP Demo] Error listing directory: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    // Real mode
    logToUi(`[SFTP] Listing directory ${dirPath} on ${ip}...`);
    let conn, sftp;
    try {
      ({ conn, sftp } = await getSftpSession(ip, username, password));

      const list = await new Promise((resolve, reject) => {
        sftp.readdir(dirPath, (err, items) => {
          if (err) reject(err);
          else resolve(items);
        });
      });

      conn.end();

      const files = list
        .filter(item => item.filename !== '.' && item.filename !== '..')
        .map(item => {
          const attrs = item.attrs || {};
          const type = modeToType(attrs.mode);
          return {
            name: item.filename,
            type: type,
            size: attrs.size || 0,
            modified: (attrs.mtime || 0) * 1000
          };
        });

      logToUi(`[SFTP] Found ${files.length} items in ${dirPath}`);
      return { success: true, files };
    } catch (err) {
      if (conn) conn.end();
      logToUi(`[SFTP] Error listing directory: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------
  // 2. sftp-read-file
  // ---------------------------------------------------------
  ipcMain.handle('sftp-read-file', async (event, data) => {
    const { ip, username, password, remotePath } = data;
    const settings = getSettings();
    console.log(`[SFTP] sftp-read-file called for ${remotePath} on ${ip}`);

    if (settings.demoMode) {
      logToUi(`[SFTP Demo] Reading file: ${remotePath}`);
      try {
        const content = demoReadFile(remotePath);
        return { success: true, content };
      } catch (err) {
        logToUi(`[SFTP Demo] Error reading file: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    // Real mode
    logToUi(`[SFTP] Reading file ${remotePath} on ${ip}...`);
    let conn, sftp;
    try {
      ({ conn, sftp } = await getSftpSession(ip, username, password));

      const content = await new Promise((resolve, reject) => {
        const chunks = [];
        const readStream = sftp.createReadStream(remotePath, { encoding: 'utf8' });
        readStream.on('data', (chunk) => chunks.push(chunk));
        readStream.on('end', () => resolve(chunks.join('')));
        readStream.on('error', (err) => reject(err));
      });

      conn.end();
      logToUi(`[SFTP] Successfully read file ${remotePath} (${content.length} chars)`);
      return { success: true, content };
    } catch (err) {
      if (conn) conn.end();
      logToUi(`[SFTP] Error reading file: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------
  // 3. sftp-write-file
  // ---------------------------------------------------------
  ipcMain.handle('sftp-write-file', async (event, data) => {
    const { ip, username, password, remotePath, content } = data;
    const settings = getSettings();
    console.log(`[SFTP] sftp-write-file called for ${remotePath} on ${ip}`);

    if (settings.demoMode) {
      logToUi(`[SFTP Demo] Writing file: ${remotePath}`);
      try {
        demoWriteFile(remotePath, content);
        logToUi(`[SFTP Demo] File written successfully: ${remotePath}`);
        return { success: true };
      } catch (err) {
        logToUi(`[SFTP Demo] Error writing file: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    // Real mode
    logToUi(`[SFTP] Writing file ${remotePath} on ${ip}...`);
    let conn, sftp;
    try {
      ({ conn, sftp } = await getSftpSession(ip, username, password));

      await new Promise((resolve, reject) => {
        const writeStream = sftp.createWriteStream(remotePath);
        writeStream.on('close', () => resolve());
        writeStream.on('error', (err) => reject(err));
        writeStream.end(content, 'utf8');
      });

      conn.end();
      logToUi(`[SFTP] File written successfully: ${remotePath}`);
      return { success: true };
    } catch (err) {
      if (conn) conn.end();
      logToUi(`[SFTP] Error writing file: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------
  // 4. sftp-delete
  // ---------------------------------------------------------
  ipcMain.handle('sftp-delete', async (event, data) => {
    const { ip, username, password, remotePath } = data;
    const settings = getSettings();
    console.log(`[SFTP] sftp-delete called for ${remotePath} on ${ip}`);

    if (settings.demoMode) {
      logToUi(`[SFTP Demo] Deleting: ${remotePath}`);
      try {
        demoDelete(remotePath);
        logToUi(`[SFTP Demo] Deleted successfully: ${remotePath}`);
        return { success: true };
      } catch (err) {
        logToUi(`[SFTP Demo] Error deleting: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    // Real mode — try unlink first (file), fall back to rmdir (directory)
    logToUi(`[SFTP] Deleting ${remotePath} on ${ip}...`);
    let conn, sftp;
    try {
      ({ conn, sftp } = await getSftpSession(ip, username, password));

      // First try to stat to determine type
      const stats = await new Promise((resolve, reject) => {
        sftp.stat(remotePath, (err, attrs) => {
          if (err) reject(err);
          else resolve(attrs);
        });
      });

      const isDir = (stats.mode & 0o170000) === 0o040000;

      await new Promise((resolve, reject) => {
        if (isDir) {
          sftp.rmdir(remotePath, (err) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          sftp.unlink(remotePath, (err) => {
            if (err) reject(err);
            else resolve();
          });
        }
      });

      conn.end();
      logToUi(`[SFTP] Deleted successfully: ${remotePath}`);
      return { success: true };
    } catch (err) {
      if (conn) conn.end();
      logToUi(`[SFTP] Error deleting: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------
  // 5. sftp-rename
  // ---------------------------------------------------------
  ipcMain.handle('sftp-rename', async (event, data) => {
    const { ip, username, password, oldPath, newPath } = data;
    const settings = getSettings();
    console.log(`[SFTP] sftp-rename called: ${oldPath} -> ${newPath} on ${ip}`);

    if (settings.demoMode) {
      logToUi(`[SFTP Demo] Renaming: ${oldPath} -> ${newPath}`);
      try {
        demoRename(oldPath, newPath);
        logToUi(`[SFTP Demo] Renamed successfully`);
        return { success: true };
      } catch (err) {
        logToUi(`[SFTP Demo] Error renaming: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    // Real mode
    logToUi(`[SFTP] Renaming ${oldPath} -> ${newPath} on ${ip}...`);
    let conn, sftp;
    try {
      ({ conn, sftp } = await getSftpSession(ip, username, password));

      await new Promise((resolve, reject) => {
        sftp.rename(oldPath, newPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      conn.end();
      logToUi(`[SFTP] Renamed successfully`);
      return { success: true };
    } catch (err) {
      if (conn) conn.end();
      logToUi(`[SFTP] Error renaming: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------
  // 6. sftp-mkdir
  // ---------------------------------------------------------
  ipcMain.handle('sftp-mkdir', async (event, data) => {
    const { ip, username, password, remotePath } = data;
    const settings = getSettings();
    console.log(`[SFTP] sftp-mkdir called for ${remotePath} on ${ip}`);

    if (settings.demoMode) {
      logToUi(`[SFTP Demo] Creating directory: ${remotePath}`);
      try {
        demoMkdir(remotePath);
        logToUi(`[SFTP Demo] Directory created: ${remotePath}`);
        return { success: true };
      } catch (err) {
        logToUi(`[SFTP Demo] Error creating directory: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    // Real mode
    logToUi(`[SFTP] Creating directory ${remotePath} on ${ip}...`);
    let conn, sftp;
    try {
      ({ conn, sftp } = await getSftpSession(ip, username, password));

      await new Promise((resolve, reject) => {
        sftp.mkdir(remotePath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      conn.end();
      logToUi(`[SFTP] Directory created: ${remotePath}`);
      return { success: true };
    } catch (err) {
      if (conn) conn.end();
      logToUi(`[SFTP] Error creating directory: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------
  // 7. sftp-download
  // ---------------------------------------------------------
  ipcMain.handle('sftp-download', async (event, data) => {
    const { ip, username, password, remotePath, localPath } = data;
    const settings = getSettings();
    console.log(`[SFTP] sftp-download called: ${remotePath} -> ${localPath} on ${ip}`);

    // If no localPath provided, show a save dialog
    let savePath = localPath;
    if (!savePath) {
      const { dialog } = require('electron');
      const dialogResult = await dialog.showSaveDialog({
        title: 'Save Downloaded File',
        defaultPath: path.basename(remotePath),
        properties: ['createDirectory']
      });
      if (dialogResult.canceled || !dialogResult.filePath) {
        console.log('[SFTP] Download cancelled by user');
        return { success: false, error: 'Download cancelled' };
      }
      savePath = dialogResult.filePath;
    }

    if (settings.demoMode) {
      logToUi(`[SFTP Demo] Downloading: ${remotePath} -> ${savePath}`);
      try {
        const normPath = normalizePath(remotePath);
        const parentPath = normalizePath(path.posix.dirname(normPath));
        const filename = path.posix.basename(normPath);

        if (!mockFs[parentPath]) {
          throw new Error(`No such file: ${remotePath}`);
        }
        const exists = mockFs[parentPath].some(item => item.name === filename && !item.isDirectory);
        if (!exists) {
          throw new Error(`No such file: ${remotePath}`);
        }

        // Write simulated content to local file
        const saveDir = path.dirname(savePath);
        if (!fs.existsSync(saveDir)) {
          fs.mkdirSync(saveDir, { recursive: true });
        }

        const content = MOCK_FILE_CONTENTS[normPath] ||
          `[Simulated download content of ${filename}]\nDownloaded from PiBridge SFTP Explorer in Demo Mode.\n`;
        fs.writeFileSync(savePath, content, 'utf8');

        logToUi(`[SFTP Demo] Downloaded successfully: ${remotePath} -> ${savePath}`);
        return { success: true };
      } catch (err) {
        logToUi(`[SFTP Demo] Download error: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    // Real mode
    logToUi(`[SFTP] Downloading ${remotePath} -> ${savePath} from ${ip}...`);
    let conn, sftp;
    try {
      ({ conn, sftp } = await getSftpSession(ip, username, password));

      await new Promise((resolve, reject) => {
        sftp.fastGet(remotePath, savePath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      conn.end();
      logToUi(`[SFTP] Downloaded successfully: ${remotePath}`);
      return { success: true };
    } catch (err) {
      if (conn) conn.end();
      logToUi(`[SFTP] Download error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------
  // 8. sftp-upload
  // ---------------------------------------------------------
  ipcMain.handle('sftp-upload', async (event, data) => {
    const { ip, username, password, localPath, remotePath } = data;
    const settings = getSettings();
    console.log(`[SFTP] sftp-upload called: ${localPath} -> ${remotePath} on ${ip}`);

    // If no localPath provided, show an open dialog
    let filePath = localPath;
    if (!filePath) {
      const { dialog } = require('electron');
      const dialogResult = await dialog.showOpenDialog({
        title: 'Select File to Upload',
        properties: ['openFile']
      });
      if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
        console.log('[SFTP] Upload cancelled by user');
        return { success: false, error: 'Upload cancelled' };
      }
      filePath = dialogResult.filePaths[0];
    }

    // Determine remote destination path
    let destPath = remotePath;
    if (!destPath) {
      destPath = '/home/pi/' + path.basename(filePath);
    }

    if (settings.demoMode) {
      logToUi(`[SFTP Demo] Uploading: ${filePath} -> ${destPath}`);
      try {
        const normRemote = normalizePath(destPath);
        const parentRemote = normalizePath(path.posix.dirname(normRemote));
        const filename = path.posix.basename(normRemote);

        if (!mockFs[parentRemote]) {
          throw new Error(`Remote parent directory does not exist: ${parentRemote}`);
        }

        let fileSize = 1024;
        try {
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            fileSize = stats.size;
          }
        } catch (e) { /* ignore */ }

        const existingIndex = mockFs[parentRemote].findIndex(item => item.name === filename);
        const fileEntry = {
          name: filename,
          size: fileSize,
          isDirectory: false,
          mtime: Date.now(),
          permissions: '-rw-r--r--'
        };

        if (existingIndex !== -1) {
          mockFs[parentRemote][existingIndex] = fileEntry;
        } else {
          mockFs[parentRemote].push(fileEntry);
        }

        logToUi(`[SFTP Demo] Uploaded successfully: ${filename}`);
        return { success: true };
      } catch (err) {
        logToUi(`[SFTP Demo] Upload error: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    // Real mode
    logToUi(`[SFTP] Uploading ${filePath} -> ${destPath} on ${ip}...`);
    let conn, sftp;
    try {
      ({ conn, sftp } = await getSftpSession(ip, username, password));

      await new Promise((resolve, reject) => {
        sftp.fastPut(filePath, destPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      conn.end();
      logToUi(`[SFTP] Uploaded successfully: ${path.basename(filePath)}`);
      return { success: true };
    } catch (err) {
      if (conn) conn.end();
      logToUi(`[SFTP] Upload error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  console.log('[SFTP] All SFTP IPC handlers registered successfully.');
};
