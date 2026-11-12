// Species definitions (all units metres). Body faces +Z, hip joint near z=0.
(function () {
  const DG = window.DG;
  DG.SPECIES = {
    trex: {
      key: 'trex', name: 'ティラノサウルス', sci: 'Tyrannosaurus rex', seed: 11,
      model: { file: 'models/trex.glb', title: 'Animated Tyrannosaurus Rex Dinosaur Running Loop', author: 'LasquetiSpice', url: 'https://sketchfab.com/3d-models/38007d947ae74dea83988cb0b08ee053',
        runSpeed: 10, ranges: { roar: [1.8, 5.2], bite: [0, 1.25] } },
      desc: '全長12m・体重8t超の白亜紀最大級の肉食恐竜。骨をも砕く咬合力と、獲物を立体的に捉える前向きの目を持つ。足は速くないが、一度狙われたら逃げ切るのは至難。',
      stats: '全長 12.3m ／ 腰高 3.5m ／ 最高速度 約27km/h',
      skin: { top: 0x463d2d, side: 0x6b5c43, belly: 0xa8977a, pattern: 0x2b2519, type: 'stripes', freq: 22, headTint: 0x5a3a2a, cells: 34, scutes: 0.8, strength: 7 },
      iris: { iris: 0xc8862a }, sheen: 0x8a7a5e,
      bump: 0.03, headBump: 0.035, noiseScale: 2.6, neckFolds: [3.2, 4.45, 0.03, 20],
      body: [
        { z: -6.7, y: 2.55, w: .02, h: .03 }, { z: -6.2, y: 2.68, w: .08, h: .11 }, { z: -5.2, y: 2.9, w: .16, h: .24 },
        { z: -4.0, y: 3.08, w: .26, h: .38 }, { z: -2.8, y: 3.22, w: .37, h: .52 }, { z: -1.6, y: 3.33, w: .5, h: .66, hb: .72 },
        { z: -0.5, y: 3.4, w: .66, h: .8, hb: .95, ridge: .03 }, { z: 0.4, y: 3.45, w: .8, h: .86, hb: 1.12 }, { z: 1.3, y: 3.42, w: .94, h: .88, hb: 1.26 },
        { z: 2.2, y: 3.45, w: .9, h: .85, hb: 1.2 }, { z: 2.9, y: 3.58, w: .7, h: .68, hb: .98 }, { z: 3.45, y: 3.8, w: .54, h: .54, hb: .72 },
        { z: 3.95, y: 4.02, w: .45, h: .47, hb: .6 }, { z: 4.35, y: 4.15, w: .47, h: .55, hb: .6 }, { z: 4.7, y: 4.12, w: .49, h: .57, hb: .5, n: 2.4 },
        { z: 5.1, y: 4.02, w: .33, h: .46, hb: .4, n: 2.9, ridge: .03 }, { z: 5.5, y: 3.92, w: .23, h: .37, hb: .33, n: 3.2, ridge: .025 }, { z: 5.85, y: 3.83, w: .17, h: .29, hb: .27, n: 3.0 },
        { z: 6.05, y: 3.77, w: .1, h: .16, hb: .15 }],
      spine: [1.1, 2.2, 3.0, 3.6, 4.05, 4.4], neckBones: 3, tail: [-1.0, -2.0, -3.0, -4.0, -5.0, -5.8, -6.4],
      mouth: { z0: 4.45, y0: 3.82, z1: 6.05, y1: 3.66 }, jawMax: 0.8,
      jaw: [{ z: 4.3, w: .33, h: .2, hb: .32 }, { z: 4.7, w: .36, h: .22, hb: .3 }, { z: 5.2, w: .27, h: .2, hb: .23 }, { z: 5.7, w: .16, h: .17, hb: .17 }, { z: 6.0, w: .1, h: .11, hb: .11 }],
      teeth: { upper: { n: 11, z0: 4.75, z1: 5.98, len: .14, r: .026 }, lower: { n: 10, z0: 4.85, z1: 5.92, len: .1, r: .022, inset: .86 } },
      eye: { z: 4.72, th: 0.95, r: .055, gaze: [0.55, 0.1, 0.83], brow: [1.5, 0.85, 2.5] }, nostril: { z: 5.9, th: 0.75, r: .035 },
      scutes: [{ rows: [0, 0.28], z0: -4, z1: 3.6, n: 46, size: .035 }],
      limbs: [
        { name: 'leg', parent: 'pelvis', x: .55, y: 3.05, z: .15, segs: [{ len: 1.3, ang: .38, rw: .5, rd: .66, bulge: .22 }, { len: 1.2, ang: -.42, rw: .24, rd: .34, bulge: .25 }, { len: .62, ang: .42, rw: .14, rd: .16 }],
          end: { rw: .14, rd: .13 }, toes: [{ yaw: 0, len: .55, r: .09, claw: .14 }, { yaw: -.32, len: .45, r: .085, claw: .13 }, { yaw: .32, len: .47, r: .085, claw: .13 }, { yaw: -1.3, len: .14, r: .04, claw: .06, raise: .14, dz: -.12 }] },
        { name: 'arm', arm: true, parent: 2, x: .45, y: 2.9, z: 2.75, segs: [{ len: .38, ang: .6, rw: .08, rd: .09 }, { len: .3, ang: 1.1, rw: .055, rd: .06 }, { len: .12, ang: 1.3, rw: .04, rd: .035 }],
          end: { rw: .035, rd: .03 }, toes: [{ dir: [0.15, -0.4, 1], len: .15, r: .022, claw: .07, curl: .4, x: .02 }, { dir: [-0.1, -0.5, 1], len: .13, r: .02, claw: .06, curl: .4, x: -.02 }] }],
      gait: { walk: 2.5, run: 7.5, stride: 1.6, strideK: .45, maxStride: 4.5, bob: .07, lift: .45, duty: .62, dutyRun: .42, lean: .1, tailSway: .05, breath: 0.9 },
      ai: { type: 'hunter', walk: 2.2, run: 7.6, accel: 2.2, turn: 0.9, sight: 85, hear: 60, attack: 4.2, roarPitch: 0.6, count: 2, size: 1, maxCount: 9, spawnEvery: 60 } // maxCount = how many are built at load; the difficulty level (game.js) decides how many appear and how fast
    },

    utah: {
      key: 'utah', name: 'ユタラプトル', sci: 'Utahraptor ostrommaysi', seed: 23,
      model: { file: 'models/raptor.glb', title: 'PBR Velociraptor (Animated)', author: 'Ferocious Industries', url: 'https://sketchfab.com/3d-models/8f1744af7b0847a2aabe3df90be802f0',
        desc: '全長6mを超える最大級のドロマエオサウルス類。後ろ足には24cmの鎌状の鉤爪。群れで連携して獲物を追い詰める。（※実際のユタラプトルは羽毛に覆われていたと考えられている）' },
      desc: '全長6mを超える最大級のドロマエオサウルス類。全身が羽毛に覆われ、後ろ足には24cmの鎌状の鉤爪。群れで連携して獲物を追い詰める。',
      stats: '全長 6.5m ／ 腰高 1.5m ／ 最高速度 約40km/h',
      skin: { top: 0x3a3326, side: 0x6e5c3e, belly: 0xb4a487, pattern: 0x1e1a14, type: 'stripes', freq: 34, headTint: 0x4a2e22, cells: 40, scutes: 0.3, strength: 5 },
      iris: { iris: 0xd9a531 }, sheen: 0x7a6a50, feather: { c1: 0x6a5a40, c2: 0x2e261a },
      bump: 0.008, headBump: 0.008, noiseScale: 6,
      body: [
        { z: -3.4, y: 1.6, w: .015, h: .02 }, { z: -3.0, y: 1.62, w: .04, h: .05 }, { z: -2.2, y: 1.62, w: .07, h: .09 }, { z: -1.3, y: 1.62, w: .11, h: .14 },
        { z: -0.6, y: 1.62, w: .17, h: .22, hb: .24 }, { z: 0, y: 1.62, w: .22, h: .27, hb: .32 }, { z: 0.6, y: 1.6, w: .27, h: .3, hb: .4 },
        { z: 1.1, y: 1.62, w: .26, h: .28, hb: .38 }, { z: 1.5, y: 1.72, w: .17, h: .19, hb: .24 }, { z: 1.8, y: 1.9, w: .11, h: .12, hb: .13 },
        { z: 2.0, y: 2.08, w: .095, h: .1 }, { z: 2.2, y: 2.2, w: .095, h: .1 }, { z: 2.42, y: 2.25, w: .12, h: .14 }, { z: 2.62, y: 2.24, w: .12, h: .14, hb: .12 },
        { z: 2.85, y: 2.2, w: .09, h: .11, hb: .09 }, { z: 3.05, y: 2.16, w: .065, h: .08, hb: .07 }, { z: 3.2, y: 2.13, w: .035, h: .045, hb: .04 }],
      spine: [0.6, 1.2, 1.7, 2.05, 2.38], neckBones: 3, tail: [-0.6, -1.2, -1.8, -2.4, -2.9, -3.25],
      mouth: { z0: 2.4, y0: 2.16, z1: 3.2, y1: 2.1 }, jawMax: 0.75,
      jaw: [{ z: 2.35, w: .07, h: .06, hb: .07 }, { z: 2.65, w: .068, h: .05, hb: .05 }, { z: 2.95, w: .05, h: .04, hb: .035 }, { z: 3.18, w: .025, h: .025, hb: .02 }],
      teeth: { upper: { n: 13, z0: 2.6, z1: 3.16, len: .035, r: .007 }, lower: { n: 12, z0: 2.65, z1: 3.12, len: .028, r: .006, inset: .85 } },
      eye: { z: 2.55, th: 1.0, r: .028, gaze: [0.75, 0.05, 0.65], brow: [1.0, 0.45, 1.8] }, nostril: { z: 3.1, th: 0.8, r: .012 },
      limbs: [
        { name: 'leg', parent: 'pelvis', x: .2, y: 1.42, z: .05, segs: [{ len: .55, ang: .45, rw: .16, rd: .22, bulge: .15 }, { len: .62, ang: -.5, rw: .07, rd: .1 }, { len: .32, ang: .3, rw: .04, rd: .05 }],
          end: { rw: .045, rd: .04 }, toes: [{ yaw: .05, len: .2, r: .03, claw: .05 }, { yaw: .35, len: .18, r: .028, claw: .045 }, { yaw: -.25, len: .12, r: .032, raise: .09, claw: .16, hook: .55 }] },
        { name: 'arm', arm: true, parent: 1, x: .17, y: 1.48, z: 1.25, segs: [{ len: .3, ang: .3, rw: .05, rd: .06 }, { len: .27, ang: 1.2, rw: .035, rd: .04 }, { len: .17, ang: 1.6, rw: .022, rd: .025 }],
          end: { rw: .018, rd: .018 }, toes: [{ dir: [0.1, -0.5, 1], len: .1, r: .012, claw: .05, curl: .4 }, { dir: [0, -0.6, 1], len: .11, r: .012, claw: .055, curl: .4 }, { dir: [-0.1, -0.7, 1], len: .09, r: .011, claw: .045, curl: .4 }] }],
      feathers: { coat: { n: 2000, z0: -3.3, z1: 2.42, th: 2.0, len: .2, wid: .085, lift: .14 }, tail: { n: 18, z0: -3.3, z1: -1.3, len: .36, wid: .1 }, arm: { n: 9, len: .34, wid: .08 } },
      gait: { walk: 2.0, run: 11, stride: 1.0, strideK: .25, maxStride: 3.2, bob: .04, lift: .22, lean: .12, tailSway: .04, breath: 2.2 },
      ai: { type: 'pack', walk: 2.0, run: 9.4, accel: 5, turn: 2.4, sight: 50, hear: 40, attack: 2.2, roarPitch: 1.8, count: 3, size: 0.5 }
    },

    trike: {
      key: 'trike', name: 'トリケラトプス', sci: 'Triceratops horridus', seed: 37,
      model: { file: 'models/triceratops.glb', title: 'triceratops', author: 'victory_', url: 'https://sketchfab.com/3d-models/5e2fa21610ab4cd59abcbcb15007ffd5' },
      desc: '3本の角と巨大なフリルを持つ角竜。草食だが縄張りに入った者には猛然と突進する。体重は最大12t、その突進はトラックの衝突に等しい。',
      stats: '全長 9m ／ 腰高 2.4m ／ 突進速度 約25km/h',
      skin: { top: 0x58493a, side: 0x7a6a50, belly: 0xb0a080, pattern: 0x3a2f22, type: 'mottle', freq: 30, headTint: 0x6b4a32, cells: 22, scutes: 1.0, strength: 8 },
      iris: { iris: 0x7a4a1c }, sheen: 0x8a7a60,
      bump: 0.04, headBump: 0.03, noiseScale: 2.2,
      body: [
        { z: -4.6, y: 1.9, w: .02, h: .03 }, { z: -4.2, y: 2.0, w: .08, h: .1 }, { z: -3.4, y: 2.2, w: .2, h: .25 }, { z: -2.4, y: 2.42, w: .38, h: .45 },
        { z: -1.4, y: 2.6, w: .6, h: .7, hb: .75 }, { z: -0.4, y: 2.7, w: .85, h: .85, hb: 1.0, n: 2.4 }, { z: 0.6, y: 2.68, w: 1.05, h: .9, hb: 1.15, n: 2.5 },
        { z: 1.6, y: 2.5, w: 1.0, h: .85, hb: 1.1, n: 2.4 }, { z: 2.4, y: 2.25, w: .8, h: .7, hb: .9 }, { z: 2.95, y: 2.08, w: .55, h: .55, hb: .65 },
        { z: 3.3, y: 2.05, w: .5, h: .55, hb: .55 }, { z: 3.7, y: 2.0, w: .48, h: .55, hb: .5 }, { z: 4.1, y: 1.88, w: .36, h: .45, hb: .38, n: 2.6 },
        { z: 4.45, y: 1.74, w: .25, h: .34, hb: .3 }, { z: 4.75, y: 1.6, w: .15, h: .24, hb: .2 }, { z: 4.95, y: 1.5, w: .06, h: .12, hb: .08 }],
      spine: [0.8, 1.8, 2.5, 2.95, 3.3], neckBones: 2, tail: [-1.0, -2.0, -3.0, -3.9, -4.4],
      mouth: { z0: 3.45, y0: 1.68, z1: 4.95, y1: 1.36 }, jawMax: 0.35, jawIdle: 0,
      jaw: [{ z: 3.4, w: .32, h: .2, hb: .3 }, { z: 3.9, w: .3, h: .18, hb: .26 }, { z: 4.4, w: .2, h: .14, hb: .18 }, { z: 4.85, w: .08, h: .07, hb: .08 }],
      eye: { z: 3.85, th: 1.05, r: .04, gaze: [0.95, 0.05, 0.3], brow: [1.1, 0.6, 1.8] }, nostril: { z: 4.55, th: 0.55, r: .05 },
      horns: [
        { z: 3.65, th: 0.42, len: 1.0, r: .1, dir: [0.22, 0.75, 0.62], bend: [0, -0.2, 0.35], mirror: true },
        { z: 4.5, th: 0, len: .3, r: .09, dir: [0, 1, .35], bend: [0, 0, .1] },
        { z: 4.86, th: 0.25, len: .2, r: .085, dir: [0, -0.3, 1], bend: [0, -0.4, 0], c0: [0.12, 0.1, 0.08], c1: [0.22, 0.19, 0.16] }],
      frill: { z: 3.2, y: 2.36, tilt: 0.42, R: .58, H: .52, arc: 1.5, thick: .06, bend: .2, bumps: 9 },
      scutes: [{ rows: [0, 0.6, 1.0, 1.45], z0: -2.5, z1: 2.4, n: 20, size: .07, height: .45, taper: true }],
      limbs: [
        { name: 'hind', parent: 'pelvis', x: .62, y: 2.3, z: -.5, phase: 0, segs: [{ len: 1.05, ang: .12, rw: .42, rd: .52, bulge: .2 }, { len: .85, ang: -.12, rw: .27, rd: .31, bulge: .15 }, { len: .3, ang: .2, rw: .19, rd: .19 }],
          end: { rw: .2, rd: .17 }, toes: [{ yaw: -.35, len: .2, r: .07, claw: .07, hook: .15 }, { yaw: -.1, len: .22, r: .075, claw: .07, hook: .15 }, { yaw: .15, len: .21, r: .072, claw: .07, hook: .15 }, { yaw: .4, len: .18, r: .065, claw: .06, hook: .15 }] },
        { name: 'fore', parent: 1, front: true, x: .66, y: 1.72, z: 1.9, phase: .25, segs: [{ len: .75, ang: -.25, rw: .3, rd: .34, bulge: .18 }, { len: .6, ang: .2, rw: .2, rd: .22, bulge: .12 }, { len: .25, ang: .05, rw: .15, rd: .15 }],
          end: { rw: .16, rd: .13 }, toes: [{ yaw: -.5, len: .13, r: .055, claw: .04, hook: .1 }, { yaw: -.25, len: .14, r: .058, claw: .045, hook: .1 }, { yaw: 0, len: .14, r: .058, claw: .045, hook: .1 }, { yaw: .25, len: .13, r: .055, claw: .04, hook: .1 }, { yaw: .5, len: .1, r: .045 }] }],
      gait: { quad: true, walk: 1.5, run: 7, stride: 1.4, strideK: .3, maxStride: 3.0, bob: .05, lift: .25, duty: .65, dutyRun: .45, lean: 0, tailSway: .04, breath: 0.8, metaRoll: .25, metaFold: .4, toeDroop: .4 },
      ai: { type: 'charger', walk: 1.4, run: 7.2, accel: 3, turn: 0.7, sight: 35, hear: 25, attack: 3.8, roarPitch: 0.45, count: 2, size: 0.9 }
    },

    carno: {
      key: 'carno', name: 'カルノタウルス', sci: 'Carnotaurus sastrei', seed: 51,
      desc: '目の上に2本の角を持つ「肉食の雄牛」。前脚は極端に退化しているが、長い後ろ脚と強靭な尾の筋肉で直線では最速級。ただし急な方向転換は苦手。',
      stats: '全長 8m ／ 腰高 2.3m ／ 最高速度 約50km/h',
      skin: { top: 0x5b2f22, side: 0x7c4a33, belly: 0xb89a7a, pattern: 0x2a1812, type: 'bands', freq: 18, headTint: 0x7a2a1e, cells: 30, scutes: 0.9, strength: 7 },
      iris: { iris: 0xe0b23a, slit: true }, sheen: 0x8a6a58,
      bump: 0.025, headBump: 0.03, noiseScale: 3,
      neckFolds: [2.2, 3.15, 0.02, 26],
      body: [
        { z: -4.5, y: 2.15, w: .02, h: .03 }, { z: -4.0, y: 2.22, w: .07, h: .09 }, { z: -3.0, y: 2.32, w: .15, h: .22 }, { z: -2.0, y: 2.42, w: .25, h: .36 },
        { z: -1.0, y: 2.5, w: .36, h: .48, hb: .52 }, { z: 0, y: 2.55, w: .44, h: .55, hb: .65 }, { z: 0.9, y: 2.52, w: .5, h: .55, hb: .72 },
        { z: 1.7, y: 2.55, w: .45, h: .5, hb: .62 }, { z: 2.3, y: 2.68, w: .32, h: .36, hb: .42 }, { z: 2.75, y: 2.86, w: .24, h: .27, hb: .3 },
        { z: 3.1, y: 2.98, w: .22, h: .26, hb: .3 }, { z: 3.35, y: 2.98, w: .24, h: .3, hb: .3, n: 2.4 }, { z: 3.65, y: 2.9, w: .2, h: .27, hb: .26, n: 2.5 },
        { z: 3.92, y: 2.82, w: .14, h: .22, hb: .2, n: 2.5 }, { z: 4.08, y: 2.77, w: .07, h: .12, hb: .1 }],
      spine: [0.9, 1.7, 2.35, 2.8, 3.12], neckBones: 3, tail: [-0.9, -1.8, -2.7, -3.4, -4.0, -4.35],
      mouth: { z0: 3.18, y0: 2.76, z1: 4.08, y1: 2.66 }, jawMax: 0.7,
      jaw: [{ z: 3.1, w: .13, h: .1, hb: .13 }, { z: 3.45, w: .13, h: .08, hb: .1 }, { z: 3.8, w: .1, h: .07, hb: .08 }, { z: 4.05, w: .05, h: .05, hb: .05 }],
      teeth: { upper: { n: 10, z0: 3.38, z1: 4.02, len: .065, r: .013 }, lower: { n: 9, z0: 3.42, z1: 3.98, len: .045, r: .011, inset: .85 } },
      eye: { z: 3.36, th: 1.0, r: .035, gaze: [0.75, 0.15, 0.65], brow: [1.2, 0.6, 1.7] }, nostril: { z: 3.98, th: 0.7, r: .02 },
      horns: [{ z: 3.2, th: 0.6, len: .26, r: .075, dir: [0.85, 0.45, -0.1], bend: [0, 0.25, 0], mirror: true, skinCol: true }],
      scutes: [{ rows: [0.55, 1.0, 1.45], z0: -2.2, z1: 2.6, n: 30, size: .05 }, { rows: [0.3], z0: -3.5, z1: 3.0, n: 40, size: .03 }],
      limbs: [
        { name: 'leg', parent: 'pelvis', x: .33, y: 2.42, z: .05, segs: [{ len: 1.0, ang: .4, rw: .25, rd: .34, bulge: .15 }, { len: 1.0, ang: -.45, rw: .11, rd: .15 }, { len: .55, ang: .4, rw: .06, rd: .07 }],
          end: { rw: .065, rd: .06 }, toes: [{ yaw: 0, len: .32, r: .05, claw: .07 }, { yaw: -.32, len: .26, r: .046, claw: .065 }, { yaw: .32, len: .27, r: .046, claw: .065 }] },
        { name: 'arm', arm: true, parent: 1, x: .3, y: 2.3, z: 1.85, segs: [{ len: .2, ang: .4, rw: .05, rd: .05 }, { len: .1, ang: .8, rw: .04, rd: .04 }, { len: .06, ang: 1.0, rw: .03, rd: .03 }],
          end: { rw: .025, rd: .025 }, toes: [{ dir: [0.1, -0.6, 1], len: .04, r: .012 }, { dir: [-0.1, -0.6, 1], len: .04, r: .012 }] }],
      gait: { walk: 2.5, run: 12, stride: 1.4, strideK: .4, maxStride: 4.5, bob: .06, lift: .35, lean: .12, tailSway: .05, breath: 1.2 },
      ai: { type: 'sprinter', walk: 2.4, run: 11.5, accel: 4, turn: 0.55, sight: 70, hear: 50, attack: 3.0, roarPitch: 0.9, count: 1, size: 0.75 }
    }
  };
  DG.ALL_SPECIES = ['trex', 'utah', 'trike', 'carno'];
  // 現在はティラノサウルスだけのモード。全種に戻すときは DG.SPECIES_ORDER = DG.ALL_SPECIES にする
  DG.SPECIES_ORDER = ['trex'];

  // A second hunter that only exists where its model file does. models/local/ is not published, so on the public
  // page this species is never loaded. `optional` is the ?model=<name> value that switches it on (game.js remembers it);
  // if the file is missing the species is simply dropped. It hunts exactly like the T-rex (same speed and senses) and
  // appears mixed in with them on the difficulty levels that have a `mix` value.
  (function () {
    const T = DG.SPECIES.trex;
    DG.SPECIES.unk = Object.assign({}, T, {
      key: 'unk', optional: 'irex', name: '未確認の大型獣脚類', sci: 'Theropoda indet.',
      desc: '記録にない大型の獣脚類。ティラノサウルスより腕が長く、背から尾にかけて棘が並ぶ。難易度「とても難しい」でのみ、ティラノサウルスに混じって森に現れる。',
      stats: '全長 約15m ／ 腰高 約3.8m ／ 最高速度 約27km/h',
      model: {
        file: 'models/local/irex.glb', local: true, title: '手元専用モデル（非公開・動きはティラノサウルスから移植）',
        runSpeed: 10, ranges: T.model.ranges, lengthScale: 1.2, originZ: -0.28,
        // no texture files exist for it: the hide is drawn by the shader in gltf_dino.js (colours are sRGB hex)
        hide: { match: /body/, back: 0x4f5340, flank: 0x74765a, belly: 0xa79d7e, band: 0x2a2b21, mouth: 0x8a3b34, freq: 24, plateFreq: 6.5, bandFreq: 2.4, relief: 0.007 }
      },
      ai: Object.assign({}, T.ai, { maxCount: 5, roarPitch: 0.74 })
    });
  })();

  // textures cache per species
  DG.speciesTex = function (key) {
    const s = DG.SPECIES[key]; if (s._tex) return s._tex;
    const T = DG.T, k = s.skin;
    const detail = T.skinDetail({ cells: k.cells, seed: s.seed, scutes: k.scutes, strength: k.strength });
    // repeat so scales are roughly square: u along body length, v around
    const len = s.body[s.body.length - 1].z - s.body[0].z;
    const circ = Math.max(...s.body.map(b => b.w + (b.hb || b.h))) * Math.PI;
    const tile = k.cells * (k.scale || 0.03);
    detail.repeat.set(len / tile, Math.max(1, Math.round(circ / tile)));
    s._tex = { color: T.skinColor({ ...k, seed: s.seed }), detail, iris: T.iris(s.iris), feather: s.feather ? T.feather(s.feather) : null };
    return s._tex;
  };
})();
