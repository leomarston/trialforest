import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ----- World constants -----------------------------------------------------
const GROUND_HALF   = 600;   // how far the green grass visibly extends
const BOUNDARY_HALF = 90;    // the invisible limit the player cannot cross
const PLAYER_HEIGHT = 1.7;
const WALK_SPEED    = 22;
const RUN_SPEED     = 44;

// ----- Renderer / scene ----------------------------------------------------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0xbfe3f0, 120, 520);

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
const hud = document.getElementById('hud');
const warning = document.getElementById('warning');

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

// ----- Boundary: visible marker + invisible wall ---------------------------
function buildBoundary() {
  const group = new THREE.Group();

  // A low translucent "force-field" wall around the limit so the player can
  // see where the edge is, while the green grass continues beyond it.
  const wallHeight = 6;
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0x9fe0a0, transparent: true, opacity: 0.18,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const len = BOUNDARY_HALF * 2;
  const sides = [
    { pos: [0, wallHeight / 2,  BOUNDARY_HALF], rotY: 0 },
    { pos: [0, wallHeight / 2, -BOUNDARY_HALF], rotY: 0 },
    { pos: [ BOUNDARY_HALF, wallHeight / 2, 0], rotY: Math.PI / 2 },
    { pos: [-BOUNDARY_HALF, wallHeight / 2, 0], rotY: Math.PI / 2 },
  ];
  for (const sdef of sides) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, wallHeight), wallMat);
    wall.position.set(...sdef.pos);
    wall.rotation.y = sdef.rotY;
    group.add(wall);
  }

  // Glowing edge line along the top of the boundary.
  const h = BOUNDARY_HALF;
  const pts = [
    new THREE.Vector3(-h, wallHeight, -h), new THREE.Vector3( h, wallHeight, -h),
    new THREE.Vector3( h, wallHeight,  h), new THREE.Vector3(-h, wallHeight,  h),
    new THREE.Vector3(-h, wallHeight, -h),
  ];
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x6fffa0 }));
  group.add(line);

  // Fence posts at intervals to make the limit feel physical.
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
  const postGeo = new THREE.CylinderGeometry(0.35, 0.45, wallHeight, 8);
  const step = BOUNDARY_HALF / 6;
  for (let i = -BOUNDARY_HALF; i <= BOUNDARY_HALF + 0.1; i += step) {
    for (const edge of [-BOUNDARY_HALF, BOUNDARY_HALF]) {
      const p1 = new THREE.Mesh(postGeo, postMat);
      p1.position.set(i, wallHeight / 2, edge); p1.castShadow = true; group.add(p1);
      const p2 = new THREE.Mesh(postGeo, postMat);
      p2.position.set(edge, wallHeight / 2, i); p2.castShadow = true; group.add(p2);
    }
  }

  scene.add(group);
}

// A few scattered decorative trees/rocks outside the boundary so the
// "you can see it but can't reach it" beyond-the-edge feels alive.
function scatterDecor() {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 1 });
  const leafMat  = new THREE.MeshStandardMaterial({ color: 0x2f6e30, roughness: 1 });
  const rng = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 140; i++) {
    // place beyond the boundary, within the visible field
    let x, z;
    do { x = rng(-GROUND_HALF + 20, GROUND_HALF - 20); z = rng(-GROUND_HALF + 20, GROUND_HALF - 20); }
    while (Math.abs(x) < BOUNDARY_HALF + 8 && Math.abs(z) < BOUNDARY_HALF + 8);

    const tree = new THREE.Group();
    const th = rng(6, 12);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, th, 6), trunkMat);
    trunk.position.y = th / 2; trunk.castShadow = true;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(rng(2.5, 4.5), rng(6, 10), 7), leafMat);
    leaves.position.y = th + 2; leaves.castShadow = true;
    tree.add(trunk, leaves);
    tree.position.set(x, 0, z);
    scene.add(tree);
  }
}

// ----- Movement with boundary clamp ----------------------------------------
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let warnTimer = 0;

function showWarning() {
  warning.classList.add('show');
  warnTimer = 1.0;
}

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

    // Hard boundary clamp — the player simply cannot pass.
    const obj = controls.getObject();
    const limit = BOUNDARY_HALF - 1.5;
    let hit = false;
    if (obj.position.x >  limit) { obj.position.x =  limit; hit = true; }
    if (obj.position.x < -limit) { obj.position.x = -limit; hit = true; }
    if (obj.position.z >  limit) { obj.position.z =  limit; hit = true; }
    if (obj.position.z < -limit) { obj.position.z = -limit; hit = true; }
    if (hit) showWarning();

    obj.position.y = PLAYER_HEIGHT;
  }

  if (warnTimer > 0) {
    warnTimer -= dt;
    if (warnTimer <= 0) warning.classList.remove('show');
  }

  const p = controls.getObject().position;
  hud.innerHTML =
    `Position&nbsp; x:${p.x.toFixed(1)}&nbsp; z:${p.z.toFixed(1)}<br>` +
    `Boundary&nbsp; ±${BOUNDARY_HALF}&nbsp; · Field&nbsp; ±${GROUND_HALF}`;
}

// ----- Loop ----------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  update(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----- Bootstrap -----------------------------------------------------------
new GLTFLoader().load(
  './assets/forested_floor.glb',
  (gltf) => {
    buildGround(grassMaterialFromGLB(gltf));
    buildBoundary();
    scatterDecor();
    loadingEl.style.display = 'none';
    overlay.style.display = 'flex';
    animate();
  },
  (xhr) => {
    if (xhr.total) loadingEl.textContent =
      `Loading the forest floor… ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
  },
  (err) => {
    console.error('Failed to load GLB:', err);
    // Fallback: plain green field so the world still works.
    buildGround(new THREE.MeshStandardMaterial({ color: 0x4f7a32, roughness: 1 }));
    buildBoundary();
    scatterDecor();
    loadingEl.style.display = 'none';
    overlay.style.display = 'flex';
    animate();
  }
);
