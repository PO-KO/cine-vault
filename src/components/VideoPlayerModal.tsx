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
import { AudioTrack, MediaEpisode, MediaItem, SubtitleTrack } from '../types/media';
import { formatTimecode, ParsedCue, parseVttOrSrtCues } from '../utils/formatters';
import {
  feedLocalMkvToMp4RemuxSession,
  findClusterForTime,
  getMkvHeaderInfo,
  MkvHeaderInfo,
} from '../utils/mkvAudioExtractor';

interface VideoPlayerModalProps {
  item: MediaItem;
  episode: MediaEpisode;
  ffmpegAvailable: boolean;
  initialVolume?: number;
  initialMuted?: boolean;
  initialPlaybackRate?: number;
  onUpdatePlaybackPreferences?: (prefs: {
    playbackVolume?: number;
    playbackMuted?: boolean;
    playbackRate?: number;
  }) => void;
  onReconnectClientFolder?: () => Promise<boolean>;
  onClose: () => void;
  onSelectEpisode: (episode: MediaEpisode) => void;
  onSaveProgress: (episodeId: string, currentTime: number, duration: number, completed?: boolean) => void;
}

function toSafeNumber(val: unknown, fallback: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : fallback;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  item,
  episode,
  ffmpegAvailable,
  initialVolume = 0.8,
  initialMuted = false,
  initialPlaybackRate = 1,
  onUpdatePlaybackPreferences,
  onReconnectClientFolder,
  onClose,
  onSelectEpisode,
  onSaveProgress,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState<number>(() =>
    Math.max(0, toSafeNumber(episode.progress.currentTime, 0))
  );
  const [duration, setDuration] = useState<number>(() =>
    Math.max(1, toSafeNumber(episode.progress.duration || episode.estimatedDurationSec, 1440))
  );
  const [volume, setVolume] = useState<number>(() =>
    Math.max(0, Math.min(1, toSafeNumber(initialVolume, 0.8)))
  );
  const [isMuted, setIsMuted] = useState<boolean>(Boolean(initialMuted));
  const [playbackRate, setPlaybackRate] = useState<number>(() =>
    Math.max(0.25, toSafeNumber(initialPlaybackRate, 1))
  );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [networkStalled, setNetworkStalled] = useState<boolean>(false);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });

  // Live MKV -> MP4 Remux Stream state (plays MKV directly as video/mp4 inside <video>)
  const [probedAudioTracks, setProbedAudioTracks] = useState<AudioTrack[] | null>(null);
  const [remuxStreamUrl, setRemuxStreamUrl] = useState<string | null>(null);
  const [isRemuxStarting, setIsRemuxStarting] = useState<boolean>(false);
  const [serverRemuxStartSec, setServerRemuxStartSec] = useState<number>(0);

  // Timeline interactive scrubbing & hover state
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<{ time: number; percent: number } | null>(null);
  const [bufferedEndSec, setBufferedEndSec] = useState<number>(0);

  const clientBlobCacheRef = useRef<Blob | null>(null);
  const mkvHeaderRef = useRef<MkvHeaderInfo | null>(null);
  const remuxAbortRef = useRef<AbortController | null>(null);
  const remuxBaseTimeRef = useRef<number>(0);
  const isSeekingRef = useRef<boolean>(false);
  const seekDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrubbingRef = useRef<boolean>(false);
  const scrubValueRef = useRef<number | null>(null);

  const isLocalMkvOrAvi = useMemo(() => {
    if (episode.isSampleSynthetic) return false;
    const hasLocalSource = Boolean(episode.clientFile || episode.clientBlobUrl);
    if (!hasLocalSource) return false;
    return (
      episode.containerFormat === 'mkv' ||
      episode.containerFormat === 'avi' ||
      /\.mkv$|\.avi$/i.test(episode.fileName)
    );
  }, [episode]);

  const effectiveAudioTracks = useMemo(
    () => (probedAudioTracks && probedAudioTracks.length > 0 ? probedAudioTracks : episode.audioTracks),
    [probedAudioTracks, episode.audioTracks]
  );

  const resolveEpisodeClientBlob = useCallback(async (): Promise<Blob | null> => {
    if (episode.clientFile) return episode.clientFile;
    if (clientBlobCacheRef.current) return clientBlobCacheRef.current;
    if (episode.clientBlobUrl) {
      try {
        const res = await fetch(episode.clientBlobUrl);
        if (res.ok) {
          const b = await res.blob();
          clientBlobCacheRef.current = b;
          return b;
        }
      } catch {}
    }
    return null;
  }, [episode.clientFile, episode.clientBlobUrl]);

  const stopRemuxSession = useCallback(() => {
    if (seekDebounceTimerRef.current) {
      clearTimeout(seekDebounceTimerRef.current);
      seekDebounceTimerRef.current = null;
    }
    if (remuxAbortRef.current) {
      remuxAbortRef.current.abort();
      remuxAbortRef.current = null;
    }
  }, []);

  const scheduleFullscreenControlsHide = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      setShowControls(false);
      setOpenPanel('none');
    }, 3000);
  }, []);

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

  // Start or seek a live MKV -> MP4 remux session for <video>
  const startLocalMkvRemuxStream = useCallback(
    async (targetSec: number, trackIdx: number) => {
      stopRemuxSession();
      isSeekingRef.current = true;
      setIsRemuxStarting(true);
      remuxBaseTimeRef.current = targetSec;
      setCurrentTime(targetSec);

      const controller = new AbortController();
      remuxAbortRef.current = controller;

      const blob = await resolveEpisodeClientBlob();
      if (!blob || controller.signal.aborted) {
        isSeekingRef.current = false;
        setIsRemuxStarting(false);
        return;
      }

      let header = mkvHeaderRef.current;
      if (!header && episode.containerFormat !== 'avi') {
        header = await getMkvHeaderInfo(blob);
        if (controller.signal.aborted) return;
        mkvHeaderRef.current = header;
        if (header) {
          if (header.audioTracks.length > 0) {
            setProbedAudioTracks(header.audioTracks);
          }
          if (header.durationSec && header.durationSec > 5) {
            setDuration(header.durationSec);
          }
        }
      }

      let startByteOffset = 0;
      let actualStartSec = 0;

      if (header) {
        if (targetSec > 1.5) {
          const found = await findClusterForTime(blob, header, targetSec);
          if (controller.signal.aborted) return;
          startByteOffset = found.byteOffset;
          actualStartSec = found.startTimeSec;
        } else {
          startByteOffset = 0;
          actualStartSec = 0;
        }
      }

      remuxBaseTimeRef.current = actualStartSec;

      const sessionId = `mp4-${episode.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const isHevc = Boolean(header?.isHevc);
      const isAvi = episode.containerFormat === 'avi' || /\.avi$/i.test(episode.fileName);

      // Start feeding the local MKV/AVI chunks into /api/remux-mp4
      feedLocalMkvToMp4RemuxSession({
        sessionId,
        file: blob,
        header,
        startByteOffset,
        audioTrackIndex: trackIdx,
        isHevc,
        isAvi,
        signal: controller.signal,
      });

      const url = `/api/remux-mp4?sessionId=${encodeURIComponent(
        sessionId
      )}&audioTrack=${trackIdx}&isHevc=${isHevc ? '1' : '0'}&isAvi=${isAvi ? '1' : '0'}`;

      setRemuxStreamUrl(url);
      setIsPlaying(true);
    },
    [episode.id, episode.containerFormat, episode.fileName, resolveEpisodeClientBlob, stopRemuxSession]
  );

  // Reset state and launch stream when switching episodes
  useEffect(() => {
    stopRemuxSession();
    clientBlobCacheRef.current = null;
    mkvHeaderRef.current = null;
    remuxBaseTimeRef.current = 0;
    isSeekingRef.current = false;
    isScrubbingRef.current = false;
    setIsScrubbing(false);
    setScrubTime(null);
    setBufferedEndSec(0);
    setServerRemuxStartSec(0);
    setProbedAudioTracks(null);
    setRemuxStreamUrl(null);
    setIsRemuxStarting(false);

    const initialTime = Math.max(0, toSafeNumber(episode.progress.currentTime, 0));
    setCurrentTime(initialTime);
    setDuration(
      Math.max(1, toSafeNumber(episode.progress.duration || episode.estimatedDurationSec, 1440))
    );
    setActiveSubId(episode.subtitles[0]?.id || 'off');
    setActiveAudioTrackIdx(0);
    setOpenPanel('none');
    setIsPlaying(true);

    if (isLocalMkvOrAvi) {
      startLocalMkvRemuxStream(initialTime, 0);
    } else if (episode.requiresRemux && initialTime > 2) {
      remuxBaseTimeRef.current = initialTime;
      setServerRemuxStartSec(initialTime);
    }

    return () => {
      stopRemuxSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id]);

  // Restart MP4 remux stream when user switches audio tracks on a local MKV/AVI file
  const prevAudioTrackRef = useRef<number>(0);
  useEffect(() => {
    if (prevAudioTrackRef.current === activeAudioTrackIdx) return;
    prevAudioTrackRef.current = activeAudioTrackIdx;

    if (isLocalMkvOrAvi) {
      startLocalMkvRemuxStream(currentTimeRef.current || 0, activeAudioTrackIdx);
    }
  }, [activeAudioTrackIdx, isLocalMkvOrAvi, startLocalMkvRemuxStream]);

  // Sync with browser fullscreenchange events
  useEffect(() => {
    const onFullscreenChange = () => {
      const activeFs = Boolean(document.fullscreenElement);
      setIsFullscreen(activeFs);
      if (activeFs) {
        scheduleFullscreenControlsHide();
      } else {
        if (hideControlsTimerRef.current) {
          clearTimeout(hideControlsTimerRef.current);
        }
        setShowControls(true);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [scheduleFullscreenControlsHide]);

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

  // Active subtitle cue for current timestamp
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
    if (!isPlaying) return;
    const interval = setInterval(() => {
      if (currentTimeRef.current > 0) {
        onSaveProgress(episode.id, currentTimeRef.current, durationRef.current);
      }
    }, 8000);

    return () => {
      clearInterval(interval);
    };
  }, [episode.id, isPlaying, onSaveProgress]);

  useEffect(() => {
    return () => {
      if (currentTimeRef.current > 0) {
        onSaveProgress(episode.id, currentTimeRef.current, durationRef.current);
      }
    };
  }, [episode.id, onSaveProgress]);

  // WebAudio Ambient Soundtrack Synthesizer for built-in synthetic sample MKV/MP4 files
  const synthCtxRef = useRef<AudioContext | null>(null);
  const synthGainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    if (!episode.isSampleSynthetic) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx: AudioContext = new AudioCtx();
    synthCtxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = isPlaying && !isMuted ? volume * 0.18 : 0;
    masterGain.connect(ctx.destination);
    synthGainRef.current = masterGain;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 650;
    filter.connect(masterGain);

    const baseChord =
      episode.visualTheme === 'cyber_anime'
        ? [146.83, 220.0, 261.63, 329.63]
        : episode.visualTheme === 'fantasy_anime'
        ? [130.81, 196.0, 246.94, 293.66]
        : episode.visualTheme === 'scifi_cosmos'
        ? [110.0, 164.81, 220.0, 246.94]
        : [123.47, 185.0, 220.0, 277.18];

    const pitchShift = activeAudioTrackIdx > 0 ? 1.12246 : 1;
    const oscillators: OscillatorNode[] = [];

    baseChord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq * pitchShift;
      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.25 / baseChord.length;
      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start();
      oscillators.push(osc);
    });

    return () => {
      oscillators.forEach((o) => {
        try {
          o.stop();
        } catch {}
      });
      ctx.close().catch(() => {});
      synthCtxRef.current = null;
      synthGainRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id, episode.isSampleSynthetic, episode.visualTheme, activeAudioTrackIdx]);

  // Sync WebAudio synthesizer volume/mute/play state
  useEffect(() => {
    if (!episode.isSampleSynthetic) return;
    const ctx = synthCtxRef.current;
    const gainNode = synthGainRef.current;
    if (!ctx || !gainNode) return;

    if (isPlaying && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const targetGain = isPlaying && !isMuted ? volume * 0.18 : 0;
    gainNode.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.08);
  }, [episode.isSampleSynthetic, isPlaying, isMuted, volume]);

  // Synthetic Canvas Playback Engine for built-in sample media files
  useEffect(() => {
    if (!episode.isSampleSynthetic) return;

    let animationFrameId: number;
    let lastTimestamp = performance.now();

    const tick = (now: number) => {
      const deltaSec = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      if (isPlaying) {
        setCurrentTime((prev) => {
          const safePrev = toSafeNumber(prev, 0);
          const safeDur = Math.max(1, toSafeNumber(duration, 1440));
          const safeRate = Math.max(0.25, toSafeNumber(playbackRate, 1));
          const safeDelta = Number.isFinite(deltaSec) && deltaSec >= 0 ? deltaSec : 0;
          const next = safePrev + safeDelta * safeRate;
          if (next >= safeDur) {
            setIsPlaying(false);
            onSaveProgress(episode.id, safeDur, safeDur, true);
            return safeDur;
          }
          return next;
        });
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          const t = currentTimeRef.current;

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

          ctx.save();
          ctx.translate(w / 2, h / 2 - 20);
          const pulse = 1 + Math.sin(t * 1.8) * 0.04;
          ctx.scale(pulse, pulse);

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

          ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
          ctx.beginPath();
          ctx.arc(0, 0, 95, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

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
          const activeAudioLabel = effectiveAudioTracks[activeAudioTrackIdx]?.label || 'Stereo AAC';
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
    effectiveAudioTracks,
    onSaveProgress,
  ]);

  // Real HTML5 <video> element sync (both native MP4 and remuxed MKV->MP4 streams play directly in <video>)
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || episode.isSampleSynthetic) return;

    vid.muted = isMuted;
    vid.volume = isMuted ? 0 : Math.max(0, Math.min(1, toSafeNumber(volume, 0.8)));
    vid.playbackRate = Math.max(0.25, toSafeNumber(playbackRate, 1));

    if (isPlaying && vid.paused && vid.src) {
      vid.play().catch(() => setIsPlaying(false));
    } else if (!isPlaying && !vid.paused) {
      vid.pause();
    }
  }, [isPlaying, volume, isMuted, playbackRate, episode.isSampleSynthetic, remuxStreamUrl]);

  const handleSeek = useCallback(
    (nextSec: number) => {
      if (!Number.isFinite(nextSec)) return;
      const effectiveDur = Math.max(1, toSafeNumber(durationRef.current || duration, 1440));
      const clamped = Math.max(0, Math.min(effectiveDur, nextSec));
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);

      if (isLocalMkvOrAvi) {
        const vid = videoRef.current;
        const offsetInStream = clamped - remuxBaseTimeRef.current;

        // Check if target timestamp is already buffered inside the current remuxed MP4 stream
        let isBuffered = false;
        if (vid && !isSeekingRef.current && offsetInStream >= 0) {
          for (let i = 0; i < vid.buffered.length; i++) {
            if (
              offsetInStream >= vid.buffered.start(i) &&
              offsetInStream <= vid.buffered.end(i) - 0.35
            ) {
              isBuffered = true;
              break;
            }
          }
        }

        if (vid && isBuffered) {
          vid.currentTime = offsetInStream;
        } else {
          isSeekingRef.current = true;
          if (seekDebounceTimerRef.current) {
            clearTimeout(seekDebounceTimerRef.current);
          }
          seekDebounceTimerRef.current = setTimeout(() => {
            seekDebounceTimerRef.current = null;
            startLocalMkvRemuxStream(clamped, activeAudioTrackIdx);
          }, 80);
        }
      } else if (episode.requiresRemux && !episode.isSampleSynthetic && !episode.clientBlobUrl) {
        remuxBaseTimeRef.current = clamped;
        setServerRemuxStartSec(clamped);
      } else if (videoRef.current && !episode.isSampleSynthetic) {
        videoRef.current.currentTime = clamped;
      }

      onSaveProgress(episode.id, clamped, effectiveDur);
    },
    [
      duration,
      episode.id,
      episode.isSampleSynthetic,
      episode.requiresRemux,
      episode.clientBlobUrl,
      isLocalMkvOrAvi,
      activeAudioTrackIdx,
      startLocalMkvRemuxStream,
      onSaveProgress,
    ]
  );

  const togglePlayPause = useCallback(() => {
    const vid = videoRef.current;
    if (vid && !episode.isSampleSynthetic) {
      if (vid.paused) {
        vid
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      } else {
        vid.pause();
        setIsPlaying(false);
        if (currentTimeRef.current > 0) {
          onSaveProgress(episode.id, currentTimeRef.current, durationRef.current);
        }
      }
    } else {
      setIsPlaying((prev) => {
        const next = !prev;
        if (!next && currentTimeRef.current > 0) {
          onSaveProgress(episode.id, currentTimeRef.current, durationRef.current);
        }
        return next;
      });
    }
  }, [episode.id, episode.isSampleSynthetic, onSaveProgress]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const enterFullscreenState = useCallback(() => {
    setIsFullscreen(true);
    scheduleFullscreenControlsHide();
  }, [scheduleFullscreenControlsHide]);

  const exitFullscreenState = useCallback(() => {
    setIsFullscreen(false);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    setShowControls(true);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!isFullscreen && !document.fullscreenElement) {
      enterFullscreenState();
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      }
    } else {
      exitFullscreenState();
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [isFullscreen, enterFullscreenState, exitFullscreenState]);

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

      if (isFullscreen) {
        scheduleFullscreenControlsHide();
      }

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
          } else if (isFullscreen) {
            exitFullscreenState();
            if (document.fullscreenElement && document.exitFullscreen) {
              document.exitFullscreen().catch(() => {});
            }
          } else {
            onClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    togglePlayPause,
    handleSeek,
    toggleMute,
    toggleFullscreen,
    cycleSubtitles,
    openPanel,
    isFullscreen,
    scheduleFullscreenControlsHide,
    exitFullscreenState,
    onClose,
  ]);

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

  // Sync playback preferences (volume, mute, speed) when changed
  useEffect(() => {
    if (onUpdatePlaybackPreferences) {
      onUpdatePlaybackPreferences({
        playbackVolume: volume,
        playbackMuted: isMuted,
        playbackRate,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, isMuted, playbackRate]);

  // Auto-resume stream when network connection recovers
  useEffect(() => {
    const onOnline = () => {
      if (networkStalled) {
        setNetworkStalled(false);
        handleSeek(currentTimeRef.current);
      }
    };
    const onOffline = () => {
      setNetworkStalled(true);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [networkStalled, handleSeek]);

  const needsClientFileRebind = Boolean(
    item.isClientPickedFolder &&
      !episode.isSampleSynthetic &&
      !episode.clientFile &&
      !episode.clientBlobUrl
  );

  // For local MKV/AVI files, streamUrl is the live MP4 remux endpoint (/api/remux-mp4)
  const streamUrl = needsClientFileRebind
    ? undefined
    : isLocalMkvOrAvi
    ? remuxStreamUrl || undefined
    : episode.clientBlobUrl ||
      `/api/stream/${episode.id}?audioTrack=${activeAudioTrackIdx}&remux=${
        episode.requiresRemux ? '1' : '0'
      }${serverRemuxStartSec > 0 ? `&start=${serverRemuxStartSec}` : ''}`;

  const safeDuration = Math.max(1, toSafeNumber(duration, 1440));
  const safeCurrentTime = Math.max(0, toSafeNumber(currentTime, 0));
  const safeScrubTime =
    scrubTime !== null && Number.isFinite(scrubTime) ? Math.max(0, scrubTime) : null;
  const displayedTime = isScrubbing && safeScrubTime !== null ? safeScrubTime : safeCurrentTime;
  const safeBufferedEnd = Math.max(0, toSafeNumber(bufferedEndSec, 0));
  const safeVolume = Math.max(0, Math.min(1, toSafeNumber(volume, 0.8)));
  const progressPercent = Math.min(100, Math.max(0, (displayedTime / safeDuration) * 100));
  const bufferedPercent = Math.min(100, Math.max(0, (safeBufferedEnd / safeDuration) * 100));

  // In fullscreen mode, controls hide after 3 seconds and reappear when the mouse moves
  const controllersVisible = isFullscreen ? showControls : true;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${item.title} - ${episode.title}`}
      onMouseMove={(e) => {
        if (
          e.clientX === lastMousePosRef.current.x &&
          e.clientY === lastMousePosRef.current.y
        ) {
          return;
        }
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        if (isFullscreen) {
          scheduleFullscreenControlsHide();
        }
      }}
      className={`fixed inset-0 z-50 w-screen h-screen bg-black text-white select-none overflow-hidden ${
        isFullscreen && !showControls ? 'cursor-none' : ''
      }`}
    >
      {/* Full-Screen Video / Canvas Viewport (Always 100% of screen width & height) */}
      <div
        onClick={() => {
          if (isFullscreen) {
            scheduleFullscreenControlsHide();
          }
          if (openPanel !== 'none') {
            setOpenPanel('none');
          } else {
            togglePlayPause();
          }
        }}
        onDoubleClick={toggleFullscreen}
        className={`
          absolute inset-0 w-full h-full flex items-center justify-center bg-black overflow-hidden
          ${isFullscreen && !showControls ? 'cursor-none' : 'cursor-pointer'}
        `}
      >
        {episode.isSampleSynthetic ? (
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className={`w-full h-full ${isFullscreen ? 'object-cover' : 'object-contain'}`}
          />
        ) : (
          <video
            ref={videoRef}
            src={streamUrl}
            className="w-full h-full object-contain"
            playsInline
            autoPlay
            onPlay={() => {
              setIsPlaying(true);
              setIsRemuxStarting(false);
              setNetworkStalled(false);
            }}
            onPlaying={() => {
              setIsPlaying(true);
              setIsRemuxStarting(false);
              setNetworkStalled(false);
              isSeekingRef.current = false;
            }}
            onCanPlay={() => {
              setIsRemuxStarting(false);
              setNetworkStalled(false);
              isSeekingRef.current = false;
            }}
            onPause={() => {
              setIsPlaying(false);
            }}
            onStalled={() => {
              if (!isSeekingRef.current) {
                setNetworkStalled(true);
              }
            }}
            onError={() => {
              if (!needsClientFileRebind && streamUrl) {
                setNetworkStalled(true);
              }
            }}
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
              setIsRemuxStarting(false);
              setNetworkStalled(false);
              isSeekingRef.current = false;
              const isRemuxedStream = isLocalMkvOrAvi || Boolean(episode.requiresRemux && !episode.clientBlobUrl);

              if (!isRemuxedStream && vid.duration && Number.isFinite(vid.duration) && vid.duration > 1) {
                setDuration(vid.duration);
              } else if (isRemuxedStream && vid.duration && Number.isFinite(vid.duration) && vid.duration > durationRef.current) {
                setDuration(vid.duration);
              }

              if (
                !isRemuxedStream &&
                episode.progress.currentTime > 0 &&
                episode.progress.currentTime < vid.duration
              ) {
                vid.currentTime = episode.progress.currentTime;
              }
            }}
            onDurationChange={(e) => {
              const vid = e.currentTarget;
              const isRemuxedStream = isLocalMkvOrAvi || Boolean(episode.requiresRemux && !episode.clientBlobUrl);
              if (!isRemuxedStream && vid.duration && Number.isFinite(vid.duration) && vid.duration > 1) {
                setDuration(vid.duration);
              }
            }}
            onProgress={(e) => {
              const vid = e.currentTarget;
              if (vid.buffered.length > 0) {
                const rawEnd = vid.buffered.end(vid.buffered.length - 1);
                if (!Number.isFinite(rawEnd)) return;
                const isRemuxedStream = isLocalMkvOrAvi || Boolean(episode.requiresRemux && !episode.clientBlobUrl);
                const baseSec = toSafeNumber(remuxBaseTimeRef.current, 0);
                setBufferedEndSec(isRemuxedStream ? baseSec + rawEnd : rawEnd);
              }
            }}
            onTimeUpdate={(e) => {
              const vid = e.currentTarget;
              if (isSeekingRef.current || isScrubbingRef.current) return;
              if (!Number.isFinite(vid.currentTime)) return;

              const isRemuxedStream = isLocalMkvOrAvi || Boolean(episode.requiresRemux && !episode.clientBlobUrl);
              const baseSec = toSafeNumber(remuxBaseTimeRef.current, 0);
              const nextT = isRemuxedStream ? baseSec + vid.currentTime : vid.currentTime;
              if (!Number.isFinite(nextT) || nextT < 0) return;
              setCurrentTime(nextT);

              if (nextT > toSafeNumber(durationRef.current, 1440)) {
                setDuration(nextT + 30);
              }

              if (vid.buffered.length > 0) {
                const rawEnd = vid.buffered.end(vid.buffered.length - 1);
                if (Number.isFinite(rawEnd)) {
                  setBufferedEndSec(isRemuxedStream ? baseSec + rawEnd : rawEnd);
                }
              }
            }}
            onEnded={() => {
              setIsPlaying(false);
              onSaveProgress(episode.id, durationRef.current, durationRef.current, true);
            }}
          />
        )}

        {/* Reconnect Browser Folder Overlay (after browser restart when FileSystemDirectoryHandle needs 1-click read permission) */}
        {needsClientFileRebind && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-6"
          >
            <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-slate-700 text-center space-y-4 shadow-2xl">
              <h3 className="font-display font-bold text-lg text-white">
                Reconnect Local Media Folder to Resume Playback
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your library and saved position (<span className="font-mono text-rose-400">{formatTimecode(currentTime)}</span>) were restored from storage. After a browser restart, click below to re-grant read access to your local folder so video streaming can start immediately.
              </p>
              <div className="flex items-center justify-center gap-3 pt-1">
                {onReconnectClientFolder && (
                  <button
                    type="button"
                    onClick={async () => {
                      await onReconnectClientFolder();
                    }}
                    className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    Grant Folder Access &amp; Play
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Network Stall / Disconnection Recovery Banner */}
        {networkStalled && !needsClientFileRebind && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-amber-500/40 text-xs text-amber-200 shadow-xl"
          >
            <span>Network stream interrupted at {formatTimecode(currentTime)}</span>
            <button
              type="button"
              onClick={() => {
                setNetworkStalled(false);
                handleSeek(currentTimeRef.current);
              }}
              className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold cursor-pointer"
            >
              Resume Stream
            </button>
          </div>
        )}

        {/* Active WebVTT / SRT Subtitle Overlay */}
        {activeSubtitleText && (
          <div
            className={`absolute inset-x-4 flex justify-center pointer-events-none z-20 transition-all duration-200 ${
              controllersVisible ? 'bottom-28' : 'bottom-8'
            }`}
          >
            <div className="max-w-3xl px-5 py-2.5 rounded-xl bg-black/80 backdrop-blur-xs border border-white/10 text-center shadow-xl">
              <p className="text-base sm:text-xl md:text-4xl font-medium text-white leading-snug whitespace-pre-line">
                {activeSubtitleText}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Top Overlay Header (Hidden in Fullscreen Mode after 3s) */}
      {controllersVisible && (
        <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-4 px-4 sm:px-8 py-4 bg-gradient-to-b from-black/90 via-black/50 to-transparent">
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
            {(episode.requiresRemux || isLocalMkvOrAvi) && (
              <span className="hidden md:inline-block text-xs font-mono text-amber-300 px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30">
                {isLocalMkvOrAvi
                  ? isRemuxStarting
                    ? 'Remuxing MKV → MP4 Stream…'
                    : `MKV → MP4 Live Stream (Stereo AAC)`
                  : ffmpegAvailable
                  ? 'FFmpeg fMP4 Remux Stream'
                  : `${episode.containerFormat.toUpperCase()} Direct Stream`}
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
      )}

      {/* Popover Menus (Subtitles, Audio Tracks, Playback Speed, Series Episodes) */}
      {controllersVisible && openPanel !== 'none' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-28 right-4 sm:right-8 z-30 p-4 rounded-2xl bg-slate-900/95 border border-slate-700 backdrop-blur-md w-full max-w-md shadow-2xl"
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
                {effectiveAudioTracks.map((track, idx) => (
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

      {/* Bottom Transport & Scrubber Bar (Hidden in Fullscreen Mode after 3s) */}
      {controllersVisible && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 inset-x-0 z-20 px-4 sm:px-8 pb-5 pt-3 bg-gradient-to-t from-black/95 via-black/75 to-transparent space-y-3"
        >
          {/* Timeline Scrubber */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-slate-200 min-w-[4rem] text-right">
              {formatTimecode(displayedTime)}
            </span>

            <div
              className="relative flex-1 flex items-center h-6 group cursor-pointer"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width <= 0) return;
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                setHoverTime({
                  time: ratio * Math.max(1, duration),
                  percent: ratio * 100,
                });
              }}
              onMouseLeave={() => setHoverTime(null)}
            >
              {/* Hover Timecode Preview Pill */}
              {hoverTime && (
                <div
                  style={{ left: `${Math.max(4, Math.min(96, hoverTime.percent))}%` }}
                  className="absolute -top-8 -translate-x-1/2 px-2 py-0.5 rounded bg-slate-900/95 border border-slate-700 text-[11px] font-mono tabular-nums text-white pointer-events-none shadow-lg whitespace-nowrap"
                >
                  {formatTimecode(hoverTime.time)}
                </div>
              )}

              {/* Track Background */}
              <div className="w-full h-1.5 group-hover:h-2 bg-slate-700/80 rounded-full overflow-hidden transition-all relative">
                {/* Buffered Bar */}
                <div
                  style={{ width: `${bufferedPercent}%` }}
                  className="absolute inset-y-0 left-0 bg-slate-400/35 rounded-full transition-all duration-150"
                />
                {/* Played Progress Fill */}
                <div
                  style={{ width: `${progressPercent}%` }}
                  className="absolute inset-y-0 left-0 bg-rose-600 rounded-full"
                />
              </div>

              {/* Scrubber Thumb Handle */}
              <div
                style={{ left: `${progressPercent}%` }}
                className="
                  absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-rose-500 ring-2 ring-white shadow-md
                  pointer-events-none transition-transform group-hover:scale-125
                "
              />

              {/* Interactive Range Input Overlay */}
              <input
                type="range"
                min={0}
                max={safeDuration}
                step={0.5}
                value={Math.min(safeDuration, Math.max(0, displayedTime))}
                onPointerDown={() => {
                  isScrubbingRef.current = true;
                  scrubValueRef.current = null;
                  setIsScrubbing(true);
                }}
                onChange={(e) => {
                  const val = toSafeNumber(e.target.value, displayedTime);
                  scrubValueRef.current = val;
                  if (isScrubbingRef.current) {
                    setScrubTime(val);
                  } else {
                    handleSeek(val);
                  }
                }}
                onPointerUp={(e) => {
                  const fallbackVal = toSafeNumber(
                    (e.currentTarget as HTMLInputElement).value,
                    displayedTime
                  );
                  const finalVal =
                    scrubValueRef.current !== null && Number.isFinite(scrubValueRef.current)
                      ? scrubValueRef.current
                      : fallbackVal;
                  isScrubbingRef.current = false;
                  scrubValueRef.current = null;
                  setIsScrubbing(false);
                  setScrubTime(null);
                  handleSeek(finalVal);
                }}
                onPointerCancel={() => {
                  isScrubbingRef.current = false;
                  scrubValueRef.current = null;
                  setIsScrubbing(false);
                  setScrubTime(null);
                }}
                aria-label="Seek playback timeline"
                data-focusable="true"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
            </div>

            <span className="text-xs font-mono tabular-nums text-slate-400 min-w-[4rem]">
              {formatTimecode(safeDuration)}
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
                onClick={() => handleSeek(currentTimeRef.current - 10)}
                title="Rewind 10 seconds (Left Arrow)"
                aria-label="Rewind 10 seconds"
                className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                data-focusable="true"
                onClick={() => handleSeek(currentTimeRef.current + 10)}
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
                  value={isMuted ? 0 : safeVolume}
                  onChange={(e) => {
                    setIsMuted(false);
                    setVolume(Math.max(0, Math.min(1, toSafeNumber(e.target.value, 0.8))));
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
                  {effectiveAudioTracks[activeAudioTrackIdx]?.language.toUpperCase() || 'Audio'}
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
                title="Full Screen (F or Double Click)"
                className="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors cursor-pointer"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
