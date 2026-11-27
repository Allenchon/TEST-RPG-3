(function (R, root) {
  "use strict";
  let context;
  let muted = false;
  const sounds = {
    step: [68, 45, 0.075, "triangle", 0.045],
    hit: [135, 48, 0.16, "sawtooth", 0.045],
    warn: [122, 76, 0.26, "triangle", 0.055],
    camp: [174, 256, 0.22, "sine", 0.07],
    win: [227, 362, 0.29, "triangle", 0.075],
    click: [410, 291, 0.055, "sine", 0.045]
  };

  function init() {
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (!AudioContext) return;
    try {
      context = context || new AudioContext();
      if (context.state === "suspended") context.resume().catch(() => {});
    } catch { /* audio is optional */ }
  }

  function play(name) {
    if (muted || !context || context.state !== "running" || !sounds[name]) return;
    const [from, to, duration, wave, volume] = sounds[name];
    const now = context.currentTime;
    const pitch = context.createOscillator();
    const gain = context.createGain();
    pitch.type = wave;
    pitch.frequency.setValueAtTime(from, now);
    pitch.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    pitch.connect(gain);
    gain.connect(context.destination);
    pitch.start(now);
    pitch.stop(now + duration);
    pitch.onended = () => { pitch.disconnect(); gain.disconnect(); };
  }

  R.AudioFX = {
    init, play,
    setMute(value) { muted = Boolean(value); },
    toggleMute() { muted = !muted; return muted; }
  };
}(globalThis.RPG3, globalThis));
