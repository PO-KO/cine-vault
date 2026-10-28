# CineVault Local — Personal Media Streaming Application

A personal, self-hosted media streaming web application built with TypeScript for browsing, organizing, and watching locally stored Anime, TV Shows, Movies, and video files across PCs, smartphones, and Smart TVs.

## User Review & Critical Decisions (Stage 2 & Stage 3 Approval)

> [!IMPORTANT]
> **Please review and approve both the Requirements Specification (Stage 2) and Architecture & Technology Decisions (Stage 3) below.** Per your rules, no external databases, unapproved libraries, or hidden features will be added without your explicit approval.

### Confirmed Stage 1 Requirements Summary
- **Media Source & Access**: Server-side scanning of a configured local root folder path on your PC (with a built-in sample/demo media folder and folder-path configuration UI so it works immediately and can point to any directory on your computer).
- **Folder Structure & Categorization**: Supports a single root folder containing mixed movie and series subfolders. Automatically detects **Movies** vs. **Series** (based on subfolder depth and episode files) and allows **manual category assignment/editing** in the UI (`Anime`, `TV Shows`, `Movies`, `Other`).
- **Video & Subtitle Playback**:
  - Browser-native `MP4` and `WebM` streaming via HTTP `206 Partial Content` byte-range requests.
  - On-the-fly streaming support for `MKV` and `AVI` files.
  - External `.srt` and `.vtt` subtitle files located in media folders (with automatic on-the-fly `SRT` to `WebVTT` conversion for browser compatibility).
  - Embedded subtitle tracks and multiple audio tracks switching inside container files.
- **Library & Playback Features**:
  - **Continue Watching & Watch Progress**: Automatically saves playback timestamp and duration per video/episode and surfaces in-progress items in a dedicated row.
  - **Favorites / Watchlist**: One-click bookmarking to save series or movies to a personal Watchlist.
  - **Search & Filtering**: Live filtering by category (`All`, `Anime`, `TV Shows`, `Movies`, `Other`), watched status (`All`, `Unwatched`, `In Progress`, `Completed`), and title search.
  - **Custom Metadata Editing**: Edit display titles, category tags, and custom poster image URLs or local cover files directly in the UI.
- **Visual Design & Multi-Device Support**:
  - **Dual Theme**: Full **Dark Mode** (cinematic deep obsidian slate `#0B0F17` with warm crimson/amber accent `#E11D48`) and **Light Mode** (clean daylight alabaster `#F8FAFC` with high-contrast slate typography).
  - **Responsive Targets**:
    - **PC / Laptop**: Desktop layout (`1440px` baseline) with top navigation bar, hover previews, and full keyboard shortcuts (`Space`, `F`, `M`, `ArrowLeft`/`ArrowRight`, `C`).
    - **Smartphone**: Mobile-first touch grid, `>= 44px` touch targets, sticky bottom/compact navigation respecting the `< 15%` viewport sticky cap, and touch-friendly player controls.
    - **Smart TV**: 10-foot UI mode / large-screen responsiveness with high-contrast focus rings (`focus-visible:ring-4`), large selectable cards, and spatial/directional arrow-key & TV remote navigation (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`, `Escape`/`Back`).

---

### Pending Architecture & Technology Approvals (Stage 3)

> [!WARNING]
> **Approval Request 1 — Local Metadata Persistence (No External Database)**
> To save your watch progress, favorites, manual category overrides, and custom titles/posters without introducing an external database engine, we propose storing a human-readable JSON file (`media-library-state.json`) directly on the server disk alongside a local cache in browser storage.
> - **Trade-off**: Zero database setup required and portable across folders, though intended for single-household/personal concurrency rather than thousands of simultaneous users.

> [!WARNING]
> **Approval Request 2 — MKV/AVI Streaming & Embedded Tracks (`FFmpeg` Local Binary + Pure Node Fallback)**
> Web browsers (especially on Smart TVs and phones) cannot natively play raw `.avi` containers, certain `.mkv` audio codecs (like AC3/DTS), or extract embedded MKV subtitle/audio streams without server assistance.
> - **Proposed Approach**: Use Node's built-in `child_process` to invoke your PC's local `ffmpeg` / `ffprobe` binary (when available on your system PATH) to probe embedded audio/subtitle tracks and remux `MKV`/`AVI` streams on the fly into fragmented MP4 (`fMP4`), while gracefully falling back to direct HTTP `206 Partial Content` byte-range streaming if `ffmpeg` is not installed.
> - **Zero Extra Dependencies**: This uses standard Node.js built-in modules (`fs`, `path`, `stream`, `child_process`) without installing heavy native C++ packages.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms any local folder of anime, shows, and movies on your PC into a cohesive, multi-device streaming portal with instant byte-range scrubbing, subtitle rendering, episode tracking, and customizable library organization.
- **Target Audience / Persona**: Personal home media viewer watching anime, series, and films across a desktop monitor, phone over local Wi-Fi, or living-room Smart TV browser.
- **Key Value**: Combines the simplicity of local folder storage with the browsing ergonomics, resume-playback memory, and multi-device responsiveness of a dedicated streaming platform.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Library Scan & Setup Flow**:
   - On launch, the server scans the configured root media directory (and includes sample local video files out-of-the-box so you can test playback immediately).
   - Users can open **Library Settings** at any time to change the local root folder path on their PC and trigger a re-scan.
2. **Browsing & Discovery Flow**:
   - **Hero Spotlight**: Displays the currently active "Continue Watching" item or featured library title with direct **Resume / Play** and **Watchlist** actions.
   - **Continue Watching Row**: Shows partially watched movies and episodes with a visual progress bar and tabular remaining time (`24m left`).
   - **Filterable Media Grid**: Users filter by Category (`All`, `Anime`, `TV Shows`, `Movies`, `Other`), Watched Status (`All`, `Unwatched`, `In Progress`, `Watched`), and search query.
3. **Series & Season Detail Flow**:
   - Clicking a multi-episode item opens the **Series Detail Drawer/View** showing seasons, episode list, individual episode durations, watched progress bars, and quick-play buttons.
4. **Custom Metadata & Category Editing Flow**:
   - Clicking **Edit Info** on any card opens a clean modal to change its display title, reassign its category (`Anime`, `TV Shows`, `Movies`, `Other`), or set a custom poster image (from local folder artwork or image URL).
5. **Video Player & Multi-Track Flow**:
   - Opens a dedicated full-viewport responsive player supporting play/pause, timeline scrubbing, 10-second skip, volume/mute, audio track selector, subtitle track selector (external `.srt`/`.vtt` + embedded tracks, or upload custom `.srt`/`.vtt`), playback speed, next-episode button, and fullscreen toggle.

### Visual Identity & Theme
- **Aesthetic Direction**: Refined home-cinema media deck combining editorial clarity with high-contrast legibility for both 18-inch desktop viewing and 10-foot Smart TV viewing.
- **Color Palette & Mood (60-30-10 Discipline)**:
  - **Dark Mode (Default)**:
    - `60% Dominant Canvas`: Deep Obsidian (`#0B0F17` / `bg-slate-950`)
    - `30% Structural Surfaces`: Elevated Charcoal (`#151C28` / `bg-slate-900`) with `1px` subtle borders (`border-slate-800/80`)
    - `10% Accent Budget`: Cinema Crimson (`#E11D48` / `rose-600`) for primary Play CTAs, progress bars, and TV remote focus rings; semantic Emerald (`#16A34A`) for completed status.
  - **Light Mode**:
    - `60% Dominant Canvas`: Crisp Alabaster (`#F8FAFC` / `bg-slate-50`)
    - `30% Structural Surfaces`: Pure White (`#FFFFFF`) with hairline borders (`border-slate-200`)
    - `10% Accent Budget`: Deep Crimson (`#BE123C` / `rose-700`) and Slate (`#0F172A`) for high-contrast controls.
- **Typography & Hierarchy (2+1 Font Rule)**:
  - *Display / Headings*: `Outfit` (600/700 weight, tight tracking, `text-wrap: balance`) for expressive show titles and section headers.
  - *Body & UI Controls*: `Plus Jakarta Sans` (400/500/600 weight) for high legibility across phone and TV screens.
  - *Timestamps, Episode Numbers & Durations*: `JetBrains Mono` with `tabular-nums` (`01:24:10`, `S01 · E04`) to prevent layout jitter during playback scrubbing.
- **Zero-Pill Metadata Discipline**:
  - Card metadata (e.g., `Anime · 12 Episodes · 1080p` or `Movie · MKV · 1h 58m`) is rendered as clean, unboxed inline text with middle-dot (`·`) separators—never cluttered with static pill capsules.
- **Top Bar Contract**:
  - Strictly one row with three zones separated by `gap-8`:
    1. **Brand Wordmark**: `CineVault` (single-line display wordmark).
    2. **Primary Navigation Links**: `Home`, `Anime`, `TV Shows`, `Movies`, `Watchlist` (single-line `whitespace-nowrap` links with keyboard/remote focus support).
    3. **Primary Action**: `Library Settings` button (plus theme/TV-mode controls integrated cleanly in the workspace toolbar).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Hybrid Auto-Detection + Manual Category Overrides**
  - *Chosen Approach*: The scanner inspects each top-level entry in your root folder. Single video files or folders with 1 main video file default to `Movies`; folders with multiple episode files or `Season` subfolders default to `TV Shows` (or `Anime` if keywords/tags match), and any item can be manually reassigned in the UI and saved persistently.
  - *Why*: Eliminates the need to reorganize files on your hard drive while still giving you exact control over what appears under Anime, TV Shows, Movies, or Other.
- **Decision 2: Adaptive Multi-Device Navigation (Mouse, Touch, and TV Remote D-Pad)**
  - *Chosen Approach*: Implement a spatial keyboard/D-Pad navigation handler (`Arrow` keys move focus predictably across media cards and filter controls, `Enter` selects, `Escape`/`Backspace` closes modals or exits the player) alongside standard touch and mouse events, plus a toggleable **TV Display Scale** mode for large screens.
  - *Why*: Smart TV browsers rely on directional remote buttons and clear visual focus outlines (`focus-visible`), whereas phones need swipeable rows and large tap areas.
- **Decision 3: Smart TV & Browser Playback Compatibility Layer**
  - *Chosen Approach*: Directly stream `MP4`/`WebM` using HTTP `206 Partial Content` byte ranges for zero-CPU instant seeking; automatically convert `.srt` subtitles into `.vtt` streams; and provide an on-the-fly `FFmpeg` remux/transcode endpoint for `.mkv`/`.avi` files and embedded track selection, with clear UI compatibility diagnostics if a Smart TV browser lacks codec support and `FFmpeg` is not installed on the host PC.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     MULTI-DEVICE CLIENT (PC / Phone / TV)                  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Top Navigation Bar (Brand Wordmark │ Category Nav │ Library Setup)   │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Workspace Toolbar (Search Input, Watched Status Filter, Theme/TV UI) │  │
│  └───────────────┬──────────────────────────────────────┬───────────────┘  │
│                  ▼                                      ▼                  │
│  ┌───────────────────────────────┐      ┌───────────────────────────────┐  │
│  │ Library Browser Views         │      │ Interactive Modals & Player   │  │
│  │ • Hero Spotlight Banner       │      │ • Series Season/Episode Sheet │  │
│  │ • Continue Watching Row       │      │ • Metadata & Poster Editor    │  │
│  │ • Responsive Media Card Grid  │      │ • HTML5/MSE Video Player      │  │
│  │ • D-Pad / Keyboard Focus Mgr  │      │   (Subtitles, Audio, Scrub)   │  │
│  └───────────────┬───────────────┘      └───────────────┬───────────────┘  │
└──────────────────┼──────────────────────────────────────┼──────────────────┘
                   │ HTTP / JSON API                      │ HTTP 206 / Stream
                   ▼                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        LOCAL PC SERVER BACKEND (Node)                      │
│                                                                            │
│  ┌─────────────────────────┐  ┌────────────────────┐  ┌─────────────────┐  │
│  │ /api/library            │  │ /api/state         │  │ /api/stream     │  │
│  │ • Recursive FS Scanner  │  │ • Watch Progress   │  │ • HTTP 206 Byte │  │
│  │ • Auto Movie/Show Rule  │  │ • Watchlist/Favs   │  │   Range Slicer  │  │
│  │ • Subtitle & Poster     │  │ • Manual Category  │  │ • MKV/AVI Remux │  │
│  │   File Matcher          │  │   & Title Overrides│  │ • SRT -> WebVTT │  │
│  └───────────┬─────────────┘  └─────────┬──────────┘  └────────┬────────┘  │
└──────────────┼──────────────────────────┼──────────────────────┼───────────┘
               ▼                          ▼                      ▼
      [Local Media Folder]     [media-library-state.json]  [Video & SRT Files]
```

### Data Model & State
- **`MediaItem`**:
  - `id`: Deterministic hash of relative folder/file path
  - `title`: Display title (parsed from folder/file name or user custom override)
  - `autoType`: `'movie' | 'series'`
  - `category`: `'anime' | 'tv' | 'movies' | 'other'` (supports manual override)
  - `posterUrl`: Local detected cover image (`poster.jpg`, `cover.png`), custom URL, or generated fallback artwork
  - `episodes`: Array of `MediaEpisode` (1 item for movies, multiple sorted by season/episode for series)
  - `isFavorite`: Boolean flag in persistent state
- **`MediaEpisode`**:
  - `id`: Unique file identifier
  - `title`, `seasonNumber`, `episodeNumber`, `fileName`, `relativePath`, `containerFormat` (`mp4`, `webm`, `mkv`, `avi`)
  - `subtitles`: Array of detected external `.srt`/`.vtt` files + embedded subtitle tracks
  - `audioTracks`: Array of detected audio streams
  - `progress`: `{ currentTime: number, duration: number, completed: boolean, updatedAt: string }`

### Incremental Implementation Plan (Stage 4 Checkpoints)
Once you approve this specification and architecture, we will build and verify the application in structured phases:
1. **Phase 1 — Backend Media Scanner, State Store & Streaming Engine**: Local folder scanner, persistent JSON state for overrides/progress, HTTP 206 Range video streaming, SRT-to-VTT subtitle converter, and MKV/AVI compatibility layer.
2. **Phase 2 — Responsive Multi-Device UI & Library Management**: Dark/Light theme system, PC/Mobile/Smart TV adaptive layout, D-Pad/keyboard focus navigation, Continue Watching row, Search/Filter bar, Series Episode selector, and Custom Metadata/Category editor.
3. **Phase 3 — Full-Featured Video Player & Multi-Device Verification**: Custom responsive video player with subtitle selector, audio track switcher, watch-progress auto-save, keyboard/remote shortcuts, and full compilation verification.
