import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// ----- World constants -----------------------------------------------------
const GROUND_HALF   = 700;   // ground only needs to reach under the hill ring
const BOUNDARY_HALF = 250;   // invisible limit: a 500m × 500m square the player can roam
const PLAYER_HEIGHT = 2.05;
const STEP_UP       = 0.7;   // tallest step the player can climb (stairs)
const WALK_SPEED    = 4.5;   // metres/sec — a real walking pace
const RUN_SPEED     = 9.0;   // sprinting (hold Shift)
const ACCEL         = 9;     // how quickly you reach top speed (gives weight)

// ----- Forest constants ----------------------------------------------------
const TREE_COUNT     = 280;  // a sparser forest — room to breathe between trees
const FOREST_RADIUS  = 340;  // trees fill the play area up to the foot of the hills
const CLEARING       = 10;   // open breathing room around the player's start
const TREE_HEIGHT     = 17;  // target height of an average tree (world units)

// ----- House constants -----------------------------------------------------
const HOUSE_HEIGHT   = 18;   // target height of a placed house (world units)
const HOUSE_SPOTS = [        // empty clearings to drop a house into
  { x:  150, z:  -80, rot:  0.4 },
  { x: -160, z:  100, rot: -1.0 },
  { x:   60, z:  180, rot:  2.4 },
  { x: -130, z: -150, rot:  1.7 },
];
const houseZones = [];       // footprints trees must keep clear of
const houseColliders = [];   // { obj, x, z } — house meshes the player collides with
const PLAYER_RADIUS  = 0.6;  // how far the player's body keeps off the walls

// ----- Hill ring constants -------------------------------------------------
const HILL_RING_R    = 380;  // distance from centre to the wall of hills
const HILL_HEIGHT    = 70;   // tall enough to hide everything (and the sky) behind

// ----- Monster constants ---------------------------------------------------
// The GLB ships 18 animation clips, but their names are GBK-garbled and can't
// be read, so the chase/attack clips are selected by index — tweak these two
// if the wrong motion plays.
let   MONSTER_CHASE_CLIP  = 2;        // index of the walk/run clip ([ and ] cycle it live)
const MONSTER_SPEED       = 5.5;      // a touch slower than your run (escapable)
const MONSTER_HEIGHT      = 18.5;     // towering — 10× the player's size
const MONSTER_FACING      = 0;        // yaw offset so it faces the player (flip by Math.PI if backwards)
const MONSTER_MAX         = 6;        // how many hunt you at once
const MONSTER_SPAWN_MIN   = 14;       // they appear out of the dark, this close…
const MONSTER_SPAWN_MAX   = 45;       // …to this far (inside the fog so you see them)
const MONSTER_RESPAWN     = 2.0;      // seconds between reinforcements

// ----- Gun / combat constants ----------------------------------------------
const GUN_SCALE = 0.009;                       // colt model is ~46 units long
const GUN_POS   = new THREE.Vector3( 0.16, -0.15, -0.42);
const GUN_ROT   = new THREE.Euler(0, -Math.PI / 2, 0); // point the barrel forward
const SHOOT_RANGE = 300;                       // how far a bullet reaches
const FIRE_COOLDOWN = 0.18;                     // seconds between shots

// ----- Renderer / scene ----------------------------------------------------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cap for performance
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
// Dark, oppressive night — you can barely see past the reach of your torch.
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.Fog(0x05070d, 6, 55);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, PLAYER_HEIGHT, 0);

// ----- Lighting ------------------------------------------------------------
// Just enough cold ambient/moonlight to make out silhouettes — the torch does
// the real work.
const hemi = new THREE.HemisphereLight(0x223044, 0x05070d, 0.12);
scene.add(hemi);

const moon = new THREE.DirectionalLight(0x6b80b0, 0.18);
moon.position.set(-80, 160, -60);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 600;
const s = 220;
moon.shadow.camera.left = -s; moon.shadow.camera.right = s;
moon.shadow.camera.top = s;   moon.shadow.camera.bottom = -s;
scene.add(moon);
scene.add(moon.target);

// ----- Torch (toggle with F) -----------------------------------------------
// A handheld spotlight parented to the camera so it always points where you
// look, plus a faint warm point light so your hands/feet aren't pitch black.
const torch = new THREE.SpotLight(0xfff0c8, 0, 220, Math.PI / 3.4, 0.25, 1.0);
torch.position.set(0.2, -0.2, 0.2);
torch.target.position.set(0, 0, -1);
torch.castShadow = true;
torch.shadow.mapSize.set(1024, 1024);
torch.shadow.camera.near = 0.5;
torch.shadow.camera.far = 220;
const torchGlow = new THREE.PointLight(0xffd090, 0, 14, 2);
torchGlow.position.set(0, -0.3, 0);

camera.add(torch);
camera.add(torch.target);
camera.add(torchGlow);
scene.add(camera); // so the camera-parented lights live in the scene graph

let torchOn = true;
const TORCH_INTENSITY = 22.0, TORCH_GLOW = 2.2; // bright, strong beam
function setTorch(on) {
  torchOn = on;
  torch.intensity = on ? TORCH_INTENSITY : 0;
  torchGlow.intensity = on ? TORCH_GLOW : 0;
}
setTorch(true);

// ----- Controls ------------------------------------------------------------
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

const overlay = document.getElementById('overlay');
const loadingEl = document.getElementById('loading');

overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock',   () => {
  overlay.style.display = 'none';
  document.body.classList.add('playing'); // show crosshair + kill count
});
controls.addEventListener('unlock', () => {
  overlay.style.display = 'flex';
  document.body.classList.remove('playing');
});

// ----- Input ---------------------------------------------------------------
const keys = { forward: false, back: false, left: false, right: false, run: false };
const setKey = (e, down) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = down; break;
    case 'KeyS': case 'ArrowDown':  keys.back = down;    break;
    case 'KeyA': case 'ArrowLeft':  keys.left = down;    break;
    case 'KeyD': case 'ArrowRight': keys.right = down;   break;
    case 'ShiftLeft': case 'ShiftRight': keys.run = down; break;
  }
};
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && !e.repeat) setTorch(!torchOn);              // toggle the torch
  if (e.code === 'BracketLeft'  && !e.repeat) setChaseClip(MONSTER_CHASE_CLIP - 1);
  if (e.code === 'BracketRight' && !e.repeat) setChaseClip(MONSTER_CHASE_CLIP + 1);
  setKey(e, true);
});
document.addEventListener('keyup',   (e) => setKey(e, false));

// ----- Build the grass ground from the GLB ---------------------------------
function buildGround(grassMaterial) {
  // One enormous plane covering the whole visible world — all green.
  const geo = new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geo, grassMaterial);
  ground.receiveShadow = true;
  scene.add(ground);
}

// Turn whatever the GLB gives us into a tileable grass material.
function grassMaterialFromGLB(gltf) {
  let foundMap = null;
  let foundColor = new THREE.Color(0x4f7a32);

  gltf.scene.traverse((o) => {
    if (o.isMesh && o.material) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m.map && !foundMap) foundMap = m.map;
      if (m.color) foundColor = m.color.clone();
    }
  });

  const mat = new THREE.MeshStandardMaterial({
    color: foundMap ? 0xffffff : foundColor,
    roughness: 1.0,
    metalness: 0.0,
  });

  if (foundMap) {
    const tex = foundMap.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(GROUND_HALF / 4, GROUND_HALF / 4); // tile it densely across the field
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
  }
  return mat;
}

// ----- Hill ring: a grassy wall that closes off the world ------------------
// A circle of large, overlapping grassy mounds surrounds the play area. The
// player can't get past them and can't see over them — so there's no point
// building (or rendering) anything behind them. That's where the world ends.
function buildHills(grassMaterial) {
  const hills = new THREE.Group();
  // Slightly deeper, less shiny grass so the hills read as a backdrop.
  const hillMat = grassMaterial.clone();
  hillMat.color = new THREE.Color(0x6f9a4a);

  // A rounded mound = a squashed sphere, half-buried so only the dome shows.
  const baseGeo = new THREE.SphereGeometry(1, 18, 12);

  const rows = [
    { r: HILL_RING_R,        count: 30, h: HILL_HEIGHT,        spread: 95 },
    { r: HILL_RING_R + 70,   count: 26, h: HILL_HEIGHT * 1.25, spread: 120 }, // taller back row fills gaps
  ];

  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const a = (i / row.count) * Math.PI * 2 + Math.random() * 0.12;
      const r = row.r + (Math.random() - 0.5) * 40;
      const h = row.h * (0.8 + Math.random() * 0.5);
      const w = row.spread * (0.8 + Math.random() * 0.5);

      const mound = new THREE.Mesh(baseGeo, hillMat);
      mound.scale.set(w, h, w);
      // Bury the lower half so the dome rises smoothly out of the ground.
      mound.position.set(Math.cos(a) * r, -h * 0.45, Math.sin(a) * r);
      mound.castShadow = false;   // distant backdrop — no need to cast shadows
      mound.receiveShadow = true;
      hills.add(mound);
    }
  }
  scene.add(hills);
}

// ----- Place the houses in the clearings -----------------------------------
function buildHouses(houseGltf) {
  const template = houseGltf.scene;
  template.updateWorldMatrix(true, true);

  // Normalise: scale to a sensible height and sit the base on the ground.
  const box = new THREE.Box3().setFromObject(template);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const scale = HOUSE_HEIGHT / size.y;
  const footprint = Math.max(size.x, size.z) * scale; // for the tree-clear radius

  template.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  for (const spot of HOUSE_SPOTS) {
    const inst = template.clone(true);
    inst.position.set(-center.x, -box.min.y, -center.z); // recentre on its base

    const pivot = new THREE.Group();
    pivot.add(inst);
    pivot.scale.setScalar(scale);
    pivot.position.set(spot.x, 0, spot.z);
    pivot.rotation.y = spot.rot;
    scene.add(pivot);
    pivot.updateWorldMatrix(true, true); // raycasts need up-to-date world matrices

    // Reserve a clearing so the forest doesn't grow through the walls.
    houseZones.push({ x: spot.x, z: spot.z, r: footprint * 0.6 + 6 });
    // Register it as a solid the player collides against (walls block, doors don't).
    houseColliders.push({ obj: pivot, x: spot.x, z: spot.z });
  }
}

// ----- Mesh-level collision against the houses -----------------------------
// Raycasting against the real geometry (not a box) means walls stop the player
// while doorways and gaps let them through. Resolving X and Z separately lets
// the player slide along a wall instead of sticking to it.
const _ray = new THREE.Raycaster();
// Sample above STEP_UP so a stair riser isn't mistaken for a wall — short steps
// pass through and the floor-follow lifts the player up them instead.
const _heights = [STEP_UP + 0.25, 1.2, 1.7]; // shin / waist / head
let _activeColliders = [];             // houses near the player, refreshed each frame
let _playerFeet = 0;                   // current floor level, so walls are tested per-floor

function refreshColliders(px, pz) {
  _activeColliders.length = 0;
  for (const c of houseColliders) {
    if ((c.x - px) ** 2 + (c.z - pz) ** 2 < 45 * 45) _activeColliders.push(c.obj);
  }
}

// Nearest wall distance along (dirx,dirz) from (ox,oz), sampling a few heights
// and lateral offsets so the player's whole body — not just a point — is tested.
function wallDistance(ox, oz, dirx, dirz, maxd) {
  if (!_activeColliders.length) return Infinity;
  let min = Infinity;
  const perpx = -dirz, perpz = dirx;
  for (const off of [-PLAYER_RADIUS, 0, PLAYER_RADIUS]) {
    for (const h of _heights) {
      _ray.set(
        new THREE.Vector3(ox + perpx * off, _playerFeet + h, oz + perpz * off),
        new THREE.Vector3(dirx, 0, dirz)
      );
      _ray.far = maxd;
      const hits = _ray.intersectObjects(_activeColliders, true);
      if (hits.length) min = Math.min(min, hits[0].distance);
    }
  }
  return min;
}

// Height of the floor under (x, z), so the player can walk up stairs and stand
// on floors. Casts down from just above the player's feet; the first surface it
// finds (within one step) is what they stand on, else the ground at y = 0.
const _downRay = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
function floorHeight(x, z, currentFeet) {
  if (!_activeColliders.length) return 0;
  _downRay.set(new THREE.Vector3(x, currentFeet + STEP_UP, z), _down);
  _downRay.far = STEP_UP + 4;
  const hits = _downRay.intersectObjects(_activeColliders, true);
  return hits.length ? hits[0].point.y : 0;
}

// Resolve an intended (dx, dz) move into one that won't pass through a wall.
function resolveMove(prevX, prevZ, dx, dz) {
  if (dx !== 0) {
    const reach = Math.abs(dx) + PLAYER_RADIUS;
    const d = wallDistance(prevX, prevZ, Math.sign(dx), 0, reach);
    if (d < reach) dx = Math.max(0, d - PLAYER_RADIUS) * Math.sign(dx);
  }
  const nx = prevX + dx; // test Z from the already-resolved X so corners behave
  if (dz !== 0) {
    const reach = Math.abs(dz) + PLAYER_RADIUS;
    const d = wallDistance(nx, prevZ, 0, Math.sign(dz), reach);
    if (d < reach) dz = Math.max(0, d - PLAYER_RADIUS) * Math.sign(dz);
  }
  return [dx, dz];
}

// The boundary is invisible — nothing is drawn for it. It exists only as the
// movement clamp far away in update(). Just grass, in every direction.

// ----- Build the forest from the animated tree GLB -------------------------
const mixers = [];

function buildForest(treeGltf) {
  const template = treeGltf.scene;
  template.updateWorldMatrix(true, true);

  // The model is off-centre and ~75 units tall — normalise it so a clone sits
  // with its trunk base on the ground (y = 0) and is roughly TREE_HEIGHT tall.
  const box = new THREE.Box3().setFromObject(template);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const baseScale = TREE_HEIGHT / size.y;
  const clip = treeGltf.animations && treeGltf.animations[0];

  template.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;   // 280 morph-animated trees casting shadows is the
    o.receiveShadow = false; // single biggest cost — skip it for performance
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      m.side = THREE.DoubleSide;     // leaf cards are lit from both faces
      m.metalness = 0.0;             // foliage/bark is never metallic
      m.roughness = 1.0;
      m.flatShading = true;          // faceted, low-poly look
      m.needsUpdate = true;

      // The leaves arrive as glTF alpha-MASK (hard binary cutout) — that razor
      // edge is the "paper cut-out" look. Switch the cutout to alpha-to-coverage
      // so MSAA softens the leaf silhouettes into natural, feathered edges.
      if (m.alphaTest > 0 || m.transparent) {
        m.alphaToCoverage = true;
        m.transparent = false;       // keep it cutout, not blended (no sort artefacts)
        m.depthWrite = true;
        if (m.alphaTest > 0) m.alphaTest = Math.min(m.alphaTest, 0.3); // fuller canopy
        m.needsUpdate = true;
      }
    }
  });

  const forest = new THREE.Group();
  scene.add(forest);

  for (let i = 0; i < TREE_COUNT; i++) {
    // Even spread across a disk (sqrt keeps density uniform), with a clearing.
    const r = CLEARING + Math.sqrt(Math.random()) * (FOREST_RADIUS - CLEARING);
    const a = Math.random() * Math.PI * 2;
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;

    // Keep the house clearings clear — skip any tree landing on a footprint.
    let blocked = false;
    for (const z of houseZones) {
      if ((px - z.x) ** 2 + (pz - z.z) ** 2 < z.r * z.r) { blocked = true; break; }
    }
    if (blocked) continue;

    // clone(true) shares the heavy geometry but gives each tree its own
    // transform and morph-influence state so they can sway independently.
    const inst = template.clone(true);
    inst.position.set(-center.x, -box.min.y, -center.z); // recentre on trunk base

    const pivot = new THREE.Group();
    pivot.add(inst);
    pivot.position.set(px, 0, pz);
    pivot.rotation.y = Math.random() * Math.PI * 2;
    pivot.scale.setScalar(baseScale * (0.75 + Math.random() * 0.6)); // size variety
    forest.add(pivot);

    // Each tree sways on its own phase and speed so the canopy never pulses
    // in lockstep — that's what makes a crowd of trees read as a living forest.
    if (clip) {
      const mixer = new THREE.AnimationMixer(inst);
      const action = mixer.clipAction(clip);
      action.timeScale = 0.6 + Math.random() * 0.7;
      action.play();
      action.time = Math.random() * clip.duration;
      mixers.push({ mixer, x: px, z: pz }); // position lets us skip far-off trees
    }
  }
}

// ----- The monsters that endlessly hunt the player -------------------------
let monsterTemplate = null;   // { scene, clips, scale, baseY }
const monsters = [];          // live monsters: { root, mixer, action, hitMeshes }
let respawnTimer = 0;
let killCount = 0;
const killsEl = document.getElementById('kills');

function prepareMonsterTemplate(gltf) {
  const scene0 = gltf.scene;
  scene0.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(scene0);
  const size = new THREE.Vector3(); box.getSize(size);
  const scale = MONSTER_HEIGHT / size.y;
  monsterTemplate = { scene: scene0, clips: gltf.animations || [], scale, baseY: box.min.y };
}

function spawnMonster(angleOverride) {
  if (!monsterTemplate) return;
  // SkeletonUtils.clone preserves the skinned rig so each monster animates alone.
  const root = cloneSkinned(monsterTemplate.scene);
  root.scale.setScalar(monsterTemplate.scale);

  const hitMeshes = [];
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      hitMeshes.push(o); // bullets test against these
    }
  });

  // Appear out of the dark, at a (usually random) bearing and distance.
  const p = controls.getObject().position;
  const ang = angleOverride !== undefined ? angleOverride : Math.random() * Math.PI * 2;
  const r = MONSTER_SPAWN_MIN + Math.random() * (MONSTER_SPAWN_MAX - MONSTER_SPAWN_MIN);
  const lim = BOUNDARY_HALF - 5;
  const x = Math.max(-lim, Math.min(lim, p.x + Math.cos(ang) * r));
  const z = Math.max(-lim, Math.min(lim, p.z + Math.sin(ang) * r));
  root.position.set(x, -monsterTemplate.baseY * monsterTemplate.scale, z);
  scene.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const clips = monsterTemplate.clips;
  const clip = clips[MONSTER_CHASE_CLIP] || clips[0];
  let action = null;
  if (clip) { action = mixer.clipAction(clip); action.time = Math.random() * clip.duration; action.play(); }

  monsters.push({ root, mixer, action, hitMeshes });
}

// Drop a few right in front of the player at the start so they're immediately
// visible (the player begins looking down -Z).
function seedMonsters() {
  for (let i = 0; i < 3; i++) spawnMonster(-Math.PI / 2 + (i - 1) * 0.45);
}

// Swap the walk/run clip on every monster — wired to [ and ] so the right clip
// can be found live, since the clip names are unreadable.
const aniEl = document.getElementById('aniclip');
function setChaseClip(i) {
  const clips = monsterTemplate ? monsterTemplate.clips : [];
  if (!clips.length) return;
  MONSTER_CHASE_CLIP = ((i % clips.length) + clips.length) % clips.length;
  const clip = clips[MONSTER_CHASE_CLIP];
  for (const m of monsters) {
    m.mixer.stopAllAction();
    m.action = m.mixer.clipAction(clip);
    m.action.time = Math.random() * clip.duration;
    m.action.play();
  }
  if (aniEl) aniEl.textContent = `anim ${MONSTER_CHASE_CLIP} / ${clips.length - 1}`;
}

const _toPlayer = new THREE.Vector3();
function updateMonsters(dt) {
  // Keep the horde topped up.
  if (monsterTemplate && monsters.length < MONSTER_MAX) {
    respawnTimer -= dt;
    if (respawnTimer <= 0) { spawnMonster(); respawnTimer = MONSTER_RESPAWN; }
  }

  const p = controls.getObject().position;
  for (const m of monsters) {
    _toPlayer.set(p.x - m.root.position.x, 0, p.z - m.root.position.z);
    const dist = _toPlayer.length() || 1;
    m.root.rotation.y = Math.atan2(_toPlayer.x, _toPlayer.z) + MONSTER_FACING;
    const step = MONSTER_SPEED * dt;            // walk relentlessly toward the player
    m.root.position.x += (_toPlayer.x / dist) * step;
    m.root.position.z += (_toPlayer.z / dist) * step;
    m.mixer.update(dt);
  }
}

function killMonster(m) {
  explodeAt(m.root.position);
  scene.remove(m.root);
  m.mixer.stopAllAction();
  const i = monsters.indexOf(m);
  if (i >= 0) monsters.splice(i, 1);
  killCount++;
  if (killsEl) killsEl.textContent = killCount;
}

// ----- Gore / explosion effect ---------------------------------------------
const effects = [];
const _gibGeo = new THREE.IcosahedronGeometry(0.18, 0);
const _gibMat = new THREE.MeshStandardMaterial({ color: 0x8a1111, roughness: 0.85, emissive: 0x330303 });

function explodeAt(pos) {
  const group = new THREE.Group();
  const parts = [];
  for (let i = 0; i < 26; i++) {
    const gib = new THREE.Mesh(_gibGeo, _gibMat);
    gib.position.copy(pos);
    gib.position.y += 1.0;
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 9,
      Math.random() * 8 + 2,
      (Math.random() - 0.5) * 9
    );
    gib.scale.setScalar(0.5 + Math.random());
    group.add(gib);
    parts.push({ mesh: gib, v });
  }
  // A brief red flash of light at the burst.
  const flash = new THREE.PointLight(0xff3020, 30, 16, 2);
  flash.position.copy(pos); flash.position.y += 1.2;
  group.add(flash);
  scene.add(group);
  effects.push({ group, parts, flash, life: 0, max: 0.9 });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life += dt;
    for (const part of e.parts) {
      part.v.y -= 22 * dt;                 // gravity
      part.mesh.position.addScaledVector(part.v, dt);
      part.mesh.rotation.x += dt * 6;
      part.mesh.rotation.y += dt * 4;
    }
    if (e.flash) e.flash.intensity = Math.max(0, 30 * (1 - e.life / 0.25));
    if (e.life >= e.max) {
      scene.remove(e.group);
      effects.splice(i, 1);
    }
  }
}

// ----- The gun (viewmodel + shooting) --------------------------------------
// We don't use the model's built-in Fire animation — the recoil kick below is
// our own.
let gun = null;
let fireCooldown = 0;
const muzzleFlash = new THREE.PointLight(0xffd070, 0, 12, 2);
muzzleFlash.position.set(0.16, -0.12, -0.7);
camera.add(muzzleFlash);

function buildGun(gltf) {
  gun = gltf.scene;
  gun.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; o.renderOrder = 999; } });
  gun.scale.setScalar(GUN_SCALE);
  gun.position.copy(GUN_POS);
  gun.rotation.copy(GUN_ROT);
  camera.add(gun); // parent to the camera so it's a first-person viewmodel
}

const _shootRay = new THREE.Raycaster();
_shootRay.far = SHOOT_RANGE;
const _screenCentre = new THREE.Vector2(0, 0);

function shoot() {
  if (fireCooldown > 0) return;
  fireCooldown = FIRE_COOLDOWN;

  // Muzzle flash + our own recoil kick (no model animation).
  muzzleFlash.intensity = 12;
  if (gun) gun.position.z = GUN_POS.z + 0.06; // kicked back; eased forward in update

  // Hitscan from the centre of the screen.
  _shootRay.setFromCamera(_screenCentre, camera);
  let best = null, bestDist = Infinity;
  for (const m of monsters) {
    const hits = _shootRay.intersectObjects(m.hitMeshes, false);
    if (hits.length && hits[0].distance < bestDist) { bestDist = hits[0].distance; best = m; }
  }
  if (best) killMonster(best);
}

function updateGun(dt) {
  if (fireCooldown > 0) fireCooldown -= dt;
  if (muzzleFlash.intensity > 0) muzzleFlash.intensity = Math.max(0, muzzleFlash.intensity - 60 * dt);
  if (gun) gun.position.z += (GUN_POS.z - gun.position.z) * Math.min(1, dt * 12); // ease recoil back
}

document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && controls.isLocked) shoot();
});

// ----- Movement with boundary clamp ----------------------------------------
const velocity = new THREE.Vector3();   // horizontal velocity in camera-local axes
let bobPhase = 0, bobAmp = 0;           // head-bob state for the walk/run feel

function update(dt) {
  if (!controls.isLocked) return;
  const obj = controls.getObject();
  const speed = keys.run ? RUN_SPEED : WALK_SPEED;

  // Desired direction (normalised) from the keys.
  let wishX = Number(keys.right) - Number(keys.left);
  let wishZ = Number(keys.forward) - Number(keys.back);
  const moving = wishX !== 0 || wishZ !== 0;
  if (moving) { const l = Math.hypot(wishX, wishZ); wishX /= l; wishZ /= l; }

  // Accelerate toward the target velocity so starting/stopping has weight.
  const k = Math.min(1, ACCEL * dt);
  velocity.x += ((moving ? wishX * speed : 0) - velocity.x) * k;
  velocity.z += ((moving ? wishZ * speed : 0) - velocity.z) * k;

  // Apply the intended move, then push it out of any house walls it hits.
  const prevX = obj.position.x, prevZ = obj.position.z;
  controls.moveRight(velocity.x * dt);
  controls.moveForward(velocity.z * dt);

  refreshColliders(prevX, prevZ);
  _playerFeet = obj.position.y - PLAYER_HEIGHT; // test walls at the current floor level
  let [dx, dz] = resolveMove(prevX, prevZ, obj.position.x - prevX, obj.position.z - prevZ);
  obj.position.x = prevX + dx;
  obj.position.z = prevZ + dz;

  // Hard, invisible boundary clamp — far away, the player simply cannot pass.
  const limit = BOUNDARY_HALF;
  obj.position.x = Math.max(-limit, Math.min(limit, obj.position.x));
  obj.position.z = Math.max(-limit, Math.min(limit, obj.position.z));

  // Follow the floor so stairs and raised floors are walkable.
  const curFeet = obj.position.y - PLAYER_HEIGHT;
  const floor = floorHeight(obj.position.x, obj.position.z, curFeet);

  // Head-bob: oscillate the eye height while actually moving — gait feel.
  const horizSpeed = Math.hypot(dx, dz) / dt;
  const movingNow = horizSpeed > 0.4;
  if (movingNow) bobPhase += dt * (keys.run ? 13 : 9);
  const targetAmp = movingNow ? (keys.run ? 0.10 : 0.055) : 0;
  bobAmp += (targetAmp - bobAmp) * Math.min(1, dt * 10);
  obj.position.y = floor + PLAYER_HEIGHT + Math.sin(bobPhase) * bobAmp;
}

// ----- Loop ----------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);

  // Only sway trees near the player — distant trees aren't worth the CPU.
  const pp = controls.getObject().position;
  const animR2 = 95 * 95;
  for (let i = 0; i < mixers.length; i++) {
    const t = mixers[i];
    if ((t.x - pp.x) ** 2 + (t.z - pp.z) ** 2 < animR2) t.mixer.update(dt);
  }

  updateMonsters(dt);                                           // hunt the player
  updateEffects(dt);                                            // gibs + flashes
  updateGun(dt);                                                // recoil, flash, fire anim
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----- Bootstrap -----------------------------------------------------------
const loader = new GLTFLoader();
const load = (url, onProgress) => new Promise((resolve, reject) =>
  loader.load(url, resolve, onProgress, reject));

function start() {
  loadingEl.style.display = 'none';
  overlay.style.display = 'flex';
  animate();
}

(async () => {
  // 1) Grass ground.
  try {
    const floor = await load('./assets/forested_floor.glb', (xhr) => {
      if (xhr.total) loadingEl.textContent =
        `Loading the grass… ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
    });
    const grassMat = grassMaterialFromGLB(floor);
    buildGround(grassMat);
    buildHills(grassMat);
  } catch (err) {
    console.error('Failed to load grass GLB:', err);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4f7a32, roughness: 1 });
    buildGround(grassMat);
    buildHills(grassMat);
  }

  // 2) The houses (placed first so the forest can leave room for them).
  try {
    loadingEl.textContent = 'Building the houses…';
    const house = await load('./assets/psx_abandoned_house.glb', (xhr) => {
      if (xhr.total) loadingEl.textContent =
        `Building the houses… ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
    });
    buildHouses(house);
  } catch (err) {
    console.error('Failed to load house GLB:', err);
  }

  // 3) The forest of animated trees.
  try {
    loadingEl.textContent = 'Planting the forest…';
    const tree = await load('./assets/tree_animate.glb', (xhr) => {
      if (xhr.total) loadingEl.textContent =
        `Planting the forest… ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
    });
    buildForest(tree);
  } catch (err) {
    console.error('Failed to load tree GLB:', err); // grass still works without trees
  }

  // 4) The gun viewmodel.
  try {
    loadingEl.textContent = 'Loading the sidearm…';
    const colt = await load('./assets/colt_m1911.glb');
    buildGun(colt);
  } catch (err) {
    console.error('Failed to load gun GLB:', err);
  }

  // 5) The monsters that endlessly hunt the player.
  try {
    loadingEl.textContent = 'Waking the horde…';
    const zombie = await load('./assets/zombie_licker.glb');
    prepareMonsterTemplate(zombie);
    seedMonsters(); // a few visible from the first moment
    if (aniEl) aniEl.textContent = `anim ${MONSTER_CHASE_CLIP} / ${monsterTemplate.clips.length - 1}`;
  } catch (err) {
    console.error('Failed to load monster GLB:', err);
  }

  start();
})();
