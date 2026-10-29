# CineVault Local — Persistent State, SQLite Storage & Multi-Device LAN Streaming

This plan upgrades CineVault Local to persist all media folders, watching status, episode playback timestamps, watch history, and user preferences across page reloads, browser restarts, and multi-device local network (LAN) streaming sessions using a local SQLite database on the host PC paired with browser IndexedDB handle persistence.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural choices reflect your confirmed preferences. No source code changes or database additions will be made until you review and approve this plan.

- **Confirmed Decision 1 — Hybrid Local Folder Access (`Server Path + Browser IndexedDB Handle`)**:
  - **Host PC / LAN Server Folders**: The user can configure one or more local filesystem paths on the host PC, which are stored in the SQLite database on the host PC so the Host PC, Laptops, Smartphones, Tablets, and Smart TVs on the same Wi-Fi/LAN can browse and stream all media immediately without re-picking folders.
  - **Browser-Picked Folders (`IndexedDB` Directory Handle + Snapshot Cache)**: When a folder is picked or dropped in the browser (`showDirectoryPicker`, folder input, or drag-and-drop), the app persists the `FileSystemDirectoryHandle` and scanned catalog structure in browser `IndexedDB` and syncs the catalog metadata, custom edits, and episode progress to the host SQLite database. On page reload, the catalog and watch status restore immediately; if the browser requires a single-click permission re-grant to read raw video blobs from a `FileSystemDirectoryHandle`, a non-intrusive **"Reconnect Local Folder"** banner lets you restore direct file access in one click.
- **Confirmed Decision 2 — Persistence Engine (`SQLite Local Database on Host PC` + Client Fallback Sync)**:
  - Uses Node.js's built-in `node:sqlite` (`DatabaseSync` in Node 22+, requiring zero external native compilation dependencies) stored in a local `.sqlite` database file on the host PC, automatically migrating any existing data from `media-library-state.json` on startup.
  - Mirrors active UI preferences and catalog state to browser `localStorage` / `IndexedDB` so refreshing the page is instantaneous and resilient even if a folder is temporarily offline.
- **Confirmed Decision 3 — LAN Access Control (`Optional PIN/Passcode Protection for LAN Clients`)**:
  - By default, the host PC (`localhost` / `127.0.0.1`) has full access.
  - You can enable an optional **4–6 digit PIN / Passcode** in the Network & Security Settings modal. When enabled, other devices on your local network (`192.168.x.x` / `10.x.x.x`) are prompted for the PIN once to receive an HTTP-only signed session cookie before browsing or streaming.
- **Confirmed Decision 4 — Automatic Completion Threshold (`90%`)**:
  - Whenever playback reaches or exceeds **90%** of a movie's or episode's duration, its status automatically transitions from `Watching` to `Completed`, records the completion timestamp in Watch History, and resets the resume pointer so re-watching starts cleanly while preserving the completed badge.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms CineVault Local into a persistent, self-hosted home media server and player where folder selections, custom metadata, episode progress (`Unwatched`, `Watching`, `Completed`), watch history, and UI preferences survive reloads and restarts, and where any device on your home Wi-Fi can stream from your PC.
- **Target Audience / Persona**: A home media enthusiast running CineVault on a Windows/Linux/macOS PC who wants zero-friction reload persistence and seamless streaming to laptops, phones, tablets, and Smart TVs on the local network.
- **Key Value**: Eliminates repetitive folder re-selection after browser refreshes, keeps watching progress synchronized across devices, and provides clear LAN IP discovery, Windows Firewall instructions, and codec/remux streaming support out of the box.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Zero-Effort Reload & Folder Reconnection**:
     - Refreshing the browser (`F5`) or restarting the app immediately loads the persisted media folders, enriched AniList/TMDB posters, watch progress bars, active category tab, sort order, and theme without resetting to demo state.
     - If a configured server folder is unplugged/unavailable (e.g., an external drive `E:\media` is disconnected) or a browser-picked folder handle needs read permission after a browser restart, a clear **Folder Availability Banner** appears at the top of the library with one-click **"Reconnect Folder"** or **"Update Folder Location"** actions while preserving all saved watch progress.
  2. **Watching Status, Resume Playback & Watch History**:
     - Every movie and episode tracks three explicit states: **Unwatched**, **Watching** (with saved timestamp, percentage bar, remaining time, and last-watched date), and **Completed** (automatically triggered at $\ge 90\%$ duration or toggled manually).
     - Clicking **Resume** on the Hero Spotlight, Continue Watching row, or Series Episode list starts playback directly at the saved timestamp.
     - A dedicated **Watch History** drawer/panel inside Library Settings (and accessible from the toolbar) displays chronologically watched episodes and movies with timestamps and quick resume or status reset controls.
  3. **Local Network (LAN) Streaming & Setup Hub**:
     - Opening **Library & Network Server Settings** reveals a dedicated **LAN Streaming & Multi-Device Access** tab.
     - Automatically detects and displays the host PC's local network IPv4 addresses (e.g., `http://192.168.1.42:3000`) with a one-click copy button, step-by-step instructions for connecting from phones, tablets, laptops, and Smart TVs, and copyable Windows Firewall (`New-NetFirewallRule`) commands.
     - Includes an **Optional LAN PIN Lock** toggle where the host user can set or disable a 4–8 digit passcode for non-localhost LAN devices.

- **Visual Identity & Theme**:
  - **Aesthetic Direction**: Atmospheric dark-first cinema vault (`#020617` slate-950 canvas, `#0F172A` slate-900 structural cards, `1px` `#1E293B` hairline borders, `#E11D48` rose-600 primary actions).
  - **Typography & Hierarchy**: `Outfit` for display titles and section headers, `Plus Jakarta Sans` for clean body legibility, and `JetBrains Mono` (`tabular-nums`) for timecodes, IP addresses, ports, file sizes, and progress percentages.
  - **Anti-Slop & Zero-Pill Discipline**: Metadata (release year, episode count, container format, last watched date) is rendered as clean inline text separated by `·` bullets. Interactive filters and tabs use crisp segmented buttons.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Node.js Built-In SQLite (`node:sqlite`) vs. External ORM/Database Server**
  - *Chosen Approach*: Use Node 22's built-in `node:sqlite` (`DatabaseSync`) in WAL (Write-Ahead Logging) mode, backed by a single local file (`cinevault.sqlite`) in the project directory, with automatic migration from `media-library-state.json`.
  - *Why*: Provides ACID transactions, concurrent multi-device read/write safety across LAN clients, and structured tables for folders, catalog items, episode progress, watch history, and user preferences—without requiring external database servers or fragile C++ native addon builds.
  - *Alternatives Considered*: Pure JSON file (prone to write races when multiple LAN devices update progress simultaneously); Cloud database (violates offline local-network requirement).

- **Decision 2: Hybrid Folder Access (`Server Path` + `Browser IndexedDB Handle`)**
  - *Chosen Approach*: Support both server-accessible directory paths (ideal for LAN streaming to phones/TVs because the Node.js server reads the files directly from disk) and browser-picked directories stored in `IndexedDB` (ideal when picking folders through the browser file dialog, syncing catalog metadata and progress to SQLite so nothing is lost on refresh).
  - *Why*: Browser security sandboxes do not expose full OS paths (`E:\Downloads\media`) from `<input webkitdirectory>`, nor can a phone on Wi-Fi read a `Blob` living solely inside the host browser's memory. By combining persistent `IndexedDB` directory handles + catalog caching with a one-click server folder path linker, both single-PC browser picking and multi-device LAN streaming work seamlessly.

- **Decision 3: LAN Security & Path Traversal Hardening**
  - *Chosen Approach*:
    1. **Strict Path Whitelisting**: The streaming and subtitle endpoints resolve canonical paths (`path.resolve`) and verify that every requested file resides strictly inside one of the user's configured media root folders. Any manipulated URL or `..` traversal attempt returns `403 Forbidden`.
    2. **Optional LAN PIN Gate**: Localhost (`127.0.0.1` / `::1`) is always trusted as the Host PC. Remote LAN IPs (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) are allowed directly when Trusted Network mode is active, or prompted for a PIN when PIN Protection is enabled.
  - *Security Risks Explained*: Allowing LAN access means anyone connected to the same Wi-Fi router (such as guests or roommates) can open your PC's IP and port in their browser. Restricting file access strictly to configured media directories prevents anyone on the Wi-Fi from reading personal documents outside your media folders, and the optional PIN lock prevents unauthorized viewing or progress changes on shared Wi-Fi networks.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     CLIENT DEVICES (Host PC, Phone, Tablet, TV)              │
│                                                                              │
│  ┌─────────────────────────┐  ┌────────────────────────┐  ┌───────────────┐  │
│  │  TopNav & Workspace     │  │  Library Grid, Hero &  │  │ VideoPlayer   │  │
│  │  Toolbar (Tabs, Sort,   │  │  Continue Watching     │  │ Modal (Range  │  │
│  │  Filter, Search, Theme) │  │  (90% Auto-Complete)   │  │ & fMP4 Remux) │  │
│  └───────────┬─────────────┘  └───────────┬────────────┘  └───────┬───────┘  │
│              │                            │                       │          │
│  ┌───────────┴────────────────────────────┴───────────────────────┴───────┐  │
│  │         Client Persistence & Reconnect Layer (IndexedDB + LocalStorage)│  │
│  │  • Persists FileSystemDirectoryHandle & picked folder catalog snapshot │  │
│  │  • One-click "Reconnect Folder" permission flow on browser restart     │  │
│  │  • Automatic network retry & playback resume on Wi-Fi drop             │  │
│  └────────────────────────────────────────┬───────────────────────────────┘  │
└───────────────────────────────────────────┼──────────────────────────────────┘
                                            │ HTTP / LAN (0.0.0.0:3000)
                                            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       HOST PC NEXT.JS MEDIA SERVER                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  LAN Access Control & Security Guard                                   │  │
│  │  • Path canonicalization (blocks arbitrary file access outside roots)  │  │
│  │  • Optional LAN PIN verification & HTTP-only session token             │  │
│  │  • OS Network Interface IPv4 detector (192.168.x.x / 10.x.x.x)         │  │
│  └───────────────┬────────────────────────────────────────┬───────────────┘  │
│                  ▼                                        ▼                  │
│  ┌───────────────────────────────────┐    ┌───────────────────────────────┐  │
│  │  SQLite Persistence Engine        │    │  Media & Remux Streaming API  │  │
│  │  (cinevault.sqlite via node:sqlite│    │  • HTTP 206 Byte-Range (MP4)  │  │
│  │  • media_folders (multi-folder)   │    │  • Live FFmpeg fMP4 Remux     │  │
│  │  • catalog_items & metadata_cache │    │    (-c:v copy -c:a aac -ac 2) │  │
│  │  • episode_progress & history     │    │  • External & Embedded Subs   │  │
│  │  • user_preferences & lan_pin     │    └───────────────────────────────┘  │
│  └───────────────────────────────────┘                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & SQLite Schema (`cinevault.sqlite`)

1. **`media_folders`**:
   - `id` (TEXT PRIMARY KEY), `path` (TEXT), `label` (TEXT), `source_type` (`'server' | 'client_handle'`), `is_active` (INTEGER), `last_scanned_at` (TEXT).
2. **`catalog_snapshots`**:
   - Stores serialized catalog items and episode structures for client-picked folders so that refreshing the page or viewing from another tab restores the library immediately even before re-scanning files.
3. **`media_overrides`**:
   - `media_id` (TEXT PRIMARY KEY), `is_favorite` (INTEGER), `manual_category` (TEXT), `custom_title` (TEXT), `custom_synopsis` (TEXT), `custom_poster` (TEXT), `external_metadata_json` (TEXT).
4. **`episode_progress`**:
   - `episode_id` (TEXT PRIMARY KEY), `media_id` (TEXT), `status` (`'unwatched' | 'watching' | 'completed'`), `current_time` (REAL), `duration` (REAL), `completed` (INTEGER), `last_watched_at` (TEXT).
5. **`watch_history`**:
   - `id` (INTEGER PRIMARY KEY AUTOINCREMENT), `episode_id` (TEXT), `media_id` (TEXT), `media_title` (TEXT), `episode_title` (TEXT), `season_number` (INTEGER), `episode_number` (INTEGER), `current_time` (REAL), `duration` (REAL), `status` (TEXT), `watched_at` (TEXT).
6. **`user_preferences`**:
   - `key` (TEXT PRIMARY KEY), `value_json` (TEXT) — stores `activeTab`, `watchedFilter`, `sortBy` (`title`, `lastWatched`, `year`, `rating`), `darkMode`, `tvMode`, `completionThreshold` (`0.90`), `playbackVolume`, `playbackSpeed`, `preferredAudioLang`, `preferredSubLang`, and `lanPinConfig`.

### Interactive Component & State Mapping

- **Startup & Reload Lifecycle**:
  - On mount, the app fetches `/api/library` (which loads SQLite-persisted server folders, client catalog snapshots, episode progress, watch history, user preferences, and LAN network info) AND checks browser `IndexedDB` for any saved `FileSystemDirectoryHandle`.
  - If the active library was picked via browser folder picker, the saved catalog + watching progress renders immediately from SQLite/IndexedDB. If the user plays a local video whose `File` handle requires browser permission after a full browser restart, the app invokes `dirHandle.requestPermission({ mode: 'read' })` or prompts to re-link the folder without losing any progress.
- **90% Automatic Completion & Progress Sync**:
  - During playback, `VideoPlayerModal` saves progress every 5 seconds, on pause, on seek, and on close.
  - When `currentTime / duration >= 0.90`, the episode is marked `completed = true` (`status = 'completed'`), logged to `watch_history`, and synchronized to both SQLite and client state so all connected LAN devices immediately see the updated progress.
- **LAN Multi-Device Streaming & Network Resilience**:
  - The server binds to `0.0.0.0:3000` (all network interfaces).
  - `/api/network` returns the host PC's detected LAN IPv4 URLs (e.g., `http://192.168.1.x:3000`), firewall helper commands, and PIN lock status.
  - In `VideoPlayerModal`, if a brief Wi-Fi drop interrupts streaming (`onStalled` / `onError`), the player displays a non-blocking reconnecting indicator and automatically resumes from `currentTimeRef.current` once the network responds.
