// sound.js — WebAudio で効果音を合成（外部ファイル不要・完全オフライン）
(function () {
  let ctx = null, master = null, enabled = true;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function click(t, freq, gain, type) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.07);
  }

  function noise(t, dur, gain, ftype, freq, q) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = ftype || 'bandpass'; f.frequency.value = freq || 3000; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }

  function tone(t, f0, f1, dur, gain, type) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  const sounds = {
    chip() { const t = ctx.currentTime; noise(t, 0.05, 0.22, 'highpass', 2600, 1); click(t, 1200, 0.1); click(t + 0.02, 1750, 0.07); },
    coins() { const t = ctx.currentTime; for (let i = 0; i < 6; i++) { const tt = t + i * 0.06; noise(tt, 0.05, 0.18, 'highpass', 2400, 1); click(tt, 900 + Math.random() * 900, 0.09); } },
    card() { const t = ctx.currentTime; noise(t, 0.13, 0.16, 'bandpass', 1700, 0.6); },
    check() { const t = ctx.currentTime; tone(t, 170, 130, 0.18, 0.28, 'sine'); },
    fold() { const t = ctx.currentTime; tone(t, 420, 150, 0.2, 0.16, 'triangle'); },
    ding() { const t = ctx.currentTime;[880, 1320, 1760].forEach((f, i) => tone(t + i * 0.05, f, f, 0.5, 0.2, 'sine')); },
    win() { const t = ctx.currentTime;[523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.08, f, f, 0.45, 0.18, 'triangle')); },
  };

  function play(name) {
    if (!enabled) return;
    if (!ensure()) return;
    try { (sounds[name] || function () {})(); } catch (e) {}
  }

  window.Poker = window.Poker || {};
  window.Poker.Sound = {
    play,
    resume() { ensure(); },
    setEnabled(v) { enabled = !!v; if (enabled) ensure(); },
    isEnabled() { return enabled; },
  };
})();
