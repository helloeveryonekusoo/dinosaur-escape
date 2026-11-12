// Procedural textures generated into DataTextures
(function () {
  const DG = window.DG; const N = DG.N;
  const T = DG.T = {};
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const mix = (a, b, t) => a + (b - a) * t;
  const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  T.hex = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

  function tex(w, h, data, srgb, rep) {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (rep) t.repeat.set(rep[0], rep[1]);
    t.needsUpdate = true; return t;
  }
  T.tex = tex;

  // height field -> normal map RGB + cavity in alpha
  function heightToNormal(H, w, h, strength, cavityMin) {
    const d = new Uint8Array(w * h * 4);
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < H.length; i++) { if (H[i] < mn) mn = H[i]; if (H[i] > mx) mx = H[i]; }
    const rg = mx - mn || 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w, yu = (y - 1 + h) % h, yd = (y + 1) % h;
      const dx = (H[y * w + xr] - H[y * w + xl]) * strength, dy = (H[yd * w + x] - H[yu * w + x]) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (-dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[i + 3] = (cavityMin + (1 - cavityMin) * ((H[y * w + x] - mn) / rg)) * 255;
    }
    return d;
  }

  // Reptile scale detail: normal (rgb) + cavity (a). tiled.
  T.skinDetail = function (o) {
    const S = o.size || 512, C = o.cells || 28, seed = o.seed || 1;
    const H = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      // two scale sizes blended by a low-freq mask (big scutes among small scales)
      const m = N.smoothstep(0.45, 0.62, N.fbm2(u * 4, v * 4, seed + 5, 3, 4, 4));
      let r = N.voronoi(u * C, v * C, C, C, seed, 0.9);
      let small = N.smoothstep(0.0, 0.32, r.f2 - r.f1) * (0.75 + 0.25 * r.id) - r.f1 * 0.25;
      r = N.voronoi(u * C * 0.45, v * C * 0.45, Math.round(C * 0.45), Math.round(C * 0.45), seed + 3, 0.85);
      let big = N.smoothstep(0.0, 0.25, r.f2 - r.f1) * (0.8 + 0.2 * r.id) - r.f1 * 0.35;
      big *= o.scutes == null ? 1 : o.scutes;
      let s = mix(small, big * 1.2, m * (o.scutes == null ? 0.7 : o.scutes));
      // wrinkles / folds running around the body
      const wr = Math.abs(N.fbm2(u * 3, v * 22, seed + 9, 4, 3, 22) - 0.5);
      s += (0.12 - wr) * (o.wrinkle || 0.6);
      s += (N.fbm2(u * 64, v * 64, seed + 11, 2, 64, 64) - 0.5) * 0.12; // grain
      H[y * S + x] = s;
    }
    return tex(S, S, heightToNormal(H, S, S, o.strength || 6, o.cavity || 0.35), false, o.repeat);
  };

  // Macro colour: u along body (0 tail tip -> 1 snout), v around (0 = dorsal, .5 = belly)
  T.skinColor = function (o) {
    const W = 1024, Hh = 256, d = new Uint8Array(W * Hh * 4), seed = o.seed || 3;
    const top = T.hex(o.top), side = T.hex(o.side), belly = T.hex(o.belly), pat = T.hex(o.pattern || o.top);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / Hh;
      const c = (1 - Math.cos(v * Math.PI * 2)) / 2; // 0 dorsal -> 1 ventral
      let col = c < 0.5 ? mix3(top, side, N.smoothstep(0.05, 0.5, c)) : mix3(side, belly, N.smoothstep(0.55, 0.85, c));
      const dorsal = 1 - N.smoothstep(0.35, 0.62, c);
      const warp = N.fbm2(u * 8, v * 6, seed + 1, 3, 0, 6);
      let p = 0;
      if (o.type === 'stripes') {
        const s = Math.sin((u * (o.freq || 30) + warp * 2.2 + Math.abs(v - 0.5) * 1.5) * Math.PI * 2);
        p = N.smoothstep(0.25, 0.65, s) * dorsal;
      } else if (o.type === 'mottle') {
        p = N.smoothstep(0.5, 0.62, N.fbm2(u * (o.freq || 40), v * 10, seed + 2, 4, 0, 10)) * (0.4 + 0.6 * dorsal);
      } else if (o.type === 'spots') {
        const r = N.voronoi(u * (o.freq || 60), v * 16 + warp, 0, 16, seed + 4, 1);
        p = (1 - N.smoothstep(0.18, 0.32, r.f1)) * (r.id > 0.4 ? 1 : 0) * (0.3 + 0.7 * dorsal);
      } else if (o.type === 'bands') {
        const s = Math.sin((u * (o.freq || 14) + warp * 0.8) * Math.PI * 2);
        p = N.smoothstep(0.4, 0.8, s) * (0.2 + 0.8 * dorsal);
      }
      col = mix3(col, pat, p * (o.patAmt == null ? 0.85 : o.patAmt));
      // dark dorsal line and head darkening
      col = mix3(col, top, (1 - N.smoothstep(0, 0.06, Math.min(v, 1 - v))) * 0.4);
      if (o.headTint) col = mix3(col, T.hex(o.headTint), N.smoothstep(0.84, 0.95, u) * (1 - c * 0.7) * 0.6);
      // dirt / patina near belly + feet, and fine variation
      const g = N.fbm2(u * 90, v * 30, seed + 7, 3, 0, 30);
      const k = 0.82 + 0.36 * g;
      const i = (y * W + x) * 4;
      d[i] = clamp01(col[0] * k) * 255; d[i + 1] = clamp01(col[1] * k) * 255; d[i + 2] = clamp01(col[2] * k) * 255; d[i + 3] = 255;
    }
    const t = tex(W, Hh, d, true); t.wrapS = THREE.ClampToEdgeWrapping; return t;
  };

  T.iris = function (o) {
    const W = 256, H = 128, d = new Uint8Array(W * H * 4);
    const ic = T.hex(o.iris), oc = T.hex(o.outer || 0x2a1a10);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / 30, dy = (y - H / 2) / 30, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      let col;
      if (r < 1) {
        const fib = 0.75 + 0.35 * N.fbm2(a * 6, r * 4, 3, 3, 0, 0);
        col = mix3(ic, [ic[0] * 0.5, ic[1] * 0.35, ic[2] * 0.2], N.smoothstep(0.55, 1.0, r)).map(c => c * fib);
        const pr = o.slit ? Math.hypot(dx * 3.2, dy * 0.9) : r * 2.1;
        if (pr < 1) col = [0.01, 0.01, 0.01];
        else col = mix3([0.01, 0.01, 0.01], col, N.smoothstep(1, 1.15, pr));
      } else col = mix3([ic[0] * 0.25, ic[1] * 0.2, ic[2] * 0.15], oc, N.smoothstep(1, 1.3, r));
      const i = (y * W + x) * 4; d[i] = clamp01(col[0]) * 255; d[i + 1] = clamp01(col[1]) * 255; d[i + 2] = clamp01(col[2]) * 255; d[i + 3] = 255;
    }
    const t = tex(W, H, d, true); t.wrapT = THREE.ClampToEdgeWrapping; return t;
  };

  // feather card (alpha) : x across vane, y along rachis
  T.feather = function (o) {
    const W = 64, H = 256, d = new Uint8Array(W * H * 4), c1 = T.hex(o.c1), c2 = T.hex(o.c2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x / W) * 2 - 1, v = y / H;
      const width = Math.sin(Math.min(1, v * 1.15) * Math.PI) ** 0.6 * 0.95;
      const barb = Math.sin((v * 90 + Math.abs(u) * 14) * 1) * 0.5 + 0.5;
      const edge = width - Math.abs(u) - (N.vnoise2(v * 40, u * 3, 4) * 0.25);
      let a = N.smoothstep(0, 0.06, edge);
      const col = mix3(c1, c2, N.smoothstep(0.55, 0.95, v) * 0.8 + 0.2 * N.fbm2(x / 8, y / 30, 5, 2));
      const k = 0.7 + 0.3 * barb, rach = Math.abs(u) < 0.04 ? 0.6 : 1;
      const i = (y * W + x) * 4;
      d[i] = clamp01(col[0] * k * rach) * 255; d[i + 1] = clamp01(col[1] * k * rach) * 255; d[i + 2] = clamp01(col[2] * k * rach) * 255; d[i + 3] = a * 255;
    }
    const t = tex(W, H, d, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  };

  // Forest floor: colour + normal
  T.ground = function () {
    const S = 512, d = new Uint8Array(S * S * 4), H = new Float32Array(S * S);
    const dirt = T.hex(0x54412d), moss = T.hex(0x3e4528), litter = T.hex(0x6a563a), dark = T.hex(0x2e2618);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n1 = N.fbm2(u * 6, v * 6, 21, 5, 6, 6), n2 = N.fbm2(u * 24, v * 24, 22, 3, 24, 24);
      // a few half-buried pebbles (irregular sizes) and a scatter of dead-leaf / needle flecks
      const r = N.voronoi(u * 34, v * 34, 34, 34, 23, 1);
      const peb = (1 - N.smoothstep(0.06 + 0.16 * r.id, 0.12 + 0.2 * r.id, r.f1)) * (r.id > 0.9 ? 1 : 0);
      const r2 = N.voronoi(u * 96, v * 96, 96, 96, 26, 1), fid = r2.id;
      const fleck = (1 - N.smoothstep(0.1, 0.24, r2.f1)) * (fid > 0.55 ? 1 : 0) * N.smoothstep(0.4, 0.6, n2);
      let col = mix3(dirt, moss, N.smoothstep(0.42, 0.62, n1) * 0.7);
      col = mix3(col, litter, N.smoothstep(0.55, 0.7, n2) * 0.6);
      col = mix3(col, dark, (1 - n2) * 0.35);
      col = mix3(col, fid > 0.8 ? [0.42, 0.33, 0.2] : [0.2, 0.15, 0.1], fleck * 0.55);
      col = mix3(col, [0.36, 0.34, 0.31], peb * 0.7);
      const k = 0.85 + 0.3 * N.vnoise2(x * 0.7, y * 0.7, 24);
      const i = (y * S + x) * 4;
      d[i] = clamp01(col[0] * k) * 255; d[i + 1] = clamp01(col[1] * k) * 255; d[i + 2] = clamp01(col[2] * k) * 255; d[i + 3] = 255;
      H[y * S + x] = n2 * 0.6 + peb * 0.8 + fleck * 0.2 + N.vnoise2(x * 0.5, y * 0.5, 25) * 0.15;
    }
    return { map: tex(S, S, d, true), normal: tex(S, S, heightToNormal(H, S, S, 4, 0.5), false) };
  };

  T.bark = function () {
    // deeply furrowed bark: vertical ridges broken into plates, with patches of grey-green lichen. One tile ≈ 1.2 m x 1.5 m.
    const S = 512, d = new Uint8Array(S * S * 4), H = new Float32Array(S * S);
    const dark = T.hex(0x231a13), mid = T.hex(0x3b2f25), light = T.hex(0x514234), lichen = T.hex(0x525c46);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const warp = N.fbm2(u * 4, v * 3, 31, 3, 4, 3), w2 = N.fbm2(u * 9, v * 2, 32, 2, 9, 2);
      const s = u * 16 + warp * 3.2 + w2 * 1.5;                              // 16 wavy ridges per tile, running up the trunk
      const fur = N.smoothstep(0.1, 0.75, Math.abs(Math.sin(Math.PI * s)));  // 0 in the furrows
      const crack = N.smoothstep(0, 0.08, Math.abs(N.fbm2(u * 10, v * 12, 33, 3, 10, 12) - 0.5)); // horizontal breaks
      const fine = N.fbm2(u * 64, v * 64, 34, 2, 64, 64);
      const h = fur * (0.55 + 0.3 * crack) + fine * 0.15;
      H[y * S + x] = h;
      let col = h < 0.5 ? mix3(dark, mid, h * 2) : mix3(mid, light, h * 2 - 1);
      col = mix3(col, lichen, N.smoothstep(0.58, 0.7, N.fbm2(u * 5, v * 5, 35, 3, 5, 5)) * fur * 0.55);
      const k = (0.85 + 0.3 * fine) * (0.82 + 0.36 * warp), i = (y * S + x) * 4; // plates differ a little in tone
      d[i] = clamp01(col[0] * k) * 255; d[i + 1] = clamp01(col[1] * k) * 255; d[i + 2] = clamp01(col[2] * k) * 255; d[i + 3] = 255;
    }
    return { map: tex(S, S, d, true), normal: tex(S, S, heightToNormal(H, S, S, 7, 0.4), false) };
  };

  // Weathered boulder surface: mottled grey stone, cracks, pale lichen
  T.rock = function () {
    const S = 512, d = new Uint8Array(S * S * 4), H = new Float32Array(S * S);
    const c0 = T.hex(0x47443e), c1 = T.hex(0x736e64), crk = T.hex(0x24221f), lich = T.hex(0x8a8a6a), ochre = T.hex(0x6f5a34);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n1 = N.fbm2(u * 4, v * 4, 61, 5, 4, 4), n2 = N.fbm2(u * 32, v * 32, 62, 3, 32, 32);
      let r = N.voronoi(u * 5 + n1 * 0.8, v * 5, 5, 5, 63, 1);
      const cr1 = (1 - N.smoothstep(0, 0.025, r.f2 - r.f1)) * 0.8;
      r = N.voronoi(u * 13, v * 13 + n1 * 1.2, 13, 13, 64, 1);
      const cr2 = (1 - N.smoothstep(0, 0.04, r.f2 - r.f1)) * 0.45;
      const cr = Math.max(cr1, cr2);
      let col = mix3(c0, c1, N.smoothstep(0.3, 0.7, n1));
      col = mix3(col, ochre, N.smoothstep(0.6, 0.75, N.fbm2(u * 7, v * 7, 66, 3, 7, 7)) * 0.35);
      col = mix3(col, lich, N.smoothstep(0.62, 0.7, N.fbm2(u * 9, v * 9, 65, 3, 9, 9)) * 0.6);
      col = mix3(col, crk, cr * 0.85);
      const k = 0.78 + 0.45 * n2, i = (y * S + x) * 4;
      d[i] = clamp01(col[0] * k) * 255; d[i + 1] = clamp01(col[1] * k) * 255; d[i + 2] = clamp01(col[2] * k) * 255; d[i + 3] = 255;
      H[y * S + x] = n1 * 0.5 + n2 * 0.25 - cr * 0.6;
    }
    return { map: tex(S, S, d, true), normal: tex(S, S, heightToNormal(H, S, S, 6, 0.45), false) };
  };

  // Exposed rock face for ravine walls and steep slopes: bedded strata (v = up) with vertical joints
  T.cliff = function () {
    const S = 512, d = new Uint8Array(S * S * 4);
    const pal = [T.hex(0x5e5347), T.hex(0x453b30), T.hex(0x6f6253), T.hex(0x50463a)], crk = T.hex(0x1a1612), soil = T.hex(0x44341f);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const warp = N.fbm2(u * 3, v * 3, 71, 3, 3, 3);
      const layer = (v * 9 + (warp - 0.5) * 1.4 + 90) % 9, li = Math.floor(layer), s = layer - li; // 9 beds per tile, gently folded
      const edge = 1 - N.smoothstep(0, 0.1 + 0.1 * N.hash2(li, 3, 72), Math.min(s, 1 - s));
      const r = N.voronoi(u * 6 + N.hash2(li, 5, 73) * 3, v * 3, 6, 3, 74, 1);
      const joint = 1 - N.smoothstep(0, 0.05, r.f2 - r.f1);
      const n2 = N.fbm2(u * 40, v * 40, 75, 3, 40, 40), n1 = N.fbm2(u * 6, v * 6, 76, 3, 6, 6);
      let col = pal[Math.floor(N.hash2(li, 9, 77) * pal.length)];
      col = mix3(col, soil, N.smoothstep(0.55, 0.75, n1) * 0.5);      // earth washed down over the rock
      col = mix3(col, crk, Math.max(edge * 0.75, joint * 0.7));
      const k = 0.75 + 0.5 * n2, i = (y * S + x) * 4;
      d[i] = clamp01(col[0] * k) * 255; d[i + 1] = clamp01(col[1] * k) * 255; d[i + 2] = clamp01(col[2] * k) * 255; d[i + 3] = 255;
    }
    return tex(S, S, d, true);
  };

  // Conifer bough (alpha), x across, y along the branch: a woody limb carrying side branchlets, each a dense
  // tapering spray of foliage. What matters is the outline — a broad, ragged, well-covered mass with notches
  // between the sprays — far more than any detail inside it.
  T.bough = function () {
    const W = 256, H = 512, d = new Uint8Array(W * H * 4), rr = N.rng(91), sprays = [], n = 13;
    for (let i = 0; i < n; i++) for (let s = -1; s <= 1; s += 2) {
      const v = 0.06 + 0.86 * (i + (s > 0 ? 0.5 : 0) + (rr() - 0.5) * 0.4) / n;
      const env = (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, v * 1.15 + 0.08))) * (1 - 0.55 * v * v);
      const ang = 0.9 + (rr() - 0.5) * 0.3 - 0.3 * v;                       // angle away from the limb; sprays near the tip point forward
      if (i > 1 && rr() < 0.13) continue;                                    // a spray missing here and there
      const L = Math.min(150 * env * (0.5 + 0.75 * rr()), 102 / Math.sin(ang)); // uneven lengths: a ragged outline, not a feather
      const y0 = v * H, x1 = s * Math.sin(ang) * L, y1 = Math.min(H - 10, y0 + Math.cos(ang) * L), sh = 0.72 + 0.5 * rr(), hw = 12 + 8 * env;
      sprays.push([0, y0, x1, y1, hw, sh]);
      for (let k = 0; k < 2; k++) {                                          // twigs forking off the spray
        const t = 0.3 + 0.45 * rr(), a2 = ang + (k ? 0.7 : -0.6) * (0.7 + 0.6 * rr()), l2 = L * (0.3 + 0.25 * rr());
        const bx = x1 * t, by = y0 + (y1 - y0) * t;
        const ex = Math.max(-116, Math.min(116, bx + s * Math.sin(a2) * l2)), ey = Math.min(H - 8, by + Math.cos(a2) * l2);
        sprays.push([bx, by, ex, ey, hw * 0.72, sh * (0.85 + 0.3 * rr())]);
      }
    }
    sprays.push([0, 0.86 * H, 0, 0.985 * H, 13, 1]);                        // the leading shoot
    const dark = [0.06, 0.115, 0.06], mid = [0.135, 0.23, 0.105], tip = [0.25, 0.35, 0.15], wood = [0.2, 0.15, 0.1];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const px = x - W / 2 + 0.5, v = y / H;
      let best = 9, bt = 0, bs = 1;
      for (const [x0, y0, x1, y1, hw, sh] of sprays) {
        const ex = x1 - x0, ey = y1 - y0, t = Math.max(0, Math.min(1, ((px - x0) * ex + (y - y0) * ey) / (ex * ex + ey * ey)));
        const dn = Math.hypot(px - (x0 + ex * t), y - (y0 + ey * t)) / (hw * (1 - 0.72 * Math.pow(t, 1.5)));
        if (dn < best) { best = dn; bt = t; bs = sh; }
      }
      const fuzz = (N.vnoise2(x * 0.42, y * 0.42, 92) - 0.5) * 0.7 + (N.vnoise2(x * 0.11, y * 0.11, 93) - 0.5) * 0.5; // ragged needle edge
      let a = N.smoothstep(0, 0.28, 1 - best + fuzz);
      const limb = (1 - N.smoothstep(2.2 * (1 - 0.6 * v) + 1.2, 3.4 * (1 - 0.6 * v) + 2.2, Math.abs(px))) * (v < 0.9 ? 1 : 0);
      a = Math.max(a, limb);
      const g = (0.8 + 0.4 * N.vnoise2(x * 0.3, y * 0.3, 94)) * bs;
      let col = best < 0.5 ? mix3(dark, mid, best * 2) : mix3(mid, tip, Math.min(1, (best - 0.5) * 2));   // dim inside the spray, light at its edge
      col = mix3(col, tip, N.smoothstep(0.6, 1, bt) * 0.6).map(c => c * g);                                // and at its growing tip
      col = mix3(col, wood, limb * (1 - N.smoothstep(0.2, 0.6, 1 - best)));
      const i = (y * W + x) * 4;
      d[i] = clamp01(col[0]) * 255; d[i + 1] = clamp01(col[1]) * 255; d[i + 2] = clamp01(col[2]) * 255; d[i + 3] = clamp01(a) * 255;
    }
    const t = tex(W, H, d, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  };

  // (older comb-like needle card; no longer used by the world)
  T.needle = function () {
    const W = 128, H = 512, d = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x / W) * 2 - 1, v = y / H, au = Math.abs(u), side = u < 0 ? 0 : 1;
      const env = (0.95 * (1 - Math.pow(v, 2.4)) + 0.04) * N.smoothstep(0, 0.05, v) * (1 - N.smoothstep(0.97, 1, v));
      const k = v * 70 - au * 9, idx = Math.floor(k), seg = k - idx;
      const len = env * (0.72 + 0.28 * N.hash2(idx, side, 81));
      let a = N.smoothstep(0, 0.14, seg) * (1 - N.smoothstep(0.66, 0.82, seg)) * (1 - N.smoothstep(len - 0.07, len, au));
      const stem = 1 - N.smoothstep(0.03, 0.055, au);
      a = Math.max(a, stem * (v < 0.97 ? 1 : 0));
      const g = 0.7 + 0.5 * N.hash2(idx, side + 2, 82), tip = N.smoothstep(0.2, 1, au / (len + 0.01));
      let col = mix3([0.13, 0.25, 0.12], [0.3, 0.42, 0.19], tip).map(c => c * g);
      col = mix3(col, [0.28, 0.2, 0.13], stem);
      const i = (y * W + x) * 4;
      d[i] = clamp01(col[0]) * 255; d[i + 1] = clamp01(col[1]) * 255; d[i + 2] = clamp01(col[2]) * 255; d[i + 3] = clamp01(a) * 255;
    }
    const t = tex(W, H, d, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  };

  // fern frond with alpha (x across, y along stem)
  T.frond = function () {
    const W = 256, H = 512, d = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x / W) * 2 - 1, v = y / H, au = Math.abs(u);
      const env = Math.sin(Math.min(1, v * 1.05) * Math.PI) * 0.95;
      const k = v * 26, idx = Math.floor(k), seg = k - idx;
      // soft-edged leaflets so the alpha-tested outline stays smooth up close
      const pin = env > 0.01 ? N.smoothstep(0, 0.1, seg - (au / env * 0.9 - 0.05)) * (1 - N.smoothstep(0.8, 0.9, seg)) * (1 - N.smoothstep(env - 0.04, env, au)) : 0;
      const stem = 1 - N.smoothstep(0.02, 0.035, au);
      const a = Math.max(pin, stem);
      const g = (0.7 + 0.3 * N.vnoise2(x * 0.15, y * 0.15, 41)) * (0.85 + 0.3 * N.hash2(idx, u < 0 ? 0 : 1, 42)), tip = 1 - 0.3 * au / (env + 0.01);
      const vein = 1 - 0.25 * (1 - N.smoothstep(0, 0.12, Math.abs(seg - 0.45 - au / (env + 0.01) * 0.4))); // midrib of each leaflet
      const i = (y * W + x) * 4, st = stem > 0.5;
      d[i] = (st ? 70 : 48 * g * vein) * tip; d[i + 1] = (st ? 78 : 92 * g * vein) * tip; d[i + 2] = (st ? 40 : 30 * g * vein) * tip; d[i + 3] = clamp01(a) * 255;
    }
    const t = tex(W, H, d, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  };

  T.soft = function () {
    const S = 64, d = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - S / 2, y - S / 2) / (S / 2), n = N.fbm2(x / 10, y / 10, 51, 3);
      const a = clamp01((1 - r) * 1.4) * (0.6 + 0.4 * n), i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a * a * 255;
    }
    const t = tex(S, S, d, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  };
})();
