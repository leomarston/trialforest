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
const TREE_COUNT     = 520;  // dense forest filling the bowl inside the hills
const FOREST_RADIUS  = 340;  // trees fill the play area up to the foot of the hills
const CLEARING       = 10;   // open breathing room around the player's start
const TREE_HEIGHT     = 17;  // target height of an average tree (world units)

// ----- Hill ring constants -------------------------------------------------
const HILL_RING_R    = 380;  // distance from centre to the wall of hills
const HILL_HEIGHT    = 70;   // tall enough to hide everything (and the sky) behind

// ----- House constants -----------------------------------------------------
const HOUSE_HEIGHT   = 16;   // target height of a placed house (world units)
const HOUSE_SPOTS = [        // three empty clearings to drop a house into
  { x:  140, z:  -70, rot:  0.5 },
  { x: -160, z:   95, rot: -1.1 },
  { x:   45, z:  175, rot:  2.4 },
];
const houseZones = [];       // footprints trees must keep clear of

// ----- Renderer / scene ----------------------------------------------------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0xbfe3f0, 300, 950);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, PLAYER_HEIGHT, 0);

// ----- Lighting ------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x4a6b2f, 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
sun.position.set(120, 180, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 600;
const s = 220;
sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
sun.shadow.camera.top = s;   sun.shadow.camera.bottom = -s;
scene.add(sun);
scene.add(sun.target);

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
document.addEventListener('keydown', (e) => setKey(e, true));
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

    // Reserve a clearing so the forest doesn't grow through the walls.
    houseZones.push({ x: spot.x, z: spot.z, r: footprint * 0.7 + 6 });
  }
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

    controls.moveRight(-velocity.x * dt);
    controls.moveForward(-velocity.z * dt);

    // Hard, invisible boundary clamp — far away, the player simply cannot pass.
    const obj = controls.getObject();
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
    const house = await load('./assets/old_house.glb', (xhr) => {
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

  start();
})();
