/**
 * Hook to get YouTube video duration using YouTube IFrame API
 * Loads the API dynamically and creates a headless player
 */

import { useState, useEffect } from 'react';
import { extractYouTubeId } from '@/lib/utils';

declare global {
  interface Window {
    YT: {
      Player: new (elementId: string, config: {
        videoId: string;
        events: {
          onReady: (event: { target: YTPlayer }) => void;
          onError: (event: { data: number }) => void;
        };
      }) => YTPlayer;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }

  interface YTPlayer {
    getDuration: () => number;
    getVideoData: () => {
      title: string;
      author: string;
    };
    destroy: () => void;
  }
}

let apiLoaded = false;
let apiLoading = false;
const apiLoadCallbacks: (() => void)[] = [];

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (apiLoaded) {
      resolve();
      return;
    }

    apiLoadCallbacks.push(() => resolve());

    if (apiLoading) return;
    apiLoading = true;

    // Create script tag
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    
    // Set up callback
    window.onYouTubeIframeAPIReady = () => {
      apiLoaded = true;
      apiLoading = false;
      apiLoadCallbacks.forEach(cb => cb());
      apiLoadCallbacks.length = 0;
    };

    document.head.appendChild(tag);
  });
}

export function useYouTubeDuration(url: string | null) {
  const [duration, setDuration] = useState<number | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setDuration(null);
      setTitle(null);
      setError(null);
      return;
    }

    const videoId = extractYouTubeId(url);
    if (!videoId) {
      setError('Invalid YouTube URL');
      return;
    }

    let player: YTPlayer | null = null;
    let mounted = true;

    const loadVideo = async () => {
      setLoading(true);
      setError(null);

      try {
        // Load YouTube API
        await loadYouTubeAPI();

        if (!mounted) return;

        // Create hidden player container
        const containerId = `yt-player-${Date.now()}`;
        const container = document.createElement('div');
        container.id = containerId;
        container.style.display = 'none';
        document.body.appendChild(container);

        // Create player
        player = new window.YT.Player(containerId, {
          videoId,
          events: {
            onReady: (event) => {
              if (!mounted) return;
              
              try {
                const videoDuration = event.target.getDuration();
                const videoData = event.target.getVideoData();
                
                setDuration(videoDuration);
                setTitle(videoData.title);
                setLoading(false);
              } catch {
                setError('Failed to get video information');
                setLoading(false);
              }
            },
            onError: (event) => {
              if (!mounted) return;
              
              const errorMessages: Record<number, string> = {
                2: 'Invalid video ID',
                5: 'HTML5 player error',
                100: 'Video not found or private',
                101: 'Video not available',
                150: 'Video not available',
              };
              
              setError(errorMessages[event.data] || 'Failed to load video');
              setLoading(false);
            },
          },
        });
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load YouTube API');
          setLoading(false);
        }
      }
    };

    loadVideo();

    return () => {
      mounted = false;
      if (player) {
        try {
          player.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [url]);

  return { duration, title, loading, error };
}

