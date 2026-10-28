import React, { useEffect, useState } from 'react';
import {
  X,
  FolderOpen,
  RefreshCw,
  ArrowUp,
  CheckCircle2,
  AlertTriangle,
  Monitor,
  Smartphone,
  Tv,
  HardDrive,
} from 'lucide-react';
import { DirectoryBrowseResponse, SystemCapabilities } from '../types/media';

interface LibrarySettingsModalProps {
  capabilities: SystemCapabilities;
  onClose: () => void;
  onApplyRootPath: (newPath: string) => Promise<void>;
}

export const LibrarySettingsModal: React.FC<LibrarySettingsModalProps> = ({
  capabilities,
  onClose,
  onApplyRootPath,
}) => {
  const [pathInput, setPathInput] = useState(capabilities.rootPath);
  const [browsingData, setBrowsingData] = useState<DirectoryBrowseResponse | null>(null);
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadDirectoryBrowser = async (targetPath: string) => {
    setLoadingDirs(true);
    try {
      const res = await fetch('/api/library/browse-dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      });
      if (res.ok) {
        const data: DirectoryBrowseResponse = await res.json();
        setBrowsingData(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDirs(false);
    }
  };

  useEffect(() => {
    loadDirectoryBrowser(capabilities.rootPath);
  }, [capabilities.rootPath]);

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setScanning(true);
    try {
      await onApplyRootPath(pathInput);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to scan specified folder path.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-xs"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 id="library-settings-title" className="font-display font-bold text-lg text-slate-900 dark:text-white">
              Local Media Folder & Device Compatibility
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure the root directory scanned on your PC and inspect device playback support
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 1. Root Folder Path Form */}
          <form onSubmit={handleScanSubmit} className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="root-path-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Configured Local Root Directory Path
              </label>
              <button
                type="button"
                onClick={() => {
                  setPathInput(capabilities.defaultSamplePath);
                  loadDirectoryBrowser(capabilities.defaultSamplePath);
                }}
                className="text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                Restore Sample Media Folder
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                id="root-path-input"
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="e.g. C:\Users\You\Videos\Anime or /home/user/Media"
                className="flex-1 px-3.5 py-2.5 text-sm font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
                required
              />
              <button
                type="submit"
                disabled={scanning}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
                <span>{scanning ? 'Scanning...' : 'Save & Scan Folder'}</span>
              </button>
            </div>

            {errorMsg && (
              <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </form>

          {/* 2. Interactive Directory Browser on Host PC */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-rose-500" />
                <span>Browse Folders on This PC</span>
              </span>
              {browsingData?.parentPath && (
                <button
                  type="button"
                  onClick={() => {
                    if (browsingData.parentPath) {
                      setPathInput(browsingData.parentPath);
                      loadDirectoryBrowser(browsingData.parentPath);
                    }
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-rose-500 cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>Up One Folder</span>
                </button>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 max-h-48 overflow-y-auto space-y-1">
              {loadingDirs ? (
                <p className="text-xs text-slate-400 py-4 text-center">Reading local directories...</p>
              ) : browsingData && browsingData.directories.length > 0 ? (
                browsingData.directories.map((dir) => (
                  <button
                    key={dir.fullPath}
                    type="button"
                    onClick={() => {
                      setPathInput(dir.fullPath);
                      loadDirectoryBrowser(dir.fullPath);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs hover:bg-slate-200/70 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2 font-mono text-slate-800 dark:text-slate-200 truncate">
                      <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="truncate">{dir.name}</span>
                    </span>
                    {dir.videoCountHint > 0 && (
                      <span className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                        {dir.videoCountHint} video{dir.videoCountHint === 1 ? '' : 's'}
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-3 text-center">
                  No subdirectories in <span className="font-mono">{browsingData?.currentPath}</span>
                </p>
              )}
            </div>
          </div>

          {/* 3. Server & Multi-Device Compatibility Diagnostics */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
              Multi-Device Playback & Browser Compatibility Matrix
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                  <Monitor className="w-4 h-4 text-rose-500" />
                  <span>PC & Laptop Browsers</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Native HTTP 206 byte-range scrubbing for MP4 (H.264/AAC) and WebM. Keyboard shortcuts and hover previews active.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                  <Smartphone className="w-4 h-4 text-rose-500" />
                  <span>Smartphones (iOS / Android)</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Touch-optimized player with ≥44px targets. iOS Safari requires WebVTT subtitles (SRT files are auto-converted by the server).
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                  <Tv className="w-4 h-4 text-rose-500" />
                  <span>Smart TV Browsers</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Tizen, webOS, and Android TV support D-Pad directional focus and H.264 MP4 natively. MKV/AVI files require server FFmpeg remuxing.
                </p>
              </div>
            </div>

            {/* FFmpeg & Host Status Row */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                {capabilities.ffmpegAvailable ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="text-slate-700 dark:text-slate-300">
                      <strong>FFmpeg Remux Engine Active:</strong> MKV/AVI containers and embedded audio/subtitle tracks will stream on-the-fly.
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-slate-700 dark:text-slate-300">
                      <strong>Direct Byte-Range Mode:</strong> MP4, WebM, and SRT/VTT subtitles work natively. Install <code className="font-mono">ffmpeg</code> on your PC PATH to enable live AVI/MKV transcoding for Smart TV browsers.
                    </span>
                  </>
                )}
              </div>
              <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                {capabilities.totalFilesScanned} files indexed
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
