// Procedural noise helpers (value noise, fbm, periodic voronoi)
(function () {
  const DG = window.DG = window.DG || {};
  function hash2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function hash3(x, y, z, s) { return hash2(x + Math.imul(z | 0, 1013904223), y ^ Math.imul(z | 0, 2654435761), s); }
  const sm = t => t * t * (3 - 2 * t);
  const wrap = (a, p) => p ? ((a % p) + p) % p : a;
  function vnoise2(x, y, s, px, py) {
    const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), v = sm(y - yi);
    const x0 = wrap(xi, px), x1 = wrap(xi + 1, px), y0 = wrap(yi, py), y1 = wrap(yi + 1, py);
    const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm2(x, y, s, oct, px, py) {
    let t = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { t += a * vnoise2(x * f, y * f, s + i * 31, px ? px * f : 0, py ? py * f : 0); n += a; a *= 0.5; f *= 2; }
    return t / n;
  }
  function vnoise3(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    const h = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
    return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
             l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
  }
  function fbm3(x, y, z, s, oct) {
    let t = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { t += a * vnoise3(x * f, y * f, z * f, s + i * 31); n += a; a *= 0.5; f *= 2; }
    return t / n;
  }
  // periodic voronoi: returns {f1, f2, id}
  const vres = { f1: 0, f2: 0, id: 0 };
  function voronoi(x, y, px, py, s, jit) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j, wx = wrap(cx, px), wy = wrap(cy, py);
      const ox = hash2(wx, wy, s), oy = hash2(wx, wy, s + 7);
      const dx = cx + 0.5 + (ox - 0.5) * jit - x, dy = cy + 0.5 + (oy - 0.5) * jit - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, s + 13); } else if (d < f2) f2 = d;
    }
    vres.f1 = f1; vres.f2 = f2; vres.id = id; return vres;
  }
  // simple seeded RNG
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  DG.N = { hash2, hash3, vnoise2, fbm2, vnoise3, fbm3, voronoi, rng, smoothstep };
})();
