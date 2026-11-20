// Items: pickups scattered on the map, inventory, throwing (flare / meat bait), adrenaline, motion detector
(function () {
  const DG = window.DG, V = THREE.Vector3, W = DG.W;
  let FLARE_TIME = 20; // seconds a flare burns; set by the difficulty level on reset
  const flareDesc = () => `投げると強い光と音で、周囲100mのティラノを約${FLARE_TIME}秒その場に釘付けにする`;
  const TYPES = {
    flare: { name: '発煙筒', icon: '🎇', glow: 0xff5030, desc: flareDesc() },
    meat: { name: '生肉', icon: '🍖', glow: 0xff7a5a, desc: '投げて置くと匂いでティラノを引き寄せ、しばらく食べさせる' },
    dart: { name: '麻酔銃', icon: '🎯', glow: 0x9ad0ff, desc: '照準を合わせて撃つ（50m以内）。命中したティラノは25秒間 動きが鈍る' },
    camo: { name: '迷彩泥', icon: '🟫', glow: 0xb08850, desc: '体に塗ると45秒間 ティラノから見つかりにくくなる（茂みでしゃがめばほぼ見えない）' },
    adren: { name: 'アドレナリン', icon: '💉', glow: 0xffd060, desc: 'スタミナ全快＋10秒間 息切れせず速く走れる' },
    radar: { name: '動体探知機', icon: '📡', glow: 0x70ffb0, desc: '25秒間 ティラノの位置と距離がコンパスに出る' }
  };
  // co-op has its own set: things to throw or set, to move with, to help each other, and strong ones with a price
  Object.assign(TYPES, {
    cracker: { name: '爆竹', icon: '🧨', glow: 0xff6040, desc: '投げると6秒間はじけ続け、90m以内の捕食者を音で引き寄せる' },
    trap: { name: 'トラバサミ', icon: '🪤', glow: 0xc8c8c8, desc: '目の前に仕掛ける。踏んだ捕食者は7秒間動けない' },
    flash: { name: '閃光弾', icon: '💥', glow: 0xffffff, desc: '投げると強い光で、20m以内の捕食者の目を5秒間くらませ、獲物を見失わせる' },
    hook: { name: 'ワイヤーフック', icon: '🪝', glow: 0x80c0ff, desc: '狙った木・岩・地面（30m以内）へワイヤーで一気に飛びつく' },
    medkit: { name: '救急キット', icon: '⛑️', glow: 0xff5050, desc: 'そばにいる幽霊の仲間を1人生き返らせる（5m以内）' },
    signal: { name: '信号銃', icon: '🎆', glow: 0xff3060, desc: '空に打ち上げ、30秒間 仲間のコンパスに自分の位置を示す。ただし150m以内の捕食者も呼び寄せる' },
    stim: { name: '興奮剤', icon: '💊', glow: 0xffd060, desc: '12秒間 疲れずに速く走れる。切れると8秒間 足が重くなる' },
    dyn: { name: 'ダイナマイト', icon: '💣', glow: 0xff9040, desc: '投げて3秒後に爆発。12m以内の捕食者を8秒間気絶させるが、爆音でマップ中の捕食者を呼び寄せる' }
  });
  const CLASSIC = ['flare', 'meat', 'dart', 'camo', 'adren', 'radar'];
  const COOP_SET = ['dart', 'cracker', 'trap', 'flash', 'hook', 'medkit', 'signal', 'stim', 'dyn'];
  let ORDER = CLASSIC;
  const COUNTS = { flare: 7, meat: 5, dart: 4, camo: 4, adren: 5, radar: 4, cracker: 6, trap: 4, flash: 4, hook: 5, medkit: 2, signal: 3, stim: 4, dyn: 2 };
  const COOP_COUNTS = { dart: 3 };
  DG.ITEM_TYPES = TYPES; DG.ITEM_ORDER = ORDER; DG.COOP_ITEMS = COOP_SET;
  // pickups of each kind at a given difficulty multiplier (never fewer than one of a kind), and their total
  const countOf = (type, mult) => Math.max(1, Math.round((ORDER === COOP_SET && COOP_COUNTS[type] || COUNTS[type]) * (mult == null ? 1 : mult)));
  DG.itemTotal = mult => ORDER.reduce((s, k) => s + countOf(k, mult), 0);
  const THROWN = { flare: 19, meat: 14, cracker: 17, flash: 18, dyn: 15 };

  // items drawn with a CC0 model (js/props.js) when it has loaded: [model, size in metres]
  const MODEL = {
    dart: ['rifle', 0.9], medkit: ['firstaid', 0.45], flash: ['grenade', 0.3],
    flare: ['roadflare', 0.32], meat: ['meat', 0.45], camo: ['mudbucket', 0.32], adren: ['adren', 0.2], radar: ['tracker', 0.24],
    cracker: ['cracker', 0.26], trap: ['beartrap', 0.62], hook: ['hook', 0.36], signal: ['flaregun', 0.27], stim: ['stim', 0.13], dyn: ['dynamite', 0.3]
  };
  function mkMesh(type) {
    const md = MODEL[type], o = md && DG.PROPS && DG.PROPS.get(md[0], md[1]);
    if (o) {
      if (type === 'flare') { // the burning end: the white cap at +x
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b0 }));
        tip.position.set(md[1] / 2, 0.02, 0); tip.visible = false; o.add(tip); o.userData.tip = tip;
      }
      return o;
    }
    const g = new THREE.Group();
    const std = (c, r, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, emissive: e || 0x000000 });
    if (type === 'flare') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 12), std(0xc0261c, 0.45)); body.rotation.z = Math.PI / 2; g.add(body);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 12), std(0xf0f0e8, 0.5)); band.rotation.z = Math.PI / 2; band.position.x = -0.06; g.add(band);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.04, 12), std(0x222222, 0.6)); cap.rotation.z = Math.PI / 2; cap.position.x = 0.15; g.add(cap);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b0 }));
      tip.position.x = 0.17; tip.visible = false; g.add(tip); g.userData.tip = tip;
    } else if (type === 'meat') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), std(0x7a1e16, 0.45)); m.scale.set(0.24, 0.13, 0.18); g.add(m);
      const fat = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), std(0xd8c0a0, 0.6)); fat.scale.set(0.2, 0.06, 0.14); fat.position.y = 0.09; g.add(fat);
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8), std(0xeee6d6, 0.5)); bone.rotation.z = Math.PI / 2; g.add(bone);
      [-0.28, 0.28].forEach(x => { const k = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), std(0xeee6d6, 0.5)); k.position.x = x; g.add(k); });
    } else if (type === 'dart') {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.22), std(0x4a3524, 0.7)); stock.position.z = 0.1; g.add(stock);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 10), std(0x2a2c2e, 0.35)); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.18); g.add(barrel);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 10), std(0x1f6fb0, 0.3)); tank.rotation.x = Math.PI / 2; tank.position.set(0, -0.03, -0.06); g.add(tank);
    } else if (type === 'camo') {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 14), std(0x6a4a2c, 0.9)); g.add(jar);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 14), std(0x3d4a2a, 0.6)); lid.position.y = 0.085; g.add(lid);
    } else if (type === 'adren') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 12), std(0xd8e8f0, 0.2)); body.rotation.z = Math.PI / 2; g.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12), std(0xff8a1a, 0.4, 0x331800)); cap.rotation.z = Math.PI / 2; cap.position.x = 0.12; g.add(cap);
      const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 6), std(0xcccccc, 0.2)); needle.rotation.z = Math.PI / 2; needle.position.x = -0.14; g.add(needle);
    } else if (type === 'cracker' || type === 'dyn') {
      const n = type === 'dyn' ? 3 : 1;
      for (let i = 0; i < n; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 10), std(type === 'dyn' ? 0xb02418 : 0xd83a20, 0.5)); s.rotation.z = Math.PI / 2; s.position.set(0, i * 0.055, (i - 1) * 0.03 * (n > 1 ? 1 : 0)); g.add(s); }
      const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 4), std(0x333333, 0.8)); wick.position.set(0.15, 0.03, 0); wick.rotation.z = 0.8; g.add(wick);
    } else if (type === 'trap') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 6, 20), std(0x8a8a86, 0.4)); ring.rotation.x = Math.PI / 2; g.add(ring);
      for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283, t = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 4), std(0x9a9a96, 0.3)); t.position.set(Math.cos(a) * 0.22, 0.04, Math.sin(a) * 0.22); g.add(t); }
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12), std(0x6a6a66, 0.5)); g.add(plate);
    } else if (type === 'flash') {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), std(0x3a4a3a, 0.5)); g.add(can);
      const pin = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 4, 10), std(0xcccccc, 0.3)); pin.position.y = 0.09; g.add(pin);
    } else if (type === 'hook') {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.2), std(0x2a3442, 0.6)); g.add(grip);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 6), std(0xb0b4b8, 0.3)); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.16; g.add(tip);
    } else if (type === 'medkit') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.16), std(0xe8e4dc, 0.5)); g.add(box);
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.005, 0.03), std(0xd02020, 0.5)); c1.position.y = 0.062; g.add(c1);
      const c2 = c1.clone(); c2.rotation.y = Math.PI / 2; g.add(c2);
    } else if (type === 'signal') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.22), std(0xd06a10, 0.5)); g.add(body);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), std(0xd06a10, 0.5)); bar.rotation.x = Math.PI / 2; bar.position.set(0, 0.05, -0.12); g.add(bar);
    } else if (type === 'stim') {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 10), std(0xe0b030, 0.35)); g.add(b);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.03, 10), std(0xf0f0f0, 0.4)); cap.position.y = 0.065; g.add(cap);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.24), std(0x2a2e2a, 0.6)); g.add(box);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.12), new THREE.MeshBasicMaterial({ color: 0x3cff90 })); scr.rotation.x = -Math.PI / 2; scr.position.set(0, 0.031, 0.02); g.add(scr);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 6), std(0x111111, 0.5)); ant.position.set(0.06, 0.08, -0.1); g.add(ant);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  DG.makeItems = function (ctx) {
    const { scene, P, camera, msg, A } = ctx;
    const soft = DG.T.soft();
    const S = { inv: {}, sel: 0, adren: 0, radar: 0, stim: 0, crash: 0, pickups: [], proj: [], baits: [], fxs: [] };
    const hudEl = document.getElementById('inv');

    function glow(color) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
      s.scale.setScalar(1.1); return s;
    }
    // burning flares: a fixed pool of lights (always in the scene) so lighting shaders never recompile mid-game
    S.flares = [];
    const lightPool = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff4a20, 0, 45, 1.4); l.userData.free = true; scene.add(l); return l; });
    function igniteFlare(mesh, pos) {
      mesh.rotation.set(0, Math.random() * 6, 0.25);
      if (mesh.userData.tip) mesh.userData.tip.visible = true;
      const light = lightPool.find(l => l.userData.free) || null;
      if (light) { light.userData.free = false; light.position.copy(pos).y += 0.6; }
      const halo = glow(0xff4020); halo.scale.setScalar(4); halo.position.copy(pos).y += 0.3; scene.add(halo);
      const smokes = [];
      for (let i = 0; i < 14; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0xe0857a, transparent: true, depthWrite: false, opacity: 0 }));
        sp.userData.k = i / 14; scene.add(sp); smokes.push(sp);
      }
      const f = { mesh, pos: pos.clone(), t: FLARE_TIME, light, halo, smokes, get dead() { return this.t <= 0; } };
      S.flares.push(f); A.flare && A.flare(pos, FLARE_TIME);
      return f;
    }
    function removeFlare(f) {
      scene.remove(f.mesh, f.halo); f.smokes.forEach(s => scene.remove(s));
      if (f.light) { f.light.intensity = 0; f.light.userData.free = true; }
    }
    function clear() {
      [...S.pickups, ...S.proj, ...S.baits].forEach(o => scene.remove(o.mesh));
      S.flares.forEach(removeFlare);
      S.fxs.forEach(f => f.objs.forEach(o => scene.remove(o)));
      S.pickups = []; S.proj = []; S.baits = []; S.flares = []; S.fxs = [];
    }
    // co-op effects where a thrown thing lands (also shown on the other players' screens, sent by the host):
    // a firecracker sputters and pops for 6 s, a flashbang goes off in a white flash, dynamite fizzes 3 s and blows up
    S.fxAt = function (type, pos, mesh) {
      const objs = [];
      if (mesh) objs.push(mesh); else if (type === 'cracker' || type === 'dyn') { mesh = mkMesh(type); mesh.position.copy(pos); scene.add(mesh); objs.push(mesh); }
      const halo = glow(type === 'flash' ? 0xffffff : 0xffa040); halo.position.copy(pos).y += 0.2; halo.scale.setScalar(0.01); scene.add(halo); objs.push(halo);
      S.fxs.push({ type, pos: pos.clone(), t: 0, dur: type === 'cracker' ? 6 : type === 'dyn' ? 3.6 : 1.2, objs, halo, popT: 0, boom: false });
    };
    // an item handed over (a crate's find)
    S.give = function (type, n) {
      if (!TYPES[type] || !ORDER.includes(type)) return;
      S.inv[type] = (S.inv[type] || 0) + (n || 1); msg(`${TYPES[type].icon} ${TYPES[type].name}を手に入れた`, 2.2); A.pickup && A.pickup(); renderHud();
    };
    // df: the difficulty level ({items, startFlare, flareTime}); omitted = the original, easy values
    // opt.seed: lay the pickups out from this seed (a race: every player gets the same layout);
    // opt.starts: as many pickups as for this many players (a race has three)
    // opt.more: this many times as many (a race spreads them over a much larger area)
    // opt.around {c, r}: scatter them evenly over the disc of radius r round c instead of along the route
    //   (a race: a trail of pickups would point the way to the signal)
    // opt.claim(i): when set, walking onto pickup i only asks for it; S.take(i, mine) then removes it
    //   (a race: whoever gets to a pickup first has it, and it is gone for everybody)
    S.reset = function (df, opt) {
      clear();
      df = df || { items: 1, startFlare: 1, flareTime: 20 }; opt = opt || {};
      FLARE_TIME = df.flareTime; TYPES.flare.desc = flareDesc();
      ORDER = opt.set === 'coop' ? COOP_SET : CLASSIC; DG.ITEM_ORDER = ORDER;
      S.inv = {}; ORDER.forEach(k => S.inv[k] = 0);
      if (opt.set === 'coop') Object.assign(S.inv, opt.inv || {}); else S.inv.flare = df.startFlare;
      S.sel = 0; S.adren = 0; S.radar = 0; S.camo = 0; S.stim = 0; S.crash = 0;
      const rnd = DG.N.rng(opt.seed != null ? opt.seed : (Math.random() * 1e9) | 0), starts = opt.starts || [W.START], ar = opt.around;
      S.claim = opt.claim || null;
      ORDER.forEach(type => {
        const n = Math.round(countOf(type, df.items) * starts.length * (opt.more || 1));
        for (let i = 0; i < n; i++) {
          let x, z;
          if (ar) { // anywhere in the disc (area-even), kept inside the map
            const a = rnd() * Math.PI * 2, d = ar.r * Math.sqrt(rnd()), lim = W.LIMIT - 25;
            x = Math.max(-lim, Math.min(lim, ar.c.x + Math.sin(a) * d)); z = Math.max(-lim, Math.min(lim, ar.c.z + Math.cos(a) * d));
          } else { // spread along the route to the goal, with some off to the sides
            const st = starts[0], f = 0.06 + 0.9 * (i + rnd()) / n, side = (rnd() - 0.5) * (rnd() < 0.3 ? 220 : 90);
            const rx = W.GOAL.x - st.x, rz = W.GOAL.z - st.z, rl = Math.hypot(rx, rz) || 1;
            x = THREE.MathUtils.lerp(st.x, W.GOAL.x, f) - rz / rl * side; z = THREE.MathUtils.lerp(st.z, W.GOAL.z, f) + rx / rl * side + (rnd() - 0.5) * 30;
          }
          for (let k = 0; k < 20; k++) { const q = W.ravineAt(x, z); if (!q || q.depth < 0.2) break; x += 6; } // not inside a ravine
          for (const c of (W.colliders || [])) { // not inside a trunk, boulder or log, where it couldn't be reached
            const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), m = c.r + 0.7;
            if (d < m) { const k = d > 1e-3 ? m / d : 0; x = c.x + (k ? dx * k : m); z = c.z + dz * k; }
          }
          const mesh = new THREE.Group(), body = mkMesh(type), gl = glow(TYPES[type].glow);
          gl.position.y = 0.25; mesh.add(body, gl); mesh.userData = { body, gl, ph: rnd() * 6 };
          const pos = new V(x, W.height(x, z), z); mesh.position.copy(pos); scene.add(mesh);
          S.pickups.push({ type, mesh, pos });
        }
      });
      renderHud();
    };
    // pickup i is gone; mine = into my inventory. Returns false if it was already taken.
    S.take = function (i, mine) {
      const p = S.pickups[i]; if (!p || p.taken) return false;
      p.taken = true; scene.remove(p.mesh);
      if (mine) { S.inv[p.type]++; msg(`${TYPES[p.type].icon} ${TYPES[p.type].name}を拾った`, 1.8); A.pickup && A.pickup(); renderHud(); }
      return true;
    };
    S.select = i => { S.sel = (i + ORDER.length) % ORDER.length; renderHud(); };
    S.cycle = d => S.select(S.sel + d);

    S.use = function () {
      const type = ORDER[S.sel], T = TYPES[type];
      if (!S.inv[type]) { msg(T.name + 'を持っていない', 1.5); return; }
      // co-op items the game itself carries out (it may refuse: nobody to revive, nothing to hook on to…)
      if (['trap', 'hook', 'medkit', 'signal'].includes(type)) { if (DG.coItem && DG.coItem(type)) { S.inv[type]--; renderHud(); } return; }
      if (THROWN[type] && DG.coCanThrow && !DG.coCanThrow()) { msg('荷物を運んでいる間は投げられない', 1.8); return; }
      S.inv[type]--;
      if (THROWN[type]) {
        const dir = new V(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
        const mesh = mkMesh(type); const pos = P.pos.clone().addScaledVector(dir, 0.6); pos.y -= 0.2;
        mesh.position.copy(pos); scene.add(mesh);
        const vel = dir.multiplyScalar(THROWN[type]).add(new V(0, 3, 0));
        S.proj.push({ type, mesh, pos, vel, spin: new V(Math.random() * 8, Math.random() * 8, 0) });
        A.whoosh && A.whoosh();
      } else if (type === 'stim') {
        S.stim = 12; S.crash = 0; P.stam = 1; P.exhausted = false; msg('💊 興奮剤を飲んだ！ 12秒間 全力で走れる（切れると足が重くなる）', 2.5);
      } else if (type === 'dart') {
        A.dart && A.dart();
        const hit = DG.dartShot && DG.dartShot();
        msg(hit ? '🎯 命中！ ティラノの動きが鈍った（25秒）' : '🎯 外れた…', 2.2);
      } else if (type === 'camo') {
        S.camo = 45; msg('🟫 迷彩泥を塗った — 45秒間 見つかりにくい', 2.5);
      } else if (type === 'adren') {
        S.adren = 10; P.stam = 1; P.exhausted = false; msg('💉 アドレナリン注射！ 10秒間 全力で走れる', 2.5);
      } else {
        S.radar = 25; msg('📡 動体探知機 起動（25秒）', 2.5);
      }
      renderHud();
    };

    S.consumeBait = function (b) {
      if (!b || b.eaten) return; b.eaten = true; scene.remove(b.mesh);
      S.baits = S.baits.filter(x => x !== b);
    };

    // pickups far off in the fog are not drawn (a race has a hundred of them over a large map)
    const view = p => { const cp = camera.position; return p.mesh.visible = (cp.x - p.pos.x) ** 2 + (cp.z - p.pos.z) ** 2 < 160 * 160; };
    S.view = () => S.pickups.forEach(p => { if (!p.taken) view(p); }); // for someone only watching
    S.update = function (dt, t) {
      S.adren = Math.max(0, S.adren - dt); S.radar = Math.max(0, S.radar - dt); S.camo = Math.max(0, S.camo - dt);
      if (S.stim > 0) { S.stim -= dt; if (S.stim <= 0) { S.stim = 0; S.crash = 8; msg('💊 興奮剤が切れた… 足が重い', 2.2); } }
      else S.crash = Math.max(0, S.crash - dt);
      // pickups: bob, spin, collect
      const feet = P.pos.y - P.eye, now = performance.now();
      S.pickups.forEach((p, i) => {
        if (p.taken || !view(p)) return;
        const u = p.mesh.userData;
        u.body.position.y = 0.18 + Math.sin(t * 2 + u.ph) * 0.05; u.body.rotation.y = t * 0.8 + u.ph;
        u.gl.material.opacity = 0.35 + 0.25 * Math.sin(t * 3 + u.ph);
        if (Math.hypot(P.pos.x - p.pos.x, P.pos.z - p.pos.z) < 1.4 && Math.abs(feet - p.pos.y) < 1.5) {
          if (!S.claim) S.take(i, true);
          else if (!(p.asked > now - 1500)) { p.asked = now; S.claim(i); } // ask once, again only if no answer came
        }
      });
      // thrown objects
      for (let i = S.proj.length - 1; i >= 0; i--) {
        const o = S.proj[i];
        o.vel.y -= 12 * dt; o.pos.addScaledVector(o.vel, dt);
        o.mesh.position.copy(o.pos); o.mesh.rotation.x += o.spin.x * dt; o.mesh.rotation.y += o.spin.y * dt;
        const gy = W.height(o.pos.x, o.pos.z);
        if (o.pos.y <= gy + 0.08) {
          o.pos.y = gy + 0.08; o.mesh.position.copy(o.pos); S.proj.splice(i, 1);
          if (o.type === 'flare') {
            const f = igniteFlare(o.mesh, o.pos);
            DG.lure && DG.lure(f.pos, 'flare', f);
          } else if (o.type !== 'meat') { // co-op throwables: the effect here, and the game tells the host
            o.mesh.rotation.set(0, Math.random() * 6, 0); S.fxAt(o.type, o.pos, o.mesh);
            DG.coLand && DG.coLand(o.type, o.pos);
          } else {
            o.mesh.rotation.set(0, Math.random() * 6, 0);
            const b = { mesh: o.mesh, pos: o.pos.clone(), eaten: false }; S.baits.push(b);
            DG.lure && DG.lure(b.pos, 'meat', b);
          }
        }
      }
      // burning flares: flicker, glow, rising red smoke; fade out after burning down
      for (let i = S.flares.length - 1; i >= 0; i--) {
        const f = S.flares[i]; f.t -= dt;
        const burn = f.t > 0 ? Math.min(1, f.t / 2) : 0, fl = 0.75 + 0.25 * Math.sin(t * 31 + i) * Math.sin(t * 13);
        if (f.light) f.light.intensity = 60 * burn * fl;
        f.halo.material.opacity = 0.7 * burn * fl; f.halo.scale.setScalar(3.5 + fl);
        if (f.mesh.userData.tip) f.mesh.userData.tip.visible = burn > 0;
        f.smokes.forEach(s => {
          const k = (s.userData.k + t * 0.12) % 1;
          s.position.set(f.pos.x + Math.sin(k * 7 + i) * k * 2 + k * 3, f.pos.y + 0.3 + k * 9, f.pos.z + Math.cos(k * 5) * k * 1.5);
          s.scale.setScalar(0.6 + k * 5); s.material.opacity = 0.45 * (1 - k) * Math.min(1, k * 6) * Math.min(1, (f.t + 3) / 3);
        });
        if (f.t < -3) { removeFlare(f); S.flares.splice(i, 1); }
      }
      // co-op throwables going off
      for (let i = S.fxs.length - 1; i >= 0; i--) {
        const f = S.fxs[i]; f.t += dt;
        if (f.type === 'cracker') {
          f.popT -= dt;
          if (f.popT <= 0 && f.t < f.dur) { f.popT = 0.08 + Math.random() * 0.3; A.pop && A.pop(f.pos); f.halo.scale.setScalar(1.5 + Math.random() * 2.5); f.halo.material.opacity = 0.9; }
          else f.halo.material.opacity *= Math.exp(-dt * 14);
        } else if (f.type === 'flash' || f.type === 'dyn') {
          const at = f.type === 'flash' ? 0.5 : 3;
          if (!f.boom && f.t < at) { f.halo.scale.setScalar(f.type === 'dyn' ? 0.5 + Math.random() * 0.5 : 0.01); f.halo.material.opacity = 0.8; }
          if (!f.boom && f.t >= at) {
            f.boom = true; if (f.objs[0] !== f.halo) { scene.remove(f.objs[0]); }
            if (f.type === 'flash') A.bang && A.bang(f.pos); else A.boom && A.boom(f.pos);
            DG.coFxLocal && DG.coFxLocal(f.type, f.pos);
          }
          if (f.boom) { const k = (f.t - at) / 0.8; f.halo.scale.setScalar((f.type === 'dyn' ? 26 : 34) * Math.min(1, k * 3 + 0.3)); f.halo.material.opacity = Math.max(0, 1 - k); }
          f.dur = at + 0.9;
        }
        if (f.t >= f.dur) { f.objs.forEach(o => scene.remove(o)); S.fxs.splice(i, 1); }
      }
    };

    function renderHud() {
      if (!hudEl) return;
      const T = TYPES[ORDER[S.sel]];
      hudEl.innerHTML = ORDER.map((k, i) => `<div class="slot${i === S.sel ? ' on' : ''}${S.inv[k] ? '' : ' empty'}" data-i="${i}"><span class="key">${i + 1}</span>${TYPES[k].icon}<span class="cnt">${S.inv[k] || 0}</span></div>`).join('') +
        `<div class="iname">${DG.MOBILE ? T.name : T.name + ' — ' + T.desc}</div>`; // a phone has no room for the description here
    }
    // touch: tap a slot to select it (its description is shown as a message instead)
    if (hudEl) hudEl.addEventListener('pointerdown', e => {
      const s = e.target.closest && e.target.closest('.slot'); if (!s || !DG.MOBILE) return;
      e.preventDefault(); S.select(+s.dataset.i); const T = TYPES[ORDER[S.sel]]; msg(`${T.icon} ${T.name}：${T.desc}`, 2.5);
    });
    S.reset();
    return S;
  };
})();
