// Procedural skinned dinosaur geometry: lofted body, limbs, jaw, teeth, eyes, horns, feathers
(function () {
  const DG = window.DG, N = DG.N, V = THREE.Vector3;
  const G = DG.G = {};
  const TAU = Math.PI * 2;
  const WHITE = [1, 1, 1];

  class Builder {
    constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.si = []; this.sw = []; this.groups = {}; }
    vert(p, n, u, v, c, skin) {
      const i = this.pos.length / 3;
      this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v);
      c = c || WHITE; this.col.push(c[0], c[1], c[2]);
      const s = skin.slice(0, 4); while (s.length < 4) s.push([0, 0]);
      let t = 0; s.forEach(e => t += e[1]);
      s.forEach(e => { this.si.push(e[0]); this.sw.push(e[1] / (t || 1)); });
      return i;
    }
    tri(g, a, b, c) { (this.groups[g] || (this.groups[g] = [])).push(a, b, c); }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
      const idx = []; let start = 0;
      Object.keys(this.groups).map(Number).sort((a, b) => a - b).forEach(k => {
        const arr = this.groups[k]; for (let i = 0; i < arr.length; i++) idx.push(arr[i]);
        g.addGroup(start, arr.length, k); start += arr.length;
      });
      g.setIndex(idx); return g;
    }
  }
  G.Builder = Builder;

  function crScalar(a, f) {
    const n = a.length; const i = Math.min(n - 2, Math.max(0, Math.floor(f))); const t = f - i;
    const p0 = i > 0 ? a[i - 1] : 2 * a[0] - a[1], p1 = a[i], p2 = a[i + 1], p3 = i + 2 < n ? a[i + 2] : 2 * a[n - 1] - a[n - 2];
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  // keys: [{z,y,w,h,hb,n,ridge}] -> rings with frames (centerline in y-z plane)
  function profileRings(keys, count) {
    const curve = new THREE.CatmullRomCurve3(keys.map(k => new V(0, k.y, k.z)), false, 'catmullrom', 0.5);
    const col = name => keys.map(k => k[name] != null ? k[name] : (name === 'hb' ? k.h : name === 'n' ? 2.2 : 0));
    const W = col('w'), H = col('h'), HB = col('hb'), NN = col('n'), RD = col('ridge');
    const rings = [];
    for (let k = 0; k < count; k++) {
      const u = k / (count - 1), t = curve.getUtoTmapping(u), f = t * (keys.length - 1);
      const c = curve.getPoint(t), tg = curve.getTangent(t);
      rings.push({ c, t: tg, side: new V(1, 0, 0), up: new V(0, tg.z, -tg.y).normalize(), u,
        w: Math.max(0.004, crScalar(W, f)), h: Math.max(0.004, crScalar(H, f)), hb: Math.max(0.004, crScalar(HB, f)),
        n: crScalar(NN, f), ridge: Math.max(0, crScalar(RD, f)) });
    }
    rings.length_ = curve.getLength();
    return rings;
  }
  G.profileRings = profileRings;

  function ringPoint(r, th) {
    const s = Math.sin(th), c = Math.cos(th), e = 2 / r.n;
    const x = r.w * Math.sign(s) * Math.pow(Math.abs(s), e);
    let y = (c >= 0 ? r.h : r.hb) * Math.sign(c) * Math.pow(Math.abs(c), e);
    const d = Math.min(th, TAU - th); y += r.ridge * Math.exp(-d * d / 0.015);
    return r.c.clone().addScaledVector(r.side, x).addScaledVector(r.up, y);
  }

  function gridNormals(P, rings, M) {
    const R = P.length, Nn = [];
    for (let i = 0; i < R; i++) {
      const row = [];
      for (let j = 0; j < M; j++) {
        const dT = P[i][(j + 1) % M].clone().sub(P[i][(j - 1 + M) % M]);
        const dR = P[Math.min(i + 1, R - 1)][j].clone().sub(P[Math.max(i - 1, 0)][j]);
        const n = new V().crossVectors(dR, dT);
        if (n.lengthSq() < 1e-14) n.copy(P[i][j]).sub(rings[i].c);
        row.push(n.normalize());
      }
      Nn.push(row);
    }
    return Nn;
  }

  // loft rings into builder. o: {group, mouthGroup, vOff, uOf(ring), disp(p,n,ring,th), cap0, cap1}
  function loft(B, rings, M, o) {
    const R = rings.length, P = [], F = [];
    for (let i = 0; i < R; i++) {
      const r = rings[i], row = [], fr = [];
      for (let j = 0; j < M; j++) {
        const p = ringPoint(r, j / M * TAU); let fl = 0;
        if (r.clampBelow != null && p.y < r.clampBelow) { p.y = r.clampBelow; fl = 1; }
        if (r.clampAbove != null && p.y > r.clampAbove) { p.y = r.clampAbove; fl = 1; }
        row.push(p); fr.push(fl);
      }
      P.push(row); F.push(fr);
    }
    let Nn = gridNormals(P, rings, M);
    if (o.disp) {
      for (let i = 0; i < R; i++) for (let j = 0; j < M; j++) if (!F[i][j]) P[i][j].addScaledVector(Nn[i][j], o.disp(P[i][j], Nn[i][j], rings[i], j / M * TAU));
      Nn = gridNormals(P, rings, M);
    }
    const g = o.group || 0, mg = o.mouthGroup != null ? o.mouthGroup : g, vOff = o.vOff || 0;
    const id = [];
    for (let i = 0; i < R; i++) {
      const r = rings[i], u = o.uOf ? o.uOf(r) : r.u, row = [];
      for (let j = 0; j <= M; j++) row.push(B.vert(P[i][j % M], Nn[i][j % M], u, o.vMap ? o.vMap(j / M) : j / M + vOff, null, r.skin));
      id.push(row);
    }
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < M; j++) {
      const a = id[i][j], b = id[i][j + 1], c = id[i + 1][j], d = id[i + 1][j + 1];
      const m = F[i][j] && F[i][(j + 1) % M] && F[i + 1][j] && F[i + 1][(j + 1) % M];
      const gg = m ? mg : g; B.tri(gg, a, c, b); B.tri(gg, b, c, d);
    }
    const cap = (i, end) => {
      const r = rings[i], cen = r.c.clone().addScaledVector(r.t, (end ? 1 : -1) * Math.min(r.w, r.h) * 0.6);
      const s = B.vert(cen, r.t.clone().multiplyScalar(end ? 1 : -1), o.uOf ? o.uOf(r) : r.u, 0.5, null, r.skin);
      for (let j = 0; j < M; j++) end ? B.tri(g, s, id[i][j + 1], id[i][j]) : B.tri(g, s, id[i][j], id[i][j + 1]);
    };
    if (o.cap0) cap(0, false);
    if (o.cap1) cap(R - 1, true);
    return { P, N: Nn, F, rings, M };
  }
  G.loft = loft;

  // free tube along points (for teeth, horns, claws, toes)
  function tube(B, pts, radii, M, group, skin, colFn, uv) {
    const R = pts.length; let prevUp = null; const id = [];
    for (let i = 0; i < R; i++) {
      const t = (i < R - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      if (i > 0 && i < R - 1) t.add(pts[i].clone().sub(pts[i - 1]).normalize()).normalize();
      let up = prevUp ? prevUp.clone() : (Math.abs(t.y) < 0.9 ? new V(0, 1, 0) : new V(0, 0, 1));
      const side = new V().crossVectors(t, up).normalize(); up = new V().crossVectors(side, t).normalize(); prevUp = up;
      const row = [], f = i / (R - 1), c = colFn ? colFn(f) : null, rr = radii[i];
      // slope of the radius along the tube, so tapered parts (cones) get correctly tilted normals
      const rad = k => { const q = radii[Math.max(0, Math.min(R - 1, k))]; return Array.isArray(q) ? (q[0] + q[1]) / 2 : q; };
      const i0 = Math.max(0, i - 1), i1 = Math.min(R - 1, i + 1);
      const slope = (rad(i1) - rad(i0)) / (pts[i1].distanceTo(pts[i0]) || 1);
      for (let j = 0; j <= M; j++) {
        const a = j / M * TAU, rd = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
        const n = rd.clone().addScaledVector(t, -slope).normalize();
        const p = pts[i].clone().addScaledVector(rd, Array.isArray(rr) ? 0 : rr);
        if (Array.isArray(rr)) { p.addScaledVector(side, Math.cos(a) * rr[0]).addScaledVector(up, Math.sin(a) * rr[1]); }
        row.push(B.vert(p, n, uv ? uv[0] + f * uv[2] : f, uv ? uv[1] + j / M * uv[3] : j / M, c, typeof skin === 'function' ? skin(f) : skin));
      }
      id.push(row);
    }
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < M; j++) {
      const a = id[i][j], b = id[i][j + 1], c = id[i + 1][j], d = id[i + 1][j + 1];
      B.tri(group, a, c, b); B.tri(group, b, c, d);
    }
  }
  G.tube = tube;

  const sphereGeo = new THREE.SphereGeometry(1, 28, 18);
  function ellipsoid(B, center, radii, quat, group, skin, uvb) {
    const p = sphereGeo.attributes.position, n = sphereGeo.attributes.normal, uv = sphereGeo.attributes.uv, base = B.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const v = new V(p.getX(i) * radii.x, p.getY(i) * radii.y, p.getZ(i) * radii.z).applyQuaternion(quat).add(center);
      const nn = new V(n.getX(i) / radii.x, n.getY(i) / radii.y, n.getZ(i) / radii.z).normalize().applyQuaternion(quat);
      const u = uvb ? uvb[0] + (uv.getX(i) - 0.5) * uvb[2] : uv.getX(i), vv = uvb ? uvb[1] + (uv.getY(i) - 0.5) * uvb[3] : uv.getY(i);
      B.vert(v, nn, u, vv, null, skin);
    }
    const ix = sphereGeo.index;
    for (let i = 0; i < ix.count; i += 3) B.tri(group, base + ix.getX(i), base + ix.getX(i + 1), base + ix.getX(i + 2));
  }
  G.ellipsoid = ellipsoid;

  function card(B, base, dir, side, len, wid, group, skin) {
    const n = new V().crossVectors(side, dir).normalize();
    const a = B.vert(base.clone().addScaledVector(side, -wid / 2), n, 0, 0, null, skin);
    const b = B.vert(base.clone().addScaledVector(side, wid / 2), n, 1, 0, null, skin);
    const c = B.vert(base.clone().addScaledVector(side, -wid / 2).addScaledVector(dir, len), n, 0, 1, null, skin);
    const d = B.vert(base.clone().addScaledVector(side, wid / 2).addScaledVector(dir, len), n, 1, 1, null, skin);
    B.tri(group, a, b, c); B.tri(group, b, d, c);
  }
  G.card = card;

  // nearest surface point on a loft result: z along body, th angle (0 dorsal, PI/2 = +x side)
  G.surfaceAt = function (L, z, th) {
    let best = 0, bd = 1e9;
    L.rings.forEach((r, i) => { const d = Math.abs(r.c.z - z); if (d < bd) { bd = d; best = i; } });
    const j = ((Math.round(th / TAU * L.M) % L.M) + L.M) % L.M;
    return { p: L.P[best][j].clone(), n: L.N[best][j].clone(), ring: L.rings[best], skin: L.rings[best].skin, i: best, j };
  };
})();
