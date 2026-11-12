// Procedural locomotion: gait cycle, leg IK, spine/tail/neck motion, jaw, look-at
(function () {
  const DG = window.DG, G = DG.G, V = THREE.Vector3;
  const TAU = Math.PI * 2, clamp = (x, a, b) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
  const tmp = new V(), tmp2 = new V();

  class Dino {
    constructor(spec, tex) {
      this.spec = spec; this.d = G.createDino(spec, tex); this.root = this.d.root;
      this.gait = spec.gait; this.phase = Math.random(); this.t = Math.random() * 100;
      this.speed = 0; this.turn = 0; this.jaw = 0; this.jawT = spec.jawIdle != null ? spec.jawIdle : 0.05; this.look = null; this.lookYaw = 0; this.lookPitch = 0;
      this.roarT = 0; this.lunge = 0; this.ground = () => 0;
      this.pelvisRest = this.d.pelvis.position.clone();
      this.neck = this.d.spine.slice(-(spec.neckBones || 3));
      this.idleLook = 0; this.idleTimer = 2;
    }
    roar(dur) { this.roarT = dur || 2.2; }
    get roaring() { return this.roarT > 0; }
    // world position of head (for camera / attacks)
    headPos(out) { return this.d.head.getWorldPosition(out || new V()); }
    mouthPos(out) { out = out || new V(); this.d.jaw.getWorldPosition(out); tmp.set(0, 0, this.spec.mouth.z1 - this.spec.mouth.z0).applyQuaternion(this.d.head.getWorldQuaternion(new THREE.Quaternion())); return out.add(tmp.multiplyScalar(0.6)); }

    update(dt, speed, turn) {
      const d = this.d, g = this.gait, s = this.spec;
      this.t += dt; this.speed = lerp(this.speed, speed, 1 - Math.exp(-dt * 6)); this.turn = lerp(this.turn, turn, 1 - Math.exp(-dt * 4));
      const sp = this.speed, run = clamp((sp - g.walk) / (g.run - g.walk), 0, 1), move = clamp(sp / 0.6, 0, 1);
      const L = Math.min(g.maxStride, g.stride + g.strideK * sp), freq = sp > 0.01 ? sp / L : 0;
      this.phase = (this.phase + freq * dt) % 1;
      const ph = this.phase, quad = !!g.quad;

      // ---- body ----
      const roar = clamp(this.roarT > 0 ? Math.min(this.roarT, 2.2 - this.roarT + 0.4) * 2 : 0, 0, 1);
      if (this.roarT > 0) this.roarT -= dt;
      const breathe = Math.sin(this.t * (g.breath || 1.4));
      const bob = -g.bob * move * (0.6 + 0.4 * run) * Math.cos(TAU * 2 * (ph + 0.08)) * (quad ? 0.5 : 1);
      d.pelvis.position.copy(this.pelvisRest);
      d.pelvis.position.y += bob + breathe * 0.008 - this.lunge * (g.lungeDrop || 0.3);
      d.pelvis.position.z += this.lunge * (g.lungeFwd || 1.2);
      d.pelvis.rotation.x = (g.lean || 0.05) * run + this.lunge * 0.15 - roar * 0.12;
      d.pelvis.rotation.z = (g.roll || 0.03) * Math.sin(TAU * ph) * move;
      d.pelvis.rotation.y = (g.sway || 0.04) * Math.sin(TAU * ph) * move;
      const bend = clamp(this.turn * 0.22, -0.35, 0.35);
      const body = d.spine.slice(0, d.spine.length - this.neck.length);
      body.forEach((b, i) => { b.rotation.y = bend / body.length - d.pelvis.rotation.y * (i === 0 ? 0.6 : 0); b.rotation.x = 0; b.rotation.z = -d.pelvis.rotation.z * (i === 0 ? 0.5 : 0); });
      if (body.length > 1) {
        const bs = 1 + breathe * 0.018 * (1 - run * 0.5) + run * 0.01 * Math.sin(this.t * 9);
        body[0].scale.set(bs, bs, 1); body[1].scale.set(1 / bs, 1 / bs, 1);
      }
      // tail: travelling wave + counter-turn + idle drift
      d.tail.forEach((b, i) => {
        const k = (i + 1) / d.tail.length;
        b.rotation.y = -bend * 0.55 + (g.tailSway || 0.06) * move * Math.sin(TAU * ph - i * 0.45) + 0.035 * Math.sin(this.t * 0.6 - i * 0.35) * (1 - move * 0.5);
        b.rotation.x = -(g.tailLift || 0) * run / d.tail.length + 0.025 * Math.sin(this.t * 0.45 - i * 0.3) * k + bob * 0.05 - roar * 0.04;
      });

      // ---- neck / head look ----
      d.root.updateMatrixWorld(true);
      let ty = 0, tp = 0;
      this.idleTimer -= dt;
      if (this.idleTimer < 0) { this.idleTimer = 2 + Math.random() * 4; this.idleLook = (Math.random() - 0.5) * 1.2; }
      if (this.look) {
        d.head.getWorldPosition(tmp); tmp2.copy(this.look); d.root.worldToLocal(tmp2); d.root.worldToLocal(tmp);
        ty = clamp(Math.atan2(tmp2.x - tmp.x, tmp2.z - tmp.z), -1.1, 1.1);
        tp = clamp(Math.atan2(tmp2.y - tmp.y, Math.hypot(tmp2.x - tmp.x, tmp2.z - tmp.z)), -0.6, 0.5);
      } else { ty = this.idleLook * (1 - move); tp = -0.08 * (1 - move); }
      tp += roar * 0.45 - this.lunge * 0.35;
      this.lookYaw = lerp(this.lookYaw, ty, 1 - Math.exp(-dt * 3)); this.lookPitch = lerp(this.lookPitch, tp, 1 - Math.exp(-dt * 3));
      const nn = this.neck.length, pc = d.pelvis.rotation.x;
      this.neck.forEach((b, i) => {
        b.rotation.y = this.lookYaw / nn + bend * 0.3 / nn;
        b.rotation.x = (-this.lookPitch - pc - bob * 0.08 + (g.neckBob || 0.03) * move * Math.cos(TAU * 2 * ph)) / nn;
        b.rotation.z = roar * 0.04 * Math.sin(this.t * 30) / nn;
      });
      // jaw
      const jt = Math.max(this.jawT + (s.jawIdle === 0 ? 0 : 0.03 * (breathe * 0.5 + 0.5)), roar * 1.0, this.lunge);
      this.jaw = lerp(this.jaw, jt, 1 - Math.exp(-dt * (jt > this.jaw ? 10 : 4)));
      d.jaw.rotation.x = this.jaw * (s.jawMax || 0.6);

      // ---- limbs ----
      d.root.updateMatrixWorld(true);
      const duty = lerp(g.duty || 0.62, g.dutyRun || 0.4, run);
      d.limbs.forEach(l => {
        const lp = (ph + l.phase) % 1;
        if (l.arm) {
          l.bones[0].rotation.x = -0.08 * Math.sin(TAU * lp) * move + 0.05 * Math.sin(this.t * 0.8) + roar * 0.3;
          l.bones[1].rotation.x = -0.1 * Math.sin(TAU * lp + 0.6) * move - roar * 0.25;
          if (l.bones[2]) l.bones[2].rotation.x = 0.05 * Math.sin(this.t * 1.1);
          return;
        }
        // foot target in root-local space
        let dz, lift = 0, st;
        if (lp < duty) { st = lp / duty; dz = L * (0.5 - st); }
        else { const q = (lp - duty) / (1 - duty), qs = q * q * (3 - 2 * q); st = -1; dz = L * (-0.5 + qs); lift = g.lift * (0.6 + 0.4 * run) * Math.sin(Math.PI * q); }
        const n = l.lens.length, ball = l.J[n];
        const fz = ball.z + dz * move, fx = ball.x;
        tmp.set(fx, 0, fz); d.root.localToWorld(tmp);
        const gy = this.ground(tmp.x, tmp.z) - d.root.position.y;
        const by = gy + (ball.y) + lift * move;
        const swing = st < 0 ? Math.sin(Math.PI * (lp - duty) / (1 - duty)) * move : 0;
        const mRest = l.rest[n - 1];
        const phiM = st >= 0 ? mRest + (g.metaRoll || 0.35) * (st - 0.35) * move : mRest - (g.metaFold || 0.6) * swing;
        const ml = l.lens[n - 1];
        const Ay = by + ml * Math.cos(phiM), Az = fz - ml * Math.sin(phiM);
        l.bones[0].getWorldPosition(tmp); d.root.worldToLocal(tmp);
        const Hy = tmp.y, Hz = tmp.z, L1 = l.lens[0], L2 = l.lens[1];
        let dy = Ay - Hy, dzz = Az - Hz, dist = Math.hypot(dy, dzz);
        const maxD = (L1 + L2) * 0.995, minD = Math.abs(L1 - L2) + 0.05;
        const dc = clamp(dist, minD, maxD);
        const alpha = Math.atan2(dzz, -dy), beta = Math.acos(clamp((L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), -1, 1));
        const p1 = l.front ? alpha - beta : alpha + beta;
        const Ky = Hy - Math.cos(p1) * L1, Kz = Hz + Math.sin(p1) * L1;
        // if out of reach, aim shin at target anyway
        const p2 = Math.atan2(Az - Kz, -(Ay - Ky));
        const toe = Math.PI / 2 - (g.toeDroop || 0.8) * swing - (st > 0.75 ? 0 : 0);
        const targets = [p1, p2, phiM, toe];
        let p = d.pelvis.rotation.x;
        if (l.parentBone !== d.pelvis) { for (const b of d.spine) { p += b.rotation.x; if (b === l.parentBone) break; } }
        let prevR = p;
        for (let i = 0; i < l.bones.length && i < targets.length; i++) {
          const R = l.rest[i] - targets[i];
          l.bones[i].rotation.x = i === 0 ? R - p : R - prevR;
          prevR = R;
        }
      });
    }
  }
  DG.Dino = Dino;
})();
