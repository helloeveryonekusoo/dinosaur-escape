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
  DG.DIFFS = {
    easy: { name: 'やさしい', count: 2, max: 6, spawnEvery: 60, sense: 1, speed: 1, lose: 7, items: 1, startFlare: 1, flareTime: 20 },
    normal: { name: '普通', count: 3, max: 7, spawnEvery: 50, sense: 1.12, speed: 1.04, lose: 8, items: 0.8, startFlare: 1, flareTime: 18 },
    hard: { name: '難しい', count: 4, max: 8, spawnEvery: 40, sense: 1.25, speed: 1.08, lose: 10, items: 0.6, startFlare: 1, flareTime: 15 },
    vhard: { name: 'とても難しい', count: 5, max: 9, spawnEvery: 30, sense: 1.4, speed: 1.12, lose: 12, items: 0.45, startFlare: 0, flareTime: 12 }
  };
  DG.DIFF_ORDER = ['easy', 'normal', 'hard', 'vhard'];
  let diffKey = 'easy';
  try { const k = localStorage.getItem('dg_difficulty'); if (DG.DIFFS[k]) diffKey = k; } catch (e) { }
  let DF = DG.DIFFS[diffKey];
  function setDiff(k) {
    diffKey = k; DF = DG.DIFFS[k]; try { localStorage.setItem('dg_difficulty', k); } catch (e) { }
    document.querySelectorAll('#diffBtns button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    const kmh = Math.round(DG.SPECIES.trex.ai.run * DF.speed * 3.6);
    $('diffInfo').innerHTML = `ティラノ：最初 ${DF.count}頭 → ${DF.spawnEvery}秒ごとに1頭増えて最大 ${DF.max}頭 ／ 走る速さ 約${kmh}km/h ／ 目と耳の届く距離 ${Math.round(DF.sense * 100)}%<br>` +
      `アイテム：マップに ${DG.itemTotal(DF.items)}個` + (DF.startFlare ? `、最初に発煙筒 ${DF.startFlare}本` : '、最初は何も持たない') + ` ／ 発煙筒の効果 ${DF.flareTime}秒 ／ 見失うまで ${DF.lose}秒`;
  }

  DG.boot = async function () {
    setLoad(0.05, 'レンダラー初期化'); await frame();
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.prepend(renderer.domElement);
    camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 6000);
    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
    setLoad(0.15, '白亜紀の森を生成中'); await frame();
    world = W.create(renderer);
    let k = 0;
    for (const key of DG.SPECIES_ORDER) {
      const s = DG.SPECIES[key];
      setLoad(0.3 + 0.6 * k / DG.SPECIES_ORDER.length, s.name + (s.model ? ' の3Dモデルを読み込み中' : ' の皮膚と骨格を生成中')); await frame();
      let gltf = s.model ? await DG.loadGLB(s.model.file) : null;
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
    DG._dbg = { renderer, camera, world, dinos, P, items, get state() { return state; }, set state(v) { state = v; },
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
    return { d, s: d.spec, ai: d.spec.ai, pos: new V(), heading: 0, speed: 0, turnRate: 0, state: 'wander', aware: 0, timer: 0,
      target: new V(), lastSeen: new V(), home: new V(), lost: 0, roared: false, attackT: -1, lastPhase: 0, chargeDir: 0, flank: (Math.random() - 0.5) * 2 };
  }

  // A burning flare (light + noise) or meat (smell) draws nearby dinosaurs to a spot.
  // Both work even on a dinosaur that is chasing the player, unless the player is very close to it.
  DG.lure = function (pos, kind, src) {
    if (state !== 'play') return;
    const R = kind === 'meat' ? 120 : 100, close = kind === 'meat' ? 18 : 12; let n = 0;
    dinos.forEach(a => {
      if (!a.d.root.visible || a.state === 'eat' || a.state === 'fixate' || a.pos.distanceTo(pos) > R) return;
      const seesPlayer = (a.state === 'chase' || a.state === 'alert') && a.lost < 1.5;
      if (seesPlayer && a.pos.distanceTo(P.pos) < close) return;
      a.state = 'investigate'; a.lureKind = kind; a.target.copy(pos); a.arrived = false; a.roarHold = 0;
      a.timer = 45; a.bait = src || null; a.aware = Math.min(a.aware, 0.3); n++;
    });
    if (n) msg(kind === 'meat' ? '🍖 ティラノが肉の匂いに気付いた' : '🎇 ティラノが発煙筒の光に引き寄せられた', 2.2);
  };

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
    const a = best;
    a.tranq = 25; a.aware = Math.max(a.aware, 1.2); a.lastSeen.copy(P.pos); a.lost = 0;
    if (a.state !== 'chase') { a.state = 'alert'; a.timer = 0.5; }
    a.d.roar(2.2); A.roar(a.d.headPos(), a.ai.roarPitch * 1.15, 1.3, 2.0);
    return true;
  };

  // ---------------- UI ----------------
  const lock = () => { try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { } };
  function bindUI() {
    if (DG.SPECIES_ORDER.length < 2) { $('btnPrev').style.display = $('btnNext').style.display = 'none'; }
    DG.DIFF_ORDER.forEach(k => {
      const b = document.createElement('button'); b.textContent = DG.DIFFS[k].name; b.dataset.k = k; b.onclick = () => { A.init(); setDiff(k); };
      $('diffBtns').appendChild(b);
    });
    setDiff(diffKey);
    $('btnPrev').onclick = () => { A.init(); showDex(dexIdx - 1); };
    $('btnNext').onclick = () => { A.init(); showDex(dexIdx + 1); };
    $('btnStart').onclick = () => { A.init(); startGame(); };
    $('btnResume').onclick = () => { lock(); };
    $('btnQuit').onclick = $('btnTitle').onclick = () => toMenu();
    $('btnRetry').onclick = () => startGame();
    addEventListener('keydown', e => {
      keys[e.code] = true; if (e.code === 'KeyC') P.crouch = !P.crouch; if (e.code === 'Space') e.preventDefault();
      if (state === 'play') { const m = /^Digit([1-6])$/.exec(e.code); if (m) items.select(+m[1] - 1); if (e.code === 'KeyF') items.use(); }
    });
    addEventListener('mousedown', e => { if (e.button === 0 && state === 'play' && document.pointerLockElement === renderer.domElement) items.use(); });
    addEventListener('wheel', e => { if (state === 'play') items.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    addEventListener('keyup', e => keys[e.code] = false);
    addEventListener('mousemove', e => {
      if (state !== 'play' || document.pointerLockElement !== renderer.domElement) return;
      P.yaw -= e.movementX * 0.0022; P.pitch = clamp(P.pitch - e.movementY * 0.0022, -1.45, 1.45);
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
      (m ? `<div class="st">3Dモデル: “${m.title}” by ${m.author}（CC BY 4.0）</div>` : '');
    $('credits').innerHTML = DG.SPECIES_ORDER.map(k => DG.SPECIES[k]).filter(x => x._usesModel)
      .map(x => `“<a href="${x.model.url}" target="_blank" rel="noopener">${x.model.title}</a>” by ${x.model.author} — <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>`).join('<br>');
  }
  function toMenu() {
    state = 'menu'; if (document.pointerLockElement) document.exitPointerLock();
    ['hud', 'end', 'pause'].forEach(id => $(id).style.display = 'none'); $('menu').style.display = 'flex';
    showDex(dexIdx);
  }
  function msg(t, dur) { $('msg').textContent = t; $('msg').style.opacity = 1; msgT = dur || 3; }

  // ---------------- game start ----------------
  function startGame() {
    ['menu', 'end', 'pause'].forEach(id => $(id).style.display = 'none'); $('hud').style.display = 'block';
    P.pos.set(W.START.x, W.height(W.START.x, W.START.z) + 1.65, W.START.z); P.vel.set(0, 0, 0);
    P.yaw = Math.atan2(-(W.GOAL.x - W.START.x), -(W.GOAL.z - W.START.z)); P.pitch = 0; P.stam = 1; P.crouch = false; P.exhausted = false;
    killer = null; runT = 0; shake = 0; items.reset(DF);
    const rnd = DG.N.rng((Math.random() * 1e9) | 0);
    const along = (f, side) => new V(lerp(W.START.x, W.GOAL.x, f) + side, 0, lerp(W.START.z, W.GOAL.z, f));
    // (the extra T-rexes of the harder levels start well off to the sides, never close to the start)
    const spots = { trex: [[0.42, 10], [0.78, -25], [0.6, 70], [0.32, -80], [0.9, 60]], utah: [[0.78, 35]], trike: [[0.3, -45], [0.36, -55]], carno: [[0.62, -60]] };
    const used = {};
    dinos.forEach(a => {
      const k = a.s.key, n = used[k] = (used[k] || 0) + 1, sp = spots[k][Math.min(n - 1, spots[k].length - 1)];
      const p = along(sp[0], sp[1]).add(new V((rnd() - 0.5) * 30, 0, (rnd() - 0.5) * 30));
      if (k === 'utah') p.add(new V(n * 6, 0, n * 4));
      activateDino(a, p, rnd() * Math.PI * 2, n <= (a.ai.spawnEvery ? DF.count : a.ai.count));
    });
    spawnT = SPAWN_EVERY();
    state = 'play'; lock();
    msg('ティラノサウルスに見つかるな — 赤い煙の救難信号を目指せ', 5);
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
  let spawnT = 0;
  const SPAWN_EVERY = () => dinos.some(a => a.ai.spawnEvery) ? DF.spawnEvery : 0;
  const canSpawn = () => dinos.filter(a => a.ai.spawnEvery && a.d.root.visible).length < DF.max && dinos.some(a => a.ai.spawnEvery && !a.d.root.visible);
  function trySpawn(dt) {
    if (!SPAWN_EVERY() || !canSpawn()) return;
    spawnT -= dt; if (spawnT > 0) return;
    spawnT = SPAWN_EVERY();
    const a = dinos.find(x => !x.d.root.visible && x.ai.spawnEvery); if (!a) return;
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
      msg(`🦖 森の奥で新たな咆哮が響いた…（ティラノ ${n}頭）`, 3);
      return;
    }
  }

  // ---------------- player ----------------
  const fwd = new V(), right = new V();
  function updatePlayer(dt) {
    const sprintKey = keys.ShiftLeft || keys.ShiftRight;
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const moving = mx || mz;
    const adr = items.adren > 0;
    if (P.stam <= 0) P.exhausted = true; if (P.exhausted && (P.stam > 0.35 || adr)) P.exhausted = false;
    const sprint = sprintKey && moving && !P.exhausted && !P.crouch && mz > 0;
    const spd = P.crouch ? 2.0 : sprint ? (adr ? 8.8 : 7.8) : 4.3;
    P.stam = clamp(P.stam + (sprint ? (adr ? 0 : -0.15) : (moving ? 0.08 : 0.14)) * dt, 0, 1);
    fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)); right.set(-fwd.z, 0, fwd.x);
    const wish = fwd.clone().multiplyScalar(mz).addScaledVector(right, mx); if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(spd);
    const k = 1 - Math.exp(-dt * (P.ground ? 10 : 1.5));
    P.vel.x = lerp(P.vel.x, wish.x, k); P.vel.z = lerp(P.vel.z, wish.z, k);
    P.vel.y -= 22 * dt;
    if (P.ground && keys.Space && !P.crouch) { P.vel.y = 6.5; P.ground = false; }
    const px = P.pos.x, pz = P.pos.z, g0 = W.height(px, pz);
    P.pos.addScaledVector(P.vel, dt);
    world.collide(P.pos, 0.35, P.pos.y - P.eye); // fallen logs can be jumped over
    P.pos.x = clamp(P.pos.x, -W.LIMIT, W.LIMIT); P.pos.z = clamp(P.pos.z, -W.LIMIT, W.LIMIT);
    // steep walls (ravine sides) can't be walked up, and running into one mid-air stops you dead
    const feet = P.pos.y - P.eye;
    const blocked = (x, z) => {
      const hd = Math.hypot(x - px, z - pz); if (hd < 1e-5) return false;
      const g1 = W.height(x, z);
      return P.ground ? ((g1 - g0) / hd > 1.0 && g1 > feet + 0.05) : g1 > feet + 0.3;
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
  function updateDino(a, dt, playing) {
    const ai = a.ai, d = a.d;
    let desiredSpeed = 0, desiredHeading = a.heading;
    const toP = tv.copy(P.pos).sub(a.pos); toP.y = 0; const dist = toP.length();
    const angP = Math.atan2(toP.x, toP.z), rel = Math.abs(wrapA(angP - a.heading));
    a.timer -= dt;
    if (playing) {
      // perception
      let gain = 0;
      const flareLured = (a.state === 'investigate' && a.lureKind === 'flare') || a.state === 'fixate'; // its hiss drowns out footsteps
      const sr = ai.sight * DF.sense * P.vis; if (dist < sr && rel < 1.7) gain += (1.6 * (1 - dist / sr) + 0.2) * (flareLured ? 0.12 : 1); // eyes on the light
      const hr = ai.hear * DF.sense * P.noise; if (dist < hr && !flareLured) gain += 2.2 * (1 - dist / hr) + 0.2;
      if (a.state === 'eat') gain *= 0.35; // busy eating: much less attentive
      if (dist < 6 * ai.size + 3) gain += 1.5; // right next to it: always noticed
      a.aware = clamp(a.aware + (gain > 0 ? gain * dt : -0.12 * dt), 0, 1.6);
      if (gain > 0 && a.aware > 0.4) { a.lastSeen.copy(P.pos); a.lost = 0; }
      else if (!(a.state === 'chase' && a.detourT > 0)) a.lost += dt; // while going round a ravine it still knows where you are
    }
    // state machine
    if (a.state === 'wander') {
      if (a.timer < 0 || a.pos.distanceTo(a.target) < 4) { a.timer = 6 + Math.random() * 10; if (playing && ai.type === 'hunter') a.home.lerp(P.pos, 0.3); a.target.copy(a.home).add(new V((Math.random() - 0.5) * 70, 0, (Math.random() - 0.5) * 70)); a.idle = Math.random() < 0.35; }
      desiredSpeed = a.idle ? 0 : Math.max(ai.walk, d.minSpeed || 0); desiredHeading = Math.atan2(a.target.x - a.pos.x, a.target.z - a.pos.z);
      d.look = null;
      if (a.aware > 0.45) { a.state = 'alert'; a.timer = 1.6; }
    } else if (a.state === 'alert') {
      desiredSpeed = 0; desiredHeading = angP; d.look = camera.position;
      if (a.aware > 1) {
        a.state = ai.type === 'charger' ? 'charge' : 'chase'; a.timer = 0;
        if (ai.type === 'charger') { a.chargeDir = angP; a.timer = 4.5; }
        if (ai.type === 'hunter' || ai.type === 'charger' || !a.roared) {
          d.roar(2.2); A.roar(d.headPos(), ai.roarPitch, 1.4 * ai.size + 0.3, 2.4); a.roarHold = Math.max(ai.type === 'hunter' ? 1.6 : 0.6, (d.roarDuration || 0) * 0.85); a.roared = true;
          msg(a.s.name + 'に気付かれた！', 2.5);
          if (ai.type === 'pack') dinos.forEach(o => { if (o !== a && o.ai.type === 'pack') { o.aware = 1.2; o.state = 'chase'; o.lastSeen.copy(P.pos); } });
        }
      } else if (a.aware < 0.2) a.state = 'wander';
    } else if (a.state === 'chase') {
      d.look = camera.position;
      if (a.roarHold > 0) { a.roarHold -= dt; desiredSpeed = 0; desiredHeading = angP; }
      else {
        let tgt = a.lastSeen;
        if (ai.type === 'pack' && dist > 10) { // flank: aim to the side of the player
          const side = new V(Math.cos(angP), 0, -Math.sin(angP)).multiplyScalar(a.flank * Math.min(18, dist * 0.5));
          tgt = a.lastSeen.clone().add(side);
        }
        desiredHeading = Math.atan2(tgt.x - a.pos.x, tgt.z - a.pos.z); desiredSpeed = ai.run * DF.speed;
        if (a.lost > DF.lose || (a.lost > 2 && a.pos.distanceTo(a.lastSeen) < 4)) { a.state = 'wander'; a.aware = 0.3; a.home.copy(a.pos); a.timer = 0; msg('振り切った…', 2); }
      }
      if (playing && dist < ai.attack + 1.2 && rel < 0.7 && a.attackT < 0) a.attackT = 0;
    } else if (a.state === 'charge') {
      d.look = camera.position; desiredHeading = a.chargeDir; desiredSpeed = a.timer > 3.7 ? 0 : ai.run * DF.speed;
      if (a.timer > 3.7) desiredHeading = a.chargeDir = angP;
      if (playing && dist < ai.attack + 0.8 && a.attackT < 0 && a.speed > 3) a.attackT = 0;
      if (a.timer < 0) { a.state = 'cool'; a.timer = 3.5; }
    } else if (a.state === 'cool') {
      desiredSpeed = ai.walk * 0.5; desiredHeading = angP; d.look = camera.position;
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
      if (a.biteT < 0) { a.biteT = 2.2 + Math.random() * 1.2; if (d.oneShot) d.oneShot('bite'); }
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
      if (playing && a.attackT > 0.3 && a.attackT < 0.55 && P.pos.distanceTo(d.mouthPos()) < ai.attack * 0.9 + 1.2) die(a);
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
    mk(Math.atan2(-(W.GOAL.x - P.pos.x), -(W.GOAL.z - P.pos.z)), '▼', 'gl');
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

  // ---------------- main loop ----------------
  function loop() { tick(Math.min(clock.getDelta(), 1 / 20)); }
  DG._step = (n, dt) => { for (let i = 0; i < n; i++) tick(dt || 1 / 30); };
  function tick(dt) {
    T += dt;
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
    } else if (state === 'dead') {
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
