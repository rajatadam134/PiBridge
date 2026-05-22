// SD Card Backup & Restore Frontend Module for PiBridge
// Initialised via: window.initBackup(pibridge, containerId, credentials)
// All class/id names are styled to match PiBridge glassmorphism dark theme.

(function () {
  'use strict';

  function formatBytes(bytes) {
    if (bytes === 0 || bytes === undefined || bytes === null) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatEta(seconds) {
    if (seconds === undefined || isNaN(seconds) || seconds === null) return 'Calculating...';
    if (seconds <= 0) return '0s';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function showToast(message, type = 'info') {
    if (window.showToast) {
      window.showToast(message, type);
      return;
    }
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'fadeIn 0.3s ease reverse';
      setTimeout(() => { toast.remove(); }, 300);
    }, 4000);
  }

  window.initBackup = async function initBackup(pibridge, containerId, credentials) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[Backup] Container element not found: #${containerId}`);
      return null;
    }

    console.log(`[Backup] Initializing backup view for: ${credentials.ip}`);

    let selectedDeviceName = 'mmcblk0';
    let selectedDeviceSize = 0;
    let operationStartTime = 0;
    let operationType = 'backup';
    let isDisconnected = false;

    // Reset container and inject form directly inside the container
    container.innerHTML = `
      <div class="backup-toolbar glass" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-radius: var(--radius-md); border: 1px solid rgba(255, 255, 255, 0.05); margin-bottom: 16px; gap: 16px; flex-wrap: wrap;">
        <div style="font-size: 13px; font-weight: 500; color: var(--text-primary);">
          💾 Connected to: <strong>${credentials.username}@${credentials.ip}</strong>
        </div>
        <div id="sd-size-text" style="font-size: 12px; color: var(--accent-cyan); font-family: var(--font-mono);">
          Total Size: Not Checked
        </div>
        <button id="btn-check-sd" class="btn btn-secondary" style="padding: 8px 14px; font-size: 12px;">
          🔍 Check Size
        </button>
      </div>

      <div class="settings-card glass">
        <!-- Mode Selector Tab (Backup vs Restore) -->
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
          <button id="tab-backup-btn" class="btn btn-primary" style="flex: 1;">Backup SD Card</button>
          <button id="tab-restore-btn" class="btn btn-secondary" style="flex: 1;">Restore SD Card</button>
        </div>

        <!-- Backup Panel -->
        <div id="panel-backup" class="backup-sub-panel">
          <div class="form-group">
            <label for="backup-path-input">Local Save Path (.img)</label>
            <div style="display: flex; gap: 10px;">
              <input type="text" id="backup-path-input" class="form-control" placeholder="Select save file..." readonly style="flex: 1;">
              <button id="btn-browse-backup" class="btn btn-secondary">Browse</button>
            </div>
            <small>Select where the raw SD card image will be saved on your computer.</small>
          </div>
          <button id="btn-run-backup" class="btn btn-primary btn-glow" style="width: 100%; margin-top: 10px;" disabled>
            💾 Create Backup
          </button>
        </div>

        <!-- Restore Panel -->
        <div id="panel-restore" class="backup-sub-panel" style="display: none;">
          <div class="form-group">
            <label for="restore-path-input">Local Image Path (.img)</label>
            <div style="display: flex; gap: 10px;">
              <input type="text" id="restore-path-input" class="form-control" placeholder="Select image to restore..." readonly style="flex: 1;">
              <button id="btn-browse-restore" class="btn btn-secondary">Browse</button>
            </div>
            <small>Select the image from your computer to write back to the SD card.</small>
          </div>
          <button id="btn-run-restore" class="btn btn-danger" style="width: 100%; margin-top: 10px;" disabled>
            ⚡ Restore Backup
          </button>
        </div>

        <!-- Progress & Status Panel -->
        <div id="backup-progress-panel" class="glass-inset" style="display: none; margin-top: 24px; padding: 16px; border-radius: var(--radius-md);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px;">
            <span id="backup-progress-status" style="font-weight: 600; color: var(--accent-cyan);">Backing up...</span>
            <span id="backup-progress-pct" style="font-family: var(--font-mono); font-weight: 700;">0%</span>
          </div>
          <div class="progress-bar-container" style="height: 8px; margin-bottom: 12px;">
            <div id="backup-progress-bar" class="progress-bar" style="width: 0%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono); margin-bottom: 12px;">
            <span id="backup-progress-rate">Speed: -- MB/s</span>
            <span id="backup-progress-transferred">0 MB / 0 MB</span>
            <span id="backup-progress-eta">Remaining: --s</span>
          </div>
          <button id="btn-cancel-backup" class="btn btn-danger" style="width: 100%; padding: 6px 12px; font-size: 12px;">
            Cancel Operation
          </button>
        </div>
      </div>
    `;

    // DOM Elements
    const btnCheckSd = container.querySelector('#btn-check-sd');
    const sdSizeText = container.querySelector('#sd-size-text');
    const tabBackupBtn = container.querySelector('#tab-backup-btn');
    const tabRestoreBtn = container.querySelector('#tab-restore-btn');
    const panelBackup = container.querySelector('#panel-backup');
    const panelRestore = container.querySelector('#panel-restore');
    const btnBrowseBackup = container.querySelector('#btn-browse-backup');
    const backupPathInput = container.querySelector('#backup-path-input');
    const btnRunBackup = container.querySelector('#btn-run-backup');
    const btnBrowseRestore = container.querySelector('#btn-browse-restore');
    const restorePathInput = container.querySelector('#restore-path-input');
    const btnRunRestore = container.querySelector('#btn-run-restore');
    const progressPanel = container.querySelector('#backup-progress-panel');
    const progressStatus = container.querySelector('#backup-progress-status');
    const progressPct = container.querySelector('#backup-progress-pct');
    const progressBar = container.querySelector('#backup-progress-bar');
    const progressRate = container.querySelector('#backup-progress-rate');
    const progressTransferred = container.querySelector('#backup-progress-transferred');
    const progressEta = container.querySelector('#backup-progress-eta');
    const btnCancelBackup = container.querySelector('#btn-cancel-backup');

    function disableInputs(disabled) {
      if (btnCheckSd) btnCheckSd.disabled = disabled;
      if (tabBackupBtn) tabBackupBtn.disabled = disabled;
      if (tabRestoreBtn) tabRestoreBtn.disabled = disabled;
      if (btnBrowseBackup) btnBrowseBackup.disabled = disabled;
      if (btnBrowseRestore) btnBrowseRestore.disabled = disabled;
      if (btnRunBackup) btnRunBackup.disabled = disabled || !backupPathInput.value;
      if (btnRunRestore) btnRunRestore.disabled = disabled || !restorePathInput.value;
    }

    // Check Size Button
    if (btnCheckSd) {
      btnCheckSd.addEventListener('click', async () => {
        btnCheckSd.disabled = true;
        btnCheckSd.innerText = '🔍 Checking...';
        sdSizeText.innerText = 'Checking size...';

        try {
          const result = await pibridge.backupGetDiskInfo({
            ip: credentials.ip,
            username: credentials.username,
            password: credentials.password
          });

          if (isDisconnected) return;

          if (result.success && result.disks) {
            const rootPart = result.disks.find(d => d.mountpoint === '/');
            if (rootPart) {
              let parentDiskName = rootPart.name;
              if (parentDiskName.match(/^(mmcblk\d+|nvme\d+n\d+)p\d+$/)) {
                parentDiskName = parentDiskName.replace(/p\d+$/, '');
              } else if (parentDiskName.match(/^sd[a-z]\d+$/)) {
                parentDiskName = parentDiskName.replace(/\d+$/, '');
              }
              selectedDeviceName = parentDiskName;

              const parentDisk = result.disks.find(d => d.name === parentDiskName);
              selectedDeviceSize = parentDisk ? parentDisk.size : rootPart.size;

              sdSizeText.innerText = `Total Size: ${formatBytes(selectedDeviceSize)} [Device: /dev/${selectedDeviceName}]`;
              showToast('Successfully retrieved disk information!', 'success');
            } else {
              const fallbackDisk = result.disks[0] || { name: 'mmcblk0', size: 32000000000 };
              selectedDeviceName = fallbackDisk.name;
              selectedDeviceSize = fallbackDisk.size;
              sdSizeText.innerText = `Total Size: ${formatBytes(selectedDeviceSize)} [Device: /dev/${selectedDeviceName}]`;
              showToast('Retrieved fallback disk information.', 'warning');
            }
          } else {
            sdSizeText.innerText = 'Could not fetch SD card info';
            showToast(`Failed: ${result.error}`, 'error');
          }
        } catch (err) {
          if (isDisconnected) return;
          sdSizeText.innerText = 'Error checking size';
          showToast(`Error: ${err.message}`, 'error');
        } finally {
          if (!isDisconnected) {
            btnCheckSd.disabled = false;
            btnCheckSd.innerText = '🔍 Check Size';
          }
        }
      });
    }

    // Backup & Restore tabs switching
    if (tabBackupBtn && tabRestoreBtn) {
      tabBackupBtn.addEventListener('click', () => {
        tabBackupBtn.className = 'btn btn-primary';
        tabRestoreBtn.className = 'btn btn-secondary';
        panelBackup.style.display = 'block';
        panelRestore.style.display = 'none';
      });

      tabRestoreBtn.addEventListener('click', () => {
        tabBackupBtn.className = 'btn btn-secondary';
        tabRestoreBtn.className = 'btn btn-primary';
        panelBackup.style.display = 'none';
        panelRestore.style.display = 'block';
      });
    }

    // Browse save path
    if (btnBrowseBackup) {
      btnBrowseBackup.addEventListener('click', async () => {
        try {
          const filePath = await pibridge.backupSelectSavePath();
          if (isDisconnected) return;
          if (filePath) {
            backupPathInput.value = filePath;
            btnRunBackup.disabled = false;
          }
        } catch (err) {
          showToast(`Browse error: ${err.message}`, 'error');
        }
      });
    }

    // Browse restore path
    if (btnBrowseRestore) {
      btnBrowseRestore.addEventListener('click', async () => {
        try {
          const filePath = await pibridge.backupSelectRestorePath();
          if (isDisconnected) return;
          if (filePath) {
            restorePathInput.value = filePath;
            btnRunRestore.disabled = false;
          }
        } catch (err) {
          showToast(`Browse error: ${err.message}`, 'error');
        }
      });
    }

    // Create Backup trigger
    if (btnRunBackup) {
      btnRunBackup.addEventListener('click', async () => {
        const localSavePath = backupPathInput.value;
        if (!localSavePath) {
          showToast('Please select a save path first.', 'error');
          return;
        }

        disableInputs(true);
        progressPanel.style.display = 'block';
        progressStatus.innerText = 'Connecting and configuring backup...';
        progressPct.innerText = '0%';
        progressBar.style.width = '0%';
        progressRate.innerText = 'Speed: -- MB/s';
        progressTransferred.innerText = '0 MB / 0 MB';
        progressEta.innerText = 'Remaining: --s';

        operationStartTime = Date.now();
        operationType = 'backup';

        try {
          const result = await pibridge.backupStart({
            ip: credentials.ip,
            username: credentials.username,
            password: credentials.password,
            device: selectedDeviceName,
            localPath: localSavePath
          });

          if (isDisconnected) return;

          if (result.success) {
            showToast('SD Card backup completed successfully!', 'success');
          } else {
            showToast(`Backup failed: ${result.error}`, 'error');
          }
        } catch (err) {
          if (isDisconnected) return;
          showToast(`Backup error: ${err.message}`, 'error');
        } finally {
          if (!isDisconnected) {
            disableInputs(false);
            progressPanel.style.display = 'none';
          }
        }
      });
    }

    // Restore Backup trigger
    if (btnRunRestore) {
      btnRunRestore.addEventListener('click', async () => {
        const localImgPath = restorePathInput.value;
        if (!localImgPath) {
          showToast('Please select an image path first.', 'error');
          return;
        }

        const confirmText = `WARNING: Restoring an image will COMPLETELY OVERWRITE all data on the SD Card of the device at ${credentials.ip}.\n\nAre you sure you want to write "${localImgPath}" to the target storage device /dev/${selectedDeviceName}? This operation cannot be undone!`;
        if (!confirm(confirmText)) {
          return;
        }

        disableInputs(true);
        progressPanel.style.display = 'block';
        progressStatus.innerText = 'Connecting and initiating flash write...';
        progressPct.innerText = '0%';
        progressBar.style.width = '0%';
        progressRate.innerText = 'Speed: -- MB/s';
        progressTransferred.innerText = '0 MB / 0 MB';
        progressEta.innerText = 'Remaining: --s';

        operationStartTime = Date.now();
        operationType = 'restore';

        try {
          const result = await pibridge.backupRestoreStart({
            ip: credentials.ip,
            username: credentials.username,
            password: credentials.password,
            device: selectedDeviceName,
            localPath: localImgPath
          });

          if (isDisconnected) return;

          if (result.success) {
            showToast('SD Card restore completed successfully!', 'success');
          } else {
            showToast(`Restore failed: ${result.error}`, 'error');
          }
        } catch (err) {
          if (isDisconnected) return;
          showToast(`Restore error: ${err.message}`, 'error');
        } finally {
          if (!isDisconnected) {
            disableInputs(false);
            progressPanel.style.display = 'none';
          }
        }
      });
    }

    // Cancel Button
    if (btnCancelBackup) {
      btnCancelBackup.addEventListener('click', async () => {
        btnCancelBackup.disabled = true;
        btnCancelBackup.innerText = 'Cancelling...';
        try {
          const res = await pibridge.backupCancel({ ip: credentials.ip });
          if (isDisconnected) return;
          if (res.success) {
            showToast('Cancel command sent.', 'info');
          } else {
            showToast(`Failed to cancel: ${res.error}`, 'error');
          }
        } catch (err) {
          if (isDisconnected) return;
          showToast(`Cancel error: ${err.message}`, 'error');
        } finally {
          if (!isDisconnected) {
            btnCancelBackup.disabled = false;
            btnCancelBackup.innerText = 'Cancel Operation';
          }
        }
      });
    }

    // Unified progress listener callback
    pibridge.onBackupProgress((data) => {
      if (isDisconnected) return;
      if (!progressPanel || !progressPanel.isConnected) return;

      progressStatus.innerText = operationType === 'backup'
        ? 'Streaming SD Card image to local computer...'
        : 'Writing image stream back to SD Card...';

      const pct = data.percent !== undefined ? data.percent : 0;
      progressPct.innerText = `${pct}%`;
      progressBar.style.width = `${pct}%`;
      progressRate.innerText = `Speed: ${data.speed || '-- MB/s'}`;

      const total = data.totalBytes || selectedDeviceSize || 0;
      progressTransferred.innerText = `${formatBytes(data.bytesTransferred)} / ${formatBytes(total)}`;

      const elapsedSeconds = (Date.now() - operationStartTime) / 1000;
      const averageSpeed = elapsedSeconds > 0 ? (data.bytesTransferred / elapsedSeconds) : 0;
      const remainingBytes = Math.max(0, total - data.bytesTransferred);
      const etaSeconds = averageSpeed > 0 ? (remainingBytes / averageSpeed) : null;

      progressEta.innerText = `Remaining: ${formatEta(etaSeconds)}`;
    });

    return {
      disconnect: () => {
        isDisconnected = true;
        container.innerHTML = '';
      }
    };
  };
})();
