// Synthesised audio: roars, footsteps, heartbeat, ambience (WebAudio); a species may have recorded roars instead
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
    for (const u in VOICES) decodeVoice(u);
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
  // ---- recorded voices (a species with `voice` in species.js): fetched at load, decoded once sound is on ----
  const VOICES = {}; // url -> { ab: ArrayBuffer promise, buf: AudioBuffer }
  function decodeVoice(u) {
    const v = VOICES[u]; if (!ctx || v.buf || v.dec) return; v.dec = true;
    v.ab.then(ab => { if (ab) ctx.decodeAudioData(ab, b => { v.buf = b; }, () => { }); });
  }
  A.loadVoices = function (urls) {
    urls.forEach(u => { if (VOICES[u]) return; VOICES[u] = { ab: fetch(u).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null) }; decodeVoice(u); });
  };
  // a roar from a recording: rate = pitch relative to the species' own (a higher, shorter snarl plays faster);
  // it starts `at` s from now and, when f1 > 0, fades out from f0 to f1 s after its start
  function playVoice(buf, pos, vol, rate, at, f0, f1) {
    const t = ctx.currentTime + at, out = panner(pos, 14), src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = 1.6 * vol;
    if (f1 > 0) { g.gain.setValueAtTime(1.6 * vol, t + f0); g.gain.exponentialRampToValueAtTime(0.0001, t + f1); }
    src.connect(g); g.connect(out); src.start(t); src.stop(t + (f1 > 0 ? f1 : buf.duration / rate) + 0.05);
  }
  // spec (optional): the species roaring; with recorded voices it uses one of them instead of the synthesised roar.
  // mouth (optional) = [start, fade from, silent by] in seconds from now, so the voice comes out of the open jaws;
  // a long roar defaults to the species' own (its roar clip, started with it), null plays it at once and in full
  A.roar = function (pos, pitch, vol, dur, spec, mouth) {
    if (!A.ok) return; pitch = pitch || 1; vol = vol || 1; dur = dur || 2.4;
    const vc = spec && spec.voice;
    if (vc) {
      const short = dur < 1.2, list = (short && vc.short) || vc.roar, ready = list.map(u => VOICES[u] && VOICES[u].buf).filter(Boolean);
      if (ready.length) {
        const m = short ? [0, (dur + 0.4) * 0.7, dur + 0.4] : mouth !== undefined ? mouth : vc.mouth;
        playVoice(ready[(Math.random() * ready.length) | 0], pos, vol, pitch / spec.ai.roarPitch, m ? m[0] : 0, m ? m[1] - m[0] : 0, m ? m[2] - m[0] : 0);
        return;
      }
    }
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
  // ---- the night swamp (co-op) ----
  // rain: a steady hiss whose level can be set (0 = off)
  let rainG = null;
  A.rain = function (level) {
    if (!A.ok) return;
    if (!rainG) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
      rainG = ctx.createGain(); rainG.gain.value = 0;
      src.connect(hp); hp.connect(lp); lp.connect(rainG); rainG.connect(master); src.start();
    }
    rainG.gain.setTargetAtTime(0.11 * level, ctx.currentTime, 0.5);
  };
  // thunder: a crack, then a long rolling rumble (delay: seconds after the flash)
  A.thunder = function (delay, vol) {
    if (!A.ok) return; const t = ctx.currentTime + (delay || 0); vol = vol || 1;
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7 * vol, t + 0.05);
    for (let k = 0.3; k < 4.5; k += 0.25) g.gain.setValueAtTime((0.25 + Math.random() * 0.5) * vol * Math.max(0.05, 1 - k / 4.8), t + k);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.2);
    ns.connect(lp); lp.connect(g); g.connect(master); ns.start(t, Math.random()); ns.stop(t + 5.4);
  };
  A.splash = function (vol) { // wading through a pool
    if (!A.ok) return; const t = ctx.currentTime;
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 500; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22 * vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    ns.connect(bp); bp.connect(g); g.connect(master); ns.start(t, Math.random() * 2); ns.stop(t + 0.32);
  };
  // a low, wet growl close by (the stalker breathing in the dark)
  A.growl = function (pos, vol) {
    if (!A.ok) return; const t = ctx.currentTime, out = panner(pos, 6), d = 1.6 + Math.random();
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(38, t); o.frequency.linearRampToValueAtTime(30, t + d);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 9 + Math.random() * 5; lg.gain.value = 0.5; lfo.connect(lg);
    const am = ctx.createGain(); am.gain.value = 0.5; lg.connect(am.gain);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.8 * vol, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(am); am.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o.stop(t + d + 0.05); lfo.start(t); lfo.stop(t + d + 0.05);
  };
  // the generator at the radio tower: a throbbing engine hum while it runs
  let hum = null;
  A.hum = function (on, pos) {
    if (!A.ok) return;
    if (on && !hum) {
      const out = panner(pos, 10), o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 46;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.35, ctx.currentTime, 0.4);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 7; lg.gain.value = 0.12; lfo.connect(lg); lg.connect(g.gain);
      o.connect(lp); lp.connect(g); g.connect(out); o.start(); lfo.start(); hum = { o, lfo, g };
    } else if (!on && hum) {
      const h = hum; hum = null; h.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
      setTimeout(() => { try { h.o.stop(); h.lfo.stop(); } catch (e) { } }, 1500);
    }
  };
  A.radio = function () { // radio contact: a burst of static and beeps
    if (!A.ok) return; const t = ctx.currentTime;
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    ns.connect(bp); bp.connect(g); g.connect(master); ns.start(t, Math.random()); ns.stop(t + 1.3);
    [0, 0.25, 0.5].forEach(d => { const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 1400; og.gain.setValueAtTime(0.0001, t + 1.3 + d); og.gain.linearRampToValueAtTime(0.06, t + 1.32 + d); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.45 + d); o.connect(og); og.connect(master); o.start(t + 1.3 + d); o.stop(t + 1.5 + d); });
  };
  A.ghost = function () { // becoming a ghost: a falling, hollow tone
    if (!A.ok) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(110, t + 3);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 3.3);
  };
  // co-op items: a firecracker's pop, a flashbang's bang, dynamite's blast, a wire hook firing, a distant beeping radio
  const burst = (pos, ref, f, q, vol, len) => {
    const out = panner(pos, ref), t = ctx.currentTime, ns = ctx.createBufferSource(); ns.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    ns.connect(bp); bp.connect(g); g.connect(out); ns.start(t, Math.random() * 2); ns.stop(t + len + 0.05);
  };
  A.pop = function (pos) { if (!A.ok) return; burst(pos, 9, 1800 + Math.random() * 1500, 0.6, 1.2, 0.09); };
  A.bang = function (pos) { if (!A.ok) return; burst(pos, 14, 2400, 0.4, 2.2, 0.5); burst(pos, 14, 400, 0.6, 1.4, 0.8); };
  A.boom = function (pos) {
    if (!A.ok) return; burst(pos, 22, 160, 0.5, 3, 2.6); burst(pos, 22, 900, 0.5, 1.6, 0.7);
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), out = panner(pos, 22);
    o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(22, t + 1.4);
    g.gain.setValueAtTime(1.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.7);
  };
  A.zip = function () { // the hook's wire running out
    if (!A.ok) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.45);
  };
  A.beep = function (pos) { // a lost radio calling out in the dark
    if (!A.ok) return; const t = ctx.currentTime, out = panner(pos, 7);
    [0, 0.18].forEach(d => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = 1250;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.linearRampToValueAtTime(0.09, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12); o.connect(g); g.connect(out); o.start(t + d); o.stop(t + d + 0.14); });
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
