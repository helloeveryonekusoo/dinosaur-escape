// Synthesised audio: roars, footsteps, heartbeat, ambience (WebAudio, no files)
(function () {
  const DG = window.DG;
  let ctx = null, master, noiseBuf;
  const A = DG.A = { ok: false };
  function noise(sec) {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = last * 0.6 + w * 0.4; d[i] = last; }
    return b;
  }
  function panner(pos, ref) {
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref || 8; p.rolloffFactor = 1.1; p.maxDistance = 1000;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(master); return p;
  }
  A.init = function () {
    if (ctx) { ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = noise(3); A.ok = true;
    // ambience: wind
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.connect(lp); lp.connect(g); g.connect(master); src.start();
    // insects / distant birds
    setInterval(() => {
      if (!A.ok || Math.random() < 0.5) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), og = ctx.createGain(), f = 2200 + Math.random() * 2500;
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (0.7 + Math.random() * 0.6), t + 0.15);
      og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.012, t + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.2);
    }, 900);
  };
  A.listener = function (pos, fwd) {
    if (!ctx) return; const l = ctx.listener;
    if (l.positionX) { l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z; l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
    else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  };
  A.roar = function (pos, pitch, vol, dur) {
    if (!A.ok) return; pitch = pitch || 1; vol = vol || 1; dur = dur || 2.4;
    const t = ctx.currentTime, out = panner(pos, 14);
    const env = ctx.createGain(); env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol * 0.9, t + 0.25); env.gain.setValueAtTime(vol * 0.8, t + dur * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f0 = 48 * pitch, oscs = [];
    [[f0, 'sawtooth', 0.5], [f0 * 1.013, 'sawtooth', 0.4], [f0 * 0.5, 'triangle', 0.6], [f0 * 2.02, 'square', 0.12]].forEach(([f, ty, a]) => {
      const o = ctx.createOscillator(); o.type = ty;
      o.frequency.setValueAtTime(f * 0.8, t); o.frequency.linearRampToValueAtTime(f * 1.15, t + dur * 0.3); o.frequency.linearRampToValueAtTime(f * 0.7, t + dur);
      const g = ctx.createGain(); g.gain.value = a; o.connect(g); oscs.push([o, g]);
    });
    const growl = ctx.createGain(); growl.gain.value = 0.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 26 * Math.sqrt(pitch); lg.gain.value = 0.4; lfo.connect(lg); lg.connect(growl.gain);
    oscs.forEach(([o, g]) => g.connect(growl));
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 * pitch; bp.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.9; ns.connect(bp); bp.connect(ng); ng.connect(growl);
    const ws = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.5); } ws.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900 * pitch, t); lp.frequency.linearRampToValueAtTime(2200 * pitch, t + dur * 0.35); lp.frequency.linearRampToValueAtTime(700 * pitch, t + dur);
    const f1 = ctx.createBiquadFilter(); f1.type = 'peaking'; f1.frequency.value = 320 * pitch; f1.Q.value = 2; f1.gain.value = 9;
    const f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 1100 * pitch; f2.Q.value = 3; f2.gain.value = 6;
    growl.connect(ws); ws.connect(lp); lp.connect(f1); f1.connect(f2); f2.connect(env); env.connect(out);
    oscs.forEach(([o]) => { o.start(t); o.stop(t + dur + 0.1); }); lfo.start(t); lfo.stop(t + dur + 0.1); ns.start(t, Math.random()); ns.stop(t + dur + 0.1);
  };
  A.step = function (pos, size) {
    if (!A.ok) return; const t = ctx.currentTime, out = panner(pos, 6 + size * 10);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(70 / Math.sqrt(size + 0.2), t); o.frequency.exponentialRampToValueAtTime(25, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9 * size, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + size * 0.2);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.7);
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300 + 500 / (size + 0.3);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.4 * Math.min(1, size + 0.2), t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    ns.connect(lp); lp.connect(ng); ng.connect(out); ns.start(t, Math.random() * 2); ns.stop(t + 0.25);
  };
  A.crunch = function (vol) { // player footstep
    if (!A.ok) return; const t = ctx.currentTime;
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1200 + Math.random() * 800; hp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    ns.connect(hp); hp.connect(g); g.connect(master); ns.start(t, Math.random() * 2); ns.stop(t + 0.15);
  };
  A.pickup = function () {
    if (!A.ok) return; const t = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.07); g.gain.linearRampToValueAtTime(0.08, t + i * 0.07 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.18);
      o.connect(g); g.connect(master); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.2);
    });
  };
  // burning flare: ignition pop, then a crackling hiss for `dur` seconds
  A.flare = function (pos, dur) {
    if (!A.ok) return; const t = ctx.currentTime, out = panner(pos, 10);
    const pop = ctx.createBufferSource(); pop.buffer = noiseBuf; const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.9, t); pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); pop.connect(pg); pg.connect(out); pop.start(t, 0.5); pop.stop(t + 0.3);
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    for (let k = 0.05; k < dur; k += 0.04) g.gain.setValueAtTime((0.25 + Math.random() * 0.35) * (Math.random() < 0.08 ? 2.2 : 1) * Math.min(1, (dur - k) / 2), t + k);
    g.gain.setValueAtTime(0.0001, t + dur);
    ns.connect(hp); hp.connect(g); g.connect(out); ns.start(t); ns.stop(t + dur + 0.1);
  };
  A.dart = function () { // compressed-air "pfft"
    if (!A.ok) return; const t = ctx.currentTime;
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    ns.connect(bp); bp.connect(g); g.connect(master); ns.start(t, Math.random()); ns.stop(t + 0.2);
  };
  A.whoosh = function () {
    if (!A.ok) return; const t = ctx.currentTime;
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.15);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    ns.connect(bp); bp.connect(g); g.connect(master); ns.start(t, Math.random()); ns.stop(t + 0.25);
  };
  A.heart = function (vol) {
    if (!A.ok) return; const t = ctx.currentTime;
    [0, 0.17].forEach((dt, i) => {
      const o = ctx.createOscillator(); o.frequency.value = 52; const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt); g.gain.linearRampToValueAtTime(vol * (i ? 0.6 : 1), t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.16);
      o.connect(g); g.connect(master); o.start(t + dt); o.stop(t + dt + 0.2);
    });
  };
})();
