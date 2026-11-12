// Assemble a full skinned dinosaur from a species spec
(function () {
  const DG = window.DG, N = DG.N, G = DG.G, V = THREE.Vector3;
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;

  G.createDino = function (spec, tex) {
    const B = new G.Builder(), root = new THREE.Group(), bones = [], bi = new Map();
    const mk = (name, p, parent) => {
      const b = new THREE.Bone(); b.name = name; b.userData.rest = p.clone();
      if (parent) { b.position.copy(p).sub(parent.userData.rest); parent.add(b); } else b.position.copy(p);
      bi.set(b, bones.length); bones.push(b); return b;
    };
    const idx = b => bi.get(b);
    const sd = spec.seed || 1;

    // ---------- body ----------
    const rings = G.profileRings(spec.body, spec.rings || 150), L = rings.length_;
    const centerAtZ = z => {
      for (let i = 0; i < rings.length - 1; i++) {
        const a = rings[i], b = rings[i + 1];
        if (z >= a.c.z && z <= b.c.z) { const f = (z - a.c.z) / (b.c.z - a.c.z || 1); return { c: a.c.clone().lerp(b.c, f), u: lerp(a.u, b.u, f) }; }
      }
      return z < rings[0].c.z ? { c: rings[0].c.clone(), u: 0 } : { c: rings[rings.length - 1].c.clone(), u: 1 };
    };
    const pelvis = mk('pelvis', centerAtZ(0).c, null); root.add(pelvis);
    const chain = [{ b: pelvis, u: centerAtZ(0).u }];
    const spine = []; let prev = pelvis;
    spec.spine.forEach((z, k) => { const c = centerAtZ(z); prev = mk('sp' + k, c.c, prev); spine.push(prev); chain.push({ b: prev, u: c.u }); });
    const tail = []; prev = pelvis;
    spec.tail.forEach((z, k) => { const c = centerAtZ(z); prev = mk('tl' + k, c.c, prev); tail.push(prev); chain.push({ b: prev, u: c.u }); });
    chain.sort((a, b) => a.u - b.u);
    const head = spine[spine.length - 1], headU = centerAtZ(spec.spine[spec.spine.length - 1]).u;
    const skinAtU = u => {
      if (u <= chain[0].u) return [[idx(chain[0].b), 1]];
      for (let k = 0; k < chain.length - 1; k++) if (u <= chain[k + 1].u) {
        const f = (u - chain[k].u) / (chain[k + 1].u - chain[k].u);
        return [[idx(chain[k].b), 1 - f], [idx(chain[k + 1].b), f]];
      }
      return [[idx(chain[chain.length - 1].b), 1]];
    };
    rings.forEach(r => r.skin = skinAtU(r.u));

    const m = spec.mouth, mouthY = z => m.y0 + (z - m.z0) * (m.y1 - m.y0) / (m.z1 - m.z0);
    rings.forEach(r => { if (r.c.z > m.z0) r.clampBelow = mouthY(r.c.z); });
    const bump = spec.bump || 0.02, hb = spec.headBump || 0.02, sc = spec.noiseScale || 3;
    const disp = (p, n, r, th) => {
      const ax = Math.abs(p.x);
      let d = (N.fbm3(ax * sc, p.y * sc, p.z * sc, sd, 3) - 0.5) * bump;
      if (r.c.z > m.z0 - 0.3) d += (N.fbm3(ax * sc * 4, p.y * sc * 4, p.z * sc * 4, sd + 5, 3) - 0.5) * hb;
      const c = Math.cos(th);
      if (spec.neckFolds && r.c.z > spec.neckFolds[0] && r.c.z < spec.neckFolds[1] && c < -0.1)
        d -= spec.neckFolds[2] * Math.abs(Math.sin(r.c.z * spec.neckFolds[3] + Math.sin(th * 3) * 0.8)) * -c;
      return d;
    };
    const bodyL = G.loft(B, rings, spec.radial || 44, { group: 0, mouthGroup: 1, disp, cap0: true, cap1: true });

    // ---------- jaw ----------
    const jaw = mk('jaw', new V(0, m.y0, m.z0), head);
    const jr = G.profileRings(spec.jaw.map(k => ({ z: k.z, y: mouthY(k.z) - k.h * (k.lift != null ? k.lift : 0.3), w: k.w, h: k.h, hb: k.hb || k.h, n: k.n || 2.2 })), 46);
    jr.forEach(r => { r.clampAbove = mouthY(r.c.z); r.skin = [[idx(jaw), 1]]; });
    const jawL = G.loft(B, jr, 30, { group: 0, mouthGroup: 1, uOf: r => centerAtZ(r.c.z).u, cap0: true, cap1: true,
      disp: (p) => (N.fbm3(Math.abs(p.x) * sc * 4, p.y * sc * 4, p.z * sc * 4, sd + 9, 3) - 0.5) * hb });

    // tongue: a rounded body lying in the floor of the lower jaw
    {
      const jz0 = spec.jaw[0].z, jz1 = spec.jaw[spec.jaw.length - 1].z, tl = (jz1 - jz0) * 0.42, tz = jz0 + (jz1 - jz0) * 0.45;
      const tw = Math.min(...spec.jaw.slice(0, 3).map(k => k.w)) * 0.55, ty = mouthY(tz) - tw * 0.12;
      const slope = Math.atan2(m.y1 - m.y0, m.z1 - m.z0);
      G.ellipsoid(B, new V(0, ty, tz), new V(tw, tw * 0.3, tl), new THREE.Quaternion().setFromEuler(new THREE.Euler(-slope, 0, 0)), 1, [[idx(jaw), 1]]);
    }
    // ---------- teeth ----------
    const rim = (Lr, upper) => {
      const out = [], M = Lr.M;
      Lr.rings.forEach((r, i) => {
        if (upper && r.clampBelow == null) return;
        let jj = -1;
        if (upper) { for (let j = 0; j <= M / 2; j++) if (Lr.F[i][j]) { jj = j; break; } }
        else { for (let j = 0; j <= M / 2; j++) { if (Lr.F[i][j]) jj = j; else if (jj >= 0) break; } }
        if (jj >= 0) out.push(Lr.P[i][jj].clone());
      });
      return out.sort((a, b) => a.z - b.z);
    };
    const rimAt = (list, z) => {
      for (let i = 0; i < list.length - 1; i++) if (z >= list[i].z && z <= list[i + 1].z) return list[i].clone().lerp(list[i + 1], (z - list[i].z) / (list[i + 1].z - list[i].z || 1));
      return (z < list[0].z ? list[0] : list[list.length - 1]).clone();
    };
    const toothCol = f => [lerp(0.5, 0.86, f), lerp(0.4, 0.8, f), lerp(0.3, 0.66, f)];
    const rnd = N.rng(sd * 7 + 1);
    const addTeeth = (T, list, upper, bone) => {
      if (!T || list.length < 2) return;
      for (let s = -1; s <= 1; s += 2) for (let k = 0; k < T.n; k++) {
        const f = (k + 0.5) / T.n, z = lerp(T.z0, T.z1, f), len = T.len * (T.prof ? T.prof(f) : (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, f * 1.3)))) * (0.85 + rnd() * 0.3);
        const b = rimAt(list, z); b.x *= s * (T.inset || 0.94) * Math.sign(b.x || 1); b.y += (upper ? 1 : -1) * len * 0.3;
        const dy = upper ? -1 : 1, cz = upper ? -0.22 : -0.15;
        const pts = [b, b.clone().add(new V(-b.x * 0.01, dy * len * 0.55, cz * len * 0.3)), b.clone().add(new V(-b.x * 0.03, dy * len, cz * len))];
        G.tube(B, pts, [[T.r * 0.7, T.r], [T.r * 0.5, T.r * 0.75], [0.002, 0.002]], 7, 2, [[idx(bone), 1]], toothCol);
      }
    };
    if (spec.teeth) { addTeeth(spec.teeth.upper, rim(bodyL, true), true, head); addTeeth(spec.teeth.lower, rim(jawL, false), false, jaw); }

    // ---------- eyes & brows ----------
    const e = spec.eye;
    for (let s = -1; s <= 1; s += 2) {
      const sf = G.surfaceAt(bodyL, e.z, s > 0 ? e.th : TAU - e.th);
      const c = sf.p.clone().addScaledVector(sf.n, -e.r * (e.sink || 0.35));
      const gz = new V(e.gaze[0] * s, e.gaze[1], e.gaze[2]).normalize();
      G.ellipsoid(B, c, new V(e.r, e.r, e.r), new THREE.Quaternion().setFromUnitVectors(new V(1, 0, 0), gz), 3, [[idx(head), 1]]);
      // brow ridge and lower lid
      const nrm = sf.n.clone(), fw = new V(0, 0, 1).addScaledVector(nrm, -nrm.z).normalize(), sd2 = new V().crossVectors(nrm, fw);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(sd2, nrm, fw));
      const uvb = [sf.ring.u, (s > 0 ? e.th : TAU - e.th) / TAU, e.r * 6 / L, 0.06];
      const br = e.brow || [1.0, 0.5, 1.9];
      const up = new V(0, 1, 0).addScaledVector(nrm, -nrm.y).normalize();
      G.ellipsoid(B, c.clone().addScaledVector(up, e.r * 0.85).addScaledVector(nrm, e.r * 0.15), new V(e.r * br[0], e.r * br[1], e.r * br[2]), q, 0, [[idx(head), 1]], uvb);
      G.ellipsoid(B, c.clone().addScaledVector(up, -e.r * 0.8).addScaledVector(nrm, e.r * 0.05), new V(e.r * 0.7, e.r * 0.35, e.r * 1.3), q, 0, [[idx(head), 1]], uvb);
      // nostril
      if (spec.nostril) {
        const ns = G.surfaceAt(bodyL, spec.nostril.z, s > 0 ? spec.nostril.th : TAU - spec.nostril.th);
        G.ellipsoid(B, ns.p.addScaledVector(ns.n, -spec.nostril.r * 0.55), new V(spec.nostril.r * 0.5, spec.nostril.r * 0.5, spec.nostril.r), q, 1, [[idx(head), 1]]);
      }
    }

    // ---------- limbs ----------
    const limbs = [];
    const buildLimb = (Ls, side) => {
      const parent = Ls.parent === 'pelvis' ? pelvis : spine[Ls.parent];
      const x = Ls.x * side, J = [new V(x, Ls.y, Ls.z)], dirs = [];
      Ls.segs.forEach(s => { const d = new V(0, -Math.cos(s.ang), Math.sin(s.ang)); dirs.push(d); J.push(J[J.length - 1].clone().addScaledVector(d, s.len)); });
      const nS = Ls.segs.length, lb = []; let pb = parent;
      for (let k = 0; k <= nS; k++) { pb = mk(Ls.name + (side > 0 ? 'L' : 'R') + k, J[k], pb); lb.push(pb); }
      const rad = k => k < nS ? Ls.segs[k] : Ls.end;
      const mkRing = (c, t, w, h, skin, u) => ({ c, t, side: new V(1, 0, 0), up: new V(0, t.z, -t.y).normalize(), w, h, hb: h, n: 2.3, ridge: 0, skin, u });
      const rr = []; let dist = 0;
      const top = J[0].clone().addScaledVector(dirs[0], -rad(0).rw * 0.9);
      rr.push(mkRing(top, dirs[0], rad(0).rw * 0.8, rad(0).rd * 0.8, [[idx(parent), 0.6], [idx(lb[0]), 0.4]], 0));
      for (let k = 0; k < nS; k++) {
        const Q = Ls.segs[k].q || 8;
        for (let q = 0; q < Q; q++) {
          const f = q / Q, c = J[k].clone().lerp(J[k + 1], f);
          const t = (q === 0 && k > 0) ? dirs[k - 1].clone().add(dirs[k]).normalize() : dirs[k];
          const bl = 1 + (Ls.segs[k].bulge || 0) * Math.sin(Math.PI * Math.min(1, f * 1.2));
          const skin = [[idx(lb[k]), 1]];
          if (f < 0.25) skin.push([k > 0 ? idx(lb[k - 1]) : idx(parent), (k > 0 ? 1 : 0.6) * (1 - f / 0.25)]);
          if (f > 0.75) skin.push([idx(lb[k + 1]), (f - 0.75) / 0.25 * 0.8]);
          rr.push(mkRing(c, t, lerp(rad(k).rw, rad(k + 1).rw, f) * bl, lerp(rad(k).rd, rad(k + 1).rd, f) * bl, skin, dist + f * Ls.segs[k].len));
        }
        dist += Ls.segs[k].len;
      }
      rr.push(mkRing(J[nS].clone(), dirs[nS - 1], Ls.end.rw, Ls.end.rd, [[idx(lb[nS - 1]), 0.5], [idx(lb[nS]), 0.5]], dist));
      const uh = centerAtZ(Ls.z).u;
      const fo = side > 0 ? 0.25 : 0.75; // outer side of the limb
      G.loft(B, rr, 26, { group: 0, uOf: r => Math.max(0, uh - r.u / L), cap1: true,
        vMap: f => { const dd = Math.abs(f - fo); return 0.04 + Math.min(dd, 1 - dd) * 0.85; },
        disp: p => (N.fbm3(Math.abs(p.x) * sc * 2, p.y * sc * 2, p.z * sc * 2, sd + 3, 3) - 0.5) * bump * 0.8 });
      // digits
      const foot = lb[nS], fb = J[nS];
      (Ls.toes || []).forEach(t => {
        const S = fb.clone().add(new V((t.x || 0) * side, t.y || 0, t.dz || 0));
        let pts;
        if (t.dir) {
          const d = new V(t.dir[0] * side, t.dir[1], t.dir[2]).normalize();
          pts = [0, 0.35, 0.7, 1].map(f => S.clone().addScaledVector(d, t.len * f).add(new V(0, -(t.curl || 0) * t.len * f * f, 0)));
        } else {
          const dh = new V(Math.sin(t.yaw) * side, 0, Math.cos(t.yaw)), ey = t.raise != null ? S.y + t.raise : t.r * 0.85;
          pts = [0, 0.35, 0.7, 1].map(f => { const p = S.clone().addScaledVector(dh, t.len * f); p.y = lerp(S.y, ey, Math.pow(f, 0.6)); return p; });
        }
        G.tube(B, pts, [t.r * 1.15, t.r, t.r * 0.85, t.r * 0.62], 10, 0, [[idx(foot), 1]], null, [uh, 0.5, t.len / L, 0.15]);
        if (t.claw) {
          const E = pts[3], d = E.clone().sub(pts[2]).normalize(), dn = new V(0, -1, 0);
          const cp = [E.clone().addScaledVector(d, -t.r * 0.4), E.clone().addScaledVector(d, t.claw * 0.45).addScaledVector(dn, t.claw * 0.08),
                      E.clone().addScaledVector(d, t.claw * 0.8).addScaledVector(dn, t.claw * (t.hook || 0.35))];
          G.tube(B, cp, [[t.r * 0.45, t.r * 0.62], [t.r * 0.3, t.r * 0.42], [0.002, 0.002]], 8, 2, [[idx(foot), 1]], f => [lerp(0.16, 0.42, f), lerp(0.13, 0.38, f), lerp(0.11, 0.32, f)]);
        }
      });
      limbs.push({ name: Ls.name, bones: lb, lens: Ls.segs.map(s => s.len), rest: Ls.segs.map(s => s.ang).concat([Math.PI / 2]),
        side, front: !!Ls.front, arm: !!Ls.arm, phase: (Ls.phase || 0) + (side < 0 ? (Ls.phaseR != null ? Ls.phaseR : 0.5) : 0), parentBone: parent, J, dirs });
    };
    (spec.limbs || []).forEach(Ls => { buildLimb(Ls, 1); buildLimb(Ls, -1); });

    // ---------- horns ----------
    (spec.horns || []).forEach(h => {
      const c0 = h.c0 || [0.2, 0.16, 0.12], c1 = h.c1 || [0.5, 0.45, 0.37];
      const hornCol = f => { const k = Math.pow(f, 1.6), g = 0.92 + 0.08 * Math.sin(f * 40); return [lerp(c0[0], c1[0], k) * g, lerp(c0[1], c1[1], k) * g, lerp(c0[2], c1[2], k) * g]; };
      for (let s = h.mirror ? -1 : 1; s <= 1; s += 2) {
        const sf = G.surfaceAt(bodyL, h.z, s > 0 ? h.th : TAU - h.th);
        const base = sf.p.clone().addScaledVector(sf.n, -h.r * 0.3), d = new V(h.dir[0] * s, h.dir[1], h.dir[2]).normalize();
        const bend = new V((h.bend[0] || 0) * s, h.bend[1] || 0, h.bend[2] || 0);
        const pts = [], rad = [];
        for (let i = 0; i <= 8; i++) { const f = i / 8; pts.push(base.clone().addScaledVector(d, h.len * f).addScaledVector(bend, h.len * f * f)); rad.push(h.r * Math.pow(1 - f, 0.85) + 0.003); }
        G.tube(B, pts, rad, 14, h.skinCol ? 0 : 2, sf.skin, h.skinCol ? null : hornCol, [sf.ring.u, 0.3, h.len / L, 0.2]);
      }
    });

    // ---------- frill (fan lofted along an arc) ----------
    if (spec.frill) {
      const f = spec.frill, O = new V(0, f.y, f.z), nf = new V(0, Math.sin(f.tilt), Math.cos(f.tilt)), ey = new V(0, Math.cos(f.tilt), -Math.sin(f.tilt)), ex = new V(1, 0, 0);
      const fr = [], K = 60;
      for (let k = 0; k <= K; k++) {
        const a = -f.arc + 2 * f.arc * k / K;
        const r = ex.clone().multiplyScalar(Math.sin(a)).addScaledVector(ey, Math.cos(a));
        const t = ex.clone().multiplyScalar(Math.cos(a)).addScaledVector(ey, -Math.sin(a));
        const c = O.clone().addScaledVector(r, f.R).addScaledVector(nf, -f.bend * Math.sin(a) * Math.sin(a));
        const scal = 1 + 0.07 * Math.pow(Math.abs(Math.sin(a * f.bumps)), 3);
        const side = t.dot(new V().crossVectors(nf, r)) > 0 ? nf.clone() : nf.clone().negate();
        fr.push({ c, t, side, up: r, w: f.thick * (0.6 + 0.4 * Math.cos(a)), h: f.H * scal, hb: f.H * 0.8, n: 2.0, ridge: 0, skin: [[idx(head), 1]], u: centerAtZ(f.z).u + (k / K - 0.5) * 0.12 });
      }
      G.loft(B, fr, 24, { group: 0, cap0: true, cap1: true, disp: p => (N.fbm3(p.x * 6, p.y * 6, p.z * 6, sd + 21, 3) - 0.5) * 0.03 });
    }

    // ---------- osteoderms / scutes ----------
    (spec.scutes || []).forEach(S => {
      S.rows.forEach(th => {
        for (let s = -1; s <= 1; s += 2) {
          if (th === 0 && s < 0) continue;
          for (let k = 0; k < S.n; k++) {
            const z = lerp(S.z0, S.z1, (k + 0.5) / S.n), sf = G.surfaceAt(bodyL, z, s > 0 ? th : TAU - th);
            const sz = S.size * (0.7 + 0.5 * rnd()) * (S.taper ? (1 - 0.6 * Math.abs((k + 0.5) / S.n - 0.5) * 2) : 1);
            const b = sf.p.clone().addScaledVector(sf.n, -sz * 0.3);
            const h = S.height || 0.8;
            G.tube(B, [b, b.clone().addScaledVector(sf.n, sz * 0.55 * h), b.clone().addScaledVector(sf.n, sz * h)], [sz * 0.95, sz * 0.6, 0.004], 9, 0, sf.skin, null, [sf.ring.u, sf.j / bodyL.M, sz / L, 0.02]);
          }
        }
      });
    });

    // ---------- feathers ----------
    if (spec.feathers) {
      const F = spec.feathers;
      if (F.coat) for (let k = 0; k < F.coat.n; k++) {
        const z = lerp(F.coat.z0, F.coat.z1, rnd()), th = (rnd() * 2 - 1) * F.coat.th;
        const sf = G.surfaceAt(bodyL, z, (th + TAU) % TAU), t = sf.ring.t.clone();
        const sideV = new V().crossVectors(sf.n, t).normalize();
        const lift = F.coat.lift || 0.18, dir = t.clone().negate().multiplyScalar(Math.cos(lift)).addScaledVector(sf.n, Math.sin(lift)).normalize();
        G.card(B, sf.p.clone().addScaledVector(sf.n, -0.005), dir, sideV, F.coat.len * (0.7 + 0.6 * rnd()), F.coat.wid, 4, sf.skin);
      }
      if (F.tail) for (let k = 0; k < F.tail.n; k++) {
        const z = lerp(F.tail.z0, F.tail.z1, k / F.tail.n);
        for (let s = -1; s <= 1; s += 2) {
          const sf = G.surfaceAt(bodyL, z, s > 0 ? Math.PI / 2 : Math.PI * 1.5);
          const dir = new V(s * 0.65, 0.05, -1).normalize();
          G.card(B, sf.p, dir, new V(0, 1, 0).cross(dir).normalize(), F.tail.len * (0.8 + 0.4 * rnd()), F.tail.wid, 4, sf.skin);
        }
      }
      if (F.arm) limbs.filter(l => l.arm).forEach(l => {
        for (let seg = 1; seg < l.J.length - 1; seg++) for (let k = 0; k < F.arm.n; k++) {
          const f = k / F.arm.n, p = l.J[seg].clone().lerp(l.J[seg + 1], f);
          const dir = new V(l.side * 0.25, -0.35, -1).normalize();
          G.card(B, p, dir, l.dirs[seg].clone().negate(), F.arm.len * (0.7 + 0.5 * f + 0.2 * rnd()), F.arm.wid, 4, [[idx(l.bones[seg]), 1]]);
        }
      });
    }

    // ---------- materials ----------
    const skinMat = new THREE.MeshStandardMaterial({ map: tex.color, normalMap: tex.detail, normalScale: new THREE.Vector2(spec.normalScale || 1.3, spec.normalScale || 1.3),
      roughness: spec.rough || 0.7, metalness: 0, envMapIntensity: 0.55 });
    skinMat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float cav = texture2D( normalMap, vNormalMapUv ).a;
        diffuseColor.rgb *= mix(0.38, 1.1, cav);
        roughnessFactor = clamp(roughnessFactor + (1.0 - cav) * 0.22, 0.0, 1.0);`);
    };
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x4a1614, roughness: 0.3, envMapIntensity: 0.4, normalMap: tex.detail, normalScale: new THREE.Vector2(0.5, 0.5) });
    // darken toward the throat so the mouth reads as a cavity rather than a flat plate
    mouthMat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vMz;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMz = position.z;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMz;').replace('#include <color_fragment>',
        `#include <color_fragment>\n diffuseColor.rgb *= mix(0.12, 1.25, smoothstep(${(m.z0).toFixed(3)}, ${(m.z0 + (m.z1 - m.z0) * 0.6).toFixed(3)}, vMz));`);
    };
    const kerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, envMapIntensity: 0.5 });
    const eyeMat = new THREE.MeshPhysicalMaterial({ map: tex.iris, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.05, envMapIntensity: 0.35 });
    const featherMat = new THREE.MeshStandardMaterial({ map: tex.feather || null, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, envMapIntensity: 0.5 });

    const geo = B.build();
    const mesh = new THREE.SkinnedMesh(geo, [skinMat, mouthMat, kerMat, eyeMat, featherMat]);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    root.add(mesh); root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);
    return { root, mesh, skeleton, pelvis, spine, tail, head, jaw, limbs, spec, L, verts: B.pos.length / 3 };
  };
})();
