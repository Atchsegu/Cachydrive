import { translations } from './i18n.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// --- DİL YÖNETİMİ (i18n) - Varsayılan İngilizce (en) ---
let currentLang = localStorage.getItem('gdrive_language') || 'en';

function t(key) {
  if (translations[currentLang] && translations[currentLang][key]) {
    return translations[currentLang][key];
  }
  if (translations['en'] && translations['en'][key]) {
    return translations['en'][key];
  }
  return key;
}

function formatPercent(val) {
  return currentLang === 'en' ? `${val}%` : `%${val}`;
}

// --- ARAYÜZ ELEMANLARINI YAKALAMA ---
const syncBtn = document.getElementById('sync-btn');
const stopBtn = document.getElementById('stop-btn');
const statusBadge = document.querySelector('.status-badge');
const progressBar = document.querySelector('.progress-bar');
const statusText = document.getElementById('status-desc');
const dashboardLogList = document.querySelector('.log-list');
const fullLogList = document.getElementById('full-log-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const scanCounter = document.getElementById('scan-counter');

// Ayarlar Elemanları
const appLanguageSelect  = document.getElementById('app-language');
const saveSettingsBtn    = document.getElementById('save-settings-btn');
const syncIntervalSelect = document.getElementById('sync-interval');
const conflictRuleSelect = document.getElementById('conflict-rule');
const autoStartSelect    = document.getElementById('auto-start');

// Klasör ve Dosya Seçimi (Selective Sync) Elemanları
const scanCloudBtn          = document.getElementById('scan-cloud-btn');
const exclusionSummaryBadge = document.getElementById('exclusion-summary-badge');
const treeSearchInput       = document.getElementById('tree-search-input');
const folderTreeRoot        = document.getElementById('folder-tree-root');
const deleteLocalCheckbox   = document.getElementById('delete-local-checkbox');
const applyExclusionsBtn    = document.getElementById('apply-exclusions-btn');

// Onay Penceresi (Modal) Elemanları
const deleteConfirmModal = document.getElementById('delete-confirm-modal');
const modalDeleteList    = document.getElementById('modal-delete-list');
const modalCancelBtn     = document.getElementById('modal-cancel-btn');
const modalConfirmBtn    = document.getElementById('modal-confirm-btn');

// --- LİMİTLER ---
const MAX_DASHBOARD_LOGS = 50;
const MAX_HISTORY_LOGS = 200;

// --- DİNAMİK LOG TİPLERİ ---
function getLogTypes() {
  return {
    'file-new':    { icon: '⬆', badge: t('log_badge_new_file'),     color: '#1A73E8', bg: 'rgba(26,115,232,0.07)', bold: true  },
    'file-down':   { icon: '⬇', badge: t('log_badge_downloaded'),   color: '#1E8E3E', bg: 'rgba(30,142,62,0.07)',  bold: true  },
    'file-update': { icon: '✎', badge: t('log_badge_updated'),      color: '#F9AB00', bg: 'rgba(249,171,0,0.07)',  bold: true  },
    'file-del':    { icon: '✕', badge: t('log_badge_file_deleted'),  color: '#D93025', bg: 'rgba(217,48,37,0.07)',  bold: true  },
    'folder-new':  { icon: '▶', badge: t('log_badge_new_folder'),    color: '#673AB7', bg: 'rgba(103,58,183,0.07)', bold: true  },
    'folder-del':  { icon: '✕', badge: t('log_badge_folder_deleted'), color: '#D93025', bg: 'rgba(217,48,37,0.07)',  bold: true  },
    'info':        { icon: '·', badge: '',                            color: '#5F6368', bg: 'transparent',            bold: false },
    'system':      { icon: '◈', badge: t('log_badge_system'),        color: '#80868B', bg: 'transparent',            bold: false },
    'success':     { icon: '✔', badge: t('log_badge_completed'),     color: '#1E8E3E', bg: 'rgba(30,142,62,0.07)',  bold: true  },
    'error':       { icon: '!', badge: t('log_badge_error'),         color: '#D93025', bg: 'rgba(217,48,37,0.07)',  bold: true  },
  };
}

// Yerinde güncellenen tarama satırı referansları
let _scanDash = null;
let _scanDashMsg = null;
let _scanDashBadge = null;

// Tahmini toplam öğe sayısı
let estimatedTotal = parseInt(localStorage.getItem('gdrive_last_total_items')) || 0;
let lastActiveListed = 0;

// Kontrol bayrakları
let stopRequested = false;
let isSyncing = false;
let hasTransferStats = false;
let syncIntervalId = null;

// Seçmeli Senkronizasyon (Selective Sync) Durumu
// Anahtar: göreli yol (relPath), Değer: is_dir (boolean)
const excludedMap = new Map();
const knownItemsMap = new Map();
let treeInitialized = false;
let isScanningCloud = false;

// --- DİLİ TÜM UYGULAMAYA UYGULAMA ---
function applyLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('gdrive_language', lang);

  if (appLanguageSelect) appLanguageSelect.value = lang;

  // HTML'deki tüm data-i18n etiketli elemanları güncelle
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang] && typeof translations[lang][key] === 'string') {
      el.textContent = translations[lang][key];
    }
  });

  if (treeSearchInput) {
    treeSearchInput.placeholder = t('tree_search_placeholder');
  }
  if (scanCloudBtn) {
    scanCloudBtn.textContent = isScanningCloud ? t('btn_scanning_cloud') : t('btn_scan_cloud');
  }

  // Sistem tepsisi (tray menu) dilini Rust backend'e bildir
  invoke('update_tray_lang', { lang }).catch(() => {});

  // Buton ve durum rozetini güncel duruma göre yenile
  if (!isSyncing) {
    if (syncBtn) syncBtn.textContent = t('btn_sync');
    if (statusBadge) {
      statusBadge.innerHTML = `<span class="dot green-dot"></span> <span id="status-badge-text">${t('status_active')}</span>`;
      statusBadge.style.color           = 'var(--google-green)';
      statusBadge.style.borderColor     = 'rgba(30, 142, 62, 0.2)';
      statusBadge.style.backgroundColor = '#E6F4EA';
    }
  } else {
    if (syncBtn) syncBtn.textContent = t('btn_sync_in_progress');
    if (statusBadge) {
      statusBadge.innerHTML = `<span class="dot" style="background-color: var(--google-yellow); box-shadow: 0 0 8px var(--google-yellow);"></span> <span id="status-badge-text">${t('status_syncing')}</span>`;
    }
  }

  // İlk log satırının saatini güncelle
  const initTimeEl = document.getElementById('initial-log-time');
  if (initTimeEl && initTimeEl.textContent === '--:--:--') {
    initTimeEl.textContent = getCurrentTime();
  }

  if (_scanDashBadge) {
    _scanDashBadge.textContent = t('log_badge_scanning');
  }

  updateExclusionSummary();
  refreshTreeExclusionStates();
}

// --- YARDIMCI FONKSİYONLAR ---
function getCurrentTime() {
  const locale = currentLang === 'en' ? 'en-US' : 'tr-TR';
  return new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getBaseName(path) {
  if (!path) return '';
  return path.replace(/\/$/, '').split('/').pop() || path;
}

/** Verilen göreli yoldan ilgili Google Drive klasör yolunu döndürür */
function getFolderDisplayPath(relPath, isDir = false) {
  if (!relPath) return '~/GoogleDrive/';
  const cleaned = relPath.replace(/^\/+|\/+$/g, '');
  if (!cleaned) return '~/GoogleDrive/';
  if (isDir) {
    return `~/GoogleDrive/${cleaned}/`;
  }
  const lastSlash = cleaned.lastIndexOf('/');
  if (lastSlash === -1) {
    return '~/GoogleDrive/';
  }
  return `~/GoogleDrive/${cleaned.substring(0, lastSlash)}/`;
}

// --- YÜZEN KLASÖR YOLU BALONCUĞU (TOOLTIP) VE TIKLAMA YÖNETİMİ ---
const pathTooltip = document.createElement('div');
pathTooltip.id = 'path-tooltip';
pathTooltip.className = 'path-tooltip';
pathTooltip.setAttribute('role', 'tooltip');
pathTooltip.hidden = true;
document.body.appendChild(pathTooltip);

function showPathTooltip(linkEl) {
  const relPath = linkEl.dataset.relPath;
  if (!relPath) return;
  const isDir = linkEl.dataset.isDir === 'true';
  const folderPath = getFolderDisplayPath(relPath, isDir);

  pathTooltip.textContent = '';
  const folderSpan = document.createElement('span');
  folderSpan.textContent = `📁 ${folderPath}`;
  const hintSpan = document.createElement('span');
  hintSpan.className = 'tooltip-hint';
  hintSpan.textContent = `• ${t('tooltip_open_folder')}`;
  pathTooltip.appendChild(folderSpan);
  pathTooltip.appendChild(hintSpan);

  pathTooltip.hidden = false;

  const rect = linkEl.getBoundingClientRect();
  const tipRect = pathTooltip.getBoundingClientRect();

  let top = rect.top - tipRect.height - 6;
  if (top < 8) {
    top = rect.bottom + 6;
  }
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - tipRect.width - 8));

  pathTooltip.style.top = `${top}px`;
  pathTooltip.style.left = `${left}px`;
}

function hidePathTooltip() {
  pathTooltip.hidden = true;
}

document.addEventListener('pointerover', (e) => {
  const linkEl = e.target.closest('.log-link[data-rel-path]');
  if (linkEl) {
    showPathTooltip(linkEl);
  }
});

document.addEventListener('pointerout', (e) => {
  const linkEl = e.target.closest('.log-link[data-rel-path]');
  if (linkEl && !linkEl.contains(e.relatedTarget)) {
    hidePathTooltip();
  }
});

document.addEventListener('focusin', (e) => {
  const linkEl = e.target.closest('.log-link[data-rel-path]');
  if (linkEl) {
    showPathTooltip(linkEl);
  }
});

document.addEventListener('focusout', (e) => {
  const linkEl = e.target.closest('.log-link[data-rel-path]');
  if (linkEl) {
    hidePathTooltip();
  }
});

document.addEventListener('scroll', hidePathTooltip, true);

document.addEventListener('click', (e) => {
  const linkEl = e.target.closest('.log-link[data-rel-path]');
  if (linkEl) {
    const relPath = linkEl.dataset.relPath;
    if (relPath) {
      invoke('open_in_folder', { relPath }).catch(() => {});
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hidePathTooltip();
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    const linkEl = e.target.closest('.log-link[data-rel-path]');
    if (linkEl) {
      e.preventDefault();
      const relPath = linkEl.dataset.relPath;
      if (relPath) {
        invoke('open_in_folder', { relPath }).catch(() => {});
      }
    }
  }
});

/** rclone log satırını parse eder */
function parseRcloneLine(line) {
  let clean = line.replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /, '').trim();

  const levelMatch = clean.match(/^(INFO|NOTICE|ERROR|WARNING)\s*:\s*/);
  let level = 'INFO';
  if (levelMatch) {
    level = levelMatch[1];
    clean = clean.slice(levelMatch[0].length).trim();
  }

  const colonIdx = clean.indexOf(': ');
  if (colonIdx > -1) {
    return {
      level,
      path:    clean.substring(0, colonIdx).trim(),
      action:  clean.substring(colonIdx + 2).trim(),
      message: clean,
    };
  }

  return { level, path: null, action: null, message: clean };
}

/** Log listesine zengin görsel girdi ekler (XSS korumalı textContent kullanımı) */
function addLog(message, type = 'system', relPath = null, isDir = false) {
  const time = getCurrentTime();
  const logTypes = getLogTypes();
  const tInfo = logTypes[type] || logTypes['system'];

  const li = document.createElement('li');
  li.className = `log-entry log-${type}`;
  li.style.cssText = `background:${tInfo.bg}; border-left: 3px solid ${tInfo.color};`;

  const badge = tInfo.badge
    ? `<span class="log-badge" style="background:${tInfo.color}">${tInfo.badge}</span>`
    : `<span class="log-badge-empty"></span>`;

  li.innerHTML = `
    <span class="log-time">${time}</span>
    ${badge}
    <span class="log-icon" style="color:${tInfo.color}">${tInfo.icon}</span>
    <span class="log-message" style="color:${tInfo.color}; font-weight:${tInfo.bold ? 700 : 400}"></span>
  `;
  const msgEl = li.querySelector('.log-message');
  if (msgEl) {
    msgEl.textContent = message;
    if (relPath) {
      msgEl.classList.add('log-link');
      msgEl.dataset.relPath = relPath;
      msgEl.dataset.isDir = isDir ? 'true' : 'false';
      msgEl.tabIndex = 0;
      msgEl.setAttribute('role', 'button');
    }
  }

  // Ana panoya ekle ve üst sınırı koru
  if (dashboardLogList) {
    dashboardLogList.prepend(li);
    while (dashboardLogList.children.length > MAX_DASHBOARD_LOGS) {
      dashboardLogList.removeChild(dashboardLogList.lastChild);
    }
  }

  // İşlem geçmişine ekle ve üst sınırı koru
  if (fullLogList) {
    const liFull = li.cloneNode(true);
    fullLogList.prepend(liFull);
    while (fullLogList.children.length > MAX_HISTORY_LOGS) {
      fullLogList.removeChild(fullLogList.lastChild);
    }
  }
}

/** Tarama ilerlemesini ana pano log'unda yerinde günceller */
function upsertScanEntry(message) {
  if (!dashboardLogList) return;

  if (!_scanDash) {
    const logTypes = getLogTypes();
    const tInfo = logTypes['info'];
    _scanDash = document.createElement('li');
    _scanDash.className = 'log-entry log-info log-scanning';
    _scanDash.style.cssText = `background:${tInfo.bg}; border-left: 3px solid #1A73E8;`;
    _scanDash.innerHTML = `
      <span class="log-time">${getCurrentTime()}</span>
      <span class="log-badge" style="background:#1A73E8">${t('log_badge_scanning')}</span>
      <span class="log-icon" style="color:#1A73E8">↻</span>
      <span class="log-message" style="color:#1A73E8; font-weight:500"></span>
    `;
    _scanDashBadge = _scanDash.querySelector('.log-badge');
    _scanDashMsg   = _scanDash.querySelector('.log-message');
    dashboardLogList.prepend(_scanDash);
  }

  if (_scanDashMsg) {
    _scanDashMsg.textContent = message;
  }
}

/** Tarama satırını temizler */
function removeScanEntry() {
  if (_scanDash) {
    _scanDash.remove();
    _scanDash = null;
    _scanDashMsg = null;
    _scanDashBadge = null;
  }
}

/** Tarama sayıcısını ve durum kartını günceller */
function updateScanCounter(currentStr, totalStr, listedStr) {
  const cur    = parseInt(String(currentStr).replace(/[^\d]/g, '')) || 0;
  const tot    = parseInt(String(totalStr).replace(/[^\d]/g, ''))   || 0;
  const listed = listedStr ? parseInt(String(listedStr).replace(/[^\d]/g, '')) : null;

  if (listed !== null && listed > 0) {
    lastActiveListed = listed;
    if (listed > estimatedTotal) {
      estimatedTotal = listed;
    }
  } else {
    lastActiveListed = cur;
    if (cur > estimatedTotal) {
      estimatedTotal = cur;
    }
  }

  const locale = currentLang === 'en' ? 'en-US' : 'tr-TR';
  const helpers = translations[currentLang] || translations['en'];

  let text;
  let scanPct = null;
  if (listed !== null && listed > 0) {
    if (estimatedTotal > 0) {
      scanPct = Math.min(99, Math.max(2, Math.round((listed / estimatedTotal) * 100)));
      text = helpers.cnt_listed_and_checked(
        listed.toLocaleString(locale),
        estimatedTotal.toLocaleString(locale),
        cur.toLocaleString(locale)
      );
    } else {
      text = helpers.cnt_listed_only(listed.toLocaleString(locale), cur.toLocaleString(locale));
    }
  } else if (tot > 0) {
    const pct = Math.round(cur / tot * 100);
    scanPct = Math.min(99, Math.max(2, pct));
    text = helpers.cnt_scanned_pct(cur.toLocaleString(locale), tot.toLocaleString(locale), pct);
  } else {
    if (estimatedTotal > 0) {
      scanPct = Math.min(99, Math.max(2, Math.round((cur / estimatedTotal) * 100)));
      text = helpers.cnt_checked_est(cur.toLocaleString(locale), estimatedTotal.toLocaleString(locale));
    } else {
      text = helpers.cnt_checked_only(cur.toLocaleString(locale));
    }
  }

  if (!hasTransferStats && scanPct !== null) {
    progressBar.style.width = scanPct + '%';
    const pctEl = document.getElementById('stat-percent');
    if (pctEl) pctEl.textContent = formatPercent(scanPct);
  }

  if (statusText) statusText.textContent = text;
  if (scanCounter) { scanCounter.style.display = 'block'; scanCounter.textContent = text; }
  upsertScanEntry(text);
}

// --- RUST MOTORUNDAN GELEN CANLI VERİLERİ DİNLEME ---
listen('rclone-log', (event) => {
  const line = event.payload;
  if (!line || !line.trim()) return;

  // 1. İlerleme istatistikleri (Transferred: ... ETA)
  if (line.startsWith('Transferred:') && line.includes('ETA')) {
    const cleanLine = line.replace(/^Transferred:\s+/, '').trim();
    const parts = cleanLine.split(',');
    if (parts.length >= 4) {
      const sizeStr  = parts[0].trim();
      const pctRaw   = parts[1].trim();
      const speedStr = parts[2].trim();
      const etaStr   = parts[3].replace('ETA', '').trim();

      // Tarama aşamasında henüz dosya aktarımı başlamamışken rclone "0 B / 0 B, -, 0 B/s, ETA -"
      // gönderir; bu boş satırın "Taranıyor..." / "Hesaplanıyor..." ve tarama yüzdesini ezmesini önle.
      const isZeroPlaceholder = /^0\s*B\s*\/\s*0\s*B$/i.test(sizeStr) && (pctRaw === '-' || pctRaw === '0%');
      if (!isZeroPlaceholder) {
        hasTransferStats = true;
        document.getElementById('stat-size').textContent    = sizeStr;
        const pctVal = parseFloat(pctRaw);
        document.getElementById('stat-percent').textContent = !isNaN(pctVal) ? formatPercent(pctVal) : pctRaw;
        document.getElementById('stat-speed').textContent   = speedStr;
        document.getElementById('stat-eta').textContent     = etaStr;
        if (!isNaN(pctVal)) progressBar.style.width = pctVal + '%';
      }
    }
    return;
  }

  // 2. Dosya kontrolü sayıcısı — Checks: satırını yakala
  if (line.includes('Checks:')) {
    const m = line.match(/Checks:\s*([\d]+)\s*\/\s*([\d]+)(?:.*?Listed\s+([\d]+))?/);
    if (m) updateScanCounter(m[1], m[2], m[3]);
    return;
  }

  // 3. Gürültülü ve dahili rclone / bisync mesajlarını doğrudan atla
  const noisy = [
    'Setting --ignore-listing-checksum',
    'Bisyncing with Comparison Settings',
    '"Modtime"', '"Size"', '"Checksum"',
    'HashType', 'SlowHash', 'DownloadHash',
    'Elapsed time:',
    'Transferred:',
    'Building path list',
    'Validating listings',
    'Building listings',
    'Applying changes',
    'Waiting for checks to finish',
    'Waiting for transfers to finish',
    'Size and modification time the same',
    'Unchanged',
    'Matching',
    'Loaded md5 sums',
    'There was nothing to transfer',
    'Can\'t follow symlink',
    'Can\'t transfer non file',
    'Listed',
  ];
  if (noisy.some(n => line.includes(n))) return;

  // 4. Yapılandırılmış rclone satırını parse et
  const { level, path, action, message } = parseRcloneLine(line);
  if (!message) return;

  const name  = getBaseName(path);
  const isDir = path && (path.endsWith('/') || (action && action.toLowerCase().includes('dir')));

  if (action) {
    if (action.includes('Copied (new)')) {
      addLog(name || path, isDir ? 'folder-new' : 'file-new', path, isDir);
    } else if (action.includes('Copied (replaced existing)') || action.includes('server-side copy')) {
      addLog(name || path, 'file-update', path, isDir);
    } else if (action.includes('Deleted') && !action.includes('directory')) {
      addLog(name || path, 'file-del', path, false);
    } else if (action.includes('Deleted') && action.includes('directory')) {
      addLog(name || path, 'folder-del', path, true);
    } else if (action.includes('Created directory') || action.includes('mkdir')) {
      addLog(name || path, 'folder-new', path, true);
    } else if (action.includes('Removed directory') || action.includes('rmdir')) {
      addLog(name || path, 'folder-del', path, true);
    } else if (action.includes('Moved') || action.includes('moved')) {
      addLog((name || path) + t('msg_moved_suffix'), 'file-update', path, isDir);
    } else if (level === 'ERROR' || action.toLowerCase().includes('failed') || action.toLowerCase().includes('error')) {
      addLog(`${name || path}: ${action}`, 'error', path, isDir);
    } else if (action.toLowerCase().includes('conflict')) {
      addLog(`${t('msg_conflict_prefix')}${name || path}`, 'error', path, isDir);
    }
  } else {
    if (message.includes('Bisync successful')) {
      addLog(t('msg_bisync_success'), 'success');
    } else if (level === 'ERROR' || message.toLowerCase().includes('fatal') || message.toLowerCase().includes('error:')) {
      addLog(message, 'error');
    }
  }
});

// İşlem başarıyla bitince
listen('rclone-done', () => finishSync());

// İşlemde hata olursa
listen('rclone-error', () => {
  isSyncing = false;
  removeScanEntry();
  if (stopRequested) return;

  addLog(t('msg_sync_error'), 'error');
  statusBadge.className = 'status-badge status-error';
  statusBadge.innerHTML = `<span class="dot" style="background-color: var(--google-red);"></span> ${t('status_error')}`;
  statusBadge.style.color = 'var(--google-red)';
  progressBar.style.backgroundColor = 'var(--google-red)';
  syncBtn.disabled = false;
  syncBtn.style.opacity = '1';
  syncBtn.textContent = t('btn_sync_retry');
});

// --- SENKRONİZE ET BUTONU ---
syncBtn.addEventListener('click', async () => {
  if (isSyncing) return;
  isSyncing = true;
  hasTransferStats = false;

  removeScanEntry();
  addLog(t('msg_starting_sync'), 'system');

  statusBadge.className = 'status-badge status-syncing';
  statusBadge.innerHTML = `<span class="dot" style="background-color: var(--google-yellow); box-shadow: 0 0 8px var(--google-yellow);"></span> ${t('status_syncing')}`;
  statusBadge.style.color           = 'var(--google-yellow)';
  statusBadge.style.borderColor     = 'rgba(249, 171, 0, 0.2)';
  statusBadge.style.backgroundColor = 'rgba(249, 171, 0, 0.05)';

  statusText.textContent = t('sync_status_desc_checking');
  progressBar.style.width           = '2%';
  progressBar.style.backgroundColor = 'var(--google-yellow)';

  document.getElementById('stat-size').textContent    = t('stat_scanning');
  document.getElementById('stat-speed').textContent   = t('stat_calculating');
  document.getElementById('stat-eta').textContent     = t('stat_calculating');
  document.getElementById('stat-percent').textContent = formatPercent(0);

  if (scanCounter) {
    scanCounter.style.display = 'block';
    scanCounter.textContent   = t('msg_scan_starts');
  }

  stopRequested = false;

  syncBtn.disabled      = true;
  syncBtn.style.opacity = '0.7';
  syncBtn.textContent   = t('btn_sync_in_progress');

  const conflictRule = localStorage.getItem('gdrive_conflict_rule') || 'newer';

  try {
    await invoke('run_rclone_sync', { conflictRule });
  } catch (error) {
    isSyncing = false;
    removeScanEntry();
    addLog(t('msg_system_error') + error, 'error');
    syncBtn.disabled      = false;
    syncBtn.style.opacity = '1';
    syncBtn.textContent   = t('btn_sync');
  }
});

// Başarılı Bitiş
function finishSync() {
  isSyncing = false;
  removeScanEntry();

  if (lastActiveListed > 0) {
    localStorage.setItem('gdrive_last_total_items', lastActiveListed.toString());
    estimatedTotal = lastActiveListed;
  }

  statusBadge.className = 'status-badge status-active';
  statusBadge.innerHTML         = `<span class="dot green-dot"></span> ${t('status_active')}`;
  statusBadge.style.color           = 'var(--google-green)';
  statusBadge.style.borderColor     = 'rgba(30, 142, 62, 0.2)';
  statusBadge.style.backgroundColor = '#E6F4EA';

  statusText.textContent            = t('sync_status_desc_idle');
  progressBar.style.width           = '100%';
  progressBar.style.backgroundColor = 'var(--google-green)';

  const sizeEl = document.getElementById('stat-size');
  if (
    sizeEl &&
    (!hasTransferStats ||
      sizeEl.textContent === t('stat_scanning') ||
      sizeEl.textContent === 'Scanning...' ||
      sizeEl.textContent === 'Taranıyor...' ||
      sizeEl.textContent === '0 B / 0 B')
  ) {
    sizeEl.textContent = t('stat_up_to_date_0b');
  }
  document.getElementById('stat-speed').textContent   = t('stat_idle');
  document.getElementById('stat-eta').textContent     = '-';
  document.getElementById('stat-percent').textContent = formatPercent(100);

  if (scanCounter) scanCounter.style.display = 'none';

  addLog(t('msg_sync_success'), 'success');

  syncBtn.disabled      = false;
  syncBtn.style.opacity = '1';
  syncBtn.textContent   = t('btn_sync');
}

// --- DURDUR BUTONU ---
stopBtn.addEventListener('click', async () => {
  stopRequested = true;
  isSyncing = false;
  removeScanEntry();
  addLog(t('msg_user_stopped'), 'system');

  statusBadge.className = 'status-badge status-stopped';
  statusBadge.innerHTML         = `<span class="dot" style="background-color: var(--google-red); box-shadow: 0 0 8px var(--google-red);"></span> ${t('status_stopped')}`;
  statusBadge.style.color       = 'var(--google-red)';
  statusBadge.style.borderColor     = 'rgba(217, 48, 37, 0.2)';
  statusBadge.style.backgroundColor = 'rgba(217, 48, 37, 0.05)';
  statusText.textContent        = t('sync_status_desc_stopped');
  progressBar.style.width           = '0%';
  progressBar.style.backgroundColor = 'var(--google-red)';

  if (scanCounter) scanCounter.style.display = 'none';

  try {
    const response = await invoke('stop_rclone_sync');
    addLog(response, 'system');
  } catch (error) {
    addLog(t('msg_warning') + error, 'error');
  } finally {
    syncBtn.disabled      = false;
    syncBtn.style.opacity = '1';
    syncBtn.textContent   = t('btn_sync');
  }
});

// --- SEÇMELİ SENKRONİZASYON (GÖRSEL KLASÖR AĞACI) ---
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val < 10 && idx > 0 ? val.toFixed(1) : Math.round(val)} ${units[idx]}`;
}

function isParentExcluded(relPath) {
  const parts = relPath.split('/');
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/');
    if (excludedMap.get(ancestor) === true) {
      return true;
    }
  }
  return false;
}

function isItemExcluded(relPath) {
  return excludedMap.has(relPath) || isParentExcluded(relPath);
}

function updateExclusionSummary() {
  if (!exclusionSummaryBadge) return;
  const count = excludedMap.size;
  const helpers = translations[currentLang] || translations['en'];
  if (count === 0) {
    exclusionSummaryBadge.textContent = t('summary_all_synced');
    exclusionSummaryBadge.classList.remove('has-exclusions');
  } else {
    exclusionSummaryBadge.textContent = helpers.summary_excluded_count(count);
    exclusionSummaryBadge.classList.add('has-exclusions');
  }
}

function refreshTreeExclusionStates() {
  if (!folderTreeRoot) return;
  folderTreeRoot.querySelectorAll('.tree-node').forEach((nodeEl) => {
    const relPath = nodeEl.dataset.relPath;
    if (!relPath) return;

    const rowEl      = nodeEl.querySelector(':scope > .tree-row');
    const checkboxEl = rowEl ? rowEl.querySelector('.tree-checkbox') : null;
    const statusPill = rowEl ? rowEl.querySelector('.pill-status') : null;
    const locPill    = rowEl ? rowEl.querySelector('.pill-location') : null;

    const parentEx = isParentExcluded(relPath);
    const directEx = excludedMap.has(relPath);
    const excluded = parentEx || directEx;

    if (rowEl) {
      rowEl.classList.toggle('is-excluded', excluded);
    }
    if (checkboxEl) {
      checkboxEl.checked  = !excluded;
      checkboxEl.disabled = parentEx;
    }
    if (statusPill) {
      if (parentEx) {
        statusPill.hidden = false;
        statusPill.textContent = t('badge_parent_excluded');
      } else if (directEx) {
        statusPill.hidden = false;
        statusPill.textContent = t('badge_excluded');
      } else {
        statusPill.hidden = true;
      }
    }
    if (locPill) {
      const info = knownItemsMap.get(relPath);
      if (info) {
        if (info.exists_local && info.exists_remote) {
          locPill.textContent = t('badge_synced');
          locPill.className = 'tree-pill pill-location pill-local';
        } else if (info.exists_local) {
          locPill.textContent = t('badge_local_only');
          locPill.className = 'tree-pill pill-location pill-local';
        } else {
          locPill.textContent = t('badge_cloud_only');
          locPill.className = 'tree-pill pill-location pill-cloud';
        }
      }
    }
  });
}

function createTreeNodeElement(item) {
  knownItemsMap.set(item.rel_path, item);

  const nodeEl = document.createElement('div');
  nodeEl.className = 'tree-node';
  nodeEl.dataset.relPath = item.rel_path;
  nodeEl.dataset.isDir   = item.is_dir ? 'true' : 'false';
  nodeEl.dataset.name    = item.name.toLowerCase();

  const rowEl = document.createElement('div');
  rowEl.className = 'tree-row';

  let toggleBtn = null;
  let childrenContainer = null;

  if (item.is_dir) {
    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'tree-toggle-btn';
    toggleBtn.textContent = '▸';
    toggleBtn.setAttribute('aria-expanded', 'false');
    rowEl.appendChild(toggleBtn);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'tree-toggle-placeholder';
    rowEl.appendChild(placeholder);
  }

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'tree-checkbox';
  const parentEx = isParentExcluded(item.rel_path);
  const directEx = excludedMap.has(item.rel_path);
  checkbox.checked  = !(parentEx || directEx);
  checkbox.disabled = parentEx;

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      excludedMap.delete(item.rel_path);
    } else {
      excludedMap.set(item.rel_path, item.is_dir);
      if (item.is_dir) {
        const prefix = `${item.rel_path}/`;
        for (const key of Array.from(excludedMap.keys())) {
          if (key.startsWith(prefix)) {
            excludedMap.delete(key);
          }
        }
      }
    }
    updateExclusionSummary();
    refreshTreeExclusionStates();
  });
  rowEl.appendChild(checkbox);

  const iconSpan = document.createElement('span');
  iconSpan.className = 'tree-icon';
  iconSpan.textContent = item.is_dir ? '📁' : '📄';
  rowEl.appendChild(iconSpan);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-item-name';
  nameSpan.textContent = item.name;
  nameSpan.title = `~/GoogleDrive/${item.rel_path}`;
  rowEl.appendChild(nameSpan);

  if (!item.is_dir && item.size !== null && item.size !== undefined) {
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'tree-item-size';
    sizeSpan.textContent = formatBytes(item.size);
    rowEl.appendChild(sizeSpan);
  }

  const statusPill = document.createElement('span');
  statusPill.className = 'tree-pill pill-status pill-excluded';
  statusPill.hidden = true;
  rowEl.appendChild(statusPill);

  const locPill = document.createElement('span');
  locPill.className = 'tree-pill pill-location';
  rowEl.appendChild(locPill);

  nodeEl.appendChild(rowEl);

  if (item.is_dir) {
    childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    childrenContainer.hidden = true;
    nodeEl.appendChild(childrenContainer);

    const handleToggle = async () => {
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      if (isExpanded) {
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.textContent = '▸';
        childrenContainer.hidden = true;
      } else {
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.textContent = '▾';
        childrenContainer.hidden = false;
        if (!childrenContainer.dataset.loaded) {
          // Klasör yerelde yoksa buluttan getir, yerelde varsa hızlıca yerelden yükle
          await loadDirectoryIntoContainer(item.rel_path, childrenContainer, !item.exists_local);
        }
      }
    };

    toggleBtn.addEventListener('click', handleToggle);
    nameSpan.addEventListener('click', handleToggle);
  } else {
    nameSpan.addEventListener('click', () => {
      if (!checkbox.disabled) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }

  return nodeEl;
}

async function loadDirectoryIntoContainer(relPath, containerEl, includeRemote = false) {
  if (!containerEl) return;
  containerEl.innerHTML = `<div class="tree-loading-msg">${t('tree_loading')}</div>`;

  try {
    const items = await invoke('list_directory_items', { relPath, includeRemote });
    containerEl.innerHTML = '';
    containerEl.dataset.loaded = 'true';

    if (!items || items.length === 0) {
      if (relPath === '' && !includeRemote) {
        // Yerel ~/GoogleDrive henüz boşsa otomatik olarak bulutu tara
        await loadDirectoryIntoContainer('', containerEl, true);
        return;
      }
      const emptyEl = document.createElement('div');
      emptyEl.className = 'tree-empty-msg';
      emptyEl.textContent = t('tree_empty');
      containerEl.appendChild(emptyEl);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of items) {
      frag.appendChild(createTreeNodeElement(item));
    }
    containerEl.appendChild(frag);
    refreshTreeExclusionStates();
    applyTreeSearchFilter();
  } catch (err) {
    containerEl.innerHTML = '';
    const errEl = document.createElement('div');
    errEl.className = 'tree-empty-msg';
    errEl.style.color = 'var(--google-red)';
    errEl.textContent = String(err);
    containerEl.appendChild(errEl);
  }
}

async function initSelectiveSyncTree(forceRemote = false) {
  try {
    const savedExclusions = await invoke('get_excluded_items');
    excludedMap.clear();
    if (Array.isArray(savedExclusions)) {
      for (const item of savedExclusions) {
        if (item && item.path) {
          excludedMap.set(item.path, Boolean(item.is_dir));
        }
      }
    }
    updateExclusionSummary();
  } catch (_) {}

  treeInitialized = true;
  await loadDirectoryIntoContainer('', folderTreeRoot, forceRemote);
}

function applyTreeSearchFilter() {
  if (!folderTreeRoot || !treeSearchInput) return;
  const query = treeSearchInput.value.trim().toLowerCase();
  const allNodes = folderTreeRoot.querySelectorAll('.tree-node');

  if (!query) {
    allNodes.forEach((n) => {
      n.style.display = '';
    });
    return;
  }

  // Alt düğümlerden üst düğümlere doğru kontrol et
  const nodesArray = Array.from(allNodes).reverse();
  for (const nodeEl of nodesArray) {
    const name = nodeEl.dataset.name || '';
    const relPath = (nodeEl.dataset.relPath || '').toLowerCase();
    const selfMatch = name.includes(query) || relPath.includes(query);
    const childContainer = nodeEl.querySelector(':scope > .tree-children');
    const hasVisibleChild = childContainer
      ? Array.from(childContainer.children).some(
          (c) => c.classList.contains('tree-node') && c.style.display !== 'none'
        )
      : false;

    nodeEl.style.display = selfMatch || hasVisibleChild ? '' : 'none';
  }
}

if (treeSearchInput) {
  treeSearchInput.addEventListener('input', applyTreeSearchFilter);
}

if (scanCloudBtn) {
  scanCloudBtn.addEventListener('click', async () => {
    if (isScanningCloud) return;
    isScanningCloud = true;
    scanCloudBtn.disabled = true;
    scanCloudBtn.textContent = t('btn_scanning_cloud');

    try {
      await loadDirectoryIntoContainer('', folderTreeRoot, true);
    } finally {
      isScanningCloud = false;
      scanCloudBtn.disabled = false;
      scanCloudBtn.textContent = t('btn_scan_cloud');
    }
  });
}

async function executeSaveExclusions(items, deleteLocalPaths) {
  if (!applyExclusionsBtn) return;
  applyExclusionsBtn.disabled = true;
  applyExclusionsBtn.textContent = t('btn_applying');

  try {
    const res = await invoke('save_excluded_items', {
      items,
      deleteLocalPaths,
    });

    if (deleteLocalCheckbox) {
      deleteLocalCheckbox.checked = false;
    }

    const helpers = translations[currentLang] || translations['en'];
    if (res && res.deleted_local_count > 0) {
      addLog(
        helpers.msg_exclusions_saved_and_deleted(res.excluded_count, res.deleted_local_count),
        'system'
      );
    } else {
      addLog(
        helpers.msg_exclusions_saved(res ? res.excluded_count : items.length),
        'system'
      );
    }

    // Yerelden silinen öğelerin durum rozetlerini ("Sadece Bulutta") güncellemek için ağacı tazele
    await loadDirectoryIntoContainer('', folderTreeRoot, false);

    applyExclusionsBtn.textContent = t('btn_saved');
    applyExclusionsBtn.style.backgroundColor = 'var(--google-green)';
    setTimeout(() => {
      applyExclusionsBtn.textContent = t('btn_apply_exclusions');
      applyExclusionsBtn.style.backgroundColor = 'var(--noble-purple)';
      applyExclusionsBtn.disabled = false;
    }, 1800);
  } catch (err) {
    addLog(t('msg_warning') + err, 'error');
    applyExclusionsBtn.textContent = t('btn_apply_exclusions');
    applyExclusionsBtn.style.backgroundColor = 'var(--noble-purple)';
    applyExclusionsBtn.disabled = false;
  }
}

let pendingSavePayload = null;

if (applyExclusionsBtn) {
  applyExclusionsBtn.addEventListener('click', async () => {
    const items = Array.from(excludedMap.entries()).map(([path, is_dir]) => ({
      path,
      is_dir,
    }));

    const wantsLocalDelete = deleteLocalCheckbox && deleteLocalCheckbox.checked;
    if (wantsLocalDelete && items.length > 0) {
      // Yerel diskte var olan (veya bilinmeyen) devre dışı bırakılmış öğeleri filtrele
      const localCandidates = items.filter((item) => {
        const info = knownItemsMap.get(item.path);
        return !info || info.exists_local;
      });

      if (localCandidates.length > 0 && deleteConfirmModal && modalDeleteList) {
        modalDeleteList.innerHTML = '';
        for (const cand of localCandidates) {
          const li = document.createElement('li');
          li.textContent = `${cand.is_dir ? '📁' : '📄'} ~/GoogleDrive/${cand.path}${cand.is_dir ? '/' : ''}`;
          modalDeleteList.appendChild(li);
        }
        pendingSavePayload = {
          items,
          deleteLocalPaths: localCandidates.map((c) => c.path),
        };
        deleteConfirmModal.hidden = false;
        return;
      }
    }

    await executeSaveExclusions(items, []);
  });
}

if (modalCancelBtn) {
  modalCancelBtn.addEventListener('click', () => {
    pendingSavePayload = null;
    if (deleteConfirmModal) deleteConfirmModal.hidden = true;
  });
}

if (modalConfirmBtn) {
  modalConfirmBtn.addEventListener('click', async () => {
    if (deleteConfirmModal) deleteConfirmModal.hidden = true;
    if (pendingSavePayload) {
      const { items, deleteLocalPaths } = pendingSavePayload;
      pendingSavePayload = null;
      await executeSaveExclusions(items, deleteLocalPaths);
    }
  });
}

// --- MENÜ GEÇİŞ SİSTEMİ ---
const navBtns = document.querySelectorAll('.nav-btn');
const pages = [
  document.getElementById('view-dashboard'),
  document.getElementById('view-selective'),
  document.getElementById('view-history'),
  document.getElementById('view-settings'),
];

navBtns.forEach((btn, index) => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    pages.forEach(page => {
      if (page) page.style.display = 'none';
    });
    btn.classList.add('active');
    if (pages[index]) pages[index].style.display = 'block';

    // Klasör Seçimi sekmesine ilk geçişte ağacı anında yükle
    if (pages[index] && pages[index].id === 'view-selective' && !treeInitialized) {
      initSelectiveSyncTree(false);
    }
  });
});

// --- GEÇMİŞİ TEMİZLE BUTONU ---
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', () => {
    if (fullLogList) fullLogList.innerHTML = '';
  });
}

// --- AYARLARI KAYDETME VE ZAMANLAYICI ---
function applySyncInterval() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }

  const intervalVal = localStorage.getItem('gdrive_sync_interval') || (syncIntervalSelect ? syncIntervalSelect.value : '300');
  if (intervalVal && intervalVal !== 'manual') {
    const seconds = parseInt(intervalVal, 10);
    if (seconds > 0) {
      syncIntervalId = setInterval(() => {
        if (!isSyncing) {
          addLog(t('msg_periodic_sync'), 'system');
          syncBtn.click();
        }
      }, seconds * 1000);
    }
  }
}

if (appLanguageSelect) {
  appLanguageSelect.addEventListener('change', () => {
    applyLanguage(appLanguageSelect.value);
  });
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', () => {
    if (appLanguageSelect) localStorage.setItem('gdrive_language', appLanguageSelect.value);
    localStorage.setItem('gdrive_sync_interval', syncIntervalSelect.value);
    localStorage.setItem('gdrive_conflict_rule', conflictRuleSelect.value);
    localStorage.setItem('gdrive_auto_start',    autoStartSelect.value);

    applySyncInterval();
    addLog(t('msg_settings_saved'), 'system');

    const orig = t('btn_save_settings');
    saveSettingsBtn.textContent           = t('btn_saved');
    saveSettingsBtn.style.backgroundColor = 'var(--google-green)';
    setTimeout(() => {
      saveSettingsBtn.textContent           = orig;
      saveSettingsBtn.style.backgroundColor = 'var(--noble-purple)';
    }, 2000);
  });
}

// --- UYGULAMA AÇILIŞINDA ---
window.addEventListener('DOMContentLoaded', () => {
  // Varsayılan dil: İngilizce ('en')
  const savedLang      = localStorage.getItem('gdrive_language') || 'en';
  const savedInterval  = localStorage.getItem('gdrive_sync_interval');
  const savedRule      = localStorage.getItem('gdrive_conflict_rule');
  const savedAutoStart = localStorage.getItem('gdrive_auto_start');

  if (savedInterval  && syncIntervalSelect) syncIntervalSelect.value = savedInterval;
  if (savedRule      && conflictRuleSelect) conflictRuleSelect.value = savedRule;
  if (savedAutoStart && autoStartSelect)    autoStartSelect.value    = savedAutoStart;

  // Başlangıç dilini uygula
  applyLanguage(savedLang);

  // İlk log saatini ayarla
  const initTimeEl = document.getElementById('initial-log-time');
  if (initTimeEl) initTimeEl.textContent = getCurrentTime();

  applySyncInterval();

  if (savedAutoStart === 'true') {
    setTimeout(() => {
      addLog(t('msg_autostart_sync'), 'system');
      syncBtn.click();
    }, 1000);
  }
});
