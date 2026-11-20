// The co-op minimap: the swamp round you (MM.R metres), turned the way you look, with your team and the mission
// things within that distance. The whole swamp is painted once per night (MM.build: water by depth with a pale
// shoreline, mud and moss, forest darker the denser it is, light from the north-west on the slopes, every trunk and
// rock a dot); each frame MM.draw puts the part round you into a round frame.
(function () {
  const MM = DG.MINIMAP = { R: 60 };
  let map = null, X0 = 0, Z0 = 0, SPAN = 0;
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  MM.build = function (W) {
    // the ground sampled every GR m, painted every RES m (heights interpolated in between: smooth shorelines)
    const GR = 1.5, RES = 0.75, B = W.LIMIT + 50, G = Math.round(2 * B / GR) + 2, N = Math.round(2 * B / RES);
    X0 = -B; Z0 = -B; SPAN = N * RES;
    const GH = new Float32Array(G * G), GC = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = X0 + i * GR, z = Z0 + j * GR;
      GH[j * G + i] = W.height(x, z); GC[j * G + i] = W.canopy ? W.canopy(x, z) : 0;
    }
    const lerp2 = (A, x, z) => { // bilinear, x/z in grid units
      const i = Math.min(G - 2, x | 0), j = Math.min(G - 2, z | 0), u = x - i, v = z - j, k = j * G + i;
      return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + G] * (1 - u) + A[k + G + 1] * u) * v;
    };
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), im = g.createImageData(N, N), d = im.data;
    const LX = -0.55, LY = 0.62, LZ = -0.55, WL = W.WATER, q = RES / GR;
    let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const gx = (i + 0.5) * q, gz = (j + 0.5) * q, h = lerp2(GH, gx, gz), cn = lerp2(GC, gx, gz), dep = WL - h;
      let r, gg, b;
      if (dep > 0) {
        const t = ss(0, 1.3, dep); r = 58 + (14 - 58) * t; gg = 92 + (32 - 92) * t; b = 94 + (40 - 94) * t;
        if (dep < 0.1) { const s = dep / 0.1; r = 108 + (r - 108) * s; gg = 140 + (gg - 140) * s; b = 128 + (b - 128) * s; } // the shoreline
      } else {
        const hx = (lerp2(GH, gx + 1, gz) - lerp2(GH, gx - 1, gz)) / (2 * GR) * 3, hz = (lerp2(GH, gx, gz + 1) - lerp2(GH, gx, gz - 1)) / (2 * GR) * 3;
        const lit = (-hx * LX + LY - hz * LZ) / Math.sqrt(hx * hx + 1 + hz * hz);            // lambert from the north-west
        let t = ss(0.3, 0.7, cn * 0.6 + rnd() * 0.15 + 0.2);                                 // mud .. moss
        r = 86 + (66 - 86) * t; gg = 78 + (80 - 78) * t; b = 56 + (46 - 56) * t;
        t = ss(0.15, 0.95, cn); r += (32 - r) * t; gg += (46 - gg) * t; b += (28 - b) * t;  // forest
        t = ss(3, 30, h); r += (104 - r) * t; gg += (98 - gg) * t; b += (84 - b) * t;       // hills and rock at the edge
        if (-dep < 0.12) { const s = -dep / 0.12; r = 84 + (r - 84) * s; gg = 92 + (gg - 92) * s; b = 70 + (b - 70) * s; } // wet margin
        const sh = 0.72 + 0.5 * Math.max(-0.3, lit - 0.62); r *= sh; gg *= sh; b *= sh;
      }
      const n = (rnd() - 0.5) * 7, k = (j * N + i) * 4;
      d[k] = r + n; d[k + 1] = gg + n; d[k + 2] = b + n; d[k + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    if (DG.PICTO && DG.PICTO.names) DG.PICTO.names.forEach(n => { pic(n); pic(n, '#ff6a48'); }); // (decoded before they are needed)
    // trunks and rocks
    g.fillStyle = 'rgba(12,16,10,0.85)';
    g.beginPath();
    for (const o of W.colliders || []) {
      if (o.r < 0.15 || o.r > 4) continue;
      const x = (o.x - X0) / RES, z = (o.z - Z0) / RES, r = Math.max(0.9, o.r * 1.3 / RES);
      g.moveTo(x + r, z); g.arc(x, z, r, 0, Math.PI * 2);
    }
    g.fill();
    map = cv; return cv;
  };

  // pictograms as images, made once each (js/pictos.js)
  const pics = {};
  function pic(name, ring) {
    const key = name + '|' + (ring || ''); if (pics[key]) return pics[key];
    const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(DG.PICTO.svg(name, { size: 48, ring })); pics[key] = im; return im;
  }

  // view: { x, z, yaw } (yaw as the camera's: it looks down -Z at 0); marks: [{ x, z, kind: 'pic' | 'mate' | 'ghost' |
  // 'ping', name, ring, color, yaw }]
  MM.draw = function (cv, view, marks) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), css = cv.clientWidth || 180, px = Math.round(css * dpr);
    if (cv.width !== px) { cv.width = cv.height = px; }
    const g = cv.getContext('2d'), c = px / 2, rad = c - 3 * dpr, s = rad / MM.R, cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    const at = (x, z) => { const dx = x - view.x, dz = z - view.z; return [c + s * (dx * cy - dz * sy), c + s * (dx * sy + dz * cy), Math.hypot(dx, dz)]; };
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, px, px);
    g.save(); g.beginPath(); g.arc(c, c, rad, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#0d0b08'; g.fillRect(0, 0, px, px);
    if (map) {
      g.setTransform(s * cy, s * sy, -s * sy, s * cy, c, c);
      g.imageSmoothingEnabled = true; g.drawImage(map, X0 - view.x, Z0 - view.z, SPAN, SPAN);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    // night: darker toward the rim; a ring at half the distance
    const vg = g.createRadialGradient(c, c, rad * 0.45, c, c, rad); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, px, px);
    g.strokeStyle = 'rgba(255,226,160,0.18)'; g.lineWidth = dpr; g.setLineDash([3 * dpr, 4 * dpr]);
    g.beginPath(); g.arc(c, c, rad / 2, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    // things on the map: mission pictograms first, then signals, then the team
    const order = { pic: 0, ping: 1, ghost: 2, mate: 3 };
    marks.slice().sort((a, b) => order[a.kind] - order[b.kind]).forEach(m => {
      const [x, y, dist] = at(m.x, m.z); if (dist > MM.R) return;
      if (m.kind === 'pic') { const q = 20 * dpr; g.drawImage(pic(m.name, m.ring), x - q / 2, y - q / 2, q, q); return; }
      if (m.kind === 'ping') {
        const q = 6 * dpr; g.fillStyle = m.color; g.strokeStyle = '#000'; g.lineWidth = dpr;
        g.beginPath(); g.moveTo(x, y - q); g.lineTo(x + q * 0.7, y); g.lineTo(x, y + q); g.lineTo(x - q * 0.7, y); g.closePath(); g.fill(); g.stroke(); return;
      }
      if (m.kind === 'ghost') {
        g.globalAlpha = 0.6; g.strokeStyle = m.color; g.lineWidth = 1.6 * dpr; g.setLineDash([2 * dpr, 2 * dpr]);
        g.beginPath(); g.arc(x, y, 5 * dpr, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; return;
      }
      arrow(g, x, y, m.yaw - view.yaw, 7 * dpr, m.color, dpr);
    });
    g.restore();
    // you, in the middle, looking up the map
    arrow(g, c, c, 0, 8 * dpr, '#fff4d6', dpr);
    // the rim and north
    g.strokeStyle = '#c9a24a'; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(c, c, rad, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = dpr; g.beginPath(); g.arc(c, c, rad + 1.5 * dpr, 0, Math.PI * 2); g.stroke();
    const nx = c + (rad - 1 * dpr) * sy, ny = c - (rad - 1 * dpr) * cy;
    g.fillStyle = '#1a1510'; g.beginPath(); g.arc(nx, ny, 7 * dpr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c9a24a'; g.lineWidth = dpr; g.stroke();
    g.fillStyle = '#ff6a48'; g.font = `bold ${9 * dpr}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny + 0.5 * dpr);
    g.fillStyle = 'rgba(255,226,160,0.7)'; g.font = `${8 * dpr}px sans-serif`; g.fillText(MM.R + 'm', c, px - 9 * dpr);
  };
  // an arrowhead at (x, y), turned by `a` (0 = up the map), in `color` with a dark edge
  function arrow(g, x, y, a, r, color, dpr) {
    g.save(); g.translate(x, y); g.rotate(-a);
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.72, r * 0.8); g.lineTo(0, r * 0.38); g.lineTo(-r * 0.72, r * 0.8); g.closePath();
    g.fillStyle = color; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 1.3 * dpr; g.stroke(); g.restore();
  }
})();
