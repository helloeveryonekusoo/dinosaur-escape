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

  // Procedural reptile hide for a model that came without textures (cfg.hide). Everything is computed in the
  // fragment shader from the bind-pose position, so the pattern is seamless and stays glued to the skin when
  // the animal moves: colour zones (dark back, paler flank and belly, cross bands, blotches), two sizes of
  // scales from 3D cell noise with dirt in the creases, matching roughness, and a bump from the same height.
  // An optional per-vertex `_mouth` attribute (0..1) marks the inside of the mouth, which is drawn as wet flesh.
  function patchHide(m, hd) {
    if (m.userData.hidePatched) return;
    m.userData.hidePatched = true;
    const c = h => { const k = new THREE.Color(h); return `vec3(${k.r.toFixed(4)},${k.g.toFixed(4)},${k.b.toFixed(4)})`; };
    const f = (v, d) => (v == null ? d : v).toFixed(4);
    m.vertexColors = false; m.color.set(0xffffff); m.metalness = 0;
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float _mouth;\nvarying vec3 vRepPos;\nvarying vec3 vRepNrm;\nvarying float vRepMouth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRepPos = position; vRepNrm = normal; vRepMouth = _mouth;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vRepPos; varying vec3 vRepNrm; varying float vRepMouth;
          vec3 repHash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453); }
          float repHash1(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
          float repNoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
            return mix(mix(mix(repHash1(i),repHash1(i+vec3(1,0,0)),f.x), mix(repHash1(i+vec3(0,1,0)),repHash1(i+vec3(1,1,0)),f.x), f.y),
                       mix(mix(repHash1(i+vec3(0,0,1)),repHash1(i+vec3(1,0,1)),f.x), mix(repHash1(i+vec3(0,1,1)),repHash1(i+vec3(1,1,1)),f.x), f.y), f.z); }
          // distance to the nearest and second nearest cell centre, and a random id of the nearest cell
          vec3 repCells(vec3 x){ vec3 p=floor(x), f=fract(x); float d1=8.0, d2=8.0, id=0.0;
            for(int k=-1;k<=1;k++) for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec3 g=vec3(float(i),float(j),float(k)); vec3 o=repHash3(p+g); vec3 r=g+0.25+0.5*o-f; float d=dot(r,r); if(d<d1){ d2=d1; d1=d; id=o.z; } else if(d<d2){ d2=d; } }
            return vec3(sqrt(d1), sqrt(d2), id); }
          // tilt the normal by the surface gradient of a height field h (amp = relief in metres)
          vec3 repBump(vec3 N, vec3 sp, float h, float amp){ vec3 dpx=dFdx(sp), dpy=dFdy(sp); float hx=dFdx(h), hy=dFdy(h); vec3 r1=cross(dpy,N), r2=cross(N,dpx); float det=dot(dpx,r1);
            vec3 g=(hx*r1+hy*r2)*sign(det)/max(abs(det),1e-8); return normalize(N - amp*g); }`)
        .replace('#include <color_fragment>', `
          vec3 rp = vRepPos; float rny = normalize(vRepNrm).y;
          float rn1 = repNoise(rp*0.8), rn2 = repNoise(rp*2.6+11.0), rn3 = repNoise(rp*7.5+5.0);
          float rback = smoothstep(-0.35, 0.6, rny + (rn1-0.5)*0.7);
          vec3 rcol = mix(${c(hd.belly)}, ${c(hd.flank)}, smoothstep(0.0, 0.5, rback)); rcol = mix(rcol, ${c(hd.back)}, smoothstep(0.45, 1.0, rback));
          float rband = smoothstep(0.5, 0.85, 0.5+0.5*sin(rp.z*${f(hd.bandFreq, 2.4)} + (rn1-0.5)*5.0 + rp.y*0.9)) * smoothstep(0.3, 0.75, rback);
          rcol = mix(rcol, ${c(hd.band)}, rband*0.7);
          rcol *= 0.78 + 0.44*rn2;
          rcol = mix(rcol, rcol*vec3(1.12,1.0,0.8), rn3*0.6);
          float rskin = 1.0 - vRepMouth, rfw = length(fwidth(rp));
          float rdetA = (1.0 - smoothstep(0.3, 0.9, rfw*${f(hd.freq, 24)})) * rskin, rdetB = (1.0 - smoothstep(0.3, 0.9, rfw*${f(hd.plateFreq, 6.5)})) * rskin;
          vec3 rcA = repCells(rp*${f(hd.freq, 24)}), rcB = repCells(rp*${f(hd.plateFreq, 6.5)}+3.7);
          // small scales: a narrow dark crease (rgA) and a wide rounded shoulder (rbead) so each one reads as a bead, not a flat tile.
          // The larger cells only vary tint and swell gently; they draw no lines, so there is a single scale size.
          float redA = rcA.y-rcA.x;
          float rgA = smoothstep(0.02, 0.14, redA), rbead = smoothstep(0.0, 0.45, redA), rgB = smoothstep(0.0, 0.25, rcB.y-rcB.x);
          rcol *= mix(0.84, mix(0.55, 1.0, rgA)*(0.8+0.25*rbead)*(0.88+0.24*rcA.z), rdetA);
          rcol *= mix(1.0, 0.9+0.2*rcB.z, rdetB);
          rcol = mix(rcol, ${c(hd.mouth)}*(0.6+0.4*rn3), vRepMouth);
          float repH = (rgA*0.5 + rbead*0.7)*rdetA + rgB*1.2*rdetB + rn3*2.0*rskin;
          float repRough = mix(mix(0.84, mix(0.96, 0.55, rbead), rdetA), 0.3, vRepMouth);
          diffuseColor.rgb *= rcol;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = repRough;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = repBump(normal, -vViewPosition, repH, ${f(hd.relief, 0.004)});`);
    };
    m.customProgramCacheKey = () => 'hide' + JSON.stringify(hd, (k, v) => v instanceof RegExp ? String(v) : v);
    m.needsUpdate = true;
  }

  // On phones the model's 2048px textures are redrawn at DG.Q.maxTex before they reach the GPU: a quarter of
  // the memory, and no visible loss on a small screen.
  function shrinkTextures(gltf) {
    const max = DG.Q && DG.Q.maxTex; if (!max) return;
    const seen = new Set();
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        for (const k in m) {
          const t = m[k]; if (!t || !t.isTexture || seen.has(t) || !t.image) continue; seen.add(t);
          const w = t.image.width, h = t.image.height; if (!w || Math.max(w, h) <= max) continue;
          try {
            const s = max / Math.max(w, h), c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
            c.getContext('2d').drawImage(t.image, 0, 0, c.width, c.height);
            if (t.image.close) t.image.close(); t.image = c; t.needsUpdate = true;
          } catch (e) { console.warn('texture shrink failed', e); }
        }
      });
    });
  }

  const cache = {};
  DG.loadGLB = function (url) {
    if (!cache[url]) cache[url] = new Promise(res => {
      if (location.protocol === 'file:') { res(null); return; }
      try {
        const l = new THREE_GLTFLoader(); l.register(p => new SpecGlossPlugin(p));
        l.load(url, g => { shrinkTextures(g); res(g); }, undefined, e => { console.warn('model load failed:', url, e && e.message); res(null); });
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
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (!m) return; if (m.map) m.map.anisotropy = 8; m.envMapIntensity = 0.6; patchGloss(m); if (cfg.hide && cfg.hide.match.test(m.name)) patchHide(m, cfg.hide); });
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
      // originZ: model-space z that should sit over the animal's turning point (default: middle of its length)
      scene.position.set(-cen.x, -box.min.y, cfg.originZ != null && !alongX ? -cfg.originZ : -cen.z);
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
