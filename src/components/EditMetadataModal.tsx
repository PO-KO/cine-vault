import React, { useState } from 'react';
import { X, Upload, RotateCcw, Check } from 'lucide-react';
import { MediaCategory, MediaItem } from '../types/media';

interface EditMetadataModalProps {
  item: MediaItem;
  onClose: () => void;
  onSave: (
    id: string,
    updates: {
      title: string;
      category: MediaCategory;
      synopsis: string;
      customPosterUrl: string;
    }
  ) => Promise<void>;
}

export const EditMetadataModal: React.FC<EditMetadataModalProps> = ({ item, onClose, onSave }) => {
  const [title, setTitle] = useState(item.title);
  const [category, setCategory] = useState<MediaCategory>(item.category);
  const [synopsis, setSynopsis] = useState(item.synopsis);
  const [customPosterUrl, setCustomPosterUrl] = useState(item.customPosterUrl || '');
  const [saving, setSaving] = useState(false);

  const categories: { id: MediaCategory; label: string; desc: string }[] = [
    { id: 'anime', label: 'Anime', desc: 'Japanese animation series & films' },
    { id: 'tv', label: 'TV Shows', desc: 'Live-action or serialized shows' },
    { id: 'movies', label: 'Movies', desc: 'Standalone feature films & documentaries' },
    { id: 'other', label: 'Other', desc: 'Lectures, home videos, or studio reels' },
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomPosterUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(item.id, {
        title: title.trim() || item.originalTitle,
        category,
        synopsis: synopsis.trim(),
        customPosterUrl: customPosterUrl.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-metadata-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-xs"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 id="edit-metadata-title" className="font-display font-bold text-lg text-slate-900 dark:text-white">
              Edit Media Info & Category
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate max-w-md">
              Source: {item.relativePath} (Auto-detected: {item.autoType.toUpperCase()})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Display Title */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="media-title-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Display Title
              </label>
              <button
                type="button"
                onClick={() => setTitle(item.originalTitle)}
                className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to Folder Name</span>
              </button>
            </div>
            <input
              id="media-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
              required
            />
          </div>

          {/* Category Assignment */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              Library Category (Manual Override)
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {categories.map((cat) => {
                const selected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                      selected
                        ? 'border-rose-600 bg-rose-600/10 text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{cat.label}</span>
                      {selected && <Check className="w-4 h-4 text-rose-500" />}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{cat.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Poster Image */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="poster-url-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Custom Poster Artwork (Image URL or Local Upload)
              </label>
              {customPosterUrl && (
                <button
                  type="button"
                  onClick={() => setCustomPosterUrl('')}
                  className="text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  Use Default Folder Artwork
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id="poster-url-input"
                type="text"
                value={customPosterUrl}
                onChange={(e) => setCustomPosterUrl(e.target.value)}
                placeholder="Paste image URL or upload an image file from your PC..."
                className="flex-1 px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
              />
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg cursor-pointer whitespace-nowrap shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload File</span>
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          </div>

          {/* Synopsis / Notes */}
          <div className="space-y-1.5">
            <label htmlFor="synopsis-input" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              Description / Notes
            </label>
            <textarea
              id="synopsis-input"
              rows={3}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:border-rose-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
