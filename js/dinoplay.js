// Play as the swamp stalker (dino.html): the co-op mode's horror dinosaur, driven by you on the night swamp.
// It is a page of its own, apart from the game, but uses the game's pieces: world.js builds the swamp
// (W.reseed 'coop'), gltf_dino.js plays the model's own clips (idle / walk / run / roar / roar_low / bite / catch),
// audio.js its recorded roars, footfalls, rain and thunder.
// Moving is relative to the camera: it turns toward where you push, slowly (it is 13 m long), and slows while it
// turns hard. Its head turns toward where you look. A roar plants its feet; a bite can be made on the move; the catch
// is a lunge at full speed that runs out over two seconds, then plays out (shake, throw down, roar over it).
(function () {
  const DG = window.DG, W = DG.W, A = DG.A, V = THREE.Vector3;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
  const $ = id => document.getElementById(id);
  const frame = () => new Promise(r => setTimeout(r, 16));
  const setLoad = (k, t) => { $('loadBar').style.width = Math.round(k * 100) + '%'; $('loadText').textContent = t; };

  // ---- feel ----
  const WALK = 2.2, RUN = 7.2;                 // m/s (the walk clip is made for 1.5, the run for 6.6: they are sped up to match)
  const TURN_SLOW = 1.5, TURN_WALK = 1.15, TURN_RUN = 0.7; // rad/s: standing, walking, running
  const ACC = 2.6, DEC = 4.5;                  // m/s² speeding up / slowing down: heavy
  const RADIUS = 0.75;                         // pushed out of tree trunks and rocks (thin saplings it walks through)
  // camera views: distance behind, height of the point looked at
  const VIEWS = [{ name: '後ろから', dist: 15, h: 3.6 }, { name: '頭の上', dist: 7.5, h: 6.4 }, { name: '遠くから', dist: 34, h: 5 }];

  let renderer, camera, world, spec, d, moon = null, state = 'load', T = 0, last = 0;
  const me = { pos: new V(), heading: 0, speed: 0, turnRate: 0, run: false, act: '' };
  const cam = { yaw: 0, pitch: 0.16, dist: VIEWS[0].dist, h: VIEWS[0].h, view: 0, tgt: new V(), pos: new V(), shake: 0, snap: true };
  const keys = {}, touch = { mx: 0, mz: 0, run: false, stickId: null, lookId: null, sx: 0, sy: 0, lx: 0, ly: 0, pinch: 0 };
  let catchVoice = [];

  DG.playBoot = async function () {
    setLoad(0.05, 'レンダラー初期化'); await frame();
    const forced = /[?&]touch=([01])/.exec(location.search);
    DG.MOBILE = forced ? forced[1] === '1' : (matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
    DG.Q = DG.MOBILE ? { veg: 0.55, fern: 0.7, shadow: 1536, soft: false, pr: Math.min(devicePixelRatio, 1.25), aa: false, maxTex: 1024 }
      : { veg: 1, fern: 1, shadow: 4096, soft: true, pr: Math.min(devicePixelRatio, 1.5), aa: true, maxTex: 0 };
    if (DG.MOBILE) document.body.classList.add('touch');
    renderer = new THREE.WebGLRenderer({ antialias: DG.Q.aa, powerPreference: 'high-performance' });
    renderer.setPixelRatio(DG.Q.pr); renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = DG.Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    document.body.prepend(renderer.domElement);
    camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
    addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

    setLoad(0.12, '小物のモデルを読み込み中'); await DG.PROPS.load();
    setLoad(0.3, '夜の湿地を生成中'); await frame();
    W.BR_ON = false; W.reseed((Math.random() * 1e6) | 0, 'coop');
    world = W.create(renderer);
    spec = DG.SPECIES.spino;
    A.loadVoices(spec.voice.roar.concat(spec.voice.short || []));
    setLoad(0.7, '沼の捕食者を呼び出しています'); await frame();
    const gltf = await DG.loadGLB(spec.model.file);
    if (!gltf) throw new Error('恐竜のモデルを読み込めませんでした（start.bat から開いてください）');
    d = new DG.GltfDino(spec, gltf); d.ground = W.height; world.scene.add(d.root);
    makeRain();
    // a cold light from above and behind the camera, on the animal only: its dark hide would be lost in the night
    moon = new THREE.SpotLight(0xa8bcdf, 0, 90, 0.42, 0.6, 1.1); world.scene.add(moon, moon.target);
    // start: on dry ground on the swamp side of the camp, facing its fire
    const c = W.SITES.camp, out = new V(-c.x, 0, -c.z).normalize();
    for (let r = 26; r < 60; r += 2) { me.pos.copy(c).addScaledVector(out, r); if (W.height(me.pos.x, me.pos.z) > W.WATER + 0.15) break; }
    me.pos.y = W.height(me.pos.x, me.pos.z);
    me.heading = Math.atan2(c.x - me.pos.x, c.z - me.pos.z); cam.yaw = me.heading;
    placeDino(0);
    setLoad(0.9, 'シェーダーをコンパイル中'); await frame();
    updateCamera(0); renderer.compile(world.scene, camera);
    bindInput();
    $('loading').style.display = 'none';
    showStart(true);
    last = performance.now(); requestAnimationFrame(loop);
  };

  // ---- the start / pause screen ----
  function showStart(first) {
    state = 'pause'; $('start').style.display = 'flex'; $('touch').classList.remove('on');
    $('btnGo').textContent = first ? 'はじめる' : '再開';
  }
  function go() {
    A.init(); A.rain(1);
    state = 'play'; $('start').style.display = 'none'; $('touch').classList.add('on');
    if (!DG.MOBILE) lockPointer();
    else if (!document.fullscreenElement) try { const el = document.documentElement, p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); if (p && p.catch) p.catch(() => { }); } catch (e) { } // (Safari on iPad: may be prefixed, or missing)
  }

  // (newer browsers answer with a promise, refused when the page was not clicked first: that is not an error here)
  function lockPointer() { const el = renderer.domElement; try { const r = el.requestPointerLock && el.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }

  // ---- actions ----
  const busy = () => !!(d && d.os);                    // a roar, bite or catch is playing
  const head = () => d.headPos(new V());
  function roar() {
    if (state !== 'play' || busy()) return;
    d.roar(2.2); A.roar(head(), spec.ai.roarPitch, 1.8, 2.6, spec);   // (the voice timed to the clip's open jaws: species.js voice.mouth)
    cam.shake = Math.max(cam.shake, 0.12);
  }
  // the low roar, bent forward: the voice comes as its jaws open (measured on the clip: open from 2.9 s, closing
  // from 5.0 to 5.7 s), as voice.mouth does for the standing roar
  const ROAR_LOW = [2.75, 4.9, 5.8];
  function roarLow() {
    if (state !== 'play' || busy() || !d.C.roar_low) return;
    d.oneShot('roar_low'); A.roar(head(), spec.ai.roarPitch * 0.9, 1.6, 2.6, spec, ROAR_LOW);
  }
  function bite() {
    if (state !== 'play' || busy()) return;
    d.oneShot('bite'); A.roar(head(), spec.ai.roarPitch * 1.15, 1.1, 0.9, spec);
  }
  // the catch: a lunge at the clip's own running speed (spec.model.catch.run.vel), the jaws snapping shut at `grab`,
  // then the shake, the throw, the roar over the catch and the last bite. Moving again after the grab cuts it short.
  function snatch() {
    if (state !== 'play' || busy() || !d.C.catch) return;
    const C = spec.model.catch;
    d.oneShot('catch', true); me.act = 'catch';
    catchVoice.forEach(clearTimeout);
    catchVoice = [setTimeout(() => { if (d.os && d.os.k === 'catch') A.roar(head(), spec.ai.roarPitch * 1.2, 1.3, 0.9, spec); }, C.grab * 1000)];
    A.roar(head(), spec.ai.roarPitch, 1.8, 2.6, spec, [C.roar, C.roarEnd[0], C.roarEnd[1]]);
  }
  function clipVel(K, t) { // the speed the catch clip's legs run at, s into it
    if (t <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const a = K[i - 1], b = K[i]; return lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0])); }
    return K[K.length - 1][1];
  }
  function nextView() { cam.view = (cam.view + 1) % VIEWS.length; cam.dist = VIEWS[cam.view].dist; cam.h = VIEWS[cam.view].h; }

  // ---- input ----
  function bindInput() {
    $('btnGo').onclick = go;
    addEventListener('keydown', e => {
      keys[e.code] = true;
      if (state !== 'play' || e.repeat) return;
      if (e.code === 'KeyQ') roar(); else if (e.code === 'KeyE') roarLow(); else if (e.code === 'KeyF') bite(); else if (e.code === 'KeyC') snatch(); else if (e.code === 'KeyV') nextView();
    });
    addEventListener('keyup', e => keys[e.code] = false);
    addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
    const cv = renderer.domElement;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => {
      if (DG.MOBILE || state !== 'play') return;
      if (document.pointerLockElement !== cv) { lockPointer(); return; }
      if (e.button === 0) bite(); else if (e.button === 2) snatch();
    });
    document.addEventListener('pointerlockchange', () => { if (!DG.MOBILE && document.pointerLockElement !== cv && state === 'play') showStart(false); });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== cv) return;
      cam.yaw -= e.movementX * 0.0024; cam.pitch = clamp(cam.pitch + e.movementY * 0.0024, -0.2, 1.15);
    });
    addEventListener('wheel', e => { if (state === 'play') cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.91), 5, 50); }, { passive: true });
    // touch: the left half moves (a stick where the finger lands), the right half looks; two fingers on the right zoom
    const stick = $('stick'), knob = stick.querySelector('i');
    cv.addEventListener('touchstart', e => {
      if (state !== 'play') return; e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && touch.stickId === null) { touch.stickId = t.identifier; touch.sx = t.clientX; touch.sy = t.clientY; stick.style.left = t.clientX + 'px'; stick.style.top = t.clientY + 'px'; stick.classList.add('on'); }
        else if (touch.lookId === null) { touch.lookId = t.identifier; touch.lx = t.clientX; touch.ly = t.clientY; }
        else { const o = [...e.touches].find(x => x.identifier === touch.lookId); if (o) touch.pinch = Math.hypot(t.clientX - o.clientX, t.clientY - o.clientY); touch.pinchId = t.identifier; }
      }
    }, { passive: false });
    cv.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === touch.stickId) {
          let dx = t.clientX - touch.sx, dy = t.clientY - touch.sy; const r = Math.hypot(dx, dy), R = 55; if (r > R) { dx *= R / r; dy *= R / r; }
          touch.mx = dx / R; touch.mz = -dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
        } else if (t.identifier === touch.lookId && touch.pinchId == null) {
          cam.yaw -= (t.clientX - touch.lx) * 0.006; cam.pitch = clamp(cam.pitch + (t.clientY - touch.ly) * 0.005, -0.2, 1.15); touch.lx = t.clientX; touch.ly = t.clientY;
        }
      }
      if (touch.pinchId != null) {
        const a = [...e.touches].find(x => x.identifier === touch.lookId), b = [...e.touches].find(x => x.identifier === touch.pinchId);
        if (a && b) { const p = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (touch.pinch > 0) cam.dist = clamp(cam.dist * touch.pinch / p, 5, 50); touch.pinch = p; }
      }
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === touch.stickId) { touch.stickId = null; touch.mx = touch.mz = 0; stick.classList.remove('on'); knob.style.transform = ''; }
        if (t.identifier === touch.lookId) { touch.lookId = null; touch.pinchId = null; touch.pinch = 0; }
        if (t.identifier === touch.pinchId) { touch.pinchId = null; touch.pinch = 0; const o = [...e.touches].find(x => x.identifier === touch.lookId); if (o) { touch.lx = o.clientX; touch.ly = o.clientY; } }
      }
    };
    cv.addEventListener('touchend', end); cv.addEventListener('touchcancel', end);
    document.addEventListener('gesturestart', e => e.preventDefault()); // Safari (iPad / iPhone) ignores user-scalable=no: keep a two-finger zoom from zooming the page
    const press = (id, fn) => $(id).addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    press('tRun', () => { touch.run = !touch.run; $('tRun').classList.toggle('on', touch.run); });
    press('tRoar', roar); press('tLow', roarLow); press('tBite', bite); press('tCatch', snatch); press('tView', nextView);
    press('tPause', () => showStart(false));
  }

  // ---- moving ----
  const fw = new V(), rt = new V(), mv = new V();
  function step(dt) {
    // where you push, relative to the camera
    let ix = 0, iz = 0;
    if (state === 'play') {
      ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touch.mx; iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touch.mz;
    }
    fw.set(Math.sin(cam.yaw), 0, Math.cos(cam.yaw)); rt.set(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw));
    mv.copy(fw).multiplyScalar(iz).addScaledVector(rt, ix);
    const mag = Math.min(1, mv.length()), run = state === 'play' && (keys.ShiftLeft || keys.ShiftRight || touch.run);
    const os = d.os, k = os ? os.k : '';
    let want = 0, turnMax = 0;
    if (k === 'catch') { // the lunge runs at the clip's own speed, straight ahead; once it has stopped, pushing lets it go
      want = clipVel(spec.model.catch.run.vel, os.t); me.speed = want;
      if (os.t > spec.model.catch.grab + 1.6 && mag > 0.3) d.endOs(0.5);
    } else if (k === 'roar' || k === 'roar_low') want = 0; // planted
    else if (mag > 0.05) {
      const goal = Math.atan2(mv.x, mv.z), diff = wrapA(goal - me.heading), runK = clamp((me.speed - WALK) / (RUN - WALK), 0, 1);
      turnMax = me.speed < 0.5 ? TURN_SLOW : lerp(TURN_WALK, TURN_RUN, runK);
      const turn = clamp(diff, -turnMax * dt, turnMax * dt); me.heading = wrapA(me.heading + turn); me.turnRate = turn / Math.max(dt, 1e-4);
      want = mag * (run ? RUN : WALK) * clamp(Math.cos(diff), 0.15, 1) * (k === 'bite' ? 0.5 : 1);
    }
    if (k !== 'catch') me.speed = me.speed < want ? Math.min(want, me.speed + ACC * dt) : Math.max(want, me.speed - DEC * dt);
    if (!turnMax) me.turnRate = lerp(me.turnRate, 0, 1 - Math.exp(-dt * 6));
    me.run = run && me.speed > WALK + 0.5;
    me.pos.x += Math.sin(me.heading) * me.speed * dt; me.pos.z += Math.cos(me.heading) * me.speed * dt;
    world.collide(me.pos, RADIUS, Infinity, 0.45);
    const L = W.LIMIT - 8; me.pos.x = clamp(me.pos.x, -L, L); me.pos.z = clamp(me.pos.z, -L, L);
    placeDino(dt);
  }
  function placeDino(dt) {
    me.pos.y = W.height(me.pos.x, me.pos.z);
    d.root.position.copy(me.pos); d.root.rotation.y = me.heading;
    // the head turns toward where you look (but not in the middle of a roar, a bite or a catch)
    d.look = d.os ? null : new V(me.pos.x + Math.sin(cam.yaw) * 40, me.pos.y + 3, me.pos.z + Math.cos(cam.yaw) * 40);
    const ph0 = d.phase; d.update(dt, me.speed, me.turnRate);
    if (dt > 0 && Math.floor(ph0 * 2) !== Math.floor(d.phase * 2) && me.speed > 0.4) { // a footfall
      const wet = W.waterDepth(me.pos.x, me.pos.z) > 0.05;
      A.step(me.pos, Math.min(1, 0.45 + me.speed / 6)); if (wet) A.splash(0.6 + me.speed / 8);
      cam.shake = Math.max(cam.shake, 0.02 + 0.05 * me.speed / RUN * (14 / cam.dist));
    }
  }

  // ---- the camera: behind and above the point it follows, never into the ground ----
  const cd = new V();
  function updateCamera(dt) {
    const want = cd.set(me.pos.x, me.pos.y + cam.h, me.pos.z);
    if (cam.snap) { cam.tgt.copy(want); cam.snap = false; } else cam.tgt.lerp(want, 1 - Math.exp(-dt * 8));
    const cp = Math.cos(cam.pitch);
    cam.pos.set(cam.tgt.x - Math.sin(cam.yaw) * cp * cam.dist, cam.tgt.y + Math.sin(cam.pitch) * cam.dist, cam.tgt.z - Math.cos(cam.yaw) * cp * cam.dist);
    const g = Math.max(W.height(cam.pos.x, cam.pos.z), W.WATER) + 1.0; if (cam.pos.y < g) cam.pos.y = g;
    camera.position.copy(cam.pos);
    if (cam.shake > 0.001) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; cam.shake *= Math.exp(-dt * 7); }
    camera.lookAt(cam.tgt);
    if (moon) { // the light: up and back from the camera, on the animal's middle
      moon.position.set(cam.pos.x - Math.sin(cam.yaw) * 6, cam.pos.y + 14, cam.pos.z - Math.cos(cam.yaw) * 6);
      moon.target.position.set(me.pos.x, me.pos.y + 2.5, me.pos.z); moon.target.updateMatrixWorld();
      moon.intensity = 110 + cam.dist * 6;
    }
  }

  // ---- the night: rain round the camera, lightning now and then ----
  let rain = null, boltT = 12;
  function makeRain() {
    const N = DG.MOBILE ? 700 : 1500, pos = new Float32Array(N * 6), g = new THREE.BufferGeometry();
    for (let i = 0; i < N; i++) { const x = (Math.random() * 2 - 1) * 30, y = Math.random() * 26, z = (Math.random() * 2 - 1) * 30; pos.set([x, y, z, x + 0.06, y - 0.8, z + 0.03], i * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8fa3b8, transparent: true, opacity: 0.3, depthWrite: false }));
    m.frustumCulled = false; world.scene.add(m); rain = { m, pos, N };
  }
  function night(dt) {
    const q = rain.pos, f = camera.position, sp = 18;
    for (let i = 0; i < rain.N; i++) {
      const o = i * 6; let x = q[o], y = q[o + 1] - sp * dt, z = q[o + 2];
      if (y < f.y - 6) { y += 28; x = f.x + (Math.random() * 2 - 1) * 30; z = f.z + (Math.random() * 2 - 1) * 30; }
      if (x - f.x > 30) x -= 60; else if (x - f.x < -30) x += 60;
      if (z - f.z > 30) z -= 60; else if (z - f.z < -30) z += 60;
      q[o] = x; q[o + 1] = y; q[o + 2] = z; q[o + 3] = x + 0.06; q[o + 4] = y - 0.8; q[o + 5] = z + 0.03;
    }
    rain.m.geometry.attributes.position.needsUpdate = true;
    boltT -= dt;
    if (boltT < 0 && state === 'play') { boltT = 18 + Math.random() * 25; world.flash(1); setTimeout(() => world.flash(0.7), 140); A.thunder(0.6 + Math.random() * 1.5, 0.8); }
  }

  // ---- the frame ----
  const STATE = { roar: '咆哮', roar_low: '前屈みで吠えている', bite: '噛みつき', catch: '捕食' };
  let hudT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    try {
      const dt = Math.min((now - last) / 1000, 1 / 20); last = now; T += dt;
      tick(dt);
    } catch (e) { console.error(e); }
  }
  function tick(dt) {
    step(dt);
    updateCamera(dt);
    night(dt);
    world.update(dt, T, me.pos);
    A.listener(camera.position, camera.getWorldDirection(cd));
    renderer.render(world.scene, camera);
    hudT -= dt;
    if (hudT < 0) {
      hudT = 0.2;
      const k = d.os ? d.os.k : '', what = STATE[k] || (me.speed < 0.3 ? '立ち止まっている' : me.run ? '走っている' : '歩いている');
      $('state').innerHTML = `沼の捕食者 — ${what}<small>${Math.round(me.speed * 3.6)} km/h ／ 視点：${VIEWS[cam.view].name}${W.waterDepth(me.pos.x, me.pos.z) > 0.05 ? ' ／ 水の中' : ''}</small>`;
    }
  }
  // (testing) DG._dp.step(n) runs n frames of 1/30 s without waiting for the screen
  DG._dp = { get d() { return d; }, me, cam, keys, touch, get state() { return state; }, set state(v) { state = v; }, go, roar, roarLow, bite, snatch, nextView, step: n => { for (let i = 0; i < n; i++) tick(1 / 30); } };
})();
