// Each voice is [delay, frequency, duration, gain, waveform, final frequency].
const EFFECTS = {
  mote_picked: [[0, 880, 0.085, 0.12], [0.054, 1320, 0.16, 0.08]],
  deposit: [[0, 330, 0.18, 0.13, 'triangle'], [0.075, 440, 0.2, 0.08]],
  lantern_lit: [[0, 392, 0.42, 0.17], [0.09, 587, 0.45, 0.14], [0.2, 784, 0.62, 0.12]],
  pulse: [[0, 156, 0.48, 0.24, 'sine', 48], [0.036, 426, 0.34, 0.09, 'triangle', 115]],
  player_hit: [[0, 138, 0.34, 0.19, 'triangle', 47], [0.04, 96, 0.2, 0.1, 'sawtooth', 60]],
  jump: [[0, 260, 0.18, 0.11, 'triangle', 490]],
  launch_pad: [[0, 180, 0.26, 0.13, 'triangle', 690], [0.1, 510, 0.18, 0.075, 'sine', 880]],
  dash: [[0, 220, 0.18, 0.13, 'triangle', 72], [0.015, 490, 0.15, 0.055, 'sine', 150]],
  shade_spawn: [[0, 70, 0.49, 0.14, 'sine', 102], [0.1, 110, 0.43, 0.085, 'triangle', 68]],
  charm_picked: [[0, 659, 0.28, 0.11], [0.09, 988, 0.4, 0.11], [0.16, 1318, 0.4, 0.06]],
  drifter_steal: [[0, 512, 0.2, 0.11, 'triangle', 166]],
  drifter_drop: [[0, 660, 0.16, 0.12], [0.06, 990, 0.24, 0.09]],
  countdown: [[0, 560, 0.13, 0.1, 'triangle']],
  countdown_last: [[0, 880, 0.17, 0.14, 'triangle']],
  won: [[0, 392, 0.58, 0.15], [0.14, 494, 0.55, 0.13], [0.29, 587, 0.68, 0.14], [0.47, 784, 0.84, 0.14]],
  lost: [[0, 330, 0.5, 0.13], [0.19, 247, 0.59, 0.12], [0.38, 165, 0.74, 0.13, 'triangle']],
};

const ROOTS = [146.83, 130.81, 164.81];
const MELODY = [12, null, 19, 17, null, 15, null, 12, 7, null, 10, null];

export function createAudio(initialVolume) {
  let context;
  let master;
  let ambience;
  let volume = initialVolume;
  let night = 1;
  let musicEnabled = false;
  let scheduleInterval;
  let nextBeat = 0;
  let beat = 0;

  function tone(bus, at, hz, duration, gain, type = 'sine', endHz = hz, attack = 0.018) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, at);
    if (endHz !== hz) oscillator.frequency.exponentialRampToValueAtTime(endHz, at + duration * 0.83);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope).connect(bus);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
  }

  function schedule() {
    const now = context.currentTime;
    if (context.state !== 'running') return;
    if (nextBeat < now) nextBeat = now + 0.03;
    while (nextBeat < now + 0.2) {
      const root = ROOTS[night - 1];
      const note = MELODY[beat % MELODY.length];
      if (beat % 6 === 0) {
        tone(ambience, nextBeat, root / 2, 2.9, 0.092, 'sine', root / 2, 0.56);
        tone(ambience, nextBeat, root * 1.5, 2.6, 0.035, 'sine', root * 1.5, 0.79);
      }
      if (note !== null) tone(ambience, nextBeat, root * 2 ** (note / 12), 0.97, 0.055, 'sine', undefined, 0.045);
      nextBeat += 0.51;
      beat++;
    }
  }

  function refreshMusic() {
    if (!context) return;
    ambience.gain.setTargetAtTime(musicEnabled ? 0.54 : 0, context.currentTime, 0.06);
    if (musicEnabled && context.state === 'running' && scheduleInterval === undefined) {
      nextBeat = context.currentTime + 0.03;
      schedule();
      scheduleInterval = setInterval(schedule, 120);
    } else if (!musicEnabled && scheduleInterval !== undefined) {
      clearInterval(scheduleInterval);
      scheduleInterval = undefined;
    }
  }

  async function unlock() {
    try {
      const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Audio) return;
      if (!context) {
        context = new Audio();
        master = context.createGain();
        master.gain.value = volume;
        master.connect(context.destination);
        ambience = context.createGain();
        ambience.gain.value = 0;
        ambience.connect(master);
      }
      if (context.state !== 'running') await context.resume();
      refreshMusic();
    } catch {
      // Audio can be unavailable while the game itself remains playable.
    }
  }

  return {
    unlock,
    setVolume(next) {
      volume = next;
      if (master) master.gain.setTargetAtTime(volume, context.currentTime, 0.03);
    },
    music(enabled, nextNight) {
      if (nextNight !== night) beat = 0;
      night = nextNight;
      musicEnabled = enabled;
      refreshMusic();
    },
    play(effect) {
      const notes = EFFECTS[effect];
      if (!notes || context?.state !== 'running' || volume === 0) return;
      const start = context.currentTime + 0.008;
      for (const [delay, ...voice] of notes) tone(master, start + delay, ...voice);
    },
  };
}
