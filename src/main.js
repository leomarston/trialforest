import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ----- World constants -----------------------------------------------------
const GROUND_HALF   = 700;   // ground only needs to reach under the hill ring
const BOUNDARY_HALF = 250;   // invisible limit: a 500m × 500m square the player can roam
const PLAYER_HEIGHT = 1.7;
const WALK_SPEED    = 22;
const RUN_SPEED     = 44;

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
const MONSTER_CHASE_CLIP  = 2;        // index of the walk/run clip
const MONSTER_ATTACK_CLIP = 0;        // index of the attack/lunge clip
const MONSTER_SPEED       = 9;        // slower than the player can run (escapable)
const MONSTER_HEIGHT      = 2.4;      // big enough to clearly spot across the clearing
const MONSTER_SPAWN       = { x: 0, z: -22 };  // right in front of the player at start
const MONSTER_ATTACK_RANGE = 2.0;     // how close before it lunges
const MONSTER_FACING      = 0;        // yaw offset so it faces the player (flip by Math.PI if backwards)

// ----- Renderer / scene ----------------------------------------------------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
moon.shadow.mapSize.set(2048, 2048);
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
const torch = new THREE.SpotLight(0xffd8a0, 0, 90, Math.PI / 5, 0.35, 1.2);
torch.position.set(0.2, -0.2, 0.2);
torch.target.position.set(0, 0, -1);
torch.castShadow = true;
torch.shadow.mapSize.set(1024, 1024);
torch.shadow.camera.near = 0.5;
torch.shadow.camera.far = 90;
const torchGlow = new THREE.PointLight(0xffb060, 0, 6, 2);
torchGlow.position.set(0, -0.3, 0);

camera.add(torch);
camera.add(torch.target);
camera.add(torchGlow);
scene.add(camera); // so the camera-parented lights live in the scene graph

let torchOn = true;
const TORCH_INTENSITY = 5.0, TORCH_GLOW = 0.6;
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
controls.addEventListener('lock',   () => (overlay.style.display = 'none'));
controls.addEventListener('unlock', () => (overlay.style.display = 'flex'));

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
  if (e.code === 'KeyF' && !e.repeat) setTorch(!torchOn); // toggle the torch
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
      mound.castShadow = true;
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
const _heights = [0.4, 1.0, 1.55];     // knee / waist / head — catch low and high walls
let _activeColliders = [];             // houses near the player, refreshed each frame

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
        new THREE.Vector3(ox + perpx * off, h, oz + perpz * off),
        new THREE.Vector3(dirx, 0, dirz)
      );
      _ray.far = maxd;
      const hits = _ray.intersectObjects(_activeColliders, true);
      if (hits.length) min = Math.min(min, hits[0].distance);
    }
  }
  return min;
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
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      m.side = THREE.DoubleSide;     // leaf cards are lit from both faces
      m.metalness = 0.0;             // foliage/bark is never metallic
      m.roughness = 1.0;

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
      mixers.push(mixer);
    }
  }
}

// ----- The monster that hunts the player -----------------------------------
let monster = null;
let monsterMixer = null;
const monsterActions = {};
let monsterState = '';

function setMonsterAction(name, fade = 0.25) {
  const next = monsterActions[name];
  if (!next || monsterState === name) return;
  for (const key in monsterActions) {
    if (monsterActions[key] !== next) monsterActions[key].fadeOut(fade);
  }
  next.reset().fadeIn(fade).play();
  monsterState = name;
}

function buildMonster(gltf) {
  monster = gltf.scene;
  monster.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; }
  });

  // Scale it down to be shorter than the player, then sit its feet on the
  // ground and drop it at the spawn point.
  let box = new THREE.Box3().setFromObject(monster);
  const size = new THREE.Vector3(); box.getSize(size);
  monster.scale.setScalar(MONSTER_HEIGHT / size.y);
  box = new THREE.Box3().setFromObject(monster); // recompute after scaling
  monster.position.set(MONSTER_SPAWN.x, -box.min.y, MONSTER_SPAWN.z);
  scene.add(monster);

  const clips = gltf.animations || [];
  const pick = (i) => clips[i] || clips[0];
  monsterMixer = new THREE.AnimationMixer(monster);
  monsterActions.chase  = monsterMixer.clipAction(pick(MONSTER_CHASE_CLIP));
  monsterActions.attack = monsterMixer.clipAction(pick(MONSTER_ATTACK_CLIP));
  setMonsterAction('chase');
}

const _toPlayer = new THREE.Vector3();
function updateMonster(dt) {
  if (!monster) return;
  const p = controls.getObject().position;
  _toPlayer.set(p.x - monster.position.x, 0, p.z - monster.position.z);
  const dist = _toPlayer.length();

  // Always turn to face the player.
  monster.rotation.y = Math.atan2(_toPlayer.x, _toPlayer.z) + MONSTER_FACING;

  if (dist > MONSTER_ATTACK_RANGE) {
    setMonsterAction('chase');
    const step = Math.min(MONSTER_SPEED * dt, dist - MONSTER_ATTACK_RANGE);
    monster.position.x += (_toPlayer.x / dist) * step;
    monster.position.z += (_toPlayer.z / dist) * step;
  } else {
    setMonsterAction('attack'); // close enough — lunge
  }

  monsterMixer.update(dt);
}

// ----- Movement with boundary clamp ----------------------------------------
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

function update(dt) {
  if (controls.isLocked) {
    const speed = (keys.run ? RUN_SPEED : WALK_SPEED);
    velocity.x -= velocity.x * 10 * dt;
    velocity.z -= velocity.z * 10 * dt;

    direction.z = Number(keys.forward) - Number(keys.back);
    direction.x = Number(keys.right) - Number(keys.left);
    direction.normalize();

    if (keys.forward || keys.back)  velocity.z -= direction.z * speed * dt * 10;
    if (keys.left || keys.right)    velocity.x -= direction.x * speed * dt * 10;

    // Apply the intended move, then push it out of any house walls it hits.
    const obj = controls.getObject();
    const prevX = obj.position.x, prevZ = obj.position.z;
    controls.moveRight(-velocity.x * dt);
    controls.moveForward(-velocity.z * dt);

    refreshColliders(prevX, prevZ);
    let [dx, dz] = resolveMove(prevX, prevZ, obj.position.x - prevX, obj.position.z - prevZ);
    obj.position.x = prevX + dx;
    obj.position.z = prevZ + dz;

    // Hard, invisible boundary clamp — far away, the player simply cannot pass.
    const limit = BOUNDARY_HALF;
    obj.position.x = Math.max(-limit, Math.min(limit, obj.position.x));
    obj.position.z = Math.max(-limit, Math.min(limit, obj.position.z));
    obj.position.y = PLAYER_HEIGHT;
  }
}

// ----- Loop ----------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  for (let i = 0; i < mixers.length; i++) mixers[i].update(dt); // sway the trees
  updateMonster(dt);                                            // hunt the player
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

  // 3) The monster that chases the player.
  try {
    loadingEl.textContent = 'Waking the monster…';
    const zombie = await load('./assets/zombie_licker.glb');
    buildMonster(zombie);
  } catch (err) {
    console.error('Failed to load monster GLB:', err);
  }

  start();
})();
