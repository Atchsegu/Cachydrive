export const translations = {
  tr: {
    // Nav
    nav_dashboard: "Ana Pano",
    nav_history: "İşlem Geçmişi",
    nav_settings: "Ayarlar",

    // Actions
    btn_sync: "Senkronize Et",
    btn_sync_in_progress: "İşlem Devam Ediyor",
    btn_sync_retry: "Tekrar Dene",
    btn_stop: "Durdur",

    // Dashboard
    dashboard_title: "Ana Pano",
    status_active: "Sistem Aktif",
    status_syncing: "Eşitleniyor...",
    status_error: "Hata",
    status_stopped: "Durduruldu",

    sync_status_title: "Senkronizasyon Durumu",
    sync_status_desc_idle: "Tüm dosyalar güvende ve güncel.",
    sync_status_desc_checking: "Bağlantı kuruluyor, veriler taranıyor...",
    sync_status_desc_stopped: "İşlem iptal edildi. Sistem beklemede.",

    stat_transferred_size: "Aktarılan Boyut",
    stat_transfer_speed: "Aktarım Hızı",
    stat_remaining_time: "Kalan Süre",
    stat_status: "Durum",
    stat_scanning: "Taranıyor...",
    stat_calculating: "Hesaplanıyor...",
    stat_idle: "Beklemede",
    stat_up_to_date_0b: "Güncel (0 B)",

    recent_activity_title: "Son Etkileşimler",
    log_system: "Sistem",
    log_ui_started: "Arayüz başlatıldı.",

    // History
    history_title: "İşlem Geçmişi",
    btn_clear_history: "Geçmişi Temizle",
    all_records_title: "Tüm Kayıtlar",
    all_records_desc: "Son gerçekleştirilen senkronizasyon ve dosya hareketleri burada listelenir.",

    // Settings
    settings_title: "Ayarlar",
    sync_prefs_title: "Eşitleme Tercihleri",
    label_language: "Uygulama Dili / Language",
    label_autostart: "Uygulama Açılışında",
    opt_manual_start: "Manuel Başlat (Sadece ben tıklarsam)",
    opt_auto_sync: "Otomatik Senkronize Et",
    label_interval: "Senkronizasyon Sıklığı",
    opt_interval_5m: "5 Dakikada Bir (Önerilen)",
    opt_interval_10m: "10 Dakikada Bir",
    opt_interval_30m: "30 Dakikada Bir",
    opt_interval_manual: "Sadece Manuel",
    label_conflict: "Çakışma Çözüm Kuralı",
    opt_conflict_newer: "Her Zaman En Yeni Dosyayı Koru",
    opt_conflict_local: "Her Zaman Bilgisayardakini Koru",
    opt_conflict_remote: "Her Zaman Buluttakini Koru",
    label_local_path: "Yerel Klasör Yolu",
    help_local_path: "Bu klasör Google Drive ile sürekli eşitlenir.",
    btn_save_settings: "Ayarları Kaydet",
    btn_saved: "✓ Kaydedildi",

    // Dynamic Badges
    log_badge_new_file: "YENİ DOSYA",
    log_badge_downloaded: "İNDİRİLDİ",
    log_badge_updated: "GÜNCELLENDİ",
    log_badge_file_deleted: "DOSYA SİLİNDİ",
    log_badge_new_folder: "YENİ KLASÖR",
    log_badge_folder_deleted: "KLASÖR SİLİNDİ",
    log_badge_system: "SİSTEM",
    log_badge_completed: "TAMAMLANDI",
    log_badge_error: "HATA",
    log_badge_scanning: "TARAMA",

    // Dynamic Messages
    msg_starting_sync: "Senkronizasyon başlatılıyor...",
    msg_scan_starts: "Tarama başlıyor...",
    msg_sync_success: "Senkronizasyon başarıyla tamamlandı.",
    msg_sync_error: "Senkronizasyon sırasında hata oluştu!",
    msg_user_stopped: "Kullanıcı işlemi durdurdu.",
    msg_bisync_success: "Bisync başarılı — tüm değişiklikler eşitlendi.",
    msg_settings_saved: "Ayarlar başarıyla kaydedildi ve uygulandı.",
    msg_periodic_sync: "Periyodik senkronizasyon başlatılıyor...",
    msg_autostart_sync: "Otomatik başlatma aktif. Senkronizasyon tetikleniyor...",
    msg_system_error: "Sistem Hatası: ",
    msg_warning: "Uyarı: ",
    msg_moved_suffix: " → taşındı",
    msg_conflict_prefix: "Çakışma: ",

    // Counter helpers
    cnt_listed_and_checked: (listed, total, cur) => `${listed} / ${total} (tahmini) öğe listelendi, ${cur} kontrol edildi`,
    cnt_listed_only: (listed, cur) => `${listed} öğe listelendi, ${cur} kontrol edildi`,
    cnt_scanned_pct: (cur, tot, pct) => `${cur} / ${tot} öğe tarandı (%${pct})`,
    cnt_checked_est: (cur, est) => `${cur} / ${est} (tahmini) öğe kontrol edildi`,
    cnt_checked_only: (cur) => `${cur} öğe kontrol edildi`,
  },

  en: {
    // Nav
    nav_dashboard: "Dashboard",
    nav_history: "Activity History",
    nav_settings: "Settings",

    // Actions
    btn_sync: "Sync Now",
    btn_sync_in_progress: "Sync in Progress",
    btn_sync_retry: "Retry",
    btn_stop: "Stop",

    // Dashboard
    dashboard_title: "Dashboard",
    status_active: "System Active",
    status_syncing: "Syncing...",
    status_error: "Error",
    status_stopped: "Stopped",

    sync_status_title: "Synchronization Status",
    sync_status_desc_idle: "All files are safe and up to date.",
    sync_status_desc_checking: "Connecting, scanning changes...",
    sync_status_desc_stopped: "Operation canceled. System idle.",

    stat_transferred_size: "Transferred Size",
    stat_transfer_speed: "Transfer Speed",
    stat_remaining_time: "Remaining Time",
    stat_status: "Status",
    stat_scanning: "Scanning...",
    stat_calculating: "Calculating...",
    stat_idle: "Idle",
    stat_up_to_date_0b: "Up to date (0 B)",

    recent_activity_title: "Recent Activity",
    log_system: "System",
    log_ui_started: "Interface initialized.",

    // History
    history_title: "Activity History",
    btn_clear_history: "Clear History",
    all_records_title: "All Records",
    all_records_desc: "Recent synchronization steps and file activities are listed here.",

    // Settings
    settings_title: "Settings",
    sync_prefs_title: "Sync Preferences",
    label_language: "App Language / Dil",
    label_autostart: "On Application Startup",
    opt_manual_start: "Manual Start (Only when clicked)",
    opt_auto_sync: "Automatically Synchronize",
    label_interval: "Sync Frequency",
    opt_interval_5m: "Every 5 Minutes (Recommended)",
    opt_interval_10m: "Every 10 Minutes",
    opt_interval_30m: "Every 30 Minutes",
    opt_interval_manual: "Manual Only",
    label_conflict: "Conflict Resolution Rule",
    opt_conflict_newer: "Always Keep Newer File",
    opt_conflict_local: "Always Keep Local File",
    opt_conflict_remote: "Always Keep Cloud File",
    label_local_path: "Local Folder Path",
    help_local_path: "This folder is continuously synced with Google Drive.",
    btn_save_settings: "Save Settings",
    btn_saved: "✓ Saved",

    // Dynamic Badges
    log_badge_new_file: "NEW FILE",
    log_badge_downloaded: "DOWNLOADED",
    log_badge_updated: "UPDATED",
    log_badge_file_deleted: "FILE DELETED",
    log_badge_new_folder: "NEW FOLDER",
    log_badge_folder_deleted: "FOLDER DELETED",
    log_badge_system: "SYSTEM",
    log_badge_completed: "COMPLETED",
    log_badge_error: "ERROR",
    log_badge_scanning: "SCANNING",

    // Dynamic Messages
    msg_starting_sync: "Starting synchronization...",
    msg_scan_starts: "Scanning started...",
    msg_sync_success: "Synchronization completed successfully.",
    msg_sync_error: "An error occurred during synchronization!",
    msg_user_stopped: "User stopped the process.",
    msg_bisync_success: "Bisync successful — all changes synced.",
    msg_settings_saved: "Settings saved and applied successfully.",
    msg_periodic_sync: "Starting periodic synchronization...",
    msg_autostart_sync: "Auto-start active. Triggering synchronization...",
    msg_system_error: "System Error: ",
    msg_warning: "Warning: ",
    msg_moved_suffix: " → moved",
    msg_conflict_prefix: "Conflict: ",

    // Counter helpers
    cnt_listed_and_checked: (listed, total, cur) => `${listed} / ${total} (est.) items listed, ${cur} checked`,
    cnt_listed_only: (listed, cur) => `${listed} items listed, ${cur} checked`,
    cnt_scanned_pct: (cur, tot, pct) => `${cur} / ${tot} items scanned (${pct}%)`,
    cnt_checked_est: (cur, est) => `${cur} / ${est} (est.) items checked`,
    cnt_checked_only: (cur) => `${cur} items checked`,
  }
};
