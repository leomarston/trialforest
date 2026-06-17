import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ----- World constants -----------------------------------------------------
const GROUND_HALF   = 6000;  // how far the green grass visibly extends
const BOUNDARY_HALF = 5000;  // the invisible limit the player cannot cross — far, far away
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
scene.fog = new THREE.Fog(0xbfe3f0, 400, 4000);

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

// The boundary is invisible — nothing is drawn for it. It exists only as the
// movement clamp far away in update(). Just grass, in every direction.

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
    loadingEl.style.display = 'none';
    overlay.style.display = 'flex';
    animate();
  }
);
