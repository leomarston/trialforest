import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// ----- World constants -----------------------------------------------------
const GROUND_HALF   = 700;   // ground only needs to reach under the hill ring
const BOUNDARY_HALF = 250;   // invisible limit: a 500m × 500m square the player can roam
const PLAYER_HEIGHT = 3.2;   // taller viewpoint
const STEP_UP       = 1.0;   // tallest step the player can climb (stairs/landings)
const WALK_SPEED    = 4.5;   // metres/sec — a real walking pace
const RUN_SPEED     = 9.0;   // sprinting (hold Shift)
const ACCEL         = 9;     // how quickly you reach top speed (gives weight)
const PLAYER_MAX_HP = 4;     // hits the player can take before dying
const JUMP_VEL      = 6.0;   // a small hop
const GRAVITY       = 20;    // fall acceleration

// ----- Forest constants ----------------------------------------------------
const TREE_COUNT     = 280;  // a sparser forest — room to breathe between trees
const FOREST_RADIUS  = 340;  // trees fill the play area up to the foot of the hills
const CLEARING       = 10;   // open breathing room around the player's start
const TREE_HEIGHT     = 17;  // target height of an average tree (world units)

// ----- Structure constants (count + places randomised each game) ------------
const HOUSE_HEIGHT   = 18;   // target height of an abandoned house
const HOUSE_COUNT    = [7, 11];  // random count range per game
const HUT_HEIGHT     = 12;   // target height of a wooden hut (a bit bigger now)
const HUT_COUNT      = [8, 12];
const QUONSET_HEIGHT = 11;   // target height of the arched quonset hut (bigger now)
const QUONSET_COUNT  = [5, 8];
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
// Tiny seeded PRNG (mulberry32) — used to lay the forest out the same each game.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const houseZones = [];       // footprints trees must keep clear of
const houseColliders = [];   // { obj, x, z } — house meshes the player collides with
const PLAYER_RADIUS  = 0.6;  // how far the player's body keeps off the walls

// Things to hide when far away (purely for performance). The cull radius sits
// well beyond the fog (which is solid black by ~55 units), so anything we hide
// is already invisible — the player never sees it pop.
const cullables = [];        // { obj, x, z }
const CULL_DIST2 = 82 * 82;

// ----- Hill ring constants -------------------------------------------------
const HILL_RING_R    = 380;  // distance from centre to the wall of hills
const HILL_HEIGHT    = 70;   // tall enough to hide everything (and the sky) behind

// ----- Monster constants ---------------------------------------------------
// The GLB ships 18 animation clips, but their names are GBK-garbled and can't
// be read, so the chase/attack clips are selected by index — tweak these two
// if the wrong motion plays.
let   MONSTER_CHASE_CLIP  = 8;        // the crawl-on-all-fours clip ([ and ] cycle it live)
const MONSTER_SPEED       = 5.5;      // a touch slower than your run (escapable)
const MONSTER_HEIGHT      = 18.5;     // towering — 10× the player's size
const MONSTER_FACING      = 0;        // yaw offset so it faces the player (flip by Math.PI if backwards)
const MONSTER_MAX         = 7;        // most that can hunt you at once
const MONSTER_SPAWN_MIN   = 22;       // they appear out of the dark, this close…
const MONSTER_SPAWN_MAX   = 50;       // …to this far (inside the fog so you see them)
const MONSTER_RESPAWN     = 5.0;      // a new monster every 5 seconds (up to the max)
const MONSTER_TOUCH       = 3.2;      // how close counts as touching the player
const DAMAGE_COOLDOWN     = 1.2;      // seconds of grace between hits
const MONSTER_DESPAWN     = 90;       // if you outrun one past this, recycle it closer
const MONSTER_RADIUS      = 1.6;      // body radius for wall collision
const MONSTER_STEP        = 1.6;      // how tall a step a monster can climb
const _mHeights = [0.7, 2.2, 4.5];    // body heights sampled for monster wall collision

// ----- Gun / combat constants ----------------------------------------------
const GUN_SCALE = 0.009;                       // colt model is ~46 units long
const GUN_POS   = new THREE.Vector3( 0.2, -0.22, -0.3); // close to the camera so it reads as held
const GUN_ROT   = new THREE.Euler(0, -Math.PI / 2, 0); // point the barrel forward
const SHOOT_RANGE = 300;                       // how far a bullet reaches
const FIRE_COOLDOWN = 0.18;                     // seconds between shots

// ----- Ammo / reloading -----------------------------------------------------
const MAG_SIZE        = 12;   // rounds per magazine before you must reload
const RESERVE_START   = 24;   // spare rounds you begin with
const RELOAD_TIME     = 1.1;  // seconds a reload takes

// ----- Pickups --------------------------------------------------------------
const AMMO_PER_PICKUP   = 12;  // spare rounds per ammo box
const AMMO_PICKUPS      = 14;  // ammo boxes around the map at once
const AMMO_RESPAWN      = 6;   // seconds between fresh ammo boxes
const HEALTH_PER_PICKUP = 1;   // HP restored per medkit
const HEALTH_PICKUPS    = 5;   // medkits around the map at once
const HEALTH_RESPAWN    = 14;  // seconds between fresh medkits
const PICKUP_RADIUS     = 2.4; // how close to walk to grab one

// ----- Stamina --------------------------------------------------------------
const STAMINA_MAX     = 6.0;  // seconds of continuous sprint
const STAMINA_DRAIN   = 1.0;  // per second while sprinting
const STAMINA_REGEN   = 0.6;  // per second while not
const STAMINA_RECOVER = 2.0;  // stamina needed to sprint again after exhaustion

// ----- Torch battery (Outlast-style) ----------------------------------------
const BATTERY_MAX     = 90;   // seconds a battery lasts with the torch on
const BATTERY_SPARES  = 2;    // spare batteries you start with
const BATTERY_PICKUPS = 5;    // batteries lying around at once
const BATTERY_RESPAWN = 18;   // seconds between fresh batteries

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

// Battery: the torch drains it; at empty it dies until you load a spare.
let batteryCharge = BATTERY_MAX;
let spareBatteries = BATTERY_SPARES;
const battFillEl  = document.getElementById('batteryfill');
const battCountEl = document.getElementById('batterycount');
function updateBatteryHUD() {
  if (battFillEl)  battFillEl.style.width = `${(batteryCharge / BATTERY_MAX) * 100}%`;
  if (battCountEl) battCountEl.textContent = spareBatteries;
  refreshWarnings();
}

// Diegetic low-resource warnings — pop up once in the centre, then fade.
const warnEl = document.getElementById('warn');
function showToast(text) {
  if (!warnEl) return;
  warnEl.textContent = text;
  warnEl.classList.remove('show'); void warnEl.offsetWidth; // restart the animation
  warnEl.classList.add('show');
}
let wasLowAmmo = false, wasLowBatt = false;
function refreshWarnings() {
  const lowAmmo = typeof reserveAmmo === 'number' && reserveAmmo <= 0;
  const lowBatt = typeof spareBatteries === 'number' && spareBatteries <= 0;
  if (lowAmmo && !wasLowAmmo)      showToast('LOW ON AMMO');
  else if (lowBatt && !wasLowBatt) showToast('LOW ON BATTERY');
  wasLowAmmo = lowAmmo; wasLowBatt = lowBatt;
}

function applyTorch() {
  const lit = torchOn && batteryCharge > 0;
  torch.intensity = lit ? TORCH_INTENSITY : 0;
  torchGlow.intensity = lit ? TORCH_GLOW : 0;
}
function setTorch(on) {
  if (on && batteryCharge <= 0) {        // dead torch — load a spare if we have one
    if (spareBatteries > 0) { spareBatteries--; batteryCharge = BATTERY_MAX; updateBatteryHUD(); }
    else return;                          // nothing to power it
  }
  torchOn = on;
  applyTorch();
}
function updateBattery(dt) {
  if (torchOn && batteryCharge > 0) {
    batteryCharge = Math.max(0, batteryCharge - dt * 2); // drains twice as fast
    if (batteryCharge === 0) {            // just died
      if (spareBatteries > 0) { spareBatteries--; batteryCharge = BATTERY_MAX; } // auto-swap
      else applyTorch();                  // out — lights go black
    }
    updateBatteryHUD();
  }
}
setTorch(true);

// ----- Controls ------------------------------------------------------------
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

const overlay = document.getElementById('overlay');
const loadingEl = document.getElementById('loading');

// ----- Main menu ------------------------------------------------------------
const menuEl = document.getElementById('menu');
function beginGame() {            // exactly what pressing START does
  if (menuEl) menuEl.style.display = 'none';
  controls.lock();               // grab the pointer (valid gesture from the click)
  boot();                        // show the loading screen and load the game
}
document.getElementById('btn-start')?.addEventListener('click', beginGame);

// "Play again" reloads with this flag, then runs START for you on the fresh page.
if (sessionStorage.getItem('woods-autostart') === '1') {
  sessionStorage.removeItem('woods-autostart');
  beginGame();
}

// ----- Sound effects --------------------------------------------------------
// Each sound keeps a small pool of <audio> clones so rapid/overlapping plays
// (gunshots, multiple deaths) don't cut each other off.
const fxClips = []; // { a, base } — every sfx clip, for the FX volume slider
function makeSfx(file, { volume = 1, pool = 1 } = {}) {
  const clips = [];
  for (let i = 0; i < pool; i++) {
    const a = new Audio(`./assets/sfx/${file}`);
    a.volume = volume; a.preload = 'auto';
    clips.push(a);
    fxClips.push({ a, base: volume });
  }
  let idx = 0;
  return {
    play() {
      const a = clips[idx]; idx = (idx + 1) % clips.length;
      try { a.currentTime = 0; a.play().catch(() => {}); } catch (e) { /* ignore */ }
    },
  };
}
const sfx = {
  gunshot: makeSfx('gunshotfx.mp3',   { volume: 0.45, pool: 5 }),
  reload:  makeSfx('gunreloadfx.mp3', { volume: 0.7,  pool: 2 }),
  death:   makeSfx('monsterdeath.mp3',{ volume: 0.8,  pool: 3 }),
  damage:  makeSfx('monsterdamage.mp3',{ volume: 0.85, pool: 2 }),
  growl:   makeSfx('monstergrowl.mp3',{ volume: 0.55, pool: 3 }),
};

// Looping horror ambience. Browsers block autoplay until a user gesture, so it
// kicks off on the first pointer-lock (the click to start the game).
const music = new Audio('./assets/sfx/horror_background.mp3');
music.loop = true;
music.volume = 0.35;
music.preload = 'auto';
let musicStarted = false;
function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  music.play().catch(() => { musicStarted = false; }); // retry on a later gesture if blocked
}

overlay.addEventListener('click', () => { if (!playerDead) controls.lock(); });
controls.addEventListener('lock',   () => {
  overlay.style.display = 'none';
  document.body.classList.add('playing'); // show crosshair, hearts + kill count
  startMusic();                            // begin the looping ambience
});
controls.addEventListener('unlock', () => {
  if (!playerDead) overlay.style.display = 'flex'; // (death screen handles the dead case)
  document.body.classList.remove('playing');
});

// ----- Settings (sensitivity slider; FX / music on-off) ---------------------
const MUSIC_VOL = 0.35;
const settings = Object.assign(
  { sens: 1.0, fx: true, music: true },
  JSON.parse(localStorage.getItem('woods-settings') || '{}')
);
settings.fx = !!settings.fx; settings.music = !!settings.music; // coerce to booleans
function applySettings() {
  controls.pointerSpeed = settings.sens;                          // mouse-look speed
  for (const c of fxClips) c.a.volume = c.base * (settings.fx ? 1 : 0);
  music.volume = settings.music ? MUSIC_VOL : 0;
  localStorage.setItem('woods-settings', JSON.stringify(settings));
}

const settingsEl = document.getElementById('settings');
// Sensitivity slider.
(() => {
  const el = document.getElementById('set-sens');
  const out = document.getElementById('set-sens-val');
  if (!el) return;
  el.value = settings.sens;
  if (out) out.textContent = settings.sens.toFixed(2) + '×';
  el.addEventListener('input', () => {
    settings.sens = parseFloat(el.value);
    if (out) out.textContent = settings.sens.toFixed(2) + '×';
    applySettings();
  });
})();
// FX / music on-off toggles.
function bindToggle(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const render = () => { el.textContent = settings[key] ? 'ON' : 'OFF'; el.classList.toggle('off', !settings[key]); };
  render();
  el.addEventListener('click', () => { settings[key] = !settings[key]; render(); applySettings(); });
}
bindToggle('set-fx', 'fx');
bindToggle('set-music', 'music');

document.getElementById('btn-settings')?.addEventListener('click', () => {
  if (settingsEl) settingsEl.style.display = 'flex';
});
document.getElementById('btn-set-back')?.addEventListener('click', () => {
  if (settingsEl) settingsEl.style.display = 'none';
});
applySettings();

// ----- Input ---------------------------------------------------------------
const keys = { forward: false, back: false, left: false, right: false, run: false, jump: false };
const setKey = (e, down) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = down; break;
    case 'KeyS': case 'ArrowDown':  keys.back = down;    break;
    case 'KeyA': case 'ArrowLeft':  keys.left = down;    break;
    case 'KeyD': case 'ArrowRight': keys.right = down;   break;
    case 'ShiftLeft': case 'ShiftRight': keys.run = down; break;
    case 'Space': keys.jump = down; break;
  }
};
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && !e.repeat) setTorch(!torchOn);              // toggle the torch
  if (e.code === 'KeyR' && !e.repeat) startReload();                  // reload
  if (e.code === 'KeyE' && !e.repeat) toggleNearestDoor();            // open/close a door
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
      cullables.push({ obj: mound, x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
  }
  scene.add(hills);
}

// ----- Random map layout ----------------------------------------------------
// Every game lays the buildings out fresh: random positions inside the play
// area, kept apart from each other and clear of the player's spawn.
const placedSpots = [];
function genSpots(count, minDist = 48) {
  const out = [];
  const minR = 38;                                   // never on top of the spawn
  const maxR = Math.min(BOUNDARY_HALF - 30, FOREST_RADIUS - 20);
  let attempts = 0;
  while (out.length < count && attempts < count * 60) {
    attempts++;
    const a = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    let ok = true;
    for (const s of placedSpots) {
      if ((s.x - x) ** 2 + (s.z - z) ** 2 < minDist * minDist) { ok = false; break; }
    }
    if (!ok) continue;
    const spot = { x, z, rot: Math.random() * Math.PI * 2 };
    out.push(spot); placedSpots.push(spot);
  }
  return out;
}

// ----- Place the structures at random spots --------------------------------
function buildHouses(houseGltf) {
  placeStructures(houseGltf, genSpots(randInt(HOUSE_COUNT[0], HOUSE_COUNT[1]), 55), HOUSE_HEIGHT);
}

function buildHuts(hutGltf) {
  placeStructures(hutGltf, genSpots(randInt(HUT_COUNT[0], HUT_COUNT[1]), 44), HUT_HEIGHT);
}

function buildQuonsets(gltf) {
  placeStructures(gltf, genSpots(randInt(QUONSET_COUNT[0], QUONSET_COUNT[1]), 44), QUONSET_HEIGHT);
}

// Openable doors (press E): { mixer, action, dur, x, z, open }
const doors = [];

// Place a structure model at each spot, normalised to a target height and
// sitting on the ground, registered as a solid the player/monsters collide with.
function placeStructures(gltf, spots, height) {
  const template = gltf.scene;
  template.updateWorldMatrix(true, true);
  const doorClip = (gltf.animations && gltf.animations[0]) || null;

  // Normalise: scale to a sensible height and sit the base on the ground.
  const box = new THREE.Box3().setFromObject(template);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const scale = height / size.y;
  const footprint = Math.max(size.x, size.z) * scale; // for the tree-clear radius

  template.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  for (const spot of spots) {
    const inst = template.clone(true);
    inst.position.set(-center.x, -box.min.y, -center.z); // recentre on its base

    const pivot = new THREE.Group();
    pivot.add(inst);
    pivot.scale.setScalar(scale);
    pivot.position.set(spot.x, 0, spot.z);
    pivot.rotation.y = spot.rot;
    scene.add(pivot);
    pivot.updateWorldMatrix(true, true); // raycasts need up-to-date world matrices
    cullables.push({ obj: pivot, x: spot.x, z: spot.z });

    // Reserve a clearing so the forest doesn't grow through the walls.
    houseZones.push({ x: spot.x, z: spot.z, r: footprint * 0.6 + 6 });
    // Register it as a solid the player collides against (walls block, doors don't).
    houseColliders.push({ obj: pivot, x: spot.x, z: spot.z });

    // If the model has a door animation, make it openable with E (starts shut).
    if (doorClip) {
      const mixer = new THREE.AnimationMixer(inst);
      const action = mixer.clipAction(doorClip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = true; // hold it closed at time 0 until the player opens it
      doors.push({ mixer, action, dur: doorClip.duration, x: spot.x, z: spot.z, open: false });
    }
  }
}

// Swing the nearest door (within reach) open or closed.
const DOOR_RANGE = 9;
function toggleNearestDoor() {
  const p = controls.getObject().position;
  let best = null, bestD = DOOR_RANGE * DOOR_RANGE;
  for (const d of doors) {
    const dd = (d.x - p.x) ** 2 + (d.z - p.z) ** 2;
    if (dd < bestD) { bestD = dd; best = d; }
  }
  if (!best) return;
  const a = best.action;
  a.paused = false; a.enabled = true;
  if (!best.open) { a.timeScale = 1;  if (a.time >= best.dur) a.time = 0; }       // open
  else            { a.timeScale = -1; if (a.time <= 0) a.time = best.dur; }        // close
  a.play();
  best.open = !best.open;
}

// ----- Mesh-level collision against the houses -----------------------------
// Raycasting against the real geometry (not a box) means walls stop the player
// while doorways and gaps let them through. Resolving X and Z separately lets
// the player slide along a wall instead of sticking to it.
const _ray = new THREE.Raycaster();
// Sample above STEP_UP so a stair riser (or the top landing) isn't mistaken for
// a wall — short steps pass through and the floor-follow lifts the player up.
const _heights = [STEP_UP + 0.3, 1.3, 1.8, 2.2]; // shin..head; capped at 2.2 so the
                                                 // taller player still fits every doorway
const _offsets = [-PLAYER_RADIUS, -PLAYER_RADIUS * 0.5, 0, PLAYER_RADIUS * 0.5, PLAYER_RADIUS];
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
  for (const off of _offsets) {
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
  _downRay.far = STEP_UP + 6;
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

// ----- Generic collision against an explicit list of house meshes ----------
// Used by the monsters (the player uses the cached-near-it version above).
const _gRay = new THREE.Raycaster();
function nearHouseObjs(x, z, R) {
  const out = [];
  for (const c of houseColliders) if ((c.x - x) ** 2 + (c.z - z) ** 2 < R * R) out.push(c.obj);
  return out;
}
function wallDistG(objs, ox, oz, feet, dirx, dirz, maxd, radius, heights) {
  if (!objs.length) return Infinity;
  let min = Infinity;
  const perpx = -dirz, perpz = dirx;
  for (const off of [-radius, 0, radius]) {
    for (const h of heights) {
      _gRay.set(new THREE.Vector3(ox + perpx * off, feet + h, oz + perpz * off),
                new THREE.Vector3(dirx, 0, dirz));
      _gRay.far = maxd;
      const hits = _gRay.intersectObjects(objs, true);
      if (hits.length) min = Math.min(min, hits[0].distance);
    }
  }
  return min;
}
function resolveG(objs, prevX, prevZ, feet, dx, dz, radius, heights) {
  if (dx !== 0) {
    const reach = Math.abs(dx) + radius;
    const d = wallDistG(objs, prevX, prevZ, feet, Math.sign(dx), 0, reach, radius, heights);
    if (d < reach) dx = Math.max(0, d - radius) * Math.sign(dx);
  }
  const nx = prevX + dx;
  if (dz !== 0) {
    const reach = Math.abs(dz) + radius;
    const d = wallDistG(objs, nx, prevZ, feet, 0, Math.sign(dz), reach, radius, heights);
    if (d < reach) dz = Math.max(0, d - radius) * Math.sign(dz);
  }
  return [dx, dz];
}
function floorG(objs, x, z, feet, stepUp) {
  if (!objs.length) return 0;
  _downRay.set(new THREE.Vector3(x, feet + stepUp, z), _down);
  _downRay.far = stepUp + 6;
  const hits = _downRay.intersectObjects(objs, true);
  return hits.length ? hits[0].point.y : 0;
}

// The boundary is invisible — nothing is drawn for it. It exists only as the
// movement clamp far away in update(). Just grass, in every direction.

// ----- Build the forest from the animated tree GLB -------------------------
const mixers = [];

async function buildForest(treeGltf) {
  const template = treeGltf.scene;
  template.updateWorldMatrix(true, true);

  // The model is off-centre and ~75 units tall — normalise it so a clone sits
  // with its trunk base on the ground (y = 0) and is roughly TREE_HEIGHT tall.
  const box = new THREE.Box3().setFromObject(template);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const baseScale = TREE_HEIGHT / size.y;
  const clip = treeGltf.animations && treeGltf.animations[0];

  // The tree uses KHR_materials_pbrSpecularGlossiness, which modern three.js no
  // longer reads — so the diffuse colour+alpha textures get dropped, leaving the
  // tree white and the leaf cutout with no alpha (paper rectangles). Pull those
  // diffuse textures out of the GLB by hand and apply them as the base map.
  const DIFFUSE_INDEX = { Bark: 0, Leaf: 3, Branch: 7 };
  const parser = treeGltf.parser;
  if (parser) {
    const seen = new Set();
    const jobs = [];
    template.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid);
        const di = DIFFUSE_INDEX[m.name];
        if (di === undefined) continue;
        jobs.push(parser.getDependency('texture', di).then((tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false;            // glTF textures are not flipped
          m.map = tex;
          if (m.color) m.color.setHex(0xffffff); // show the texture's true colours
          m.needsUpdate = true;
        }).catch(() => {}));
      }
    });
    await Promise.all(jobs);
  }

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

  // Seeded RNG so the forest is laid out identically every game (only the
  // houses move around — the trees stay put).
  const rng = mulberry32(0x7eed);

  for (let i = 0; i < TREE_COUNT; i++) {
    // Even spread across a disk (sqrt keeps density uniform), with a clearing.
    const r = CLEARING + Math.sqrt(rng()) * (FOREST_RADIUS - CLEARING);
    const a = rng() * Math.PI * 2;
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
    pivot.rotation.y = rng() * Math.PI * 2;
    pivot.scale.setScalar(baseScale * (0.75 + rng() * 0.6)); // size variety
    forest.add(pivot);
    cullables.push({ obj: pivot, x: px, z: pz }); // hide when far (beyond the fog)

    // Each tree sways on its own phase and speed so the canopy never pulses
    // in lockstep — that's what makes a crowd of trees read as a living forest.
    if (clip) {
      const mixer = new THREE.AnimationMixer(inst);
      const action = mixer.clipAction(clip);
      action.timeScale = 0.6 + rng() * 0.7;
      action.play();
      action.time = rng() * clip.duration;
      mixers.push({ mixer, x: px, z: pz }); // position lets us skip far-off trees
    }
  }
}

// ----- Player health & death -----------------------------------------------
let playerHP = PLAYER_MAX_HP;
let playerDead = false;
const healthFillEl = document.getElementById('healthfill');
const hurtEl   = document.getElementById('hurt');
const deathEl  = document.getElementById('death');
const finalKillsEl = document.getElementById('finalkills');
const bloodVigEl = document.getElementById('bloodvig');

function updateHealthBar() {
  if (healthFillEl) healthFillEl.style.width = `${(playerHP / PLAYER_MAX_HP) * 100}%`;
  // The lower the health, the more blood creeps in from the corners.
  if (bloodVigEl) bloodVigEl.style.opacity = (1 - playerHP / PLAYER_MAX_HP).toFixed(2);
}

function hurtPlayer(amount = 1) {
  if (playerDead) return;
  sfx.damage.play();
  playerHP = Math.max(0, playerHP - amount);
  updateHealthBar();
  if (hurtEl) { hurtEl.classList.remove('flash'); void hurtEl.offsetWidth; hurtEl.classList.add('flash'); }
  if (playerHP <= 0) die();
}

function die() {
  playerDead = true;
  if (deathEl) deathEl.style.display = 'flex';
  controls.unlock();
}

document.getElementById('btn-again')?.addEventListener('click', () => {
  sessionStorage.setItem('woods-autostart', '1'); // skip the menu, go straight back in
  location.reload();
});
document.getElementById('btn-menu')?.addEventListener('click', () => {
  sessionStorage.removeItem('woods-autostart');
  location.reload();
});

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
  // footY puts the model's feet on a floor of height f when root.y = f + footY.
  monsterTemplate = { scene: scene0, clips: gltf.animations || [], scale, baseY: box.min.y,
                      footY: -box.min.y * scale };
}

function spawnMonster(angleOverride) {
  if (!monsterTemplate) return;
  // SkeletonUtils.clone preserves the skinned rig so each monster animates alone.
  const root = cloneSkinned(monsterTemplate.scene);
  root.scale.setScalar(monsterTemplate.scale);

  // 1 in 10 is the red breed: faster and hits harder.
  const red = Math.random() < 0.1;

  const hitMeshes = [];
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      hitMeshes.push(o); // bullets test against these
      if (red) {
        // Clone materials for this instance so only the red one is tinted.
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const tinted = mats.map((m) => {
          if (!m) return m;
          const c = m.clone();
          if (c.color) c.color.setHex(0xc02020);   // multiplies the texture toward blood-red
          if (c.emissive) c.emissive.setHex(0x300404);
          return c;
        });
        o.material = Array.isArray(o.material) ? tinted : tinted[0];
      }
    }
  });

  // Appear out of the dark, at a (usually random) bearing and distance.
  const p = controls.getObject().position;
  const ang = angleOverride !== undefined ? angleOverride : Math.random() * Math.PI * 2;
  const r = MONSTER_SPAWN_MIN + Math.random() * (MONSTER_SPAWN_MAX - MONSTER_SPAWN_MIN);
  const lim = BOUNDARY_HALF - 5;
  const x = Math.max(-lim, Math.min(lim, p.x + Math.cos(ang) * r));
  const z = Math.max(-lim, Math.min(lim, p.z + Math.sin(ang) * r));
  root.position.set(x, monsterTemplate.footY, z);
  scene.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const clips = monsterTemplate.clips;
  const clip = clips[MONSTER_CHASE_CLIP] || clips[0];
  let action = null;
  if (clip) { action = mixer.clipAction(clip); action.time = Math.random() * clip.duration; if (red) action.timeScale = 2; action.play(); }

  monsters.push({ root, mixer, action, hitMeshes, speed: MONSTER_SPEED * (red ? 2 : 1), dmg: red ? 2 : 1 });
}

// Seed one monster at the start; the rest arrive every 5 seconds up to the max.
function seedMonsters() {
  spawnMonster(Math.random() * Math.PI * 2);
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

// Pick a heading toward the player that steers around a blocking house. Probes
// straight ahead; if a wall is close, fans out to either side and takes the
// clearest direction — so monsters walk around a hut instead of grinding on it.
const MONSTER_PROBE = MONSTER_RADIUS + 6;
const _steerOffsets = [0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3];
function monsterHeading(objs, x, z, feet, tx, tz) {
  if (wallDistG(objs, x, z, feet, tx, tz, MONSTER_PROBE, MONSTER_RADIUS, _mHeights) >= MONSTER_PROBE) {
    return [tx, tz]; // straight line is clear
  }
  const base = Math.atan2(tx, tz);
  let bestDir = [tx, tz], bestClear = -1;
  for (const off of _steerOffsets) {
    const a = base + off;
    const dx = Math.sin(a), dz = Math.cos(a);
    const clear = wallDistG(objs, x, z, feet, dx, dz, MONSTER_PROBE, MONSTER_RADIUS, _mHeights);
    if (clear >= MONSTER_PROBE) return [dx, dz];   // first fully clear way around
    if (clear > bestClear) { bestClear = clear; bestDir = [dx, dz]; }
  }
  return bestDir; // least-blocked direction if nothing is fully clear
}

const _toPlayer = new THREE.Vector3();
let damageTimer = 0;
let growlTimer = 3;
function updateMonsters(dt) {
  if (playerDead) return;

  // Keep the horde topped up (max MONSTER_MAX).
  if (monsterTemplate && monsters.length < MONSTER_MAX) {
    respawnTimer -= dt;
    if (respawnTimer <= 0) { spawnMonster(); respawnTimer = MONSTER_RESPAWN; }
  }

  // Occasional growls from the dark while anything is hunting you.
  if (monsters.length) {
    growlTimer -= dt;
    if (growlTimer <= 0) { sfx.growl.play(); growlTimer = 4 + Math.random() * 6; }
  }

  if (damageTimer > 0) damageTimer -= dt;
  const p = controls.getObject().position;
  let touched = 0; // 0 = not touched; otherwise the hardest hit this frame
  for (const m of monsters) {
    _toPlayer.set(p.x - m.root.position.x, 0, p.z - m.root.position.z);
    const dist = _toPlayer.length() || 1;

    // If you've outrun it into the dark, recycle it to a fresh spot near you.
    if (dist > MONSTER_DESPAWN) {
      const ang = Math.random() * Math.PI * 2;
      const r = MONSTER_SPAWN_MIN + Math.random() * (MONSTER_SPAWN_MAX - MONSTER_SPAWN_MIN);
      const lim = BOUNDARY_HALF - 5;
      m.root.position.x = Math.max(-lim, Math.min(lim, p.x + Math.cos(ang) * r));
      m.root.position.z = Math.max(-lim, Math.min(lim, p.z + Math.sin(ang) * r));
      m.mixer.update(dt);
      continue;
    }

    if (dist > MONSTER_TOUCH) {                  // walk relentlessly toward the player
      const step = m.speed * dt;                 // red breed moves twice as fast
      let hx = _toPlayer.x / dist, hz = _toPlayer.z / dist;

      // Steer around houses, then collide/slide and climb their steps.
      const objs = nearHouseObjs(m.root.position.x, m.root.position.z, 55);
      const feet = m.root.position.y - monsterTemplate.footY;
      if (objs.length) [hx, hz] = monsterHeading(objs, m.root.position.x, m.root.position.z, feet, hx, hz);
      m.root.rotation.y = Math.atan2(hx, hz) + MONSTER_FACING; // face where it's heading

      let mvx = hx * step, mvz = hz * step;
      if (objs.length) {
        [mvx, mvz] = resolveG(objs, m.root.position.x, m.root.position.z, feet, mvx, mvz, MONSTER_RADIUS, _mHeights);
      }
      m.root.position.x += mvx;
      m.root.position.z += mvz;
      const floor = objs.length ? floorG(objs, m.root.position.x, m.root.position.z, feet, MONSTER_STEP) : 0;
      m.root.position.y = floor + monsterTemplate.footY;
    } else {
      m.root.rotation.y = Math.atan2(_toPlayer.x, _toPlayer.z) + MONSTER_FACING;
      touched = Math.max(touched, m.dmg);        // close enough to claw — track its damage
    }
    m.mixer.update(dt);
  }

  if (touched && damageTimer <= 0) { hurtPlayer(touched); damageTimer = DAMAGE_COOLDOWN; }
}

function killMonster(m) {
  sfx.death.play();
  dropLoot(m.root.position.x, m.root.position.z); // roll the loot table
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
let magAmmo = MAG_SIZE;          // rounds in the gun
let reserveAmmo = RESERVE_START; // spare rounds
let reloading = false, reloadTimer = 0;
const ammoEl = document.getElementById('ammocount');
function updateAmmo() { if (ammoEl) ammoEl.textContent = `${magAmmo} / ${reserveAmmo}`; refreshWarnings(); }
function addAmmo(n) { reserveAmmo += n; updateAmmo(); }

function startReload() {
  if (reloading || playerDead) return;
  if (magAmmo >= MAG_SIZE || reserveAmmo <= 0) return;
  reloading = true;
  reloadTimer = RELOAD_TIME;
  sfx.reload.play();
}

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
  if (fireCooldown > 0 || playerDead || reloading) return;
  if (magAmmo <= 0) {           // empty mag — start a reload if we have spares
    if (reserveAmmo > 0) startReload(); else fireCooldown = 0.25; // else dry click
    return;
  }
  fireCooldown = FIRE_COOLDOWN;
  magAmmo--; updateAmmo();
  sfx.gunshot.play();

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
  if (!gun) return;

  if (reloading) {
    reloadTimer -= dt;
    // Our own reload motion: dip the gun down and tilt it as if swapping a mag.
    const prog = 1 - Math.max(0, reloadTimer) / RELOAD_TIME; // 0 → 1
    const dip = Math.sin(prog * Math.PI);                    // 0 → 1 → 0
    gun.position.set(GUN_POS.x, GUN_POS.y - dip * 0.22, GUN_POS.z - dip * 0.12);
    gun.rotation.set(GUN_ROT.x + dip * 0.9, GUN_ROT.y, GUN_ROT.z + dip * 0.35);
    if (reloadTimer <= 0) {       // finish: top up the mag from the reserve
      const take = Math.min(MAG_SIZE - magAmmo, reserveAmmo);
      magAmmo += take; reserveAmmo -= take;
      reloading = false; updateAmmo();
      gun.position.copy(GUN_POS); gun.rotation.copy(GUN_ROT);
    }
    return;
  }

  gun.position.z += (GUN_POS.z - gun.position.z) * Math.min(1, dt * 12); // ease recoil back
}

document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && controls.isLocked) shoot();
});

// ----- Pickups: monster drops + roaming ground ammo ------------------------
const pickups = [];
const GROUND_AMMO_COUNT   = 3;    // loose ammo boxes kept around the player
const GROUND_AMMO_MIN     = 18;   // spawn this far from the player…
const GROUND_AMMO_MAX     = 75;   // …to this far
const GROUND_AMMO_DESPAWN = 120;  // wander past this and it recycles near you

// Glowing brass ammo box.
const _ammoGeo = new THREE.BoxGeometry(0.7, 0.45, 0.5);
const _ammoMat = new THREE.MeshStandardMaterial({
  color: 0xd9a521, emissive: 0x6a4500, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.4,
});
// Red medkit with a white cross.
const _medGeo = new THREE.BoxGeometry(0.6, 0.5, 0.6);
const _medMat = new THREE.MeshStandardMaterial({
  color: 0xc01818, emissive: 0x4a0000, emissiveIntensity: 0.8, roughness: 0.6,
});
const _crossMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888, emissiveIntensity: 0.5 });
// Green battery cell.
const _battGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.55, 12);
const _battMat = new THREE.MeshStandardMaterial({
  color: 0x2fbf4f, emissive: 0x0d4a1c, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.4,
});
const _battCapMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, emissive: 0x444444, emissiveIntensity: 0.4 });

function makeMedkit() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(_medGeo, _medMat));
  const barH = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.04), _crossMat);
  const barV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.04), _crossMat);
  barH.position.z = barV.position.z = 0.31;
  g.add(barH, barV);
  return g;
}
function makeBattery() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(_battGeo, _battMat));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 8), _battCapMat);
  cap.position.y = 0.31;
  g.add(cap);
  return g;
}

// Drop a pickup of `type` at a world position (where a monster died).
function spawnPickup(type, x, z, ground = false) {
  const obj = type === 'health' ? makeMedkit()
            : type === 'battery' ? makeBattery()
            : new THREE.Mesh(_ammoGeo, _ammoMat);
  obj.position.set(x, 0.6, z);
  scene.add(obj);
  pickups.push({ obj, x, z, baseY: 0.6, type, ground });
}

// A loose ammo box somewhere around the player.
function spawnGroundAmmo() {
  const p = controls.getObject().position;
  const a = Math.random() * Math.PI * 2;
  const r = GROUND_AMMO_MIN + Math.random() * (GROUND_AMMO_MAX - GROUND_AMMO_MIN);
  const lim = BOUNDARY_HALF - 5;
  const x = Math.max(-lim, Math.min(lim, p.x + Math.cos(a) * r));
  const z = Math.max(-lim, Math.min(lim, p.z + Math.sin(a) * r));
  spawnPickup('ammo', x, z, true);
}

// Move an existing ground pickup to a fresh spot around the player.
function relocateGround(pk) {
  const p = controls.getObject().position;
  const a = Math.random() * Math.PI * 2;
  const r = GROUND_AMMO_MIN + Math.random() * (GROUND_AMMO_MAX - GROUND_AMMO_MIN);
  const lim = BOUNDARY_HALF - 5;
  pk.x = Math.max(-lim, Math.min(lim, p.x + Math.cos(a) * r));
  pk.z = Math.max(-lim, Math.min(lim, p.z + Math.sin(a) * r));
  pk.obj.position.set(pk.x, pk.baseY, pk.z);
}

// Roll the monster's loot table when it dies (drops only — never on the map).
function dropLoot(x, z) {
  if (Math.random() < 0.10) spawnPickup('health',  x + 0.6, z);        // heart   1/10
  if (Math.random() < 0.10) spawnPickup('ammo',    x - 0.6, z);        // bullets 1/10
  if (Math.random() < 1 / 15) spawnPickup('battery', x, z + 0.6);      // energy  1/15
}

let groundAmmoCount = 0;
function updatePickups(dt) {
  // Keep loose ammo boxes roaming around the player.
  if (groundAmmoCount < GROUND_AMMO_COUNT) { spawnGroundAmmo(); groundAmmoCount++; }

  const p = controls.getObject().position;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    pk.obj.rotation.y += dt * 1.6;                                       // spin to catch the eye
    pk.obj.position.y = pk.baseY + Math.sin(performance.now() * 0.003 + pk.x) * 0.12; // bob

    // Loose ammo you've left far behind recycles to a fresh spot near you.
    if (pk.ground && (pk.x - p.x) ** 2 + (pk.z - p.z) ** 2 > GROUND_AMMO_DESPAWN ** 2) {
      relocateGround(pk);
      continue;
    }

    if (playerDead) continue;
    if ((pk.x - p.x) ** 2 + (pk.z - p.z) ** 2 < PICKUP_RADIUS * PICKUP_RADIUS) {
      if (pk.type === 'health') {
        if (playerHP >= PLAYER_MAX_HP) continue; // leave medkits if already full
        playerHP = Math.min(PLAYER_MAX_HP, playerHP + HEALTH_PER_PICKUP);
        updateHealthBar();
      } else if (pk.type === 'battery') {
        spareBatteries++; updateBatteryHUD();
      } else {
        addAmmo(AMMO_PER_PICKUP);
      }
      if (pk.ground) groundAmmoCount--; // let a fresh one roam in
      scene.remove(pk.obj);
      pickups.splice(i, 1);
    }
  }
}

// ----- Movement with boundary clamp ----------------------------------------
const velocity = new THREE.Vector3();   // horizontal velocity in camera-local axes
let bobPhase = 0, bobAmp = 0;           // head-bob state for the walk/run feel
let camY = PLAYER_HEIGHT, velY = 0, onGround = true; // vertical (jump/gravity)
let stamina = STAMINA_MAX, exhausted = false;
const staminaFillEl = document.getElementById('staminafill');
function updateStaminaBar() {
  if (staminaFillEl) staminaFillEl.style.width = `${(stamina / STAMINA_MAX) * 100}%`;
}

function update(dt) {
  if (!controls.isLocked) return;
  const obj = controls.getObject();

  // Desired direction (normalised) from the keys.
  let wishX = Number(keys.right) - Number(keys.left);
  let wishZ = Number(keys.forward) - Number(keys.back);
  const moving = wishX !== 0 || wishZ !== 0;
  if (moving) { const l = Math.hypot(wishX, wishZ); wishX /= l; wishZ /= l; }

  // Sprinting needs stamina; once drained you must recover before running again.
  const running = keys.run && moving && stamina > 0 && !exhausted;
  if (running) {
    stamina = Math.max(0, stamina - STAMINA_DRAIN * dt);
    if (stamina === 0) exhausted = true;
  } else {
    stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN * dt);
    if (exhausted && stamina >= STAMINA_RECOVER) exhausted = false;
  }
  updateStaminaBar();
  const speed = running ? RUN_SPEED : WALK_SPEED;

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
  const curFeet = camY - PLAYER_HEIGHT;
  const floor = floorHeight(obj.position.x, obj.position.z, curFeet);
  const groundY = floor + PLAYER_HEIGHT;

  // Vertical: jump + gravity. Step-ups snap, ledges let you fall.
  if (keys.jump && onGround) { velY = JUMP_VEL; onGround = false; }
  velY -= GRAVITY * dt;
  camY += velY * dt;
  if (camY <= groundY) { camY = groundY; velY = 0; onGround = true; }

  // Head-bob: oscillate the eye height while actually moving on the ground.
  const horizSpeed = Math.hypot(dx, dz) / dt;
  const movingNow = onGround && horizSpeed > 0.4;
  if (movingNow) bobPhase += dt * (running ? 13 : 9);
  const targetAmp = movingNow ? (running ? 0.10 : 0.055) : 0;
  bobAmp += (targetAmp - bobAmp) * Math.min(1, dt * 10);
  obj.position.y = camY + (onGround ? Math.sin(bobPhase) * bobAmp : 0);
}

// ----- Loop ----------------------------------------------------------------
// Hide objects beyond the fog so they aren't rendered (throttled ~10×/sec).
let _cullFrame = 0;
function cullDistant() {
  if ((_cullFrame++ % 6) !== 0) return;
  const p = controls.getObject().position;
  for (const c of cullables) {
    c.obj.visible = (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < CULL_DIST2;
  }
}

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
  updatePickups(dt);                                            // ammo / health / batteries
  updateBattery(dt);                                            // torch drains the battery
  for (let i = 0; i < doors.length; i++) doors[i].mixer.update(dt); // door swings
  cullDistant();                                                // hide far-off (fogged) objects
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----- Bootstrap -----------------------------------------------------------
const loader = new GLTFLoader();
const load = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

const loadFillEl = document.getElementById('loadfill');
const LOAD_STEPS = 7;
let loadDone = 0;
function advanceLoad() {
  loadDone++;
  if (loadFillEl) loadFillEl.style.width = `${Math.min(100, (loadDone / LOAD_STEPS) * 100)}%`;
}
async function loadStep(url, onLoad) {
  try { await onLoad(await load(url)); }
  catch (err) { console.error('Failed to load', url, err); }
  finally { advanceLoad(); }
}

function start() {
  loadingEl.style.display = 'none';
  // Drop straight into play. The overlay only shows if the pointer-lock didn't
  // stick (browser dropped it during the load) — a one-click fallback.
  if (controls.isLocked) overlay.style.display = 'none';
  else overlay.style.display = 'flex';
  updateHealthBar();
  updateStaminaBar();
  updateAmmo();
  updateBatteryHUD();
  animate();
}

// Nothing loads until the player presses START.
let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  loadingEl.style.display = 'flex';

  // Grass ground (+ hills) — falls back to a plain green field if it fails.
  try {
    const gltf = await load('./assets/forested_floor.glb');
    const grassMat = grassMaterialFromGLB(gltf);
    buildGround(grassMat); buildHills(grassMat);
  } catch (err) {
    console.error('Failed to load grass GLB:', err);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4f7a32, roughness: 1 });
    buildGround(grassMat); buildHills(grassMat);
  } finally { advanceLoad(); }

  await loadStep('./assets/psx_abandoned_house.glb', buildHouses);
  await loadStep('./assets/wooden_hut.glb', buildHuts);
  await loadStep('./assets/quonset_hut.glb', buildQuonsets);
  await loadStep('./assets/tree_animate.glb', buildForest);
  await loadStep('./assets/colt_m1911.glb', buildGun);
  await loadStep('./assets/zombie_licker.glb', (gltf) => {
    prepareMonsterTemplate(gltf);
    seedMonsters();
    if (aniEl) aniEl.textContent = `anim ${MONSTER_CHASE_CLIP} / ${monsterTemplate.clips.length - 1}`;
  });

  start();
}
