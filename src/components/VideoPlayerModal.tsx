import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Subtitles,
  Music,
  SkipForward,
  ListVideo,
  ArrowLeft,
  CheckCircle2,
  Upload,
  Gauge,
} from 'lucide-react';
import { MediaEpisode, MediaItem, SubtitleTrack } from '../types/media';
import { formatTimecode, ParsedCue, parseVttOrSrtCues } from '../utils/formatters';

interface VideoPlayerModalProps {
  item: MediaItem;
  episode: MediaEpisode;
  ffmpegAvailable: boolean;
  onClose: () => void;
  onSelectEpisode: (episode: MediaEpisode) => void;
  onSaveProgress: (episodeId: string, currentTime: number, duration: number, completed?: boolean) => void;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  item,
  episode,
  ffmpegAvailable,
  onClose,
  onSelectEpisode,
  onSaveProgress,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState<number>(episode.progress.currentTime || 0);
  const [duration, setDuration] = useState<number>(episode.progress.duration || episode.estimatedDurationSec || 1440);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Subtitles state
  const [customSubtitles, setCustomSubtitles] = useState<(SubtitleTrack & { rawContent?: string })[]>([]);
  const allSubtitles = useMemo(
    () => [...episode.subtitles, ...customSubtitles],
    [episode.subtitles, customSubtitles]
  );
  const [activeSubId, setActiveSubId] = useState<string>(episode.subtitles[0]?.id || 'off');
  const [parsedCues, setParsedCues] = useState<ParsedCue[]>([]);

  // Audio track state
  const [activeAudioTrackIdx, setActiveAudioTrackIdx] = useState<number>(0);

  // Menus state
  const [openPanel, setOpenPanel] = useState<'none' | 'subtitles' | 'audio' | 'speed' | 'episodes'>('none');

  // Next episode lookup
  const nextEpisode = useMemo(() => {
    const idx = item.episodes.findIndex((e) => e.id === episode.id);
    if (idx >= 0 && idx + 1 < item.episodes.length) {
      return item.episodes[idx + 1];
    }
    return null;
  }, [item.episodes, episode.id]);

  // Reset state when switching episode
  useEffect(() => {
    setCurrentTime(episode.progress.currentTime || 0);
    setDuration(episode.progress.duration || episode.estimatedDurationSec || 1440);
    setActiveSubId(episode.subtitles[0]?.id || 'off');
    setActiveAudioTrackIdx(0);
    setOpenPanel('none');
    setIsPlaying(true);
  }, [episode]);

  // Load subtitle cues when activeSubId changes
  useEffect(() => {
    if (activeSubId === 'off') {
      setParsedCues([]);
      return;
    }

    const inlineTrack = allSubtitles.find((s) => s.id === activeSubId);
    if (inlineTrack?.rawContent) {
      setParsedCues(parseVttOrSrtCues(inlineTrack.rawContent));
      return;
    }

    let cancelled = false;
    fetch(`/api/subtitles/${episode.id}/${activeSubId}`)
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => {
        if (!cancelled && text) {
          setParsedCues(parseVttOrSrtCues(text));
        }
      })
      .catch(() => {
        if (!cancelled) setParsedCues([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSubId, episode.id, allSubtitles]);

  // Active subtitle cue for current timestamp (loops sample cues every 28s for synthetic demo files so subtitles are always visible at any scrub point)
  const activeSubtitleText = useMemo(() => {
    if (activeSubId === 'off' || parsedCues.length === 0) return '';
    const maxCueEnd = parsedCues[parsedCues.length - 1]?.endTime || 28;
    const effectiveTime =
      episode.isSampleSynthetic && maxCueEnd < 60 && currentTime > maxCueEnd
        ? currentTime % (maxCueEnd + 2)
        : currentTime;

    const match = parsedCues.find((c) => effectiveTime >= c.startTime && effectiveTime <= c.endTime);
    return match ? match.text : '';
  }, [activeSubId, parsedCues, currentTime, episode.isSampleSynthetic]);

  // Save watch progress periodically and on unmount
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  useEffect(() => {
    currentTimeRef.current = currentTime;
    durationRef.current = duration;
  }, [currentTime, duration]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (currentTimeRef.current > 0) {
        onSaveProgress(episode.id, currentTimeRef.current, durationRef.current);
      }
    }, 4000);

    return () => {
      clearInterval(interval);
      if (currentTimeRef.current > 0) {
        onSaveProgress(episode.id, currentTimeRef.current, durationRef.current);
      }
    };
  }, [episode.id, onSaveProgress]);

  // Synthetic Canvas + WebAudio Playback Engine for built-in sample media files
  useEffect(() => {
    if (!episode.isSampleSynthetic) return;

    let animationFrameId: number;
    let lastTimestamp = performance.now();

    const tick = (now: number) => {
      const deltaSec = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      if (isPlaying) {
        setCurrentTime((prev) => {
          const next = prev + deltaSec * playbackRate;
          if (next >= duration) {
            setIsPlaying(false);
            onSaveProgress(episode.id, duration, duration, true);
            return duration;
          }
          return next;
        });
      }

      // Render animated theatrical canvas scene
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const t = currentTimeRef.current;

          // Background gradient by visualTheme
          const grad = ctx.createLinearGradient(0, 0, w, h);
          if (episode.visualTheme === 'cyber_anime') {
            grad.addColorStop(0, '#090d16');
            grad.addColorStop(0.5, '#1e1b4b');
            grad.addColorStop(1, '#4c0519');
          } else if (episode.visualTheme === 'fantasy_anime') {
            grad.addColorStop(0, '#042f2e');
            grad.addColorStop(0.6, '#065f46');
            grad.addColorStop(1, '#0f172a');
          } else if (episode.visualTheme === 'nordic_mystery') {
            grad.addColorStop(0, '#082f49');
            grad.addColorStop(0.6, '#0f172a');
            grad.addColorStop(1, '#020617');
          } else if (episode.visualTheme === 'scifi_cosmos') {
            grad.addColorStop(0, '#020617');
            grad.addColorStop(0.5, '#1c1917');
            grad.addColorStop(1, '#451a03');
          } else {
            grad.addColorStop(0, '#18181b');
            grad.addColorStop(0.6, '#27272a');
            grad.addColorStop(1, '#09090b');
          }
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);

          // Animated particles / stars / rain
          ctx.save();
          for (let i = 0; i < 42; i++) {
            const px = ((i * 197 + t * (28 + (i % 5) * 8)) % (w + 100)) - 50;
            const py = ((i * 113 + t * (episode.visualTheme === 'cyber_anime' ? 140 : 18)) % (h + 60)) - 30;
            ctx.fillStyle =
              episode.visualTheme === 'cyber_anime'
                ? 'rgba(251, 113, 133, 0.45)'
                : episode.visualTheme === 'fantasy_anime'
                ? 'rgba(52, 211, 153, 0.45)'
                : 'rgba(226, 232, 240, 0.35)';
            if (episode.visualTheme === 'cyber_anime') {
              ctx.fillRect(px, py, 2, 18);
            } else {
              ctx.beginPath();
              ctx.arc(px, py, (i % 3) + 1.2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          ctx.restore();

          // Central thematic geometry
          ctx.save();
          ctx.translate(w / 2, h / 2 - 20);
          const pulse = 1 + Math.sin(t * 1.8) * 0.04;
          ctx.scale(pulse, pulse);

          // Outer orbital ring
          ctx.strokeStyle =
            episode.visualTheme === 'cyber_anime'
              ? 'rgba(244, 63, 94, 0.55)'
              : episode.visualTheme === 'fantasy_anime'
              ? 'rgba(16, 185, 129, 0.55)'
              : episode.visualTheme === 'scifi_cosmos'
              ? 'rgba(245, 158, 11, 0.6)'
              : 'rgba(56, 189, 248, 0.5)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, 135, t * 0.4, t * 0.4 + Math.PI * 1.55);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, 175, -t * 0.25, -t * 0.25 + Math.PI * 1.2);
          ctx.stroke();

          // Center emblem
          ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
          ctx.beginPath();
          ctx.arc(0, 0, 95, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Title & Episode HUD overlay inside canvas
          ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
          ctx.font = '600 26px Outfit, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(item.title, w / 2, h / 2 - 28);

          ctx.fillStyle = 'rgba(251, 113, 133, 0.95)';
          ctx.font = '500 15px "JetBrains Mono", monospace';
          const epTag =
            item.autoType === 'series'
              ? `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(
                  2,
                  '0'
                )} · ${episode.title}`
              : `${episode.resolutionLabel} · ${episode.containerFormat.toUpperCase()} Stream`;
          ctx.fillText(epTag, w / 2, h / 2 + 4);

          ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
          ctx.font = '400 13px "JetBrains Mono", monospace';
          const activeAudioLabel = episode.audioTracks[activeAudioTrackIdx]?.label || 'Stereo AAC';
          ctx.fillText(
            `Timecode ${formatTimecode(t)} · Audio: ${activeAudioLabel}`,
            w / 2,
            h / 2 + 34
          );
        }
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    episode,
    item.title,
    item.autoType,
    isPlaying,
    playbackRate,
    duration,
    activeAudioTrackIdx,
    onSaveProgress,
  ]);

  // Real HTML5 <video> element sync for non-synthetic files
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || episode.isSampleSynthetic) return;

    vid.volume = isMuted ? 0 : volume;
    vid.playbackRate = playbackRate;
    if (isPlaying && vid.paused) {
      vid.play().catch(() => setIsPlaying(false));
    } else if (!isPlaying && !vid.paused) {
      vid.pause();
    }
  }, [isPlaying, volume, isMuted, playbackRate, episode.isSampleSynthetic]);

  const handleSeek = useCallback(
    (nextSec: number) => {
      const clamped = Math.max(0, Math.min(duration, nextSec));
      setCurrentTime(clamped);
      if (videoRef.current && !episode.isSampleSynthetic) {
        videoRef.current.currentTime = clamped;
      }
      onSaveProgress(episode.id, clamped, duration);
    },
    [duration, episode.id, episode.isSampleSynthetic, onSaveProgress]
  );

  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document.exitFullscreen?.()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  }, []);

  const cycleSubtitles = useCallback(() => {
    const options = ['off', ...allSubtitles.map((s) => s.id)];
    const idx = options.indexOf(activeSubId);
    const nextId = options[(idx + 1) % options.length];
    setActiveSubId(nextId);
  }, [allSubtitles, activeSubId]);

  // Keyboard & Smart TV Remote shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSeek(currentTimeRef.current - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSeek(currentTimeRef.current + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setIsMuted(false);
          setVolume((v) => Math.min(1, Number((v + 0.1).toFixed(2))));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume((v) => Math.max(0, Number((v - 0.1).toFixed(2))));
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          cycleSubtitles();
          break;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          if (openPanel !== 'none') {
            setOpenPanel('none');
          } else {
            onClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlayPause, handleSeek, toggleMute, toggleFullscreen, cycleSubtitles, openPanel, onClose]);

  // Upload custom local .srt or .vtt subtitle file from PC
  const handleCustomSubUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const newId = `custom-sub-${Date.now()}`;
        const ext = file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
        const newTrack = {
          id: newId,
          label: `${file.name} (Loaded Local File)`,
          language: 'en',
          format: ext as 'srt' | 'vtt',
          rawContent: reader.result,
        };
        setCustomSubtitles((prev) => [...prev, newTrack]);
        setActiveSubId(newId);
        setOpenPanel('none');
      }
    };
    reader.readAsText(file);
  };

  const streamUrl =
    episode.clientBlobUrl ||
    `/api/stream/${episode.id}?audioTrack=${activeAudioTrackIdx}&remux=${
      episode.requiresRemux ? '1' : '0'
    }`;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${item.title} - ${episode.title}`}
      className="fixed inset-0 z-50 bg-black text-white flex flex-col justify-between select-none overflow-hidden"
    >
      {/* Top Overlay Header */}
      <div className="relative z-20 flex items-center justify-between gap-4 px-4 sm:px-8 py-4 bg-gradient-to-b from-black/90 via-black/50 to-transparent">
        <div className="flex items-center gap-3.5 min-w-0">
          <button
            type="button"
            data-focusable="true"
            onClick={onClose}
            aria-label="Back to library"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs sm:text-sm font-medium text-white transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="min-w-0">
            <h2 className="font-display font-bold text-base sm:text-xl text-white truncate">{item.title}</h2>
            <p className="text-xs text-slate-300 font-mono truncate">
              {item.autoType === 'series'
                ? `S${String(episode.seasonNumber).padStart(2, '0')} · E${String(
                    episode.episodeNumber
                  ).padStart(2, '0')} — ${episode.title}`
                : episode.fileName}{' '}
              · {episode.containerFormat.toUpperCase()} · {episode.resolutionLabel}
            </p>
          </div>
        </div>

        {/* Right Top Quick Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {episode.requiresRemux && (
            <span className="hidden md:inline-block text-xs font-mono text-amber-300 px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30">
              {ffmpegAvailable ? 'FFmpeg fMP4 Remux Stream' : `${episode.containerFormat.toUpperCase()} Direct Stream`}
            </span>
          )}

          <button
            type="button"
            data-focusable="true"
            onClick={() => {
              onSaveProgress(episode.id, duration, duration, true);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-emerald-400 transition-colors cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span className="hidden sm:inline">Mark Watched</span>
          </button>
        </div>
      </div>

      {/* Center Video / Canvas Viewport */}
      <div
        onClick={() => {
          if (openPanel !== 'none') {
            setOpenPanel('none');
          } else {
            togglePlayPause();
          }
        }}
        className="relative flex-1 flex items-center justify-center overflow-hidden cursor-pointer"
      >
        {episode.isSampleSynthetic ? (
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="w-full h-full object-contain max-h-full"
          />
        ) : (
          <video
            ref={videoRef}
            src={streamUrl}
            className="w-full h-full object-contain max-h-full"
            playsInline
            autoPlay
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
              if (vid.duration && Number.isFinite(vid.duration)) {
                setDuration(vid.duration);
              }
              if (episode.progress.currentTime > 0 && episode.progress.currentTime < vid.duration) {
                vid.currentTime = episode.progress.currentTime;
              }
            }}
            onTimeUpdate={(e) => {
              setCurrentTime(e.currentTarget.currentTime);
            }}
            onEnded={() => {
              setIsPlaying(false);
              onSaveProgress(episode.id, duration, duration, true);
            }}
          />
        )}

        {/* Active WebVTT / SRT Subtitle Overlay */}
        {activeSubtitleText && (
          <div className="absolute bottom-8 inset-x-4 flex justify-center pointer-events-none z-20">
            <div className="max-w-3xl px-5 py-2.5 rounded-xl bg-black/80 backdrop-blur-xs border border-white/10 text-center shadow-xl">
              <p className="text-base sm:text-xl md:text-2xl font-medium text-white leading-snug whitespace-pre-line">
                {activeSubtitleText}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Popover Menus (Subtitles, Audio Tracks, Playback Speed, Series Episodes) */}
      {openPanel !== 'none' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative z-30 mx-4 sm:mx-8 mb-2 p-4 rounded-2xl bg-slate-900/95 border border-slate-700 backdrop-blur-md max-w-md ml-auto shadow-2xl"
        >
          {openPanel === 'subtitles' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-display font-semibold text-sm text-white">
                  Subtitle Tracks (SRT / WebVTT / Embedded)
                </span>
                <label className="inline-flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 font-medium cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Load .SRT / .VTT</span>
                  <input type="file" accept=".srt,.vtt" onChange={handleCustomSubUpload} className="hidden" />
                </label>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSubId('off');
                    setOpenPanel('none');
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    activeSubId === 'off' ? 'bg-rose-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Subtitles Off
                </button>
                {allSubtitles.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => {
                      setActiveSubId(sub.id);
                      setOpenPanel('none');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeSubId === sub.id ? 'bg-rose-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {openPanel === 'audio' && (
            <div className="space-y-2.5">
              <div className="border-b border-slate-800 pb-2">
                <span className="font-display font-semibold text-sm text-white">Audio Stream Track</span>
              </div>
              <div className="space-y-1">
                {episode.audioTracks.map((track, idx) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => {
                      setActiveAudioTrackIdx(idx);
                      setOpenPanel('none');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      activeAudioTrackIdx === idx ? 'bg-rose-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {track.label} · {track.channels}
                  </button>
                ))}
              </div>
            </div>
          )}

          {openPanel === 'speed' && (
            <div className="space-y-2.5">
              <div className="border-b border-slate-800 pb-2">
                <span className="font-display font-semibold text-sm text-white">Playback Speed</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => {
                      setPlaybackRate(rate);
                      setOpenPanel('none');
                    }}
                    className={`py-2 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
                      playbackRate === rate ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          )}

          {openPanel === 'episodes' && (
            <div className="space-y-2.5">
              <div className="border-b border-slate-800 pb-2">
                <span className="font-display font-semibold text-sm text-white">
                  Switch Episode ({item.episodes.length})
                </span>
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {item.episodes.map((ep) => {
                  const isCurrent = ep.id === episode.id;
                  return (
                    <button
                      key={ep.id}
                      type="button"
                      onClick={() => {
                        onSaveProgress(episode.id, currentTime, duration);
                        onSelectEpisode(ep);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                        isCurrent ? 'bg-rose-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">
                        S{String(ep.seasonNumber).padStart(2, '0')}E{String(ep.episodeNumber).padStart(2, '0')} —{' '}
                        {ep.title}
                      </span>
                      <span className="font-mono text-[11px] opacity-80 shrink-0">
                        {ep.containerFormat.toUpperCase()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Transport & Scrubber Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-20 px-4 sm:px-8 pb-5 pt-3 bg-gradient-to-t from-black/95 via-black/75 to-transparent space-y-3"
      >
        {/* Timeline Scrubber */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono tabular-nums text-slate-200 w-14 text-right">
            {formatTimecode(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={1}
            value={Math.min(duration, currentTime)}
            onChange={(e) => handleSeek( Number(e.target.value) )}
            aria-label="Seek playback timeline"
            data-focusable="true"
            className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-600"
          />
          <span className="text-xs font-mono tabular-nums text-slate-400 w-14">
            {formatTimecode(duration)}
          </span>
        </div>

        {/* Transport Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Play/Pause, -10s, +10s, Volume, Next Episode */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              data-focusable="true"
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="p-2.5 sm:px-4 sm:py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
              <span className="hidden sm:inline text-xs">{isPlaying ? 'Pause' : 'Play'}</span>
            </button>

            <button
              type="button"
              data-focusable="true"
              onClick={() => handleSeek(currentTime - 10)}
              title="Rewind 10 seconds (Left Arrow)"
              aria-label="Rewind 10 seconds"
              className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              data-focusable="true"
              onClick={() => handleSeek(currentTime + 10)}
              title="Forward 10 seconds (Right Arrow)"
              aria-label="Forward 10 seconds"
              className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 rounded-xl px-3 py-2">
              <button
                type="button"
                data-focusable="true"
                onClick={toggleMute}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                className="text-slate-200 hover:text-white cursor-pointer"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setIsMuted(false);
                  setVolume(Number(e.target.value));
                }}
                aria-label="Volume"
                className="w-16 sm:w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500 hidden sm:block"
              />
            </div>

            {nextEpisode && (
              <button
                type="button"
                data-focusable="true"
                onClick={() => {
                  onSaveProgress(episode.id, currentTime, duration);
                  onSelectEpisode(nextEpisode);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                <SkipForward className="w-4 h-4 text-rose-400" />
                <span>
                  Next: E{String(nextEpisode.episodeNumber).padStart(2, '0')}
                </span>
              </button>
            )}
          </div>

          {/* Right: Subtitles, Audio Track, Speed, Episode List, Fullscreen */}
          <div className="flex items-center gap-2">
            {/* Subtitles Button */}
            <button
              type="button"
              data-focusable="true"
              onClick={() => setOpenPanel((p) => (p === 'subtitles' ? 'none' : 'subtitles'))}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors cursor-pointer ${
                activeSubId !== 'off'
                  ? 'bg-rose-600/20 border-rose-500/50 text-rose-300'
                  : 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Subtitles className="w-4 h-4" />
              <span className="hidden md:inline">
                {activeSubId === 'off' ? 'Subs: Off' : 'Subtitles'}
              </span>
            </button>

            {/* Audio Track Switcher */}
            <button
              type="button"
              data-focusable="true"
              onClick={() => setOpenPanel((p) => (p === 'audio' ? 'none' : 'audio'))}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
            >
              <Music className="w-4 h-4" />
              <span className="hidden lg:inline">
                {episode.audioTracks[activeAudioTrackIdx]?.language.toUpperCase() || 'Audio'}
              </span>
            </button>

            {/* Playback Speed */}
            <button
              type="button"
              data-focusable="true"
              onClick={() => setOpenPanel((p) => (p === 'speed' ? 'none' : 'speed'))}
              className="inline-flex items-center gap-1 px-3 py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs font-mono font-medium text-slate-200 transition-colors cursor-pointer"
            >
              <Gauge className="w-4 h-4" />
              <span>{playbackRate}x</span>
            </button>

            {/* Series Episodes List inside Player */}
            {item.autoType === 'series' && (
              <button
                type="button"
                data-focusable="true"
                onClick={() => setOpenPanel((p) => (p === 'episodes' ? 'none' : 'episodes'))}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                <ListVideo className="w-4 h-4" />
                <span className="hidden sm:inline">Episodes</span>
              </button>
            )}

            {/* Fullscreen Toggle */}
            <button
              type="button"
              data-focusable="true"
              onClick={toggleFullscreen}
              aria-label="Toggle Fullscreen"
              className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
