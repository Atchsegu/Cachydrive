#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::Emitter;
use tauri::Manager;

/// Aktif çalışan rclone sürecinin PID değerini tutar
struct SyncState(Arc<Mutex<Option<u32>>>);

/// Senkronizasyondan hariç tutulan klasör veya dosya bilgisi
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
struct ExcludedItem {
    path: String,
    is_dir: bool,
}

/// Görsel klasör ağacındaki her bir satırın verisi
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct TreeItem {
    name: String,
    rel_path: String,
    is_dir: bool,
    exists_local: bool,
    exists_remote: bool,
    size: Option<u64>,
}

/// Hariç tutma kaydetme ve isteğe bağlı yerel silme işleminin sonucu
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct SaveExclusionsResult {
    excluded_count: usize,
    deleted_local_count: usize,
}

/// rclone lsjson çıktısını parse etmek için yardımcı yapı
#[derive(serde::Deserialize)]
struct RcloneLsJsonItem {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "IsDir")]
    is_dir: bool,
    #[serde(rename = "Size")]
    size: Option<i64>,
}

/// Göreli yolu güvenli hale getirir ('..' gibi üst dizin geçişlerini temizler)
fn sanitize_rel_path(rel_path: &str) -> String {
    let parts: Vec<String> = std::path::Path::new(rel_path)
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(os_str) => os_str.to_str().map(|s| s.to_string()),
            _ => None,
        })
        .collect();
    parts.join("/")
}

/// Hariç tutulan öğelerin kaydedildiği JSON dosyasının yolunu döndürür (~/.config/cachydrive/excluded_items.json)
fn get_exclusions_file_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME dizini bulunamadı.".to_string())?;
    let config_dir = std::path::Path::new(&home).join(".config/cachydrive");
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Yapılandırma dizini oluşturulamadı: {}", e))?;
    Ok(config_dir.join("excluded_items.json"))
}

/// Kayıtlı hariç tutma listesini diskten okur
fn load_excluded_items_from_disk() -> Vec<ExcludedItem> {
    let path = match get_exclusions_file_path() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let parsed: Vec<ExcludedItem> = serde_json::from_str(&content).unwrap_or_default();
    parsed
        .into_iter()
        .filter_map(|item| {
            let clean = sanitize_rel_path(&item.path);
            if clean.is_empty() {
                None
            } else {
                Some(ExcludedItem {
                    path: clean,
                    is_dir: item.is_dir,
                })
            }
        })
        .collect()
}

/// Hariç tutma listesini diske kaydeder
fn save_excluded_items_to_disk(items: &[ExcludedItem]) -> Result<(), String> {
    let path = get_exclusions_file_path()?;
    let json = serde_json::to_string_pretty(items)
        .map_err(|e| format!("JSON dönüştürme hatası: {}", e))?;
    std::fs::write(path, json).map_err(|e| format!("Filtre dosyası yazılamadı: {}", e))
}

/// rclone glob filtrelerinde özel anlam taşıyan karakterleri kaçış (escape) karakteriyle korur
fn escape_rclone_glob(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        if matches!(c, '\\' | '*' | '?' | '[' | ']' | '{' | '}') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Hariç tutulan yolları ~/.cache/rclone/bisync/*.lst önbellek dosyalarından temizler.
/// Böylece çok sayıda dosya devre dışı bırakıldığında --max-delete hatası oluşmaz ve
/// yerelden silinen bir klasör tekrar etkinleştirildiğinde buluttan güvenle geri indirilir.
fn prune_excluded_from_bisync_listings(items: &[ExcludedItem]) {
    if items.is_empty() {
        return;
    }
    let home = match std::env::var_os("HOME") {
        Some(h) => h,
        None => return,
    };
    let bisync_dir = std::path::Path::new(&home).join(".cache/rclone/bisync");
    let entries = match std::fs::read_dir(&bisync_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_lst = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext == "lst" || ext == "lst-new")
            .unwrap_or(false);
        if !is_lst {
            continue;
        }

        if let Ok(content) = std::fs::read_to_string(&path) {
            let mut modified = false;
            let mut kept_lines = Vec::new();

            for line in content.lines() {
                if line.starts_with('#') || line.trim().is_empty() {
                    kept_lines.push(line);
                    continue;
                }

                let mut should_remove = false;
                if let (Some(start), Some(end)) = (line.find('"'), line.rfind('"')) {
                    if start < end {
                        let entry_path = &line[start + 1..end];
                        for ex in items {
                            if entry_path == ex.path
                                || entry_path.starts_with(&format!("{}/", ex.path))
                            {
                                should_remove = true;
                                break;
                            }
                        }
                    }
                }

                if should_remove {
                    modified = true;
                } else {
                    kept_lines.push(line);
                }
            }

            if modified {
                let mut new_content = kept_lines.join("\n");
                new_content.push('\n');
                let _ = std::fs::write(&path, new_content);
            }
        }
    }
}

/// rclone --progress çıktısındaki ANSI escape kodlarını temizler
fn strip_ansi(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Eğer arka planda çalışan bir `rclone` süreci yoksa,
/// ~/.cache/rclone/bisync/ altındaki kalmış yetim `.lck` (kilit) dosyalarını temizler.
fn clean_stale_locks() {
    let is_running = Command::new("pgrep")
        .arg("-x")
        .arg("rclone")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !is_running {
        if let Some(home) = std::env::var_os("HOME") {
            let bisync_dir = std::path::Path::new(&home).join(".cache/rclone/bisync");
            if let Ok(entries) = std::fs::read_dir(bisync_dir) {
                for entry in entries.flatten() {
                    if let Some(ext) = entry.path().extension() {
                        if ext == "lck" {
                            let _ = std::fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    }
}

/// Gürültülü veya tekrarlayan rclone satırlarını filtreleyerek GTK ana döngüsünün (main loop)
/// saniyede binlerce IPC olayı ile kilitlenmesini önler.
fn should_emit_rclone_line(trimmed: &str, last_progress_emit: &mut std::time::Instant) -> bool {
    if trimmed.is_empty() {
        return false;
    }

    // Değişmeyen dosyalar için üretilen binlerce DEBUG/INFO satırını arayüze gönderme
    if trimmed.contains("Unchanged skipping")
        || trimmed.contains("Size and modification time the same")
        || trimmed.contains("Matching file")
    {
        return false;
    }

    // Canlı ilerleme (progress) satırlarını en fazla 120ms'de bir gönder (saniyede ~8 güncelleme)
    let is_progress = trimmed.starts_with("Transferred:")
        || trimmed.starts_with("Checks:")
        || trimmed.starts_with("Elapsed time:")
        || trimmed.starts_with("* ");
    if is_progress {
        let now = std::time::Instant::now();
        if now.duration_since(*last_progress_emit) < std::time::Duration::from_millis(120) {
            return false;
        }
        *last_progress_emit = now;
    }

    true
}

/// Verilen okuma akışını (\n veya \r karakterlerine göre) anlık olarak satır satır okuyup arayüze gönderir
fn stream_rclone_output<R: Read + Send + 'static>(
    reader: R,
    window: tauri::Window,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line_buf = Vec::with_capacity(256);
        let mut byte = [0u8; 1];
        let mut last_progress_emit =
            std::time::Instant::now() - std::time::Duration::from_millis(500);

        loop {
            match buf_reader.read(&mut byte) {
                Ok(0) => {
                    if !line_buf.is_empty() {
                        let s = String::from_utf8_lossy(&line_buf);
                        let clean = strip_ansi(&s);
                        let trimmed = clean.trim().to_string();
                        if should_emit_rclone_line(&trimmed, &mut last_progress_emit) {
                            let _ = window.emit("rclone-log", trimmed);
                        }
                    }
                    break;
                }
                Ok(_) => {
                    if byte[0] == b'\n' || byte[0] == b'\r' {
                        if !line_buf.is_empty() {
                            let s = String::from_utf8_lossy(&line_buf);
                            let clean = strip_ansi(&s);
                            let trimmed = clean.trim().to_string();
                            if should_emit_rclone_line(&trimmed, &mut last_progress_emit) {
                                let _ = window.emit("rclone-log", trimmed);
                            }
                            line_buf.clear();
                        }
                    } else {
                        line_buf.push(byte[0]);
                    }
                }
                Err(_) => break,
            }
        }
    })
}

/// Sadece bu uygulamanın başlattığı rclone sürecini sonlandırır
fn kill_active_rclone(active_pid: &Arc<Mutex<Option<u32>>>) -> bool {
    if let Ok(mut guard) = active_pid.lock() {
        if let Some(pid) = guard.take() {
            let status = Command::new("kill")
                .arg("-TERM")
                .arg(pid.to_string())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            return status.map(|s| s.success()).unwrap_or(false);
        }
    }
    false
}

// 1. Canlı Senkronizasyon Başlatma Komutu
#[tauri::command]
async fn run_rclone_sync(
    window: tauri::Window,
    state: tauri::State<'_, SyncState>,
    conflict_rule: Option<String>,
) -> Result<String, String> {
    let active_pid = Arc::clone(&state.0);

    tauri::async_runtime::spawn_blocking(move || {
        // Çift çalışmayı önle
        if let Ok(guard) = active_pid.lock() {
            if guard.is_some() {
                return Err("Senkronizasyon zaten devam ediyor.".to_string());
            }
        }

        // Senkronizasyonu başlatmadan hemen önce yetim kilitleri temizle
        clean_stale_locks();

        let home = std::env::var("HOME").map_err(|_| "HOME dizini bulunamadı.".to_string())?;
        let local_drive = format!("{}/GoogleDrive", home);

        // Yerel dizinin mevcut olduğundan emin ol
        let _ = std::fs::create_dir_all(&local_drive);

        // Hariç tutulan öğeleri yükle ve bisync önbelleğini temiz tut
        let excluded_items = load_excluded_items_from_disk();
        prune_excluded_from_bisync_listings(&excluded_items);

        // Arayüzdeki çakışma kuralını rclone bisync parametresine dönüştür
        // Path1 = ~/GoogleDrive (local), Path2 = gdrive: (remote)
        let conflict_arg = match conflict_rule.as_deref() {
            Some("local") | Some("path1") => "path1",
            Some("remote") | Some("path2") => "path2",
            _ => "newer",
        };

        let mut args: Vec<String> = vec![
            "bisync".to_string(),
            local_drive,
            "gdrive:".to_string(),
            "--recover".to_string(),
            "--conflict-resolve".to_string(),
            conflict_arg.to_string(),
            "--verbose".to_string(),
            "--progress".to_string(),
            "--fast-list".to_string(),
            "--drive-skip-gdocs".to_string(),
            "--drive-fast-list-bug-fix=false".to_string(),
            "--checkers".to_string(),
            "64".to_string(),
            "--drive-pacer-min-sleep".to_string(),
            "10ms".to_string(),
            "--drive-pacer-burst".to_string(),
            "1000".to_string(),
            "--check-sync=false".to_string(),
            "--transfers".to_string(),
            "8".to_string(),
            "--create-empty-src-dirs".to_string(),
        ];

        for item in &excluded_items {
            let escaped = escape_rclone_glob(&item.path);
            let pattern = if item.is_dir {
                format!("/{}/**", escaped)
            } else {
                format!("/{}", escaped)
            };
            args.push("--exclude".to_string());
            args.push(pattern);
        }

        let mut child = Command::new("rclone")
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Rclone başlatılamadı: {}", e))?;

        let pid = child.id();
        if let Ok(mut guard) = active_pid.lock() {
            *guard = Some(pid);
        }

        let stdout_handle = child
            .stdout
            .take()
            .map(|out| stream_rclone_output(out, window.clone()));
        let stderr_handle = child
            .stderr
            .take()
            .map(|err| stream_rclone_output(err, window.clone()));

        thread::spawn(move || {
            if let Some(h) = stdout_handle {
                let _ = h.join();
            }
            if let Some(h) = stderr_handle {
                let _ = h.join();
            }

            let status = child.wait();

            if let Ok(mut guard) = active_pid.lock() {
                *guard = None;
            }

            match status {
                Ok(s) if s.success() => {
                    let _ = window.emit("rclone-done", "Başarılı");
                }
                _ => {
                    clean_stale_locks();
                    let _ = window.emit("rclone-error", "Hata");
                }
            }
        });

        Ok("Motor ateşlendi, canlı yayın başlıyor...".to_string())
    })
    .await
    .map_err(|e| format!("Görev başlatma hatası: {}", e))?
}

// 2. İşlemi Zorla Durdurma (Kill) Komutu
#[tauri::command]
async fn stop_rclone_sync(state: tauri::State<'_, SyncState>) -> Result<String, String> {
    let active_pid = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        if kill_active_rclone(&active_pid) {
            clean_stale_locks();
            Ok("Rclone senkronizasyon işlemi durduruldu.".to_string())
        } else {
            Err("Çalışan Rclone işlemi bulunamadı.".to_string())
        }
    })
    .await
    .map_err(|e| format!("Durdurma görevi hatası: {}", e))?
}

// 3. Sistem Tepsisi Dilini Güncelleme Komutu
#[tauri::command]
fn update_tray_lang(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let (show_text, hide_text, quit_text) = if lang == "en" {
        ("Show Interface", "Hide to Tray", "Quit Completely")
    } else {
        ("Arayüzü Göster", "Arka Plana Gizle", "Tamamen Çıkış Yap")
    };

    let show_i = MenuItem::with_id(&app, "show", show_text, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let hide_i = MenuItem::with_id(&app, "hide", hide_text, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit_i = MenuItem::with_id(&app, "quit", quit_text, true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(&app, &[&show_i, &hide_i, &quit_i])
        .map_err(|e| e.to_string())?;

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_menu(Some(menu));
    }
    Ok(())
}

// 4. İlgili Yerel Google Drive Klasörünü Dosya Yöneticisinde Açma Komutu
#[tauri::command]
async fn open_in_folder(rel_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").map_err(|_| "HOME dizini bulunamadı.".to_string())?;
        let base_dir = std::path::PathBuf::from(&home).join("GoogleDrive");

        // Güvenlik: '..' gibi üst dizine çıkış girişimlerini filtrele
        let clean_rel: std::path::PathBuf = std::path::Path::new(&rel_path)
            .components()
            .filter(|c| matches!(c, std::path::Component::Normal(_)))
            .collect();

        let target_path = base_dir.join(&clean_rel);

        // Hedef doğrudan mevcut bir klasörse onu aç; dosyaysa veya silinmişse üst klasörünü bul
        let mut dir_to_open = if target_path.is_dir() {
            target_path
        } else {
            target_path
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| base_dir.clone())
        };

        // Silinmiş alt klasörler varsa mevcut olan en yakın üst klasöre kadar çık
        while !dir_to_open.exists() && dir_to_open.starts_with(&base_dir) {
            if let Some(parent) = dir_to_open.parent() {
                dir_to_open = parent.to_path_buf();
            } else {
                break;
            }
        }

        if !dir_to_open.exists() || !dir_to_open.starts_with(&base_dir) {
            let _ = std::fs::create_dir_all(&base_dir);
            dir_to_open = base_dir;
        }

        Command::new("xdg-open")
            .arg(&dir_to_open)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Klasör açılamadı: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Klasör açma görevi hatası: {}", e))?
}

// 5. Görsel Klasör Ağacı İçin Dizin İçeriğini Listeleme Komutu (Yerel + Bulut Hibrit)
#[tauri::command]
async fn list_directory_items(
    rel_path: String,
    include_remote: bool,
) -> Result<Vec<TreeItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("HOME").map_err(|_| "HOME dizini bulunamadı.".to_string())?;
        let base_dir = std::path::PathBuf::from(&home).join("GoogleDrive");
        let _ = std::fs::create_dir_all(&base_dir);

        let clean_rel = sanitize_rel_path(&rel_path);
        let target_local = if clean_rel.is_empty() {
            base_dir.clone()
        } else {
            base_dir.join(&clean_rel)
        };

        let mut items_map: std::collections::BTreeMap<String, TreeItem> =
            std::collections::BTreeMap::new();

        // Adım 1: Yerel diskten anında okuma
        if target_local.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&target_local) {
                for entry in entries.flatten() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_name.starts_with(".rclone") || file_name.ends_with(".partial") {
                        continue;
                    }
                    if let Ok(meta) = entry.metadata() {
                        let is_dir = meta.is_dir();
                        let size = if is_dir { None } else { Some(meta.len()) };
                        let item_rel = if clean_rel.is_empty() {
                            file_name.clone()
                        } else {
                            format!("{}/{}", clean_rel, file_name)
                        };
                        items_map.insert(
                            file_name.clone(),
                            TreeItem {
                                name: file_name,
                                rel_path: item_rel,
                                is_dir,
                                exists_local: true,
                                exists_remote: false,
                                size,
                            },
                        );
                    }
                }
            }
        }

        // Adım 2: Daha önce hariç tutulup yerelden silinmiş öğeleri kayıtlı listeden ağaca ekle
        let excluded = load_excluded_items_from_disk();
        for ex in excluded {
            let remainder = if clean_rel.is_empty() {
                Some(ex.path.as_str())
            } else {
                let prefix = format!("{}/", clean_rel);
                ex.path.strip_prefix(&prefix)
            };

            if let Some(rem) = remainder {
                if !rem.is_empty() {
                    let (child_name, child_is_dir) = match rem.find('/') {
                        Some(idx) => (&rem[..idx], true),
                        None => (rem, ex.is_dir),
                    };
                    let item_rel = if clean_rel.is_empty() {
                        child_name.to_string()
                    } else {
                        format!("{}/{}", clean_rel, child_name)
                    };
                    items_map
                        .entry(child_name.to_string())
                        .and_modify(|e| {
                            e.exists_remote = true;
                        })
                        .or_insert(TreeItem {
                            name: child_name.to_string(),
                            rel_path: item_rel,
                            is_dir: child_is_dir,
                            exists_local: false,
                            exists_remote: true,
                            size: None,
                        });
                }
            }
        }

        // Adım 3: İstenirse Google Drive (gdrive:) üzerinden bulut içeriğini sorgula ve birleştir
        if include_remote {
            let remote_target = if clean_rel.is_empty() {
                "gdrive:".to_string()
            } else {
                format!("gdrive:{}", clean_rel)
            };

            let output = Command::new("rclone")
                .args([
                    "lsjson",
                    &remote_target,
                    "--drive-skip-gdocs",
                    "--no-modtime",
                    "--no-mimetype",
                ])
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    if let Ok(remote_list) =
                        serde_json::from_slice::<Vec<RcloneLsJsonItem>>(&out.stdout)
                    {
                        for r_item in remote_list {
                            let item_rel = if clean_rel.is_empty() {
                                r_item.name.clone()
                            } else {
                                format!("{}/{}", clean_rel, r_item.name)
                            };
                            let r_size = match (r_item.is_dir, r_item.size) {
                                (false, Some(s)) if s >= 0 => Some(s as u64),
                                _ => None,
                            };

                            items_map
                                .entry(r_item.name.clone())
                                .and_modify(|existing| {
                                    existing.exists_remote = true;
                                    if existing.size.is_none() {
                                        existing.size = r_size;
                                    }
                                })
                                .or_insert(TreeItem {
                                    name: r_item.name,
                                    rel_path: item_rel,
                                    is_dir: r_item.is_dir,
                                    exists_local: false,
                                    exists_remote: true,
                                    size: r_size,
                                });
                        }
                    }
                }
            }
        }

        let mut result: Vec<TreeItem> = items_map.into_values().collect();
        result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(result)
    })
    .await
    .map_err(|e| format!("Listeleme görevi hatası: {}", e))?
}

// 6. Hariç Tutulan Öğeleri Getirme Komutu
#[tauri::command]
async fn get_excluded_items() -> Result<Vec<ExcludedItem>, String> {
    tauri::async_runtime::spawn_blocking(load_excluded_items_from_disk)
        .await
        .map_err(|e| format!("Filtre okuma görevi hatası: {}", e))
}

// 7. Hariç Tutulan Öğeleri Kaydetme ve İsteğe Bağlı Yerelden Silme Komutu
#[tauri::command]
async fn save_excluded_items(
    items: Vec<ExcludedItem>,
    delete_local_paths: Vec<String>,
    state: tauri::State<'_, SyncState>,
) -> Result<SaveExclusionsResult, String> {
    let active_pid = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(guard) = active_pid.lock() {
            if guard.is_some() {
                return Err(
                    "Aktif bir senkronizasyon çalışırken filtreler değiştirilemez. Lütfen önce işlemi durdurun veya bitmesini bekleyin."
                        .to_string(),
                );
            }
        }

        let mut clean_items: Vec<ExcludedItem> = Vec::new();
        for item in items {
            let clean = sanitize_rel_path(&item.path);
            if !clean.is_empty() && !clean_items.iter().any(|x| x.path == clean) {
                clean_items.push(ExcludedItem {
                    path: clean,
                    is_dir: item.is_dir,
                });
            }
        }

        // 1. Önce filtre listesini diske kaydet ve bisync .lst önbelleğinden çıkar (Güvenlik sırası!)
        save_excluded_items_to_disk(&clean_items)?;
        prune_excluded_from_bisync_listings(&clean_items);

        // 2. Kullanıcı "bilgisayarımdan da sil" seçeneğini işaretlediyse sadece hariç tutulan yerel öğeleri sil
        let mut deleted_local_count = 0usize;
        if !delete_local_paths.is_empty() {
            let home = std::env::var("HOME").map_err(|_| "HOME dizini bulunamadı.".to_string())?;
            let base_dir = std::path::PathBuf::from(&home).join("GoogleDrive");

            for raw_path in delete_local_paths {
                let clean = sanitize_rel_path(&raw_path);
                if clean.is_empty() {
                    continue;
                }

                // Güvenlik kontrolü: Yalnızca gerçekten hariç tutulmuş (veya üst klasörü hariç tutulmuş) bir öğe silinebilir
                let is_excluded = clean_items.iter().any(|ex| {
                    ex.path == clean || (ex.is_dir && clean.starts_with(&format!("{}/", ex.path)))
                });
                if !is_excluded {
                    continue;
                }

                let target = base_dir.join(&clean);
                if target.starts_with(&base_dir) && target != base_dir && target.exists() {
                    let res = if target.is_dir() {
                        std::fs::remove_dir_all(&target)
                    } else {
                        std::fs::remove_file(&target)
                    };
                    if res.is_ok() {
                        deleted_local_count += 1;
                    }
                }
            }
        }

        Ok(SaveExclusionsResult {
            excluded_count: clean_items.len(),
            deleted_local_count,
        })
    })
    .await
    .map_err(|e| format!("Filtre kaydetme görevi hatası: {}", e))?
}

fn main() {
    // Linux / Wayland / AppImage ortamlarında WebKitGTK DMA-BUF kaynaklı gri ekran sorununu önle
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let sync_pid = Arc::new(Mutex::new(None));
    let tray_sync_pid = Arc::clone(&sync_pid);

    tauri::Builder::default()
        .manage(SyncState(sync_pid))
        .setup(move |app| {
            // Başlangıçta kalmış olabilecek kilit dosyalarını arka planda temizle
            thread::spawn(clean_stale_locks);

            // 3. SİSTEM TEPSİSİ MENÜSÜNÜ OLUŞTURMA (Varsayılan İngilizce)
            let show_i = MenuItem::with_id(app, "show", "Show Interface", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Completely", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false);

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            if let Err(e) = tray_builder
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        // Kapatırken aktif rclone sürecimiz varsa güvenli şekilde sonlandır
                        kill_active_rclone(&tray_sync_pid);
                        clean_stale_locks();
                        std::process::exit(0);
                    }
                    _ => {}
                })
                // Sol tıklandığında pencereyi aç
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)
            {
                eprintln!("Tray icon initialization warning: {}", e);
            }

            Ok(())
        })
        // 4. "X" KAPATMA TUŞUNA BASILINCA UYGULAMAYI KAPATMA, GİZLE!
        // GTK HeaderBar kapatma butonunun button-release-event sinyalini tamamlayıp pointer grab
        // kilidini temizce bırakabilmesi için gizleme işlemini 25ms gecikmeyle çalıştırıyoruz.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let win = window.clone();
                thread::spawn(move || {
                    thread::sleep(std::time::Duration::from_millis(25));
                    let _ = win.hide();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            run_rclone_sync,
            stop_rclone_sync,
            update_tray_lang,
            open_in_folder,
            list_directory_items,
            get_excluded_items,
            save_excluded_items
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması başlatılırken hata oluştu");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_rel_path() {
        assert_eq!(sanitize_rel_path("/Arsiv/Videolar/"), "Arsiv/Videolar");
        assert_eq!(sanitize_rel_path("../../etc/passwd"), "etc/passwd");
        assert_eq!(sanitize_rel_path(""), "");
        assert_eq!(sanitize_rel_path("tek_dosya.txt"), "tek_dosya.txt");
    }

    #[test]
    fn test_escape_rclone_glob() {
        assert_eq!(escape_rclone_glob("Normal Klasor"), "Normal Klasor");
        assert_eq!(
            escape_rclone_glob("Yedek [2026] *test?"),
            "Yedek \\[2026\\] \\*test\\?"
        );
    }

    #[test]
    fn test_should_emit_rclone_line() {
        let mut last_emit = std::time::Instant::now() - std::time::Duration::from_secs(1);
        assert!(!should_emit_rclone_line("", &mut last_emit));
        assert!(!should_emit_rclone_line(
            "2026/05/10 INFO : doc.pdf: Unchanged skipping",
            &mut last_emit
        ));
        assert!(!should_emit_rclone_line(
            "2026/05/10 DEBUG : pic.png: Size and modification time the same",
            &mut last_emit
        ));
        assert!(should_emit_rclone_line(
            "2026/05/10 INFO : report.xlsx: Copied (new)",
            &mut last_emit
        ));
        // İlk progress satırı kabul edilmeli, hemen ardından gelen ikinci progress satırı (120ms içinde) filtrelenmeli
        assert!(should_emit_rclone_line(
            "Transferred: 10 MiB / 100 MiB, 10%, 5 MiB/s, ETA 18s",
            &mut last_emit
        ));
        assert!(!should_emit_rclone_line(
            "Transferred: 11 MiB / 100 MiB, 11%, 5 MiB/s, ETA 17s",
            &mut last_emit
        ));
    }
}

