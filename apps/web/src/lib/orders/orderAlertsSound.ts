export const CHIME_FREQUENCIES = [880, 660] as const;

export const CHIME_TONE_GAP_SECONDS = 0.15;

export interface OrderChimeApi {
  close: () => void;
  play: () => boolean;
}

type AudioContextConstructor = typeof AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return ctor ?? null;
}

export function createOrderChimeApi(): OrderChimeApi | null {
  const Ctor = audioContextConstructor();
  if (Ctor === null) return null;
  try {
    const context = new Ctor();
    return {
      close: () => {
        if (context.state !== 'closed') {
          try {
            void context.close();
          } catch {
            // AudioContext já fechado ou sem suporte — sem ação necessária.
          }
        }
      },
      play: () => playOrderChime(context),
    };
  } catch {
    return null;
  }
}

export function playOrderChime(context: AudioContext): boolean {
  try {
    if (context.state === 'suspended') {
      void context.resume();
    }
    const start = context.currentTime;
    CHIME_FREQUENCIES.forEach((frequency, index) => {
      const toneStart = start + index * CHIME_TONE_GAP_SECONDS;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, toneStart);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.2, toneStart + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneStart + 0.14);
    });
    return true;
  } catch {
    return false;
  }
}
