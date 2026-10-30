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

/// Verilen okuma akışını (\n veya \r karakterlerine göre) anlık olarak satır satır okuyup arayüze gönderir
fn stream_rclone_output<R: Read + Send + 'static>(
    reader: R,
    window: tauri::Window,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line_buf = Vec::with_capacity(256);
        let mut byte = [0u8; 1];

        loop {
            match buf_reader.read(&mut byte) {
                Ok(0) => {
                    if !line_buf.is_empty() {
                        let s = String::from_utf8_lossy(&line_buf);
                        let clean = strip_ansi(&s);
                        let trimmed = clean.trim().to_string();
                        if !trimmed.is_empty() {
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
                            if !trimmed.is_empty() {
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
fn run_rclone_sync(
    window: tauri::Window,
    state: tauri::State<'_, SyncState>,
    conflict_rule: Option<String>,
) -> Result<String, String> {
    let active_pid = Arc::clone(&state.0);

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

    // Arayüzdeki çakışma kuralını rclone bisync parametresine dönüştür
    // Path1 = ~/GoogleDrive (local), Path2 = gdrive: (remote)
    let conflict_arg = match conflict_rule.as_deref() {
        Some("local") | Some("path1") => "path1",
        Some("remote") | Some("path2") => "path2",
        _ => "newer",
    };

    let mut child = Command::new("rclone")
        .args([
            "bisync",
            &local_drive,
            "gdrive:",
            "--recover",
            "--conflict-resolve",
            conflict_arg,
            "--verbose",
            "--progress",
            "--fast-list",
            "--drive-skip-gdocs",
            "--drive-fast-list-bug-fix=false",
            "--checkers",
            "64",
            "--drive-pacer-min-sleep",
            "10ms",
            "--drive-pacer-burst",
            "1000",
            "--check-sync=false",
            "--transfers",
            "8",
            "--create-empty-src-dirs",
        ])
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
}

// 2. İşlemi Zorla Durdurma (Kill) Komutu
#[tauri::command]
fn stop_rclone_sync(state: tauri::State<'_, SyncState>) -> Result<String, String> {
    if kill_active_rclone(&state.0) {
        clean_stale_locks();
        Ok("Rclone senkronizasyon işlemi durduruldu.".to_string())
    } else {
        Err("Çalışan Rclone işlemi bulunamadı.".to_string())
    }
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
fn open_in_folder(rel_path: String) -> Result<(), String> {
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
}

fn main() {
    let sync_pid = Arc::new(Mutex::new(None));
    let tray_sync_pid = Arc::clone(&sync_pid);

    tauri::Builder::default()
        .manage(SyncState(sync_pid))
        .setup(move |app| {
            // Başlangıçta kalmış olabilecek kilit dosyalarını temizle
            clean_stale_locks();

            // 3. SİSTEM TEPSİSİ MENÜSÜNÜ OLUŞTURMA (Varsayılan İngilizce)
            let show_i = MenuItem::with_id(app, "show", "Show Interface", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Completely", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
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
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // 4. "X" KAPATMA TUŞUNA BASILINCA UYGULAMAYI KAPATMA, GİZLE!
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close(); // Uygulamanın ölmesini engeller
            }
        })
        .invoke_handler(tauri::generate_handler![
            run_rclone_sync,
            stop_rclone_sync,
            update_tray_lang,
            open_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması başlatılırken hata oluştu");
}
