// Game: boot, title/encyclopedia viewer, player, dinosaur AI, HUD
(function () {
  const DG = window.DG, W = DG.W, A = DG.A, V = THREE.Vector3;
  const $ = id => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  // yield so the loading text can repaint; setTimeout (not rAF) so loading also finishes in a background tab
  const frame = () => new Promise(r => setTimeout(r, 16));
  const setLoad = (f, t) => { $('loadBar').style.width = (f * 100) + '%'; $('loadText').textContent = t; };

  let renderer, camera, world, state = 'loading', dinos = [], clock = new THREE.Clock(), T = 0;
  const keys = {}; let dexIdx = 0, dexDino = null, dexT = 0, dexS = 0, dexV = 0;
  const P = { pos: new V(), vel: new V(), yaw: 0, pitch: 0, ground: true, stam: 1, exhausted: false, crouch: false, bob: 0, eye: 1.65, noise: 0, vis: 1 };
  let killer = null, deadT = 0, runT = 0, heartT = 0, shake = 0, msgT = 0, items = null;

  // Difficulty levels. 'easy' is the game exactly as it was originally tuned; the others turn the same dials.
  //   count / max / spawnEvery : T-rexes at the start, the most there can be, seconds between new arrivals
  //   sense : multiplier on how far they see and hear        speed : multiplier on their running speed
  //   lose  : seconds out of sight before a chase is given up
  //   items : multiplier on the pickups scattered over the map   startFlare : flares carried at the start
  //   flareTime : seconds a flare burns (and holds them)
  //   mix   : share of the hunters that are the optional second species (species.js), when it is installed; 0 = T-rex only
  DG.DIFFS = {
    easy: { name: 'やさしい', count: 2, max: 6, spawnEvery: 60, sense: 1, speed: 1, lose: 7, items: 1, startFlare: 1, flareTime: 20 },
    normal: { name: '普通', count: 3, max: 7, spawnEvery: 50, sense: 1.12, speed: 1.04, lose: 8, items: 0.8, startFlare: 1, flareTime: 18 },
    hard: { name: '難しい', count: 4, max: 8, spawnEvery: 40, sense: 1.25, speed: 1.08, lose: 10, items: 0.6, startFlare: 1, flareTime: 15 },
    vhard: { name: 'とても難しい', count: 5, max: 9, spawnEvery: 30, sense: 1.4, speed: 1.12, lose: 12, items: 0.45, startFlare: 0, flareTime: 12, mix: 0.5 }
  };
  DG.DIFF_ORDER = ['easy', 'normal', 'hard', 'vhard'];
  let diffKey = 'easy';
  try { const k = localStorage.getItem('dg_difficulty'); if (DG.DIFFS[k]) diffKey = k; } catch (e) { }
  let DF = DG.DIFFS[diffKey];
  // look sensitivity (mouse, or finger drag on touch screens): a multiplier on the turn per pixel, saved per browser
  let SENS = 1;
  try { const v = parseFloat(localStorage.getItem('dg_sens')); if (v >= 0.2 && v <= 3) SENS = v; } catch (e) { }
  function setSens(v) {
    SENS = clamp(Math.round(v * 10) / 10, 0.2, 3); try { localStorage.setItem('dg_sens', SENS); } catch (e) { }
    document.querySelectorAll('.sensIn').forEach(i => { if (+i.value !== SENS) i.value = SENS; });
    document.querySelectorAll('.sensVal').forEach(b => b.textContent = SENS.toFixed(1) + '×');
  }
  function setDiff(k) {
    diffKey = k; DF = DG.DIFFS[k]; try { localStorage.setItem('dg_difficulty', k); } catch (e) { }
    document.querySelectorAll('#diffBtns button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    const kmh = Math.round(DG.SPECIES.trex.ai.run * DF.speed * 3.6);
    const mixed = DF.mix && dinos.some(a => a.s.optional);
    $('diffInfo').innerHTML = `${mixed ? 'ティラノと未確認種（半々で混在）' : 'ティラノ'}：最初 ${DF.count}頭 →${DF.spawnEvery}秒ごとに1頭増えて最大 ${DF.max}頭 ／ 走る速さ 約${kmh}km/h ／ 目と耳の届く距離 ${Math.round(DF.sense * 100)}%<br>` +
      `アイテム：マップに ${DG.itemTotal(DF.items)}個` + (DF.startFlare ? `、最初に発煙筒 ${DF.startFlare}本` : '、最初は何も持たない') + ` ／ 発煙筒の効果 ${DF.flareTime}秒 ／ 見失うまで ${DF.lose}秒`;
  }

  DG.boot = async function () {
    setLoad(0.05, 'レンダラー初期化'); await frame();
    // Phones and tablets get touch controls and a lighter picture: fewer plants, a smaller shadow map, a lower
    // pixel ratio and smaller model textures. (?touch=1 / ?touch=0 in the address forces it on or off.)
    const forced = /[?&]touch=([01])/.exec(location.search);
    DG.MOBILE = forced ? forced[1] === '1' : (matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    DG.Q = DG.MOBILE ? { veg: 0.55, fern: 0.7, shadow: 1536, soft: false, pr: Math.min(devicePixelRatio, 1.25), aa: false, maxTex: 1024 }
      : { veg: 1, fern: 1, shadow: 4096, soft: true, pr: Math.min(devicePixelRatio, 1.5), aa: true, maxTex: 0 };
    if (DG.MOBILE) document.body.classList.add('touch');
    renderer = new THREE.WebGLRenderer({ antialias: DG.Q.aa, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DG.Q.pr); renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = DG.Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    document.body.prepend(renderer.domElement);
    camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 6000);
    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
    setLoad(0.15, '白亜紀の森を生成中'); await frame();
    world = W.create(renderer);
    // optional extra species kept only on this computer: open once with ?model=<name> (remembered), ?model=default to turn it off.
    // If its model file is missing (as on the public page) the species is dropped and the game is unchanged.
    let modelAlt = null;
    try {
      const q = /[?&]model=(\w+)/.exec(location.search);
      if (q) { if (q[1] === 'default') localStorage.removeItem('dg_model'); else localStorage.setItem('dg_model', q[1]); }
      modelAlt = localStorage.getItem('dg_model');
    } catch (e) { }
    for (const key in DG.SPECIES) if (DG.SPECIES[key].optional && DG.SPECIES[key].optional === modelAlt && !DG.SPECIES_ORDER.includes(key)) DG.SPECIES_ORDER.push(key);
    let k = 0;
    for (const key of DG.SPECIES_ORDER.slice()) {
      const s = DG.SPECIES[key];
      setLoad(0.3 + 0.6 * k / DG.SPECIES_ORDER.length, s.name + (s.model ? ' の3Dモデルを読み込み中' : ' の皮膚と骨格を生成中')); await frame();
      let gltf = s.model ? await DG.loadGLB(s.model.file) : null;
      if (s.optional && !gltf) { DG.SPECIES_ORDER.splice(DG.SPECIES_ORDER.indexOf(key), 1); continue; }
      let tex = null;
      if (gltf) { try { new DG.GltfDino(s, gltf); } catch (e) { console.warn('model setup failed', s.model.file, e); gltf = null; } }
      if (!gltf) { setLoad(0.3 + 0.6 * k / DG.SPECIES_ORDER.length, s.name + ' の皮膚と骨格を生成中'); await frame(); tex = DG.speciesTex(key); }
      s._usesModel = !!gltf;
      for (let i = 0; i < (s.ai.maxCount || s.ai.count); i++) {
        const d = gltf ? new DG.GltfDino(s, gltf) : new DG.Dino(s, tex); d.ground = W.height; d.root.visible = false;
        world.scene.add(d.root); dinos.push(mkAI(d)); await frame();
      }
      k++;
    }
    items = DG.makeItems({ scene: world.scene, P, camera, msg, A });
    setLoad(1, 'シェーダーをコンパイル中'); await frame();
    renderer.compile(world.scene, camera);
    $('loading').style.display = 'none';
    bindUI(); toMenu();
    // debug helpers (used during development for screenshots)
    DG._dbg = { renderer, camera, get world() { return world; }, newMap, beginGame, dinos, P, items, VS, SPEC, TREX, get state() { return state; }, set state(v) { state = v; }, get roster() { return roster; },
      shot(name, w, h) {
        const ow = innerWidth, oh = innerHeight; w = w || 1280; h = h || 720;
        renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
        renderer.render(world.scene, camera); const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
        renderer.setSize(ow, oh); camera.aspect = ow / oh; camera.updateProjectionMatrix();
        return fetch('shot/' + name, { method: 'POST', body: url }).then(r => r.status);
      },
      async pose(key, tag, speed, views, roar) {
        const D = DG._dbg; D.state = 'pause';
        const a = dinos.find(x => x.s.key === key); dinos.forEach(x => x.d.root.visible = false); a.d.root.visible = true;
        a.pos.set(0, W.height(0, 230), 230); a.heading = Math.PI / 2; a.d.root.position.copy(a.pos); a.d.root.rotation.y = a.heading; a.d.look = null;
        if (roar) a.d.roar(2.2);
        for (let i = 0; i < 40; i++) a.d.update(1 / 60, speed, 0);
        P.pos.copy(a.pos); world.update(0, 1, a.pos);
        const c = camera, p = a.pos, S = a.s.ai.size, hp = a.d.headPos();
        const V0 = {
          side: () => { c.position.set(p.x + 1 * S, p.y + 2.5 * S + 0.6, p.z + 14 * S + 4); c.lookAt(p.x + 1 * S, p.y + 2.2 * S, p.z); },
          front: () => { c.position.set(p.x + 9 * S + 2, p.y + 1.6, p.z + 6 * S + 2); c.lookAt(p.x + 2 * S, p.y + 2.4 * S, p.z); },
          head: () => { c.position.set(hp.x + 2.2 * S + 0.5, hp.y + 0.2, hp.z + 2.0 * S + 0.6); c.lookAt(hp.x + 0.8 * S, hp.y - 0.1 * S, hp.z); },
          face: () => { c.position.set(hp.x + 4 * S + 1.5, hp.y + 0.8 * S, hp.z + 1.6 * S); c.lookAt(hp.x + 0.6 * S, hp.y - 0.2 * S, hp.z); },
          back: () => { c.position.set(p.x - 9 * S - 2, p.y + 3 * S + 1, p.z - 5 * S - 2); c.lookAt(p.x, p.y + 1.8 * S, p.z); }
        };
        for (const v of (views || ['side', 'front', 'head'])) { V0[v](); await D.shot(key + '_' + v + (tag || '') + '.jpg'); }
        return 'ok';
      } };
    renderer.setAnimationLoop(loop);
  };

  function mkAI(d) {
    const a = { d, s: d.spec, ai: d.spec.ai, pos: new V(), heading: 0, speed: 0, turnRate: 0, state: 'wander', aware: 0, timer: 0,
      target: new V(), lastSeen: new V(), home: new V(), lost: 0, roared: false, attackT: -1, lastPhase: 0, chargeDir: 0, flank: (Math.random() - 0.5) * 2,
      roarN: 0, biteN: 0 };
    // count roars, so a race host can tell the other players' screens to play them too
    const roar0 = d.roar.bind(d); d.roar = dur => { a.roarN++; return roar0(dur); };
    return a;
  }
  const TREX = () => dinos.filter(a => a.s.key === 'trex'); // the race uses T-rexes only (every player has the same set)

  // A burning flare (light + noise) or meat (smell) draws nearby dinosaurs to a spot.
  // Both work even on a dinosaur that is chasing the player, unless the player is very close to it.
  DG.lure = function (pos, kind, src) {
    if (VS.on && !VS.host) { // a race guest: the host runs the dinosaurs, so tell it where the flare or meat landed
      DG.Net.send({ t: 'lure', kind, x: pos.x, y: pos.y, z: pos.z }); return;
    }
    if (state !== 'play' && !VS.on) return;
    const n = lureAt(pos, kind, src);
    if (n) msg(lureText(kind), 2.2);
  };
  const lureText = kind => kind === 'meat' ? `🍖 ${hunterName()}が肉の匂いに気付いた` : `🎇 ${hunterName()}が発煙筒の光に引き寄せられた`;
  function lureAt(pos, kind, src) {
    const R = kind === 'meat' ? 120 : 100, close = kind === 'meat' ? 18 : 12; let n = 0;
    dinos.forEach(a => {
      if (!a.d.root.visible || a.feedT > 0 || a.state === 'eat' || a.state === 'fixate' || a.pos.distanceTo(pos) > R) return;
      const seesPlayer = (a.state === 'chase' || a.state === 'alert') && a.lost < 1.5;
      if (seesPlayer && a.pos.distanceTo((a.tgtP || LOCAL).pos) < close) return;
      a.state = 'investigate'; a.lureKind = kind; a.target.copy(pos); a.arrived = false; a.roarHold = 0;
      a.timer = 45; a.bait = src || null; a.aware = Math.min(a.aware, 0.3); n++;
    });
    return n;
  }

  // Tranquilizer dart: a ray from the eye along the aim; the body is approximated by a few spheres.
  DG.dartShot = function () {
    const o = P.pos.clone(), dir = new V(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    let best = null, bestT = 50;
    dinos.forEach(a => {
      if (!a.d.root.visible) return;
      const S = a.ai.size, fw = new V(Math.sin(a.heading), 0, Math.cos(a.heading));
      const spheres = [[-3.5, 2.9, 1.0], [-1, 3.2, 1.5], [1.5, 3.2, 1.5], [3.8, 3.6, 1.0]].map(([f, h, r]) => [a.pos.clone().addScaledVector(fw, f * S).add(new V(0, h * S, 0)), r * S]);
      spheres.push([a.d.headPos(), 1.0 * S]);
      for (const [c, r] of spheres) {
        const oc = c.clone().sub(o), t = oc.dot(dir); if (t < 0 || t > bestT) continue;
        if (oc.lengthSq() - t * t < r * r) { bestT = t; best = a; }
      }
    });
    if (!best) return false;
    if (VS.on && !VS.host) { DG.Net.send({ t: 'dart', k: TREX().indexOf(best) }); return true; } // the host applies it
    tranq(best, LOCAL);
    return true;
  };
  // a dart hit: slows the dinosaur, which turns on whoever shot it
  function tranq(a, shooter) {
    a.tranq = 25; a.aware = Math.max(a.aware, 1.2); a.lastSeen.copy(shooter.pos); a.lost = 0; a.tgtP = shooter;
    if (a.state !== 'chase') { a.state = 'alert'; a.timer = 0.5; }
    a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch * 1.15, 1.3, 2.0);
  }

  // ---------------- UI ----------------
  const lock = () => { if (DG.MOBILE) return; try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { } };

  // ---- touch controls: a floating stick on the left, drag on the right to look, round buttons bottom right ----
  const TI = { mx: 0, mz: 0, run: false, jump: false };
  function bindTouch() {
    const zone = $('stickZone'), base = $('stick'), knob = base.firstElementChild, R = 50;
    let sid = null, sx = 0, sy = 0;
    const stickEnd = e => { if (e.pointerId !== sid) return; sid = null; TI.mx = TI.mz = 0; knob.style.transform = ''; base.classList.remove('on'); base.style.left = base.style.top = ''; };
    zone.addEventListener('pointerdown', e => {
      if (sid !== null) return; sid = e.pointerId; try { zone.setPointerCapture(sid); } catch (er) { }
      sx = e.clientX; sy = e.clientY; base.style.left = sx + 'px'; base.style.top = sy + 'px'; base.classList.add('on'); e.preventDefault();
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== sid) return;
      let dx = e.clientX - sx, dy = e.clientY - sy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      TI.mx = Math.abs(dx) > R * 0.22 ? dx / R : 0; TI.mz = Math.abs(dy) > R * 0.22 ? -dy / R : 0;
    });
    zone.addEventListener('pointerup', stickEnd); zone.addEventListener('pointercancel', stickEnd);
    const cv = renderer.domElement; let lid = null, lx = 0, ly = 0;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => { if (lid !== null || state !== 'play') return; lid = e.pointerId; try { cv.setPointerCapture(lid); } catch (er) { } lx = e.clientX; ly = e.clientY; });
    cv.addEventListener('pointermove', e => {
      if (e.pointerId !== lid || state !== 'play') return;
      const k = 0.0055 * SENS;
      P.yaw -= (e.clientX - lx) * k; P.pitch = clamp(P.pitch - (e.clientY - ly) * k, -1.45, 1.45); lx = e.clientX; ly = e.clientY;
    });
    const lookEnd = e => { if (e.pointerId === lid) lid = null; };
    cv.addEventListener('pointerup', lookEnd); cv.addEventListener('pointercancel', lookEnd);
    // forget any finger still marked as down when the controls are hidden (caught mid-run, the race ended…):
    // its 'up' may never arrive, and a stale finger would lock the stick for the next game
    TI.reset = () => { sid = null; lid = null; TI.mx = TI.mz = 0; TI.jump = false; knob.style.transform = ''; base.classList.remove('on'); base.style.left = base.style.top = ''; };
    const press = (id, down, up) => {
      const b = $(id);
      b.addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'play') down(b); });
      if (up) ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, () => up(b)));
    };
    press('tJump', () => TI.jump = true, () => TI.jump = false);
    press('tRun', () => TI.run = !TI.run);
    press('tCrouch', () => P.crouch = !P.crouch);
    press('tUse', () => items.use());
    press('tPause', () => { state = 'pause'; $('pause').style.display = 'flex'; });
    document.addEventListener('contextmenu', e => e.preventDefault());
  }
  let touchShown = null;
  function touchUI() { // show the controls only while playing; keep the toggle buttons in step with the game
    const on = state === 'play';
    if (on !== touchShown) { touchShown = on; $('touch').style.display = on ? 'block' : 'none'; if (!on) { TI.mx = TI.mz = 0; TI.jump = false; if (TI.reset) TI.reset(); } }
    if (on) { $('tRun').classList.toggle('on', TI.run); $('tCrouch').classList.toggle('on', P.crouch); }
  }
  function goFullscreen() { // best effort: fill the screen and hold it sideways (not available on every phone)
    try { const el = document.documentElement, p = el.requestFullscreen && el.requestFullscreen({ navigationUI: 'hide' }); if (p && p.catch) p.catch(() => { }); } catch (e) { }
    try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => { }); } catch (e) { }
  }

  function bindUI() {
    if (DG.MOBILE) bindTouch();
    if (DG.SPECIES_ORDER.length < 2) { $('btnPrev').style.display = $('btnNext').style.display = 'none'; }
    DG.DIFF_ORDER.forEach(k => {
      const b = document.createElement('button'); b.textContent = DG.DIFFS[k].name; b.dataset.k = k; b.onclick = () => { A.init(); setDiff(k); };
      $('diffBtns').appendChild(b);
    });
    setDiff(diffKey);
    document.querySelectorAll('.sensLbl').forEach(l => l.textContent = DG.MOBILE ? '視点感度' : 'マウス感度');
    document.querySelectorAll('.sensIn').forEach(i => {
      i.addEventListener('input', () => setSens(+i.value));
      ['keydown', 'keyup'].forEach(t => i.addEventListener(t, e => e.stopPropagation())); // arrow keys move the slider, not the player
    });
    setSens(SENS);
    $('btnPrev').onclick = () => { A.init(); showDex(dexIdx - 1); };
    $('btnNext').onclick = () => { A.init(); showDex(dexIdx + 1); };
    $('btnStart').onclick = () => { A.init(); if (DG.MOBILE) goFullscreen(); beginGame(); };
    $('btnResume').onclick = () => { if (DG.MOBILE) { state = 'play'; $('pause').style.display = 'none'; } else lock(); };
    $('btnRetry').onclick = () => { if (VS.inRoom) vsToLobby(); else beginGame(); };
    $('btnTitle').onclick = () => { if (VS.inRoom) vsLeaveRoom(); else toMenu(); };
    $('btnQuit').onclick = () => { if (VS.inRoom) vsLeaveRoom(); else toMenu(); };
    bindVersusUI();
    addEventListener('keydown', e => {
      keys[e.code] = true; if (e.code === 'KeyC') P.crouch = !P.crouch; if (e.code === 'Space') e.preventDefault();
      if (VS.on && !e.repeat) specKey(e.code);
      if (state === 'play') { const m = /^Digit([1-6])$/.exec(e.code); if (m) items.select(+m[1] - 1); if (e.code === 'KeyF') items.use(); }
    });
    addEventListener('mousedown', e => { if (e.button === 0 && state === 'play' && document.pointerLockElement === renderer.domElement) items.use(); });
    addEventListener('wheel', e => { if (state === 'play') items.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    addEventListener('keyup', e => keys[e.code] = false);
    addEventListener('mousemove', e => {
      if (state !== 'play' || document.pointerLockElement !== renderer.domElement) return;
      const k = 0.0022 * SENS;
      P.yaw -= e.movementX * k; P.pitch = clamp(P.pitch - e.movementY * k, -1.45, 1.45);
    });
    renderer.domElement.addEventListener('click', () => { if (state === 'play' && document.pointerLockElement !== renderer.domElement) lock(); });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === renderer.domElement) { if (state === 'pause') { state = 'play'; $('pause').style.display = 'none'; } }
      else if (state === 'play') { state = 'pause'; $('pause').style.display = 'flex'; }
    });
  }
  function showDex(i) {
    dexIdx = (i + DG.SPECIES_ORDER.length) % DG.SPECIES_ORDER.length;
    const key = DG.SPECIES_ORDER[dexIdx], s = DG.SPECIES[key];
    dinos.forEach(a => a.d.root.visible = false);
    dexDino = dinos.find(a => a.s.key === key); dexDino.d.root.visible = true; dexT = 0; dexS = 0; dexV = 0;
    const m = s._usesModel ? s.model : null;
    $('dexInfo').innerHTML = `<div class="nm">${s.name}</div><div class="sci">${s.sci}</div><div class="ds">${(m && m.desc) || s.desc}</div><div class="st">${s.stats}</div>` +
      (m ? (m.local ? `<div class="st">3Dモデル: ${m.title}</div>` : `<div class="st">3Dモデル: “${m.title}” by ${m.author}（CC BY 4.0）</div>`) : '');
    $('credits').innerHTML = DG.SPECIES_ORDER.map(k => DG.SPECIES[k]).filter(x => x._usesModel && !x.model.local)
      .map(x => `“<a href="${x.model.url}" target="_blank" rel="noopener">${x.model.title}</a>” by ${x.model.author} — <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>`).join('<br>');
  }
  function toMenu() {
    state = 'menu'; if (document.pointerLockElement) document.exitPointerLock();
    ['inv', 'stam', 'cross', 'status'].forEach(id => $(id).style.visibility = '');
    ['hud', 'end', 'pause'].forEach(id => $(id).style.display = 'none'); $('menu').style.display = 'flex';
    showDex(dexIdx);
  }
  function msg(t, dur) { $('msg').textContent = t; $('msg').style.opacity = 1; msgT = dur || 3; }

  // ---------------- game start ----------------
  // Every game is played on a fresh map: the one built while loading is used for the first game, and each later
  // game first replaces it with a newly seeded one (terrain, ravines, trees, rocks…). The scene object stays the
  // same, so the dinosaurs and item lights in it are untouched.
  let mapUsed = false, building = false;
  async function newMap() {
    $('loading').style.display = ''; setLoad(0.4, '新しい森を生成中'); await frame(); await frame();
    const scene = world.scene;
    world.dispose(); W.reseed((Math.random() * 1e6) | 0);
    world = W.create(renderer, { scene });
    dinos.forEach(a => { a.d.ground = W.height; });
    setLoad(0.9, 'シェーダーをコンパイル中'); await frame();
    renderer.compile(world.scene, camera);
    setLoad(1, ''); $('loading').style.display = 'none';
  }
  async function beginGame() {
    if (building) return; building = true;
    try {
      const fresh = mapUsed; if (fresh) await newMap();
      mapUsed = true; startGame();
      // pointer lock needs a recent click; after building a map that may have expired, so wait for one on the pause screen
      if (fresh && !DG.MOBILE && document.pointerLockElement !== renderer.domElement) { state = 'pause'; $('pause').style.display = 'flex'; }
    } finally { building = false; }
  }
  function startGame() {
    ['menu', 'end', 'pause'].forEach(id => $(id).style.display = 'none'); $('hud').style.display = 'block';
    P.pos.set(W.START.x, W.height(W.START.x, W.START.z) + 1.65, W.START.z); P.vel.set(0, 0, 0);
    P.yaw = Math.atan2(-(W.GOAL.x - W.START.x), -(W.GOAL.z - W.START.z)); P.pitch = 0; P.stam = 1; P.crouch = false; P.exhausted = false; TI.run = false; TI.jump = false;
    killer = null; runT = 0; shake = 0; items.reset(DF);
    const rnd = DG.N.rng((Math.random() * 1e9) | 0);
    const along = (f, side) => new V(lerp(W.START.x, W.GOAL.x, f) + side, 0, lerp(W.START.z, W.GOAL.z, f));
    // (the extra T-rexes of the harder levels start well off to the sides, never close to the start)
    const spots = { trex: [[0.42, 10], [0.78, -25], [0.6, 70], [0.32, -80], [0.9, 60]], utah: [[0.78, 35]], trike: [[0.3, -45], [0.36, -55]], carno: [[0.62, -60]] };
    // This game's hunters, in the order they appear: the first DF.count start on the map, the rest arrive one by one.
    // On a level with `mix`, every so-many-th place goes to the optional second species (evenly spread), if it is installed.
    const main = dinos.filter(a => a.ai.spawnEvery && !a.s.optional), extra = dinos.filter(a => a.ai.spawnEvery && a.s.optional);
    const mix = extra.length ? (DF.mix || 0) : 0; roster = [];
    for (let i = 0, im = 0, ie = 0; i < DF.max; i++) {
      const a = (Math.floor((i + 1) * mix) > Math.floor(i * mix) && ie < extra.length) ? extra[ie++] : main[im++];
      if (a) roster.push(a);
    }
    const used = {};
    dinos.forEach(a => {
      const hunter = !!a.ai.spawnEvery, ri = roster.indexOf(a);
      const k = hunter ? 'trex' : a.s.key, n = hunter ? (ri < 0 ? spots.trex.length : ri + 1) : (used[k] = (used[k] || 0) + 1), sp = spots[k][Math.min(n - 1, spots[k].length - 1)];
      const p = along(sp[0], sp[1]).add(new V((rnd() - 0.5) * 30, 0, (rnd() - 0.5) * 30));
      if (k === 'utah') p.add(new V(n * 6, 0, n * 4));
      activateDino(a, p, rnd() * Math.PI * 2, hunter ? ri >= 0 && ri < DF.count : n <= a.ai.count);
    });
    spawnT = SPAWN_EVERY();
    state = 'play'; lock();
    msg(`${roster.some(a => a.s.optional) ? '肉食恐竜' : 'ティラノサウルス'}に見つかるな — 赤い煙の救難信号を目指せ`, 5);
  }

  // place / reset a dinosaur; inactive ones stay hidden until they are spawned in later
  function activateDino(a, p, heading, active) {
    for (let i = 0; i < 20; i++) { const q = W.ravineAt(p.x, p.z); if (!q || q.d > q.hw + 6) break; p.x += 9; } // not inside a ravine
    a.pos.copy(p); a.heading = heading; a.speed = 0; a.state = 'wander'; a.aware = 0; a.timer = 0; a.roared = false; a.attackT = -1; a.bait = null;
    a.tranq = 0; a.detourT = 0;
    a.target.copy(p); a.home = p.clone(); a.d.lunge = 0; a.d.look = null; a.d.jawT = a.s.jawIdle != null ? a.s.jawIdle : 0.05;
    a.d.root.visible = active;
  }
  // every so often another T-rex arrives, out of the player's sight, 170-230 m away
  let spawnT = 0, roster = [];
  const hunterName = () => roster.some(a => a.s.optional) ? '肉食恐竜' : 'ティラノ';
  const SPAWN_EVERY = () => roster.length ? DF.spawnEvery : 0;
  const canSpawn = () => roster.filter(a => a.d.root.visible).length < DF.max && roster.some(a => !a.d.root.visible);
  function trySpawn(dt) {
    if (!SPAWN_EVERY() || !canSpawn()) return;
    spawnT -= dt; if (spawnT > 0) return;
    spawnT = SPAWN_EVERY();
    const a = roster.find(x => !x.d.root.visible); if (!a) return;
    const camYaw = P.yaw;
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2, dist = 170 + Math.random() * 60;
      const p = new V(P.pos.x + Math.sin(ang) * dist, 0, P.pos.z + Math.cos(ang) * dist);
      if (Math.abs(p.x) > W.LIMIT - 20 || Math.abs(p.z) > W.LIMIT - 20) continue;
      const toward = Math.atan2(-(p.x - P.pos.x), -(p.z - P.pos.z)); if (Math.abs(wrapA(toward - camYaw)) < 1.2) continue; // not in view
      if (W.ravineAt(p.x, p.z)) continue;
      activateDino(a, p, Math.atan2(P.pos.x - p.x, P.pos.z - p.z), true);
      a.home.lerp(P.pos, 0.25);
      const n = dinos.filter(x => x.d.root.visible).length;
      A.roar(new V(p.x, W.height(p.x, p.z) + 4, p.z), a.ai.roarPitch, 2.2, 2.6);
      msg(`🦖 森の奥で新たな咆哮が響いた…（${hunterName()} ${n}頭）`, 3);
      return;
    }
  }

  // ---------------- player ----------------
  const fwd = new V(), right = new V();
  // terrain gradient at (x, z): {x, z} = rise per metre along each axis, m = steepness (1 = 45°)
  const MAX_SLOPE = 1.0, SLP = { x: 0, z: 0, m: 0 };
  function slopeAt(x, z) {
    const e = 0.3;
    SLP.x = (W.height(x + e, z) - W.height(x - e, z)) / (2 * e); SLP.z = (W.height(x, z + e) - W.height(x, z - e)) / (2 * e);
    SLP.m = Math.hypot(SLP.x, SLP.z); return SLP;
  }
  // The lip of a ravine (its top 0.8 m) behaves like ordinary ground even where it is steep: you can stand on it,
  // step up it and jump from it, so a jump that takes off at the very edge or lands just short still works.
  // Below the lip the wall can't be climbed (see updatePlayer).
  const LIP = 0.8;
  const onLip = (x, z) => { const q = W.ravineAt(x, z); return !!q && q.depth <= LIP; };
  const wallAt = (x, z) => slopeAt(x, z).m > MAX_SLOPE && !onLip(x, z);
  function updatePlayer(dt) {
    const sprintKey = keys.ShiftLeft || keys.ShiftRight || TI.run;
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + TI.mx, mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + TI.mz;
    const held = VS.on && VS.phase !== 'race'; // a race countdown: look around, but no moving yet
    if (held) mx = mz = 0;
    const moving = mx || mz;
    const adr = items.adren > 0;
    if (P.stam <= 0) P.exhausted = true; if (P.exhausted && (P.stam > 0.35 || adr)) P.exhausted = false;
    const sprint = sprintKey && moving && !P.exhausted && !P.crouch && mz > 0.3;
    const spd = P.crouch ? 2.0 : sprint ? (adr ? 8.8 : 7.8) : 4.3;
    P.stam = clamp(P.stam + (sprint ? (adr ? 0 : -0.15) : (moving ? 0.08 : 0.14)) * dt, 0, 1);
    fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)); right.set(-fwd.z, 0, fwd.x);
    const wish = fwd.clone().multiplyScalar(mz).addScaledVector(right, mx); if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(spd);
    // ground steeper than 45° (ravine walls) can't be stood on: no walking up it, no jumping off it, and you slide down
    const sl = slopeAt(P.pos.x, P.pos.z), steep = P.ground && sl.m > MAX_SLOPE && !onLip(P.pos.x, P.pos.z);
    const sx = sl.x, sz = sl.z, sm = sl.m;
    if (steep) { const ux = sx / sm, uz = sz / sm, up = wish.x * ux + wish.z * uz; if (up > 0) { wish.x -= ux * up; wish.z -= uz * up; } }
    const k = 1 - Math.exp(-dt * (P.ground ? 10 : 1.5));
    P.vel.x = lerp(P.vel.x, wish.x, k); P.vel.z = lerp(P.vel.z, wish.z, k);
    if (steep) { P.vel.x -= sx / sm * 26 * dt; P.vel.z -= sz / sm * 26 * dt; }
    P.vel.y -= 22 * dt;
    // a jump still counts for a moment after running off an edge ("coyote time"), so pressing it a little late at a
    // ravine's lip doesn't drop you in
    P.coyote = P.ground && !steep ? 0.12 : Math.max(0, (P.coyote || 0) - dt);
    if ((P.ground && !steep || P.coyote > 0 && P.vel.y < 1) && !held && (keys.Space || TI.jump) && !P.crouch) { P.vel.y = 6.5; P.ground = false; P.coyote = 0; }
    const px = P.pos.x, pz = P.pos.z, g0 = W.height(px, pz);
    P.pos.addScaledVector(P.vel, dt);
    world.collide(P.pos, 0.35, P.pos.y - P.eye); // fallen logs can be jumped over
    P.pos.x = clamp(P.pos.x, -W.LIMIT, W.LIMIT); P.pos.z = clamp(P.pos.z, -W.LIMIT, W.LIMIT);
    // steep walls (ravine sides) can't be walked up, and running into one mid-air stops you dead
    const feet = P.pos.y - P.eye;
    const blocked = (x, z) => {
      const hd = Math.hypot(x - px, z - pz); if (hd < 1e-5) return false;
      const g1 = W.height(x, z), lip = onLip(x, z);
      if (!P.ground) return g1 > feet + (lip ? 0.45 : 0.3); // mid-air: a lip just above your feet can still be landed on
      if (lip) return false;                                  // walking up a lip is fine
      if ((g1 - g0) / hd > 1.0 && g1 > feet + 0.05) return true;
      // no creeping up a wall in small sideways steps, each of which on its own looks gentle enough
      return g1 > g0 + 0.005 && wallAt(x, z);
    };
    if (blocked(P.pos.x, P.pos.z)) { // slide along the wall: keep whichever axis is still allowed
      const nx = P.pos.x, nz = P.pos.z;
      if (!blocked(nx, pz)) { P.pos.z = pz; P.vel.z *= 0.3; }
      else if (!blocked(px, nz)) { P.pos.x = px; P.vel.x *= 0.3; }
      else { P.pos.x = px; P.pos.z = pz; P.vel.x *= 0.1; P.vel.z *= 0.1; }
    }
    P.eye = lerp(P.eye, P.crouch ? 0.95 : 1.65, 1 - Math.exp(-dt * 10));
    const gy = W.height(P.pos.x, P.pos.z) + P.eye;
    if (P.pos.y <= gy) { P.pos.y = gy; P.vel.y = Math.max(0, P.vel.y); P.ground = true; } else if (P.pos.y > gy + 0.05) P.ground = false;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    const prevB = Math.sin(P.bob); P.bob += dt * hs * 1.9; if (P.ground && prevB > 0 && Math.sin(P.bob) <= 0 && hs > 0.5) A.crunch(P.crouch ? 0.3 : sprint ? 1.2 : 0.7);
    P.noise = P.ground ? (hs < 0.3 ? 0 : P.crouch ? 0.12 : sprint ? 1 : 0.45) : 0.5;
    const cov = world.cover(P.pos.x, P.pos.z);
    P.vis = (P.crouch ? (cov > 0.42 ? 0.22 : 0.6) : 1) * (items.camo > 0 ? 0.45 : 1);
    camera.position.copy(P.pos); camera.position.y += Math.sin(P.bob * 2) * 0.035 * Math.min(1, hs / 4);
    camera.rotation.set(0, 0, 0); camera.rotation.order = 'YXZ'; camera.rotation.y = P.yaw; camera.rotation.x = P.pitch;
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 0.8); }
    $('stamBar').style.width = (P.stam * 100) + '%'; $('stamBar').style.background = P.exhausted ? '#c0503a' : '#e8e2cf';
    const st = [];
    if (P.crouch) st.push(P.vis < 0.3 ? '🌿 茂みに隠れている' : 'しゃがみ中');
    if (P.exhausted) st.push('息切れ…');
    if (adr) st.push(`💉 アドレナリン ${items.adren.toFixed(0)}秒`);
    if (items.camo > 0) st.push(`🟫 迷彩中 ${items.camo.toFixed(0)}秒`);
    if (items.radar > 0) st.push(`📡 探知中 ${items.radar.toFixed(0)}秒 — ` + dinos.filter(a => a.d.root.visible).map(a => Math.round(a.pos.distanceTo(P.pos)) + 'm' + (a.tranq > 0 ? '（麻酔）' : '') + (a.state === 'eat' ? '（食事中）' : a.state === 'fixate' ? '（発煙筒に釘付け）' : a.state === 'investigate' ? '（移動中）' : a.state === 'chase' ? '（追跡中！）' : '')).join(' / '));
    $('status').innerHTML = st.join('<br>');
    return sprint;
  }

  // ---------------- dinosaur AI ----------------
  const tv = new V();
  // Whom a dinosaur is after. In a single game that is always the player (LOCAL). In a race the host runs every
  // dinosaur for all three runners: it keeps after the runner it is already hunting, otherwise turns to the one it
  // notices most at this moment, otherwise to the nearest.
  const LOCAL = { pos: P.pos, get vis() { return P.vis; }, get noise() { return P.noise; }, local: true, slot: 0 };
  function senseGain(a, tp) {
    const ai = a.ai, dx = tp.pos.x - a.pos.x, dz = tp.pos.z - a.pos.z, dist = Math.hypot(dx, dz), rel = Math.abs(wrapA(Math.atan2(dx, dz) - a.heading));
    let gain = 0;
    const flareLured = (a.state === 'investigate' && a.lureKind === 'flare') || a.state === 'fixate'; // its hiss drowns out footsteps
    const sr = ai.sight * DF.sense * tp.vis; if (dist < sr && rel < 1.7) gain += (1.6 * (1 - dist / sr) + 0.2) * (flareLured ? 0.12 : 1); // eyes on the light
    const hr = ai.hear * DF.sense * tp.noise; if (dist < hr && !flareLured) gain += 2.2 * (1 - dist / hr) + 0.2;
    if (a.state === 'eat') gain *= 0.35; // busy eating: much less attentive
    if (dist < 6 * ai.size + 3) gain += 1.5; // right next to it: always noticed
    return gain;
  }
  function pickTarget(a, list) {
    if (!list) return LOCAL;
    if (!list.length) return null;
    const busy = a.state === 'alert' || a.state === 'chase' || a.state === 'charge' || a.state === 'cool';
    if (busy && a.tgtP && list.includes(a.tgtP)) return a.tgtP;
    let best = null, bg = 0, near = null, nd = 1e9;
    for (const tp of list) {
      const g = senseGain(a, tp); if (g > bg) { bg = g; best = tp; }
      const d = Math.hypot(tp.pos.x - a.pos.x, tp.pos.z - a.pos.z); if (d < nd) { nd = d; near = tp; }
    }
    return best || (a.tgtP && list.includes(a.tgtP) ? a.tgtP : near);
  }
  // a message meant for one runner (in a race, someone else's dinosaur trouble is not shown on your screen)
  function tell(tp, text, dur) {
    if (!tp || tp.local) { msg(text, dur); return; }
    const p = VS.players[tp.slot]; if (p && p.id) DG.Net.send({ t: 'tell', m: text, d: dur }, p.id);
  }
  // list: the runners a race host simulates for (undefined in a single game)
  function updateDino(a, dt, playing, list) {
    const ai = a.ai, d = a.d;
    if (a.feedT > 0) { // just caught a runner in a race: stands over its catch for a while
      a.feedT -= dt; a.speed = lerp(a.speed, 0, 1 - Math.exp(-dt * 6)); a.turnRate = 0; a.attackT = -1;
      d.lunge = Math.max(0, d.lunge - dt); applyDino(a, dt); return;
    }
    let TP = pickTarget(a, list);
    if (!TP) { TP = LOCAL; playing = false; }
    a.tgtP = TP;
    const lookAt = TP.local ? camera.position : TP.pos;
    let desiredSpeed = 0, desiredHeading = a.heading;
    const toP = tv.copy(TP.pos).sub(a.pos); toP.y = 0; const dist = toP.length();
    const angP = Math.atan2(toP.x, toP.z), rel = Math.abs(wrapA(angP - a.heading));
    a.timer -= dt;
    if (playing) {
      // perception
      const gain = senseGain(a, TP);
      a.aware = clamp(a.aware + (gain > 0 ? gain * dt : -0.12 * dt), 0, 1.6);
      if (gain > 0 && a.aware > 0.4) { a.lastSeen.copy(TP.pos); a.lost = 0; }
      else if (!(a.state === 'chase' && a.detourT > 0)) a.lost += dt; // while going round a ravine it still knows where you are
    }
    // state machine
    if (a.state === 'wander') {
      if (a.timer < 0 || a.pos.distanceTo(a.target) < 4) { a.timer = 6 + Math.random() * 10; if (playing && ai.type === 'hunter') a.home.lerp(TP.pos, 0.3); a.target.copy(a.home).add(new V((Math.random() - 0.5) * 70, 0, (Math.random() - 0.5) * 70)); a.idle = Math.random() < 0.35; }
      desiredSpeed = a.idle ? 0 : Math.max(ai.walk, d.minSpeed || 0); desiredHeading = Math.atan2(a.target.x - a.pos.x, a.target.z - a.pos.z);
      d.look = null;
      if (a.aware > 0.45) { a.state = 'alert'; a.timer = 1.6; }
    } else if (a.state === 'alert') {
      desiredSpeed = 0; desiredHeading = angP; d.look = lookAt;
      if (a.aware > 1) {
        a.state = ai.type === 'charger' ? 'charge' : 'chase'; a.timer = 0;
        if (ai.type === 'charger') { a.chargeDir = angP; a.timer = 4.5; }
        if (ai.type === 'hunter' || ai.type === 'charger' || !a.roared) {
          d.roar(2.2); A.roar(d.headPos(), ai.roarPitch, 1.4 * ai.size + 0.3, 2.4); a.roarHold = Math.max(ai.type === 'hunter' ? 1.6 : 0.6, (d.roarDuration || 0) * 0.85); a.roared = true;
          tell(TP, a.s.name + 'に気付かれた！', 2.5);
          if (ai.type === 'pack') dinos.forEach(o => { if (o !== a && o.ai.type === 'pack') { o.aware = 1.2; o.state = 'chase'; o.lastSeen.copy(TP.pos); } });
        }
      } else if (a.aware < 0.2) a.state = 'wander';
    } else if (a.state === 'chase') {
      d.look = lookAt;
      if (a.roarHold > 0) { a.roarHold -= dt; desiredSpeed = 0; desiredHeading = angP; }
      else {
        let tgt = a.lastSeen;
        if (ai.type === 'pack' && dist > 10) { // flank: aim to the side of the player
          const side = new V(Math.cos(angP), 0, -Math.sin(angP)).multiplyScalar(a.flank * Math.min(18, dist * 0.5));
          tgt = a.lastSeen.clone().add(side);
        }
        desiredHeading = Math.atan2(tgt.x - a.pos.x, tgt.z - a.pos.z); desiredSpeed = ai.run * DF.speed;
        if (a.lost > DF.lose || (a.lost > 2 && a.pos.distanceTo(a.lastSeen) < 4)) { a.state = 'wander'; a.aware = 0.3; a.home.copy(a.pos); a.timer = 0; tell(TP, '振り切った…', 2); }
      }
      if (playing && dist < ai.attack + 1.2 && rel < 0.7 && a.attackT < 0) a.attackT = 0;
    } else if (a.state === 'charge') {
      d.look = lookAt; desiredHeading = a.chargeDir; desiredSpeed = a.timer > 3.7 ? 0 : ai.run * DF.speed;
      if (a.timer > 3.7) desiredHeading = a.chargeDir = angP;
      if (playing && dist < ai.attack + 0.8 && a.attackT < 0 && a.speed > 3) a.attackT = 0;
      if (a.timer < 0) { a.state = 'cool'; a.timer = 3.5; }
    } else if (a.state === 'cool') {
      desiredSpeed = ai.walk * 0.5; desiredHeading = angP; d.look = lookAt;
      if (a.timer < 0) { if (dist < 30 && a.aware > 0.8) { a.state = 'charge'; a.chargeDir = angP; a.timer = 4.5; } else { a.state = 'wander'; a.aware = 0.3; } }
    } else if (a.state === 'investigate') {
      // heading for a noise (rock) or the smell of meat
      d.look = a.target;
      const dT = Math.hypot(a.target.x - a.pos.x, a.target.z - a.pos.z);
      if (!a.arrived) {
        desiredHeading = Math.atan2(a.target.x - a.pos.x, a.target.z - a.pos.z);
        desiredSpeed = ai.run * (a.lureKind === 'meat' ? 0.6 : 0.75);
        if (a.lureKind === 'flare' && a.bait && a.bait.dead) { a.state = 'wander'; a.timer = 0; } // burnt out before arrival
        else if (dT < (a.lureKind === 'flare' ? 6 : 2.5) + 3 * ai.size) {
          a.arrived = true; a.timer = 4 + Math.random() * 3;
          if (a.lureKind === 'meat' && a.bait && !a.bait.eaten) { a.state = 'eat'; a.timer = 16; a.biteT = 0.5; }
          if (a.lureKind === 'flare' && a.bait && !a.bait.dead) { a.state = 'fixate'; a.timer = a.bait.t; a.roarT2 = 1.5 + Math.random() * 2; }
        }
        if (a.timer < 0) { a.state = 'wander'; a.timer = 0; }
      } else {
        desiredSpeed = 0; desiredHeading = a.heading + Math.sin(T * 0.7) * 0.5; // sniff around
        if (a.timer < 0) { a.state = 'wander'; a.home.copy(a.pos); a.timer = 0; }
      }
      if (a.aware > (a.lureKind === 'flare' ? 1.0 : 0.6)) { a.state = 'alert'; a.timer = 1.2; }
    } else if (a.state === 'fixate') {
      // circles and stares at the burning flare, roaring at it, until it burns out
      d.look = a.target;
      const dT = Math.hypot(a.target.x - a.pos.x, a.target.z - a.pos.z), ang = Math.atan2(a.target.x - a.pos.x, a.target.z - a.pos.z);
      desiredHeading = dT > 9 + 3 * ai.size ? ang : ang + Math.PI / 2.2; // keep a wary distance, pacing around it
      desiredSpeed = dT > 14 + 3 * ai.size ? ai.walk * 1.2 : Math.max(ai.walk * 0.6, d.minSpeed || 0);
      a.roarT2 -= dt;
      if (a.roarT2 < 0) { a.roarT2 = 7 + Math.random() * 5; a.roarStand = Math.max(2, d.roarDuration || 0); d.roar(2.2); A.roar(d.headPos(), ai.roarPitch, 1.2, 2.2); }
      if (a.roarStand > 0) { a.roarStand -= dt; desiredSpeed = 0; desiredHeading = ang; }
      if (a.timer < 0 || !a.bait || a.bait.dead) { a.state = 'wander'; a.home.copy(a.pos); a.timer = 0; a.bait = null; a.aware = Math.min(a.aware, 0.3); }
      else if (a.aware > 1.1) { a.state = 'alert'; a.timer = 0.8; a.bait = null; }
    } else if (a.state === 'eat') {
      desiredSpeed = 0; desiredHeading = Math.atan2(a.target.x - a.pos.x, a.target.z - a.pos.z);
      d.look = a.target;
      a.biteT -= dt;
      if (a.biteT < 0) { a.biteT = 2.2 + Math.random() * 1.2; a.biteN = (a.biteN || 0) + 1; if (d.oneShot) d.oneShot('bite'); }
      if (!d.oneShot) d.jawT = 0.35 + 0.35 * Math.sin(T * 5);
      const done = a.timer < 0 || !a.bait || a.bait.eaten;
      if (done || a.aware > 1.1) {
        if (a.timer < 0) items.consumeBait(a.bait);
        d.jawT = a.s.jawIdle != null ? a.s.jawIdle : 0.05;
        if (a.aware > 1.1) { a.state = 'alert'; a.timer = 0.8; } else { a.state = 'wander'; a.home.copy(a.pos); a.timer = 0; }
        a.bait = null;
      }
    }
    // attack lunge
    if (a.attackT >= 0) {
      a.attackT += dt; d.lunge = Math.sin(Math.min(1, a.attackT / 0.7) * Math.PI);
      if (playing && a.attackT > 0.3 && a.attackT < 0.55 && TP.pos.distanceTo(d.mouthPos()) < ai.attack * 0.9 + 1.2) { if (list) vsCaught(a, TP); else die(a); }
      if (a.attackT > 0.8) { a.attackT = -1; d.lunge = 0; }
      desiredSpeed *= 0.6;
    }
    // tranquilizer dart: sluggish for a while
    if (a.tranq > 0) { a.tranq -= dt; desiredSpeed *= 0.42; }
    // a roar is delivered standing: the roar animation plants the feet, so brake hard instead of gliding forward
    const roaring = d.roaring;
    if (roaring) desiredSpeed = 0;
    // ravines: a big dinosaur won't step into one — it turns and follows the edge until it finds a way round
    a.detourT = (a.detourT || 0) - dt;
    {
      const look = 4 * ai.size + 3;
      let q = null; // sample several points ahead so a narrow crack isn't skipped over
      for (const f of [0.25, 0.5, 0.75, 1]) {
        const r = W.ravineAt(a.pos.x + Math.sin(desiredHeading) * look * f, a.pos.z + Math.cos(desiredHeading) * look * f);
        if (r && r.depth > 0.5) { q = r; break; }
      }
      if (q && desiredSpeed > 0) {
        // head for the nearer end of the crack, and stick with that choice for a while so it doesn't dither
        if (a.detourT <= -6 || a.detourRv !== q.rv) { a.detourSign = q.t < 0.5 ? -1 : 1; a.detourRv = q.rv; }
        a.detourT = 4;
      }
      if (a.detourT > 0 && desiredSpeed > 0) {
        // follow the edge using the crack direction at its own position, pushed outward when close to the rim
        const q2 = W.ravineAt(a.pos.x, a.pos.z);
        if (q2 && q2.d < q2.hw + look + 4) {
          const s = a.detourSign, push = 1.6 * (1 - DG.N.smoothstep(q2.hw + 1, q2.hw + 5, q2.d));
          desiredHeading = Math.atan2(q2.tx * s + q2.ox * push, q2.tz * s + q2.oz * push);
        } else if (q) desiredHeading = Math.atan2(q.tx * a.detourSign, q.tz * a.detourSign);
      }
    }
    // steering
    const ox = a.pos.x, oz = a.pos.z;
    const maxTurn = ai.turn / (1 + a.speed * 0.06) * (a.tranq > 0 ? 0.6 : 1);
    const dh = clamp(wrapA(desiredHeading - a.heading), -maxTurn * dt, maxTurn * dt);
    a.heading = wrapA(a.heading + dh); a.turnRate = dh / dt;
    const turnSlow = 1 - Math.min(0.6, Math.abs(wrapA(desiredHeading - a.heading)) * 0.5);
    a.speed = lerp(a.speed, desiredSpeed * turnSlow, 1 - Math.exp(-dt * (roaring ? 9 : ai.accel * 0.5)));
    a.pos.x += Math.sin(a.heading) * a.speed * dt; a.pos.z += Math.cos(a.heading) * a.speed * dt;
    world.collide(a.pos, 0.5 * ai.size + 0.2, Infinity, 0.45 * ai.size); // steps over fallen logs, pushes through thin stems
    a.pos.x = clamp(a.pos.x, -W.LIMIT, W.LIMIT); a.pos.z = clamp(a.pos.z, -W.LIMIT, W.LIMIT);
    { // never step deeper into a ravine (moving back out is allowed)
      const q0 = W.ravineAt(ox, oz), d0 = q0 ? q0.depth : 0, q = W.ravineAt(a.pos.x, a.pos.z);
      if (q && q.depth > 0.6 && q.depth > d0) { a.pos.x = ox; a.pos.z = oz; a.speed *= 0.5; }
    }
    applyDino(a, dt);
  }
  function applyDino(a, dt) {
    const d = a.d;
    a.pos.y = W.height(a.pos.x, a.pos.z);
    d.root.position.copy(a.pos); d.root.rotation.y = a.heading;
    const ph0 = d.phase; d.update(dt, a.speed, a.turnRate);
    const nSteps = a.s.gait.quad ? 4 : 2, s0 = Math.floor(ph0 * nSteps), s1 = Math.floor(d.phase * nSteps);
    if (s0 !== s1 && a.speed > 0.4 && a.pos.distanceTo(camera.position) < 120) A.step(a.pos, a.ai.size * Math.min(1, 0.4 + a.speed / 6));
  }
  function die(a) {
    if (state !== 'play') return;
    state = 'dead'; killer = a; deadT = 0; shake = 0.25; a.attackT = -1; if (document.pointerLockElement) document.exitPointerLock();
    A.roar(a.d.headPos(), a.ai.roarPitch * 1.1, 1.6, 1.8);
  }

  // ---------------- HUD ----------------
  function hud(dt, threat) {
    const gd = Math.hypot(W.GOAL.x - P.pos.x, W.GOAL.z - P.pos.z); $('dist').textContent = Math.round(gd);
    const nRex = dinos.filter(a => a.d.root.visible).length;
    $('rexn').textContent = `🦖×${nRex}` + (SPAWN_EVERY() && canSpawn() ? `（次の出現まで ${Math.ceil(spawnT)}秒）` : '') + `　【${DF.name}】`;
    const c = $('compass'); let h = '';
    const mk = (ang, label, cls) => { const r = wrapA(ang - P.yaw); if (Math.abs(r) < 1.6) h += `<span class="mk ${cls || ''}" style="left:${50 - r / 1.6 * 50}%">${label}</span>`; };
    mk(0, 'N'); mk(Math.PI / 2, 'W'); mk(Math.PI, 'S'); mk(-Math.PI / 2, 'E');
    if (items.radar > 0) dinos.forEach(a => { if (a.d.root.visible) mk(Math.atan2(-(a.pos.x - P.pos.x), -(a.pos.z - P.pos.z)), '🦖' + Math.round(a.pos.distanceTo(P.pos)), 'dn'); });
    c.innerHTML = h;
    $('vign').style.opacity = clamp(threat * 1.1, 0, 0.9);
    heartT -= dt; if (threat > 0.05 && heartT < 0) { A.heart(0.3 + threat * 0.7); heartT = 1.1 - threat * 0.65; }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').style.opacity = 0; }
    if (gd < 8) win();
  }
  function win() {
    state = 'win'; if (document.pointerLockElement) document.exitPointerLock();
    $('endTitle').textContent = '脱出成功'; $('endTitle').style.color = '#c9e6a0';
    $('endText').textContent = `救助ヘリに拾われた。 所要時間 ${runT.toFixed(1)} 秒（難易度：${DF.name}）`; $('end').style.display = 'flex';
  }

  // ================= 3-player race (online) =================
  // One player creates a room and is the host: it runs every dinosaur for all three runners and sends the others
  // a snapshot ten times a second. Each player moves their own runner and sends its position to the host.
  // All three build the same map from the seed the host picks, and start from three points the same distance
  // from the goal. The first to reach the signal wins; anyone caught is out. The host picks the difficulty.
  const VS = {
    inRoom: false, on: false, host: false, code: '', mySlot: 0, players: [], phase: 'idle', seed: 0, diff: 'hard',
    countT: 0, sendT: 0, panelT: 0, raceT: 0, ready: new Set(), winner: -1, baits: [], dead: null, nRex: 0, spawnIn: 0, raceMap: false, avatars: []
  };
  const VS_COLORS = ['#e8553c', '#3c9be8', '#e8c43c'];
  const ST_CODE = { alive: 0, dead: 1, goal: 2, gone: 3 }, CODE_ST = ['alive', 'dead', 'goal', 'gone'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const goalDist = p => Math.hypot(W.GOAL.x - p.x, W.GOAL.z - p.z);
  const mkPlayer = (slot, id, name) => ({ slot, id, name: String(name || 'プレイヤー').slice(0, 8), color: VS_COLORS[slot], st: 'alive', dist: 0, time: 0, yaw: 0, pitch: 0, cr: false,
    tp: { pos: new V(), vis: 1, noise: 0, local: false, slot } });
  const vsList = () => VS.players.filter(Boolean).map(p => ({ s: p.slot, name: p.name }));
  const vsStatus = t => { $('vsStatus').textContent = t || ''; };
  const vsDiffKey = k => DG.DIFFS[k] ? k : 'hard'; // a difficulty name from the network, checked
  const VD = () => DG.DIFFS[VS.diff];
  // the host picks the race's difficulty in the room; everyone else sees the choice
  function setVsDiff(k) {
    VS.diff = vsDiffKey(k);
    if (VS.host) { try { localStorage.setItem('dg_vs_difficulty', VS.diff); } catch (e) { } sendLobby(); }
    renderLobby();
  }
  const myName = () => { const n = $('vsName').value.trim().slice(0, 8) || 'プレイヤー'; try { localStorage.setItem('dg_name', n); } catch (e) { } return n; };

  function bindVersusUI() {
    try { $('vsName').value = localStorage.getItem('dg_name') || ''; } catch (e) { }
    $('btnVs').onclick = () => { A.init(); openLobby(); };
    $('vsCreate').onclick = vsCreate;
    $('vsJoin').onclick = vsJoin;
    $('vsCode').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') vsJoin(); });
    $('vsName').addEventListener('keydown', e => e.stopPropagation());
    ['keyup'].forEach(t => { $('vsCode').addEventListener(t, e => e.stopPropagation()); $('vsName').addEventListener(t, e => e.stopPropagation()); });
    DG.DIFF_ORDER.forEach(k => {
      const b = document.createElement('button'); b.textContent = DG.DIFFS[k].name; b.dataset.k = k;
      b.onclick = () => { if (VS.host && VS.phase === 'lobby') setVsDiff(k); };
      $('vsDiffBtns').appendChild(b);
    });
    $('vsGo').onclick = vsStartRace;
    $('vsBack').onclick = vsLeaveRoom;
    bindSpectate();
    DG.Net.on(onNet);
  }
  function openLobby() {
    $('vsLobby').style.display = 'flex';
    $('vsHome').style.display = VS.inRoom ? 'none' : 'block'; $('vsRoom').style.display = VS.inRoom ? 'block' : 'none';
    renderLobby();
  }
  function renderLobby() {
    $('vsCodeShow').textContent = VS.code;
    $('vsList').innerHTML = [0, 1, 2].map(s => {
      const p = VS.players[s];
      return `<li><span class="dot" style="background:${VS_COLORS[s]}"></span>${p ? esc(p.name) + (s === VS.mySlot ? '（あなた）' : '') + (s === 0 ? ' — ホスト' : '') : '<span style="color:#777">空き</span>'}</li>`;
    }).join('');
    const df = VD();
    document.querySelectorAll('#vsDiffBtns button').forEach(b => { b.classList.toggle('on', b.dataset.k === VS.diff); b.disabled = !VS.host; });
    $('vsDiffInfo').textContent = `ティラノ：最初 ${df.count}頭 → ${df.spawnEvery}秒ごとに1頭増えて最大 ${df.max}頭 ／ 走る速さ 約${Math.round(DG.SPECIES.trex.ai.run * df.speed * 3.6)}km/h ／ ` +
      `目と耳の届く距離 ${Math.round(df.sense * 100)}% ／ 最初の発煙筒 ${df.startFlare}本` + (VS.host ? '' : '（難易度はホストが選びます）');
    const n = VS.players.filter(Boolean).length;
    $('vsGo').style.display = VS.host ? '' : 'none';
    $('vsGo').disabled = n < 2;
    if (VS.inRoom && !VS.host) vsStatus('ホストが対戦を始めるのを待っています…');
    else if (VS.inRoom && n < 3) vsStatus(n < 2 ? 'ほかのプレイヤーの参加を待っています…' : `${n}人で始められます（3人そろうのがおすすめ）`);
    else if (VS.inRoom) vsStatus('3人そろいました。「対戦開始」で始まります');
  }
  async function vsCreate() {
    vsStatus('部屋を作っています…');
    try {
      const code = await DG.Net.host();
      let d = 'hard'; try { d = vsDiffKey(localStorage.getItem('dg_vs_difficulty')); } catch (e) { }
      Object.assign(VS, { inRoom: true, host: true, code, mySlot: 0, players: [mkPlayer(0, null, myName())], phase: 'lobby', diff: d });
      openLobby();
    } catch (e) { DG.Net.close(); vsStatus(DG.Net.why(e)); }
  }
  async function vsJoin() {
    const code = $('vsCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { vsStatus('5文字の部屋コードを入力してください'); return; }
    vsStatus('接続しています…');
    try {
      await DG.Net.join(code);
      Object.assign(VS, { host: false, code });
      DG.Net.send({ t: 'hello', name: myName(), v: 1 });
      vsStatus('ホストの応答を待っています…');
      setTimeout(() => { if (!VS.inRoom && DG.Net.connected && !DG.Net.isHost) vsStatus('ホストから応答がありません'); }, 8000);
    } catch (e) { DG.Net.close(); vsStatus(DG.Net.why(e)); }
  }
  // leave the room (and the race, if one is on) and go back to the title screen
  function vsLeaveRoom() {
    DG.Net.close();
    const hadRace = VS.raceMap;
    Object.assign(VS, { inRoom: false, on: false, host: false, code: '', players: [], phase: 'idle', raceMap: false, dead: null });
    VS.avatars.forEach(g => g.visible = false);
    $('vsLobby').style.display = 'none'; $('race').style.display = 'none'; $('count').style.display = 'none'; $('spec').style.display = 'none'; SPEC.shown = false; document.body.classList.remove('watching');
    $('btnRetry').textContent = 'もう一度'; $('btnTitle').textContent = 'タイトルへ'; $('endRank').innerHTML = ''; vsStatus('');
    setDiff(diffKey); toMenu();
    if (hadRace) newMap(); // the race map has no glade for the title screen and three starts; build a normal one
  }
  function vsAbort(text) { vsLeaveRoom(); openLobby(); vsStatus(text); }
  // after a race: back to the room (the host can start another one)
  function vsToLobby() {
    VS.on = false; VS.phase = 'lobby'; VS.dead = null;
    VS.avatars.forEach(g => g.visible = false);
    if (VS.host) { VS.players.forEach((p, i) => { if (p && p.left) VS.players[i] = undefined; }); sendLobby(); } // free the seats of those who left
    $('race').style.display = 'none'; $('count').style.display = 'none'; $('spec').style.display = 'none'; SPEC.shown = false; document.body.classList.remove('watching'); $('endRank').innerHTML = '';
    $('btnRetry').textContent = 'もう一度'; $('btnTitle').textContent = 'タイトルへ';
    setDiff(diffKey); toMenu(); openLobby();
  }

  // ---- network messages ----
  function onNet(type, id, m) {
    if (type === 'leave') return vsLeft(id);
    if (type !== 'msg' || !m || typeof m.t !== 'string') return;
    if (VS.host) hostMsg(id, m); else guestMsg(m);
  }
  const playerById = id => VS.players.find(p => p && p.id === id);
  function vsLeft(id) {
    if (!VS.host) { if (VS.inRoom || DG.Net.connected) vsAbort('ホストとの接続が切れました'); return; }
    const p = playerById(id); if (!p) return;
    if (VS.phase === 'lobby') { VS.players[p.slot] = undefined; sendLobby(); renderLobby(); }
    else { p.left = true; if (p.st === 'alive') { p.st = 'gone'; p.dist = goalDist(p.tp.pos); } VS.ready.add(p.slot); vsMaybeGo(); vsCheckEnd(); }
  }
  function sendLobby() {
    VS.players.forEach(p => { if (p && p.id) DG.Net.send({ t: 'lobby', you: p.slot, code: VS.code, list: vsList(), diff: VS.diff }, p.id); });
  }
  function hostMsg(id, m) {
    const p = playerById(id);
    if (m.t === 'hello') {
      if (p) return;
      const slot = [1, 2].find(s => !VS.players[s]);
      if (VS.phase !== 'lobby' || !slot) { DG.Net.send({ t: 'busy', why: VS.phase !== 'lobby' ? '対戦中のため入れません' : '部屋が満員です（3人まで）' }, id); setTimeout(() => DG.Net.kick(id), 500); return; }
      VS.players[slot] = mkPlayer(slot, id, m.name); sendLobby(); renderLobby();
      return;
    }
    if (!p) return;
    if (m.t === 'ready') { VS.ready.add(p.slot); vsMaybeGo(); }
    else if (m.t === 'me' && p.st === 'alive') {
      p.tp.pos.set(+m.x || 0, +m.y || 0, +m.z || 0); p.tp.vis = clamp(+m.v || 0, 0, 1); p.tp.noise = clamp(+m.n || 0, 0, 1); p.yaw = +m.yaw || 0; p.pitch = clamp(+m.pt || 0, -1.5, 1.5); p.cr = !!m.cr;
    } else if (m.t === 'lure' && VS.phase === 'race') {
      const pos = new V(+m.x || 0, +m.y || 0, +m.z || 0);
      const bait = m.kind === 'meat' ? { pos, eaten: false, remote: true } : { pos, t: DF.flareTime, remote: true, get dead() { return this.t <= 0; } };
      if (m.kind !== 'meat') VS.baits.push(bait);
      const n = lureAt(pos, m.kind === 'meat' ? 'meat' : 'flare', bait);
      if (n) tell(p.tp, lureText(m.kind === 'meat' ? 'meat' : 'flare'), 2.2);
    } else if (m.t === 'dart' && VS.phase === 'race') {
      const a = TREX()[m.k | 0]; if (a && a.d.root.visible) tranq(a, p.tp);
    } else if (m.t === 'take' && VS.phase === 'race' && p.st === 'alive') hostTake(m.i | 0, p.slot);
    else if (m.t === 'goal' && VS.phase === 'race' && p.st === 'alive') vsGoal(p.slot, +m.time || VS.raceT);
  }
  function guestMsg(m) {
    if (m.t === 'busy') { vsAbort(m.why || '部屋に入れませんでした'); return; }
    if (m.t === 'lobby') {
      const was = VS.inRoom;
      VS.inRoom = true; VS.mySlot = m.you | 0; VS.code = m.code || VS.code; VS.diff = vsDiffKey(m.diff);
      const old = VS.players; VS.players = [];
      (m.list || []).forEach(e => { VS.players[e.s] = mkPlayer(e.s, null, e.name); if (old[e.s]) VS.players[e.s].st = old[e.s].st; });
      if (VS.phase === 'idle') VS.phase = 'lobby';
      if (!was || $('vsLobby').style.display === 'flex') openLobby(); else renderLobby();
    } else if (m.t === 'start') { VS.diff = vsDiffKey(m.diff); vsPrepare(m.seed | 0, m.list || []); }
    else if (m.t === 'go') { if (VS.phase === 'loading') VS.goPending = true; else vsGo(); }
    else if (m.t === 'snap') applySnap(m);
    else if (m.t === 'took') { if (VS.on) items.take(m.i | 0, (m.s | 0) === VS.mySlot); }
    else if (m.t === 'caught') { const me = VS.players[VS.mySlot]; if (me && me.st === 'alive') { me.st = 'dead'; me.dist = goalDist(P.pos); localCaught(TREX()[m.k | 0]); } }
    else if (m.t === 'tell') msg(String(m.m || '').slice(0, 60), +m.d || 2);
    else if (m.t === 'fx' && m.k === 'spawn') { A.roar(new V(+m.x, +m.y, +m.z), DG.SPECIES.trex.ai.roarPitch, 2.2, 2.6); msg(`🦖 森の奥で新たな咆哮が響いた…（ティラノ ${m.n | 0}頭）`, 3); }
    else if (m.t === 'end') showRaceEnd(m.w, m.r || []);
  }

  // ---- starting a race ----
  async function vsStartRace() {
    if (!VS.host || VS.phase === 'loading' || VS.players.filter(Boolean).length < 2) return;
    VS.seed = (Math.random() * 1e6) | 0;
    DG.Net.broadcast({ t: 'start', seed: VS.seed, list: vsList(), diff: VS.diff });
    VS.ready = new Set();
    VS.players.forEach(p => { if (p && !playerConnected(p)) VS.ready.add(p.slot); });
    await vsPrepare(VS.seed, vsList());
    VS.ready.add(0); vsMaybeGo();
    const seed = VS.seed; setTimeout(() => { if (VS.seed === seed) vsMaybeGo(true); }, 45000); // don't wait forever for a slow phone
  }
  const playerConnected = p => p.slot === VS.mySlot || !!p.id;
  // build the race map from the host's seed (everyone ends up with exactly the same trees, rocks and ravines)
  async function vsPrepare(seed, list) {
    VS.phase = 'loading'; VS.seed = seed; VS.on = false; VS.goPending = false;
    state = 'wait'; VS.dead = null; // someone still on the last race's results (maybe out, with no single-player killer) just waits
    const old = VS.players; VS.players = []; // exactly the players in this race (someone may have left the room since)
    list.forEach(e => { VS.players[e.s] = old[e.s] && old[e.s].name === String(e.name).slice(0, 8) ? old[e.s] : mkPlayer(e.s, null, e.name); });
    ['menu', 'end', 'pause', 'vsLobby', 'hud'].forEach(id => $(id).style.display = 'none');
    $('loading').style.display = ''; setLoad(0.4, '対戦用の森を生成中'); await frame(); await frame();
    const scene = world.scene;
    world.dispose(); W.reseed(seed, true);
    world = W.create(renderer, { scene, layout: { veg: 1, fern: 1 } });
    dinos.forEach(a => { a.d.ground = W.height; });
    setLoad(0.9, 'シェーダーをコンパイル中'); await frame();
    renderer.compile(world.scene, camera);
    VS.raceMap = true; mapUsed = true;
    setLoad(1, 'ほかのプレイヤーを待っています…');
    VS.phase = 'ready';
    if (!VS.host) DG.Net.send({ t: 'ready' });
    if (VS.goPending) { VS.goPending = false; vsGo(); } // the host started without waiting for this (slow) machine
  }
  function vsMaybeGo(force) {
    if (!VS.host || VS.phase !== 'ready') return;
    const all = VS.players.filter(Boolean).every(p => VS.ready.has(p.slot));
    if (!all && !force) return;
    DG.Net.broadcast({ t: 'go' }); vsGo();
  }
  function vsGo() {
    if (VS.phase !== 'ready') return;
    $('loading').style.display = 'none';
    VS.on = true; VS.phase = 'count'; VS.countT = 3.5;
    DF = VD();
    ['menu', 'end', 'pause', 'vsLobby'].forEach(id => $(id).style.display = 'none'); $('hud').style.display = 'block'; $('race').style.display = 'block';
    const st = W.STARTS[VS.mySlot] || W.START;
    P.pos.set(st.x, W.height(st.x, st.z) + 1.65, st.z); P.vel.set(0, 0, 0); P.eye = 1.65; P.ground = true;
    P.yaw = Math.random() * Math.PI * 2; // facing any way: where the signal is has to be found out
    P.pitch = 0; P.stam = 1; P.crouch = false; P.exhausted = false; TI.run = false; TI.jump = false;
    killer = null; runT = 0; shake = 0; VS.dead = null; VS.raceT = 0; VS.winner = -1; VS.baits = []; VS.sendT = 0; VS.panelT = 0;
    Object.assign(SPEC, { slot: -1, oy: 0, op: 0.3, dist: 7, tp: 1.1, tdist: 26, snap: true });
    // pickups anywhere round the signal, one set for everybody: the first to reach one has it
    items.reset(DF, { seed: VS.seed + 7, starts: W.STARTS, around: { c: W.GOAL, r: W.RACE_R + 30 }, more: 1.6, claim: vsClaim });
    LOCAL.slot = VS.mySlot;
    for (const k in keys) keys[k] = false; // nothing still held from the last race (or from watching it)
    VS.players.forEach(p => {
      if (!p) return;
      p.st = !VS.host || playerConnected(p) ? 'alive' : 'gone'; p.time = 0;
      const s = W.STARTS[p.slot] || W.START; p.tp.pos.set(s.x, W.height(s.x, s.z) + 1.65, s.z); p.dist = goalDist(s);
      p.yaw = 0;
    });
    if (VS.players[VS.mySlot]) VS.players[VS.mySlot].tp = LOCAL;
    // the hunters: the first DF.count start on the map, more arrive every DF.spawnEvery seconds (run by the host)
    const trex = TREX();
    dinos.forEach(a => { a.d.root.visible = false; a.tgtP = null; a.netOn = false; a.roarSeen = undefined; a.biteSeen = undefined; a.feedT = 0; a.d.look = null; });
    roster = trex.slice(0, DF.max);
    if (VS.host) {
      // in the wedges between the three routes, at various distances from the signal, well away from every start
      const rnd = DG.N.rng(VS.seed + 11), G = W.GOAL, R = W.RACE_R, base = Math.atan2(W.STARTS[0].x - G.x, W.STARTS[0].z - G.z);
      roster.forEach((a, i) => {
        let p = null;
        for (let k = 0; k < 40 && !p; k++) {
          const ang = base + Math.PI / 3 + (i % 3) * Math.PI * 2 / 3 + (rnd() - 0.5) * 0.9, d = R * (0.3 + rnd() * 0.55);
          const q = new V(G.x + Math.sin(ang) * d, 0, G.z + Math.cos(ang) * d);
          if (Math.abs(q.x) > W.LIMIT - 30 || Math.abs(q.z) > W.LIMIT - 30 || W.ravineAt(q.x, q.z)) continue;
          if (W.STARTS.some(s => Math.hypot(s.x - q.x, s.z - q.z) < 120)) continue;
          p = q;
        }
        activateDino(a, p || new V(G.x + 40, 0, G.z + 40), rnd() * Math.PI * 2, i < DF.count);
      });
      spawnT = DF.spawnEvery;
    }
    ensureAvatars();
    state = 'play';
    if (!DG.MOBILE) { lock(); if (document.pointerLockElement !== renderer.domElement) { state = 'pause'; $('pause').style.display = 'flex'; } }
    msg('最初に救難信号へたどり着いた人の勝ち', 4);
  }

  // ---- the other runners, as simple coloured figures with their name above ----
  function ensureAvatars() {
    VS.avatars.forEach(g => { world.scene.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); });
    VS.avatars = [];
    VS.players.forEach(p => {
      if (!p || p.slot === VS.mySlot) return;
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.85, 4, 10), mat); body.position.y = 0.72; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.8 })); head.position.y = 1.47; g.add(head);
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.18), new THREE.MeshStandardMaterial({ color: 0x3b3a2c, roughness: 0.9 })); pack.position.set(0, 0.95, 0.24); g.add(pack);
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const c = cv.getContext('2d');
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 10, 256, 44); c.font = 'bold 32px sans-serif'; c.textAlign = 'center'; c.fillStyle = p.color; c.fillText(p.name, 128, 44);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); tag.scale.set(1.8, 0.45, 1); tag.position.y = 2.15; g.add(tag);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.userData.slot = p.slot; g.position.copy(p.tp.pos).y -= 1.65;
      world.scene.add(g); VS.avatars.push(g);
    });
  }
  function updateAvatars(dt) {
    const k = 1 - Math.exp(-dt * 12);
    VS.avatars.forEach(g => {
      const p = VS.players[g.userData.slot]; if (!p) { g.visible = false; return; }
      g.visible = (p.st === 'alive' || p.st === 'goal') && !(SPEC.mode === 'fp' && SPEC.slot === p.slot && specActive()); // not in our own way when looking through their eyes
      g.position.x = lerp(g.position.x, p.tp.pos.x, k); g.position.z = lerp(g.position.z, p.tp.pos.z, k);
      g.position.y = W.height(g.position.x, g.position.z);
      g.rotation.y = p.yaw; g.scale.y = lerp(g.scale.y, p.cr ? 0.62 : 1, k);
    });
  }

  // ---- host: sending the state of the race; guest: applying it ----
  function sendSnap() {
    const p = [];
    VS.players.forEach(pl => { if (!pl) return; const q = pl.tp.pos; p.push([pl.slot, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +pl.yaw.toFixed(3), pl.cr ? 1 : 0, ST_CODE[pl.st] | 0, +(pl.pitch || 0).toFixed(3)]); });
    const d = [];
    TREX().forEach((a, k) => {
      if (!a.d.root.visible) return;
      const hunting = a.tgtP && (a.state === 'alert' || a.state === 'chase' || a.state === 'charge' || a.state === 'cool') ? a.tgtP.slot : -1;
      d.push([k, +a.pos.x.toFixed(2), +a.pos.z.toFixed(2), +a.heading.toFixed(3), +a.speed.toFixed(2), Math.round(a.d.lunge * 100), a.tranq > 0 ? 1 : 0, a.roarN, a.biteN, hunting]);
    });
    DG.Net.broadcast({ t: 'snap', p, d, n: roster.filter(a => a.d.root.visible).length, sp: SPAWN_EVERY() && canSpawn() ? Math.ceil(spawnT) : -1 });
  }
  function applySnap(m) {
    (m.p || []).forEach(e => {
      const pl = VS.players[e[0]]; if (!pl || e[0] === VS.mySlot) return;
      pl.tp.pos.set(e[1], e[2], e[3]); pl.yaw = e[4]; pl.cr = !!e[5]; pl.pitch = +e[7] || 0;
      const st = CODE_ST[e[6]] || 'alive'; if (st !== 'alive' && pl.st === 'alive') pl.dist = goalDist(pl.tp.pos); pl.st = st;
    });
    const trex = TREX(); trex.forEach(a => a.netOn = false);
    (m.d || []).forEach(e => {
      const a = trex[e[0]]; if (!a) return;
      a.netOn = true; a.nx = e[1]; a.nz = e[2]; a.nh = e[3]; a.ns = e[4]; a.nl = e[5] / 100; a.ntr = e[6]; a.hunting = e[9];
      if (a.roarSeen === undefined) { a.roarSeen = e[7]; a.biteSeen = e[8]; }
      a.nroar = e[7]; a.nbite = e[8];
    });
    VS.nRex = m.n | 0; VS.spawnIn = m.sp | 0;
  }
  function followSnap(dt) {
    const k = 1 - Math.exp(-dt * 8);
    TREX().forEach(a => {
      if (!a.netOn) { a.d.root.visible = false; return; }
      if (!a.d.root.visible) { a.d.root.visible = true; a.pos.set(a.nx, 0, a.nz); a.heading = a.nh; }
      a.nx += Math.sin(a.nh) * a.ns * dt; a.nz += Math.cos(a.nh) * a.ns * dt; // keep moving between snapshots
      a.pos.x = lerp(a.pos.x, a.nx, k); a.pos.z = lerp(a.pos.z, a.nz, k);
      const dh = wrapA(a.nh - a.heading) * k; a.heading = wrapA(a.heading + dh); a.turnRate = dh / Math.max(dt, 1e-3);
      a.speed = a.ns; a.d.lunge = a.nl; a.tranq = a.ntr ? 1 : 0;
      a.state = a.hunting === VS.mySlot ? 'chase' : 'wander';
      a.d.look = a.hunting === VS.mySlot ? camera.position : a.hunting >= 0 && VS.players[a.hunting] ? VS.players[a.hunting].tp.pos : null;
      if (a.nroar !== a.roarSeen) { a.roarSeen = a.nroar; a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch, 1.4 * a.ai.size + 0.3, 2.4); }
      if (a.nbite !== a.biteSeen) { a.biteSeen = a.nbite; if (a.d.oneShot) a.d.oneShot('bite'); }
      applyDino(a, dt);
    });
  }

  // ---- host: more T-rexes arrive, out of every runner's way ----
  function trySpawnVS(dt, list) {
    if (!SPAWN_EVERY() || !canSpawn() || !list.length) return;
    spawnT -= dt; if (spawnT > 0) return;
    spawnT = SPAWN_EVERY();
    const a = roster.find(x => !x.d.root.visible); if (!a) return;
    for (let i = 0; i < 60; i++) {
      const anchor = list[Math.floor(Math.random() * list.length)].pos;
      const ang = Math.random() * Math.PI * 2, dist = 170 + Math.random() * 60;
      const p = new V(anchor.x + Math.sin(ang) * dist, 0, anchor.z + Math.cos(ang) * dist);
      if (Math.abs(p.x) > W.LIMIT - 20 || Math.abs(p.z) > W.LIMIT - 20 || W.ravineAt(p.x, p.z)) continue;
      if (list.some(tp => Math.hypot(tp.pos.x - p.x, tp.pos.z - p.z) < 140)) continue;
      activateDino(a, p, Math.atan2(anchor.x - p.x, anchor.z - p.z), true);
      a.home.lerp(anchor, 0.25);
      const n = roster.filter(x => x.d.root.visible).length, y = W.height(p.x, p.z) + 4;
      A.roar(new V(p.x, y, p.z), a.ai.roarPitch, 2.2, 2.6); msg(`🦖 森の奥で新たな咆哮が響いた…（ティラノ ${n}頭）`, 3);
      DG.Net.broadcast({ t: 'fx', k: 'spawn', x: p.x, y, z: p.z, n });
      return;
    }
  }
  // the runners still in the race, as the host's AI sees them
  const runners = () => VS.players.filter(p => p && p.st === 'alive').map(p => p.tp);

  // ---- caught / goal / end ----
  function vsCaught(a, tp) {
    const p = VS.players[tp.slot]; if (!p || p.st !== 'alive') return;
    p.st = 'dead'; p.dist = goalDist(tp.pos); p.time = VS.raceT;
    a.attackT = -1; a.feedT = 4; a.state = 'wander'; a.aware = 0.3; a.timer = 4; a.tgtP = null; a.home.copy(a.pos);
    A.roar(a.d.headPos(), a.ai.roarPitch * 1.1, 1.6, 1.8); a.d.roar(2.2);
    if (tp.local) localCaught(a); else if (p.id) DG.Net.send({ t: 'caught', k: TREX().indexOf(a) }, p.id);
    VS.players.forEach(o => { if (o && o !== p && o.st === 'alive') tell(o.tp, `${p.name} が恐竜に捕まった`, 2.5); });
    vsCheckEnd();
  }
  function localCaught(a) {
    VS.dead = { a, t: 0 }; state = 'dead'; shake = 0.25; if (document.pointerLockElement) document.exitPointerLock();
    $('pause').style.display = 'none';
    if (a) A.roar(a.d.headPos(), a.ai.roarPitch * 1.1, 1.6, 1.8);
  }
  // one set of pickups for everybody: the host decides who reached one first, and tells everyone it is gone
  function vsClaim(i) {
    if (VS.phase !== 'race') return;
    if (VS.host) hostTake(i, VS.mySlot); else DG.Net.send({ t: 'take', i });
  }
  function hostTake(i, slot) {
    if (!items.take(i, slot === VS.mySlot)) return;
    DG.Net.broadcast({ t: 'took', i, s: slot });
  }
  function vsGoal(slot, time) {
    const p = VS.players[slot]; if (!p || p.st !== 'alive' || VS.winner >= 0) return;
    p.st = 'goal'; p.dist = 0; p.time = time; VS.winner = slot;
    vsCheckEnd();
  }
  function vsCheckEnd() {
    if (!VS.host || (VS.phase !== 'race' && VS.phase !== 'count')) return;
    const ps = VS.players.filter(Boolean);
    if (VS.winner < 0 && ps.some(p => p.st === 'alive')) return;
    ps.forEach(p => { if (p.st === 'alive') p.dist = goalDist(p.tp.pos); });
    const order = { goal: 0, alive: 1, dead: 2, gone: 3 };
    const r = ps.slice().sort((a, b) => order[a.st] - order[b.st] || a.dist - b.dist).map(p => [p.slot, ST_CODE[p.st], Math.round(p.dist), +(p.time || VS.raceT).toFixed(1)]);
    DG.Net.broadcast({ t: 'end', w: VS.winner, r });
    showRaceEnd(VS.winner, r);
  }
  function showRaceEnd(w, r) {
    VS.phase = 'end'; if (state === 'play' || state === 'pause') state = 'win';
    r.forEach(e => { const p = VS.players[e[0]]; if (p) { p.st = CODE_ST[e[1]] || p.st; p.dist = e[2]; } });
    VS.panelT = 0; vsHud(0, 0);
    if (document.pointerLockElement) document.exitPointerLock();
    $('pause').style.display = 'none'; $('count').style.display = 'none';
    const wp = VS.players[w];
    $('endTitle').textContent = w >= 0 && wp ? (w === VS.mySlot ? '🏆 あなたの勝ち！' : `🏆 ${wp.name} の勝ち`) : '全員脱落';
    $('endTitle').style.color = w === VS.mySlot ? '#c9e6a0' : w >= 0 ? '#ffe2a0' : '#e05a40';
    $('endText').textContent = `3人対戦（難易度：${VD().name}）　レース時間 ${VS.raceT.toFixed(1)} 秒`;
    const tag = ['走行中', '脱落', 'ゴール', '切断'];
    $('endRank').innerHTML = r.map((e, i) => {
      const p = VS.players[e[0]]; if (!p) return '';
      return `<div>${i + 1}位　<span class="dot" style="background:${p.color}"></span>${esc(p.name)}${e[0] === VS.mySlot ? '（あなた）' : ''}　${tag[e[1]]}${e[1] === 2 ? '' : `　救難信号まで ${e[2]} m`}</div>`;
    }).join('');
    $('btnRetry').textContent = 'ロビーへ'; $('btnTitle').textContent = '部屋を出る';
    $('end').style.display = 'flex';
  }

  // ---- the race's frame ----
  const cv0 = new V();
  function versusTick(dt) {
    if (VS.phase === 'count') {
      VS.countT -= dt; const c = $('count');
      c.style.display = 'flex'; c.textContent = VS.countT > 0.5 ? String(Math.ceil(VS.countT - 0.5)) : 'GO!';
      if (VS.countT <= 0.5 && VS.countT + dt > 0.5) VS.phase = 'race';
    } else if ($('count').style.display !== 'none' && VS.phase === 'race' && VS.raceT > 1) $('count').style.display = 'none';
    const live = VS.phase === 'race', me = VS.players[VS.mySlot];
    if (live) VS.raceT += dt;
    // my runner
    if (me && me.st === 'alive' && (VS.phase === 'count' || live) && state === 'play') { runT += dt; updatePlayer(dt); items.update(dt, T); }
    else items.view();
    me && (me.tp === LOCAL) && (me.yaw = P.yaw, me.pitch = P.pitch, me.cr = P.crouch);
    // the dinosaurs
    let threat = 0;
    if (VS.host) {
      const list = runners();
      VS.baits = VS.baits.filter(b => { b.t -= dt; return b.t > -5; });
      if (live) trySpawnVS(dt, list);
      roster.forEach(a => { if (!a.d.root.visible) return; if (live) updateDino(a, dt, true, list); else applyDino(a, dt); });
      VS.sendT -= dt; if (VS.sendT <= 0 && VS.phase !== 'end') { VS.sendT = 0.1; sendSnap(); }
      roster.forEach(a => { if (a.d.root.visible && a.tgtP === LOCAL && (a.state === 'chase' || a.state === 'charge')) threat = Math.max(threat, 1 - a.pos.distanceTo(P.pos) / 45); });
    } else {
      followSnap(dt);
      VS.sendT -= dt;
      if (VS.sendT <= 0 && me && me.st === 'alive' && VS.phase !== 'end') { VS.sendT = 0.1; DG.Net.send({ t: 'me', x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), yaw: +P.yaw.toFixed(3), pt: +P.pitch.toFixed(3), cr: P.crouch ? 1 : 0, n: +P.noise.toFixed(2), v: +P.vis.toFixed(2) }); }
      TREX().forEach(a => { if (a.d.root.visible && a.hunting === VS.mySlot) threat = Math.max(threat, 1 - a.pos.distanceTo(P.pos) / 45); });
    }
    updateAvatars(dt);
    // camera when out of the race: the catch, then following whoever is still running
    if (VS.dead) {
      const D = VS.dead; D.t += dt;
      if (D.t < 3 && D.a) {
        const k0 = D.a, mp = k0.d.mouthPos(), S = k0.ai.size, kf = new V(Math.sin(k0.heading), 0, Math.cos(k0.heading));
        const want = mp.clone().addScaledVector(kf, 1.6 * S + 0.9 - Math.min(1, D.t * 0.5) * (0.9 * S)).add(new V(0, -0.25 * S, 0));
        want.y = Math.max(want.y, W.height(want.x, want.z) + 0.4);
        camera.position.lerp(want, 1 - Math.exp(-dt * 4));
        const m4 = new THREE.Matrix4().lookAt(camera.position, mp, new V(0, 1, 0)); camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m4), 1 - Math.exp(-dt * 8));
        $('vign').style.opacity = Math.min(1, 0.5 + D.t * 0.4);
        if (D.t > 2.2 && D.t - dt <= 2.2) msg('脱落… ほかのプレイヤーを観戦中', 4);
      } else spectate(dt);
    } else if (me && me.st === 'goal') spectate(dt);
    world.update(dt, T, VS.dead || (me && me.st !== 'alive') ? camera.position : P.pos);
    A.listener(camera.position, camera.getWorldDirection(cv0));
    specUI();
    vsHud(dt, clamp(threat, 0, 1));
  }
  // ---- watching the others once you are out (or home): pick whom to watch and from where ----
  // fp: through their eyes, back: from behind them (drag to swing around), top: from above (drag to turn, wheel to zoom)
  const SPEC = { slot: -1, mode: 'back', oy: 0, op: 0.3, dist: 7, ty: 0, tp: 1.1, tdist: 26, pos: new V(), yaw: 0, pitch: 0, snap: true, shown: false, key: '' };
  const SPEC_MODES = ['fp', 'back', 'top'];
  const specTargets = () => VS.players.filter(p => p && p.st === 'alive' && p.slot !== VS.mySlot);
  function specActive() {
    const me = VS.players[VS.mySlot];
    return VS.on && VS.phase === 'race' && (VS.dead ? VS.dead.t >= 3 : !!me && me.st === 'goal');
  }
  function specCur() {
    const list = specTargets();
    let t = list.find(p => p.slot === SPEC.slot);
    if (!t && list.length) {
      const lost = SPEC.slot >= 0 && VS.players[SPEC.slot];
      t = list.slice().sort((a, b) => goalDist(a.tp.pos) - goalDist(b.tp.pos))[0];
      if (lost) msg(`${lost.name} は${lost.st === 'goal' ? 'ゴールした' : lost.st === 'gone' ? '切断した' : '脱落した'} → ${t.name} を観戦`, 3);
      SPEC.slot = t.slot; SPEC.snap = true;
    }
    return t || null;
  }
  function specSwitch(step) {
    const list = specTargets(); if (!list.length) return;
    const i = list.findIndex(p => p.slot === SPEC.slot);
    const t = list[((i < 0 ? 0 : i + step) % list.length + list.length) % list.length];
    if (t.slot !== SPEC.slot) { SPEC.slot = t.slot; SPEC.snap = true; SPEC.ty = t.yaw; }
  }
  function specMode(m) {
    if (!SPEC_MODES.includes(m)) return;
    SPEC.mode = m; SPEC.oy = 0;
    const t = specCur(); if (t) SPEC.ty = t.yaw;
    try { localStorage.setItem('dg_spec_mode', m); } catch (e) { }
  }
  function bindSpectate() {
    try { const m = localStorage.getItem('dg_spec_mode'); if (SPEC_MODES.includes(m)) SPEC.mode = m; } catch (e) { }
    $('specPrev').onclick = () => specSwitch(-1);
    $('specNext').onclick = () => specSwitch(1);
    document.querySelectorAll('#specModes button').forEach(b => b.onclick = () => specMode(b.dataset.m));
    $('specHint').textContent = DG.MOBILE ? 'ドラッグで回転（後ろから・上空から）' : '← → / A D 切り替え ／ V・1〜3 視点 ／ ドラッグで回転 ／ ホイールで距離';
    const cv = renderer.domElement; let id = null, lx = 0, ly = 0;
    cv.addEventListener('pointerdown', e => { if (!specActive() || id !== null) return; id = e.pointerId; lx = e.clientX; ly = e.clientY; try { cv.setPointerCapture(id); } catch (er) { } });
    cv.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const k = (DG.MOBILE ? 0.006 : 0.005) * SENS, dx = (e.clientX - lx) * k, dy = (e.clientY - ly) * k; lx = e.clientX; ly = e.clientY;
      if (SPEC.mode === 'back') { SPEC.oy -= dx; SPEC.op = clamp(SPEC.op + dy, -0.15, 1.3); }
      else if (SPEC.mode === 'top') { SPEC.ty -= dx; SPEC.tp = clamp(SPEC.tp + dy, 0.45, 1.5); }
    });
    const end = e => { if (e.pointerId === id) id = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    addEventListener('wheel', e => {
      if (!specActive()) return;
      const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      if (SPEC.mode === 'back') SPEC.dist = clamp(SPEC.dist * f, 3, 22); else if (SPEC.mode === 'top') SPEC.tdist = clamp(SPEC.tdist * f, 12, 90);
    }, { passive: true });
  }
  function specKey(code) {
    if (!specActive()) return;
    if (code === 'ArrowLeft' || code === 'KeyA' || code === 'KeyQ') specSwitch(-1);
    else if (code === 'ArrowRight' || code === 'KeyD' || code === 'KeyE') specSwitch(1);
    else if (code === 'KeyV' || code === 'Space') specMode(SPEC_MODES[(SPEC_MODES.indexOf(SPEC.mode) + 1) % SPEC_MODES.length]);
    else { const m = /^Digit([1-3])$/.exec(code); if (m) specMode(SPEC_MODES[+m[1] - 1]); }
  }
  function specUI() {
    const on = specActive(), t = on ? specCur() : null;
    if (on !== SPEC.shown) { SPEC.shown = on; $('spec').style.display = on ? 'block' : 'none'; document.body.classList.toggle('watching', on); SPEC.key = ''; }
    if (!on) return;
    const n = specTargets().length, key = (t ? t.slot : -1) + SPEC.mode + n;
    if (key === SPEC.key) return; SPEC.key = key;
    $('specWho').innerHTML = t ? `<span class="dot" style="background:${t.color}"></span>${esc(t.name)} を観戦中` : '観戦できるプレイヤーがいません';
    $('specPrev').style.visibility = $('specNext').style.visibility = n > 1 ? '' : 'hidden';
    document.querySelectorAll('#specModes button').forEach(b => b.classList.toggle('on', b.dataset.m === SPEC.mode));
  }
  const specQ = new THREE.Quaternion(), specE = new THREE.Euler(0, 0, 0, 'YXZ'), specM = new THREE.Matrix4(), UP = new V(0, 1, 0);
  function spectate(dt) {
    const t = specCur();
    let want, look = null;
    if (t) {
      const q = t.tp.pos, k = 1 - Math.exp(-dt * 10);
      if (SPEC.snap) { SPEC.pos.copy(q); SPEC.yaw = t.yaw; SPEC.pitch = t.pitch || 0; SPEC.snap = false; }
      SPEC.pos.lerp(q, k); SPEC.yaw = wrapA(SPEC.yaw + wrapA(t.yaw - SPEC.yaw) * k); SPEC.pitch = lerp(SPEC.pitch, t.pitch || 0, k);
      const s = SPEC.pos;
      if (SPEC.mode === 'fp') {
        want = s.clone();
        specE.set(SPEC.pitch, SPEC.yaw, 0); specQ.setFromEuler(specE);
      } else if (SPEC.mode === 'top') {
        const a = SPEC.ty, d = SPEC.tdist;
        want = new V(s.x + Math.sin(a) * Math.cos(SPEC.tp) * d, s.y + Math.sin(SPEC.tp) * d, s.z + Math.cos(a) * Math.cos(SPEC.tp) * d);
        look = new V(s.x, s.y - 1, s.z);
      } else {
        const a = SPEC.yaw + SPEC.oy, d = SPEC.dist;
        want = new V(s.x + Math.sin(a) * Math.cos(SPEC.op) * d, s.y + 0.4 + Math.sin(SPEC.op) * d, s.z + Math.cos(a) * Math.cos(SPEC.op) * d);
        look = new V(s.x, s.y - 0.3, s.z);
      }
    } else { want = new V(W.GOAL.x + 30, W.height(W.GOAL.x, W.GOAL.z) + 40, W.GOAL.z + 60); look = new V(W.GOAL.x, W.height(W.GOAL.x, W.GOAL.z), W.GOAL.z); }
    if (!(t && SPEC.mode === 'fp')) want.y = Math.max(want.y, W.height(want.x, want.z) + 1.2);
    const far = camera.position.distanceTo(want) > 60; // a new target far away: cut instead of flying across the map
    camera.position.lerp(want, far ? 1 : 1 - Math.exp(-dt * (t && SPEC.mode === 'fp' ? 14 : 5)));
    if (look) { specM.lookAt(camera.position, look, UP); specQ.setFromRotationMatrix(specM); }
    camera.quaternion.slerp(specQ, far ? 1 : 1 - Math.exp(-dt * (t && SPEC.mode === 'fp' ? 16 : 7)));
    $('vign').style.opacity = 0;
  }
  function vsHud(dt, threat) {
    const me = VS.players[VS.mySlot];
    const myAlive = me && me.st === 'alive';
    const gd = goalDist(P.pos);
    ['inv', 'stam', 'cross', 'status'].forEach(id => $(id).style.visibility = myAlive ? '' : 'hidden'); // nothing to hold while watching
    // while watching someone, the compass and the distance are theirs, turned the way the camera looks
    const st = !myAlive && specActive() ? specCur() : null;
    const vp = st ? SPEC.pos : P.pos, vyaw = st ? Math.atan2(-camera.getWorldDirection(cv0).x, -cv0.z) : P.yaw;
    $('dist').textContent = myAlive ? Math.round(gd) : st ? Math.round(goalDist(st.tp.pos)) : '—';
    const n = VS.host ? roster.filter(a => a.d.root.visible).length : VS.nRex, sp = VS.host ? (SPAWN_EVERY() && canSpawn() ? Math.ceil(spawnT) : -1) : VS.spawnIn;
    $('rexn').textContent = `🦖×${n}` + (sp > 0 ? `（次の出現まで ${sp}秒）` : '') + `　【${VD().name}・3人対戦】`;
    // compass: north/south… (and T-rexes while the motion detector runs)
    const c = $('compass'); let h = '';
    const mk = (ang, label, cls, style) => { const r = wrapA(ang - vyaw); if (Math.abs(r) < 1.6) h += `<span class="mk ${cls || ''}" style="left:${50 - r / 1.6 * 50}%;${style || ''}">${label}</span>`; };
    mk(0, 'N'); mk(Math.PI / 2, 'W'); mk(Math.PI, 'S'); mk(-Math.PI / 2, 'E');
    // (no marks for the other runners: they start evenly round the signal, so their directions would give it away)
    if (myAlive && items.radar > 0) roster.concat(VS.host ? [] : TREX()).forEach(a => { if (a.d.root.visible) mk(Math.atan2(-(a.pos.x - P.pos.x), -(a.pos.z - P.pos.z)), '🦖' + Math.round(a.pos.distanceTo(P.pos)), 'dn'); });
    c.innerHTML = h;
    if (!VS.dead) $('vign').style.opacity = clamp(threat * 1.1, 0, 0.9);
    heartT -= dt; if (myAlive && threat > 0.05 && heartT < 0) { A.heart(0.3 + threat * 0.7); heartT = 1.1 - threat * 0.65; }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').style.opacity = 0; }
    // everyone's distance to the signal, closest first
    VS.panelT -= dt;
    if (VS.panelT <= 0) {
      VS.panelT = 0.25;
      const rows = VS.players.filter(Boolean).map(p => ({ p, d: p.st === 'alive' ? goalDist(p.slot === VS.mySlot ? P.pos : p.tp.pos) : p.st === 'goal' ? 0 : p.dist }));
      rows.sort((a, b) => (a.p.st === 'goal' ? -1 : 0) - (b.p.st === 'goal' ? -1 : 0) || (a.p.st === 'alive' ? 0 : 1) - (b.p.st === 'alive' ? 0 : 1) || a.d - b.d);
      const tag = { dead: '脱落', gone: '切断', goal: 'ゴール' };
      $('race').innerHTML = '<div class="tbl"><div class="t">救難信号までの距離</div>' + rows.map(({ p, d }) =>
        `<div class="${p.slot === VS.mySlot ? 'me' : ''} ${p.st === 'dead' || p.st === 'gone' ? 'out' : ''} ${p.st === 'goal' ? 'won' : ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}　${p.st === 'alive' ? Math.round(d) + ' m' : tag[p.st] + (p.st === 'goal' ? '' : `（${Math.round(d)} m）`)}</div>`).join('') + '</div>';
    }
    // reaching the signal
    if (live() && myAlive && gd < 8) {
      if (VS.host) vsGoal(VS.mySlot, VS.raceT);
      else { me.st = 'goal'; me.dist = 0; DG.Net.send({ t: 'goal', time: +VS.raceT.toFixed(1) }); }
      state = 'win'; if (document.pointerLockElement) document.exitPointerLock();
      msg('救難信号に到着！ 結果を待っています…', 5);
    }
  }
  const live = () => VS.phase === 'race';

  // ---------------- main loop ----------------
  // three.js asks for the next frame only after this returns, so an error here would freeze the game for good:
  // report it and carry on with the next frame instead
  function loop() { try { tick(Math.min(clock.getDelta(), 1 / 20)); } catch (e) { console.error(e); } }
  DG._step = (n, dt) => { for (let i = 0; i < n; i++) tick(dt || 1 / 30); };
  function tick(dt) {
    T += dt; if (DG.MOBILE) touchUI();
    if (VS.on) { versusTick(dt); renderer.render(world.scene, camera); return; }
    if (state === 'menu') {
      const a = dexDino; dexT += dt;
      const R = 4 + a.s.ai.size * 7, cx = W.START.x, cz = W.START.z - 12; // centre of the start glade (see okAt in world.js)
      // walks a circle, but stops to roar (the path advances by the distance actually walked, not by time)
      const w = Math.max(a.s.ai.walk * 0.75, a.d.minSpeed || 0);
      dexV = lerp(dexV, a.d.roaring ? 0 : w, 1 - Math.exp(-dt * (a.d.roaring ? 9 : 2))); dexS += dexV * dt;
      const ang = dexS / R;
      a.pos.set(cx + Math.cos(ang) * R, 0, cz + Math.sin(ang) * R); a.heading = Math.atan2(-Math.sin(ang), Math.cos(ang)) ;
      a.speed = dexV; a.turnRate = -dexV / R;
      if (Math.floor((dexT - 3) / 9) !== Math.floor((dexT - 3 - dt) / 9) && dexT > 3) { a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch, 0.8, 2.4); }
      applyDino(a, dt);
      const camA = -dexT * 0.08 + 0.6, cr = a.s.ai.size * 13 + 7;
      camera.position.set(cx + Math.cos(camA) * cr, W.height(cx, cz) + a.s.ai.size * 3 + 1.2, cz + Math.sin(camA) * cr);
      const hp = a.d.headPos(); camera.lookAt(lerp(cx, hp.x, 0.5), hp.y * 0.6 + a.pos.y * 0.4, lerp(cz, hp.z, 0.5));
      a.d.look = camera.position;
      world.update(dt, T, a.pos);
    } else if (state === 'play') {
      runT += dt; updatePlayer(dt); items.update(dt, T);
      let threat = 0;
      trySpawn(dt);
      dinos.forEach(a => { if (!a.d.root.visible) return; updateDino(a, dt, true); if (a.state === 'chase' || a.state === 'charge') threat = Math.max(threat, 1 - a.pos.distanceTo(P.pos) / 45); });
      world.update(dt, T, P.pos);
      A.listener(camera.position, camera.getWorldDirection(new V()));
      hud(dt, clamp(threat, 0, 1));
    } else if (state === 'dead' && killer) { // (a race has its own catch camera, without a single-player killer)
      deadT += dt;
      if (deadT >= 0.9 && deadT - dt < 0.9) killer.d.roar(2.2); // roar over the victim
      dinos.forEach(a => { if (a !== killer && a.d.root.visible) updateDino(a, dt, false); });
      killer.speed = 0; killer.d.jawT = 1; killer.d.lunge = Math.max(0, 1 - deadT * 0.4) * 0.6; applyDino(killer, dt);
      const mp = killer.d.mouthPos(), S = killer.ai.size;
      const kf = new V(Math.sin(killer.heading), 0, Math.cos(killer.heading));
      const want = mp.clone().addScaledVector(kf, 1.6 * S + 0.9 - Math.min(1, deadT * 0.5) * (0.9 * S)).add(new V(0, -0.25 * S, 0));
      want.y = Math.max(want.y, W.height(want.x, want.z) + 0.4);
      camera.position.lerp(want, 1 - Math.exp(-dt * 4));
      const m = new THREE.Matrix4().lookAt(camera.position, mp, new V(0, 1, 0)); const q = new THREE.Quaternion().setFromRotationMatrix(m);
      camera.quaternion.slerp(q, 1 - Math.exp(-dt * 8));
      camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0.02, shake - dt * 0.1);
      $('vign').style.opacity = Math.min(1, 0.5 + deadT * 0.4);
      world.update(dt, T, P.pos);
      if (deadT > 2.2 && $('end').style.display !== 'flex') {
        $('endTitle').textContent = '捕食された'; $('endTitle').style.color = '#e05a40';
        $('endText').textContent = `${killer.s.name}に捕まった。 生存時間 ${runT.toFixed(1)} 秒（難易度：${DF.name}）`; $('end').style.display = 'flex';
      }
    } else if (state === 'pause' || state === 'win') {
      world.update(0, T, P.pos);
    }
    renderer.render(world.scene, camera);
  }
})();
