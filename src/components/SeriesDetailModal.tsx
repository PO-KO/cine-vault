import React, { useMemo, useState } from 'react';
import { X, Play, CheckCircle2, Subtitles, Volume2, FolderOpen } from 'lucide-react';
import { MediaEpisode, MediaItem } from '../types/media';
import { formatCategoryLabel, formatTimecode } from '../utils/formatters';

interface SeriesDetailModalProps {
  item: MediaItem;
  onClose: () => void;
  onPlayEpisode: (item: MediaItem, episode: MediaEpisode) => void;
  onToggleEpisodeWatched: (episode: MediaEpisode, completed: boolean) => void;
  tvMode: boolean;
}

export const SeriesDetailModal: React.FC<SeriesDetailModalProps> = ({
  item,
  onClose,
  onPlayEpisode,
  onToggleEpisodeWatched,
  tvMode,
}) => {
  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const ep of item.episodes) {
      set.add(ep.seasonNumber);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [item.episodes]);

  const [selectedSeason, setSelectedSeason] = useState<number>(
    item.inProgressEpisode?.seasonNumber || seasons[0] || 1
  );

  const seasonEpisodes = useMemo(
    () => item.episodes.filter((ep) => ep.seasonNumber === selectedSeason),
    [item.episodes, selectedSeason]
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="series-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-xs"
    >
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="text-rose-600 dark:text-rose-400 font-medium">
                {formatCategoryLabel(item.category)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{item.releaseYear}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {item.watchedEpisodes} of {item.totalEpisodes} Episodes Watched
              </span>
            </div>
            <h2
              id="series-detail-title"
              className={`font-display font-bold text-slate-900 dark:text-white ${
                tvMode ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'
              }`}
            >
              {item.title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-mono">
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{item.relativePath}</span>
            </p>
          </div>

          <button
            type="button"
            data-focusable="true"
            onClick={onClose}
            aria-label="Close episodes window"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Season Selector Bar */}
        {seasons.length > 1 && (
          <div className="px-6 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto">
            {seasons.map((seasonNum) => {
              const active = selectedSeason === seasonNum;
              return (
                <button
                  key={seasonNum}
                  type="button"
                  data-focusable="true"
                  onClick={() => setSelectedSeason(seasonNum)}
                  className={`px-4 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    tvMode ? 'text-sm' : 'text-xs'
                  } ${
                    active
                      ? 'bg-rose-600 text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  Season {seasonNum}
                </button>
              );
            })}
          </div>
        )}

        {/* Episode List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800/80 p-4 sm:p-6 space-y-3">
          {seasonEpisodes.map((ep) => {
            const hasProgress = ep.progress.currentTime > 0 && !ep.progress.completed;
            const pct =
              ep.progress.duration > 0
                ? Math.min(100, Math.round((ep.progress.currentTime / ep.progress.duration) * 100))
                : 0;

            return (
              <div
                key={ep.id}
                className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      S{String(ep.seasonNumber).padStart(2, '0')} · E{String(ep.episodeNumber).padStart(2, '0')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="uppercase">{ep.containerFormat}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ep.resolutionLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTimecode(ep.progress.duration)}</span>
                    {ep.subtitles.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Subtitles className="w-3.5 h-3.5" />
                          {ep.subtitles.length} {ep.subtitles.length === 1 ? 'Sub' : 'Subs'}
                        </span>
                      </>
                    )}
                    {ep.audioTracks.length > 1 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Volume2 className="w-3.5 h-3.5" />
                          Dual Audio
                        </span>
                      </>
                    )}
                  </div>

                  <h4
                    className={`font-display font-semibold text-slate-900 dark:text-slate-100 truncate ${
                      tvMode ? 'text-lg' : 'text-base'
                    }`}
                  >
                    {ep.title}
                  </h4>

                  <p className="text-xs text-slate-400 font-mono truncate">{ep.fileName}</p>

                  {hasProgress && (
                    <div className="max-w-xs space-y-1 pt-1">
                      <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        <span>In Progress ({pct}%)</span>
                        <span>
                          {formatTimecode(ep.progress.currentTime)} / {formatTimecode(ep.progress.duration)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-focusable="true"
                    onClick={() => onPlayEpisode(item, ep)}
                    className={`inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      tvMode ? 'px-5 py-2.5 text-sm' : 'px-4 py-2 text-xs'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{hasProgress ? 'Resume' : 'Play'}</span>
                  </button>

                  <button
                    type="button"
                    data-focusable="true"
                    onClick={() => onToggleEpisodeWatched(ep, !ep.progress.completed)}
                    className={`inline-flex items-center gap-1.5 border font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      tvMode ? 'px-4 py-2.5 text-sm' : 'px-3 py-2 text-xs'
                    } ${
                      ep.progress.completed
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{ep.progress.completed ? 'Watched' : 'Mark Watched'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
