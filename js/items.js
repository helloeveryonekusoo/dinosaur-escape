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
  const ORDER = ['flare', 'meat', 'dart', 'camo', 'adren', 'radar'];
  const COUNTS = { flare: 7, meat: 5, dart: 4, camo: 4, adren: 5, radar: 4 };
  DG.ITEM_TYPES = TYPES; DG.ITEM_ORDER = ORDER;
  // pickups of each kind at a given difficulty multiplier (never fewer than one of a kind), and their total
  const countOf = (type, mult) => Math.max(1, Math.round(COUNTS[type] * (mult == null ? 1 : mult)));
  DG.itemTotal = mult => ORDER.reduce((s, k) => s + countOf(k, mult), 0);

  function mkMesh(type) {
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
    const S = { inv: {}, sel: 0, adren: 0, radar: 0, pickups: [], proj: [], baits: [] };
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
      S.pickups = []; S.proj = []; S.baits = []; S.flares = [];
    }
    // df: the difficulty level ({items, startFlare, flareTime}); omitted = the original, easy values
    S.reset = function (df) {
      clear();
      df = df || { items: 1, startFlare: 1, flareTime: 20 };
      FLARE_TIME = df.flareTime; TYPES.flare.desc = flareDesc();
      S.inv = { flare: df.startFlare, meat: 0, dart: 0, camo: 0, adren: 0, radar: 0 }; S.sel = 0; S.adren = 0; S.radar = 0; S.camo = 0;
      const rnd = DG.N.rng((Math.random() * 1e9) | 0);
      ORDER.forEach(type => {
        const n = countOf(type, df.items);
        for (let i = 0; i < n; i++) {
          // spread along the route to the goal, with some off to the sides
          const f = 0.06 + 0.9 * (i + rnd()) / n, side = (rnd() - 0.5) * (rnd() < 0.3 ? 220 : 90);
          let x = THREE.MathUtils.lerp(W.START.x, W.GOAL.x, f) + side, z = THREE.MathUtils.lerp(W.START.z, W.GOAL.z, f) + (rnd() - 0.5) * 30;
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
    S.select = i => { S.sel = (i + ORDER.length) % ORDER.length; renderHud(); };
    S.cycle = d => S.select(S.sel + d);

    S.use = function () {
      const type = ORDER[S.sel], T = TYPES[type];
      if (!S.inv[type]) { msg(T.name + 'を持っていない', 1.5); return; }
      S.inv[type]--;
      if (type === 'flare' || type === 'meat') {
        const dir = new V(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
        const mesh = mkMesh(type); const pos = P.pos.clone().addScaledVector(dir, 0.6); pos.y -= 0.2;
        mesh.position.copy(pos); scene.add(mesh);
        const vel = dir.multiplyScalar(type === 'flare' ? 19 : 14).add(new V(0, 3, 0));
        S.proj.push({ type, mesh, pos, vel, spin: new V(Math.random() * 8, Math.random() * 8, 0) });
        A.whoosh && A.whoosh();
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

    S.update = function (dt, t) {
      S.adren = Math.max(0, S.adren - dt); S.radar = Math.max(0, S.radar - dt); S.camo = Math.max(0, S.camo - dt);
      // pickups: bob, spin, collect
      const feet = P.pos.y - P.eye;
      S.pickups.forEach(p => {
        if (p.taken) return;
        const u = p.mesh.userData;
        u.body.position.y = 0.18 + Math.sin(t * 2 + u.ph) * 0.05; u.body.rotation.y = t * 0.8 + u.ph;
        u.gl.material.opacity = 0.35 + 0.25 * Math.sin(t * 3 + u.ph);
        if (Math.hypot(P.pos.x - p.pos.x, P.pos.z - p.pos.z) < 1.4 && Math.abs(feet - p.pos.y) < 1.5) {
          p.taken = true; scene.remove(p.mesh); S.inv[p.type]++;
          msg(`${TYPES[p.type].icon} ${TYPES[p.type].name}を拾った`, 1.8); A.pickup && A.pickup(); renderHud();
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
