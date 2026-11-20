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
  // direction hints (off by default): the signal's direction on the compass, and in a race also the other runners
  // on it and every runner starting turned toward the signal. Single play: the player's choice on the title screen;
  // a race: the host's choice in the room, the same for everybody.
  let HINTS = false;
  try { HINTS = localStorage.getItem('dg_hints') === '1'; } catch (e) { }
  function setHints(on) {
    HINTS = !!on; try { localStorage.setItem('dg_hints', HINTS ? '1' : '0'); } catch (e) { }
    document.querySelectorAll('#hintBtns button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === HINTS));
  }
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
    setLoad(0.1, '小物のモデルを読み込み中'); await DG.PROPS.load();
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
    DG._dbg = { renderer, camera, get world() { return world; }, newMap, beginGame, dinos, P, items, VS, SPEC, TREX, CO, keys, TI, coTest: ids => coTest(ids), coProp: (kind, i) => coProp(kind, i || 0),
      // (testing, host: the first stalker steps up to player `slot` and catches them)
      catchTest(slot) {
        const p = VS.players[slot], a = TREX().find(x => x.d.root.visible) || TREX()[0]; if (!p || !a) return 'none';
        const q = p.tp.pos, yaw = slot === VS.mySlot ? P.yaw : p.yaw;
        a.d.root.visible = true; a.pos.set(q.x - Math.sin(yaw) * 4.4, 0, q.z - Math.cos(yaw) * 4.4); a.heading = yaw;
        coCaught(a, p.tp, p); return 'caught ' + slot;
      }, get roster2() { return roster; }, get state() { return state; }, set state(v) { state = v; }, get roster() { return roster; },
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
  // the race uses T-rexes only (every player has the same set); the co-op swamp has its own stalker (species.js spino)
  const TREX = () => dinos.filter(a => a.s.key === (VS.mode === 'coop' && DG.SPECIES.spino && DG.SPECIES.spino._usesModel ? 'spino' : 'trex'));

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
  function lureAt(pos, kind, src, radius) {
    const R = radius || (kind === 'meat' ? 120 : 100), close = kind === 'meat' ? 18 : 12; let n = 0;
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
    if (VS.on && COOP()) coDartHit();
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
    TI.reset = () => { sid = null; lid = null; TI.mx = TI.mz = 0; TI.jump = false; TI.act = false; knob.style.transform = ''; base.classList.remove('on'); base.style.left = base.style.top = ''; };
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
    press('tAct', () => TI.act = true, () => TI.act = false);
    press('tLight', () => coToggleLight());
    press('tPing', () => coPing());
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
    document.querySelectorAll('#hintBtns button').forEach(b => b.onclick = () => setHints(b.dataset.v === '1'));
    setHints(HINTS);
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
      if (VS.on && COOP() && state === 'play' && !e.repeat) { if (e.code === 'KeyR') coToggleLight(); if (e.code === 'KeyG') coPing(); }
      if (state === 'play') { const m = /^Digit([1-9])$/.exec(e.code); if (m && +m[1] <= DG.ITEM_ORDER.length) items.select(+m[1] - 1); if (e.code === 'KeyF') items.use(); }
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
  // the full-screen black (a catch's blackout) and red edge (being caught, a predator close) off
  function resetScreenFx() { $('fade').style.opacity = 0; $('vign').style.opacity = 0; }
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
    killer = null; runT = 0; shake = 0; items.reset(DF); resetScreenFx();
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
      if (!hunter && !spots[a.s.key]) { activateDino(a, along(0.5, 0), 0, false); return; } // a co-op-only species: kept out of the forest
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
    a.tranq = 0; a.detourT = 0; a.stun = 0; a.blind = 0;
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
    // co-op: carrying something heavy (no running or jumping), the stimulant and its crash afterwards
    const co = W.COOP && VS.on, bag = co ? coMine() : '', heavy = !!HEAVY[bag], stim = items.stim > 0, crash = items.crash > 0;
    const adr = items.adren > 0 || stim;
    if (P.stam <= 0) P.exhausted = true; if (P.exhausted && (P.stam > 0.35 || adr)) P.exhausted = false;
    const sprint = sprintKey && moving && !P.exhausted && !P.crouch && mz > 0.3 && !heavy && !crash;
    let spd = P.crouch ? 2.0 : sprint ? (stim ? 9.6 : adr ? 8.8 : 7.8) : 4.3;
    if (heavy) spd *= 0.62; if (crash) spd *= 0.65;
    const wd = W.COOP ? W.waterDepth(P.pos.x, P.pos.z) : 0; // a swamp pool: wading is slow and loud
    if (wd > 0) spd *= 1 - Math.min(0.45, wd * 0.5);
    P.stam = clamp(P.stam + (sprint ? (adr ? 0 : -0.15) : (moving ? 0.08 : 0.14)) * dt, 0, 1);
    fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)); right.set(-fwd.z, 0, fwd.x);
    const wish = fwd.clone().multiplyScalar(mz).addScaledVector(right, mx); if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(spd);
    // co-op: crouching while sprinting is a slide — fast and low for a moment, then down in a crouch
    if (co && P.crouch && !P.wasCrouch && P.ground && P.wasSprint && !heavy) { P.slide = 0.75; A.whoosh(); }
    P.wasCrouch = P.crouch;
    if (P.slide > 0) { P.slide -= dt; const hv = Math.hypot(P.vel.x, P.vel.z) || 1, sv = 4 + 7.5 * Math.max(0, P.slide) / 0.75; wish.set(P.vel.x / hv * sv, 0, P.vel.z / hv * sv); }
    // ground steeper than 45° (ravine walls) can't be stood on: no walking up it, no jumping off it, and you slide down
    const sl = slopeAt(P.pos.x, P.pos.z), steep = P.ground && sl.m > MAX_SLOPE && !onLip(P.pos.x, P.pos.z);
    const sx = sl.x, sz = sl.z, sm = sl.m;
    if (steep) { const ux = sx / sm, uz = sz / sm, up = wish.x * ux + wish.z * uz; if (up > 0) { wish.x -= ux * up; wish.z -= uz * up; } }
    // co-op: the wire hook reels you in towards where it caught (and up over the edge, if that was a trunk or rock)
    if (P.hook) {
      const hd = new V().subVectors(P.hook.to, P.pos), hl = hd.length(); P.hook.t -= dt;
      if (hl < 1.3 || P.hook.t <= 0) { if (P.hook.up) P.vel.y = Math.max(P.vel.y, 5); P.hook = null; }
      else { P.vel.copy(hd.multiplyScalar(Math.min(24, hl * 6 + 6) / hl)); P.ground = false; }
    }
    if (!P.hook) {
      const k = 1 - Math.exp(-dt * (P.ground ? (P.slide > 0 ? 4 : 10) : 1.5));
      P.vel.x = lerp(P.vel.x, wish.x, k); P.vel.z = lerp(P.vel.z, wish.z, k);
      if (steep) { P.vel.x -= sx / sm * 26 * dt; P.vel.z -= sz / sm * 26 * dt; }
      P.vel.y -= 22 * dt;
    }
    // a jump still counts for a moment after running off an edge ("coyote time"), so pressing it a little late at a
    // ravine's lip doesn't drop you in
    P.coyote = P.ground && !steep ? 0.12 : Math.max(0, (P.coyote || 0) - dt);
    if ((P.ground && !steep || P.coyote > 0 && P.vel.y < 1) && !held && (keys.Space || TI.jump) && !P.crouch && !heavy && !P.hook) { P.vel.y = 6.5; P.ground = false; P.coyote = 0; }
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
    const prevB = Math.sin(P.bob); P.bob += dt * hs * 1.9;
    if (P.ground && prevB > 0 && Math.sin(P.bob) <= 0 && hs > 0.5) { if (wd > 0.05) A.splash(P.crouch ? 0.4 : sprint ? 1.2 : 0.8); else A.crunch(P.crouch ? 0.3 : sprint ? 1.2 : 0.7); }
    P.noise = P.ground ? (hs < 0.3 ? 0 : P.crouch ? 0.12 : sprint ? 1 : 0.45) : 0.5;
    if (wd > 0.05 && hs > 0.3) P.noise = Math.max(P.noise, P.crouch ? 0.3 : 0.7);
    if (P.slide > 0) P.noise = Math.max(P.noise, 0.35);
    if (bag === 'hurt') P.noise = Math.max(P.noise, 0.5); // the injured man groans
    const cov = world.cover(P.pos.x, P.pos.z);
    P.vis = (P.crouch ? (cov > 0.42 ? 0.22 : 0.6) : 1) * (items.camo > 0 ? 0.45 : 1);
    if (W.COOP) P.vis *= (coLightOn() ? 1.15 : 0.6) * (bag === 'egg' ? 1.4 : 1); // at night a lit torch is seen from far off; an egg is smelt
    camera.position.copy(P.pos); camera.position.y += Math.sin(P.bob * 2) * 0.035 * Math.min(1, hs / 4);
    camera.rotation.set(0, 0, 0); camera.rotation.order = 'YXZ'; camera.rotation.y = P.yaw; camera.rotation.x = P.pitch;
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 0.8); }
    $('stamBar').style.width = (P.stam * 100) + '%'; $('stamBar').style.background = P.exhausted ? '#c0503a' : '#e8e2cf';
    const st = [];
    if (P.crouch) st.push(P.vis < 0.3 ? '🌿 茂みに隠れている' : 'しゃがみ中');
    if (P.exhausted) st.push('息切れ…');
    if (items.adren > 0) st.push(`💉 アドレナリン ${items.adren.toFixed(0)}秒`);
    if (stim) st.push(`💊 興奮剤 ${items.stim.toFixed(0)}秒`); if (crash) st.push(`💊 反動で足が重い ${items.crash.toFixed(0)}秒`);
    if (bag) st.push(`${BAG_NAME[bag]}を運んでいる${heavy ? '（重くて走れない）' : '（匂いで狙われやすい）'}`);
    if (P.slide > 0) st.push('スライディング');
    if (items.camo > 0) st.push(`🟫 迷彩中 ${items.camo.toFixed(0)}秒`);
    if (items.radar > 0) st.push(`📡 探知中 ${items.radar.toFixed(0)}秒 — ` + dinos.filter(a => a.d.root.visible).map(a => Math.round(a.pos.distanceTo(P.pos)) + 'm' + (a.tranq > 0 ? '（麻酔）' : '') + (a.state === 'eat' ? '（食事中）' : a.state === 'fixate' ? '（発煙筒に釘付け）' : a.state === 'investigate' ? '（移動中）' : a.state === 'chase' ? '（追跡中！）' : '')).join(' / '));
    $('status').innerHTML = st.join('<br>');
    P.wasSprint = sprint;
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
    const ck = VS.on && COOP() ? coSenseK() : null; // co-op: fog dims its eyes, a storm drowns footsteps, the calm carries them
    const sr = ai.sight * DF.sense * tp.vis * (ck ? ck[0] : 1); if (dist < sr && rel < 1.7) gain += (1.6 * (1 - dist / sr) + 0.2) * (flareLured ? 0.12 : 1); // eyes on the light
    const hr = ai.hear * DF.sense * tp.noise * (ck ? ck[1] : 1); if (dist < hr && !flareLured) gain += 2.2 * (1 - dist / hr) + 0.2;
    if (a.state === 'eat') gain *= 0.35; // busy eating: much less attentive
    if (dist < 6 * ai.size + 3) gain += 1.5; // right next to it: always noticed
    if (a.blind > 0) gain *= 0.05; // dazzled by a flashbang
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
    if (a.stun > 0) { // caught in a trap or knocked senseless: stands there, thrashing
      a.stun -= dt; a.speed = lerp(a.speed, 0, 1 - Math.exp(-dt * 8)); a.turnRate = 0; a.attackT = -1; d.lunge = 0;
      if (a.stun <= 0) { a.state = 'wander'; a.aware = 0.5; a.timer = 0; a.home.copy(a.pos); }
      applyDino(a, dt); return;
    }
    if (a.blind > 0) a.blind -= dt;
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
        desiredHeading = Math.atan2(tgt.x - a.pos.x, tgt.z - a.pos.z); desiredSpeed = ai.run * DF.speed * (VS.on && COOP() ? coSpeedK() : 1);
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
    if (HINTS) mk(Math.atan2(-(W.GOAL.x - P.pos.x), -(W.GOAL.z - P.pos.z)), '▼', 'gl');
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
    inRoom: false, on: false, host: false, code: '', mySlot: 0, players: [], phase: 'idle', seed: 0, diff: 'hard', hints: false, mode: 'race',
    countT: 0, sendT: 0, panelT: 0, raceT: 0, ready: new Set(), winner: -1, baits: [], dead: null, nRex: 0, spawnIn: 0, raceMap: false, avatars: []
  };
  const VS_COLORS = ['#e8553c', '#3c9be8', '#e8c43c', '#6fd36a'];
  // (co-op adds: ghost = caught, still roaming as a ghost; escaped = on the helicopter)
  const ST_CODE = { alive: 0, dead: 1, goal: 2, gone: 3, ghost: 4, escaped: 5 }, CODE_ST = ['alive', 'dead', 'goal', 'gone', 'ghost', 'escaped'];
  const COOP = () => VS.mode === 'coop';
  const MAX_PLAYERS = () => COOP() ? 4 : 3;
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
  function setVsMode(m) {
    VS.mode = m === 'coop' ? 'coop' : 'race';
    if (VS.host) { try { localStorage.setItem('dg_vs_mode', VS.mode); } catch (e) { } sendLobby(); }
    renderLobby();
  }
  function setVsHints(on) {
    VS.hints = !!on;
    if (VS.host) { try { localStorage.setItem('dg_vs_hints', VS.hints ? '1' : '0'); } catch (e) { } sendLobby(); }
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
    document.querySelectorAll('#vsHintBtns button').forEach(b => b.onclick = () => { if (VS.host && VS.phase === 'lobby') setVsHints(b.dataset.v === '1'); });
    document.querySelectorAll('#vsModeBtns button').forEach(b => b.onclick = () => { if (VS.host && VS.phase === 'lobby') setVsMode(b.dataset.m); });
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
    $('vsList').innerHTML = [0, 1, 2, 3].map(s => {
      const p = VS.players[s];
      return `<li><span class="dot" style="background:${VS_COLORS[s]}"></span>${p ? esc(p.name) + (s === VS.mySlot ? '（あなた）' : '') + (s === 0 ? ' — ホスト' : '') : `<span style="color:#777">空き${s === 3 ? '（協力のみ）' : ''}</span>`}</li>`;
    }).join('');
    document.querySelectorAll('#vsModeBtns button').forEach(b => { b.classList.toggle('on', b.dataset.m === VS.mode); b.disabled = !VS.host; });
    $('vsModeInfo').textContent = (COOP()
      ? '協力（2〜4人）：夜の湿地。20種類から選ばれた6つのミッションを2つずつ3段階で果たし、毎回変わる脱出手段（ヘリ・ボート・坑道）で逃げる。捕まった人は幽霊になり、仲間を導ける（救急キットで生き返れる）'
      : 'レース（2〜3人）：救難信号に最初にたどり着いた人の勝ち') + (VS.host ? '' : '（ホストが選びます）');
    $('vsHintRow').style.display = $('vsHintInfo').style.display = COOP() ? 'none' : '';
    $('vsGo').textContent = COOP() ? '協力開始' : '対戦開始';
    const df = VD();
    document.querySelectorAll('#vsDiffBtns button').forEach(b => { b.classList.toggle('on', b.dataset.k === VS.diff); b.disabled = !VS.host; });
    const cd = coDiff(VS.diff);
    $('vsDiffInfo').textContent = (COOP()
      ? `沼の捕食者 ${cd.count}頭 ／ 走る速さ 約${Math.round(DG.SPECIES.trex.ai.run * cd.speed * 3.6)}km/h ／ 夜目と耳の届く距離 ${Math.round(cd.sense * 100)}% ／ 最初の持ち物 爆竹1個`
      : `ティラノ：最初 ${df.count}頭 → ${df.spawnEvery}秒ごとに1頭増えて最大 ${df.max}頭 ／ 走る速さ 約${Math.round(DG.SPECIES.trex.ai.run * df.speed * 3.6)}km/h ／ ` +
        `目と耳の届く距離 ${Math.round(df.sense * 100)}% ／ 最初の発煙筒 ${df.startFlare}本`) + (VS.host ? '' : '（難易度はホストが選びます）');
    document.querySelectorAll('#vsHintBtns button').forEach(b => { b.classList.toggle('on', (b.dataset.v === '1') === VS.hints); b.disabled = !VS.host; });
    $('vsHintInfo').textContent = (VS.hints ? 'あり：コンパスに救難信号の方向（赤い▼）とほかのプレイヤー（●）が出て、全員が救難信号の方を向いてスタート'
      : 'なし：救難信号の方向はわからず、全員ばらばらの方向を向いてスタート（距離だけが手がかり）') + (VS.host ? '' : '（ホストが選びます）');
    const n = VS.players.filter(Boolean).length, max = MAX_PLAYERS();
    $('vsGo').style.display = VS.host ? '' : 'none';
    $('vsGo').disabled = n < 2 || n > max;
    if (VS.inRoom && !VS.host) vsStatus(`ホストが${COOP() ? '協力プレイ' : '対戦'}を始めるのを待っています…`);
    else if (VS.inRoom && n > max) vsStatus('レースは3人までです。協力モードにするか、1人に抜けてもらってください');
    else if (VS.inRoom && n < 2) vsStatus('ほかのプレイヤーの参加を待っています…');
    else if (VS.inRoom && n < max) vsStatus(`${n}人で始められます（${max}人まで入れます）`);
    else if (VS.inRoom) vsStatus(`${n}人そろいました。「${COOP() ? '協力開始' : '対戦開始'}」で始まります`);
  }
  async function vsCreate() {
    vsStatus('部屋を作っています…');
    try {
      const code = await DG.Net.host();
      let d = 'hard'; try { d = vsDiffKey(localStorage.getItem('dg_vs_difficulty')); } catch (e) { }
      let hn = false; try { hn = localStorage.getItem('dg_vs_hints') === '1'; } catch (e) { }
      let md = 'race'; try { md = localStorage.getItem('dg_vs_mode') === 'coop' ? 'coop' : 'race'; } catch (e) { }
      Object.assign(VS, { inRoom: true, host: true, code, mySlot: 0, players: [mkPlayer(0, null, myName())], phase: 'lobby', diff: d, hints: hn, mode: md });
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
    DG.Net.close(); coCleanup();
    const hadRace = VS.raceMap;
    Object.assign(VS, { inRoom: false, on: false, host: false, code: '', players: [], phase: 'idle', raceMap: false, dead: null });
    VS.avatars.forEach(g => g.visible = false);
    $('vsLobby').style.display = 'none'; $('race').style.display = 'none'; $('count').style.display = 'none'; $('spec').style.display = 'none'; SPEC.shown = false; document.body.classList.remove('watching');
    $('btnRetry').textContent = 'もう一度'; $('btnTitle').textContent = 'タイトルへ'; $('endRank').innerHTML = ''; vsStatus('');
    setDiff(diffKey); toMenu();
    if (hadRace) { // the race map has no glade for the title screen and three starts; build a normal one, kept for the next game
      building = true; newMap().then(() => { mapUsed = false; }).finally(() => { building = false; });
    }
  }
  function vsAbort(text) { vsLeaveRoom(); openLobby(); vsStatus(text); }
  // after a race: back to the room (the host can start another one)
  function vsToLobby() {
    VS.on = false; VS.phase = 'lobby'; VS.dead = null; coCleanup();
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
    else {
      p.left = true;
      if (p.st === 'alive') { p.st = 'gone'; p.dist = goalDist(p.tp.pos); if (COOP()) coDropAll(p); }
      else if (p.st === 'ghost') p.st = 'gone';
      VS.ready.add(p.slot); vsMaybeGo(); vsCheckEnd();
    }
  }
  function sendLobby() {
    VS.players.forEach(p => { if (p && p.id) DG.Net.send({ t: 'lobby', you: p.slot, code: VS.code, list: vsList(), diff: VS.diff, hints: VS.hints ? 1 : 0, mode: VS.mode }, p.id); });
  }
  function hostMsg(id, m) {
    const p = playerById(id);
    if (m.t === 'hello') {
      if (p) return;
      const slot = [1, 2, 3].find(s => !VS.players[s]); // (a 4th seat counts in co-op only; the race won't start with 4)
      if (VS.phase !== 'lobby' || !slot) { DG.Net.send({ t: 'busy', why: VS.phase !== 'lobby' ? 'プレイ中のため入れません' : '部屋が満員です（4人まで）' }, id); setTimeout(() => DG.Net.kick(id), 500); return; }
      VS.players[slot] = mkPlayer(slot, id, m.name); sendLobby(); renderLobby();
      return;
    }
    if (!p) return;
    if (m.t === 'ready') { VS.ready.add(p.slot); vsMaybeGo(); }
    else if (m.t === 'me' && (p.st === 'alive' || p.st === 'ghost')) {
      p.tp.pos.set(+m.x || 0, +m.y || 0, +m.z || 0); p.tp.vis = clamp(+m.v || 0, 0, 1.2); p.tp.noise = clamp(+m.n || 0, 0, 1); p.yaw = +m.yaw || 0; p.pitch = clamp(+m.pt || 0, -1.5, 1.5); p.cr = !!m.cr;
      p.fl = !!m.fl; p.hold = typeof m.h === 'string' ? m.h.slice(0, 8) : '';
    } else if (m.t === 'lure' && VS.phase === 'race') {
      const pos = new V(+m.x || 0, +m.y || 0, +m.z || 0);
      const bait = m.kind === 'meat' ? { pos, eaten: false, remote: true } : { pos, t: DF.flareTime, remote: true, get dead() { return this.t <= 0; } };
      if (m.kind !== 'meat') VS.baits.push(bait);
      const n = lureAt(pos, m.kind === 'meat' ? 'meat' : 'flare', bait);
      if (n) tell(p.tp, lureText(m.kind === 'meat' ? 'meat' : 'flare'), 2.2);
    } else if (m.t === 'dart' && VS.phase === 'race') {
      const a = TREX()[m.k | 0]; if (a && a.d.root.visible) tranq(a, p.tp);
    } else if (m.t === 'take' && VS.phase === 'race' && p.st === 'alive') hostTake(m.i | 0, p.slot);
    else if (m.t === 'goal' && VS.phase === 'race' && p.st === 'alive' && !COOP()) vsGoal(p.slot, +m.time || VS.raceT);
    else if (m.t === 'ping' && COOP() && VS.phase === 'race' && p.st === 'ghost') coAddPing(+m.x || 0, +m.z || 0, p.slot);
    else if (m.t === 'it' && COOP() && VS.phase === 'race' && p.st === 'alive') {
      const x = clamp(+m.x || 0, -W.LIMIT, W.LIMIT), z = clamp(+m.z || 0, -W.LIMIT, W.LIMIT);
      if (m.k === 'trap') coAddTrap(x, z);
      else if (m.k === 'signal') coSignal(x, z, p.slot);
      else if (m.k === 'medkit') { const g = VS.players[m.s | 0]; if (g && g.st === 'ghost' && g.tp.pos.distanceTo(p.tp.pos) < 8) coReviveHost(g.slot, p.tp.pos); }
      else if (['cracker', 'flash', 'dyn'].includes(m.k)) coLandHost(m.k, new V(x, +m.y || W.height(x, z), z), p.slot);
    }
  }
  function guestMsg(m) {
    if (m.t === 'busy') { vsAbort(m.why || '部屋に入れませんでした'); return; }
    if (m.t === 'lobby') {
      const was = VS.inRoom;
      VS.inRoom = true; VS.mySlot = m.you | 0; VS.code = m.code || VS.code; VS.diff = vsDiffKey(m.diff); VS.hints = !!m.hints; VS.mode = m.mode === 'coop' ? 'coop' : 'race';
      const old = VS.players; VS.players = [];
      (m.list || []).forEach(e => { VS.players[e.s] = mkPlayer(e.s, null, e.name); if (old[e.s]) VS.players[e.s].st = old[e.s].st; });
      if (VS.phase === 'idle') VS.phase = 'lobby';
      if (!was || $('vsLobby').style.display === 'flex') openLobby(); else renderLobby();
    } else if (m.t === 'start') { VS.diff = vsDiffKey(m.diff); VS.hints = !!m.hints; VS.mode = m.mode === 'coop' ? 'coop' : 'race'; vsPrepare(m.seed | 0, m.list || []); }
    else if (m.t === 'go') { if (VS.phase === 'loading') VS.goPending = true; else vsGo(); }
    else if (m.t === 'snap') applySnap(m);
    else if (m.t === 'took') { if (VS.on) items.take(m.i | 0, (m.s | 0) === VS.mySlot); }
    else if (m.t === 'caught') { const me = VS.players[VS.mySlot]; if (me && me.st === 'alive') { me.st = 'dead'; me.dist = goalDist(P.pos); localCaught(TREX()[m.k | 0]); } }
    else if (m.t === 'tell') msg(String(m.m || '').slice(0, 60), +m.d || 2);
    else if (m.t === 'fx' && m.k === 'bolt') coBolt(+m.d || 1);
    else if (m.t === 'fx' && m.k === 'it') { if (VS.on && (m.s | 0) !== VS.mySlot && ['cracker', 'flash', 'dyn'].includes(m.i)) items.fxAt(m.i, new V(+m.x, +m.y, +m.z)); }
    else if (m.t === 'give') { if (VS.on) items.give(String(m.k)); }
    else if (m.t === 'revive') { if (VS.on && coGhost()) coRevived(new V(+m.x, +m.y, +m.z)); }
    else if (m.t === 'fx' && m.k === 'spawn') { A.roar(new V(+m.x, +m.y, +m.z), DG.SPECIES.trex.ai.roarPitch, 2.2, 2.6); msg(`🦖 森の奥で新たな咆哮が響いた…（ティラノ ${m.n | 0}頭）`, 3); }
    else if (m.t === 'end') showRaceEnd(m.w, m.r || []);
  }

  // ---- starting a race ----
  async function vsStartRace() {
    const n = VS.players.filter(Boolean).length;
    if (!VS.host || VS.phase === 'loading' || n < 2 || n > MAX_PLAYERS()) return;
    VS.seed = (Math.random() * 1e6) | 0;
    DG.Net.broadcast({ t: 'start', seed: VS.seed, list: vsList(), diff: VS.diff, hints: VS.hints ? 1 : 0, mode: VS.mode });
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
    $('loading').style.display = ''; setLoad(0.4, COOP() ? '夜の湿地を生成中' : '対戦用の森を生成中'); await frame(); await frame();
    coCleanup();
    const scene = world.scene;
    world.dispose(); W.reseed(seed, COOP() ? 'coop' : true);
    world = W.create(renderer, { scene, layout: { veg: 1, fern: 1 } });
    dinos.forEach(a => { a.d.ground = W.height; });
    if (COOP()) coLightsMake(); // before compiling, so the flashlights don't recompile every shader mid-game
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
    if (COOP()) return coGo();
    $('loading').style.display = 'none';
    VS.on = true; VS.phase = 'count'; VS.countT = 3.5;
    DF = VD();
    ['menu', 'end', 'pause', 'vsLobby'].forEach(id => $(id).style.display = 'none'); $('hud').style.display = 'block'; $('race').style.display = 'block';
    const st = W.STARTS[VS.mySlot] || W.START;
    P.pos.set(st.x, W.height(st.x, st.z) + 1.65, st.z); P.vel.set(0, 0, 0); P.eye = 1.65; P.ground = true;
    // facing the signal with hints on; otherwise any way, and where the signal is has to be found out
    P.yaw = VS.hints ? Math.atan2(-(W.GOAL.x - st.x), -(W.GOAL.z - st.z)) : Math.random() * Math.PI * 2;
    P.pitch = 0; P.stam = 1; P.crouch = false; P.exhausted = false; TI.run = false; TI.jump = false;
    camera.position.copy(P.pos); camera.rotation.set(0, P.yaw, 0, 'YXZ'); // already there behind the pause screen
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
    dinos.forEach(a => { a.d.root.visible = false; a.tgtP = null; a.netOn = false; a.roarSeen = undefined; a.biteSeen = undefined; a.catchSeen = undefined; a.feedT = 0; a.d.look = null; clearCatch(a); });
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

  // ---- the other runners: a survivor made with MPFB (MakeHuman, CC0 assets) and animated in Blender, the jacket
  // tinted a little toward their colour, their name above; idle / walk / run / crouch picked from how they move.
  // A caught co-op player is a glowing see-through ghost of the same figure, drifting (Float). Until the model has
  // loaded (or with no server) a simple capsule figure stands in.
  const HUMAN = { gltf: null, tried: false, H: 1.78 };
  // clips and the ground speed (m/s) each one is animated for
  const HCLIPS = { Idle: 0, Walk: 1.2, Run: 3.6, CrouchIdle: 0, CrouchWalk: 0.6, Float: 0 };
  function loadHuman() {
    if (HUMAN.tried || !DG.loadGLB) return; HUMAN.tried = true;
    DG.loadGLB('models/human/survivor.glb').then(g => {
      if (!g) return;
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene, true);
      HUMAN.k = HUMAN.H / Math.max(0.01, box.max.y - box.min.y); HUMAN.y0 = -box.min.y * HUMAN.k;
      HUMAN.clip = n => g.animations.find(a => a.name.split('|').pop() === n);
      HUMAN.gltf = g;
      if (VS.avatars.length) ensureAvatars(); // swap the stand-ins for the model
    });
  }
  loadHuman();
  function humanFigure(p, g) {
    const sc = THREE_SkeletonUtils.clone(HUMAN.gltf.scene), inner = new THREE.Group();
    inner.add(sc); inner.scale.setScalar(HUMAN.k); inner.position.y = HUMAN.y0; inner.rotation.y = Math.PI; // the model faces +Z, a runner looks down -Z
    const col = new THREE.Color(p.color), mats = [];
    sc.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false; o.userData.shared = true; // the geometry belongs to the loaded model
      o.material = (Array.isArray(o.material) ? o.material : [o.material]).map(m0 => {
        const m = m0.clone(); m.metalness = 0;
        // hair, brows and lashes: cut out by their alpha (no sorting troubles); everything else solid
        if (/short|hair|eyebrow|eyelash/i.test(m0.name)) { m.transparent = false; m.alphaTest = 0.45; m.depthWrite = true; m.side = THREE.DoubleSide; }
        else { m.transparent = false; m.depthWrite = true; }
        if (/suit/i.test(m0.name)) m.color.lerp(col, 0.3); // a hint of the player's colour on the clothes
        m.userData.base = { color: m.color.clone(), alphaTest: m.alphaTest }; mats.push(m); return m;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
    g.add(inner);
    const mix = new THREE.AnimationMixer(sc), act = {}, w = {};
    for (const n in HCLIPS) { const c = HUMAN.clip(n); if (c) { act[n] = mix.clipAction(c); act[n].play(); act[n].setEffectiveWeight(0); w[n] = 0; act[n].time = Math.random() * c.duration; } }
    w.Idle = 1;
    Object.assign(g.userData, { mix, act, mats, col, w, ghost: null, last: g.position.clone(), spd: 0 });
    if (act.Idle) act.Idle.setEffectiveWeight(1);
  }
  // see-through glow for a ghost (b = true), or back to the solid figure
  function humanGhost(g, b) {
    const u = g.userData; if (!u.mats || u.ghost === b) return; u.ghost = b;
    u.mats.forEach(m => {
      m.transparent = b; m.opacity = b ? 0.38 : 1; m.depthWrite = !b; m.blending = b ? THREE.AdditiveBlending : THREE.NormalBlending; m.alphaTest = b ? 0 : m.userData.base.alphaTest;
      if (b) { m.color.copy(u.col).lerp(new THREE.Color(0xbfe4ff), 0.4).multiplyScalar(0.45); m.emissive.copy(u.col).lerp(new THREE.Color(0xbfe4ff), 0.35).multiplyScalar(0.5); }
      else { m.color.copy(m.userData.base.color); m.emissive.setRGB(0, 0, 0); }
      m.needsUpdate = true;
    });
    g.traverse(o => { if (o.isMesh) o.castShadow = !b; });
  }
  function ensureAvatars() {
    VS.avatars.forEach(g => {
      world.scene.remove(g); if (g.userData.mix) g.userData.mix.stopAllAction();
      g.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
    });
    VS.avatars = [];
    VS.players.forEach(p => {
      if (!p || p.slot === VS.mySlot) return;
      const g = new THREE.Group();
      if (HUMAN.gltf) humanFigure(p, g);
      else {
        const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75 });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.85, 4, 10), mat); body.position.y = 0.72; g.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.8 })); head.position.y = 1.47; g.add(head);
        const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.18), new THREE.MeshStandardMaterial({ color: 0x3b3a2c, roughness: 0.9 })); pack.position.set(0, 0.95, 0.24); g.add(pack);
      }
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const c = cv.getContext('2d');
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 10, 256, 44); c.font = 'bold 32px sans-serif'; c.textAlign = 'center'; c.fillStyle = p.color; c.fillText(p.name, 128, 44);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); tag.scale.set(1.8, 0.45, 1); tag.position.y = 2.15; g.add(tag);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.userData.slot = p.slot; g.position.copy(p.tp.pos).y -= 1.65; if (g.userData.last) g.userData.last.copy(g.position);
      world.scene.add(g); VS.avatars.push(g);
    });
  }
  function updateAvatars(dt) {
    const k = 1 - Math.exp(-dt * 12);
    VS.avatars.forEach(g => {
      const p = VS.players[g.userData.slot]; if (!p) { g.visible = false; return; }
      g.visible = !TREX().some(a => a.catch && a.catch.slot === p.slot) && (p.st === 'alive' || p.st === 'goal' || (p.st === 'ghost' && (coGhost() || (COOP() && items.inv.medkit > 0 && coMe() && coMe().st === 'alive')))) && !(SPEC.mode === 'fp' && SPEC.slot === p.slot && specActive()); // not in our own way when looking through their eyes
      g.position.x = lerp(g.position.x, p.tp.pos.x, k); g.position.z = lerp(g.position.z, p.tp.pos.z, k);
      const ghost = p.st === 'ghost', u = g.userData;
      g.position.y = ghost ? lerp(g.position.y, p.tp.pos.y - 1.65, k) + (u.mix ? Math.sin(performance.now() / 600 + u.slot) * 0.12 : 0) : Math.max(W.height(g.position.x, g.position.z), lerp(g.position.y, p.tp.pos.y - 1.65, k));
      g.rotation.y = p.yaw; g.scale.y = lerp(g.scale.y, p.cr && !ghost && !u.mix ? 0.62 : 1, k); // (the figure crouches by itself)
      if (!u.mix || !g.visible) return;
      // how fast they move over the ground (positions come ten times a second, so smooth it)
      const sp = Math.hypot(g.position.x - u.last.x, g.position.z - u.last.z) / Math.max(dt, 1e-3); u.last.copy(g.position);
      u.spd = lerp(u.spd, Math.min(sp, 12), 1 - Math.exp(-dt * 6));
      humanGhost(g, ghost);
      const s = u.spd, want = ghost ? 'Float' : p.cr ? (s > 0.4 ? 'CrouchWalk' : 'CrouchIdle') : s > 2.6 ? 'Run' : s > 0.5 ? 'Walk' : 'Idle', kw = 1 - Math.exp(-dt * 8);
      for (const n in u.act) { u.w[n] = lerp(u.w[n], n === want ? 1 : 0, kw); u.act[n].setEffectiveWeight(u.w[n]); }
      // play the stride at the speed they move (within reason)
      if (u.act.Walk) u.act.Walk.timeScale = clamp(s / HCLIPS.Walk, 0.6, 2.0);
      if (u.act.Run) u.act.Run.timeScale = clamp(s / HCLIPS.Run, 0.8, 2.1);
      if (u.act.CrouchWalk) u.act.CrouchWalk.timeScale = clamp(s / HCLIPS.CrouchWalk, 0.6, 2.6);
      u.mix.update(dt);
    });
  }

  // ---- host: sending the state of the race; guest: applying it ----
  function sendSnap() {
    const p = [];
    VS.players.forEach(pl => { if (!pl) return; const q = pl.tp.pos; p.push([pl.slot, +q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), +pl.yaw.toFixed(3), pl.cr ? 1 : 0, ST_CODE[pl.st] | 0, +(pl.pitch || 0).toFixed(3), (pl.slot === VS.mySlot ? coLightOn() : pl.fl) ? 1 : 0]); });
    const d = [];
    TREX().forEach((a, k) => {
      if (!a.d.root.visible) return;
      const hunting = a.tgtP && (a.state === 'alert' || a.state === 'chase' || a.state === 'charge' || a.state === 'cool') ? a.tgtP.slot : -1;
      d.push([k, +a.pos.x.toFixed(2), +a.pos.z.toFixed(2), +a.heading.toFixed(3), +a.speed.toFixed(2), Math.round(a.d.lunge * 100), a.tranq > 0 ? 1 : 0, a.roarN, a.biteN, hunting, a.catchN | 0, a.catchSlot == null ? -1 : a.catchSlot]);
    });
    const m = { t: 'snap', p, d, n: roster.filter(a => a.d.root.visible).length, sp: SPAWN_EVERY() && canSpawn() ? Math.ceil(spawnT) : -1 };
    if (COOP()) m.co = coState();
    DG.Net.broadcast(m);
  }
  function applySnap(m) {
    (m.p || []).forEach(e => {
      const pl = VS.players[e[0]]; if (!pl) return;
      if (e[0] === VS.mySlot) { if (CODE_ST[e[6]] === 'escaped' && pl.st === 'alive') { pl.st = 'escaped'; $('coPrompt').style.display = 'none'; } return; } // (co-op: the host decides when I'm on the helicopter)
      pl.tp.pos.set(e[1], e[2], e[3]); pl.yaw = e[4]; pl.cr = !!e[5]; pl.pitch = +e[7] || 0; pl.fl = !!e[8];
      const st = CODE_ST[e[6]] || 'alive'; if (st !== 'alive' && pl.st === 'alive') pl.dist = goalDist(pl.tp.pos); pl.st = st;
    });
    const trex = TREX(); trex.forEach(a => a.netOn = false);
    (m.d || []).forEach(e => {
      const a = trex[e[0]]; if (!a) return;
      a.netOn = true; a.nx = e[1]; a.nz = e[2]; a.nh = e[3]; a.ns = e[4]; a.nl = e[5] / 100; a.ntr = e[6]; a.hunting = e[9];
      if (a.roarSeen === undefined) { a.roarSeen = e[7]; a.biteSeen = e[8]; }
      a.nroar = e[7]; a.nbite = e[8];
      if (a.catchSeen === undefined) a.catchSeen = e[10] | 0;
      a.ncatch = e[10] | 0; a.ncatchSlot = e[11] == null ? -1 : e[11];
    });
    VS.nRex = m.n | 0; VS.spawnIn = m.sp | 0;
    if (m.co) coApply(m.co);
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
      if (a.ncatch !== a.catchSeen) { a.catchSeen = a.ncatch; if (catchInfo(a) && !(a.catch && a.catch.slot === a.ncatchSlot)) startCatch(a, a.ncatchSlot); }
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
    if (COOP()) return coCaught(a, tp, p);
    p.st = 'dead'; p.dist = goalDist(tp.pos); p.time = VS.raceT;
    a.attackT = -1; a.feedT = 4; a.state = 'wander'; a.aware = 0.3; a.timer = 4; a.tgtP = null; a.home.copy(a.pos);
    A.roar(a.d.headPos(), a.ai.roarPitch * 1.1, 1.6, 1.8); a.d.roar(2.2);
    if (tp.local) localCaught(a); else if (p.id) DG.Net.send({ t: 'caught', k: TREX().indexOf(a) }, p.id);
    VS.players.forEach(o => { if (o && o !== p && o.st === 'alive') tell(o.tp, `${p.name} が恐竜に捕まった`, 2.5); });
    vsCheckEnd();
  }
  function localCaught(a) {
    if (COOP() && catchInfo(a) && !(a.catch && a.catch.slot === VS.mySlot)) startCatch(a, VS.mySlot);
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
    if (COOP()) { if (!coAlive().length) coEnd(); return; }
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
    if (COOP()) {
      A.hum(false); $('coPrompt').style.display = 'none';
      const esc0 = r.filter(e => CODE_ST[e[1]] === 'escaped').length, all = r.filter(e => CODE_ST[e[1]] !== 'gone').length;
      $('endTitle').textContent = esc0 && esc0 === all ? '全員脱出！' : esc0 ? `${esc0}人が脱出` : '全滅…';
      $('endTitle').style.color = esc0 ? '#c9e6a0' : '#e05a40';
      $('endText').textContent = `協力（難易度：${VD().name}）　夜明けまで ${VS.raceT.toFixed(1)} 秒`;
      const tg = { escaped: ESC_ICON[W.SITES.esc] + ' 脱出', alive: '取り残された', ghost: '👻 捕まった', dead: '👻 捕まった', gone: '切断' };
      $('endRank').innerHTML = r.map(e => { const p = VS.players[e[0]]; if (!p) return ''; return `<div><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${e[0] === VS.mySlot ? '（あなた）' : ''}　${tg[CODE_ST[e[1]]] || ''}</div>`; }).join('');
      $('btnRetry').textContent = 'ロビーへ'; $('btnTitle').textContent = '部屋を出る';
      $('end').style.display = 'flex';
      return;
    }
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
    if (me && me.st === 'alive' && (VS.phase === 'count' || live) && state === 'play') { runT += dt; updatePlayer(dt); items.update(dt, T); if (COOP() && live) coLocal(); }
    else if (COOP() && me && me.st === 'ghost' && state === 'play') { updateGhost(dt); items.view(); }
    else items.view();
    if (COOP() && !(me && me.st === 'alive' && live && state === 'play')) { CO.hold = ''; if (!(me && me.st === 'alive')) $('coPrompt').style.display = 'none'; }
    me && (me.tp === LOCAL) && (me.yaw = P.yaw, me.pitch = P.pitch, me.cr = P.crouch, me.hold = CO.hold, me.fl = CO.light);
    // the dinosaurs
    let threat = 0;
    if (VS.host) {
      const list = runners();
      VS.baits = VS.baits.filter(b => { b.t -= dt; return b.t > -5; });
      if (live) trySpawnVS(dt, list);
      if (live && COOP()) {
        coDirector(dt, coAlive()); coMission(dt, coAlive()); coEvents(dt);
        CO.boltT -= dt; if (CO.boltT < 0) { CO.boltT = 22 + Math.random() * 35; const d = 0.8 + Math.random() * 2.5; DG.Net.broadcast({ t: 'fx', k: 'bolt', d }); coBolt(d); }
      }
      roster.forEach(a => { if (!a.d.root.visible) return; if (live) updateDino(a, dt, true, list); else applyDino(a, dt); });
      VS.sendT -= dt; if (VS.sendT <= 0 && VS.phase !== 'end') { VS.sendT = 0.1; sendSnap(); }
      roster.forEach(a => { if (a.d.root.visible && a.tgtP === LOCAL && (a.state === 'chase' || a.state === 'charge')) threat = Math.max(threat, 1 - a.pos.distanceTo(P.pos) / 45); });
    } else {
      followSnap(dt);
      VS.sendT -= dt;
      if (VS.sendT <= 0 && me && (me.st === 'alive' || me.st === 'ghost') && VS.phase !== 'end') {
        VS.sendT = 0.1;
        DG.Net.send({ t: 'me', x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), yaw: +P.yaw.toFixed(3), pt: +P.pitch.toFixed(3), cr: P.crouch ? 1 : 0, n: +P.noise.toFixed(2), v: +P.vis.toFixed(2), fl: coLightOn() ? 1 : 0, h: CO.hold });
      }
      TREX().forEach(a => { if (a.d.root.visible && a.hunting === VS.mySlot) threat = Math.max(threat, 1 - a.pos.distanceTo(P.pos) / 45); });
    }
    updateAvatars(dt);
    if (COOP()) { coFx(dt); updateCatches(dt); }
    // camera when out of the race: the catch, then following whoever is still running
    if (VS.dead) {
      const D = VS.dead; D.t += dt;
      const cat = COOP() && catchInfo(D.a) && D.a.catch;
      if (cat && D.t < catchInfo(D.a).len) catchCam(D, dt);
      else if (D.t < 3 && D.a && !catchInfo(D.a)) {
        const k0 = D.a, mp = k0.d.mouthPos(), S = k0.ai.size, kf = new V(Math.sin(k0.heading), 0, Math.cos(k0.heading));
        const want = mp.clone().addScaledVector(kf, 1.6 * S + 0.9 - Math.min(1, D.t * 0.5) * (0.9 * S)).add(new V(0, -0.25 * S, 0));
        want.y = Math.max(want.y, W.height(want.x, want.z) + 0.4);
        camera.position.lerp(want, 1 - Math.exp(-dt * 4));
        const m4 = new THREE.Matrix4().lookAt(camera.position, mp, new V(0, 1, 0)); camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m4), 1 - Math.exp(-dt * 8));
        $('vign').style.opacity = Math.min(1, 0.5 + D.t * 0.4);
        if (D.t > 2.2 && D.t - dt <= 2.2 && !COOP()) msg('脱落… ほかのプレイヤーを観戦中', 4);
      } else if (COOP()) { $('fade').style.opacity = 0; coBecomeGhost(); } else spectate(dt);
    } else if (me && (me.st === 'goal' || me.st === 'escaped')) spectate(dt);
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
    return VS.on && VS.phase === 'race' && (VS.dead ? VS.dead.t >= 3 && !COOP() : !!me && (me.st === 'goal' || me.st === 'escaped'));
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
    ['inv', 'stam', 'status'].forEach(id => $(id).style.visibility = myAlive ? '' : 'hidden'); // nothing to hold while watching
    $('cross').style.visibility = myAlive || coGhost() ? '' : 'hidden';
    // while watching someone, the compass and the distance are theirs, turned the way the camera looks
    const st = !myAlive && specActive() ? specCur() : null;
    const vp = st ? SPEC.pos : P.pos, vyaw = st ? Math.atan2(-camera.getWorldDirection(cv0).x, -cv0.z) : P.yaw;
    $('dist').textContent = myAlive ? Math.round(gd) : st ? Math.round(goalDist(st.tp.pos)) : '—';
    const n = VS.host ? roster.filter(a => a.d.root.visible).length : VS.nRex, sp = VS.host ? (SPAWN_EVERY() && canSpawn() ? Math.ceil(spawnT) : -1) : VS.spawnIn;
    $('rexn').textContent = `🦖×${n}` + (sp > 0 ? `（次の出現まで ${sp}秒）` : '') + `　【${VD().name}・${COOP() ? '協力' : '3人対戦'}】`;
    // compass: north/south… (and T-rexes while the motion detector runs)
    const c = $('compass'); let h = '';
    const mk = (ang, label, cls, style) => { const r = wrapA(ang - vyaw); if (Math.abs(r) < 1.6) h += `<span class="mk ${cls || ''}" style="left:${50 - r / 1.6 * 50}%;${style || ''}">${label}</span>`; };
    mk(0, 'N'); mk(Math.PI / 2, 'W'); mk(Math.PI, 'S'); mk(-Math.PI / 2, 'E');
    // with hints off, no marks for the signal or the other runners (they start evenly round the signal, so their
    // directions would give it away)
    if (COOP()) coCompass(mk, vp);
    else if (VS.hints) {
      mk(Math.atan2(-(W.GOAL.x - vp.x), -(W.GOAL.z - vp.z)), '▼', 'gl');
      VS.players.forEach(p => { if (p && p.slot !== VS.mySlot && p !== st && p.st === 'alive') mk(Math.atan2(-(p.tp.pos.x - vp.x), -(p.tp.pos.z - vp.z)), '●', '', `color:${p.color}`); });
    }
    if (myAlive && items.radar > 0) roster.concat(VS.host ? [] : TREX()).forEach(a => { if (a.d.root.visible) mk(Math.atan2(-(a.pos.x - P.pos.x), -(a.pos.z - P.pos.z)), '🦖' + Math.round(a.pos.distanceTo(P.pos)), 'dn'); });
    c.innerHTML = h;
    if (!VS.dead) $('vign').style.opacity = clamp(threat * 1.1, 0, 0.9);
    heartT -= dt; if (myAlive && threat > 0.05 && heartT < 0) { A.heart(0.3 + threat * 0.7); heartT = 1.1 - threat * 0.65; }
    if (COOP() && !myAlive && !VS.dead) $('vign').style.opacity = 0;
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').style.opacity = 0; }
    // everyone's distance to the signal, closest first
    VS.panelT -= dt;
    if (COOP()) VS.panelT = 1;
    else if (VS.panelT <= 0) {
      VS.panelT = 0.25;
      const rows = VS.players.filter(Boolean).map(p => ({ p, d: p.st === 'alive' ? goalDist(p.slot === VS.mySlot ? P.pos : p.tp.pos) : p.st === 'goal' ? 0 : p.dist }));
      rows.sort((a, b) => (a.p.st === 'goal' ? -1 : 0) - (b.p.st === 'goal' ? -1 : 0) || (a.p.st === 'alive' ? 0 : 1) - (b.p.st === 'alive' ? 0 : 1) || a.d - b.d);
      const tag = { dead: '脱落', gone: '切断', goal: 'ゴール' };
      $('race').innerHTML = '<div class="tbl"><div class="t">救難信号までの距離</div>' + rows.map(({ p, d }) =>
        `<div class="${p.slot === VS.mySlot ? 'me' : ''} ${p.st === 'dead' || p.st === 'gone' ? 'out' : ''} ${p.st === 'goal' ? 'won' : ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}　${p.st === 'alive' ? Math.round(d) + ' m' : tag[p.st] + (p.st === 'goal' ? '' : `（${Math.round(d)} m）`)}</div>`).join('') + '</div>';
    }
    // reaching the signal
    if (live() && myAlive && gd < 8 && !COOP()) {
      if (VS.host) vsGoal(VS.mySlot, VS.raceT);
      else { me.st = 'goal'; me.dist = 0; DG.Net.send({ t: 'goal', time: +VS.raceT.toFixed(1) }); }
      state = 'win'; if (document.pointerLockElement) document.exitPointerLock();
      msg('救難信号に到着！ 結果を待っています…', 5);
    }
  }
  const live = () => VS.phase === 'race';

  // ================= co-op (online, 2-4 players) =================
  // A night swamp. The team starts round the camp fire. Each game draws 6 missions from a pool of 20 and plays them
  // in three stages of two (either order within a stage; the later stages are the dangerous ones). When all six are
  // done, the way out of this game (also drawn: a helicopter, a boat or an old mine tunnel) has to be got going and
  // reached. Two stalkers hunt by sound and light. Anyone caught becomes a ghost: unseen and unheard, free to fly
  // about, able to see where everything is (hidden things too), and to put up a beam of light to guide the living —
  // and a survivor with a first-aid kit can bring a ghost back. Random events (a storm, fog, a blackout, a frenzy,
  // dead calm) change the night every minute or two. Supply crates hold the fuses (if that mission is drawn) or now
  // and then an item. The host runs the stalkers, the missions and the events (the race's machinery: VS.phase
  // 'race' means "live"); everyone else sends position, light and what they are holding E on.

  // ---- the missions ----
  // kind: hold (hold E at each of n spots) · code (read a code, open a safe) · fuse (crates -> fuse box) ·
  // carry (pick things up, bring them somewhere) · sync (two valves held at once) · gen (two at the generator) ·
  // photo (aim at a stalker up close) · tranq (dart hits) · cage (set a trap, lure one in) · zone (hold a place) · door
  // where: spot (an island) / water (standing in a pool) / any (anywhere on dry ground); mark: on the compass
  const MD = {
    relay: { tier: 1, kind: 'hold', icon: '📶', name: '中継アンテナの調整', desc: '湿地の3本のアンテナを調整する', n: 3, dur: 3, verb: 'アンテナを調整する', prop: 'antenna' },
    cams: { tier: 1, kind: 'hold', icon: '📷', name: 'トレイルカメラの回収', desc: '4台の監視カメラからメモリーカードを抜く', n: 4, dur: 1.5, verb: 'メモリーカードを抜く', prop: 'cam' },
    notes: { tier: 1, kind: 'hold', icon: '📄', name: '研究日誌の回収', desc: '散らばった5枚の日誌を拾う（場所はコンパスに出ない。白く光る紙を探す）', n: 5, dur: 0.6, verb: '日誌のページを拾う', prop: 'page', where: 'any', mark: false },
    fires: { tier: 1, kind: 'hold', icon: '🔥', name: 'かがり火', desc: '3つのかがり火をつける（火は遠くから目立つ）', n: 3, dur: 2, verb: 'かがり火をつける', prop: 'brazier', lureDone: 70 },
    samples: { tier: 1, kind: 'hold', icon: '🧪', name: '水質サンプル', desc: '3つの印の所で、水の中に立って水を採る（水音に注意）', n: 3, dur: 2.5, verb: '水を採取する', prop: 'buoy', where: 'water' },
    code: { tier: 1, kind: 'code', icon: '🔐', name: '金庫の暗証番号', desc: '掲示板で暗証番号を読み、金庫を開ける（読んだ人だけが開けられる）' },
    radio: { tier: 1, kind: 'hold', icon: '📻', name: '行方不明者の無線機', desc: '電子音を頼りに、落ちている無線機を見つける（コンパスに出ない）', n: 1, dur: 2, verb: '無線機を拾う', prop: 'radio', mark: false, beep: true },
    fuse: { tier: 2, kind: 'fuse', icon: '🔌', name: 'ヒューズの回収', desc: '木箱を調べてヒューズを見つけ、無線塔の配電盤に取り付ける' },
    fuel: { tier: 2, kind: 'carry', icon: '⛽', name: '燃料缶運び', desc: '燃料缶を無線塔の発電機まで運ぶ（重くて走れない）', item: 'fuel', n: 3, to: 'gen', heavy: true, prop: 'fuel' },
    valves: { tier: 2, kind: 'sync', icon: '🚰', name: '排水バルブ', desc: '離れた2つのバルブを、2人で同時に回し続ける', dur: 5, verb: 'バルブを回す（2人で同時に）', prop: 'valve' },
    eggs: { tier: 2, kind: 'carry', icon: '🥚', name: '卵の回収', desc: '巣から卵を2個キャンプへ運ぶ（卵を持つと匂いで狙われる）', item: 'egg', n: 3, need: 2, to: 'camp', nest: true, prop: 'egg' },
    photo: { tier: 2, kind: 'photo', icon: '📸', name: '捕食者の撮影', desc: '25m以内で捕食者にカメラを向け、E 長押しで撮影する', dur: 2.5 },
    drone: { tier: 2, kind: 'carry', icon: '🛸', name: '墜落ドローン', desc: '赤く点滅する墜落ドローンを見つけてキャンプへ運ぶ（重い・コンパスに出ない）', item: 'drone', n: 1, to: 'camp', heavy: true, prop: 'drone', mark: false },
    wires: { tier: 2, kind: 'hold', icon: '⚡', name: '電線の修理', desc: '3か所の切れた電線を直す（火花の音が響く）', n: 3, dur: 4, verb: '電線をつなぐ', prop: 'pole', lure: 80 },
    hurt: { tier: 2, kind: 'carry', icon: '🩹', name: '負傷者の搬送', desc: '動けない負傷者をキャンプまで運ぶ（重くて走れない、うめき声が出る）', item: 'hurt', n: 1, to: 'camp', heavy: true, prop: 'hurt' },
    gen: { tier: 3, kind: 'gen', icon: '⚙️', name: '発電機の始動', desc: '無線塔の発電機を2人で同時に動かす（音で捕食者が来る）' },
    tranq: { tier: 3, kind: 'tranq', icon: '🎯', name: '麻酔で眠らせる', desc: '麻酔銃を捕食者に2発当てる（全員に麻酔弾2発つき）', need: 2 },
    cage: { tier: 3, kind: 'cage', icon: '🪤', name: '檻の罠', desc: '檻に肉を仕掛け、捕食者を誘い込んで閉じ込める', prop: 'cage' },
    lookout: { tier: 3, kind: 'zone', icon: '🗼', name: '見張り台の死守', desc: '見張り台の周り（10m）に誰かがいる時間を合計40秒ためる', dur: 40, r: 10, prop: 'lookout' },
    door: { tier: 3, kind: 'door', icon: '🚪', name: '倉庫の扉', desc: '錆びた倉庫の扉をこじ開ける（合計14秒・大きな音）', dur: 14, verb: '扉をこじ開ける', prop: 'door', lure: 140 }
  };
  const MIDS = Object.keys(MD);
  const BAG = ['', 'fuel', 'egg', 'drone', 'hurt'], BAG_NAME = { fuel: '燃料缶', egg: '卵', drone: 'ドローン', hurt: '負傷者' };
  const HEAVY = { fuel: 1, drone: 1, hurt: 1 };
  const ESC_NAME = ['救助ヘリ', 'ボート', '旧坑道'], ESC_ICON = ['🚁', '🚤', '🕳️'];
  // the random events of the night: [name, seconds, message]
  const EV = {
    storm: ['嵐', 25, '⛈️ 嵐が来た — 雨音で足音がかき消される（25秒）'],
    fog: ['濃霧', 30, '🌫️ 濃い霧が出た — 何も見えない。奴らの目も利かない（30秒）'],
    blackout: ['停電', 12, '🔦 懐中電灯が消えた！ 電池が…（12秒）'],
    frenzy: ['狂乱', 20, '🩸 捕食者が狂ったように吠えている — 足が速い！（20秒）'],
    calm: ['静寂', 25, '🤫 雨がやみ、沼が静まり返った — 小さな音も響く（25秒）']
  };
  const EVK = Object.keys(EV);
  const CO = {
    phase: 'm', stage: 0, ms: [], esc: { step: 0, p: 0, t: 0 }, need: 2,
    fz: [0, 0, 0, 0], bag: ['', '', '', ''], know: 0, rd: [0, 0, 0, 0], code: '0000',
    fuseAt: new Set(), searched: new Set(), cs: [0, 0, 0, 0, 0, 0],
    drops: [], pings: [], traps: [], ev: { k: '', t: 0, next: 80 },
    dir: { t: 0, calm: 0, chase: 0, lull: 0 }, light: true, hold: '', pingCD: 0, boltT: 20, growlT: 3, beepT: 0, lureT: {},
    lights: null, rain: null, marks: null, wire: null, prevKey: '', hudT: 0, flashT: 0
  };
  // the co-op difficulty: the same dials, but two stalkers (three on the hardest level) there from the start, never more
  function coDiff(k) {
    const d = DG.DIFFS[vsDiffKey(k)], n = k === 'vhard' ? 3 : 2;
    return Object.assign({}, d, { count: n, max: n, spawnEvery: 0, items: d.items * 1.3, startFlare: Math.max(1, d.startFlare), mix: 0 });
  }
  const coAlive = () => VS.players.filter(p => p && p.st === 'alive');
  const tellAll = (text, dur) => VS.players.forEach(p => { if (p && p.st !== 'gone') tell(p.tp, text, dur); });
  const coMe = () => VS.players[VS.mySlot];
  const coGhost = () => { const me = coMe(); return !!me && me.st === 'ghost'; };
  const coActive = M => !!M && CO.phase === 'm' && M.stage === CO.stage && !M.done;
  const coMine = () => CO.bag[VS.mySlot] || '';
  // what the night does to the stalkers' senses and speed (read by senseGain / updateDino)
  function coSenseK() {
    const k = CO.ev.t > 0 ? CO.ev.k : '';
    return [k === 'fog' ? 0.55 : 1, k === 'storm' ? 0.5 : k === 'calm' ? 1.5 : 1];
  }
  const coSpeedK = () => CO.ev.t > 0 && CO.ev.k === 'frenzy' ? 1.18 : 1;
  const coLightOn = () => CO.light && !(CO.ev.t > 0 && CO.ev.k === 'blackout');
  function shuffle(a, rr) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ---- building this game's missions (on every machine, from the shared seed: no need to send them) ----
  function coBuild(nPlayers, force) {
    const rr = DG.N.rng(VS.seed + 31), S = W.SITES, L = W.LIMIT - 30;
    let ids = [1, 2, 3].flatMap(t => shuffle(MIDS.filter(id => MD[id].tier === t), rr).slice(0, 2));
    if (force) ids = force; // (testing: DG._dbg.coTest)
    // within a stage, the two missions in a random order (the HUD lists them so)
    const spots = shuffle(S.spots.slice(), rr); let si = 0;
    const far = q => Math.hypot(q.x - S.camp.x, q.z - S.camp.z) > 45;
    const randAt = test => { for (let k = 0; k < 400; k++) { const q = new V((rr() * 2 - 1) * L, 0, (rr() * 2 - 1) * L); if (far(q) && test(q)) return q; } return new V((rr() * 2 - 1) * L, 0, (rr() * 2 - 1) * L); };
    const spot = () => si < spots.length ? spots[si++].clone() : randAt(q => W.height(q.x, q.z) > W.WATER + 0.1);
    const water = () => randAt(q => W.waterDepth(q.x, q.z) > 0.35 && W.waterDepth(q.x, q.z) < 1.1);
    const dry = () => randAt(q => W.height(q.x, q.z) > W.WATER + 0.12);
    const tw = world.props.tower;
    CO.code = String(1000 + Math.floor(rr() * 9000));
    CO.ms = ids.map((id, i) => {
      const d = MD[id], M = { id, d, stage: Math.floor(i / 2), T: [], s: [], v: 0, need: 1, done: false, lure: 0 };
      const tg = (p, k, x) => M.T.push(Object.assign({ p, k: k || 't' }, x || {}));
      if (d.kind === 'hold') for (let k = 0; k < d.n; k++) tg(d.where === 'water' ? water() : d.where === 'any' ? dry() : spot());
      else if (d.kind === 'code') { tg(spot(), 'board'); tg(spot(), 'safe'); }
      else if (d.kind === 'fuse') { tg(tw.box.clone(), 'box'); M.need = nPlayers >= 4 ? 3 : 2; }
      else if (d.kind === 'carry') {
        const nest = d.nest ? spot() : null;
        for (let k = 0; k < d.n; k++) tg(nest ? nest.clone().add(new V(Math.cos(k * 2.1) * 0.9, 0, Math.sin(k * 2.1) * 0.9)) : spot(), 'src');
        tg(d.to === 'gen' ? tw.gen.clone() : S.camp.clone(), 'dst');
        M.need = d.need || (d.item === 'fuel' ? (nPlayers >= 4 ? 3 : 2) : d.n);
      } else if (d.kind === 'sync') {
        const a = spot(), ang = rr() * Math.PI * 2;
        const b = new V(clamp(a.x + Math.sin(ang) * 40, -L, L), 0, clamp(a.z + Math.cos(ang) * 40, -L, L));
        tg(a); tg(b);
      } else if (d.kind === 'gen') tg(tw.gen.clone());
      else if (d.kind === 'cage' || d.kind === 'zone' || d.kind === 'door') tg(spot());
      else if (d.kind === 'tranq') M.need = d.need;
      M.s = M.T.map(() => 0);
      return M;
    });
    // the crates: which hold a fuse (one spare), when that mission is drawn
    const fm = CO.ms.find(M => M.d.kind === 'fuse');
    CO.fuseAt = new Set(fm ? shuffle([0, 1, 2, 3, 4, 5], rr).slice(0, fm.need + 1) : []);
  }
  const coM = id => CO.ms.find(M => M.id === id);
  // testing: play these six missions instead (call it on every machine)
  function coTest(ids) {
    if (CO.marks) { [CO.marks.g, CO.marks.pg, CO.marks.dg, CO.marks.tg, CO.marks.props].forEach(o => { world.scene.remove(o); disposeTree(o); }); CO.marks = null; }
    CO.ms.forEach(M => M.T.forEach(t => { if (t.lab && t.lab.parent) world.scene.remove(t.lab); }));
    coBuild(VS.players.filter(Boolean).length, ids); coMarksMake(); CO.stage = 0; CO.phase = 'm'; CO.esc = { step: 0, p: 0, t: 0 };
  }

  // ---- things in the scene the map doesn't own: flashlights, rain, mission props, labels, pings, traps ----
  // Flashlights: one spotlight per seat, made before the map's shaders are compiled (adding lights later would
  // recompile every material mid-game). Only the local one casts shadows (desktop).
  function coLightsMake() {
    if (CO.lights) return;
    CO.lights = [0, 1, 2, 3].map(i => {
      const l = new THREE.SpotLight(0xfff0d8, 0, 60, 0.5, 0.55, 1.2);
      if (i === VS.mySlot && !DG.MOBILE) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0008; l.shadow.camera.near = 0.3; }
      world.scene.add(l, l.target); return l;
    });
  }
  function labelSprite(text, color, scale) {
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 72; const c = cv.getContext('2d');
    c.font = 'bold 36px sans-serif'; c.textAlign = 'center'; c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,.75)';
    c.strokeText(text, 160, 50); c.fillStyle = color; c.fillText(text, 160, 50);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    const k = scale || 1; s.scale.set(4.4 * k, 1 * k, 1); s.renderOrder = 10; return s;
  }
  const glowS = (color, s, op) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: DG.T.soft(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: op == null ? 0.8 : op, fog: false })); sp.scale.setScalar(s); return sp; };
  const gy = p => Math.max(W.height(p.x, p.z), W.WATER);
  // simple props for the mission targets (no lights: glows are sprites)
  // the injured survivor: the Adventurer figure posed at the end of its fall, lying along the stretcher
  function hurtFigure() {
    if (!HUMAN.gltf) return null;
    const sc = THREE_SkeletonUtils.clone(HUMAN.gltf.scene), g = new THREE.Group(), inner = new THREE.Group();
    inner.add(sc); inner.scale.setScalar(HUMAN.k); g.add(inner);
    sc.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.userData.shared = true; } });
    const c = HUMAN.clip('Lie') || HUMAN.clip('Death');
    if (c) { const mx = new THREE.AnimationMixer(sc); mx.clipAction(c).play(); mx.setTime(c.name === 'Lie' ? 0 : c.duration - 0.01); }
    // centre the lying body on the stretcher, along it
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(inner, true), s = b.getSize(new V()), ctr = b.getCenter(new V());
    if (s.x > s.z) inner.rotation.y = Math.PI / 2;
    g.updateMatrixWorld(true); b.setFromObject(inner, true); b.getCenter(ctr);
    inner.position.set(-ctr.x, -b.min.y, -ctr.z);
    return g;
  }
  function coProp(kind, k) {
    const g = new THREE.Group(), m = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8 }, o || {}));
    const box = (w, h, d, c, x, y, z, o) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c, o)); b.position.set(x || 0, y || 0, z || 0); g.add(b); return b; };
    const cyl = (r, h, c, x, y, z, o) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), m(c, o)); b.position.set(x || 0, y || 0, z || 0); g.add(b); return b; };
    const u = g.userData;
    // a CC0 model (js/props.js) if it has loaded, else null and the simple shape below is used
    const md = (n, size, x, y, z, opt) => { const o = DG.PROPS.get(n, size, opt); if (o) { o.position.set(x || 0, y || 0, z || 0); g.add(o); } return o; };
    if (kind === 'antenna') { if (!md('antenna', 5.15, 0, 0, 0, { fit: 'h' })) { cyl(0.06, 5, 0x55595a, 0, 2.5, 0, { metalness: 0.6 }); box(0.9, 0.06, 0.06, 0x55595a, 0, 4.6); box(0.4, 0.5, 0.25, 0x3e4a3a, 0, 1.0, 0.15); } u.on = glowS(0x60ff90, 1.2, 0); u.on.position.y = 5.1; g.add(u.on); u.dim = glowS(0xff4030, 0.8); u.dim.position.y = 5.1; g.add(u.dim); }
    else if (kind === 'cam') { const tc = md('trailcam', 1.7, 0, 0, 0, { fit: 'h' }); if (!tc) { cyl(0.08, 1.6, 0x4a3a26, 0, 0.8); box(0.22, 0.3, 0.18, 0x3a4a2a, 0, 1.45, 0.12); } u.dim = glowS(0xff3020, 0.5); if (tc) u.dim.position.set(0, 1.4, -0.22); else u.dim.position.set(0, 1.55, 0.25); g.add(u.dim); }
    else if (kind === 'page') { const p = md('book', 0.45) || box(0.3, 0.01, 0.4, 0xf0ead8); if (!p.isGroup) p.position.y = 0.05; p.rotation.y = k; u.dim = glowS(0xfff6d0, 1.3, 0.55); u.dim.position.y = 0.3; g.add(u.dim); u.hide = true; }
    else if (kind === 'brazier') {
      const bf = md('bonfire', 1.3, 0, -0.08); // a ring of stones with a few charred logs inside
      if (bf) for (let i = 0; i < 3; i++) { const l = cyl(0.06, 0.8, 0x2b2118, Math.sin(i * 2.1) * 0.15, 0.12, Math.cos(i * 2.1) * 0.15); l.rotation.set(Math.PI / 2 - 0.3, i * 2.1, 0); }
      else { cyl(0.5, 0.35, 0x3a3634, 0, 0.95, 0, { metalness: 0.5 }); [0, 2.1, 4.2].forEach(a => { const l = cyl(0.04, 1, 0x3a3634, Math.sin(a) * 0.35, 0.4, Math.cos(a) * 0.35); l.rotation.z = 0.2; }); }
      u.on = glowS(0xff8a30, 3, 0); u.on.position.y = bf ? 0.5 : 1.5; g.add(u.on);
    }
    else if (kind === 'buoy') { // floats on the water (the model's waterline is 30 % up)
      if (!md('buoy', 1.6, 0, -0.49, 0, { fit: 'h' })) { cyl(0.35, 0.5, 0xd8602a, 0, 0.25); cyl(0.04, 1.4, 0x888888, 0, 0.9); }
      u.dim = glowS(0xffb060, 1, 0.6); u.dim.position.y = 1.4; g.add(u.dim);
    }
    else if (kind === 'board') { if (!md('noticeboard', 1.5, 0, 0, 0, { fit: 'h' })) { cyl(0.07, 2, 0x4a3a26, -0.7, 1); cyl(0.07, 2, 0x4a3a26, 0.7, 1); box(1.7, 1, 0.08, 0x6a5a3a, 0, 1.5); box(0.5, 0.35, 0.02, 0xe8e0c8, 0.2, 1.55, 0.06); } }
    else if (kind === 'safe') { if (!md('safe', 1.1, 0, 0, 0, { fit: 'h' })) { box(0.9, 1.1, 0.8, 0x2e3436, 0, 0.55, 0, { metalness: 0.6, roughness: 0.4 }); cyl(0.12, 0.05, 0x999999, 0.15, 0.6, 0.42).rotation.x = Math.PI / 2; } u.on = glowS(0x60ff90, 0.8, 0); u.on.position.set(0, 1.25, 0); g.add(u.on); }
    else if (kind === 'radio') { if (!md('radio', 0.5)) box(0.25, 0.4, 0.12, 0x2a2a2a, 0, 0.12).rotation.z = 1.4; u.hide = true; }
    else if (kind === 'fuel') { if (!md('gascan', 0.5, 0, 0, 0, { fit: 'h' })) { box(0.35, 0.5, 0.22, 0xb82a1a, 0, 0.25, 0, { metalness: 0.4 }); cyl(0.04, 0.1, 0x222222, 0.1, 0.55, 0); } u.hide = true; u.dim = glowS(0xff6040, 1, 0.45); u.dim.position.y = 0.7; g.add(u.dim); }
    else if (kind === 'egg') {
      if (k === 0 && !md('nest', 2.9)) { const nest = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.35, 6, 14), m(0x4a3a22)); nest.rotation.x = Math.PI / 2; nest.position.y = 0.15; g.add(nest); }
      let e = md('egg', 0.42, 0, k === 0 ? 0.04 : 0, 0, { fit: 'h' });
      if (!e) { e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), m(0xd8d0b0, { roughness: 0.6 })); e.scale.y = 1.35; e.position.y = 0.3; g.add(e); }
      u.egg = e;
    }
    else if (kind === 'drone') { const dr = md('drone', 1.5); if (dr) dr.rotation.z = 0.12; else { box(1.2, 0.18, 1.2, 0x2a2e33, 0, 0.12, 0, { metalness: 0.5 }); [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]].forEach(([x, z]) => cyl(0.25, 0.03, 0x555555, x, 0.25, z)); } u.hide = true; u.blink = glowS(0xff2010, 2.4); u.blink.position.y = 0.5; g.add(u.blink); }
    else if (kind === 'pole') { if (!md('utilpole', 6.13, 0, 0, 0, { fit: 'h' })) { cyl(0.12, 6, 0x4a3a26, 0, 3); box(1.4, 0.1, 0.1, 0x4a3a26, 0, 5.6); const w = cyl(0.02, 3, 0x111111, 0.6, 3.8, 0); w.rotation.z = 0.5; } md('powerbox', 0.55, 0, 1.3, 0.14, { fit: 'h' }); /* junction box on the pole */ u.dim = glowS(0x9fd8ff, 1.2, 0.8); u.dim.position.set(0.2, 1.75, 0.2); g.add(u.dim); u.spark = true; /* sparks at the junction box */ }
    else if (kind === 'hurt') {
      const st = md('stretcher', 2.3);
      if (!st) box(0.6, 0.1, 1.9, 0x5a6a4a, 0, 0.12);
      const who = hurtFigure();
      if (who) { who.position.y = st ? 0.11 : 0.17; g.add(who); }
      else { const b = cyl(0.2, 1.2, 0x3a4a5a, 0, 0.35, 0.1); b.rotation.x = Math.PI / 2; const h = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), m(0xd9b48f)); h.position.set(0, 0.35, -0.75); g.add(h); }
      u.hide = true;
    }
    else if (kind === 'valve') {
      md('pipes', 2.2, 0, 0, 0.45);
      if (!md('valveriser', 1.2, 0, 0, 0, { fit: 'h' })) cyl(0.12, 1.1, 0x5a5e5a, 0, 0.55, 0, { metalness: 0.6 });
      const wm = DG.PROPS.get('valvewheel', 0.86);
      let w;
      if (wm) { // a holder laid on its side, so that turning it about its z axis turns the flat wheel about its hub
        w = new THREE.Group(); w.rotation.x = Math.PI / 2; wm.rotation.x = -Math.PI / 2; wm.position.z = wm.userData.size.y / 2; /* the holder's +z is world down: centre the wheel on the hub */ w.add(wm);
      } else { w = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 6, 16), m(0xb02a1a, { metalness: 0.4 })); w.rotation.x = Math.PI / 2; }
      w.position.y = wm ? 1.13 : 1.15; g.add(w); u.wheel = w;
    }
    else if (kind === 'cage') {
      // a chain-link cage open on its +z side, where the gate drops once a predator is inside
      // (built twice the size of a fence-panel cage, so that a predator's head and shoulders fit in)
      const K = 1.98, gm = md('cage', 3.03 * K, 0, 0, 0, { fit: 'h' }) && DG.PROPS.get('cagegate', 2.73 * K, { fit: 'h' });
      if (gm) { // hinged along the top of the opening: held up and out while the trap is set, it falls shut
        u.gate = new THREE.Group(); u.gate.position.set(0, 2.82 * K, 1.27 * K); gm.position.y = -2.78 * K; u.gate.add(gm); g.add(u.gate); u.gateRot = [0, -1.45];
      }
      else { [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].forEach(([x, z]) => cyl(0.08, 3, 0x55504a, x, 1.5, z, { metalness: 0.6 })); box(2.6, 0.1, 2.6, 0x55504a, 0, 3, 0, { metalness: 0.6 }); u.gate = box(2.4, 0.1, 0.1, 0x55504a, 0, 2.7, -1.2, { metalness: 0.6 }); u.gateY = [0.9, 2.7]; }
      u.meat = DG.PROPS.get('meat', 0.7) || new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), m(0x7a1e16)); if (u.meat.isMesh) u.meat.position.y = 0.3; u.meat.visible = false; g.add(u.meat);
    }
    else if (kind === 'lookout') { if (!md('lookout', 5.11, 0, 0, 0, { fit: 'h' })) { [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].forEach(([x, z]) => cyl(0.12, 4, 0x4a3a26, x, 2, z)); box(3.4, 0.15, 3.4, 0x5a4a30, 0, 4); box(3.4, 0.9, 0.08, 0x5a4a30, 0, 4.5, 1.65); } u.ring = new THREE.Mesh(new THREE.RingGeometry(9.6, 10, 48), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })); u.ring.rotation.x = -Math.PI / 2; u.ring.position.y = 0.15; g.add(u.ring); }
    else if (kind === 'door') {
      if (!md('wall', 3.1, 0, 0, 0, { fit: 'h' })) box(4, 3, 0.3, 0x4a4a46, 0, 1.5); // a shed wall with a doorway
      // a roller shutter on each face, widened to 1.6 m; they roll up as the door is forced
      if (DG.PROPS.has('door')) {
        u.part = new THREE.Group(); u.part.position.set(0, 2.4, 0); g.add(u.part); u.roll = true;
        [-0.3, 0.3].forEach(z => { const sh = DG.PROPS.get('door', 2.4, { fit: 'h' }); sh.scale.x = 1.5; sh.position.set(0, -2.4, z); if (z > 0) sh.rotation.y = Math.PI; u.part.add(sh); });
      }
      if (!u.part) { u.part = box(1.6, 2.4, 0.12, 0x6a3a22, 0, 1.2, -0.2, { metalness: 0.5 }); box(0.2, 0.2, 0.25, 0x999999, 0.6, 1.2, -0.3); } }
    else if (kind === 'gen' || kind === 'box' || kind === 'dst') { /* the tower's own generator / fuse box, or the camp */ }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  function coMarksMake() {
    const S = W.SITES, g = new THREE.Group();
    const mk = (p, text, color, y, k) => { const s = labelSprite(text, color, k); s.position.set(p.x, gy(p) + (y || 3), p.z); g.add(s); return s; };
    CO.marks = { g, caches: S.caches.map(c => mk(c, '🔌 ヒューズ', '#ffd27a', 3.2)), pg: new THREE.Group(), dg: new THREE.Group(), tg: new THREE.Group(), dropKey: '', trapKey: '', props: new THREE.Group() };
    g.visible = false;
    // every mission target: its prop, and a label (ghosts see all of them; the living only the near ones)
    CO.ms.forEach(M => M.T.forEach((t, i) => {
      if (t.k === 'box' || t.k === 'dst' || M.d.kind === 'gen') { t.lab = mk(t.p, M.d.icon + ' ' + (t.k === 'dst' ? (M.d.to === 'gen' ? '発電機' : 'キャンプ') : M.d.name), '#ffe2a0', 3.4, 0.8); return; }
      const kind = M.d.kind === 'code' ? t.k : M.d.prop || 'box', o = coProp(kind, i);
      o.position.set(t.p.x, M.d.where === 'water' ? W.WATER : gy(t.p), t.p.z); o.rotation.y = (i * 1.7 + M.stage) % 6.283;
      CO.marks.props.add(o); t.obj = o;
      if (M.d.nest && i > 0) return; // one label for the whole nest
      t.lab = labelSprite(M.d.icon + ' ' + M.d.name, '#ffe2a0', 0.8); t.lab.position.set(t.p.x, gy(t.p) + (kind === 'lookout' ? 7.4 : kind === 'pole' ? 6.6 : kind === 'cage' ? 6.8 : 3), t.p.z); t.lab.visible = false; world.scene.add(t.lab);
    }));
    world.scene.add(g, CO.marks.pg, CO.marks.dg, CO.marks.tg, CO.marks.props);
  }
  function coRainMake() {
    const N = DG.MOBILE ? 700 : 1500, pos = new Float32Array(N * 6), g = new THREE.BufferGeometry();
    for (let i = 0; i < N; i++) { const x = (Math.random() * 2 - 1) * 26, y = Math.random() * 22, z = (Math.random() * 2 - 1) * 26; pos.set([x, y, z, x + 0.06, y - 0.7, z + 0.03], i * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8fa3b8, transparent: true, opacity: 0.3, depthWrite: false }));
    m.frustumCulled = false; world.scene.add(m); CO.rain = { m, pos, N };
  }
  const disposeTree = o => o.traverse(c => { if (c.userData.shared) return; if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } });
  // take every co-op object out of the scene and stop its sounds (leaving the room, back to the lobby, a new game)
  function coCleanup() {
    if (CO.lights) { CO.lights.forEach(l => { world.scene.remove(l, l.target); l.dispose(); }); CO.lights = null; }
    if (CO.rain) { world.scene.remove(CO.rain.m); disposeTree(CO.rain.m); CO.rain = null; }
    if (CO.marks) { [CO.marks.g, CO.marks.pg, CO.marks.dg, CO.marks.tg, CO.marks.props].forEach(o => { world.scene.remove(o); disposeTree(o); }); CO.marks = null; }
    CO.ms.forEach(M => M.T.forEach(t => { if (t.lab && t.lab.parent) { world.scene.remove(t.lab); disposeTree(t.lab); } }));
    if (CO.wire) { world.scene.remove(CO.wire.line); disposeTree(CO.wire.line); CO.wire = null; }
    A.rain(0); A.hum(false);
    // a catch may still be playing when the game ends and everyone leaves: drop its body and lift its blackout
    dinos.forEach(a => { if (a.catch) clearCatch(a); }); VS.dead = null; resetScreenFx();
    document.body.classList.remove('coop', 'ghost');
    $('coop').style.display = 'none'; $('goal').style.display = ''; $('coPrompt').style.display = 'none'; $('coGhost').style.display = 'none'; $('coFlash').style.opacity = 0;
    CO.hold = ''; CO.pings = []; CO.drops = []; CO.traps = []; CO.ms = []; P.hook = null; P.slide = 0;
  }

  // ---- starting ----
  function coGo() {
    $('loading').style.display = 'none';
    VS.on = true; VS.phase = 'count'; VS.countT = 3.5;
    DF = coDiff(VS.diff);
    ['menu', 'end', 'pause', 'vsLobby', 'race'].forEach(id => $(id).style.display = 'none');
    $('hud').style.display = 'block'; $('coop').style.display = 'block'; $('goal').style.display = 'none';
    document.body.classList.add('coop'); document.body.classList.remove('ghost');
    const camp = W.SITES.camp, st = W.STARTS[VS.mySlot] || W.STARTS[0];
    P.pos.set(st.x, W.height(st.x, st.z) + 1.65, st.z); P.vel.set(0, 0, 0); P.eye = 1.65; P.ground = true; P.hook = null; P.slide = 0;
    P.yaw = Math.atan2(-(st.x - camp.x), -(st.z - camp.z)); // facing out from the fire
    P.pitch = 0; P.stam = 1; P.crouch = false; P.exhausted = false; TI.run = false; TI.jump = false; TI.act = false;
    camera.position.copy(P.pos); camera.rotation.set(0, P.yaw, 0, 'YXZ');
    killer = null; runT = 0; shake = 0; VS.dead = null; VS.raceT = 0; VS.winner = -1; VS.baits = []; VS.sendT = 0; VS.panelT = 0;
    const n = VS.players.filter(Boolean).length;
    Object.assign(CO, { phase: 'm', stage: 0, esc: { step: 0, p: 0, t: 0 }, fz: [0, 0, 0, 0], bag: ['', '', '', ''], know: 0, rd: [0, 0, 0, 0],
      searched: new Set(), cs: [0, 0, 0, 0, 0, 0], drops: [], pings: [], traps: [], ev: { k: '', t: 0, next: 70 + Math.random() * 40 },
      light: true, hold: '', pingCD: 0, boltT: 15 + Math.random() * 10, growlT: 4, beepT: 0, lureT: {}, prevKey: '', hudT: 0, flashT: 0 });
    CO.dir = { t: 10, calm: 0, chase: 0, lull: 0 };
    coBuild(n);
    // pickups all over the swamp, one set for the whole team (the co-op set of items); a firecracker each to start,
    // and darts for everyone when the tranquilizer mission is drawn
    items.reset(DF, { set: 'coop', inv: { cracker: 1, dart: coM('tranq') ? 2 : 0 }, seed: VS.seed + 7, starts: VS.players.filter(Boolean), around: { c: new V(0, 0, 0), r: W.LIMIT - 30 }, more: 0.7, claim: vsClaim });
    LOCAL.slot = VS.mySlot;
    for (const k in keys) keys[k] = false;
    VS.players.forEach(p => {
      if (!p) return;
      p.st = !VS.host || playerConnected(p) ? 'alive' : 'gone'; p.time = 0; p.fl = 1; p.hold = '';
      const s = W.STARTS[p.slot] || st; p.tp.pos.set(s.x, W.height(s.x, s.z) + 1.65, s.z); p.yaw = 0;
    });
    if (VS.players[VS.mySlot]) VS.players[VS.mySlot].tp = LOCAL;
    world.props.caches.forEach(c => c.dim = false); world.setGate(0);
    // the stalkers: on the far side of the swamp from the camp (run by the host)
    const trex = TREX();
    dinos.forEach(a => { a.d.root.visible = false; a.tgtP = null; a.netOn = false; a.roarSeen = undefined; a.biteSeen = undefined; a.catchSeen = undefined; a.feedT = 0; a.d.look = null; clearCatch(a); });
    roster = trex.slice(0, DF.max);
    if (VS.host) {
      const rnd = DG.N.rng(VS.seed + 11);
      roster.forEach(a => {
        let p = null;
        for (let k = 0; k < 80 && !p; k++) { const q = new V((rnd() * 2 - 1) * (W.LIMIT - 40), 0, (rnd() * 2 - 1) * (W.LIMIT - 40)); if (Math.hypot(q.x - camp.x, q.z - camp.z) > 230 && roster.every(o => o === a || !o.d.root.visible || o.pos.distanceTo(q) > 120)) p = q; }
        activateDino(a, p || new V(-camp.x, 0, -camp.z), rnd() * Math.PI * 2, true);
      });
      spawnT = 0;
    }
    ensureAvatars(); coMarksMake(); coRainMake(); A.rain(1);
    state = 'play';
    if (!DG.MOBILE) { lock(); if (document.pointerLockElement !== renderer.domElement) { state = 'pause'; $('pause').style.display = 'flex'; } }
    const s0 = CO.ms.filter(M => M.stage === 0).map(M => M.d.icon + M.d.name).join('・');
    msg(`夜の湿地 — 6つのミッションを果たして脱出しろ。第1段階：${s0}`, 6);
  }

  // ---- the local survivor: what can be done here (hold E / the 調べる button) ----
  const tq = new V();
  // the stalker the camera points at, within 25 m (for the photo)
  function coAimed(pos, yaw, pitch) {
    const dir = tq.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    return TREX().find(a => {
      if (!a.d.root.visible) return false;
      const c = new V(a.pos.x, a.pos.y + 3 * a.ai.size, a.pos.z).sub(pos), d = c.length();
      return d < 25 + 3 * a.ai.size && c.dot(dir) / d > Math.cos(0.3);
    }) || null;
  }
  function coTarget() {
    const me = P.pos, near = (q, r) => Math.hypot(q.x - me.x, q.z - me.z) < r, bag = coMine(), slot = VS.mySlot;
    for (let i = 0; i < CO.drops.length; i++) {
      const d = CO.drops[i]; if (!d || !near(d, 2.2)) continue;
      if (d.k !== 'fz' && bag) return { text: `両手がふさがっている（${BAG_NAME[bag]}を運び中）` };
      return { id: 'd' + i, text: `落ちている${d.k === 'fz' ? 'ヒューズ' : BAG_NAME[d.k]}を拾う`, prog: d.p || 0 };
    }
    if (CO.phase === 'esc' && CO.esc.step === 0 && near(world.props.esc.act, 3.5)) {
      const e = W.SITES.esc;
      return { id: 'x', prog: CO.esc.p, text: e === 0 ? '無線で救助ヘリを呼ぶ' : e === 1 ? 'ボートのエンジンをかける' : coAlive().length > 1 ? '坑道の鉄柵をこじ開ける（2人で同時に）' : '坑道の鉄柵をこじ開ける（1人だと時間がかかる）' };
    }
    for (let mi = 0; mi < CO.ms.length; mi++) {
      const M = CO.ms[mi]; if (!coActive(M)) continue;
      const d = M.d, id = ti => 'm' + mi + '.' + ti;
      if (d.kind === 'photo') { if (coAimed(camera.position, P.yaw, P.pitch)) return { id: id(0), text: '捕食者を撮影する', prog: M.v }; continue; }
      for (let ti = 0; ti < M.T.length; ti++) {
        const t = M.T[ti], r = d.kind === 'door' || d.kind === 'gen' || d.kind === 'sync' ? 3.6 : t.k === 'dst' ? 0 : 2.6;
        if (!r || M.s[ti] >= 1 || !near(t.p, r)) continue;
        if (d.kind === 'hold') {
          if (d.where === 'water' && W.waterDepth(me.x, me.z) < 0.15) return { text: '印のそばで、水の中に立って採取する' };
          return { id: id(ti), text: d.verb, prog: M.s[ti] };
        }
        if (d.kind === 'code') {
          if (t.k === 'board') { if (!(CO.know & (1 << slot))) return { id: id(ti), text: '掲示板の暗証番号を読む', prog: CO.rd[slot] }; continue; }
          return CO.know & (1 << slot) ? { id: id(ti), text: `金庫を開ける（暗証番号 ${CO.code}）`, prog: M.s[ti] } : { text: '暗証番号がわからない — 掲示板を探す' };
        }
        if (d.kind === 'fuse') { if (CO.fz[slot] > 0) return { id: id(ti), text: `配電盤にヒューズを取り付ける（${CO.fz[slot]}本）`, prog: M.s[ti] }; continue; }
        if (d.kind === 'carry' && t.k === 'src') return bag ? { text: `両手がふさがっている（${BAG_NAME[bag]}を運び中）` } : { id: id(ti), text: `${BAG_NAME[d.item]}を持ち上げる`, prog: M.s[ti] };
        if (d.kind === 'sync') return { id: id(ti), text: coAlive().length > 1 ? d.verb : 'バルブを回す（1人なら片方ずつ）', prog: M.s[ti] };
        if (d.kind === 'gen') return { id: id(ti), text: coAlive().length > 1 ? '発電機を始動する（2人で同時に）' : '発電機を始動する（1人だと時間がかかる）', prog: M.s[ti] };
        if (d.kind === 'cage') return { id: id(ti), text: '檻に肉を仕掛ける', prog: M.s[ti] };
        if (d.kind === 'door') return { id: id(ti), text: d.verb + '（何人でも速くなる）', prog: M.s[ti] };
      }
    }
    for (let i = 0; i < 6; i++) if (!CO.searched.has(i) && near(world.props.caches[i].pos, 2.3)) return { id: 'c' + i, text: '木箱を調べる', prog: CO.cs[i] };
    return null;
  }
  function coLocal() {
    const tg = coTarget(), holding = !!tg && !!tg.id && (keys.KeyE || TI.act);
    CO.hold = holding ? tg.id : '';
    if (holding) P.noise = Math.max(P.noise, /^m\d\.\d$/.test(tg.id) && ['gen', 'door', 'wires'].includes(CO.ms[+tg.id[1]].id) ? 1 : 0.55); // rummaging and engines carry
    const el = $('coPrompt');
    if (tg) {
      el.style.display = 'block';
      $('coPromptText').textContent = tg.id ? (DG.MOBILE ? '「調べる」長押し：' : 'E 長押し：') + tg.text : tg.text;
      $('coPromptBar').parentNode.style.display = tg.id ? '' : 'none';
      $('coPromptBar').style.width = Math.round(Math.min(1, tg.prog || 0) * 100) + '%';
    } else el.style.display = 'none';
  }
  function coToggleLight() { if (!COOP() || coGhost()) return; CO.light = !CO.light; A.whoosh(); }

  // ---- co-op items the game carries out (items.js asks): trap, wire hook, first-aid kit, signal gun ----
  DG.coCanThrow = () => !(VS.on && COOP() && HEAVY[coMine()]);
  DG.coItem = function (type) {
    if (!(VS.on && COOP()) || VS.phase !== 'race') return false;
    const fw = new V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    if (type === 'trap') {
      const x = P.pos.x + fw.x * 1.8, z = P.pos.z + fw.z * 1.8;
      if (VS.host) coAddTrap(x, z); else DG.Net.send({ t: 'it', k: 'trap', x: +x.toFixed(1), z: +z.toFixed(1) });
      A.pickup(); msg('🪤 トラバサミを仕掛けた', 2); return true;
    }
    if (type === 'signal') {
      if (VS.host) coSignal(P.pos.x, P.pos.z, VS.mySlot); else DG.Net.send({ t: 'it', k: 'signal', x: +P.pos.x.toFixed(1), z: +P.pos.z.toFixed(1) });
      A.bang(new V(P.pos.x, P.pos.y + 20, P.pos.z)); msg('🎆 信号弾を打ち上げた — 仲間に位置が伝わる（捕食者にも…）', 3); return true;
    }
    if (type === 'medkit') {
      const g = VS.players.find(p => p && p.st === 'ghost' && p.tp.pos.distanceTo(P.pos) < 6.5);
      if (!g) { msg('⛑️ 近くに幽霊の仲間がいない — 幽霊にそばまで来てもらおう', 2.5); return false; }
      if (VS.host) coReviveHost(g.slot, P.pos); else DG.Net.send({ t: 'it', k: 'medkit', s: g.slot });
      return true;
    }
    if (type === 'hook') {
      if (HEAVY[coMine()]) { msg('荷物を運んでいる間は使えない', 1.8); return false; }
      const o = camera.position.clone(), dir = camera.getWorldDirection(new V()), q = new V();
      const cols = world.colliders.filter(c => (c.x - o.x) ** 2 + (c.z - o.z) ** 2 < 34 * 34 && c.r > 0.15);
      let hit = null, up = false;
      for (let s = 1; s <= 30 && !hit; s += 0.4) {
        q.copy(o).addScaledVector(dir, s); const g0 = gy(q);
        if (q.y <= g0 + 0.15) { hit = new V(q.x, g0 + 1.65, q.z); break; }
        for (const c of cols) if (Math.hypot(q.x - c.x, q.z - c.z) < c.r + 0.2 && q.y < W.height(c.x, c.z) + 14) { hit = q.clone().addScaledVector(dir, -0.7); hit.y = Math.max(hit.y, g0 + 1.65); up = true; break; }
      }
      if (!hit) { msg('🪝 ワイヤーが届く所がない（30m以内の木・岩・地面を狙う）', 2); return false; }
      P.hook = { to: hit, t: 1.4, up }; P.ground = false; A.zip();
      if (!CO.wire) { const gl = new THREE.BufferGeometry().setFromPoints([new V(), new V()]); CO.wire = { line: new THREE.Line(gl, new THREE.LineBasicMaterial({ color: 0xcfd8e0 })) }; CO.wire.line.frustumCulled = false; world.scene.add(CO.wire.line); }
      return true;
    }
    return false;
  };
  // a thrown firecracker / flashbang / dynamite has landed (on the thrower's machine)
  DG.coLand = function (type, pos) {
    if (!(VS.on && COOP())) return;
    if (VS.host) coLandHost(type, pos, VS.mySlot); else DG.Net.send({ t: 'it', k: type, x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) });
  };
  // the bang itself, on every machine that shows it: a white-out for whoever looks at a flashbang, a jolt from dynamite
  DG.coFxLocal = function (type, pos) {
    if (!(VS.on && COOP())) return;
    const d = camera.position.distanceTo(pos);
    if (type === 'flash' && d < 28) {
      const v = pos.clone().sub(camera.position).normalize(), f = camera.getWorldDirection(new V()).dot(v);
      if (f > 0.2) { CO.flashT = 1.6 * (1 - d / 28) * f; }
      world.flash(0.5);
    } else if (type === 'dyn') { world.flash(0.8); if (d < 35) shake = Math.max(shake, 0.4 * (1 - d / 35)); }
  };
  // host: what a thrown thing does to the stalkers
  function coLandHost(type, pos, slot) {
    const near = r => roster.filter(a => a.d.root.visible && a.pos.distanceTo(pos) < r);
    if (type === 'cracker') { const b = { pos: pos.clone(), t: 6, remote: true, get dead() { return this.t <= 0; } }; VS.baits.push(b); if (lureAt(pos, 'flare', b, 90)) tell((VS.players[slot] || {}).tp, '🧨 捕食者が爆竹の音に向かった', 2); }
    else if (type === 'flash') setTimeout(() => near(20).forEach(a => { a.blind = 5; a.state = 'wander'; a.aware = 0; a.tgtP = null; a.attackT = -1; a.timer = 0; a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch * 1.2, 1.2, 1.6); }), 500);
    else if (type === 'dyn') setTimeout(() => {
      const b = { pos: pos.clone(), t: 8, remote: true, get dead() { return this.t <= 0; } }; VS.baits.push(b);
      lureAt(pos, 'flare', b, 500);
      near(12).forEach(a => { a.stun = 8; a.state = 'wander'; a.aware = 0; a.tgtP = null; a.attackT = -1; a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch * 0.9, 1.6, 2); });
      tellAll('💣 爆発音が湿地中に響いた…', 2.5);
    }, 3000);
    DG.Net.broadcast({ t: 'fx', k: 'it', i: type, x: pos.x, y: pos.y, z: pos.z, s: slot });
  }
  let trapId = 0;
  function coAddTrap(x, z) { CO.traps.push({ id: ++trapId, x: clamp(x, -W.LIMIT, W.LIMIT), z: clamp(z, -W.LIMIT, W.LIMIT), sp: 0 }); if (CO.traps.length > 12) CO.traps.shift(); }
  function coSignal(x, z, slot) {
    coAddPing(x, z, slot, 1);
    const b = { pos: new V(x, W.height(x, z), z), t: 10, remote: true, get dead() { return this.t <= 0; } }; VS.baits.push(b);
    lureAt(b.pos, 'flare', b, 150);
  }
  function coReviveHost(slot, pos) {
    const p = VS.players[slot]; if (!p || p.st !== 'ghost') return;
    p.st = 'alive'; p.tp.pos.set(pos.x + 1, W.height(pos.x + 1, pos.z) + 1.65, pos.z);
    tellAll(`⛑️ ${p.name} が生き返った！`, 3);
    if (slot === VS.mySlot) coRevived(p.tp.pos); else if (p.id) DG.Net.send({ t: 'revive', x: p.tp.pos.x, y: p.tp.pos.y, z: p.tp.pos.z }, p.id);
  }
  // on the revived player's own machine: back in the body
  function coRevived(pos) {
    const me = coMe(); if (!me) return;
    me.st = 'alive'; document.body.classList.remove('ghost');
    P.pos.set(pos.x, W.height(pos.x, pos.z) + 1.65, pos.z); P.vel.set(0, 0, 0); P.pitch = 0; P.stam = 1; P.exhausted = false; P.crouch = false; P.hook = null;
    $('coGhost').style.display = 'none'; A.pickup(); msg('⛑️ 仲間に助けられた！ もう一度生き延びろ', 4);
  }

  // ---- ghosts: fly about unseen; see the missions; ping spots for the living ----
  function coBecomeGhost() {
    VS.dead = null; state = 'play';
    const me = coMe(); if (me) me.st = 'ghost';
    // rise out of the body, up and back from where it happened (the stalker is still standing over the spot)
    P.pos.x += Math.sin(P.yaw) * 6; P.pos.z += Math.cos(P.yaw) * 6;
    P.pos.y = gy(P.pos) + 8; P.pitch = -0.35; P.vel.set(0, 0, 0); P.crouch = false; P.hook = null; P.slide = 0;
    document.body.classList.add('ghost'); if (world.scene.fog) world.scene.fog.density = 0.012;
    $('coPrompt').style.display = 'none'; CO.hold = '';
    A.ghost(); msg('👻 幽霊になった — ミッションの場所が全部見える。合図で仲間を導こう（救急キットで生き返れる）', 5);
    if (!DG.MOBILE) lock();
  }
  const gF = new V(), gR = new V(), gW = new V();
  function updateGhost(dt) {
    const fast = keys.ShiftLeft || keys.ShiftRight || TI.run, sp = fast ? 15 : 7, cp = Math.cos(P.pitch);
    const mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + TI.mx, mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + TI.mz;
    gF.set(-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp); gR.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    gW.copy(gF).multiplyScalar(mz).addScaledVector(gR, mx); if (gW.lengthSq() > 1) gW.normalize();
    gW.multiplyScalar(sp); if (keys.Space || TI.jump) gW.y += sp * 0.7;
    P.vel.lerp(gW, 1 - Math.exp(-dt * 4)); P.pos.addScaledVector(P.vel, dt);
    const g = gy(P.pos);
    P.pos.y = clamp(P.pos.y, g + 0.9, g + 34);
    P.pos.x = clamp(P.pos.x, -W.LIMIT, W.LIMIT); P.pos.z = clamp(P.pos.z, -W.LIMIT, W.LIMIT);
    P.noise = 0; P.vis = 0;
    camera.position.copy(P.pos); camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
    CO.pingCD = Math.max(0, CO.pingCD - dt);
  }
  function coPing() {
    if (!COOP() || !coGhost() || CO.pingCD > 0 || VS.phase !== 'race') return;
    const d = camera.getWorldDirection(new V()), p = camera.position.clone();
    for (let t = 0; t < 180; t++) { p.addScaledVector(d, 1); if (p.y < gy(p)) break; }
    CO.pingCD = 4;
    if (VS.host) coAddPing(p.x, p.z, VS.mySlot); else DG.Net.send({ t: 'ping', x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
  }
  let pingId = 0;
  // f: 1 = a survivor's signal flare (30 s, red), else a ghost's ping (15 s)
  function coAddPing(x, z, slot, f) {
    CO.pings.push({ id: ++pingId, x: clamp(x, -W.LIMIT, W.LIMIT), z: clamp(z, -W.LIMIT, W.LIMIT), s: slot, ttl: f ? 30 : 15, f: f ? 1 : 0 });
    if (CO.pings.length > 8) CO.pings.shift();
    const p = VS.players[slot]; tellAll(f ? `🎆 ${p ? p.name : '仲間'} が信号弾を上げた（コンパスの◆）` : `👻 ${p ? p.name : '幽霊'} が合図を送った（光の柱）`, 2.2);
  }

  // ---- host: the missions ----
  function coGive(p, type) { if (p.slot === VS.mySlot) items.give(type); else if (p.id) DG.Net.send({ t: 'give', k: type }, p.id); }
  function coDropAll(p, pos) {
    const q = pos || p.tp.pos;
    if (CO.fz[p.slot] > 0) { CO.drops.push({ x: q.x, z: q.z, k: 'fz', n: CO.fz[p.slot], p: 0 }); CO.fz[p.slot] = 0; }
    if (CO.bag[p.slot]) { CO.drops.push({ x: q.x + 0.8, z: q.z, k: CO.bag[p.slot], n: 1, p: 0 }); CO.bag[p.slot] = ''; }
  }
  function coLure(key, every, pos, r) { CO.lureT[key] = (CO.lureT[key] || 0) - VS.dtHost; if (CO.lureT[key] <= 0) { CO.lureT[key] = every; lureAt(pos, 'noise', null, r); } }
  const nearP = (p, q, r) => Math.hypot(p.tp.pos.x - q.x, p.tp.pos.z - q.z) < r + 0.8; // some slack for lag
  function coFinish(M, ti, p) {
    const d = M.d;
    if (d.kind === 'hold') {
      tellAll(`${d.icon} ${p.name}：${d.verb.replace(/する$/, 'した').replace(/く$/, 'いた').replace(/う$/, 'った').replace(/ぐ$/, 'いだ').replace(/ける$/, 'けた').replace(/る$/, 'った')}（${M.s.filter(s => s >= 1).length}/${M.T.length}）`, 2.2);
      if (d.lureDone) lureAt(M.T[ti].p, 'noise', null, d.lureDone);
    } else if (d.kind === 'code') tell(p.tp, '🔐 金庫が開いた！', 2.5);
    else if (d.kind === 'fuse') { M.v += CO.fz[p.slot]; CO.fz[p.slot] = 0; M.s[ti] = 0; tellAll(`🔌 ヒューズ ${M.v}/${M.need} 本を取り付けた`, 2.5); }
    else if (d.kind === 'carry') { CO.bag[p.slot] = d.item; tell(p.tp, `${d.icon} ${BAG_NAME[d.item]}を持った — ${d.to === 'gen' ? '無線塔の発電機' : 'キャンプ'}へ運べ`, 3); }
    else if (d.kind === 'cage') { tellAll('🪤 檻に肉を仕掛けた — 捕食者を誘い込め（檻に入ると閉じ込められる）', 3.5); }
  }
  function coHolds(dt, alive) {
    alive.forEach(p => {
      const h = p.hold || ''; if (!h) return;
      if (h[0] === 'c') { // a crate
        const i = +h.slice(1); if (!(i >= 0 && i < 6) || CO.searched.has(i) || !nearP(p, world.props.caches[i].pos, 2.3)) return;
        CO.cs[i] += dt / 2.5; if (CO.cs[i] < 1) return;
        CO.searched.add(i);
        if (CO.fuseAt.has(i)) { CO.fz[p.slot]++; tell(p.tp, '🔌 ヒューズを見つけた！ 無線塔（📡）の配電盤へ運べ', 3.5); VS.players.forEach(o => { if (o && o !== p && o.st !== 'gone') tell(o.tp, `🔌 ${p.name} がヒューズを見つけた`, 2.5); }); }
        else if (Math.random() < 0.65) { const pool = ['cracker', 'cracker', 'flash', 'trap', 'hook', 'stim', 'signal', 'dart', 'medkit', 'dyn'], k = pool[Math.floor(Math.random() * pool.length)]; coGive(p, k); }
        else tell(p.tp, '空だった…', 2);
        return;
      }
      if (h[0] === 'd') { // something dropped
        const i = +h.slice(1), d = CO.drops[i]; if (!d || !nearP(p, d, 2.2) || (d.k !== 'fz' && CO.bag[p.slot])) return;
        d.p += dt; if (d.p < 1) return;
        if (d.k === 'fz') CO.fz[p.slot] += d.n; else CO.bag[p.slot] = d.k;
        CO.drops[i] = null; tell(p.tp, `落ちていた${d.k === 'fz' ? 'ヒューズ' : BAG_NAME[d.k]}を拾った`, 2.5);
        return;
      }
      if (h === 'x') return; // the way out: see coEscape
      const m = /^m(\d)\.(\d)$/.exec(h); if (!m) return;
      const M = CO.ms[+m[1]], ti = +m[2]; if (!coActive(M)) return;
      const d = M.d, t = M.T[ti];
      if (!t || M.s[ti] >= 1 || ['sync', 'gen', 'photo', 'zone'].includes(d.kind)) return; // (those are run in coStep)
      if (!nearP(p, t.p, d.kind === 'door' ? 3.6 : 2.6)) return;
      let dur = d.dur || 1;
      if (d.kind === 'hold' && d.where === 'water' && W.waterDepth(p.tp.pos.x, p.tp.pos.z) < 0.1) return;
      if (d.kind === 'code') {
        if (t.k === 'board') { if (CO.know & (1 << p.slot)) return; CO.rd[p.slot] += dt / 2; if (CO.rd[p.slot] >= 1) { CO.know |= 1 << p.slot; tell(p.tp, `🔐 暗証番号は「${CO.code}」— 金庫へ急げ（コンパスの🔐）`, 4); } return; }
        if (!(CO.know & (1 << p.slot))) return; dur = 4;
      }
      if (d.kind === 'fuse') { if (!CO.fz[p.slot]) return; dur = 1.2; }
      if (d.kind === 'carry') { if (t.k !== 'src' || CO.bag[p.slot]) return; dur = 1.2; }
      if (d.kind === 'cage') dur = 3;
      if (d.lure) coLure(M.id + ti, 3, t.p, d.lure);
      M.s[ti] = Math.min(1, M.s[ti] + dt / dur);
      if (M.s[ti] >= 1) coFinish(M, ti, p);
    });
  }
  // the missions that run on their own each frame
  function coStep(M, dt, alive) {
    const d = M.d, holders = ti => alive.filter(p => p.hold === 'm' + CO.ms.indexOf(M) + '.' + ti && nearP(p, M.T[ti].p, 3.6));
    if (d.kind === 'carry') { // whoever brings one to the drop-off point delivers it
      const dst = M.T[M.T.length - 1];
      alive.forEach(p => { if (CO.bag[p.slot] === d.item && nearP(p, dst.p, 4.5)) { CO.bag[p.slot] = ''; M.v++; tellAll(`${d.icon} ${p.name} が${BAG_NAME[d.item]}を運んだ（${M.v}/${M.need}）`, 2.5); } });
      if (M.v >= M.need) M.done = true;
    } else if (d.kind === 'sync') { // both valves turned at once (one at a time when only one survivor is left)
      const solo = alive.length < 2, on = M.T.map((t, i) => holders(i).length > 0);
      M.T.forEach((t, i) => {
        if (M.s[i] >= 1) return;
        if (solo ? on[i] : on.every(Boolean)) M.s[i] = Math.min(1, M.s[i] + dt / (solo ? 7 : d.dur));
        else if (!solo) M.s[i] = Math.max(0, M.s[i] - dt * 0.15);
      });
      if (!solo && M.s.some(s => s >= 1)) M.s = M.s.map(() => 1);
    } else if (d.kind === 'gen') {
      const req = Math.min(2, alive.length), at = holders(0).length;
      M.go = at > 0 && at >= req;
      if (M.go) { M.s[0] = Math.min(1, M.s[0] + dt / (req === 1 ? 16 : 9)); coLure('gen', 3, M.T[0].p, 230); }
      else M.s[0] = Math.max(0, M.s[0] - dt * 0.02);
    } else if (d.kind === 'photo') {
      const mi = CO.ms.indexOf(M);
      alive.forEach(p => {
        if (p.hold !== 'm' + mi + '.0') return;
        const eye = p.tp.local ? camera.position : p.tp.pos, yaw = p.tp.local ? P.yaw : p.yaw, pitch = p.tp.local ? P.pitch : p.pitch || 0;
        if (coAimed(eye, yaw, pitch)) M.v = Math.min(1, M.v + dt / d.dur);
      });
      if (M.v >= 1) { M.done = true; }
    } else if (d.kind === 'tranq') { if (M.v >= M.need) M.done = true; }
    else if (d.kind === 'cage') {
      if (M.s[0] >= 1 && !M.v) {
        const t = M.T[0];
        coLure('cage', 20, t.p, 90); // the meat's smell
        const a = roster.find(x => x.d.root.visible && Math.hypot(x.pos.x - t.p.x, x.pos.z - t.p.z) < 3 + 2 * x.ai.size);
        if (a) { M.v = 1; a.stun = 15; a.state = 'wander'; a.aware = 0; a.tgtP = null; a.attackT = -1; a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch, 1.8, 2.6); tellAll('🪤 捕食者が檻に閉じ込められた！（15秒で破られる）', 3.5); M.done = true; }
      }
    } else if (d.kind === 'zone') {
      const t = M.T[0];
      if (alive.some(p => nearP(p, t.p, d.r))) { M.v = Math.min(d.dur, M.v + dt); coLure('zone', 6, t.p, 110); }
      if (M.v >= d.dur) M.done = true;
    }
    if (!M.done && ['hold', 'code', 'sync', 'gen', 'door'].includes(d.kind)) M.done = d.kind === 'code' ? M.s[1] >= 1 : M.s.every(s => s >= 1);
    if (d.kind === 'fuse' && M.v >= M.need) M.done = true;
    if (M.done) tellAll(`✅ ミッション達成：${d.icon} ${d.name}`, 3);
  }
  function coDartHit() { const M = coM('tranq'); if (coActive(M)) { M.v++; tellAll(`🎯 麻酔弾が命中（${Math.min(M.v, M.need)}/${M.need}）`, 2.5); } }
  function coMission(dt, alive) {
    VS.dtHost = dt;
    coHolds(dt, alive);
    if (CO.phase === 'm') {
      CO.ms.forEach(M => { if (coActive(M)) coStep(M, dt, alive); });
      if (CO.ms.filter(M => M.stage === CO.stage).every(M => M.done)) {
        CO.stage++;
        if (CO.stage >= 3) {
          CO.phase = 'esc'; CO.esc = { step: 0, p: 0, t: 0 };
          const e = W.SITES.esc;
          tellAll(`${ESC_ICON[e]} 全ミッション達成！ 今夜の脱出手段は「${ESC_NAME[e]}」— ${e === 0 ? '無線塔で救助ヘリを呼べ' : e === 1 ? '船着き場でボートのエンジンをかけろ' : '湿地の外れの坑道の鉄柵をこじ開けろ'}（コンパスの${ESC_ICON[e]}）`, 6);
        } else {
          const nx = CO.ms.filter(M => M.stage === CO.stage).map(M => M.d.icon + M.d.name).join('・');
          tellAll(`第${CO.stage + 1}段階：${nx}`, 5);
          roster.forEach(a => { if (a.d.root.visible) { a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch, 2, 2.6); } }); // they know
        }
      }
    } else if (CO.phase === 'esc') coEscape(dt, alive);
    // traps on the ground: a stalker that steps in one is held fast
    CO.traps.forEach(t => {
      if (t.sp) { t.sp += dt; return; }
      const a = roster.find(x => x.d.root.visible && !(x.stun > 0) && Math.hypot(x.pos.x - t.x, x.pos.z - t.z) < 1.2 + 1.4 * x.ai.size);
      if (a) { t.sp = 0.01; a.stun = 7; a.attackT = -1; a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch * 1.2, 1.8, 2); tellAll('🪤 捕食者がトラバサミにかかった！（7秒）', 2.5); }
    });
    CO.traps = CO.traps.filter(t => !t.sp || t.sp < 5);
    CO.pings = CO.pings.filter(p => (p.ttl -= dt) > 0);
    if (!coAlive().length) coEnd();
  }
  // the way out: get it going (step 0), wait for it (1), board it (2)
  function coEscape(dt, alive) {
    const E = CO.esc, e = W.SITES.esc, act = world.props.esc.act;
    const at = alive.filter(p => p.hold === 'x' && nearP(p, act, 3.5)).length;
    if (E.step === 0) {
      if (e === 2) { const req = Math.min(2, alive.length); if (at >= req && at > 0) { E.p += dt / (req === 1 ? 14 : 8); coLure('gate', 3, act, 160); } }
      else if (at > 0) E.p += dt / (e === 0 ? 3 : 5);
      if (E.p >= 1) {
        E.p = 1;
        if (e === 0) { E.step = 1; E.t = 60; tellAll('📻 救助要請が届いた！ ヘリ到着まで60秒 — 生き延びろ', 4.5); }
        else if (e === 1) { E.step = 1; E.t = 40; tellAll('🚤 エンジンがかかった！ 暖まるまで40秒 — 音で奴らが来る', 4.5); }
        else { E.step = 2; E.t = 60; tellAll('🕳️ 鉄柵が開いた！ 坑道（赤い煙）へ逃げ込め（60秒で崩れる）', 4.5); }
      }
    } else if (E.step === 1) {
      E.t -= dt; if (e === 1) coLure('boat', 4, W.SITES.boat, 150);
      if (E.t <= 0) { E.step = 2; E.t = e === 0 ? 60 : 45; tellAll(e === 0 ? '🚁 ヘリが着陸地点に降りた！ 赤い煙へ走れ（60秒）' : '🚤 ボートが出せる！ 船着き場（赤い煙）へ走れ（45秒）', 4.5); }
    } else {
      E.t -= dt;
      alive.forEach(p => {
        if (!nearP(p, W.GOAL, e === 0 ? 9 : 5.5)) return;
        p.st = 'escaped'; p.time = VS.raceT;
        tell(p.tp, `${ESC_ICON[e]} 乗り込んだ！ 脱出成功`, 4);
        VS.players.forEach(o => { if (o && o !== p && o.st !== 'gone') tell(o.tp, `${ESC_ICON[e]} ${p.name} が脱出した`, 2.5); });
      });
      if (E.t <= 0) coEnd();
    }
  }
  // what a phase looks and sounds like, on every machine (called whenever it changes)
  function coPhaseFx() {
    const E = CO.esc, e = W.SITES.esc, key = CO.phase + E.step;
    world.setGate(e === 2 && CO.phase === 'esc' ? E.p : 0);
    if (key === CO.prevKey) return; CO.prevKey = key;
    world.setTower(CO.phase === 'esc' && e === 0 && E.step >= 1);
    world.setGoal(CO.phase === 'esc' && E.step === 2);
    if (CO.phase === 'esc' && E.step >= 1) A.radio();
  }
  // The stalkers' director: after a quiet spell one closes in on someone (from nearer the longer the calm lasts, and
  // more eagerly in the later stages); after a long chase it backs off for a while, so the night has quiet stretches
  // and sudden scares rather than one endless chase. Whoever carries an egg is smelt out; the lookout draws them.
  function coDirector(dt, alive) {
    const D = CO.dir; if (!alive.length) return;
    const hunting = roster.some(a => a.d.root.visible && (a.state === 'chase' || a.state === 'alert' || a.state === 'charge'));
    if (hunting) { D.chase += dt; D.calm = 0; }
    else { D.calm += dt; if (D.chase > 15) { D.lull = 22; D.chase = 0; } else D.chase = Math.max(0, D.chase - dt * 0.5); }
    D.lull = Math.max(0, D.lull - dt);
    D.t -= dt; if (D.t > 0) return; D.t = 3;
    const aggro = (CO.phase === 'esc' ? 2.2 : [1, 1.3, 1.7][CO.stage] || 1) * (CO.ev.t > 0 && CO.ev.k === 'frenzy' ? 2 : 1);
    const egg = alive.filter(p => CO.bag[p.slot] === 'egg'), zone = coM('lookout');
    roster.forEach((a, i) => {
      if (!a.d.root.visible || a.state !== 'wander' || a.stun > 0) return;
      const tp = (egg.length && Math.random() < 0.7 ? egg : alive)[Math.floor(Math.random() * (egg.length ? egg.length : alive.length))].tp;
      if (D.lull > 0) { const dx = a.pos.x - tp.pos.x, dz = a.pos.z - tp.pos.z, l = Math.hypot(dx, dz) || 1; a.home.set(a.pos.x + dx / l * 45, 0, a.pos.z + dz / l * 45); return; }
      if (coActive(zone) && i === 0) { const z = zone.T[0].p; a.home.set(z.x + (Math.random() - 0.5) * 40, 0, z.z + (Math.random() - 0.5) * 40); return; }
      const r = Math.max(12, 95 - D.calm * aggro * 1.6);
      a.home.set(tp.pos.x + (Math.random() - 0.5) * r * 2, 0, tp.pos.z + (Math.random() - 0.5) * r * 2);
      if (D.calm * aggro > 30 && Math.random() < 0.35) a.timer = 0; // re-plan its walk now
    });
    // a roar somewhere in the dark now and then, so nobody forgets they are out there
    if (!hunting && Math.random() < 0.07 * aggro) { const a = roster.find(x => x.d.root.visible && x.state === 'wander'); if (a) { a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch, 1.6, 2.6); } }
  }
  // host: the night's random events
  function coEvents(dt) {
    const E = CO.ev;
    if (E.t > 0) { E.t -= dt; if (E.t <= 0) { E.t = 0; tellAll(`${EV[E.k][0]}が収まった`, 2); } return; }
    E.next -= dt; if (E.next > 0) return;
    E.next = 65 + Math.random() * 60;
    let k = EVK[Math.floor(Math.random() * EVK.length)]; if (k === E.k) k = EVK[(EVK.indexOf(k) + 1) % EVK.length];
    E.k = k; E.t = EV[k][1]; tellAll(EV[k][2], 4);
    if (k === 'frenzy') roster.forEach(a => { if (a.d.root.visible) { a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch * 1.1, 2, 2.6); } });
  }
  function coCaught(a, tp, p) {
    p.st = 'ghost'; p.time = VS.raceT;
    coDropAll(p, tp.pos); // what they carried falls where it happened
    a.attackT = -1; a.feedT = 6; a.state = 'wander'; a.aware = 0.3; a.timer = 6; a.tgtP = null; a.home.copy(a.pos);
    const cat = catchInfo(a);
    if (cat) { // it seizes them, shakes them, dashes them down in front of itself, roars down at them and kills them
      a.heading = Math.atan2(tp.pos.x - a.pos.x, tp.pos.z - a.pos.z); a.feedT = a.timer = cat.len + 0.5;
      a.catchN = (a.catchN || 0) + 1; startCatch(a, p.slot);
    } else { A.roar(a.d.headPos(), a.ai.roarPitch * 1.1, 1.6, 1.8); a.d.roar(2.2); }
    if (tp.local) localCaught(a); else if (p.id) DG.Net.send({ t: 'caught', k: TREX().indexOf(a) }, p.id);
    VS.players.forEach(o => { if (o && o !== p && o.st !== 'gone') tell(o.tp, `💀 ${p.name} が沼の捕食者に捕まった…`, 3); });
    CO.dir.lull = 15; CO.dir.chase = 0;
    if (!coAlive().length) coEnd();
  }
  // ---- the catch (a stalker whose model has a 'catch' clip): played the same on every screen ----
  // The caught player watches it from inside: the jaws coming, thrown about in them, a blackout as they are dashed
  // down, then on their back looking up as it roars down into their face, and the last bite. Everyone else sees the
  // stalker with the body in its jaws, then lying in front of it.
  const catchInfo = a => (a && a.d.C && a.d.C.catch && a.s.model && a.s.model.catch) || null;
  const CQ_SIDE = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new V(0, -1, 0), new V(0, 0, 1), new V(-1, 0, 0))); // look along the head's side
  const cq0 = new THREE.Quaternion(), cq1 = new THREE.Quaternion(), cm4 = new THREE.Matrix4(), cv1 = new V(), cv2 = new V();
  function clearCatch(a) {
    if (a.catch && a.catch.body) { world.scene.remove(a.catch.body); disposeTree(a.catch.body); }
    a.catch = null; a.catchN = 0; a.catchSlot = -1;
  }
  function startCatch(a, slot) {
    if (a.catch && a.catch.body) { world.scene.remove(a.catch.body); disposeTree(a.catch.body); }
    a.catch = { t: 0, slot, spot: null, fx: {} }; a.catchSlot = slot; a.d.lunge = 0; a.speed = 0;
    a.d.oneShot('catch');
  }
  function updateCatches(dt) {
    TREX().forEach(a => {
      const C = a.catch; if (!C) return;
      const c = catchInfo(a); if (!c) { a.catch = null; return; }
      C.t += dt; a.d.lunge = 0;
      const jp = a.d.jawPoint(cv1), once = (k, t) => { if (C.t >= t && !C.fx[k]) { C.fx[k] = 1; return true; } return false; };
      if (once('grab', c.grab)) A.roar(jp, a.ai.roarPitch * 1.7, 1.3, 0.7);
      if (once('drop', c.release)) { C.spot = jp.clone(); C.spot.y = gy(C.spot); A.step(C.spot, 2.4); }
      if (once('roar', c.roar)) A.roar(a.d.headPos(), a.ai.roarPitch, 2.4, 2.8);
      if (once('kill', c.kill)) A.roar(jp, a.ai.roarPitch * 1.5, 1.4, 0.6);
      // the body, for everyone but the one it happened to (who sees it all from inside)
      const mine = C.slot === VS.mySlot;
      if (!mine && !C.body) { C.body = hurtFigure(); if (C.body) world.scene.add(C.body); }
      const B = C.body;
      if (B) {
        B.visible = C.t >= c.grab;
        if (C.t < c.release || C.t >= c.kill) { // across the jaws
          a.d.head.getWorldQuaternion(cq0); B.position.copy(jp).y -= 0.25;
          B.quaternion.copy(cq0).multiply(cq1.setFromAxisAngle(new V(0, 1, 0), Math.PI / 2));
        } else if (C.spot) { B.position.copy(C.spot); B.quaternion.setFromAxisAngle(new V(0, 1, 0), a.heading + Math.PI / 2); }
      }
      if (C.t >= c.len) { if (B) { world.scene.remove(B); disposeTree(B); } a.catch = null; }
    });
  }
  // the caught player's own camera through it all (VS.dead.t = time since the catch began)
  function catchCam(D, dt) {
    const a = D.a, c = catchInfo(a), C = a.catch, t = D.t, d = a.d, jp = d.jawPoint(cv1);
    const look = (p, k, roll) => {
      cm4.lookAt(camera.position, p, new V(0, 1, 0)); cq0.setFromRotationMatrix(cm4);
      if (roll) cq0.multiply(cq1.setFromAxisAngle(new V(0, 0, 1), roll));
      camera.quaternion.slerp(cq0, 1 - Math.exp(-dt * k));
    };
    let shk = 0;
    if (t < c.grab) { camera.position.lerp(P.pos, 1 - Math.exp(-dt * 6)); look(jp, 10); shk = 0.02; }   // the jaws come at you
    else if (t < c.release) {                                                                          // thrown about in them
      // just outside the jaws on one side, looking out past the teeth as the head throws you about
      d.head.getWorldQuaternion(cq0);
      const sd = cv2.set(1, 0, 0).applyQuaternion(cq0), fw = new V(0, 1, 0).applyQuaternion(cq0), up = new V(0, 0, 1).applyQuaternion(cq0);
      camera.position.copy(jp).addScaledVector(sd, 0.85).addScaledVector(up, 0.15);
      cm4.lookAt(camera.position, cv1.copy(jp).addScaledVector(sd, 6).addScaledVector(fw, 2.5), up); camera.quaternion.setFromRotationMatrix(cm4);
      shk = 0.06;
    } else {                                                                                           // on your back in front of it
      if (!D.spot) { D.spot = (C && C.spot ? C.spot.clone() : jp.clone()); D.spot.y = gy(D.spot) + 0.3; }
      camera.position.copy(D.spot);
      if (t < c.lookUp[0]) look(cv2.set(a.pos.x, a.pos.y + 2.2, a.pos.z), 3, 0.35);                  // dazed: its legs, its chest
      else look(jp, t < c.lookUp[1] ? 4 : 9);                                                           // looking up as it brings its head down
      shk = t > c.roar && t < c.kill ? 0.05 * (1 - (t - c.roar) / (c.kill - c.roar)) + 0.015 : 0.005;
    }
    camera.position.x += (Math.random() - 0.5) * shk; camera.position.y += (Math.random() - 0.5) * shk; camera.position.z += (Math.random() - 0.5) * shk;
    const b0 = c.blackout[0], b1 = c.blackout[1];
    let black = t < b0 ? 0 : t < b0 + 0.25 ? (t - b0) / 0.25 : t < b1 - 0.5 ? 1 : t < b1 ? (b1 - t) / 0.5 : 0;
    if (t > c.kill - 0.12) black = Math.max(black, Math.min(1, (t - (c.kill - 0.12)) / 0.18));
    $('fade').style.opacity = black;
    $('vign').style.opacity = Math.min(1, 0.55 + (t > c.roar ? 0.35 : 0));
  }
  function coEnd() {
    if (!VS.host || VS.phase === 'end') return;
    CO.phase = 'end';
    const ps = VS.players.filter(Boolean), order = { escaped: 0, alive: 1, ghost: 2, dead: 2, gone: 3 };
    const r = ps.slice().sort((a, b) => (order[a.st] ?? 4) - (order[b.st] ?? 4)).map(p => [p.slot, ST_CODE[p.st] | 0, 0, +(p.time || VS.raceT).toFixed(1)]);
    DG.Net.broadcast({ t: 'end', w: -1, r });
    showRaceEnd(-1, r);
  }

  // ---- the state of the mission, host -> everyone ----
  const CO_PH = ['m', 'esc', 'end'];
  function coState() {
    let se = 0; CO.searched.forEach(i => se |= 1 << i);
    return { ph: CO_PH.indexOf(CO.phase), sg: CO.stage, ms: CO.ms.map(M => [Math.round(M.v * 100), M.done ? 1 : 0, M.go ? 1 : 0, ...M.s.map(s => Math.round(s * 100))]),
      es: [CO.esc.step, Math.round(CO.esc.p * 100), Math.ceil(CO.esc.t)], fz: CO.fz.slice(), bg: CO.bag.map(b => BAG.indexOf(b)), kn: CO.know, rd: CO.rd.map(v => Math.round(v * 100)),
      se, cs: CO.cs.map(v => Math.round(v * 100)), ev: [EVK.indexOf(CO.ev.k), Math.ceil(CO.ev.t)],
      dr: CO.drops.map(d => d ? [+d.x.toFixed(1), +d.z.toFixed(1), d.k === 'fz' ? 0 : BAG.indexOf(d.k), d.n, Math.round(d.p * 100)] : 0),
      tr: CO.traps.map(t => [t.id, +t.x.toFixed(1), +t.z.toFixed(1), t.sp ? 1 : 0]),
      pg: CO.pings.map(p => [p.id, +p.x.toFixed(1), +p.z.toFixed(1), p.s, +p.ttl.toFixed(1), p.f]) };
  }
  function coApply(c) {
    CO.phase = CO_PH[c.ph] || 'm'; CO.stage = c.sg | 0;
    (c.ms || []).forEach((e, i) => { const M = CO.ms[i]; if (!M) return; M.v = (e[0] | 0) / 100; M.done = !!e[1]; M.go = !!e[2]; M.s = M.s.map((_, k) => (e[3 + k] | 0) / 100); });
    const es = c.es || [0, 0, 0]; CO.esc = { step: es[0] | 0, p: (es[1] | 0) / 100, t: +es[2] || 0 };
    CO.fz = (c.fz || []).map(v => v | 0); CO.bag = (c.bg || []).map(i => BAG[i] || ''); CO.know = c.kn | 0; CO.rd = (c.rd || []).map(v => (v | 0) / 100);
    CO.searched = new Set(); for (let i = 0; i < 6; i++) if (c.se & (1 << i)) CO.searched.add(i);
    CO.cs = (c.cs || []).map(v => (v | 0) / 100);
    const ev = c.ev || [-1, 0]; CO.ev.k = EVK[ev[0]] || ''; CO.ev.t = +ev[1] || 0;
    CO.drops = (c.dr || []).map(d => d ? { x: +d[0], z: +d[1], k: d[2] ? BAG[d[2]] : 'fz', n: d[3] | 0, p: (d[4] | 0) / 100 } : null);
    CO.traps = (c.tr || []).map(t => ({ id: t[0] | 0, x: +t[1], z: +t[2], sp: t[3] | 0 }));
    CO.pings = (c.pg || []).map(p => ({ id: p[0] | 0, x: +p[1], z: +p[2], s: p[3] | 0, ttl: +p[4], f: p[5] | 0 }));
  }
  function coBolt(delay) { // lightning: two quick flashes, then thunder
    world.flash(1); setTimeout(() => { if (VS.on) world.flash(0.7); }, 140);
    A.thunder(delay, 0.75 + Math.random() * 0.4);
  }

  // ---- every frame, on every machine: lights, rain, props, labels, pings, traps, sounds ----
  const coV = new V();
  function coFx(dt) {
    const me = coMe(), ghost = coGhost(), tw = world.props.tower, ev = CO.ev.t > 0 ? CO.ev.k : '';
    coPhaseFx();
    world.props.caches.forEach((c, i) => c.dim = CO.searched.has(i));
    const gm = coM('gen'), humAt = gm && gm.go ? tw.gen : CO.phase === 'esc' && W.SITES.esc === 1 && CO.esc.step >= 1 ? W.SITES.boat : null;
    A.hum(!!humAt, humAt || tw.gen);
    // the nearest stalker (for the flicker and the growl)
    let near = 1e9, na = null;
    TREX().forEach(a => { if (!a.d.root.visible) return; const d = a.pos.distanceTo(P.pos); if (d < near) { near = d; na = a; } });
    // flashlights
    if (CO.lights) VS.players.forEach(p => {
      if (!p) return; const l = CO.lights[p.slot]; if (!l) return;
      const mine = p.slot === VS.mySlot, caught = mine && VS.dead && VS.dead.a && VS.dead.a.catch; // (caught: the light still in your hand)
      const on = caught || (p.st === 'alive' && (mine ? CO.light : !!p.fl) && ev !== 'blackout');
      if (!on) { l.intensity = 0; return; }
      const pos = mine ? camera.position : p.tp.pos, yaw = mine ? P.yaw : p.yaw, pitch = mine ? P.pitch : (p.pitch || 0);
      l.position.set(pos.x + Math.cos(yaw) * 0.22, pos.y - 0.28, pos.z - Math.sin(yaw) * 0.22);
      coV.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      if (caught) { camera.getWorldDirection(coV); l.position.copy(camera.position).y -= 0.15; }
      l.target.position.copy(l.position).addScaledVector(coV, 10); l.target.updateMatrixWorld();
      let k = 1;
      if (mine && near < 38 && Math.random() < (1 - near / 38) * 0.3) k = Math.random() * 0.25; // it's close: the light falters
      l.intensity = 110 * k;
    });
    // rain falls round whoever is looking (heavier in a storm, none in the calm)
    if (CO.rain) {
      const R = CO.rain, q = R.pos, f = camera.position, sp = ev === 'storm' ? 26 : 17;
      R.m.visible = ev !== 'calm'; R.m.material.opacity = ev === 'storm' ? 0.5 : 0.3;
      for (let i = 0; i < R.N; i++) {
        const o = i * 6; let x = q[o], y = q[o + 1] - sp * dt, z = q[o + 2];
        if (y < f.y - 5) { y += 24; x = f.x + (Math.random() * 2 - 1) * 26; z = f.z + (Math.random() * 2 - 1) * 26; }
        if (x - f.x > 26) x -= 52; else if (x - f.x < -26) x += 52;
        if (z - f.z > 26) z -= 52; else if (z - f.z < -26) z += 52;
        q[o] = x; q[o + 1] = y; q[o + 2] = z; q[o + 3] = x + 0.06; q[o + 4] = y - 0.7; q[o + 5] = z + 0.03;
      }
      R.m.geometry.attributes.position.needsUpdate = true;
    }
    if (CO.prevEv !== ev) { CO.prevEv = ev; A.rain(ev === 'storm' ? 1.9 : ev === 'calm' ? 0 : 1); }
    if (VS.host && ev === 'storm') { CO.boltT = Math.min(CO.boltT, 6); }
    // the mission props and their labels
    const M_ = CO.marks;
    if (M_) {
      M_.g.visible = ghost;
      M_.caches.forEach((s, i) => s.visible = CO.fuseAt.has(i) && !CO.searched.has(i));
      CO.ms.forEach((M, mi) => M.T.forEach((t, ti) => {
        const done = (!M.d.nest && M.s[ti] >= 1) || M.done, act = coActive(M), o = t.obj, u = o ? o.userData : {};
        if (o) {
          if (u.hide) o.visible = M.s[ti] < 1; // things picked up are gone
          if (u.egg) u.egg.visible = M.s[ti] < 1;
          if (u.on) u.on.material.opacity = done ? 0.6 + 0.3 * Math.sin(T * 5 + ti) : 0;
          if (u.dim) u.dim.material.opacity = done ? 0 : (u.spark ? (Math.random() < 0.15 ? 1 : 0.1) : 0.45 + 0.2 * Math.sin(T * 3 + ti));
          if (u.blink) u.blink.material.opacity = Math.sin(T * 6) > 0.4 ? 1 : 0.05;
          if (u.wheel) u.wheel.rotation.z = M.s[ti] * 12;
          if (u.meat) u.meat.visible = M.s[ti] >= 1;
          if (u.gate) { if (u.gateRot) u.gate.rotation.x = u.gateRot[M.v ? 0 : 1]; else u.gate.position.y = u.gateY[M.v ? 0 : 1]; }
          if (M.d.kind === 'door' && u.part) { if (u.roll) u.part.scale.y = 1 - Math.min(M.s[ti], 1) * 0.9; else u.part.position.x = M.s[ti] * 1.5; }
          if (u.ring) u.ring.material.opacity = act ? 0.2 + 0.15 * Math.sin(T * 3) : 0;
        }
        if (t.lab) { const hid = M.d.mark === false; t.lab.visible = !done && (ghost ? M.stage >= CO.stage || CO.phase !== 'm' : act && !hid && camera.position.distanceTo(t.lab.position) < 28) && CO.phase === 'm'; }
      }));
      // the lost radio beeps in the dark
      const rm = coM('radio');
      if (coActive(rm)) { CO.beepT -= dt; if (CO.beepT < 0) { CO.beepT = 2.2; A.beep(new V(rm.T[0].p.x, gy(rm.T[0].p) + 0.3, rm.T[0].p.z)); } }
      // things dropped where someone was caught: a glow everybody can see
      const key = CO.drops.map(d => d ? d.x + ',' + d.z + d.k : '-').join('|');
      if (key !== M_.dropKey) {
        M_.dropKey = key; M_.dg.children.slice().forEach(o => { M_.dg.remove(o); disposeTree(o); });
        CO.drops.forEach(d => { if (!d) return; const s = labelSprite(d.k === 'fz' ? '🔌 落ちたヒューズ' : `${BAG_NAME[d.k]}（落ちている）`, '#ffd27a', 0.7); s.position.set(d.x, gy(d) + 1.4, d.z); M_.dg.add(s); });
      }
      // traps set on the ground
      const tk = CO.traps.map(t => t.id + ':' + t.sp).join('|');
      if (tk !== M_.trapKey) {
        M_.trapKey = tk; M_.tg.children.slice().forEach(o => { M_.tg.remove(o); disposeTree(o); });
        CO.traps.forEach(t => { const o = coTrapMesh(t.sp); o.position.set(t.x, gy(t) + 0.02, t.z); M_.tg.add(o); });
      }
      // pings: a beam of light in the colour of the ghost who sent it (a survivor's signal flare: red)
      const ids = new Set(CO.pings.map(p => p.id));
      M_.pg.children.slice().forEach(o => { if (!ids.has(o.userData.id)) { M_.pg.remove(o); disposeTree(o); } });
      CO.pings.forEach(p => {
        let o = M_.pg.children.find(c => c.userData.id === p.id);
        if (!o) {
          const pl = VS.players[p.s], col = p.f ? '#ff4060' : (pl || {}).color || '#9fd8ff';
          o = new THREE.Group(); o.userData.id = p.id;
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(p.f ? 0.5 : 0.3, p.f ? 0.5 : 0.3, 46, 10, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
          beam.position.y = 23; o.add(beam);
          const lab = labelSprite(p.f ? `🎆 ${pl ? pl.name : ''}` : '👻 ここ', col, 0.8); lab.position.y = 3.2; o.add(lab);
          o.position.set(p.x, gy(p), p.z); M_.pg.add(o); A.pickup();
        }
        o.children[0].material.opacity = (0.15 + 0.25 * (0.5 + 0.5 * Math.sin(T * 6))) * Math.min(1, p.ttl / 3);
      });
    }
    // the hook's wire, while it pulls
    if (CO.wire) { CO.wire.line.visible = !!P.hook; if (P.hook) { const a = CO.wire.line.geometry.attributes.position; a.setXYZ(0, camera.position.x + 0.2, camera.position.y - 0.3, camera.position.z); a.setXYZ(1, P.hook.to.x, P.hook.to.y - 1.2, P.hook.to.z); a.needsUpdate = true; } }
    // a flashbang seen up close: white
    CO.flashT = Math.max(0, CO.flashT - dt); $('coFlash').style.opacity = Math.min(1, CO.flashT);
    // breathing in the dark when it is close (and not already charging at you)
    CO.growlT -= dt;
    if (na && near < 30 && !ghost && me && me.st === 'alive' && CO.growlT < 0) { CO.growlT = 3 + Math.random() * 4; A.growl(na.d.headPos(), 0.5 + 0.5 * (1 - near / 30)); }
    // the ghost's view: see much further through the fog (fog thickens in a fog event)
    if (world.scene.fog) world.scene.fog.density = ghost ? 0.012 : ev === 'fog' ? 0.07 : W.NIGHT_FOG;
    coHud(dt, ghost);
  }
  function coTrapMesh(sprung) {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.4, metalness: 0.6 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 6, 20), m); ring.rotation.x = Math.PI / 2; g.add(ring);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283, t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 4), m); t.position.set(Math.cos(a) * 0.45, sprung ? 0.25 : 0.08, Math.sin(a) * 0.45); if (sprung) t.rotation.z = Math.cos(a) * 0.9; g.add(t); }
    return g;
  }

  // ---- HUD ----
  function coLine(M) {
    const d = M.d, ok = M.done ? '✅ ' : '', mi = CO.ms.indexOf(M), cnt = M.s.filter(s => s >= 1).length, slot = VS.mySlot;
    let p = '';
    if (d.kind === 'hold') p = `${cnt}/${M.T.length}`;
    else if (d.kind === 'code') p = CO.know & (1 << slot) ? `暗証番号 <b>${CO.code}</b>` : '番号を探す';
    else if (d.kind === 'fuse') p = `${M.v}/${M.need} 本（手持ち ${CO.fz[slot]}）`;
    else if (d.kind === 'carry') p = `${M.v}/${M.need}`;
    else if (d.kind === 'sync' || d.kind === 'gen' || d.kind === 'door') p = `${Math.round(Math.min(...M.s) * 100)}%`;
    else if (d.kind === 'photo') p = `${Math.round(M.v * 100)}%`;
    else if (d.kind === 'tranq') p = `命中 ${Math.min(M.v, M.need)}/${M.need}`;
    else if (d.kind === 'cage') p = M.v ? '閉じ込めた' : M.s[0] >= 1 ? '誘い込め' : '仕掛ける';
    else if (d.kind === 'zone') p = `${Math.floor(M.v)}/${d.dur}秒`;
    return `<div class="${M.done ? 'dn' : ''}">${ok}${d.icon} ${d.name}　<b>${M.done ? '' : p}</b>${M.done || mi < 0 ? '' : `<div class="ds">${d.desc}</div>`}</div>`;
  }
  function coHud(dt, ghost) {
    CO.hudT -= dt; if (CO.hudT > 0) return; CO.hudT = 0.2;
    const me = coMe(), e = W.SITES.esc, E = CO.esc;
    let o = '';
    if (CO.phase === 'm') o = `<div class="t">第${CO.stage + 1}段階 / 3</div>` + CO.ms.filter(M => M.stage === CO.stage).map(coLine).join('');
    else if (CO.phase === 'esc') {
      o = `<div class="t">脱出：${ESC_ICON[e]} ${ESC_NAME[e]}</div>`;
      if (E.step === 0) o += e === 0 ? `無線塔（📡）で救助ヘリを呼べ　<b>${Math.round(E.p * 100)}%</b>` : e === 1 ? `船着き場（🚤）でボートのエンジンをかけろ　<b>${Math.round(E.p * 100)}%</b>` : `坑道（🕳️）の鉄柵をこじ開けろ（2人で同時に）　<b>${Math.round(E.p * 100)}%</b>`;
      else if (E.step === 1) o += e === 0 ? `救助ヘリ到着まで <b>${Math.max(0, Math.ceil(E.t))}</b> 秒 — 生き延びろ` : `エンジンが暖まるまで <b>${Math.max(0, Math.ceil(E.t))}</b> 秒 — 音で奴らが来る`;
      else o += `${e === 0 ? '着陸地点' : e === 1 ? '船着き場' : '坑道'}（赤い煙）へ走れ！　残り <b>${Math.max(0, Math.ceil(E.t))}</b> 秒`;
    } else o = '終了';
    if (CO.ev.t > 0 && EV[CO.ev.k]) o += `<div class="ev">${EV[CO.ev.k][0]}　残り ${Math.ceil(CO.ev.t)}秒</div>`;
    if (me && me.st === 'escaped') o += `<br><span style="color:#c9e6a0">${ESC_ICON[e]} 脱出済み — 仲間を見守ろう</span>`;
    $('coObj').innerHTML = o;
    const tag = { alive: '生存', ghost: '👻 幽霊', escaped: '✅ 脱出', gone: '切断', dead: '捕まった' }, cls = { ghost: 'gh', escaped: 'es', gone: 'gn' };
    $('coTeam').innerHTML = VS.players.filter(Boolean).map(p => `<div class="${cls[p.st] || ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.slot === VS.mySlot ? '（あなた）' : ''}　${tag[p.st] || ''}${CO.fz[p.slot] ? '　🔌×' + CO.fz[p.slot] : ''}${CO.bag[p.slot] ? '　' + BAG_NAME[CO.bag[p.slot]] + 'を運搬中' : ''}</div>`).join('');
    const gb = $('coGhost');
    if (ghost) {
      gb.style.display = 'block';
      gb.innerHTML = `👻 幽霊：見つからず、物も拾えない。光のラベルの場所を探して ${DG.MOBILE ? '「合図」' : '<b>G</b>'} で光の柱を立て、生存者を導こう。救急キットを持つ仲間のそばに行けば生き返れる` +
        (CO.pingCD > 0 ? `（次の合図まで ${Math.ceil(CO.pingCD)}秒）` : '') + (DG.MOBILE ? '' : '<br>移動 WASD ／ 上昇 Space ／ 速く Shift ／ 見ている方へ飛ぶ');
    } else gb.style.display = 'none';
    $('tAct').style.display = $('tLight').style.display = ghost ? 'none' : ''; $('tPing').style.display = ghost ? '' : 'none';
    $('tLight').classList.toggle('on', CO.light);
  }
  // the compass in co-op: this stage's mission targets (not the hidden ones), where to take what you carry, the way
  // out, dropped things, pings and signal flares. A ghost sees everything (hidden things and fuse crates too).
  function coCompass(mk, vp) {
    const ghost = coGhost(), ang = q => Math.atan2(-(q.x - vp.x), -(q.z - vp.z)), bag = coMine();
    if (CO.phase === 'm') CO.ms.forEach(M => {
      if (!coActive(M) || (M.d.mark === false && !ghost)) return;
      M.T.forEach((t, i) => {
        if (M.s[i] >= 1) return;
        if (t.k === 'dst' && !ghost && !(bag && bag === M.d.item)) return;
        if (t.k === 'box' && !ghost && !CO.fz.some(v => v > 0) && !M.v) return;
        if (t.k === 'safe' && !ghost && !(CO.know & (1 << VS.mySlot))) return;
        mk(ang(t.p), M.d.icon, 'dn');
      });
    });
    if (bag && !ghost) { const M = CO.ms.find(m => m.d.item === bag); if (M) mk(ang(M.T[M.T.length - 1].p), M.d.to === 'gen' ? '⚙️' : '🏕️', 'gl'); }
    if (CO.phase === 'esc') mk(ang(CO.esc.step === 2 ? W.GOAL : world.props.esc.act), CO.esc.step === 2 ? '▼' : ESC_ICON[W.SITES.esc], CO.esc.step === 2 ? 'gl' : 'dn');
    if (ghost && CO.phase === 'm') { W.SITES.caches.forEach((c, i) => { if (CO.fuseAt.has(i) && !CO.searched.has(i)) mk(ang(c), '🔌', 'dn'); }); }
    CO.drops.forEach(d => { if (d) mk(ang(d), d.k === 'fz' ? '🔌' : '📦', 'dn'); });
    CO.pings.forEach(p => { const pl = VS.players[p.s]; mk(ang(p), '◆', '', `color:${p.f ? '#ff4060' : pl ? pl.color : '#9fd8ff'};font-size:17px`); });
  }

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
