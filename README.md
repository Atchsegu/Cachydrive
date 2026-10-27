# CachyDrive 🚀

**CachyDrive** is a modern, lightweight, and user-friendly desktop application designed for Linux users to achieve seamless **bi-directional (two-way) synchronization** between a local folder and Google Drive.

Built with **Tauri v2**, **Rust**, and standard Web technologies, CachyDrive delivers native desktop performance while consuming minimal system resources. Under the hood, it leverages the robust **`rclone bisync`** engine.

---

## ✨ Features

- **Two-Way Synchronization:** Keeps your local `~/GoogleDrive` folder and Google Drive cloud storage in sync using `rclone bisync`.
- **Live Transfer Dashboard:** Monitor real-time upload/download speeds, transferred data size, remaining time (ETA), and progress percentage.
- **Intelligent Conflict Resolution:** Choose how file conflicts are handled:
  - *Keep Newer (Default)*: The latest modified file wins.
  - *Keep Local*: Prioritize your local changes.
  - *Keep Cloud*: Prioritize changes made on Google Drive.
- **System Tray Integration:** 
  - Minimizes to the Linux system tray when closing the window (X button) to avoid interrupting active sync jobs.
  - Quick access menu to Show, Hide, or Quit completely.
- **Auto-Recovery & Lock Cleaner:** Automatically cleans orphan `.lck` (lock) files caused by abrupt system shutdowns, preventing sync stalls.
- **Bilingual Interface:** Full support for both **English** and **Turkish** (both UI and system tray).
- **Configurable Sync Frequency:** Set auto-sync intervals (e.g., every 5, 10, or 30 minutes) or trigger sync manually.

---

## ⚠️ CRITICAL: Avoid Google Rate Limits & Sluggish Sync

> [!IMPORTANT]
> **DO NOT USE RCLONE'S DEFAULT SHARED GOOGLE API KEY!**
> 
> By default, `rclone` uses a shared public API key used by hundreds of thousands of people. Google heavily throttles this shared key, frequently causing severe delays, slow speeds, and `403 rateLimitExceeded` errors.
> 
> **To make CachyDrive fast and reliable, you strongly need your own Google Cloud Client ID & Secret.** 
- **100% Free Forever:** Personal usage falls completely within Google's free tier.
- **No Credit Card Required:** Google does NOT ask for billing or credit card details to create this OAuth client ID.
- **Takes ~2 minutes:** Once configured, you never have to do it again.

### How to Get Your Own Google Client ID & Secret (Free)

1. Open the **[Google Cloud Console](https://console.cloud.google.com/)** and sign in with your Google account.
2. Click **Select a project** (top bar) > **New Project**, name it (e.g., `CachyDrive`), and click **Create**.
3. Go to **APIs & Services > Library**, search for **Google Drive API**, and click **Enable**.
4. Go to **APIs & Services > OAuth consent screen**:
   - Choose **External** and click **Create**.
   - Fill in the required fields (App name: `CachyDrive`, User support email, Developer email).
   - Under **Test users**, add your own Google email address and click **Save and Continue**.
5. Go to **APIs & Services > Credentials**:
   - Click **+ CREATE CREDENTIALS** > **OAuth client ID**.
   - Application type: Select **Desktop app**.
   - Click **Create**.
6. Google will display your **Client ID** and **Client Secret**. Keep this window open!

---

## 📋 Prerequisites & Setup

### Step 1: Install `rclone`
Install `rclone` via your Linux distribution's package manager:

- **Arch Linux / CachyOS / Manjaro:**
  ```bash
  sudo pacman -S rclone
  ```
- **Ubuntu / Debian / Linux Mint:**
  ```bash
  sudo apt install rclone
  ```
- **Fedora:**
  ```bash
  sudo dnf install rclone
  ```
- *Or official install script:*
  ```bash
  sudo -v ; curl https://rclone.org/install.sh | sudo bash
  ```

### Step 2: Configure Your Google Drive Remote (`gdrive`)
CachyDrive looks specifically for a remote named **`gdrive`**. Configure it once:

1. Open your terminal and run:
   ```bash
   rclone config
   ```
2. Type `n` for **New remote**.
3. Name: type **`gdrive`** *(must be exact lowercase `gdrive`)*.
4. Storage: type `drive` (or enter the number corresponding to Google Drive).
5. **Paste your custom `client_id`** (created above) and press Enter.
6. **Paste your custom `client_secret`** (created above) and press Enter.
7. Choose scope `1` (Full access to all files).
8. Press Enter for default root folder and service account credentials.
9. When prompted `Use auto config?`, press `y`. A browser tab will open for authentication.
10. Click **Continue** (ignore any "Google hasn't verified this app" warning since it's your own private app) and grant permissions.
11. Return to the terminal, confirm with `y`, and quit with `q`.

### Step 3: Local Sync Folder
By default, CachyDrive syncs with:
```
~/GoogleDrive
```
*(The application will automatically create this directory in your Home folder if it does not already exist).*

---

## 🚀 Running CachyDrive

### Using the Pre-built AppImage (Easiest)
1. Download the latest `cachydrive_*.AppImage` from the **[Releases](https://github.com/Atchsegu/Cachydrive/releases)** tab.
2. Grant execution permissions:
   ```bash
   chmod +x cachydrive_*.AppImage
   ```
3. Double-click the file or run it via terminal:
   ```bash
   ./cachydrive_*.AppImage
   ```

---

## 🛠️ Building from Source (For Developers)

If you wish to modify or compile CachyDrive yourself:

### Requirements
- **Node.js** (v18+) & **npm**
- **Rust & Cargo** ([rustup.rs](https://rustup.rs/))
- **Linux Tauri dependencies** (e.g. `webkit2gtk-4.1`, `libayatana-appindicator3`, `openssl`)

### Compilation Steps
1. Clone this repository:
   ```bash
   git clone https://github.com/Atchsegu/Cachydrive.git
   cd Cachydrive
   ```
2. Install frontend dependencies:
   ```bash
   npm install
   ```
3. Run in development mode:
   ```bash
   npm run tauri dev
   ```
4. Build the release AppImage / binary:
   ```bash
   npm run tauri build
   ```
   The compiled package will be generated inside `src-tauri/target/release/bundle/`.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
