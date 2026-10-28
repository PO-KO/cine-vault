import React from 'react';
import { X, Keyboard, Tv, Smartphone } from 'lucide-react';

interface ControlsHelpModalProps {
  onClose: () => void;
}

export const ControlsHelpModal: React.FC<ControlsHelpModalProps> = ({ onClose }) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="controls-help-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-xs"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 id="controls-help-title" className="font-display font-bold text-lg text-slate-900 dark:text-white">
            PC Keyboard, Touch & Smart TV Remote Controls
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PC Keyboard Shortcuts */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center gap-2 font-display font-semibold text-sm text-slate-900 dark:text-white">
                <Keyboard className="w-4 h-4 text-rose-500" />
                <span>PC & Laptop Player Shortcuts</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300 font-mono">
                <li className="flex justify-between">
                  <span>Space / K</span>
                  <span className="font-sans text-slate-500">Play / Pause</span>
                </li>
                <li className="flex justify-between">
                  <span>Left / Right Arrow</span>
                  <span className="font-sans text-slate-500">Seek -10s / +10s</span>
                </li>
                <li className="flex justify-between">
                  <span>Up / Down Arrow</span>
                  <span className="font-sans text-slate-500">Volume +10% / -10%</span>
                </li>
                <li className="flex justify-between">
                  <span>F</span>
                  <span className="font-sans text-slate-500">Toggle Fullscreen</span>
                </li>
                <li className="flex justify-between">
                  <span>M</span>
                  <span className="font-sans text-slate-500">Mute / Unmute Audio</span>
                </li>
                <li className="flex justify-between">
                  <span>C</span>
                  <span className="font-sans text-slate-500">Cycle Subtitle Tracks</span>
                </li>
                <li className="flex justify-between">
                  <span>Escape</span>
                  <span className="font-sans text-slate-500">Close Player / Modal</span>
                </li>
              </ul>
            </div>

            {/* Smart TV & Mobile */}
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2 font-display font-semibold text-sm text-slate-900 dark:text-white">
                  <Tv className="w-4 h-4 text-rose-500" />
                  <span>Smart TV Remote (D-Pad)</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Use directional <strong>Arrow Keys</strong> on your remote to move the high-contrast crimson focus ring across cards and navigation buttons. Press <strong>Enter / OK</strong> to select, and <strong>Back / Escape</strong> to return. Enable <strong>TV Mode</strong> in the toolbar for 10-foot viewing typography.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2 font-display font-semibold text-sm text-slate-900 dark:text-white">
                  <Smartphone className="w-4 h-4 text-rose-500" />
                  <span>Smartphone Touch Controls</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Tap the video canvas to show/hide playback controls, drag the timeline scrubber to seek, or tap the subtitle/audio icons to switch tracks on the fly.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
