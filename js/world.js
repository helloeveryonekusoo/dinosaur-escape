// World: renderer setup, sky, lighting, terrain, vegetation
(function () {
  const DG = window.DG, N = DG.N, V = THREE.Vector3;
  const W = DG.W = {};
  W.SIZE = 1000; W.LIMIT = 400;
  W.START = new V(0, 0, 260); W.GOAL = new V(-30, 0, -270);

  // ---- ravines (地割れ): deep cracks crossing the route. Narrow stretches can be cleared with a running
  // jump; wide stretches cannot. A T-rex will not enter one and has to walk round via the shallow ends.
  W.RAVINE_DEPTH = 5; W.RAVINE_MARGIN = 9; // margin = half-width of the detailed mesh strip
  W.RAVINES = (function () {
    const rr = N.rng(991), out = [];
    const r = new V().subVectors(W.GOAL, W.START).normalize(), p = new V(-r.z, 0, r.x);
    [0.24, 0.47, 0.68, 0.87].forEach((f, k) => {
      const c = W.START.clone().lerp(W.GOAL, f).addScaledVector(p, (rr() - 0.5) * 60);
      const ang = Math.atan2(p.x, p.z) + (rr() - 0.5) * 0.7, dir = new V(Math.sin(ang), 0, Math.cos(ang)), side = new V(-dir.z, 0, dir.x);
      const L = 170 + rr() * 80, n = 12, pts = [];
      for (let i = 0; i < n; i++) {
        const s = (i / (n - 1) - 0.5) * L, w = (N.vnoise2(i * 0.6, k * 7.3, 992) - 0.5) * 16;
        pts.push(c.clone().addScaledVector(dir, s).addScaledVector(side, w));
      }
      const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const xs = pts.map(q => q.x), zs = pts.map(q => q.z), m = W.RAVINE_MARGIN + 2;
      out.push({ pts, cum, len: cum[n - 1], seed: 993 + k, box: [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m] });
    });
    return out;
  })();
  // half-width at fraction t along the ravine: alternating narrow (≈3.5 m, jumpable) and wide (≈7.5 m) stretches
  W.ravineHW = (rv, t) => 1.75 + 2.0 * N.smoothstep(0.42, 0.58, N.vnoise2(t * rv.len / 32, rv.seed, 994));
  const RQ = { d: 0, t: 0, hw: 0, depth: 0, tx: 0, tz: 0, rv: null };
  // nearest ravine info at (x,z), or null when not near any
  W.ravineAt = function (x, z) {
    let best = null, bd = 1e9;
    for (const rv of W.RAVINES) {
      if (x < rv.box[0] || x > rv.box[1] || z < rv.box[2] || z > rv.box[3]) continue;
      for (let i = 0; i < rv.pts.length - 1; i++) {
        const a = rv.pts[i], b = rv.pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
        const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
        const dx = x - (a.x + ex * u), dz = z - (a.z + ez * u), d = Math.sqrt(dx * dx + dz * dz);
        if (d < bd) {
          bd = d; const l = Math.sqrt(l2); best = rv; RQ.t = (rv.cum[i] + u * l) / rv.len; RQ.tx = ex / l; RQ.tz = ez / l;
          RQ.ox = d > 1e-4 ? dx / d : -RQ.tz; RQ.oz = d > 1e-4 ? dz / d : RQ.tx; // unit vector pointing away from the crack
        }
      }
    }
    if (!best || bd > W.RAVINE_MARGIN) return null;
    const t = RQ.t, taper = N.smoothstep(0, 0.12, t) * N.smoothstep(1, 0.88, t);
    RQ.rv = best; RQ.d = bd; RQ.hw = W.ravineHW(best, t);
    const dr = bd + (N.vnoise2(x * 0.9, z * 0.9, 995) - 0.5) * 0.5; // rough rock walls
    RQ.depth = W.RAVINE_DEPTH * taper * (1 - N.smoothstep(0.55 * RQ.hw, RQ.hw, dr)) * (0.85 + 0.3 * N.vnoise2(t * 40, 1, 996));
    return RQ;
  };

  W.height = function (x, z) {
    let h = (N.fbm2(x / 260 + 10, z / 260 + 10, 101, 4) - 0.5) * 34 + (N.fbm2(x / 70, z / 70, 102, 3) - 0.5) * 7;
    const e = Math.max(Math.abs(x), Math.abs(z));
    h += N.smoothstep(380, 490, e) * 70 * (0.6 + 0.8 * N.fbm2(x / 50, z / 50, 103, 2));
    // gentle basins at start and goal
    for (const p of [W.START, W.GOAL]) { const d = Math.hypot(x - p.x, z - p.z); h = h * (0.35 + 0.65 * N.smoothstep(10, 60, d)); }
    const q = W.ravineAt(x, z); if (q) h -= q.depth;
    return h;
  };

  // How closed the forest is at a spot: 0 in a clearing, 1 under full canopy. Trees, undergrowth and the colour
  // of the ground all follow this one field, so they agree with each other.
  const canopy = W.canopy = (x, z) => N.smoothstep(0.4, 0.53, N.fbm2(x / 150 + 7, z / 150 + 3, 301, 3));

  // A conifer bough: a card running out along a branch (-z from the origin), folded down its middle like a
  // shallow roof so it still has some height seen edge-on, and curving along its length
  // (droop > 0: the tip sags, droop < 0: the tip turns up).
  function boughGeo(len, wid, droop, roof, segs) {
    const g = new THREE.PlaneGeometry(wid, len, 2, segs); g.translate(0, len / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), t = y / len;
      p.setXYZ(i, x, y * Math.cos(t * droop), -y * Math.sin(t * droop) * 0.9 - Math.abs(x) * roof * (0.4 + 0.6 * t));
    }
    g.rotateX(-Math.PI / 2);
    return g;
  }

  function merge(list) { // list of {geo, group}
    const pos = [], nor = [], uv = [], idx = [], groups = {};
    list.forEach(({ geo, group }) => {
      const g = geo.index ? geo : geo; const base = pos.length / 3;
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
      const arr = groups[group] || (groups[group] = []);
      if (g.index) for (let i = 0; i < g.index.count; i++) arr.push(base + g.index.getX(i)); else for (let i = 0; i < p.count; i++) arr.push(base + i);
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    let s = 0; Object.keys(groups).sort().forEach(k => { groups[k].forEach(i => idx.push(i)); out.addGroup(s, groups[k].length, +k); s += groups[k].length; });
    out.setIndex(idx); return out;
  }

  // an arching frond card strip (curved plane) from origin along dir
  function frondGeo(len, wid, droop, segs) {
    const g = new THREE.PlaneGeometry(wid, len, 1, segs); g.translate(0, len / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), t = y / len; p.setXYZ(i, p.getX(i) * (1 - 0.1 * t), y * Math.cos(t * droop), -y * Math.sin(t * droop) * 0.9 - Math.abs(p.getX(i)) * 0.25); }
    g.rotateX(-Math.PI / 2); g.computeVertexNormals();
    // bias normals upward for softer foliage lighting
    const n = g.attributes.normal; for (let i = 0; i < n.count; i++) { const v = new V(n.getX(i), Math.abs(n.getY(i)) + 0.8, n.getZ(i)).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
    return g;
  }
  function crown(count, len, wid, droop, tilt, rnd, y, segs) {
    const parts = [];
    for (let i = 0; i < count; i++) {
      const g = frondGeo(len * (0.75 + 0.5 * rnd()), wid, droop * (0.8 + 0.4 * rnd()), segs || 6);
      g.rotateX(-(tilt + rnd() * 0.3)); g.rotateY(i / count * Math.PI * 2 + rnd() * 0.4); g.translate(0, y, 0);
      parts.push({ geo: g, group: 1 });
    }
    return parts;
  }

  // A trunk: tapering, slightly irregular, with buttress roots flaring out at the base, and sunk a little into
  // the ground so it never floats on a slope. bend(y) -> [dx, dz] lets the trunk lean; crowns use the same function.
  function trunkGeo(h, r0, r1, flare, bend, seed, radial, hs) {
    radial = radial || 12; hs = hs || 8; const sink = 0.6;
    const g = new THREE.CylinderGeometry(1, 1, 1, radial, hs, true), p = g.attributes.position, uv = g.attributes.uv;
    const su = Math.max(1, Math.round(Math.PI * (r0 + r1) / 1.2));
    for (let i = 0; i < p.count; i++) {
      const t = Math.pow(p.getY(i) + 0.5, 1.7), y = -sink + (h + sink) * t, yy = Math.max(0, y), a = Math.atan2(p.getZ(i), p.getX(i));
      const fl = flare * Math.exp(-yy / (0.9 + r0)) * (0.65 + 0.35 * Math.sin(a * 5 + seed) + 0.2 * Math.sin(a * 3 - seed * 2));
      const r = (r0 + (r1 - r0) * yy / h) * (1 + fl) * (1 + 0.04 * Math.sin(a * 2 + y * 0.9 + seed));
      const b = bend ? bend(yy) : [0, 0];
      p.setXYZ(i, Math.cos(a) * r + b[0], y, Math.sin(a) * r + b[1]);
      uv.setXY(i, uv.getX(i) * su, y / 1.5);
    }
    g.computeVertexNormals(); seamFix(g, radial);
    return g;
  }
  // the first and last vertex of each ring of a cylinder coincide: give them the same normal so no seam shows
  function seamFix(g, radial) {
    const n = g.attributes.normal, rows = n.count / (radial + 1);
    for (let j = 0; j < rows; j++) {
      const a = j * (radial + 1), b = a + radial, v = new V(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
    }
  }
  // A boulder: a noisy blob cut by a few random planes, which gives the flat broken faces of real rock.
  // Normals come from the shape function itself, so shading is smooth on the faces and crisp along the breaks.
  function rockGeo(detail, seed, cuts) {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, nr = g.attributes.normal, rr = N.rng(seed);
    const planes = []; for (let i = 0; i < cuts; i++) planes.push([new V(rr() * 2 - 1, (rr() * 2 - 1) * 0.7, rr() * 2 - 1).normalize(), 0.5 + rr() * 0.3]);
    const P = (d, out) => {
      let r = 0.75 + 0.9 * (N.fbm3(d.x * 1.4 + seed, d.y * 1.4, d.z * 1.4, 205, 4) - 0.5) + 0.14 * (N.fbm3(d.x * 5, d.y * 5 + seed, d.z * 5, 206, 2) - 0.5);
      for (const [n, c] of planes) { const dn = d.dot(n); if (dn > 0.05) r = Math.min(r, c / dn); }
      return out.set(d.x * r, d.y * r * 0.62, d.z * r);
    };
    const d = new V(), t1 = new V(), t2 = new V(), p0 = new V(), pa = new V(), pb = new V(), e = 0.03;
    for (let i = 0; i < p.count; i++) {
      d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      t1.crossVectors(d, Math.abs(d.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0)).normalize(); t2.crossVectors(d, t1);
      P(d, p0); P(pa.copy(d).addScaledVector(t1, e).normalize(), pa); P(pb.copy(d).addScaledVector(t2, e).normalize(), pb);
      const n = pa.sub(p0).cross(pb.sub(p0)).normalize(); if (n.dot(d) < 0) n.negate();
      p.setXYZ(i, p0.x, p0.y, p0.z); nr.setXYZ(i, n.x, n.y, n.z);
    }
    return g;
  }

  W.create = function (renderer) {
    const scene = new THREE.Scene();
    const T = DG.T, rnd = N.rng(77);
    // ---- sky & lights ----
    const sky = new THREE_Sky(); sky.scale.setScalar(4500);
    const su = sky.material.uniforms; su.turbidity.value = 9; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.82;
    const sunDir = new V().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 24), THREE.MathUtils.degToRad(-35));
    su.sunPosition.value.copy(sunDir);
    const envScene = new THREE.Scene(); const sky2 = new THREE_Sky(); sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
    ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'].forEach(k => sky2.material.uniforms[k].value = su[k].value);
    envScene.add(sky2);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.add(sky);
    // pale, slightly blue haze: distance washes things out toward the colour of the sky (aerial perspective)
    scene.fog = new THREE.FogExp2(0xb1bfc0, 0.0075);
    const sun = new THREE.DirectionalLight(0xffe4bc, 2.9);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera; sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 250;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xc4d6ea, 0x545038, 0.5)); // sky fill, so shade under the trees stays readable

    // ---- terrain ----
    const S = W.SIZE, R = 320;
    const tg = new THREE.PlaneGeometry(S, S, R, R); tg.rotateX(-Math.PI / 2);
    const tp = tg.attributes.position, cols = [];
    // colour: mossy/dirt variation, rock on steep slopes, darker deep inside ravines
    // (the rock on steep faces comes from the ground shader below, by slope)
    const groundCol = (x, z, h, out) => {
      const m = N.fbm2(x / 40, z / 40, 104, 3), c = canopy(x, z);
      const q = W.ravineAt(x, z), deep = q ? q.depth / W.RAVINE_DEPTH : 0;
      // under closed canopy the floor is dim, brown needle litter; clearings are lighter and greener
      const k = (0.82 + 0.26 * m) * (1 - 0.45 * deep) * (1.06 - 0.3 * c);
      out.push(k * (0.94 + 0.1 * c), k * (1.06 - 0.08 * c), k * (0.84 + 0.06 * c));
    };
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), z = tp.getZ(i), h = W.height(x, z);
      // inside a ravine strip the coarse terrain is sunk out of sight; the detailed strip mesh below covers it
      const q = W.ravineAt(x, z), hide = q && q.d < W.RAVINE_MARGIN - 2.2 && q.t > 0.02 && q.t < 0.98;
      tp.setY(i, hide ? h - 6 : h);
      groundCol(x, z, h, cols);
    }
    tg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); tg.computeVertexNormals();
    const gt = T.ground(); gt.map.repeat.set(S / 5, S / 5); gt.normal.repeat.set(S / 5, S / 5);
    const groundMat = new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normal, vertexColors: true, roughness: 0.95 });
    // Ground shader: the soil texture is sampled in world space at two orientations and modulated at a large
    // scale so its tiling doesn't show; faces steeper than ~40° (ravine walls, cliffs) show bedded rock instead,
    // projected from the side so it isn't stretched down the wall.
    const cliffTex = T.cliff();
    const groundPatch = sh => {
      sh.uniforms.uCliff = { value: cliffTex };
      sh.vertexShader = 'varying vec3 vWP;\nvarying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = mat3(modelMatrix) * objectNormal;');
      sh.fragmentShader = 'varying vec3 vWP;\nvarying vec3 vWN;\nuniform sampler2D uCliff;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        vec2 gUv = vWP.xz * 0.21;
        vec3 gA = texture2D(map, gUv).rgb;
        vec3 gB = texture2D(map, vec2(gUv.y, -gUv.x) * 0.83 + 0.31).rgb;
        float gM = (texture2D(normalMap, gUv * 0.047).a - 0.5) * 2.0;
        float gM2 = (texture2D(normalMap, gUv * 0.19 + 0.5).a - 0.5) * 2.0;
        vec3 gCol = mix(gA, gB, smoothstep(0.35, 0.65, gM2)) * (0.8 + 0.4 * gM);
        vec3 aN = abs(normalize(vWN));
        vec3 cX = texture2D(uCliff, vWP.zy * 0.27).rgb, cZ = texture2D(uCliff, vWP.xy * 0.27).rgb;
        vec3 cCol = (cX * aN.x + cZ * aN.z) / max(aN.x + aN.z, 0.001);
        float rk = 1.0 - smoothstep(0.6, 0.8, aN.y);
        vec4 sampledDiffuseColor = vec4(mix(gCol, cCol, rk), 1.0);
        diffuseColor *= sampledDiffuseColor;`);
    };
    groundMat.onBeforeCompile = groundPatch;
    const terrain = new THREE.Mesh(tg, groundMat);
    terrain.receiveShadow = true; scene.add(terrain);

    // ---- ravine strips: fine grid (1 m along, 0.3 m across) following each ravine ----
    const stripMat = groundMat.clone(); stripMat.onBeforeCompile = groundPatch; stripMat.polygonOffset = true; stripMat.polygonOffsetFactor = -2; stripMat.polygonOffsetUnits = -2;
    W.RAVINES.forEach(rv => {
      const pos = [], col = [], uv = [], idx = [], M = W.RAVINE_MARGIN, across = Math.round(2 * M / 0.3), steps = Math.ceil(rv.len);
      let seg = 0;
      for (let s = 0; s <= steps; s++) {
        const dist = Math.min(rv.len, s);
        while (seg < rv.pts.length - 2 && rv.cum[seg + 1] < dist) seg++;
        const a = rv.pts[seg], b = rv.pts[seg + 1], u = (dist - rv.cum[seg]) / (rv.cum[seg + 1] - rv.cum[seg]);
        const cx = a.x + (b.x - a.x) * u, cz = a.z + (b.z - a.z) * u;
        const tl = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / tl, nz = (b.x - a.x) / tl;
        for (let j = 0; j <= across; j++) {
          const off = -M + (2 * M) * j / across, x = cx + nx * off, z = cz + nz * off, h = W.height(x, z);
          pos.push(x, h, z); uv.push((x + S / 2) / S, (-z + S / 2) / S); groundCol(x, z, h, col);
        }
      }
      const rowN = across + 1;
      for (let s = 0; s < steps; s++) for (let j = 0; j < across; j++) {
        const i0 = s * rowN + j, i1 = i0 + 1, i2 = i0 + rowN, i3 = i2 + 1;
        idx.push(i0, i2, i1, i1, i2, i3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      // make sure normals point up (winding depends on the strip direction)
      const nrm = g.attributes.normal; let up = 0; for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
      if (up < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
      const mesh = new THREE.Mesh(g, stripMat); mesh.receiveShadow = true; scene.add(mesh);
    });

    // ---- materials ----
    const frondTex = T.frond(), boughTex = T.bough(), bark = T.bark(), rockTex = T.rock();
    const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normal, roughness: 0.95 });
    // moss growing on whatever faces the sky (boulders, fallen logs, stumps)
    const mossy = (m, amt) => {
      const u = { value: amt };
      m.onBeforeCompile = sh => {
        sh.uniforms.uMoss = u;
        sh.fragmentShader = 'uniform float uMoss;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          { vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
            float lum = dot(diffuseColor.rgb, vec3(0.333));
            float mo = smoothstep(0.3, 0.8, dot(normalize(vNormal), upV)) * uMoss * (0.5 + 0.5 * smoothstep(0.03, 0.14, lum));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.14, 0.04) * (0.6 + 4.0 * lum), mo); }`);
      };
      return m;
    };
    const deadMat = mossy(new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normal, roughness: 0.95, color: 0xa39d90, side: THREE.DoubleSide }), 0.8);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6f5639, roughness: 0.9 });
    const rockMat = mossy(new THREE.MeshStandardMaterial({ map: rockTex.map, normalMap: rockTex.normal, roughness: 0.9 }), 0.55);
    rockMat.normalScale.set(1.4, 1.4); rockTex.map.repeat.set(2, 2); rockTex.normal.repeat.set(2, 2);
    const wind = { value: 0 };
    const leafMat = (tint, tex) => {
      const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: tint });
      m.onBeforeCompile = sh => {
        sh.uniforms.uWind = wind;
        sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
          #else
          vec2 ip = vec2(0.0);
          #endif
          float sway = sin(uWind * 1.3 + ip.x * 0.11 + ip.y * 0.07) * 0.5 + sin(uWind * 2.7 + position.x * 2.0) * 0.2;
          transformed.x += sway * clamp(position.y, 0.0, 18.0) * 0.025;
          transformed.z += sway * clamp(position.y, 0.0, 18.0) * 0.018;`);
        // foliage is lit by the shape of the whole crown (see crownNormals), the same from either side of a card
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
      };
      m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.45 });
      return m;
    };
    const fernMat = leafMat(0xc8d8a0, frondTex), lowMat = leafMat(0xb6c48c, frondTex), treeLeaf = leafMat(0xf0f4e4, boughTex), cycadLeaf = leafMat(0x8fa868, frondTex);

    // ---- placement ----
    // Everything scattered over the map is instanced in chunks: the map is cut into GRID x GRID cells and each
    // cell gets its own InstancedMesh per kind of object. Chunks outside the view or past the fog are not drawn
    // (see update), which is what makes a forest this dense affordable.
    const colliders = W.colliders = [];
    const HALF = W.LIMIT + 60, GRID = 10, CELL = HALF * 2 / GRID, chunks = [];
    const batch = (geo, mats, o) => {
      const cells = {};
      return {
        add(m, r, g, b) {
          const e = m.elements, ix = Math.max(0, Math.min(GRID - 1, Math.floor((e[12] + HALF) / CELL))), iz = Math.max(0, Math.min(GRID - 1, Math.floor((e[14] + HALF) / CELL)));
          const c = cells[ix * GRID + iz] || (cells[ix * GRID + iz] = { m: [], c: [] });
          for (let i = 0; i < 16; i++) c.m.push(e[i]); c.c.push(r, g, b);
        },
        build() {
          for (const k in cells) {
            const c = cells[k], im = new THREE.InstancedMesh(geo, mats, c.c.length / 3);
            im.instanceMatrix.array.set(c.m); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(c.c), 3);
            im.castShadow = !!o.shadow; im.receiveShadow = true; im.matrixAutoUpdate = false; im.computeBoundingSphere(); im.boundingSphere.radius += 1.5;
            scene.add(im); chunks.push({ im, x: im.boundingSphere.center.x, z: im.boundingSphere.center.z, r: im.boundingSphere.radius, far: o.far });
          }
        }
      };
    };
    const okAt = (x, z, clear) => {
      if (Math.abs(x) > W.LIMIT + 40 || Math.abs(z) > W.LIMIT + 40) return false;
      for (const p of [W.START, W.GOAL]) if (Math.hypot(x - p.x, z - p.z) < clear) return false;
      // the glade at the start, where the title screen shows the dinosaur off: nothing taller than ferns grows there
      if (clear >= 10 && Math.hypot(x - W.START.x, z - (W.START.z - 12)) < 34) return false;
      const q = W.ravineAt(x, z); if (q && q.d < q.hw + 3) return false; // keep ravines and their rims clear
      return true;
    };
    const slopeAt = (x, z) => Math.hypot(W.height(x + 1, z) - W.height(x - 1, z), W.height(x, z + 1) - W.height(x, z - 1)) / 2;
    const dummy = new THREE.Object3D();
    // small plants; trees tuck a few around their base, which hides where the trunk meets the ground
    const lowB = batch(merge(crown(6, 1.0, 0.5, 1.0, -0.9, rnd, 0.02, 3).map(p => ({ geo: p.geo, group: 0 }))), lowMat, { far: 115 });
    const putLow = (x, z) => {
      if (!okAt(x, z, 5)) return;
      const s = 0.4 + rnd() * 0.6, b = 0.7 + 0.4 * rnd();
      dummy.position.set(x, W.height(x, z), z); dummy.rotation.set(0, rnd() * 6.283, 0); dummy.scale.set(s, s * (0.8 + 0.5 * rnd()), s); dummy.updateMatrix();
      lowB.add(dummy.matrix, b * (0.9 + 0.2 * rnd()), b, b * (0.8 + 0.2 * rnd()));
    };
    // o: clear, smin/smax (size), sy [min,max] (extra height stretch), tilt (lean), sink, collide, skirt (plants at the base)
    const put = (B, x, z, o, sMul) => {
      const s = (o.smin + rnd() * (o.smax - o.smin)) * (sMul || 1), sy = o.sy ? o.sy[0] + rnd() * (o.sy[1] - o.sy[0]) : 1, tl = o.tilt || 0;
      dummy.position.set(x, W.height(x, z) - (o.sink || 0) * s, z); dummy.rotation.set((rnd() - 0.5) * tl, rnd() * 6.283, (rnd() - 0.5) * tl);
      dummy.scale.set(s, s * sy, s); dummy.updateMatrix();
      // every plant a slightly different shade, so a stand of trees doesn't read as copies of one
      const b = 0.72 + 0.36 * rnd(); B.add(dummy.matrix, b * (0.94 + 0.12 * rnd()), b, b * (0.9 + 0.14 * rnd()));
      if (o.collide) colliders.push({ x, z, r: o.collide * s });
      for (let j = 0; j < (o.skirt || 0); j++) { const a = rnd() * 6.283, d = (o.collide || 0.2) * s + 0.25 + rnd() * 0.8; putLow(x + Math.cos(a) * d, z + Math.sin(a) * d); }
    };
    // Scatter n objects. o.dens(x, z) -> 0..1 is the chance a spot is accepted, so plants gather where it is high
    // and leave gaps where it is low. o.clump = {n, r0, r, B, o, s}: up to n companions within r0..r0+r of each one
    // (saplings round a parent tree, stones round a boulder), which is how things actually grow and fall.
    const place = (B, n, o) => {
      let c = 0;
      for (let tries = 0; c < n && tries < n * 14; tries++) {
        const x = (rnd() * 2 - 1) * HALF, z = (rnd() * 2 - 1) * HALF;
        if (!okAt(x, z, o.clear)) continue;
        if (o.dens && rnd() > o.dens(x, z)) continue;
        if (o.maxSlope && slopeAt(x, z) > o.maxSlope) continue;
        put(B, x, z, o); c++;
        const cl = o.clump;
        if (cl) for (let k = Math.floor(rnd() * (cl.n + 1)); k > 0; k--) {
          const a = rnd() * 6.283, d = cl.r0 + rnd() * cl.r, x2 = x + Math.cos(a) * d, z2 = z + Math.sin(a) * d, o2 = cl.o || o;
          if (!okAt(x2, z2, o2.clear) || (o2.maxSlope && slopeAt(x2, z2) > o2.maxSlope)) continue;
          put(cl.B || B, x2, z2, o2, cl.s); if (!cl.B) c++;
        }
      }
    };

    // ---- where things grow ----
    const ss = N.smoothstep;
    const stand = (x, z) => N.fbm2(x / 90, z / 90, 201, 3);                    // which conifer dominates a stand
    const edge = (x, z) => { const c = canopy(x, z); return 4 * c * (1 - c); };  // 1 along the margins of clearings

    // ---- trees ----
    // Foliage cards take their normals from the crown as a whole (pointing out from its axis / centre and a bit
    // upward) rather than from each flat card, so a tree has a lit side and a shaded side like a solid volume.
    const tv = new V();
    const crownNormals = (g, ax, az, cy, ny) => {
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        tv.set(p.getX(i) - ax, cy == null ? 0 : (p.getY(i) - cy) * ny, p.getZ(i) - az);
        if (tv.lengthSq() < 1e-6) tv.set(0, 1, 0);
        tv.normalize(); tv.y += 0.55; tv.normalize(); n.setXYZ(i, tv.x, tv.y, tv.z);
      }
    };
    // o: h, r0, r1, flare, lean, radial, hs, cy/ny (crown centre for the normals; null = straight out from the trunk),
    //    branches [{y, len, wid, tilt (+ down), droop (+ tips sag, - tips rise), yaw, roof}], stubs [{y, len, r, up, yaw}]
    const tree = o => {
      const seed = rnd() * 10, parts = [];
      const bend = y => { const t = y / o.h; return [Math.sin(t * 2.1 + seed) * o.lean * t, Math.cos(t * 1.7 + seed * 2) * o.lean * 0.8 * t]; };
      parts.push({ geo: trunkGeo(o.h, o.r0, o.r1, o.flare, bend, seed, o.radial || 10, o.hs || 6), group: 0 });
      o.branches.forEach(b => {
        const g = boughGeo(b.len, b.wid, b.droop, b.roof == null ? 0.32 : b.roof, 4), q = bend(b.y);
        g.rotateX(-b.tilt); g.rotateY(b.yaw); g.translate(q[0], b.y, q[1]);
        crownNormals(g, q[0], q[1], o.cy, o.ny || 1);
        parts.push({ geo: g, group: 1 });
      });
      (o.stubs || []).forEach(s => { // bare dead branches left on the trunk below the crown
        const g = new THREE.CylinderGeometry(0.012, s.r, s.len, 5, 1, true), q = bend(s.y);
        g.translate(0, s.len / 2, 0); g.rotateZ(-(Math.PI / 2 - s.up)); g.rotateY(s.yaw); g.translate(q[0], s.y, q[1]);
        parts.push({ geo: g, group: 0 });
      });
      return merge(parts);
    };
    const stubs = (n, y0, y1, len, r) => { const out = []; for (let i = 0; i < n; i++) out.push({ y: y0 + (y1 - y0) * rnd(), len: len * (0.5 + rnd()), r, up: 0.1 + rnd() * 0.5, yaw: rnd() * 6.283 }); return out; };
    // Araucaria: a tall bare trunk carrying an umbrella of long, level branches in whorls, their tips turned up.
    // (Old trees shed their lower branches; only stubs remain below the crown.)
    const araucaria = h => {
      const br = [];
      [[0.4, 3.0, -0.8], [1.5, 4.8, -0.4], [2.7, 5.8, -0.16], [3.9, 6.2, 0.02], [5.2, 5.2, 0.14]].forEach(([dy, len, tilt], k) => {
        const n = k === 0 ? 5 : 6, off = rnd() * 6.283;
        for (let i = 0; i < n; i++) br.push({ y: h - dy + (rnd() - 0.5) * 0.4, len: len * (0.82 + 0.36 * rnd()), wid: 2.3, tilt: tilt + (rnd() - 0.5) * 0.16, droop: -0.45, yaw: off + i / n * 6.283 + (rnd() - 0.5) * 0.35 });
      });
      for (let i = 0; i < 4; i++) br.push({ y: h, len: 1.9, wid: 1.5, tilt: -1.15, droop: -0.2, yaw: i / 4 * 6.283 + rnd() });
      return tree({ h, r0: 0.52, r1: 0.2, flare: 0.45, lean: 0.6, cy: h - 7, ny: 1, branches: br, stubs: stubs(5, h * 0.45, h - 6.5, 1.6, 0.05) });
    };
    // A cone-shaped conifer: branches spiral up the trunk (no tiers), long and sagging low down, short and
    // rising toward the tip.
    const conical = (h, y0, n, len0, len1, r0, widMax, ex) => {
      const br = [];
      for (let i = 0; i < n; i++) {
        const f = (i + rnd() * 0.6) / n, len = (len0 + (len1 - len0) * Math.pow(f, 0.8)) * (0.78 + 0.44 * rnd());
        br.push({ y: y0 + (h - 0.4 - y0) * Math.pow(f, 0.85), len, wid: Math.min(widMax, 0.45 * len + 0.7), tilt: 0.3 - 0.8 * f + (rnd() - 0.5) * 0.2, droop: 0.5 - 0.65 * f, yaw: i * 2.39996 + rnd() * 0.5, roof: 0.36 });
      }
      for (let i = 0; i < 3; i++) br.push({ y: h - 0.2, len: len1 * 1.3, wid: len1 + 0.3, tilt: -1.2, droop: -0.1, yaw: i / 3 * 6.283 + rnd() });
      return tree(Object.assign({ h, r0, r1: r0 * 0.22, flare: 0.45, lean: 0.5, cy: null, branches: br, stubs: stubs(Math.round(y0 / 2.5), y0 * 0.4, y0, 1.2, 0.04) }, ex || {}));
    };
    const treeMats = [barkMat, treeLeaf];
    const big = { clear: 26, smin: 0.72, smax: 1.2, sy: [0.88, 1.18], tilt: 0.07, collide: 0.6, maxSlope: 0.55, skirt: 3 };
    const sapling = { clear: 20, smin: 0.5, smax: 1.25, sy: [0.85, 1.25], tilt: 0.1, collide: 0.3, maxSlope: 0.6, skirt: 2 };
    const youngB = batch(conical(9, 1.3, 18, 2.7, 0.5, 0.2, 1.7), treeMats, { shadow: true, far: 250 });
    const araDens = (x, z) => canopy(x, z) * (0.3 + 0.7 * ss(0.38, 0.6, stand(x, z)));
    const conDens = (x, z) => canopy(x, z) * (0.3 + 0.7 * ss(0.4, 0.62, 1 - stand(x, z)));
    [araucaria(24), araucaria(20)].forEach(g => { const B = batch(g, treeMats, { shadow: true, far: 250 }); place(B, 1250, Object.assign({ dens: araDens, clump: { n: 1, r0: 2.5, r: 5, B: youngB, o: sapling, s: 0.8 } }, big)); B.build(); });
    [conical(26, 9, 34, 4.4, 0.9, 0.55, 2.2), conical(21, 6.5, 30, 3.8, 0.8, 0.45, 2.1)].forEach(g => { const B = batch(g, treeMats, { shadow: true, far: 250 }); place(B, 1450, Object.assign({ dens: conDens, clump: { n: 2, r0: 2, r: 5, B: youngB, o: sapling } }, big)); B.build(); });
    place(youngB, 900, Object.assign({ dens: (x, z) => 0.15 + 0.85 * edge(x, z) }, sapling)); // young growth crowding the margins of clearings
    youngB.build();
    // giants: a few enormous old trees with buttressed trunks, standing well above the canopy
    const giantB = batch(conical(42, 19, 40, 7.5, 1.6, 1.4, 3.0, { radial: 16, hs: 10, flare: 0.55 }), treeMats, { shadow: true, far: 270 });
    place(giantB, 170, { clear: 42, dens: canopy, smin: 0.8, smax: 1.25, sy: [0.9, 1.1], tilt: 0.04, collide: 1.6, maxSlope: 0.45, skirt: 6 }); giantB.build();
    // poles: thin young trunks in tight groups, with only a tuft of foliage at the top. A real forest shows far
    // more stems than crowns; these (and the dead trunks below) supply them cheaply. Too thin to block anyone.
    {
      const br = []; for (let i = 0; i < 12; i++) br.push({ y: 3.4 + i * 0.32 + rnd() * 0.15, len: 1.7 - i * 0.1, wid: 1.15, tilt: 0.25 - i * 0.07, droop: 0.35, yaw: i * 2.39996 + rnd() * 0.4 });
      const B = batch(tree({ h: 7.2, r0: 0.085, r1: 0.03, flare: 0.25, lean: 0.35, radial: 5, hs: 3, cy: null, branches: br }), treeMats, { shadow: true, far: 170 });
      const pole = { clear: 16, smin: 0.6, smax: 1.15, sy: [0.8, 1.2], tilt: 0.16, maxSlope: 0.6 };
      place(B, 4200, Object.assign({ dens: (x, z) => canopy(x, z) * ss(0.42, 0.6, N.fbm2(x / 30, z / 30, 213, 2)), clump: { n: 4, r0: 0.5, r: 2.2 } }, pole)); B.build();
    }

    // tree fern: fibrous trunk, thicker at the base
    const fParts = [{ geo: trunkGeo(3.2, 0.22, 0.13, 0.25, y => [Math.sin(y * 0.7) * 0.12, 0], 3, 8, 4), group: 0 }];
    crown(14, 2.6, 0.9, 1.6, -0.45, rnd, 3.1).forEach(p => { p.geo.translate(Math.sin(3.1 * 0.7) * 0.12, 0, 0); fParts.push(p); });
    const tfB = batch(merge(fParts), [barkMat, fernMat], { shadow: true, far: 170 });
    place(tfB, 2800, { clear: 14, dens: (x, z) => ss(0.34, 0.55, N.fbm2(x / 60, z / 60, 202, 3)) * (0.35 + 0.65 * canopy(x, z)), smin: 0.7, smax: 1.5, sy: [0.8, 1.3], tilt: 0.12, collide: 0.25, maxSlope: 0.7, skirt: 2, clump: { n: 2, r0: 1.2, r: 3 } }); tfB.build();

    // cycads: a squat barrel trunk with a rosette of stiff fronds; they like the light of clearings and margins
    const cParts = [{ geo: trunkGeo(0.9, 0.3, 0.26, 0.15, null, 5, 10, 3), group: 0 }];
    crown(16, 1.7, 0.42, 0.9, -0.55, rnd, 0.85, 5).forEach(p => cParts.push(p));
    crown(8, 1.1, 0.34, 0.5, -1.15, rnd, 0.9, 4).forEach(p => cParts.push(p));
    const cyB = batch(merge(cParts), [barkMat, cycadLeaf], { far: 130 });
    place(cyB, 1300, { clear: 10, dens: (x, z) => (1 - 0.75 * canopy(x, z)) * ss(0.4, 0.6, N.fbm2(x / 45, z / 45, 207, 3)), smin: 0.7, smax: 1.5, collide: 0.3, maxSlope: 0.7, skirt: 1, clump: { n: 2, r0: 1, r: 3 } }); cyB.build();

    // dead wood: a good share of the stems in any forest are dead. Broken stumps, splintered snags, and tall
    // bare trunks that still carry a few branches; some of them leaning.
    const snagGeo = (h, r0, r1, seed, nStub) => {
      const bend = y => [Math.sin(y / h * 1.5 + seed) * 0.15 * y / h, 0];
      const g = trunkGeo(h, r0, r1, 0.5, bend, seed, 12, 6), p = g.attributes.position, rr = N.rng(seed * 13 + 1);
      const jag = []; for (let i = 0; i < 12; i++) jag.push((rr() - 0.25) * (0.5 + r1 * 2)); jag.push(jag[0]);
      for (let i = 0; i < 13; i++) p.setY(i, p.getY(i) + jag[i]); // a cylinder's first ring of vertices is its top
      g.computeVertexNormals(); seamFix(g, 12);
      const cap = new THREE.CircleGeometry(r1 * 0.98, 12); cap.rotateX(-Math.PI / 2); cap.translate(Math.sin(1.5 + seed) * 0.15, h - 0.25, 0);
      const parts = [{ geo: g, group: 0 }, { geo: cap, group: 1 }];
      stubs(nStub || 0, h * 0.35, h * 0.95, 2.2, 0.06).forEach(s => {
        const b = new THREE.CylinderGeometry(0.012, s.r, s.len, 5, 1, true), q = bend(s.y);
        b.translate(0, s.len / 2, 0); b.rotateZ(-(Math.PI / 2 - s.up)); b.rotateY(s.yaw); b.translate(q[0], s.y, q[1]); parts.push({ geo: b, group: 0 });
      });
      return merge(parts);
    };
    const deadMats = [deadMat, woodMat], deadDens = (x, z) => 0.25 + 0.75 * canopy(x, z);
    const stumpB = batch(snagGeo(1.9, 0.5, 0.4, 2), deadMats, { shadow: true, far: 130 });
    place(stumpB, 420, { clear: 14, dens: deadDens, smin: 0.5, smax: 1.3, tilt: 0.15, collide: 0.6, maxSlope: 0.6, skirt: 3 }); stumpB.build();
    const snagB = batch(snagGeo(9, 0.42, 0.26, 4, 3), deadMats, { shadow: true, far: 250 });
    place(snagB, 420, { clear: 20, dens: deadDens, smin: 0.6, smax: 1.3, sy: [0.7, 1.3], tilt: 0.14, collide: 0.5, maxSlope: 0.55, skirt: 2 }); snagB.build();
    const deadB = batch(snagGeo(17, 0.36, 0.1, 7, 8), deadMats, { shadow: true, far: 250 });
    place(deadB, 620, { clear: 22, dens: deadDens, smin: 0.6, smax: 1.3, sy: [0.75, 1.3], tilt: 0.12, collide: 0.42, maxSlope: 0.55, skirt: 2 });
    place(deadB, 110, { clear: 26, dens: deadDens, smin: 0.6, smax: 1.1, tilt: 0.85, sink: 0.4, collide: 0.42, maxSlope: 0.5, skirt: 2 }); // leaning, half fallen
    deadB.build();

    // fallen logs: lie along the slope, half sunk into the litter. They block walking but are low enough to
    // jump over (each collider records the height of the log's top), and a dinosaur simply steps over them.
    {
      const L = 8, r = 0.38, n = 240, lg = new THREE.CylinderGeometry(r * 0.8, r, L, 12, 10, true), lp = lg.attributes.position, luv = lg.attributes.uv;
      for (let i = 0; i < lp.count; i++) {
        const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i), t = y / L + 0.5, a = Math.atan2(z, x);
        const k = 1 + (0.1 * Math.sin(a * 3 + t * 5) + 0.06 * Math.sin(a * 7 - t * 11)) * Math.min(1, Math.sin(Math.PI * t) * 3);
        lp.setXYZ(i, x * k, y, z * k); luv.setXY(i, luv.getX(i) * 2, t * L / 1.5);
      }
      lg.computeVertexNormals(); seamFix(lg, 12); lg.rotateX(Math.PI / 2);
      const parts = [{ geo: lg, group: 0 }];
      const c1 = new THREE.CircleGeometry(r * 0.8, 12); c1.translate(0, 0, L / 2); parts.push({ geo: c1, group: 1 });
      const c0 = new THREE.CircleGeometry(r, 12); c0.rotateY(Math.PI); c0.translate(0, 0, -L / 2); parts.push({ geo: c0, group: 1 });
      [[-2.2, 0.5], [0.6, -0.9], [2.4, 0.2]].forEach(([z, ang]) => { // broken-off branch stubs
        const s = new THREE.CylinderGeometry(0.03, 0.09, 0.9, 6, 1, true); s.translate(0, 0.45 + r * 0.75, 0); s.rotateZ(ang); s.translate(0, 0, z); parts.push({ geo: s, group: 0 });
      });
      const B = batch(merge(parts), deadMats, { shadow: true, far: 140 }), d2 = new THREE.Object3D(); d2.rotation.order = 'YXZ';
      let c = 0;
      for (let tries = 0; c < n && tries < n * 20; tries++) {
        const x = (rnd() * 2 - 1) * W.LIMIT, z = (rnd() * 2 - 1) * W.LIMIT;
        const s = 0.7 + rnd() * 0.55, yaw = rnd() * Math.PI * 2, hl = L * s / 2, dx = Math.sin(yaw), dz = Math.cos(yaw);
        if (!okAt(x, z, 16) || !okAt(x + dx * hl, z + dz * hl, 16) || !okAt(x - dx * hl, z - dz * hl, 16)) continue;
        const h1 = W.height(x + dx * hl, z + dz * hl), h0 = W.height(x - dx * hl, z - dz * hl), hm = W.height(x, z);
        if (Math.abs(h1 - h0) > hl * 0.8 || Math.abs(hm - (h0 + h1) / 2) > 0.5) continue; // too steep, or bridging a dip / hump
        d2.position.set(x, (h0 + h1) / 2 + r * s * 0.3, z); d2.rotation.set(-Math.atan2(h1 - h0, 2 * hl), yaw, 0); d2.scale.setScalar(s);
        d2.updateMatrix(); const b = 0.8 + 0.3 * rnd(); B.add(d2.matrix, b, b, b * 0.95);
        for (let t = -hl; t <= hl + 0.01; t += 0.55 * s) {
          colliders.push({ x: x + dx * t, z: z + dz * t, r: r * s, top: h0 + (h1 - h0) * (t + hl) / (2 * hl) + r * s * 1.3 });
          if (rnd() < 0.5) putLow(x + dx * t + (rnd() - 0.5) * 1.6, z + dz * t + (rnd() - 0.5) * 1.6);
        }
        c++;
      }
      B.build();
    }

    // ---- undergrowth ----
    // tall ferns: thickets you can hide in (they grow exactly where cover() says there is cover)
    const gParts = crown(11, 1.7, 0.65, 1.1, -1.05, rnd, 0.02, 4);
    const fernB = batch(merge(gParts.map(p => ({ geo: p.geo, group: 0 }))), fernMat, { far: 170 });
    place(fernB, 44000, { clear: 6, dens: (x, z) => N.fbm2(x / 35, z / 35, 203, 3) >= 0.4 ? 1 : 0, smin: 0.6, smax: 1.6, sy: [0.8, 1.25] }); fernB.build();
    // low plants: small ferns and seedlings covering the open floor, thick in clearings where light reaches the
    // ground and thin under closed canopy. Too low to hide in.
    {
      const dens = (x, z) => (0.3 + 0.7 * ss(0.35, 0.6, N.fbm2(x / 22, z / 22, 220, 2))) * (0.2 + 0.8 * (1 - canopy(x, z)));
      for (let c = 0, tries = 0; c < 140000 && tries < 1400000; tries++) {
        const x = (rnd() * 2 - 1) * HALF, z = (rnd() * 2 - 1) * HALF;
        if (rnd() > dens(x, z)) continue;
        putLow(x, z); c++;
      }
    }
    lowB.build();

    // ---- rocks: two boulder shapes (blocky and slabby) with smaller ones lying round them, and loose stones ----
    const stoneB = batch(rockGeo(1, 5, 4), rockMat, { far: 115 });
    const stone = { clear: 4, smin: 0.1, smax: 0.45, sink: 0.25, tilt: 1.2 };
    const rockDens = (x, z) => ss(0.44, 0.6, N.fbm2(x / 50, z / 50, 206, 3));
    [[rockGeo(4, 3, 5), 180, 0.6, 3.2, 0.8], [rockGeo(4, 8, 8), 160, 0.5, 2.4, 0.75]].forEach(([g, n, smin, smax, col]) => {
      const B = batch(g, rockMat, { shadow: true, far: 190 });
      place(B, n, { clear: 12, dens: rockDens, smin, smax, sink: 0.25, tilt: 0.45, collide: col, skirt: 2, clump: { n: 5, r0: 1.5, r: 3.5, B: stoneB, o: Object.assign({}, stone, { smax: 0.8 }) } }); B.build();
    });
    place(stoneB, 2200, Object.assign({ dens: (x, z) => ss(0.4, 0.6, N.fbm2(x / 30, z / 30, 208, 3)) }, stone)); stoneB.build();

    // ---- drifting motes (dust, pollen, tiny insects) that catch the light: moving specks at different depths
    // are what make the space between the trunks read as air ----
    const soft = T.soft(), MOTES = 260, MBOX = 22;
    const moteGeo = new THREE.BufferGeometry(), mp = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) { mp[i * 3] = (rnd() * 2 - 1) * MBOX; mp[i * 3 + 1] = rnd() * 12; mp[i * 3 + 2] = (rnd() * 2 - 1) * MBOX; }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ map: soft, size: 0.075, transparent: true, depthWrite: false, opacity: 0.5, color: 0xfff2cf }));
    motes.frustumCulled = false; scene.add(motes);

    // ---- extraction beacon (red flare smoke) ----
    const goalY = W.height(W.GOAL.x, W.GOAL.z);
    const flare = new THREE.PointLight(0xff3a1a, 30, 40, 1.6); flare.position.set(W.GOAL.x, goalY + 1, W.GOAL.z); scene.add(flare);
    const smokes = [];
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0xd8584a, transparent: true, depthWrite: false, opacity: 0.5 }));
      sp.userData.t = i / 40; scene.add(sp); smokes.push(sp);
    }
    const flareCore = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd0a0 }));
    flareCore.position.copy(flare.position).y -= 0.8; scene.add(flareCore);

    // colliders in a coarse grid, so pushing something out of them only looks at the few nearby
    const CG = 8, cgrid = new Map(), ckey = (ix, iz) => (ix + 512) * 2048 + iz + 512;
    for (const c of colliders) { const k = ckey(Math.floor(c.x / CG), Math.floor(c.z / CG)); (cgrid.get(k) || cgrid.set(k, []).get(k)).push(c); }

    const world = {
      scene, sun, sunDir, colliders, terrain, chunks,
      update(dt, t, focus) {
        wind.value = t;
        sun.position.copy(focus).addScaledVector(sunDir, 175); sun.target.position.copy(focus);
        // draw only the chunks near enough to be seen through the fog
        for (const c of chunks) c.im.visible = Math.hypot(c.x - focus.x, c.z - focus.z) - c.r < c.far;
        // motes drift slowly and wrap round a box that follows the viewer
        for (let i = 0; i < MOTES; i++) {
          let x = mp[i * 3] + (0.22 + 0.15 * Math.sin(t * 0.3 + i)) * dt, y = mp[i * 3 + 1] + 0.08 * Math.sin(t * 0.5 + i * 1.7) * dt, z = mp[i * 3 + 2] + 0.12 * Math.cos(t * 0.27 + i * 0.6) * dt;
          if (x - focus.x > MBOX) x -= MBOX * 2; else if (x - focus.x < -MBOX) x += MBOX * 2;
          if (z - focus.z > MBOX) z -= MBOX * 2; else if (z - focus.z < -MBOX) z += MBOX * 2;
          if (y - focus.y > 10) y -= 12; else if (y - focus.y < -2) y += 12;
          mp[i * 3] = x; mp[i * 3 + 1] = y; mp[i * 3 + 2] = z;
        }
        moteGeo.attributes.position.needsUpdate = true;
        flare.intensity = 26 + Math.sin(t * 23) * 6 + Math.sin(t * 7) * 4;
        smokes.forEach(s => {
          const k = (s.userData.t + t * 0.025) % 1;
          s.position.set(W.GOAL.x + Math.sin(k * 9 + t * 0.2) * k * 6 + k * 14, goalY + 0.5 + k * 70, W.GOAL.z + Math.cos(k * 7) * k * 4);
          s.scale.setScalar(2 + k * 22); s.material.opacity = 0.55 * (1 - k) * Math.min(1, k * 8);
        });
      },
      // push a circle out of colliders
      // (feet: height of whatever is moving. Low obstacles such as fallen logs don't block something above them)
      // (minR: obstacles thinner than this are ignored — a big dinosaur shoulders through saplings and tree ferns)
      collide(p, r, feet, minR) {
        const ix = Math.floor(p.x / CG), iz = Math.floor(p.z / CG);
        for (let i = ix - 1; i <= ix + 1; i++) for (let j = iz - 1; j <= iz + 1; j++) {
          const list = cgrid.get(ckey(i, j)); if (!list) continue;
          for (const c of list) {
            if (c.top !== undefined && feet !== undefined && feet > c.top - 0.12) continue;
            if (minR && c.r < minR) continue;
            const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = r + c.r;
            if (d < m && d > 1e-4) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
          }
        }
      },
      // fern density at a point (for hiding)
      cover(x, z) { return N.fbm2(x / 35, z / 35, 203, 3); }
    };
    return world;
  };
})();
