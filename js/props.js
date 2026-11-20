// Small 3D models for the co-op props and items: photo-scanned CC0 models from Poly Haven (textures cut to 512 px),
// loaded once at start. DG.PROPS.get(name, size, opt) gives a fresh copy standing on y = 0, centred, scaled so that
// its largest side (opt.fit 'h': its height) is `size` metres. Without the file (opened from disk, or a failed load,
// or a name with no model) it gives null and the caller keeps its simple built-in shape.
(function () {
  const DG = window.DG;
  const NAMES = ['radio', 'book', 'crate', 'gascan', 'bonfire', 'door', 'pipes', 'dock', 'barrel', 'rifle', 'firstaid',
    'grenade', 'generator', 'powerbox', 'buoy',
    // items, mission props and places modelled for this game in Blender (some built from Poly Haven CC0 parts)
    'beartrap', 'cracker', 'hook', 'flaregun', 'stim', 'dynamite', 'adren', 'roadflare', 'meat', 'tracker', 'mudbucket',
    'antenna', 'trailcam', 'noticeboard', 'safe', 'egg', 'nest', 'drone', 'stretcher', 'utilpole', 'valveriser', 'valvewheel',
    'cage', 'cagegate', 'lantern', 'lookout', 'wall', 'tent', 'stake', 'skiff', 'minemouth', 'minegate', 'minerocks', 'radiotower'];
  const TINT = { door: 0xb8ae9e, pipes: 0xa8a49a }; // scans that look too clean for a swamp: dirtied a little
  const lib = {};
  let ready = null;
  DG.PROPS = {
    NAMES,
    load() {
      if (!ready) ready = Promise.all(NAMES.map(n => DG.loadGLB('models/props/' + n + '.glb').then(g => {
        if (!g) return;
        g.scene.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true; o.userData.shared = true; // geometry and material belong to the library
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.metalness = Math.min(m.metalness, 0.3); m.roughness = Math.max(m.roughness, 0.55); if (m.alphaTest > 0 || m.transparent) m.side = THREE.DoubleSide; /* chain-link fence: seen from both sides */ if (TINT[n] && !m.userData.tinted) { m.color.multiply(new THREE.Color(TINT[n])); m.userData.tinted = true; } });
        });
        lib[n] = g.scene;
      })));
      return ready;
    },
    has: n => !!lib[n],
    // opt: fit ('max' | 'h' | 'x' | 'z'), rot [x, y, z] turned before measuring, y0 (lift)
    get(n, size, opt) {
      const src = lib[n]; if (!src) return null;
      opt = opt || {};
      const g = new THREE.Group(), turn = new THREE.Group(), m = src.clone(true);
      turn.add(m); g.add(turn);
      if (opt.rot) turn.rotation.set(opt.rot[0] || 0, opt.rot[1] || 0, opt.rot[2] || 0);
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(turn, true), sz = box.getSize(new THREE.Vector3());
      const along = opt.fit === 'h' ? sz.y : opt.fit === 'x' ? sz.x : opt.fit === 'z' ? sz.z : Math.max(sz.x, sz.y, sz.z);
      const k = size / Math.max(along, 1e-6);
      turn.scale.setScalar(k);
      const c = box.getCenter(new THREE.Vector3());
      turn.position.set(-c.x * k, -box.min.y * k + (opt.y0 || 0), -c.z * k);
      g.userData.size = sz.multiplyScalar(k);
      return g;
    }
  };
})();
