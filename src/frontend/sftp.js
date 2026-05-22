// SFTP File Explorer View Module for PiBridge
// Initialised via: window.initSftp(pibridge, containerId, credentials)
// Scoped CSS styles are injected dynamically.
// Class names are prefixed with `sftp-` to avoid conflicts.

(function () {
  'use strict';

  // Inject SFTP specific styling to maintain dark glassmorphism look
  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'sftp-view-styles';
    style.textContent = `
      .sftp-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 16px;
        animation: fadeIn 0.3s ease;
      }
      .sftp-status-banner {
        padding: 10px 16px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 500;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: -4px;
      }
      .sftp-status-banner.success {
        background: rgba(16, 185, 129, 0.08);
        color: var(--accent-green);
        border: 1px solid rgba(16, 185, 129, 0.2);
      }
      .sftp-status-banner.error {
        background: rgba(239, 68, 68, 0.08);
        color: var(--accent-red);
        border: 1px solid rgba(239, 68, 68, 0.2);
      }
      .sftp-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 14px 20px;
        border-radius: var(--radius-md);
      }
      .sftp-path-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-grow: 1;
      }
      .sftp-path-input {
        flex-grow: 1;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid var(--border-light);
        color: var(--text-primary);
        border-radius: var(--radius-sm);
        padding: 8px 12px;
        font-family: var(--font-mono);
        font-size: 13px;
        outline: none;
      }
      .sftp-path-input:focus {
        border-color: var(--accent-purple);
      }
      .sftp-action-bar {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .sftp-explorer-panel {
        flex-grow: 1;
        border-radius: var(--radius-lg);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
        min-height: 380px;
      }
      .sftp-table-container {
        flex-grow: 1;
        overflow-y: auto;
        max-height: 480px;
      }
      .sftp-table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
      }
      .sftp-table th, .sftp-table td {
        padding: 12px 16px;
        font-size: 13px;
        border-bottom: 1px solid var(--border-light);
      }
      .sftp-table th {
        background: rgba(12, 12, 22, 0.9);
        color: var(--text-muted);
        font-weight: 600;
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.5px;
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .sftp-table tr {
        transition: background 0.15s ease;
      }
      .sftp-table tbody tr:hover {
        background: rgba(255, 255, 255, 0.02);
      }
      .sftp-name-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
      }
      .sftp-icon {
        font-size: 16px;
        display: inline-block;
        width: 20px;
        text-align: center;
      }
      .sftp-size-cell {
        font-family: var(--font-mono);
        color: var(--text-secondary);
      }
      .sftp-time-cell {
        color: var(--text-secondary);
      }
      .sftp-perm-cell {
        font-family: var(--font-mono);
        color: var(--text-muted);
      }
      .sftp-actions-cell {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }
      .sftp-btn-small {
        padding: 4px 8px;
        font-size: 11px;
        border-radius: var(--radius-sm);
        height: 26px;
      }
      .sftp-loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(7, 7, 15, 0.85);
        backdrop-filter: blur(4px);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        z-index: 10;
        border-radius: var(--radius-lg);
      }
      .sftp-spinner {
        width: 42px;
        height: 42px;
        border: 4px solid rgba(168, 85, 247, 0.1);
        border-top-color: var(--accent-purple);
        border-radius: 50%;
        animation: sftp-spin 1s infinite linear;
      }
      @keyframes sftp-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .sftp-preview-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(7, 7, 15, 0.8);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.2s ease;
      }
      .sftp-preview-content {
        background: var(--bg-card, rgba(30, 30, 46, 0.9));
        border: 1px solid var(--border-light, rgba(255, 255, 255, 0.08));
        border-radius: var(--radius-lg, 12px);
        width: 80%;
        max-width: 800px;
        height: 80%;
        max-height: 600px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
      }
      .sftp-preview-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.08));
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .sftp-preview-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .sftp-preview-close {
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 24px;
        cursor: pointer;
      }
      .sftp-preview-close:hover {
        color: var(--text-primary);
      }
      .sftp-preview-body {
        flex-grow: 1;
        padding: 20px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .sftp-preview-textarea {
        width: 100%;
        flex-grow: 1;
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid var(--border-light, rgba(255, 255, 255, 0.08));
        border-radius: var(--radius-md, 8px);
        color: var(--text-primary);
        font-family: var(--font-mono, monospace);
        font-size: 13px;
        padding: 12px;
        resize: none;
        outline: none;
      }
      .sftp-preview-textarea:focus {
        border-color: var(--accent-purple);
      }
      .sftp-preview-footer {
        padding: 16px 20px;
        border-top: 1px solid var(--border-light, rgba(255, 255, 255, 0.08));
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  // Helper to trigger toast notifications
  function showToast(message, type = 'info') {
    if (window.showToast) {
      window.showToast(message, type);
      return;
    }

    const toastContainer = document.getElementById('toast-container') || document.body;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.cssText = `
      padding: 12px 20px;
      margin-top: 10px;
      border-radius: var(--radius-md);
      background: var(--bg-card);
      border: 1px solid var(--border-light);
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      animation: fadeIn 0.3s ease;
      z-index: 1000;
    `;
    
    let icon = 'ℹ️';
    if (type === 'success') {
      icon = '✅';
      toast.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    }
    if (type === 'error') {
      icon = '❌';
      toast.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    }

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'fadeIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Main init function
  window.initSftp = async function initSftp(pibridge, containerId, credentials) {
    console.log(`[SFTP] initSftp called for container="${containerId}", ip="${credentials.ip}"`);

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[SFTP] Container not found: #${containerId}`);
      return null;
    }

    injectStyles();

    // Reset container and create UI structure directly inside container
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'sftp-container';
    root.innerHTML = `
      <!-- Status / Details banner -->
      <div class="sftp-status-banner success" id="sftp-status-banner">
        <span id="sftp-status-text">Connected to ${credentials.username}@${credentials.ip}</span>
        <button class="btn btn-text sftp-btn-small" id="sftp-disconnect-btn" style="display: none;">Disconnect</button>
      </div>

      <!-- Explorer Toolbar -->
      <div class="sftp-toolbar glass" id="sftp-toolbar">
        <div class="sftp-path-bar">
          <button class="btn btn-secondary sftp-btn-small" id="sftp-up-btn" disabled>⬆️ Go Up</button>
          <input type="text" id="sftp-path-input" class="sftp-path-input" value="/home/pi">
        </div>
        <div class="sftp-action-bar">
          <button class="btn btn-secondary" id="sftp-refresh-btn">🔄 Refresh</button>
          <button class="btn btn-secondary" id="sftp-mkdir-btn">📁 Create Folder</button>
          <button class="btn btn-primary" id="sftp-upload-btn">📤 Upload File</button>
          <input type="file" id="sftp-file-chooser" style="display: none;">
        </div>
      </div>

      <!-- Explorer File Grid/List -->
      <div class="sftp-explorer-panel glass" id="sftp-explorer-panel">
        <!-- Loading Overlay -->
        <div class="sftp-loading-overlay" id="sftp-loading-overlay" style="display: none;">
          <div class="sftp-spinner"></div>
          <div id="sftp-loading-text">Loading directory...</div>
        </div>
        
        <!-- Table Container -->
        <div class="sftp-table-container">
          <table class="sftp-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th>Permissions</th>
                <th style="text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody id="sftp-table-body">
              <!-- Dynamically populated -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    container.appendChild(root);

    let currentIp = credentials.ip;
    let currentUsername = credentials.username;
    let currentPassword = credentials.password;
    let currentPath = '/home/pi';
    let files = [];

    // Helper functions
    function pathJoin(base, part) {
      if (part === '..') {
        const segments = base.split('/').filter(Boolean);
        segments.pop();
        return '/' + segments.join('/');
      }
      const joined = base.endsWith('/') ? base + part : base + '/' + part;
      return joined.replace(/\/+/g, '/');
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatMtime(mtime) {
      if (!mtime) return '--';
      return new Date(mtime).toLocaleString();
    }

    function showLoading(msg) {
      const overlay = root.querySelector('#sftp-loading-overlay');
      const text = root.querySelector('#sftp-loading-text');
      if (overlay && text) {
        text.innerText = msg || 'Loading...';
        overlay.style.display = 'flex';
      }
    }

    function hideLoading() {
      const overlay = root.querySelector('#sftp-loading-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
    }

    async function loadDirectory(dirPath) {
      showLoading(`Loading directory contents...`);
      const pathInput = root.querySelector('#sftp-path-input');
      const upBtn = root.querySelector('#sftp-up-btn');
      
      try {
        const filesList = await pibridge.sftpListDir({
          ip: currentIp,
          username: currentUsername,
          password: currentPassword,
          dirPath
        });

        currentPath = dirPath;
        files = filesList;

        if (pathInput) pathInput.value = dirPath;
        if (upBtn) upBtn.disabled = (dirPath === '/');

        // Update count-badge in the header
        const fileCount = document.getElementById('sftp-file-count');
        if (fileCount) fileCount.innerText = `${filesList.length} Items`;

        renderFiles();
        hideLoading();
      } catch (err) {
        hideLoading();
        showToast(`Failed to open directory: ${err.message}`, 'error');
        throw err;
      }
    }

    function renderFiles() {
      const tableBody = root.querySelector('#sftp-table-body');
      if (!tableBody) return;

      tableBody.innerHTML = '';

      if (files.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px;">
              📁 Empty Directory
            </td>
          </tr>
        `;
        return;
      }

      const sorted = [...files].sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      sorted.forEach(file => {
        const row = document.createElement('tr');
        
        const icon = file.isDirectory ? '📁' : '📄';
        const sizeStr = file.isDirectory ? '--' : formatBytes(file.size);
        const modifiedStr = formatMtime(file.mtime);

        row.innerHTML = `
          <td>
            <div class="sftp-name-cell">
              <span class="sftp-icon">${icon}</span>
              <span>${file.name}</span>
            </div>
          </td>
          <td class="sftp-size-cell">${sizeStr}</td>
          <td class="sftp-time-cell">${modifiedStr}</td>
          <td class="sftp-perm-cell">${file.permissions}</td>
          <td class="sftp-actions-cell">
            ${!file.isDirectory ? `<button class="btn btn-secondary sftp-btn-small btn-view" title="View/Edit">👁️ View</button>` : ''}
            ${!file.isDirectory ? `<button class="btn btn-primary sftp-btn-small btn-download" title="Download">📥 Down</button>` : ''}
            <button class="btn btn-danger sftp-btn-small btn-delete" title="Delete">🗑️ Delete</button>
          </td>
        `;

        if (file.isDirectory) {
          row.addEventListener('click', (e) => {
            if (e.target.closest('.sftp-actions-cell')) return;
            const nextPath = pathJoin(currentPath, file.name);
            loadDirectory(nextPath);
          });
        } else {
          row.addEventListener('click', (e) => {
            if (e.target.closest('.sftp-actions-cell')) return;
            openPreview(file.name);
          });
        }

        const viewBtn = row.querySelector('.btn-view');
        if (viewBtn) {
          viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPreview(file.name);
          });
        }

        const downloadBtn = row.querySelector('.btn-download');
        if (downloadBtn) {
          downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDownload(file.name);
          });
        }

        const deleteBtn = row.querySelector('.btn-delete');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDelete(file.name, file.isDirectory);
          });
        }

        tableBody.appendChild(row);
      });
    }

    async function handleUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      const localPath = file.path;
      if (!localPath) {
        showToast('Could not retrieve local absolute path in this Electron build.', 'error');
        return;
      }

      const filename = file.name;
      const remotePath = pathJoin(currentPath, filename);

      showLoading(`Uploading ${filename}...`);
      try {
        const result = await pibridge.sftpUpload({
          ip: currentIp,
          username: currentUsername,
          password: currentPassword,
          localPath,
          remotePath
        });

        if (result && result.success) {
          showToast(`Successfully uploaded "${filename}"`, 'success');
          loadDirectory(currentPath);
        } else {
          throw new Error((result && result.error) || 'Upload failed');
        }
      } catch (err) {
        hideLoading();
        showToast(`Upload failed: ${err.message}`, 'error');
      }

      e.target.value = '';
    }

    async function handleDownload(filename) {
      const remotePath = pathJoin(currentPath, filename);

      showLoading(`Downloading ${filename}...`);
      try {
        const result = await pibridge.sftpDownload({
          ip: currentIp,
          username: currentUsername,
          password: currentPassword,
          remotePath,
          localPath: null
        });

        hideLoading();
        if (result && result.success) {
          showToast(`Successfully downloaded "${filename}"`, 'success');
        } else if (result && result.error && result.error !== 'Download cancelled') {
          showToast(`Download failed: ${result.error}`, 'error');
        }
      } catch (err) {
        hideLoading();
        showToast(`Download failed: ${err.message}`, 'error');
      }
    }

    async function handleDelete(filename, isDirectory) {
      const typeLabel = isDirectory ? 'directory' : 'file';
      const confirmDelete = confirm(`Are you sure you want to permanently delete the remote ${typeLabel} "${filename}"?`);
      if (!confirmDelete) return;

      const remotePath = pathJoin(currentPath, filename);
      showLoading(`Deleting ${filename}...`);

      try {
        const result = await pibridge.sftpDelete({
          ip: currentIp,
          username: currentUsername,
          password: currentPassword,
          remotePath,
          isDirectory
        });

        if (result && result.success) {
          showToast(`Successfully deleted "${filename}"`, 'success');
          loadDirectory(currentPath);
        } else {
          throw new Error((result && result.error) || 'Delete failed');
        }
      } catch (err) {
        hideLoading();
        showToast(`Delete failed: ${err.message}`, 'error');
      }
    }

    async function handleCreateFolder() {
      const folderName = prompt('Enter name for the new folder:');
      if (!folderName || folderName.trim() === '') return;

      const remotePath = pathJoin(currentPath, folderName.trim());
      showLoading(`Creating folder "${folderName}"...`);

      try {
        const result = await pibridge.sftpMkdir({
          ip: currentIp,
          username: currentUsername,
          password: currentPassword,
          remotePath
        });

        if (result && result.success) {
          showToast(`Successfully created folder "${folderName}"`, 'success');
          loadDirectory(currentPath);
        } else {
          throw new Error((result && result.error) || 'Folder creation failed');
        }
      } catch (err) {
        hideLoading();
        showToast(`Folder creation failed: ${err.message}`, 'error');
      }
    }

    async function openPreview(filename) {
      const remotePath = pathJoin(currentPath, filename);
      showLoading(`Reading ${filename}...`);
      try {
        const result = await pibridge.sftpReadFile({
          ip: currentIp,
          username: currentUsername,
          password: currentPassword,
          remotePath
        });
        hideLoading();
        
        if (!result || !result.success) {
          throw new Error((result && result.error) || 'Failed to read file');
        }
        
        showPreviewModal(filename, remotePath, result.content);
      } catch (err) {
        hideLoading();
        showToast(`Failed to read file: ${err.message}`, 'error');
      }
    }

    function isTextFile(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      const textExts = ['txt', 'md', 'json', 'sh', 'py', 'js', 'css', 'html', 'conf', 'cfg', 'ini', 'xml', 'yaml', 'yml', 'bashrc', 'profile'];
      return !filename.includes('.') || textExts.includes(ext);
    }

    function showPreviewModal(filename, remotePath, content) {
      const modal = document.createElement('div');
      modal.className = 'sftp-preview-modal';
      
      const isEditable = isTextFile(filename);
      const readOnlyAttr = isEditable ? '' : 'readonly';
      
      modal.innerHTML = `
        <div class="sftp-preview-content">
          <div class="sftp-preview-header">
            <span class="sftp-preview-title">Viewing: ${filename}</span>
            <button class="sftp-preview-close">&times;</button>
          </div>
          <div class="sftp-preview-body">
            <textarea class="sftp-preview-textarea" ${readOnlyAttr}></textarea>
          </div>
          <div class="sftp-preview-footer">
            <button class="btn btn-secondary btn-cancel">Close</button>
            ${isEditable ? `<button class="btn btn-primary btn-save">Save Changes</button>` : ''}
          </div>
        </div>
      `;
      
      const textarea = modal.querySelector('.sftp-preview-textarea');
      textarea.value = content;
      
      const closeModal = () => modal.remove();
      
      modal.querySelector('.sftp-preview-close').addEventListener('click', closeModal);
      modal.querySelector('.btn-cancel').addEventListener('click', closeModal);
      
      if (isEditable) {
        modal.querySelector('.btn-save').addEventListener('click', async () => {
          const newContent = textarea.value;
          showLoading(`Saving ${filename}...`);
          try {
            const saveResult = await pibridge.sftpWriteFile({
              ip: currentIp,
              username: currentUsername,
              password: currentPassword,
              remotePath,
              content: newContent
            });
            hideLoading();
            
            if (!saveResult || !saveResult.success) {
              throw new Error((saveResult && saveResult.error) || 'Failed to save');
            }
            
            showToast(`Saved ${filename} successfully!`, 'success');
            closeModal();
            loadDirectory(currentPath);
          } catch (err) {
            hideLoading();
            showToast(`Failed to save: ${err.message}`, 'error');
          }
        });
      }
      
      document.body.appendChild(modal);
    }

    // Bind event listeners
    root.querySelector('#sftp-refresh-btn').addEventListener('click', () => loadDirectory(currentPath));
    root.querySelector('#sftp-mkdir-btn').addEventListener('click', handleCreateFolder);
    
    const fileChooser = root.querySelector('#sftp-file-chooser');
    root.querySelector('#sftp-upload-btn').addEventListener('click', () => fileChooser.click());
    fileChooser.addEventListener('change', handleUpload);

    root.querySelector('#sftp-up-btn').addEventListener('click', () => {
      const parentPath = pathJoin(currentPath, '..');
      loadDirectory(parentPath);
    });

    const pathInput = root.querySelector('#sftp-path-input');
    pathInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        loadDirectory(pathInput.value.trim());
      }
    });

    // Auto connect and load directory contents on startup
    try {
      await loadDirectory(currentPath);
    } catch (err) {
      console.error('[SFTP] Initial folder load failed:', err);
    }

    return {
      disconnect: () => {
        container.innerHTML = '';
      }
    };
  };
})();
