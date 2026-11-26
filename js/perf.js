// Lighter drawing of the night swamp (co-op). Each part is a trial (js/trial.js), switched per machine:
//  - lights (trial 'nearLights'): three.js shades every pixel with every light in the scene, lit or not (the
//    swamp has about 14: the camp fire, the lanterns, the generator lamp, the flares, every seat's flashlight...).
//    The scene's lamps are moved to a layer the camera doesn't see and a small fixed pool of lights (4 point, 2
//    spot) takes the place of the ones nearest the viewer each frame. The pool never changes size, so no shader
//    is recompiled mid-game. A light that casts shadows (your own flashlight on a computer) stays as it is.
//  - cull (trial 'fogCull'): things past the fog (the props, crates, mission set pieces) were still drawn, ~600
//    meshes on a night; a group whose nearest point is past where the fog is solid is left out of the drawing.
//    Meshes that glow (fires, lanterns, beacons: unfogged, additive, unlit or emissive) are kept, since they are
//    meant to be seen from afar.
(function () {
  const HIDE = 31; // a layer no camera looks at
  const NP = 4, NS = 2;
  const V = new THREE.Vector3(), V2 = new THREE.Vector3();
  let L = null; // { scene, srcP, srcS, poolP, poolS }

  const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function attach(scene) {
    const srcP = [], srcS = [];
    scene.traverse(o => {
      if (o.userData.perfPool || o.castShadow) return;
      if (o.isPointLight) srcP.push(o); else if (o.isSpotLight) srcS.push(o);
    });
    const poolP = [], poolS = [];
    for (let i = 0; i < Math.min(NP, srcP.length); i++) { const l = new THREE.PointLight(0xffffff, 0, 1, 2); l.userData.perfPool = true; scene.add(l); poolP.push(l); }
    for (let i = 0; i < Math.min(NS, srcS.length); i++) { const l = new THREE.SpotLight(0xffffff, 0, 1); l.userData.perfPool = true; scene.add(l, l.target); poolS.push(l); }
    srcP.concat(srcS).forEach(o => { o.userData.perfMask = o.layers.mask; o.layers.set(HIDE); });
    L = { scene, srcP, srcS, poolP, poolS };
  }
  function detach() {
    if (!L) return;
    L.srcP.concat(L.srcS).forEach(o => { if (o.userData.perfMask != null) { o.layers.mask = o.userData.perfMask; delete o.userData.perfMask; } });
    L.poolP.forEach(l => { L.scene.remove(l); l.dispose(); });
    L.poolS.forEach(l => { L.scene.remove(l, l.target); l.dispose(); });
    L = null;
  }
  // give the pool's lights to the sources nearest the viewer (a source keeps its slot while it stays chosen)
  function fill(pool, src, cam, spot) {
    const cand = [];
    for (const o of src) {
      if (!(o.intensity > 0) || !o.parent || !shown(o)) continue;
      o.getWorldPosition(V);
      const reach = o.distance > 0 ? o.distance : 1e4, held = pool.some(l => l.userData.src === o);
      cand.push({ o, s: V.distanceTo(cam) - reach - (held ? 4 : 0) }); // (a little stickiness, so two lights at about the same distance don't swap every frame)
    }
    cand.sort((a, b) => a.s - b.s);
    const pick = cand.slice(0, pool.length).map(c => c.o);
    pool.forEach(l => { if (!pick.includes(l.userData.src)) l.userData.src = null; });
    pick.forEach(o => { if (!pool.some(l => l.userData.src === o)) pool.find(l => !l.userData.src).userData.src = o; });
    for (const l of pool) {
      const o = l.userData.src;
      if (!o) { l.intensity = 0; continue; }
      o.getWorldPosition(l.position); l.color.copy(o.color); l.intensity = o.intensity; l.distance = o.distance; l.decay = o.decay;
      if (spot) { l.angle = o.angle; l.penumbra = o.penumbra; o.target.getWorldPosition(l.target.position); l.target.updateMatrixWorld(); }
    }
  }

  const culled = new Set(), bound = new WeakMap();
  // a fire, a lantern, a beacon: shows through the fog (ignores it, adds light, or shines by itself)
  const glows = m => !m || m.fog === false || m.blending === THREE.AdditiveBlending || m.isMeshBasicMaterial ||
    (m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b > 0.02 || m.emissiveMap));
  function hideMeshes(g, hide) {
    g.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return;
      if (hide) {
        if ([].concat(o.material).some(glows)) return; // meant to be seen through the fog
        if (o.userData.perfMask == null) { o.userData.perfMask = o.layers.mask; o.layers.set(HIDE); }
      } else if (o.userData.perfMask != null) { o.layers.mask = o.userData.perfMask; delete o.userData.perfMask; }
    });
  }
  // how far a group reaches from its own position (measured once; moving things keep it)
  function reach(g) {
    let r = bound.get(g);
    if (r == null) {
      const b = new THREE.Box3().setFromObject(g);
      r = b.isEmpty() ? 0 : g.getWorldPosition(V2).distanceTo(b.getCenter(V)) + b.getSize(V).length() / 2;
      bound.set(g, r);
    }
    return r;
  }
  function uncullAll() { culled.forEach(g => hideMeshes(g, false)); culled.clear(); }

  DG.PERF = {
    // call every frame (and once before the shaders are compiled): on = trial 'nearLights'
    lights(scene, on, camera) {
      if (L && (!on || L.scene !== scene)) detach();
      if (!on) return;
      if (!L) attach(scene);
      const cam = camera.getWorldPosition(new THREE.Vector3());
      fill(L.poolP, L.srcP, cam, false); fill(L.poolS, L.srcS, cam, true);
    },
    // call every frame: on = trial 'fogCull'
    cull(scene, on, camera) {
      const f = scene.fog, far = !f ? 0 : f.isFogExp2 ? 2.4 / f.density : f.far; // (exp2 fog: 99.7% fogged at 2.4 / density)
      if (!on || !far) { uncullAll(); return; }
      const cam = camera.getWorldPosition(V2).clone();
      for (const g of scene.children) {
        if (g.isLight || g.isInstancedMesh || g.isSprite || g.isPoints || g.isLine || !(g.isGroup || g.isMesh || g.type === 'Object3D')) continue;
        const r = reach(g); if (r > far) continue; // (the ground, the water: never)
        const out = g.getWorldPosition(V).distanceTo(cam) - r > far;
        if (out !== culled.has(g)) { hideMeshes(g, out); if (out) culled.add(g); else culled.delete(g); }
      }
      culled.forEach(g => { if (!g.parent) culled.delete(g); }); // removed from the scene meanwhile
    },
    // back to drawing everything the normal way (end of a co-op game)
    reset() { detach(); uncullAll(); },
    get pooled() { return L ? { point: L.srcP.length + '→' + L.poolP.length, spot: L.srcS.length + '→' + L.poolS.length } : null; },
    get culled() { return culled.size; }
  };
})();
