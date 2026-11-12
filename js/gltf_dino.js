// External glTF dinosaur: same interface as DG.Dino, driven by the model's own animation clips
(function () {
  const DG = window.DG, V = THREE.Vector3;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
  const tq1 = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), qy = new THREE.Quaternion(), tv = new V(), UP = new V(0, 1, 0);
  const KEYS = { idle: /idle|wait|stand|breath|look/i, walk: /walk/i, run: /run|sprint|gallop|charge|jog/i, roar: /roar|call|scream|growl|howl/i, bite: /bite|attack|snap/i };

  // three.js dropped KHR_materials_pbrSpecularGlossiness; map it onto MeshStandardMaterial:
  // diffuse -> map, glossiness (alpha of the spec/gloss texture) -> roughness via a small shader patch.
  const SG = 'KHR_materials_pbrSpecularGlossiness';
  class SpecGlossPlugin {
    constructor(parser) { this.parser = parser; this.name = SG; }
    extendMaterialParams(index, params) {
      const def = this.parser.json.materials[index], ext = def.extensions && def.extensions[SG];
      if (!ext) return Promise.resolve();
      params.metalness = 0; params.roughness = 1;
      if (ext.diffuseFactor) { params.color.setRGB(ext.diffuseFactor[0], ext.diffuseFactor[1], ext.diffuseFactor[2]); params.opacity = ext.diffuseFactor[3]; }
      const p = [];
      if (ext.diffuseTexture) p.push(this.parser.assignTexture(params, 'map', ext.diffuseTexture, THREE.SRGBColorSpace));
      if (ext.specularGlossinessTexture) p.push(this.parser.assignTexture(params, 'roughnessMap', ext.specularGlossinessTexture).then(() => {
        params.roughnessMap.userData.gloss = ext.glossinessFactor != null ? ext.glossinessFactor : 1;
      }));
      return Promise.all(p);
    }
  }
  function patchGloss(m) {
    const g = m.roughnessMap && m.roughnessMap.userData.gloss;
    if (g == null || m.userData.glossPatched) return;
    m.userData.glossPatched = true;
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         #ifdef USE_ROUGHNESSMAP
           roughnessFactor = clamp(1.0 - texture2D(roughnessMap, vRoughnessMapUv).a * ${g.toFixed(3)}, 0.25, 1.0);
         #endif`);
    };
    m.needsUpdate = true;
  }

  const cache = {};
  DG.loadGLB = function (url) {
    if (!cache[url]) cache[url] = new Promise(res => {
      if (location.protocol === 'file:') { res(null); return; }
      try {
        const l = new THREE_GLTFLoader(); l.register(p => new SpecGlossPlugin(p));
        l.load(url, g => res(g), undefined, e => { console.warn('model load failed:', url, e && e.message); res(null); });
      } catch (e) { res(null); }
    });
    return cache[url];
  };

  class GltfDino {
    constructor(spec, gltf) {
      const cfg = spec.model;
      this.spec = spec; this.gait = spec.gait; this.isModel = true;
      this.t = 0; this.phase = 0; this.speed = 0; this.turn = 0; this.look = null; this.lunge = 0; this.jawT = 0; this.roarT = 0; this.ground = () => 0;
      this.lookYaw = 0; this.biting = false; this.os = null;
      const scene = THREE_SkeletonUtils.clone(gltf.scene);
      const root = this.root = new THREE.Group(), inner = this.inner = new THREE.Group();
      root.add(inner); inner.add(scene);
      scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (!m) return; if (m.map) m.map.anisotropy = 8; m.envMapIntensity = 0.6; patchGloss(m); });
      });
      const bones = []; scene.traverse(o => { if (o.isBone) bones.push(o); });
      const find = re => bones.find(b => re.test(b.name));
      this.head = find(/head/i) || find(/skull/i) || null;
      this.neck = find(/neck/i) || null;

      // --- orientation and scale: head should point +Z, length should match the species ---
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new V()), cen = box.getCenter(new V());
      const alongX = size.x > size.z;
      let yaw = cfg.yaw;
      if (yaw == null) {
        let sign = 1;
        if (this.head) { const hp = this.head.getWorldPosition(new V()); sign = Math.sign((alongX ? hp.x - cen.x : hp.z - cen.z)) || 1; }
        yaw = alongX ? (sign > 0 ? -Math.PI / 2 : Math.PI / 2) : (sign > 0 ? 0 : Math.PI);
      }
      const len = spec.body[spec.body.length - 1].z - spec.body[0].z;
      const s = len * (cfg.lengthScale || 1) / (alongX ? size.x : size.z);
      scene.position.set(-cen.x, -box.min.y, -cen.z);
      inner.scale.setScalar(s); inner.rotation.y = yaw;
      this.len = len; this.height = size.y * s;

      // --- animation clips ---
      this.mixer = new THREE.AnimationMixer(scene);
      const clips = gltf.animations || [], named = cfg.clips || {};
      const pick = k => (named[k] && clips.find(c => c.name === named[k])) || clips.find(c => KEYS[k].test(c.name));
      const C = {}; Object.keys(KEYS).forEach(k => C[k] = pick(k));
      const plain = clips.find(c => !Object.values(KEYS).some(re => re.test(c.name)));
      C.walk = C.walk || C.run || plain || clips[0]; C.run = C.run || C.walk;
      if (!C.roar) C.roar = C.bite; if (!C.bite) C.bite = C.roar;
      this.C = C; this.A = {};
      const loco = ['idle', 'walk', 'run'].filter(k => C[k]);
      const seen = new Map();
      loco.forEach(k => {
        if (seen.has(C[k])) { this.A[k] = seen.get(C[k]); return; }
        const a = this.mixer.clipAction(C[k]); a.play(); a.setEffectiveWeight(0); this.A[k] = a; seen.set(C[k], a);
      });
      this.walkRef = cfg.walkSpeed || spec.gait.walk; this.runRef = cfg.runSpeed || spec.ai.run * 0.85;
      // with only a run cycle, moving slower than this makes the feet visibly slide
      this.minSpeed = this.A.walk === this.A.run ? this.runRef * 0.3 : 0;
      this.mixer.update(Math.random() * 2);
    }

    // seconds the roar animation takes (used by the AI to stand still while roaring)
    get roarDuration() { const r = this.range('roar'); return r ? r[1] - r[0] : 0; }
    range(k) {
      const clip = this.C[k]; if (!clip) return null;
      const rg = (this.spec.model.ranges || {})[k];
      return rg ? [rg[0], Math.min(rg[1], clip.duration)] : [0, clip.duration];
    }
    roar(dur) { this.roarT = dur || 2.2; this.oneShot('roar'); }
    oneShot(k) {
      const clip = this.C[k]; if (!clip || this.A.walk && this.A.walk.getClip() === clip) return;
      if (this.os) this.os.a.stop();
      const r = this.range(k), a = this.mixer.clipAction(clip);
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.time = r[0]; a.play();
      this.os = { a, t: 0, dur: r[1] - r[0], k };
    }
    // true while the roar animation has taken over the body: the legs are planted, so the AI must not move it
    get roaring() { return !!(this.os && this.os.k === 'roar'); }
    headPos(out) {
      out = out || new V();
      if (this.head) return this.head.getWorldPosition(out);
      return out.set(0, this.height * 0.8, this.len * 0.4).applyMatrix4(this.root.matrixWorld);
    }
    // snout tip: the model is centred with its head toward +Z, so the snout is near z = +len/2
    mouthPos(out) {
      out = this.headPos(out); this.root.updateMatrixWorld(true); this.root.worldToLocal(out);
      out.set(out.x, out.y - this.height * 0.04, Math.max(out.z + this.len * 0.04, this.len * 0.46));
      return this.root.localToWorld(out);
    }

    update(dt, speed, turn) {
      this.t += dt;
      this.speed = lerp(this.speed, speed, 1 - Math.exp(-dt * 6)); this.turn = lerp(this.turn, turn, 1 - Math.exp(-dt * 4));
      if (this.roarT > 0) this.roarT -= dt;
      if (this.lunge > 0.05 && !this.biting) { this.biting = true; this.oneShot('bite'); }
      if (this.lunge <= 0.01) this.biting = false;
      // one-shot envelope (roar / bite) takes over from locomotion
      let ow = 0;
      if (this.os) {
        const o = this.os; o.t += dt;
        ow = clamp(Math.min(o.t / 0.2, (o.dur - o.t) / 0.3), 0, 1);
        o.a.setEffectiveWeight(ow);
        if (o.t >= o.dur) { o.a.stop(); this.os = null; ow = 0; }
      }
      const sp = this.speed, A = this.A;
      const wMove = A.idle ? clamp(sp / 0.6, 0, 1) : 1;
      const r = clamp((sp - this.walkRef) / (this.runRef - this.walkRef), 0, 1);
      const w = { idle: A.idle ? 1 - wMove : 0, walk: wMove * (1 - r), run: wMove * r };
      const acc = new Map();
      for (const k of ['idle', 'walk', 'run']) { const a = A[k]; if (!a) continue; acc.set(a, (acc.get(a) || 0) + w[k]); }
      acc.forEach((wt, a) => a.setEffectiveWeight(wt * (1 - ow)));
      if (A.walk) A.walk.timeScale = sp < 0.05 && !A.idle ? 0 : Math.max(0.35, sp / this.walkRef);
      if (A.run && A.run !== A.walk) A.run.timeScale = Math.max(0.5, sp / this.runRef);
      // only a run cycle available: play it slowed down in proportion to the real speed
      if (A.run === A.walk && A.walk) A.walk.timeScale = sp < 0.05 && !A.idle ? 0 : clamp(sp / this.runRef, 0.3, 1.6);
      this.mixer.update(dt);
      // footstep phase from the dominant locomotion clip
      const dom = r > 0.5 && A.run ? A.run : A.walk;
      if (dom) this.phase = (dom.time / dom.getClip().duration) % 1;
      // head turns toward the target (world-space yaw on neck/head bone)
      const bone = this.neck || this.head;
      let ty = 0;
      if (this.look && bone) {
        this.root.updateMatrixWorld(true);
        tv.copy(this.look); this.root.worldToLocal(tv);
        ty = clamp(Math.atan2(tv.x, tv.z - this.len * 0.3), -0.8, 0.8) * (1 - ow);
      }
      this.lookYaw = lerp(this.lookYaw, ty, 1 - Math.exp(-dt * 3));
      if (bone && Math.abs(this.lookYaw) > 0.002) {
        this.root.updateMatrixWorld(true);
        bone.parent.getWorldQuaternion(tq1); bone.getWorldQuaternion(tq2);
        qy.setFromAxisAngle(UP, this.lookYaw); tq2.premultiply(qy);
        bone.quaternion.copy(tq1.invert().multiply(tq2));
      }
    }
  }
  DG.GltfDino = GltfDino;
})();
