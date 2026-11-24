// World: renderer setup, sky, lighting, terrain, vegetation
(function () {
  const DG = window.DG, N = DG.N, V = THREE.Vector3;
  const W = DG.W = {};
  W.SIZE = 1000; W.LIMIT = 400;
  W.START = new V(0, 0, 260); W.GOAL = new V(-30, 0, -270);

  // ---- ravines (地割れ): deep cracks crossing the route. Narrow stretches can be cleared with a running
  // jump; wide stretches cannot. A T-rex will not enter one and has to walk round via the shallow ends.
  // ---- map seed: every noise field and random draw that lays out the map (terrain, ravines, trees, rocks…) is
  // offset by SEED, so a new seed gives a new map. W.reseed(seed) picks the map; W.create then builds it.
  let SEED = 0;
  const fbm2 = (x, y, s, oct) => N.fbm2(x, y, s + SEED, oct);
  const vnoise2 = (x, y, s) => N.vnoise2(x, y, s + SEED);

  W.RAVINE_DEPTH = 5; W.RAVINE_MARGIN = 9; // margin = half-width of the detailed mesh strip
  // Many short ravines (90-150 m) scattered between the start and the goal, roughly across the way, so they have to
  // be jumped at a narrow spot or walked round. In the 3-player race (versus) every start's straight line to the goal
  // must cross the same number of them, so no runner gets an easier route.
  const RAVINE_N = 7, RAVINE_N_VS = 12, RAVINE_GAP = 2 * 9 + 27; // centre lines at least this far apart (strips never meet)
  function makeRavines(versus) {
    const rr = N.rng(991 + SEED);
    const mk = (c, ang, L, k) => {
      const dir = new V(Math.sin(ang), 0, Math.cos(ang)), side = new V(-dir.z, 0, dir.x), n = 12, pts = [];
      for (let i = 0; i < n; i++) {
        const s = (i / (n - 1) - 0.5) * L, w = (vnoise2(i * 0.6, k * 7.3, 992) - 0.5) * 10;
        pts.push(c.clone().addScaledVector(dir, s).addScaledVector(side, w));
      }
      const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const xs = pts.map(q => q.x), zs = pts.map(q => q.z), m = W.RAVINE_MARGIN + 2;
      return { pts, cum, len: cum[n - 1], seed: 993 + k, narrow: 0.3 + rr() * 0.4, box: [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m] };
    };
    // distance from a point to a ravine's centre line
    const segD = (q, a, b) => { const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1, u = Math.max(0, Math.min(1, ((q.x - a.x) * ex + (q.z - a.z) * ez) / l2)); return Math.hypot(q.x - a.x - ex * u, q.z - a.z - ez * u); };
    const lineD = (q, rv) => { let d = 1e9; for (let i = 0; i < rv.pts.length - 1; i++) d = Math.min(d, segD(q, rv.pts[i], rv.pts[i + 1])); return d; };
    const gapOK = (rv, list) => list.every(o => rv.pts.every(q => lineD(q, o) >= RAVINE_GAP) && o.pts.every(q => lineD(q, rv) >= RAVINE_GAP));
    const clearOfEnds = rv => rv.pts.every(q => [...W.STARTS, W.GOAL].every(s => Math.hypot(q.x - s.x, q.z - s.z) > 55));
    // does the straight line a -> b cut through the deep part of this ravine (its tapered ends don't count)?
    const cross = (a, b, rv) => {
      const P = rv.pts, n = P.length;
      for (let i = 1; i < n - 2; i++) {
        const c = P[i], d = P[i + 1];
        const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x); if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den, u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) return true;
      }
      return false;
    };
    const crossings = list => W.STARTS.map(s => list.filter(rv => cross(s, W.GOAL, rv)).length);
    const build = () => {
      const out = [], want = versus ? RAVINE_N_VS : RAVINE_N;
      for (let k = 0; k < want; k++) {
        const f0 = 0.14 + 0.76 * (k + 0.5) / want; // spread from near the start to near the goal
        for (let tries = 0; tries < 25; tries++) {
          const s = versus ? W.STARTS[k % W.STARTS.length] : W.START; // in a race: across each route in turn
          const rs = new V().subVectors(W.GOAL, s).normalize(), ps = new V(-rs.z, 0, rs.x); // across that route
          const f = (versus ? 0.2 + 0.6 * (Math.floor(k / W.STARTS.length) + 0.5) / Math.ceil(want / W.STARTS.length) : f0) + (rr() - 0.5) * 0.08;
          const c = s.clone().lerp(W.GOAL, f).addScaledVector(ps, (rr() - 0.5) * (versus ? 60 : 120));
          const rv = mk(c, Math.atan2(ps.x, ps.z) + (rr() - 0.5) * 0.9, 90 + rr() * 60, out.length);
          if (clearOfEnds(rv) && gapOK(rv, out)) { out.push(rv); break; }
        }
      }
      return out;
    };
    // keep the layout whose routes are crossed most evenly (and, in single play, crossed at least three times)
    let best = null, bestScore = -1e9;
    for (let tries = 0; tries < (versus ? 150 : 20); tries++) {
      const out = build(), cr = crossings(out), lo = Math.min(...cr), hi = Math.max(...cr);
      const score = -(hi - lo) * 100 + Math.min(lo, 4) * 10 + out.length;
      if (score > bestScore) { bestScore = score; best = out; }
      if (hi === lo && lo >= 3 && out.length >= (versus ? RAVINE_N_VS : RAVINE_N) - 1) break;
    }
    W.RAVINE_CROSSINGS = crossings(best);
    return best;
  }
  // A race: the signal goes somewhere new each time, and the three starts sit evenly round it (120° apart) at the
  // same distance, at a random turn. The signal is kept where all three starts stay clear of the mountains at the edge.
  // A race map is larger than the single-player one (LIMIT 730 instead of 400, the mountains rising from about 710),
  // so the starts can be far from the signal and still well inside the forest, out of sight of the mountains.
  W.GOAL_SOLO = W.GOAL.clone();
  W.RACE_R = 530;            // start-to-signal distance in a race (as far as the single-player route)
  const RACE_EDGE = 580;     // starts no further out than this
  const SOLO_MAP = { LIMIT: 400, SIZE: 1000 }, RACE_MAP = { LIMIT: 730, SIZE: 1700 };
  function placeRace() {
    const rr = N.rng(997 + SEED), R = W.RACE_R, a0 = rr() * Math.PI * 2;
    const off = [0, 1, 2].map(k => { const a = a0 + k * Math.PI * 2 / 3; return [Math.sin(a) * R, Math.cos(a) * R]; });
    const range = i => { const v = off.map(o => o[i]); return [-RACE_EDGE - Math.min(...v), RACE_EDGE - Math.max(...v)]; };
    const [x0, x1] = range(0), [z0, z1] = range(1);
    W.GOAL.set(x0 + (x1 - x0) * rr(), 0, z0 + (z1 - z0) * rr());
    return off.map(o => new V(W.GOAL.x + o[0], 0, W.GOAL.z + o[1]));
  }
  // Co-op (2-4 players): a night swamp. The team starts together at a camp; the radio tower, six supply crates
  // (some holding the fuses the tower needs) and the helicopter landing zone are spread round the map.
  // No ravines here: the swamp's pools (W.WATER) are what slows you down and makes noise.
  const COOP_MAP = { LIMIT: 330, SIZE: 900 };
  W.WATER = -1e9;
  W.SAFE_R = 8; // a safe zone's radius (co-op): the ring of lanterns
  W.NIGHT_FOG = 0.016; // how thick the night's fog is (co-op): about 85 m of sight
  // The way out is picked from the seed too: 0 a helicopter at a landing zone, 1 a boat at a jetty (on a pool dug
  // out beside it), 2 an old mine tunnel in the hills at the map's edge. W.GOAL is where you board it.
  // Sixteen more spots, each on a small island, are where this game's missions put their things (game.js).
  function placeCoop() {
    const rr = N.rng(1201 + SEED), a0 = rr() * Math.PI * 2, P = (a, d) => new V(Math.sin(a) * d, 0, Math.cos(a) * d);
    const esc = Math.floor(rr() * 3), aEsc = a0 + Math.PI + (rr() - 0.5) * 0.7;
    const camp = P(a0, 235), lz = P(aEsc, esc === 2 ? 292 : 245), tower = P(a0 + Math.PI / 2 + (rr() - 0.5) * 0.8, 70 + rr() * 50);
    const caches = [], spots = [];
    for (let tries = 0; caches.length < 6 && tries < 600; tries++) {
      const q = P(rr() * Math.PI * 2, 70 + rr() * 200);
      if ([camp, lz, tower, ...caches].some(s => Math.hypot(s.x - q.x, s.z - q.z) < (s === camp ? 110 : 75))) continue;
      caches.push(q);
    }
    for (let tries = 0, gap = 58; spots.length < 16 && tries < 4000; tries++) {
      if (tries % 800 === 799) gap -= 8; // crowded: allow them a little closer together
      const q = P(rr() * Math.PI * 2, 40 + Math.sqrt(rr()) * 240);
      if ([camp, lz, tower, ...caches, ...spots].some(s => Math.hypot(s.x - q.x, s.z - q.z) < (s === camp ? 70 : s === lz ? 60 : gap))) continue;
      spots.push(q);
    }
    // two or three safe zones (game.js keeps the stalkers out of them until the way out is opened): on their own
    // islands, well away from the camp, the way out and each other
    const safe = [];
    for (let tries = 0, gap = 150; safe.length < 3 && tries < 3000; tries++) {
      if (tries % 1000 === 999) gap -= 35;
      const q = P(rr() * Math.PI * 2, 60 + Math.sqrt(rr()) * 215);
      if ([camp, lz, tower, ...caches, ...spots].some(s => Math.hypot(s.x - q.x, s.z - q.z) < (s === camp ? 90 : s === lz ? 80 : s === tower ? 50 : 32))) continue;
      if (safe.some(s => Math.hypot(s.x - q.x, s.z - q.z) < gap)) continue;
      safe.push(q);
    }
    // the boat lies on water just off the jetty (on the side away from the map's centre); the tunnel's mouth faces the swamp
    const out = new V(lz.x, 0, lz.z).normalize();
    const boat = lz.clone().addScaledVector(out, 11), mouth = lz.clone();
    W.SITES = { camp, tower, lz, caches, spots, esc, boat, mouth, out, safe };
    W.GOAL.copy(esc === 1 ? lz.clone().addScaledVector(out, 4) : lz);
    const face = Math.atan2(-camp.x, -camp.z); // the starts sit round the camp fire, the first facing the map's centre
    return [0, 1, 2, 3].map(k => camp.clone().add(P(face + (k - 1.5) * 0.7, 6)));
  }
  W.reseed = function (seed, mode) {
    const versus = mode === true || mode === 'race', coop = mode === 'coop';
    SEED = seed | 0; W.seed = SEED; W.VERSUS = versus; W.COOP = coop;
    Object.assign(W, versus ? RACE_MAP : coop ? COOP_MAP : SOLO_MAP);
    W.WATER = coop ? -0.55 : -1e9; W.SITES = null;
    W.BRIDGES = []; W.BR_DOWN = []; W.BR_LIVE = false;
    if (versus) W.STARTS = placeRace();
    else if (coop) { W.STARTS = placeCoop(); if (W.BR_ON) { W.BRIDGES = placeBridges(); W.BR_DOWN = W.BRIDGES.map(() => 0); } }
    else { W.GOAL.copy(W.GOAL_SOLO); W.STARTS = [W.START]; }
    W.RAVINES = coop ? [] : makeRavines(versus);
  };
  W.reseed((Math.random() * 1e6) | 0);
  // half-width at fraction t along the ravine: alternating narrow (≈3.5 m, jumpable) and wide (≈7.5 m) stretches
  // Every ravine also gets one sure narrow stretch (about 12 m long, somewhere in its middle part), since a short
  // ravine could otherwise come out wide all along.
  W.ravineHW = (rv, t) => {
    const base = 1.75 + 2.0 * N.smoothstep(0.42, 0.58, vnoise2(t * rv.len / 32, rv.seed, 994));
    if (rv.narrow == null) return base;
    const nd = Math.abs(t - rv.narrow) * rv.len; // metres from the middle of the narrow stretch
    return nd < 6 ? 1.75 : nd < 14 ? base + (1.75 - base) * (1 - (nd - 6) / 8) : base;
  };
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
    const dr = bd + (vnoise2(x * 0.9, z * 0.9, 995) - 0.5) * 0.5; // rough rock walls
    RQ.depth = W.RAVINE_DEPTH * taper * (1 - N.smoothstep(0.55 * RQ.hw, RQ.hw, dr)) * (0.85 + 0.3 * vnoise2(t * 40, 1, 996));
    return RQ;
  };

  // the swamp: almost flat, with pools wherever the "wet" field is high, and low islands under every site
  function swampHeight(x, z) {
    let h = (fbm2(x / 200 + 10, z / 200 + 10, 101, 4) - 0.5) * 6 + (fbm2(x / 48, z / 48, 102, 3) - 0.5) * 2.4;
    h -= N.smoothstep(0.48, 0.62, fbm2(x / 85 + 3, z / 85 + 5, 105, 3)) * 2.3;
    const e = Math.max(Math.abs(x), Math.abs(z));
    h += N.smoothstep(W.LIMIT - 20, W.LIMIT + 90, e) * 55 * (0.6 + 0.8 * fbm2(x / 50, z / 50, 103, 2));
    const S = W.SITES;
    if (S) {
      for (const p of [S.camp, S.tower, S.lz, ...S.caches]) {
        const d = Math.hypot(x - p.x, z - p.z); if (d > 34) continue;
        const k = 1 - N.smoothstep(12, 34, d); h = h + (Math.max(h, 0.35) - h) * k;
      }
      for (const p of S.safe) { // the safe zones: an island a little wider than the ring of lanterns
        const d = Math.hypot(x - p.x, z - p.z); if (d > 24) continue;
        const k = 1 - N.smoothstep(W.SAFE_R + 3, 24, d); h = h + (Math.max(h, 0.35) - h) * k;
      }
      for (const p of S.spots) { // the mission spots: smaller islands
        const d = Math.hypot(x - p.x, z - p.z); if (d > 18) continue;
        const k = 1 - N.smoothstep(6, 18, d); h = h + (Math.max(h, 0.3) - h) * k;
      }
      if (S.esc === 1) { // the boat's pool, deep enough to float in
        const d = Math.hypot(x - S.boat.x, z - S.boat.z);
        if (d < 16) h = Math.min(h, h + (-1.6 - h) * (1 - N.smoothstep(7, 16, d)));
      }
    }
    return W.BR_LIVE ? deckH(x, z, h) : h;
  }
  // ---- (trial 'shortcut', game.js) wooden drawbridges over the swamp's pools: a boardwalk across 18-40 m of open
  // water whose middle span stands raised until two people wind it down together (at a winch on either bank). Laid out
  // from the seed, only when W.BR_ON (set by the game before W.reseed). The deck is walked on (W.height) only while a
  // game runs (W.BR_LIVE: the terrain and plants are made without it), its middle span once it is down (W.BR_DOWN[i] = 1).
  W.DECK_HW = 0.85; W.BRIDGES = []; W.BR_DOWN = []; W.BR_LIVE = false;
  function placeBridges() {
    const rr = N.rng(1307 + SEED), S = W.SITES, out = [], lim = W.LIMIT - 45, dry = (x, z) => swampHeight(x, z) > W.WATER + 0.15;
    const avoid = [S.camp, S.tower, S.lz, S.boat, ...S.caches, ...S.spots, ...S.safe];
    // from a point on dry ground, each of 16 ways out: open water within 4 m, then 18-42 m of it (nearly all water),
    // then dry ground again
    const across = (ax, az, dx, dz) => {
      let ws = -1, n = 0, wet = 0;
      for (let s = 0.5; s < 50; s += 0.5) {
        const h = swampHeight(ax + dx * s, az + dz * s);
        if (ws < 0) { if (h < W.WATER - 0.1) ws = s; else if (s > 4) return null; continue; }
        n++; if (h < W.WATER) wet++;
        if (h > W.WATER + 0.15 && dry(ax + dx * (s + 1.5), az + dz * (s + 1.5))) return s - ws >= 18 && s - ws <= 42 && wet >= n * 0.85 ? [ws, s] : null;
      }
      return null;
    };
    for (let tries = 0; out.length < 3 && tries < 1500; tries++) {
      const ax = (rr() * 2 - 1) * lim, az = (rr() * 2 - 1) * lim, a0 = rr() * Math.PI * 2;
      if (!dry(ax, az) || out.some(o => Math.hypot(o.mid.x - ax, o.mid.z - az) < 110)) continue;
      let f = null, dx = 0, dz = 0;
      for (let k = 0; k < 16 && !f; k++) { dx = Math.sin(a0 + k * 0.3927); dz = Math.cos(a0 + k * 0.3927); f = across(ax, az, dx, dz); }
      if (!f) continue;
      const [ws, we] = f, s0 = Math.max(0, ws - 2.5), s1 = we + 2.5, a = new V(ax + dx * s0, 0, az + dz * s0), b = new V(ax + dx * s1, 0, az + dz * s1);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      if (avoid.some(p => Math.hypot(p.x - mid.x, p.z - mid.z) < 36 || Math.hypot(p.x - a.x, p.z - a.z) < 20 || Math.hypot(p.x - b.x, p.z - b.z) < 20)) continue;
      if (out.some(o => Math.hypot(o.mid.x - mid.x, o.mid.z - mid.z) < 130)) continue;
      const len = s1 - s0, gap = Math.min(10, len * 0.34), g0 = (len - gap) / 2, side = new V(dz, 0, -dx), fw = new V(dx, 0, dz);
      out.push({ i: out.length, a, b, mid, dx, dz, len, g0, g1: g0 + gap, y: W.WATER + 0.5,
        box: [Math.min(a.x, b.x) - 3, Math.max(a.x, b.x) + 3, Math.min(a.z, b.z) - 3, Math.max(a.z, b.z) + 3],
        w: [a.clone().addScaledVector(side, 1.7).addScaledVector(fw, 0.8), b.clone().addScaledVector(side, 1.7).addScaledVector(fw, -0.8)] }); // the winches
    }
    return out;
  }
  function deckH(x, z, h) {
    for (const b of W.BRIDGES) {
      if (x < b.box[0] || x > b.box[1] || z < b.box[2] || z > b.box[3]) continue;
      const rx = x - b.a.x, rz = z - b.a.z, t = rx * b.dx + rz * b.dz;
      if (t < 0 || t > b.len || Math.abs(rx * b.dz - rz * b.dx) > W.DECK_HW) continue;
      if (t > b.g0 && t < b.g1 && !(W.BR_DOWN[b.i] >= 1)) continue; // the raised span: a gap
      if (b.y > h) h = b.y;
    }
    return h;
  }
  // distance across from a bridge's line, when along it (else Infinity): to keep the plants off it
  const nearBridge = (x, z, m) => W.BRIDGES.some(b => { const rx = x - b.a.x, rz = z - b.a.z, t = rx * b.dx + rz * b.dz; return t > -m && t < b.len + m && Math.abs(rx * b.dz - rz * b.dx) < W.DECK_HW + m; });
  // depth of water at (x, z): > 0 in a pool
  W.waterDepth = (x, z) => W.WATER - W.height(x, z);
  W.height = function (x, z) {
    if (W.COOP) return swampHeight(x, z);
    let h = (fbm2(x / 260 + 10, z / 260 + 10, 101, 4) - 0.5) * 34 + (fbm2(x / 70, z / 70, 102, 3) - 0.5) * 7;
    const e = Math.max(Math.abs(x), Math.abs(z));
    h += N.smoothstep(W.LIMIT - 20, W.LIMIT + 90, e) * 70 * (0.6 + 0.8 * fbm2(x / 50, z / 50, 103, 2));
    // gentle basins at start and goal
    for (const p of W.STARTS) { const d = Math.hypot(x - p.x, z - p.z); h = h * (0.35 + 0.65 * N.smoothstep(10, 60, d)); }
    { const d = Math.hypot(x - W.GOAL.x, z - W.GOAL.z); h = h * (0.35 + 0.65 * N.smoothstep(10, 60, d)); }
    const q = W.ravineAt(x, z); if (q) h -= q.depth;
    return h;
  };

  // How closed the forest is at a spot: 0 in a clearing, 1 under full canopy. Trees, undergrowth and the colour
  // of the ground all follow this one field, so they agree with each other.
  const canopy = W.canopy = (x, z) => N.smoothstep(0.4, 0.53, fbm2(x / 150 + 7, z / 150 + 3, 301, 3));

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

  // opts.scene: build into this existing scene (after the previous map was taken out with world.dispose()), so that
  // everything else living in it (dinosaurs, item lights) stays where it is
  W.create = function (renderer, opts) {
    const scene = (opts && opts.scene) || new THREE.Scene();
    const before = new Set(scene.children);
    const T = DG.T, rnd = N.rng(77 + SEED);
    // quality profile (set by game.js; a phone gets fewer plants and a smaller shadow map)
    // In a race every player's map must be identical (the same trees block everyone), so the plant counts are not
    // thinned for phones there: opts.layout = {veg: 1, fern: 1}.
    const Q = Object.assign({ veg: 1, fern: 1, shadow: 4096 }, DG.Q, opts && opts.layout);
    // ---- sky & lights ----
    const NIGHT = !!W.COOP;
    let sunDir, envRT = null, hemi;
    if (!NIGHT) {
      const sky = new THREE_Sky(); sky.scale.setScalar(4500);
      const su = sky.material.uniforms; su.turbidity.value = 9; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.82;
      sunDir = new V().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 24), THREE.MathUtils.degToRad(-35));
      su.sunPosition.value.copy(sunDir);
      const envScene = new THREE.Scene(); const sky2 = new THREE_Sky(); sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
      ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'].forEach(k => sky2.material.uniforms[k].value = su[k].value);
      envScene.add(sky2);
      const pmrem = new THREE.PMREMGenerator(renderer);
      envRT = pmrem.fromScene(envScene, 0.04);
      scene.environment = envRT.texture;
      pmrem.dispose(); sky2.geometry.dispose(); sky2.material.dispose();
      scene.add(sky);
      // pale, slightly blue haze: distance washes things out toward the colour of the sky (aerial perspective)
      scene.fog = new THREE.FogExp2(0xb1bfc0, 0.0075);
    } else {
      // a rainy night under a thin, clouded moon: dark, but the ground, trees and pools stay readable on any screen,
      // with a cold haze that swallows everything past ~85 m (see NIGHT_FOG; the fog's colour is set again every
      // frame in update, for lightning)
      sunDir = new V().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(40));
      scene.background = new THREE.Color(0x262e3a);
      scene.environment = null;
      scene.fog = new THREE.FogExp2(0x10161c, W.NIGHT_FOG);
    }
    const sun = new THREE.DirectionalLight(NIGHT ? 0x9db2d4 : 0xffe4bc, NIGHT ? 5.0 : 2.9);
    sun.castShadow = true; sun.shadow.mapSize.set(NIGHT ? Math.min(Q.shadow, 2048) : Q.shadow, NIGHT ? Math.min(Q.shadow, 2048) : Q.shadow);
    const sc = sun.shadow.camera; sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 250;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    hemi = new THREE.HemisphereLight(NIGHT ? 0x3a4e6c : 0xc4d6ea, NIGHT ? 0x1a1812 : 0x545038, NIGHT ? 7.0 : 0.5); // sky fill, so shade under the trees stays readable
    scene.add(hemi);
    renderer.toneMappingExposure = NIGHT ? 1.45 : 0.85; // the night is exposed a little brighter

    // ---- terrain ----
    const S = W.SIZE, R = Math.round(S / 3.125); // about 3 m between vertices on any map size
    const tg = new THREE.PlaneGeometry(S, S, R, R); tg.rotateX(-Math.PI / 2);
    const tp = tg.attributes.position, cols = [];
    // colour: mossy/dirt variation, rock on steep slopes, darker deep inside ravines
    // (the rock on steep faces comes from the ground shader below, by slope)
    const groundCol = (x, z, h, out) => {
      const m = fbm2(x / 40, z / 40, 104, 3), c = canopy(x, z);
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
    const HALF = W.LIMIT + 60, GRID = Math.max(10, Math.round(HALF * 2 / 92)), CELL = HALF * 2 / GRID, chunks = [];
    // On the larger race map the forest keeps the single-player density over the whole play area round the signal
    // (to well beyond the starts) and thins out further away, where nobody needs to go. AREA scales every count
    // so the density per square metre stays what it is in single play.
    const keep = W.VERSUS ? (x, z) => 0.3 + 0.7 * (1 - N.smoothstep(W.RACE_R + 150, W.RACE_R + 300, Math.hypot(x - W.GOAL.x, z - W.GOAL.z))) : null;
    let AREA = 1;
    if (keep) { let s = 0; for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) s += keep(((i + 0.5) / 30 - 1) * HALF, ((j + 0.5) / 30 - 1) * HALF); AREA = s / 3600 * (HALF * HALF) / (460 * 460); }
    const kept = (x, z) => !keep || rnd() < keep(x, z);
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
    // wet: may stand in a swamp pool (dead trunks and reeds do; nothing else grows in open water)
    const SITE_LIST = W.SITES ? [W.SITES.tower, ...W.SITES.caches, ...W.SITES.spots, W.SITES.boat] : [];
    const SAFE_LIST = W.SITES ? W.SITES.safe : [];
    const okAt = (x, z, clear, wet) => {
      if (Math.abs(x) > W.LIMIT + 40 || Math.abs(z) > W.LIMIT + 40) return false;
      for (const p of W.STARTS) if (Math.hypot(x - p.x, z - p.z) < clear) return false;
      if (Math.hypot(x - W.GOAL.x, z - W.GOAL.z) < clear) return false;
      for (const p of SITE_LIST) if (Math.hypot(x - p.x, z - p.z) < Math.max(clear, 9)) return false;
      for (const p of SAFE_LIST) if (Math.hypot(x - p.x, z - p.z) < Math.max(clear, W.SAFE_R + 3.5)) return false; // the safe zones stay open
      if (W.BRIDGES.length && nearBridge(x, z, 2.5)) return false; // (and the drawbridges)
      if (W.COOP && !wet && W.height(x, z) < W.WATER + 0.08) return false;
      // the glade at the start, where the title screen shows the dinosaur off: nothing taller than ferns grows there
      if (clear >= 10 && !W.VERSUS && !W.COOP && Math.hypot(x - W.START.x, z - (W.START.z - 12)) < 34) return false;
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
    // the swamp keeps few living conifers and many more dead, drowned trunks (o.cm: this kind's count there)
    const place = (B, n, o) => {
      n = Math.round(n * (o.q == null ? Q.veg : o.q) * AREA * (W.COOP && o.cm != null ? o.cm : 1));
      let c = 0;
      for (let tries = 0; c < n && tries < n * 14; tries++) {
        const x = (rnd() * 2 - 1) * HALF, z = (rnd() * 2 - 1) * HALF;
        if (!okAt(x, z, o.clear, o.wet) || !kept(x, z)) continue;
        if (o.dens && rnd() > o.dens(x, z)) continue;
        if (o.maxSlope && slopeAt(x, z) > o.maxSlope) continue;
        put(B, x, z, o); c++;
        const cl = o.clump;
        if (cl) for (let k = Math.floor(rnd() * (cl.n + 1)); k > 0; k--) {
          const a = rnd() * 6.283, d = cl.r0 + rnd() * cl.r, x2 = x + Math.cos(a) * d, z2 = z + Math.sin(a) * d, o2 = cl.o || o;
          if (!okAt(x2, z2, o2.clear, o2.wet) || (o2.maxSlope && slopeAt(x2, z2) > o2.maxSlope)) continue;
          put(cl.B || B, x2, z2, o2, cl.s); if (!cl.B) c++;
        }
      }
    };

    // ---- where things grow ----
    const ss = N.smoothstep;
    const stand = (x, z) => fbm2(x / 90, z / 90, 201, 3);                    // which conifer dominates a stand
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
    const big = { clear: 26, smin: 0.72, smax: 1.2, sy: [0.88, 1.18], tilt: 0.07, collide: 0.6, maxSlope: 0.55, skirt: 3, cm: 0.14 };
    const sapling = { clear: 20, smin: 0.5, smax: 1.25, sy: [0.85, 1.25], tilt: 0.1, collide: 0.3, maxSlope: 0.6, skirt: 2, cm: 0.3 };
    const youngB = batch(conical(9, 1.3, 18, 2.7, 0.5, 0.2, 1.7), treeMats, { shadow: true, far: 250 });
    const araDens = (x, z) => canopy(x, z) * (0.3 + 0.7 * ss(0.38, 0.6, stand(x, z)));
    const conDens = (x, z) => canopy(x, z) * (0.3 + 0.7 * ss(0.4, 0.62, 1 - stand(x, z)));
    [araucaria(24), araucaria(20)].forEach(g => { const B = batch(g, treeMats, { shadow: true, far: 250 }); place(B, 1250, Object.assign({ dens: araDens, clump: { n: 1, r0: 2.5, r: 5, B: youngB, o: sapling, s: 0.8 } }, big)); B.build(); });
    [conical(26, 9, 34, 4.4, 0.9, 0.55, 2.2), conical(21, 6.5, 30, 3.8, 0.8, 0.45, 2.1)].forEach(g => { const B = batch(g, treeMats, { shadow: true, far: 250 }); place(B, 1450, Object.assign({ dens: conDens, clump: { n: 2, r0: 2, r: 5, B: youngB, o: sapling } }, big)); B.build(); });
    place(youngB, 900, Object.assign({ dens: (x, z) => 0.15 + 0.85 * edge(x, z) }, sapling)); // young growth crowding the margins of clearings
    youngB.build();
    // giants: a few enormous old trees with buttressed trunks, standing well above the canopy
    const giantB = batch(conical(42, 19, 40, 7.5, 1.6, 1.4, 3.0, { radial: 16, hs: 10, flare: 0.55 }), treeMats, { shadow: true, far: 270 });
    place(giantB, 170, { cm: 0.3, clear: 42, dens: canopy, smin: 0.8, smax: 1.25, sy: [0.9, 1.1], tilt: 0.04, collide: 1.6, maxSlope: 0.45, skirt: 6 }); giantB.build();
    // poles: thin young trunks in tight groups, with only a tuft of foliage at the top. A real forest shows far
    // more stems than crowns; these (and the dead trunks below) supply them cheaply. Too thin to block anyone.
    {
      const br = []; for (let i = 0; i < 12; i++) br.push({ y: 3.4 + i * 0.32 + rnd() * 0.15, len: 1.7 - i * 0.1, wid: 1.15, tilt: 0.25 - i * 0.07, droop: 0.35, yaw: i * 2.39996 + rnd() * 0.4 });
      const B = batch(tree({ h: 7.2, r0: 0.085, r1: 0.03, flare: 0.25, lean: 0.35, radial: 5, hs: 3, cy: null, branches: br }), treeMats, { shadow: true, far: 170 });
      const pole = { clear: 16, smin: 0.6, smax: 1.15, sy: [0.8, 1.2], tilt: 0.16, maxSlope: 0.6, cm: 0.35 };
      place(B, 4200, Object.assign({ dens: (x, z) => canopy(x, z) * ss(0.42, 0.6, fbm2(x / 30, z / 30, 213, 2)), clump: { n: 4, r0: 0.5, r: 2.2 } }, pole)); B.build();
    }

    // tree fern: fibrous trunk, thicker at the base
    const fParts = [{ geo: trunkGeo(3.2, 0.22, 0.13, 0.25, y => [Math.sin(y * 0.7) * 0.12, 0], 3, 8, 4), group: 0 }];
    crown(14, 2.6, 0.9, 1.6, -0.45, rnd, 3.1).forEach(p => { p.geo.translate(Math.sin(3.1 * 0.7) * 0.12, 0, 0); fParts.push(p); });
    const tfB = batch(merge(fParts), [barkMat, fernMat], { shadow: true, far: 170 });
    place(tfB, 2800, { cm: 0.5, clear: 14, dens: (x, z) => ss(0.34, 0.55, fbm2(x / 60, z / 60, 202, 3)) * (0.35 + 0.65 * canopy(x, z)), smin: 0.7, smax: 1.5, sy: [0.8, 1.3], tilt: 0.12, collide: 0.25, maxSlope: 0.7, skirt: 2, clump: { n: 2, r0: 1.2, r: 3 } }); tfB.build();

    // cycads: a squat barrel trunk with a rosette of stiff fronds; they like the light of clearings and margins
    const cParts = [{ geo: trunkGeo(0.9, 0.3, 0.26, 0.15, null, 5, 10, 3), group: 0 }];
    crown(16, 1.7, 0.42, 0.9, -0.55, rnd, 0.85, 5).forEach(p => cParts.push(p));
    crown(8, 1.1, 0.34, 0.5, -1.15, rnd, 0.9, 4).forEach(p => cParts.push(p));
    const cyB = batch(merge(cParts), [barkMat, cycadLeaf], { far: 130 });
    place(cyB, 1300, { cm: 0.25, clear: 10, dens: (x, z) => (1 - 0.75 * canopy(x, z)) * ss(0.4, 0.6, fbm2(x / 45, z / 45, 207, 3)), smin: 0.7, smax: 1.5, collide: 0.3, maxSlope: 0.7, skirt: 1, clump: { n: 2, r0: 1, r: 3 } }); cyB.build();

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
    place(stumpB, 420, { cm: 1.8, wet: true, clear: 14, dens: deadDens, smin: 0.5, smax: 1.3, tilt: 0.15, collide: 0.6, maxSlope: 0.6, skirt: 3 }); stumpB.build();
    const snagB = batch(snagGeo(9, 0.42, 0.26, 4, 3), deadMats, { shadow: true, far: 250 });
    place(snagB, 420, { cm: 2.6, wet: true, clear: 20, dens: deadDens, smin: 0.6, smax: 1.3, sy: [0.7, 1.3], tilt: 0.14, collide: 0.5, maxSlope: 0.55, skirt: 2 }); snagB.build();
    const deadB = batch(snagGeo(17, 0.36, 0.1, 7, 8), deadMats, { shadow: true, far: 250 });
    place(deadB, 620, { cm: 2.4, wet: true, clear: 22, dens: deadDens, smin: 0.6, smax: 1.3, sy: [0.75, 1.3], tilt: 0.12, collide: 0.42, maxSlope: 0.55, skirt: 2 });
    place(deadB, 110, { cm: 2.5, wet: true, clear: 26, dens: deadDens, smin: 0.6, smax: 1.1, tilt: 0.85, sink: 0.4, collide: 0.42, maxSlope: 0.5, skirt: 2 }); // leaning, half fallen
    deadB.build();

    // fallen logs: lie along the slope, half sunk into the litter. They block walking but are low enough to
    // jump over (each collider records the height of the log's top), and a dinosaur simply steps over them.
    {
      const L = 8, r = 0.38, n = Math.round(240 * Q.veg * AREA * (W.COOP ? 1.3 : 1)), lg = new THREE.CylinderGeometry(r * 0.8, r, L, 12, 10, true), lp = lg.attributes.position, luv = lg.attributes.uv;
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
        if (!okAt(x, z, 16) || !okAt(x + dx * hl, z + dz * hl, 16) || !okAt(x - dx * hl, z - dz * hl, 16) || !kept(x, z)) continue;
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
    place(fernB, 44000, { cm: 0.7, q: Q.fern, clear: 6, dens: (x, z) => fbm2(x / 35, z / 35, 203, 3) >= 0.4 ? 1 : 0, smin: 0.6, smax: 1.6, sy: [0.8, 1.25] }); fernB.build();
    // low plants: small ferns and seedlings covering the open floor, thick in clearings where light reaches the
    // ground and thin under closed canopy. Too low to hide in.
    {
      const dens = (x, z) => (0.3 + 0.7 * ss(0.35, 0.6, fbm2(x / 22, z / 22, 220, 2))) * (0.2 + 0.8 * (1 - canopy(x, z)));
      for (let c = 0, tries = 0, n = 140000 * Q.veg * AREA * (W.COOP ? 0.5 : 1); c < n && tries < 1400000 * AREA; tries++) {
        const x = (rnd() * 2 - 1) * HALF, z = (rnd() * 2 - 1) * HALF;
        if (rnd() > dens(x, z) || !kept(x, z)) continue;
        putLow(x, z); c++;
      }
    }
    lowB.build();

    // ---- rocks: two boulder shapes (blocky and slabby) with smaller ones lying round them, and loose stones ----
    const stoneB = batch(rockGeo(1, 5, 4), rockMat, { far: 115 });
    const stone = { clear: 4, smin: 0.1, smax: 0.45, sink: 0.25, tilt: 1.2 };
    const rockDens = (x, z) => ss(0.44, 0.6, fbm2(x / 50, z / 50, 206, 3));
    [[rockGeo(4, 3, 5), 180, 0.6, 3.2, 0.8], [rockGeo(4, 8, 8), 160, 0.5, 2.4, 0.75]].forEach(([g, n, smin, smax, col]) => {
      const B = batch(g, rockMat, { shadow: true, far: 190 });
      place(B, n, { cm: 0.4, clear: 12, dens: rockDens, smin, smax, sink: 0.25, tilt: 0.45, collide: col, skirt: 2, clump: { n: 5, r0: 1.5, r: 3.5, B: stoneB, o: Object.assign({}, stone, { smax: 0.8 }) } }); B.build();
    });
    place(stoneB, 2200, Object.assign({ cm: 0.5, dens: (x, z) => ss(0.4, 0.6, fbm2(x / 30, z / 30, 208, 3)) }, stone)); stoneB.build();

    // ---- the swamp: open water, reed beds along it, and the mission sites (co-op) ----
    let reedField = null;
    const props = { caches: [], safe: [], tower: null, camp: null, lz: null, fire: null, br: [] };
    let safeLit = true, safeEnd = 0;
    if (W.COOP) {
      // still, black water with a faint sheen
      const wg = new THREE.PlaneGeometry(S, S, 1, 1); wg.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x1a2832, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.9 }));
      water.position.y = W.WATER; water.receiveShadow = true; scene.add(water);
      // reeds: tufts of thin bent blades in the shallows and along the banks, tall enough to crouch in
      reedField = (x, z) => { const d = W.WATER - W.height(x, z); return d > -0.4 && d < 0.95 ? ss(0.4, 0.56, fbm2(x / 24, z / 24, 230, 2)) : 0; };
      const blades = [];
      for (let i = 0; i < 12; i++) {
        const h = 1.4 + rnd() * 1.2, g = new THREE.PlaneGeometry(0.07, h, 1, 5), p = g.attributes.position, bend = (rnd() - 0.3) * 0.5;
        for (let k = 0; k < p.count; k++) { const y = p.getY(k) + h / 2, t = y / h; p.setXYZ(k, p.getX(k) * (1 - 0.8 * t) + bend * t * t * h * 0.4, y, 0); }
        g.computeVertexNormals(); const a = rnd() * 6.283, r = rnd() * 0.35; g.rotateY(rnd() * 3.14); g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
        blades.push({ geo: g, group: 0 });
      }
      const reedMat = new THREE.MeshStandardMaterial({ color: 0x6d6a42, roughness: 0.9, side: THREE.DoubleSide });
      const reedB = batch(merge(blades), reedMat, { far: 120 });
      for (let c = 0, tries = 0, n = 7000 * Q.veg; c < n && tries < n * 30; tries++) {
        const x = (rnd() * 2 - 1) * HALF, z = (rnd() * 2 - 1) * HALF;
        if (rnd() > reedField(x, z) || !okAt(x, z, 6, true)) continue;
        const s = 0.7 + rnd() * 0.6, b = 0.6 + 0.5 * rnd();
        dummy.position.set(x, W.height(x, z), z); dummy.rotation.set((rnd() - 0.5) * 0.15, rnd() * 6.283, (rnd() - 0.5) * 0.15); dummy.scale.set(s, s * (0.8 + 0.4 * rnd()), s); dummy.updateMatrix();
        reedB.add(dummy.matrix, b, b * 0.97, b * 0.8); c++;
      }
      reedB.build();

      const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85 }, o || {}));
      const glowSprite = (color, s) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.soft(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })); sp.scale.setScalar(s); return sp; };
      const ground = p => W.height(p.x, p.z);
      // a CC0 model (js/props.js) added to g if it has loaded; null otherwise (the simple shape is kept)
      const model = (g, n, size, x, y, z, opt, ry) => { const o = DG.PROPS && DG.PROPS.get(n, size, opt); if (o) { o.position.set(x, y, z); o.rotation.y = ry || 0; g.add(o); } return o; };
      // camp: a tent, a crate and a dying fire
      {
        const c = W.SITES.camp, g = new THREE.Group(); g.position.set(c.x, ground(c), c.z);
        if (!model(g, 'tent', 2.0, -5, 0, -3, { fit: 'h' }, 0.6 + Math.PI / 2)) { // a ridge tent: a three-sided prism lying on one face, with its two ends open
          const tent = new THREE.Group(); tent.position.set(-5, 0.625, -3); tent.rotation.y = 0.6; g.add(tent);
          const roof = new THREE.CylinderGeometry(1.25, 1.25, 3.2, 3, 1, true).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2); // ridge along x, a flat face down
          tent.add(new THREE.Mesh(roof, mat(0x4d5a34, { side: THREE.DoubleSide, roughness: 0.95 })));
          const back = new THREE.CircleGeometry(1.25, 3).rotateZ(Math.PI / 2).rotateY(-Math.PI / 2).translate(-1.6, 0, 0);
          tent.add(new THREE.Mesh(back, mat(0x435030, { side: THREE.DoubleSide, roughness: 0.95 })));
        }
        const cr = model(g, 'crate', 0.9, 3.5, 0, -2.5, { fit: 'x' }, 0.3); // two military crates, one on the other
        if (cr) model(g, 'crate', 0.9, 3.55, cr.userData.size.y, -2.45, { fit: 'x' }, 0.5);
        else { const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.7), mat(0x5d4a2e)); crate.position.set(3.5, 0.35, -2.5); g.add(crate); }
        model(g, 'barrel', 0.9, 4.7, 0, -1.3, { fit: 'h' });
        if (model(g, 'bonfire', 1.5, 0, -0.1, 0)) for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 6), mat(0x2b2118)); l.rotation.set(Math.PI / 2 - 0.3, i * 2.1, 0); l.position.set(Math.sin(i * 2.1) * 0.15, 0.12, Math.cos(i * 2.1) * 0.15); g.add(l); }
        else for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.1, 6), mat(0x2b2118)); l.rotation.set(Math.PI / 2 - 0.35, i * Math.PI / 2, 0); l.position.set(Math.sin(i * Math.PI / 2) * 0.3, 0.2, Math.cos(i * Math.PI / 2) * 0.3); g.add(l); }
        const fire = new THREE.PointLight(0xff7a2e, 9, 16, 1.6); fire.position.set(0, 0.6, 0); g.add(fire);
        const ember = glowSprite(0xff6a20, 1.6); ember.position.y = 0.3; g.add(ember);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g); props.camp = g; props.fire = { light: fire, ember };
        colliders.push({ x: c.x - 5, z: c.z - 3, r: 1.7 }, { x: c.x + 3.5, z: c.z - 2.5, r: 0.6 }, { x: c.x + 4.7, z: c.z - 1.3, r: 0.45 });
      }
      // radio tower: a lattice mast with a red beacon on top (dark until it is repaired), the generator at its foot
      {
        const t = W.SITES.tower, g = new THREE.Group(), y0 = ground(t); g.position.set(t.x, y0, t.z);
        const steel = mat(0x3a3d3c, { roughness: 0.6, metalness: 0.6 }), H = 18;
        const leg = (ax, az) => {
          const a = new V(ax * 1.6, 0, az * 1.6), b = new V(ax * 0.35, H, az * 0.35), m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, a.distanceTo(b), 5), steel);
          m.position.copy(a).lerp(b, 0.5); m.quaternion.setFromUnitVectors(new V(0, 1, 0), b.clone().sub(a).normalize()); return m;
        };
        if (!model(g, 'radiotower', H + 0.17, 0, 0, 0, { fit: 'h' })) { // a lattice mast (the model, or these simple legs and braces)
          [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([x, z]) => g.add(leg(x, z)));
          for (let k = 1; k < 9; k++) { // braces
            const y = k * H / 9, w = 1.6 - (1.6 - 0.35) * (y / H);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 1.41, 0.03, 3, 4), steel); ring.rotation.set(Math.PI / 2, 0, Math.PI / 4); ring.position.y = y; g.add(ring);
          }
          const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.2, 0.25, 12), steel); dish.rotation.z = Math.PI / 2; dish.position.set(0.5, H - 3, 0); g.add(dish);
        }
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0x401010 })); bulb.position.y = H + 0.2; g.add(bulb);
        const beacon = new THREE.PointLight(0xff2010, 0, 60, 1.4); beacon.position.y = H + 0.2; g.add(beacon);
        const halo = glowSprite(0xff2a10, 4); halo.position.y = H + 0.2; halo.material.opacity = 0; g.add(halo);
        // generator and fuse box at the foot
        const gen = new THREE.Group(); gen.position.set(4.2, 0, 0);
        if (!model(gen, 'generator', 1.3, 0, 0, 0, { fit: 'x' })) { const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.0), mat(0x4b5634, { roughness: 0.7, metalness: 0.3 })); body.position.y = 0.55; gen.add(body); }
        // the fuse box, on a wooden post
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 2.1, 6), mat(0x3a2e20)); post.position.set(-2.6, 1.05, -1.97); gen.add(post);
        if (!model(gen, 'powerbox', 0.7, -2.6, 0.9, -1.6, { fit: 'h' })) { const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.25), mat(0x666a5c, { metalness: 0.4, roughness: 0.6 })); box.position.set(-2.6, 1.2, -1.6); gen.add(box); }
        const lampM = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a })); lampM.position.set(-2.6, 1.8, -1.6); gen.add(lampM);
        const lamp = new THREE.PointLight(0xffc27a, 5, 14, 1.6); lamp.position.set(-2.6, 1.9, -1.4); gen.add(lamp);
        g.add(gen);
        model(g, 'barrel', 0.9, 4.4, 0, 1.4, { fit: 'h' }); model(g, 'barrel', 0.9, 5.3, 0, 1.1, { fit: 'h' }, 1.2); // fuel drums by the generator
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g);
        props.tower = { group: g, beacon, halo, bulb, lamp, on: false, gen: new V(t.x + 4.2, y0, t.z), box: new V(t.x + 1.6, y0, t.z - 1.6) };
        [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([x, z]) => colliders.push({ x: t.x + x * 1.6, z: t.z + z * 1.6, r: 0.25 }));
        colliders.push({ x: t.x + 4.2, z: t.z, r: 0.9 }, { x: t.x + 4.85, z: t.z + 1.25, r: 0.9 });
      }
      // supply crates: a crate each with a lantern; some hold a fuse (game.js decides which)
      W.SITES.caches.forEach((c, i) => {
        const g = new THREE.Group(); g.position.set(c.x, ground(c), c.z); g.rotation.y = rnd() * 6.283;
        const cr = model(g, 'crate', 1.1, 0, 0, 0, { fit: 'x' }); // two military crates, one on the other
        if (cr) model(g, 'crate', 1.0, 0.05, cr.userData.size.y, 0.03, { fit: 'x' }, 0.12);
        else {
          const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 0.9), mat(0x5a4629)); crate.position.y = 0.42; g.add(crate);
          const lid = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.08, 0.96), mat(0x4a3820)); lid.position.set(0, 0.88, 0.1); lid.rotation.x = -0.35; g.add(lid);
        }
        // a lantern on a post beside them: the model hangs from an arm, with a small bright core for its flame
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 2.0, 5), mat(0x2b2118)); pole.position.set(0.9, 1.0, 0); g.add(pole);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4), mat(0x2b2118)); arm.rotation.z = Math.PI / 2; arm.position.set(1.08, 1.95, 0); g.add(arm);
        const lm = model(g, 'lantern', 0.45, 1.25, 1.48, 0, { fit: 'h' });
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(lm ? 0.05 : 0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffcf7a })); lantern.position.set(lm ? 1.25 : 0.9, lm ? 1.66 : 1.75, 0); g.add(lantern);
        const glow = glowSprite(0xffb050, 2.2); glow.position.copy(lantern.position); g.add(glow);
        g.traverse(o => { if (o.isMesh && o !== lantern) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g); props.caches.push({ group: g, glow, lantern, pos: c.clone().setY(ground(c)), ph: rnd() * 6 });
        colliders.push({ x: c.x, z: c.z, r: 0.75 });
      });
      // safe zones: a ring of lanterns on posts round a small clearing, a faint line of light on the ground between
      // them, and a warm light in the middle. They go dark when the way out is opened (world.setSafe(false)).
      W.SITES.safe.forEach(c => {
        const g = new THREE.Group(), y0 = ground(c); g.position.set(c.x, y0, c.z);
        const cores = [], glows = [], NP = 6, Rr = W.SAFE_R;
        for (let i = 0; i < NP; i++) {
          const a = (i + 0.5) / NP * 6.283, x = Math.sin(a) * Rr, z = Math.cos(a) * Rr, y = W.height(c.x + x, c.z + z) - y0;
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.9, 5), mat(0x2b2118)); pole.position.set(x, y + 0.95, z); g.add(pole);
          const lm = model(g, 'lantern', 0.4, x, y + 1.9, z, { fit: 'h' });
          const core = new THREE.Mesh(new THREE.SphereGeometry(lm ? 0.06 : 0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a })); core.position.set(x, y + (lm ? 2.08 : 2.0), z); g.add(core);
          const gl = glowSprite(0xffb860, 2.6); gl.position.copy(core.position); g.add(gl);
          cores.push(core); glows.push(gl);
          colliders.push({ x: c.x + x, z: c.z + z, r: 0.12 });
        }
        // the line on the ground, laid over the terrain
        const rg = new THREE.RingGeometry(Rr - 0.12, Rr + 0.12, 72, 1).rotateX(-Math.PI / 2), rp = rg.attributes.position;
        for (let i = 0; i < rp.count; i++) rp.setY(i, W.height(c.x + rp.getX(i), c.z + rp.getZ(i)) - y0 + 0.07);
        const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.4, depthWrite: false }));
        g.add(ring);
        const light = new THREE.PointLight(0xffc27a, 7, 22, 1.5); light.position.set(0, 3, 0); g.add(light);
        g.traverse(o => { if (o.isMesh && !cores.includes(o) && o !== ring) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g); props.safe.push({ group: g, cores, glows, ring, light, ph: rnd() * 6 });
      });
      // (trial 'shortcut') the drawbridges: planks on two stringers and posts, the middle span hinged at its near end
      // and standing raised (world.setBridge), a winch with a lantern on each bank, a rope from the near winch to the tip
      W.BRIDGES.forEach(b => {
        const g = new THREE.Group(); g.position.set(b.a.x, 0, b.a.z); g.rotation.y = Math.atan2(b.dx, b.dz); // local +z along it, +x to its side
        const wood = mat(0x7a5e3e, { roughness: 0.95 }), dark = mat(0x4a3826), HW = W.DECK_HW, y = b.y;
        const pg = new THREE.BoxGeometry(HW * 2, 0.07, 0.36);
        const planks = (parent, t0, t1, y0) => {
          const n = Math.max(1, Math.floor((t1 - t0) / 0.44)), im = new THREE.InstancedMesh(pg, wood, n), d = new THREE.Object3D();
          for (let i = 0; i < n; i++) { d.position.set((rnd() - 0.5) * 0.04, y0 - 0.035 + (rnd() - 0.5) * 0.02, t0 + 0.22 + i * (t1 - t0) / n); d.rotation.set(0, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.03); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
          im.castShadow = true; im.receiveShadow = true; parent.add(im);
          [-0.62, 0.62].forEach(x => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, t1 - t0), dark); s.position.set(x, y0 - 0.15, (t0 + t1) / 2); parent.add(s); });
        };
        const post = (t, x) => { const h = y - (W.WATER - 1.6), p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, h, 6), dark); p.position.set(x, y - 0.12 - h / 2, t); g.add(p); };
        planks(g, 0, b.g0, y); planks(g, b.g1, b.len, y);
        for (let t = 1.5; t < b.len - 1; t += 3) if (t < b.g0 - 0.3 || t > b.g1 + 0.3) { post(t, -0.75); post(t, 0.75); }
        [b.g0, b.g1].forEach(t => { post(t, -0.75); post(t, 0.75); }); // the gap's ends
        const hinge = new THREE.Group(); hinge.position.set(0, y, b.g0); g.add(hinge); planks(hinge, 0, b.g1 - b.g0, 0);
        // the winches
        const lamps = [];
        b.w.forEach((w, k) => {
          const wg = new THREE.Group(), gy = W.height(w.x, w.z); wg.position.set(w.x, gy, w.z); wg.rotation.y = g.rotation.y;
          [-0.32, 0.32].forEach(x => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), dark); p.position.set(x, 0.5, 0); wg.add(p); });
          const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.56, 10), wood); drum.rotation.z = Math.PI / 2; drum.position.y = 0.82; wg.add(drum);
          const crank = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.05), mat(0x8a8a86, { metalness: 0.6, roughness: 0.4 })); crank.position.set(0.4, 0.82, 0.12); wg.add(crank);
          const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.9, 5), dark); lp.position.set(-0.55, 0.95, 0); wg.add(lp);
          const lm = model(wg, 'lantern', 0.36, -0.55, 1.9, 0, { fit: 'h' });
          const core = new THREE.Mesh(new THREE.SphereGeometry(lm ? 0.05 : 0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a })); core.position.set(-0.55, lm ? 2.06 : 2.0, 0); wg.add(core);
          const gl = glowSprite(0xffb860, 2.2); gl.position.copy(core.position); wg.add(gl); lamps.push(gl);
          wg.traverse(o => { if (o.isMesh && o !== core) { o.castShadow = true; o.receiveShadow = true; } });
          scene.add(wg); colliders.push({ x: w.x, z: w.z, r: 0.35 });
          wg.userData.crank = crank;
          b['wg' + k] = wg;
        });
        const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V(), new V()]), new THREE.LineBasicMaterial({ color: 0xb8a882 }));
        rope.frustumCulled = false; scene.add(rope);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g); g.updateMatrixWorld(true);
        props.br.push({ b, g, hinge, rope, lamps, k: 0, kv: 0 });
      });
      // the way out (only the one this game uses is built); the red flare is lit when it is time to board
      const ES = W.SITES, l = ES.lz, face = Math.atan2(ES.out.x, ES.out.z);
      if (ES.esc === 0) { // landing zone: a ring of stakes round a flattened clearing
        const g = new THREE.Group(); g.position.set(l.x, ground(l), l.z);
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * 6.283, x = Math.sin(a) * 9, z = Math.cos(a) * 9, y = W.height(l.x + x, l.z + z) - g.position.y;
          const s = (DG.PROPS && DG.PROPS.get('stake', 1.3, { fit: 'h' })) || new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 5), mat(0x8a7a50));
          s.position.set(x, s.isMesh ? y + 0.5 : y - 0.15, z); s.rotation.set((rnd() - 0.5) * 0.12, a + rnd(), (rnd() - 0.5) * 0.2); g.add(s);
        }
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        scene.add(g); props.lz = g;
        props.esc = { kind: 0, act: ES.tower };
      } else if (ES.esc === 1) { // a jetty out over the pool, and an old motor boat tied to its end
        const g = new THREE.Group(); g.position.set(l.x, 0, l.z); g.rotation.y = face;
        const wood = mat(0x4a3a26), y0 = Math.max(ground(l), W.WATER) + 0.35;
        if (!model(g, 'dock', 6.4, 0, y0 - 3.6, 1.4, { fit: 'z' })) { // (the model's deck is 3.6 m above the foot of its piles)
          for (let i = 0; i < 9; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.5), wood); p.position.set(0, y0, -1 + i * 0.6); p.rotation.z = (rnd() - 0.5) * 0.04; g.add(p); }
          [[-1.1, 0], [1.1, 0], [-1.1, 4.2], [1.1, 4.2]].forEach(([x, z]) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 2.6, 6), wood); s.position.set(x, y0 - 0.9, z); g.add(s); });
        }
        const boat = new THREE.Group(); boat.position.set(0, W.WATER + 0.05, 11);
        if (!model(boat, 'skiff', 5.26, 0, -0.26, 0, { fit: 'z' }, Math.PI)) { // an aluminium skiff, its outboard at the stern (-z)
          const hull = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 5.2), mat(0x2f4a52, { roughness: 0.7 })); hull.position.y = 0.2; boat.add(hull);
          const bow = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.6, 4, 1), mat(0x2f4a52, { roughness: 0.7 })); bow.rotation.set(Math.PI / 2, Math.PI / 4, 0); bow.scale.set(1, 1, 0.45); bow.position.set(0, 0.2, 3.4); boat.add(bow);
          const motor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), mat(0x222222, { metalness: 0.4 })); motor.position.set(0, 0.7, -2.7); boat.add(motor);
        }
        g.add(boat);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g); props.lz = g; props.boat = boat;
        props.esc = { kind: 1, act: ES.lz.clone().addScaledVector(ES.out, 4) }; // the engine is started from the jetty's end
      } else { // a mine tunnel: a heap of rock with a timbered mouth, barred by a gate until it is forced open
        const g = new THREE.Group(); g.position.set(l.x, ground(l), l.z); g.rotation.y = face;
        // a heap of mossy boulders over the tunnel (+z, away from the swamp)
        if (!model(g, 'minerocks', 30, 0, -0.4, 11.4, { fit: 'x' })) {
          const rock = mat(0x3c3a36, { roughness: 0.95 });
          const heap = new THREE.Mesh(new THREE.DodecahedronGeometry(9, 1), rock); heap.scale.set(1.5, 0.95, 1.1); heap.position.set(0, 2, 10); g.add(heap);
          [[-7, 1, 6, 4], [7, 0.5, 7, 4.5], [0, 7, 9, 5]].forEach(([x, y, z, r]) => { const b = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rock); b.position.set(x, y, z); b.rotation.set(rnd() * 3, rnd() * 3, 0); g.add(b); });
        }
        const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole.position.set(0, 1.8, 0.8); hole.rotation.y = Math.PI; g.add(hole);
        // the timbered mouth (its frame 0.5 m in, rails running into the dark)
        if (!model(g, 'minemouth', 4.8, 0, 0, 1.6, { fit: 'x' }, Math.PI)) {
          const wood = mat(0x4a3a26);
          [[-2, 1.9], [2, 1.9]].forEach(([x, y]) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.8, 0.3), wood); p.position.set(x, y, 0.5); g.add(p); });
          const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.35, 0.35), wood); lintel.position.set(0, 3.8, 0.5); g.add(lintel);
        }
        // the iron gate, hinged on its left post (the group's origin), swinging open when forced
        const gate = new THREE.Group(); gate.position.set(-1.8, 0, 0.2);
        if (!model(gate, 'minegate', 3.57, 1.8, 0, 0, { fit: 'x' })) {
          for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.12), mat(0x55504a, { metalness: 0.6, roughness: 0.5 })); b.position.set(0.3 + i * 0.75, 1.65, 0); gate.add(b); }
          [0.7, 2.6].forEach(y => { const b = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 0.12), mat(0x55504a, { metalness: 0.6, roughness: 0.5 })); b.position.set(1.8, y, 0); gate.add(b); });
        }
        g.add(gate);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(g); props.lz = g; props.gate = gate;
        const back = l.clone().addScaledVector(ES.out, 11); colliders.push({ x: back.x, z: back.z, r: 9.5 });
        const side = new V(ES.out.z, 0, -ES.out.x); // the boulders' wide flanks
        [-1, 1].forEach(k => { const q = l.clone().addScaledVector(ES.out, 7).addScaledVector(side, k * 8.5); colliders.push({ x: q.x, z: q.z, r: 3.6 }); });
        props.esc = { kind: 2, act: ES.lz.clone().addScaledVector(ES.out, -1.5) }; // forced open from just in front of the gate
      }
    }

    // ---- drifting motes (dust, pollen, tiny insects) that catch the light: moving specks at different depths
    // are what make the space between the trunks read as air ----
    const soft = T.soft(), MOTES = 260, MBOX = 22;
    const moteGeo = new THREE.BufferGeometry(), mp = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) { mp[i * 3] = (rnd() * 2 - 1) * MBOX; mp[i * 3 + 1] = rnd() * 12; mp[i * 3 + 2] = (rnd() * 2 - 1) * MBOX; }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    // (at night in the swamp they are fireflies instead: larger, greenish, glowing and blinking)
    const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial(NIGHT
      ? { map: soft, size: 0.16, transparent: true, depthWrite: false, opacity: 0.8, color: 0xc6ff70, blending: THREE.AdditiveBlending, fog: false }
      : { map: soft, size: 0.075, transparent: true, depthWrite: false, opacity: 0.5, color: 0xfff2cf }));
    motes.frustumCulled = false; scene.add(motes);

    // ---- extraction beacon (red flare smoke) ----
    // (co-op: unlit until the helicopter is on its way, see setGoal)
    let goalOn = !W.COOP;
    const goalY = W.height(W.GOAL.x, W.GOAL.z);
    const flare = new THREE.PointLight(0xff3a1a, goalOn ? 30 : 0, 40, 1.6); flare.position.set(W.GOAL.x, goalY + 1, W.GOAL.z); scene.add(flare);
    const smokes = [];
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0xd8584a, transparent: true, depthWrite: false, opacity: 0.5 }));
      sp.userData.t = i / 40; scene.add(sp); smokes.push(sp);
    }
    const flareCore = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd0a0 }));
    flareCore.position.copy(flare.position).y -= 0.8; scene.add(flareCore);
    const showGoal = on => { goalOn = on; flareCore.visible = on; smokes.forEach(s => s.visible = on); if (!on) flare.intensity = 0; };
    showGoal(goalOn);

    // colliders in a coarse grid, so pushing something out of them only looks at the few nearby
    const CG = 8, cgrid = new Map(), ckey = (ix, iz) => (ix + 512) * 2048 + iz + 512;
    for (const c of colliders) { const k = ckey(Math.floor(c.x / CG), Math.floor(c.z / CG)); (cgrid.get(k) || cgrid.set(k, []).get(k)).push(c); }

    const owned = scene.children.filter(o => !before.has(o)); // everything this map put into the scene
    const extraTex = [cliffTex];                                 // textures that only a shader patch refers to
    const sun0 = sun.intensity, hemi0 = hemi.intensity;
    let flashK = 0;
    const world = {
      scene, sun, sunDir, colliders, terrain, chunks, seed: SEED, props, night: NIGHT,
      // co-op: light the landing-zone flare / the tower's beacon
      setGoal(on) { showGoal(!!on); },
      setTower(on) { if (props.tower) props.tower.on = !!on; },
      // the tunnel gate swings open (k 0..1)
      setGate(k) { if (props.gate) props.gate.rotation.y = k * 1.9; },
      // co-op: the safe zones' lanterns lit (they keep the stalkers out) or dark; left > 0: they go out in that many
      // seconds, blinking faster as it nears
      setSafe(on, left) { safeLit = !!on; safeEnd = on && left > 0 ? left : 0; },
      // (trial 'shortcut') a drawbridge's span wound down by k (0 raised .. 1 down)
      setBridge(i, k) { const p = props.br[i]; if (p) p.k = k; },
      // lightning: k (0..1) brightens the whole night for a moment
      flash(k) { flashK = Math.max(flashK, k); },
      // take this map out of the scene and free its GPU memory (geometry, materials, textures, environment map)
      dispose() {
        const geos = new Set(), mats = new Set(), texs = new Set(extraTex);
        for (const o of owned) {
          scene.remove(o);
          o.traverse(c => {
            if (c.geometry) geos.add(c.geometry);
            if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => mats.add(m));
            if (c.customDepthMaterial) mats.add(c.customDepthMaterial);
            if (c.isLight && c.dispose) c.dispose(); // frees the sun's shadow map
            if (c.isInstancedMesh) c.dispose();
          });
        }
        for (const m of mats) {
          for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); }
          if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k].value; if (v && v.isTexture) texs.add(v); }
        }
        geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); texs.forEach(t => t.dispose());
        if (envRT) { if (scene.environment === envRT.texture) scene.environment = null; envRT.dispose(); }
        scene.fog = null; scene.background = null;
      },
      update(dt, t, focus) {
        wind.value = t;
        if (NIGHT) {
          // lightning, the fire, the crates' lanterns and the tower's beacon
          flashK = Math.max(0, flashK - dt * 3.2);
          sun.intensity = sun0 + flashK * 3.5; hemi.intensity = hemi0 + flashK * 2.2;
          if (scene.fog) scene.fog.color.setRGB(0.17 + flashK * 0.28, 0.2 + flashK * 0.31, 0.25 + flashK * 0.35, THREE.SRGBColorSpace);
          if (props.fire) { const f = 0.75 + 0.25 * Math.sin(t * 17) * Math.sin(t * 7.3); props.fire.light.intensity = 9 * f; props.fire.ember.material.opacity = 0.6 + 0.3 * f; }
          props.caches.forEach(c => { const f = 0.7 + 0.3 * Math.sin(t * 9 + c.ph) * Math.sin(t * 3.1 + c.ph * 2); c.glow.material.opacity = (c.dim ? 0.15 : 0.75) * f; });
          const tw = props.tower;
          if (tw) {
            const on = tw.on ? (Math.sin(t * 3.5) > 0 ? 1 : 0.15) : 0;
            tw.beacon.intensity = 60 * on; tw.halo.material.opacity = 0.9 * on; tw.bulb.material.color.setHex(on > 0.5 ? 0xff4030 : 0x401010);
          }
          props.safe.forEach(z => { // the lanterns flicker; out, they fade to nothing over a second or two
            let f = 0.85 + 0.15 * Math.sin(t * 8 + z.ph) * Math.sin(t * 2.7 + z.ph * 2);
            if (safeEnd > 0) f *= Math.sin(t * Math.PI * (safeEnd > 5 ? 1.2 : safeEnd > 2 ? 2.4 : 4.8)) > -0.2 ? 1 : 0.12; // blinking
            z.k = Math.max(0, Math.min(1, (z.k == null ? 1 : z.k) + (safeLit ? dt : -dt * 0.7)));
            z.light.intensity = 7 * f * z.k; z.ring.material.opacity = 0.4 * z.k; z.ring.visible = z.k > 0.01;
            z.glows.forEach(g => g.material.opacity = 0.8 * f * z.k);
            z.cores.forEach(c => c.material.color.setRGB(0.25 + 0.75 * z.k, 0.18 + 0.64 * z.k, 0.1 + 0.44 * z.k));
          });
          motes.material.opacity = 0.55 + 0.35 * Math.sin(t * 2.3);
          if (props.boat) { props.boat.position.y = W.WATER + 0.05 + Math.sin(t * 1.3) * 0.05; props.boat.rotation.z = Math.sin(t * 0.9) * 0.03; }
          props.br.forEach(p => { // the drawbridges: the span follows the winding; the rope runs from the near winch to its tip
            const moving = Math.abs(p.k - p.kv) > 1e-3; p.kv += (p.k - p.kv) * Math.min(1, dt * 3);
            p.hinge.rotation.x = -(1 - p.kv) * 1.25;
            if (moving) [p.b.wg0, p.b.wg1].forEach(w => { if (w) w.userData.crank.rotation.x = p.kv * 40; });
            p.rope.visible = p.kv < 0.98;
            if (p.rope.visible) {
              const a = p.rope.geometry.attributes.position, w = p.b.wg0, tip = new V(0, 0.05, p.b.g1 - p.b.g0);
              p.hinge.localToWorld(tip); a.setXYZ(0, w.position.x, w.position.y + 0.85, w.position.z); a.setXYZ(1, tip.x, tip.y, tip.z); a.needsUpdate = true;
            }
            p.lamps.forEach((g, k) => g.material.opacity = 0.7 + 0.2 * Math.sin(t * 7 + k * 2 + p.b.i));
          });
        }
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
        if (!goalOn) return;
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
      // (the swamp: reed beds hide you as well as fern thickets)
      cover(x, z) { const f = fbm2(x / 35, z / 35, 203, 3); return reedField ? Math.max(f, 0.3 + 0.4 * reedField(x, z)) : f; }
    };
    return world;
  };
})();
