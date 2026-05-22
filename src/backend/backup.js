const { dialog } = require('electron');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

// Active backup/restore processes keyed by IP for cancellation support
const activeProcesses = new Map();

/**
 * Register all backup & restore IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getSettings - Returns the current settings object
 * @param {Function} logToUi - Logs a message to the renderer console
 * @param {Function} getMainWindow - Returns the current BrowserWindow instance
 */
function registerBackupHandlers(ipcMain, getSettings, logToUi, getMainWindow) {

  // ─────────────────────────────────────────────────────────────
  // Helper: send progress event to renderer safely
  // ─────────────────────────────────────────────────────────────
  function sendProgress(channel, data) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1. backup-get-disk-info
  //    Runs `lsblk -b -o NAME,SIZE,TYPE,MOUNTPOINT -J` over SSH
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle('backup-get-disk-info', async (event, data) => {
    const { ip, username, password } = data;
    const settings = getSettings();

    console.log(`[Backup] backup-get-disk-info requested for ${ip}`);

    if (settings.demoMode) {
      logToUi(`[Demo Mode] Fetching disk info from ${ip}...`);
      return {
        success: true,
        disks: [
          { name: 'mmcblk0', size: 32000000000, type: 'disk', mountpoint: null },
          { name: 'mmcblk0p1', size: 268435456, type: 'part', mountpoint: '/boot/firmware' },
          { name: 'mmcblk0p2', size: 31717302272, type: 'part', mountpoint: '/' },
          { name: 'sda', size: 64000000000, type: 'disk', mountpoint: null },
          { name: 'sda1', size: 63999934464, type: 'part', mountpoint: '/mnt/usb' }
        ]
      };
    }

    // Real mode: SSH into Pi and run lsblk
    return new Promise((resolve) => {
      const conn = new Client();

      conn.on('ready', () => {
        console.log(`[Backup] SSH connected to ${ip} for disk info`);
        const cmd = 'lsblk -b -o NAME,SIZE,TYPE,MOUNTPOINT -J';

        conn.exec(cmd, (err, stream) => {
          if (err) {
            console.error(`[Backup] SSH exec error: ${err.message}`);
            conn.end();
            resolve({ success: false, error: err.message });
            return;
          }

          let stdout = '';
          let stderr = '';

          stream.on('data', (chunk) => { stdout += chunk.toString(); });
          stream.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

          stream.on('close', (code) => {
            conn.end();
            console.log(`[Backup] lsblk exited with code ${code}`);

            if (code !== 0 && code !== null) {
              const errMsg = stderr.trim() || `lsblk exited with code ${code}`;
              resolve({ success: false, error: errMsg });
              return;
            }

            try {
              const parsed = JSON.parse(stdout);
              const blockdevices = parsed.blockdevices || [];
              const disks = [];

              // Flatten the tree into a flat list including children (partitions)
              function flattenDevices(devices) {
                for (const dev of devices) {
                  disks.push({
                    name: dev.name,
                    size: dev.size || 0,
                    type: dev.type || 'unknown',
                    mountpoint: dev.mountpoint || null
                  });
                  if (dev.children && dev.children.length > 0) {
                    flattenDevices(dev.children);
                  }
                }
              }

              flattenDevices(blockdevices);
              console.log(`[Backup] Found ${disks.length} block device entries`);
              resolve({ success: true, disks });
            } catch (parseErr) {
              console.error(`[Backup] Failed to parse lsblk output: ${parseErr.message}`);
              resolve({ success: false, error: `Failed to parse disk info: ${parseErr.message}` });
            }
          });
        });
      });

      conn.on('error', (err) => {
        console.error(`[Backup] SSH connection error: ${err.message}`);
        resolve({ success: false, error: err.message });
      });

      conn.connect({
        host: ip,
        port: 22,
        username: username || 'pi',
        password: password || 'raspberry',
        readyTimeout: 10000
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. backup-start
  //    Streams raw disk image from Pi to local file via SSH
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle('backup-start', async (event, data) => {
    const { ip, username, password, device, localPath } = data;
    const settings = getSettings();

    console.log(`[Backup] backup-start: device=/dev/${device} -> ${localPath} from ${ip}`);
    logToUi(`Starting SD card backup from ${ip}:/dev/${device} to ${localPath}...`);

    // ── DEMO MODE ──
    if (settings.demoMode) {
      logToUi(`[Demo Mode] Simulating backup of /dev/${device}...`);
      const totalBytes = 32000000000; // 32 GB mock
      const speedBytesPerSec = 25 * 1024 * 1024; // ~25 MB/s simulated

      return new Promise((resolve) => {
        let bytesTransferred = 0;
        const intervalMs = 500;
        const bytesPerTick = speedBytesPerSec * (intervalMs / 1000);

        const timer = setInterval(() => {
          // Check if cancelled
          const proc = activeProcesses.get(ip);
          if (!proc || proc.cancelled) {
            clearInterval(timer);
            activeProcesses.delete(ip);
            logToUi(`[Demo Mode] Backup cancelled for ${ip}`);
            resolve({ success: false, error: 'Backup cancelled by user.' });
            return;
          }

          bytesTransferred += bytesPerTick;
          if (bytesTransferred >= totalBytes) {
            bytesTransferred = totalBytes;
          }

          const percent = Math.min(Math.round((bytesTransferred / totalBytes) * 100), 100);
          const speed = `${(speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;

          sendProgress('backup-progress', {
            percent,
            bytesTransferred: Math.round(bytesTransferred),
            totalBytes,
            speed
          });

          logToUi(`[Demo Mode] Backup progress: ${percent}% — ${(bytesTransferred / (1024 * 1024)).toFixed(0)} MB / ${(totalBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`);

          if (bytesTransferred >= totalBytes) {
            clearInterval(timer);
            activeProcesses.delete(ip);
            // Create a small dummy file for realism
            try {
              fs.writeFileSync(localPath, 'PiBridge Demo Backup Image File', 'utf8');
            } catch (e) { /* ignore */ }
            logToUi(`[Demo Mode] Backup completed successfully!`);
            resolve({ success: true });
          }
        }, intervalMs);

        // Store reference so it can be cancelled
        activeProcesses.set(ip, { type: 'backup', timer, cancelled: false });
      });
    }

    // ── REAL MODE ──
    return new Promise((resolve) => {
      const conn = new Client();
      let writeStream = null;
      let isAborted = false;

      conn.on('ready', () => {
        logToUi(`SSH connection established to ${ip}. Starting backup of /dev/${device}...`);

        // First get device size for progress tracking
        conn.exec(`sudo blockdev --getsize64 /dev/${device}`, (sizeErr, sizeStream) => {
          if (sizeErr) {
            console.error(`[Backup] Failed to get device size: ${sizeErr.message}`);
            // Fallback: proceed without known total size
            startDdBackup(conn, 0);
            return;
          }

          let sizeOutput = '';
          sizeStream.on('data', (chunk) => { sizeOutput += chunk.toString(); });
          sizeStream.stderr.on('data', () => { /* ignore sudo prompts */ });

          sizeStream.on('close', () => {
            const totalBytes = parseInt(sizeOutput.trim().split('\n').pop(), 10) || 0;
            console.log(`[Backup] Device /dev/${device} size: ${totalBytes} bytes`);
            logToUi(`Device /dev/${device} size: ${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`);
            startDdBackup(conn, totalBytes);
          });
        });
      });

      function startDdBackup(sshConn, totalBytes) {
        const cmd = `sudo dd if=/dev/${device} bs=4M status=progress`;
        console.log(`[Backup] Executing: ${cmd}`);

        sshConn.exec(cmd, (err, stream) => {
          if (err) {
            logToUi(`SSH execution error during backup: ${err.message}`);
            sshConn.end();
            resolve({ success: false, error: err.message });
            return;
          }

          try {
            writeStream = fs.createWriteStream(localPath);
          } catch (fsErr) {
            logToUi(`Failed to create local write stream: ${fsErr.message}`);
            stream.destroy();
            sshConn.end();
            resolve({ success: false, error: fsErr.message });
            return;
          }

          const startTime = Date.now();
          let stderrBuf = '';

          // Store process reference for cancellation
          activeProcesses.set(ip, {
            type: 'backup',
            conn: sshConn,
            stream,
            writeStream,
            cancelled: false
          });

          // dd writes progress to stderr
          stream.stderr.on('data', (chunk) => {
            const chunkStr = chunk.toString();
            stderrBuf += chunkStr;

            // Parse dd progress: lines contain "<bytes> bytes" patterns
            const lines = stderrBuf.split(/[\r\n]+/);
            stderrBuf = lines.pop(); // keep last partial line

            for (const line of lines) {
              const match = line.match(/(\d+)\s+bytes/);
              if (match) {
                const bytesTransferred = parseInt(match[1], 10);
                const elapsed = (Date.now() - startTime) / 1000;
                const speedVal = elapsed > 0 ? (bytesTransferred / elapsed) : 0;
                const percent = totalBytes > 0
                  ? Math.min(Math.round((bytesTransferred / totalBytes) * 100), 99)
                  : 0;

                sendProgress('backup-progress', {
                  percent,
                  bytesTransferred,
                  totalBytes,
                  speed: `${(speedVal / (1024 * 1024)).toFixed(1)} MB/s`
                });
              }
            }
          });

          // Pipe SSH stdout (raw image data) to local file
          stream.pipe(writeStream);

          writeStream.on('error', (fsErr) => {
            logToUi(`Disk write error during backup: ${fsErr.message}`);
            isAborted = true;
            stream.destroy();
            sshConn.end();
            activeProcesses.delete(ip);
            resolve({ success: false, error: fsErr.message });
          });

          stream.on('close', (code) => {
            if (isAborted) return;
            writeStream.end();
            sshConn.end();
            activeProcesses.delete(ip);

            console.log(`[Backup] dd backup process closed with code: ${code}`);
            logToUi(`Backup process exited with code: ${code}`);

            if (code !== 0 && code !== null) {
              resolve({ success: false, error: `Backup process exited with code ${code}` });
            } else {
              sendProgress('backup-progress', {
                percent: 100,
                bytesTransferred: totalBytes,
                totalBytes,
                speed: '0 MB/s'
              });
              logToUi('SD card backup completed successfully!');
              resolve({ success: true });
            }
          });
        });
      }

      conn.on('error', (err) => {
        logToUi(`SSH connection error during backup: ${err.message}`);
        if (writeStream) writeStream.end();
        activeProcesses.delete(ip);
        resolve({ success: false, error: err.message });
      });

      conn.connect({
        host: ip,
        port: 22,
        username: username || 'pi',
        password: password || 'raspberry',
        readyTimeout: 10000
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. backup-cancel
  //    Cancels any running backup or restore for the given IP
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle('backup-cancel', async (event, data) => {
    const { ip } = data;
    console.log(`[Backup] Cancel requested for ${ip}`);

    const proc = activeProcesses.get(ip);
    if (!proc) {
      console.log(`[Backup] No active process found for ${ip}`);
      return { success: false, error: 'No active backup/restore process for this IP.' };
    }

    proc.cancelled = true;

    // Demo mode uses a timer
    if (proc.timer) {
      clearInterval(proc.timer);
      activeProcesses.delete(ip);
      logToUi(`Backup/Restore cancelled for ${ip} (demo mode).`);
      return { success: true };
    }

    // Real mode: destroy SSH stream and connection
    try {
      if (proc.stream) {
        proc.stream.destroy();
      }
      if (proc.writeStream) {
        proc.writeStream.end();
      }
      if (proc.readStream) {
        proc.readStream.destroy();
      }
      if (proc.conn) {
        proc.conn.end();
      }
    } catch (e) {
      console.error(`[Backup] Error during cancel cleanup: ${e.message}`);
    }

    activeProcesses.delete(ip);
    logToUi(`Backup/Restore cancelled for ${ip}.`);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────
  // 4. backup-restore-start
  //    Uploads a local .img file back to the Pi's SD card via SSH
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle('backup-restore-start', async (event, data) => {
    const { ip, username, password, device, localPath } = data;
    const settings = getSettings();

    console.log(`[Backup] backup-restore-start: ${localPath} -> /dev/${device} on ${ip}`);
    logToUi(`Starting SD card restore to ${ip}:/dev/${device} from ${localPath}...`);

    // ── DEMO MODE ──
    if (settings.demoMode) {
      logToUi(`[Demo Mode] Simulating restore to /dev/${device}...`);
      const totalBytes = 32000000000;
      const speedBytesPerSec = 25 * 1024 * 1024;

      return new Promise((resolve) => {
        let bytesTransferred = 0;
        const intervalMs = 500;
        const bytesPerTick = speedBytesPerSec * (intervalMs / 1000);

        const timer = setInterval(() => {
          const proc = activeProcesses.get(ip);
          if (!proc || proc.cancelled) {
            clearInterval(timer);
            activeProcesses.delete(ip);
            logToUi(`[Demo Mode] Restore cancelled for ${ip}`);
            resolve({ success: false, error: 'Restore cancelled by user.' });
            return;
          }

          bytesTransferred += bytesPerTick;
          if (bytesTransferred >= totalBytes) bytesTransferred = totalBytes;

          const percent = Math.min(Math.round((bytesTransferred / totalBytes) * 100), 100);
          const speed = `${(speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;

          sendProgress('backup-progress', {
            percent,
            bytesTransferred: Math.round(bytesTransferred),
            totalBytes,
            speed
          });

          logToUi(`[Demo Mode] Restore progress: ${percent}% — ${(bytesTransferred / (1024 * 1024)).toFixed(0)} MB / ${(totalBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`);

          if (bytesTransferred >= totalBytes) {
            clearInterval(timer);
            activeProcesses.delete(ip);
            logToUi(`[Demo Mode] Restore completed successfully!`);
            resolve({ success: true });
          }
        }, intervalMs);

        activeProcesses.set(ip, { type: 'restore', timer, cancelled: false });
      });
    }

    // ── REAL MODE ──
    if (!fs.existsSync(localPath)) {
      return { success: false, error: `Local image file does not exist: ${localPath}` };
    }

    const totalBytes = fs.statSync(localPath).size;
    logToUi(`Local image size: ${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`);

    return new Promise((resolve) => {
      const conn = new Client();
      let readStream = null;
      let isAborted = false;

      conn.on('ready', () => {
        logToUi(`SSH connection established to ${ip}. Starting restore to /dev/${device}...`);

        const cmd = `sudo dd of=/dev/${device} bs=4M`;
        console.log(`[Backup] Executing restore: ${cmd}`);

        conn.exec(cmd, (err, stream) => {
          if (err) {
            logToUi(`SSH execution error during restore: ${err.message}`);
            conn.end();
            resolve({ success: false, error: err.message });
            return;
          }

          try {
            readStream = fs.createReadStream(localPath);
          } catch (fsErr) {
            logToUi(`Failed to open local image file: ${fsErr.message}`);
            stream.destroy();
            conn.end();
            resolve({ success: false, error: fsErr.message });
            return;
          }

          const startTime = Date.now();
          let bytesTransferred = 0;

          // Store for cancellation
          activeProcesses.set(ip, {
            type: 'restore',
            conn,
            stream,
            readStream,
            cancelled: false
          });

          // Track progress based on local bytes read
          readStream.on('data', (chunk) => {
            bytesTransferred += chunk.length;
            const elapsed = (Date.now() - startTime) / 1000;
            const speedVal = elapsed > 0 ? (bytesTransferred / elapsed) : 0;
            const percent = Math.min(Math.round((bytesTransferred / totalBytes) * 100), 99);

            sendProgress('backup-progress', {
              percent,
              bytesTransferred,
              totalBytes,
              speed: `${(speedVal / (1024 * 1024)).toFixed(1)} MB/s`
            });
          });

          // Pipe local file into SSH stdin (dd's stdin)
          readStream.pipe(stream);

          let stderrBuf = '';
          stream.stderr.on('data', (chunk) => {
            stderrBuf += chunk.toString();
          });

          readStream.on('error', (fsErr) => {
            logToUi(`Local file read error during restore: ${fsErr.message}`);
            isAborted = true;
            stream.destroy();
            conn.end();
            activeProcesses.delete(ip);
            resolve({ success: false, error: fsErr.message });
          });

          stream.on('close', (code) => {
            if (isAborted) return;
            conn.end();
            activeProcesses.delete(ip);

            console.log(`[Backup] dd restore process closed with code: ${code}`);
            logToUi(`Restore process exited with code: ${code}`);

            if (code !== 0 && code !== null) {
              let errorMsg = `Restore process exited with code ${code}`;
              if (stderrBuf.includes('incorrect password')) {
                errorMsg = 'Sudo authentication failed — incorrect password.';
              } else if (stderrBuf.includes('No such file')) {
                errorMsg = `Device /dev/${device} not found on the remote system.`;
              }
              resolve({ success: false, error: errorMsg });
            } else {
              sendProgress('backup-progress', {
                percent: 100,
                bytesTransferred: totalBytes,
                totalBytes,
                speed: '0 MB/s'
              });
              logToUi('SD card restore completed successfully!');
              resolve({ success: true });
            }
          });
        });
      });

      conn.on('error', (err) => {
        logToUi(`SSH connection error during restore: ${err.message}`);
        activeProcesses.delete(ip);
        resolve({ success: false, error: err.message });
      });

      conn.connect({
        host: ip,
        port: 22,
        username: username || 'pi',
        password: password || 'raspberry',
        readyTimeout: 10000
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // File dialog helpers — called from frontend via IPC
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle('backup-select-save-path', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Save SD Card Backup Image',
      defaultPath: `pi_backup_${Date.now()}.img`,
      filters: [
        { name: 'Disk Image', extensions: ['img'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    console.log(`[Backup] Save dialog result: ${result.filePath || '(cancelled)'}`);
    return result.filePath || null;
  });

  ipcMain.handle('backup-select-restore-path', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select SD Card Image to Restore',
      filters: [
        { name: 'Disk Images', extensions: ['img', 'img.gz', 'gz'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    const chosen = (result.filePaths && result.filePaths[0]) || null;
    console.log(`[Backup] Open dialog result: ${chosen || '(cancelled)'}`);
    return chosen;
  });

  console.log('[Backup] All backup & restore IPC handlers registered.');
}

module.exports = { registerBackupHandlers };
