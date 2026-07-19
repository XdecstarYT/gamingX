/* ============================================================================
   GX STUDIO ENGINE — a real-time 3D game engine for the browser.

   Component model (fixed slots per entity, Unity/Unreal-style):
     entity = { id, name, tag, transform, mesh, light, camera, rigidbody, scripts[], children[] }

   Systems:
     - Scene graph (THREE.Object3D hierarchy)
     - PBR rendering with shadows, tone mapping, procedural sky, and an
       UnrealBloomPass post-process chain (three.js EffectComposer)
     - Rigid-body physics via cannon-es (gravity, collisions, restitution)
     - A sandboxed per-entity scripting system (plain JS, onStart/onUpdate/onCollide)
     - JSON scene (de)serialization for save / load / publish

   This module is dependency-free apart from THREE and CANNON (both loaded as
   plain globals — see index.html/play.html script order), so it can be driven
   by either the Studio editor or a standalone play page from a plain file://
   URL with no server and no module loader.
   ========================================================================== */
(() => {
'use strict';

let uidN = 1;
const uid = () => 'e' + (uidN++) + Math.random().toString(36).slice(2, 6);

/* ------------------------------------------------------------------ */
/* Roblox-style material presets (name -> PBR params)                 */
/* ------------------------------------------------------------------ */
const MATERIALS = {
  plastic:      { label: 'Plastic',       metalness: 0.0,  roughness: 0.55, emissive: 0,   clear: false },
  smoothplastic:{ label: 'SmoothPlastic', metalness: 0.0,  roughness: 0.25, emissive: 0,   clear: false },
  wood:         { label: 'Wood',          metalness: 0.0,  roughness: 0.85, emissive: 0,   clear: false },
  metal:        { label: 'Metal',         metalness: 0.9,  roughness: 0.35, emissive: 0,   clear: false },
  diamondplate: { label: 'DiamondPlate',  metalness: 0.85, roughness: 0.5,  emissive: 0,   clear: false },
  slate:        { label: 'Slate',         metalness: 0.0,  roughness: 0.95, emissive: 0,   clear: false },
  concrete:     { label: 'Concrete',      metalness: 0.0,  roughness: 1.0,  emissive: 0,   clear: false },
  brick:        { label: 'Brick',         metalness: 0.0,  roughness: 0.9,  emissive: 0,   clear: false },
  grass:        { label: 'Grass',         metalness: 0.0,  roughness: 1.0,  emissive: 0,   clear: false },
  sand:         { label: 'Sand',          metalness: 0.0,  roughness: 1.0,  emissive: 0,   clear: false },
  ice:          { label: 'Ice',           metalness: 0.1,  roughness: 0.08, emissive: 0,   clear: true  },
  glass:        { label: 'Glass',         metalness: 0.0,  roughness: 0.05, emissive: 0,   clear: true  },
  neon:         { label: 'Neon',          metalness: 0.0,  roughness: 0.4,  emissive: 1.4, clear: false },
  forcefield:   { label: 'ForceField',    metalness: 0.0,  roughness: 0.3,  emissive: 0.8, clear: true  },
};
const MATERIAL_ORDER = ['plastic', 'smoothplastic', 'wood', 'metal', 'diamondplate', 'slate', 'concrete', 'brick', 'grass', 'sand', 'ice', 'glass', 'neon', 'forcefield'];

/* ------------------------------------------------------------------ */
/* Entity data model + factory                                        */
/* ------------------------------------------------------------------ */
function newEntity(kind, name) {
  return {
    id: uid(), name: name || 'Entity', tag: '',
    transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    mesh: kind === 'mesh' ? { shape: 'box', color: '#a3a2a5', material: 'plastic', anchored: true, canCollide: true, reflectance: 0, transparency: 0, metalness: 0.0, roughness: 0.55, emissive: '#000000', emissiveIntensity: 1, opacity: 1, wireframe: false, castShadow: true, receiveShadow: true } : null,
    light: kind === 'light' ? { type: 'point', color: '#ffffff', intensity: 1.2, distance: 12, angle: 0.5, penumbra: 0.4, castShadow: false } : null,
    camera: kind === 'camera' ? { fov: 60, isMain: false } : null,
    rigidbody: null,
    scripts: [],
    children: [],
  };
}

const PREFABS = {
  cube: () => { const e = newEntity('mesh', 'Cube'); return e; },
  part: () => { const e = newEntity('mesh', 'Part'); e.mesh.shape = 'box'; e.transform.scale = [4, 1, 2]; e.transform.position = [0, 3, 0]; e.mesh.anchored = true; return e; },
  ball: () => { const e = newEntity('mesh', 'Ball'); e.mesh.shape = 'sphere'; e.transform.position = [0, 3, 0]; e.mesh.anchored = true; return e; },
  wedge: () => { const e = newEntity('mesh', 'Wedge'); e.mesh.shape = 'wedge'; e.transform.scale = [4, 2, 4]; e.transform.position = [0, 1, 0]; e.mesh.anchored = true; return e; },
  spawn: () => {
    const e = newEntity('mesh', 'SpawnLocation'); e.tag = 'spawn';
    e.mesh.shape = 'box'; e.mesh.color = '#c9d1ff'; e.mesh.material = 'smoothplastic'; e.mesh.anchored = true; e.mesh.isSpawn = true;
    e.mesh.emissive = '#3b4cff'; e.mesh.emissiveIntensity = 0.4;
    e.transform.scale = [4, 0.4, 4]; e.transform.position = [0, 0.2, 0];
    return e;
  },
  baseplate: () => {
    const e = newEntity('mesh', 'Baseplate');
    e.mesh.shape = 'box'; e.mesh.color = '#6c757d'; e.mesh.material = 'plastic'; e.mesh.anchored = true; e.mesh.receiveShadow = true; e.mesh.castShadow = false;
    e.transform.scale = [120, 2, 120]; e.transform.position = [0, -1, 0];
    return e;
  },
  sphere: () => { const e = newEntity('mesh', 'Sphere'); e.mesh.shape = 'sphere'; e.mesh.color = '#f2b03d'; return e; },
  cylinder: () => { const e = newEntity('mesh', 'Cylinder'); e.mesh.shape = 'cylinder'; e.mesh.color = '#a855f7'; return e; },
  cone: () => { const e = newEntity('mesh', 'Cone'); e.mesh.shape = 'cone'; e.mesh.color = '#22c55e'; return e; },
  torus: () => { const e = newEntity('mesh', 'Torus'); e.mesh.shape = 'torus'; e.mesh.color = '#fde047'; return e; },
  plane: () => { const e = newEntity('mesh', 'Ground'); e.mesh.shape = 'plane'; e.mesh.color = '#2d3350'; e.transform.scale = [20, 1, 20]; e.transform.position = [0, 0, 0]; e.rigidbody = { mass: 0, shape: 'box', friction: 0.7, restitution: 0.15, fixedRotation: true, isTrigger: false, linearDamping: 0.1 }; return e; },
  dirlight: () => { const e = newEntity('light', 'Sun'); e.light.type = 'directional'; e.light.castShadow = true; e.transform.position = [6, 10, 4]; return e; },
  pointlight: () => { const e = newEntity('light', 'Point Light'); e.light.type = 'point'; e.transform.position = [0, 3, 0]; return e; },
  spotlight: () => { const e = newEntity('light', 'Spot Light'); e.light.type = 'spot'; e.transform.position = [0, 5, 0]; return e; },
  ambient: () => { const e = newEntity('light', 'Ambient'); e.light.type = 'ambient'; e.light.intensity = 0.5; return e; },
  camera: () => { const e = newEntity('camera', 'Camera'); e.transform.position = [0, 3, 8]; return e; },
  group: () => newEntity('empty', 'Group'),

  player: () => {
    const e = newEntity('mesh', 'Player');
    e.tag = 'player';
    e.mesh.shape = 'sphere'; e.mesh.color = '#22d3ee'; e.mesh.metalness = 0.3; e.mesh.roughness = 0.35;
    e.transform.position = [0, 1, 6];
    e.rigidbody = { mass: 1, shape: 'sphere', friction: 0.3, restitution: 0.05, fixedRotation: false, isTrigger: false, linearDamping: 0.5 };
    e.scripts = [{ id: uid(), name: 'PlayerController', enabled: true, code: SCRIPT_LIB.playerController }];
    return e;
  },
  camerafollow: () => {
    const e = newEntity('camera', 'Follow Camera');
    e.camera.isMain = true;
    e.transform.position = [0, 4, 9];
    e.scripts = [{ id: uid(), name: 'CameraFollow', enabled: true, code: SCRIPT_LIB.cameraFollow }];
    return e;
  },
  coin: () => {
    const e = newEntity('mesh', 'Coin');
    e.mesh.shape = 'torus'; e.mesh.color = '#fde047'; e.mesh.metalness = 0.7; e.mesh.roughness = 0.25; e.mesh.emissive = '#7a6400'; e.mesh.emissiveIntensity = 0.6;
    e.transform.scale = [0.6, 0.6, 0.6]; e.transform.position = [0, 1.1, 0];
    e.scripts = [{ id: uid(), name: 'CoinPickup', enabled: true, code: SCRIPT_LIB.coinPickup }];
    return e;
  },
  enemy: () => {
    const e = newEntity('mesh', 'Patrol Enemy');
    e.tag = 'enemy';
    e.mesh.shape = 'cone'; e.mesh.color = '#ef4444'; e.mesh.emissive = '#3f0a0a'; e.mesh.emissiveIntensity = 0.8;
    e.transform.position = [3, 0.6, 0];
    e.scripts = [{ id: uid(), name: 'PatrolEnemy', enabled: true, code: SCRIPT_LIB.patrolEnemy }];
    return e;
  },
  platform: () => {
    const e = newEntity('mesh', 'Moving Platform');
    e.mesh.shape = 'box'; e.mesh.color = '#a855f7';
    e.transform.scale = [3, 0.4, 3]; e.transform.position = [0, 1.5, -6];
    e.scripts = [{ id: uid(), name: 'MovingPlatform', enabled: true, code: SCRIPT_LIB.movingPlatform }];
    return e;
  },
  winzone: () => {
    const e = newEntity('mesh', 'Win Zone');
    e.mesh.shape = 'cylinder'; e.mesh.color = '#4ade80'; e.mesh.emissive = '#0d3d1e'; e.mesh.emissiveIntensity = 0.9; e.mesh.opacity = 0.55;
    e.transform.scale = [1.6, 0.12, 1.6]; e.transform.position = [0, 0.06, -14];
    e.scripts = [{ id: uid(), name: 'WinZone', enabled: true, code: SCRIPT_LIB.winZone }];
    return e;
  },
  crate: () => {
    const e = newEntity('mesh', 'Crate');
    e.mesh.shape = 'box'; e.mesh.color = '#c98a3a'; e.mesh.roughness = 0.8;
    e.transform.position = [0, 2, -3];
    e.rigidbody = { mass: 4, shape: 'box', friction: 0.5, restitution: 0.2, fixedRotation: false, isTrigger: false, linearDamping: 0.05 };
    return e;
  },
};

/* ------------------------------------------------------------------ */
/* Built-in script library (plain JS, editable after adding)          */
/* ------------------------------------------------------------------ */
const SCRIPT_LIB = {
  playerController:
`// Player Controller — WASD/Arrows to move, Space to jump.
// Runs every frame while in Play mode.
let speed = 6.5, jumpForce = 6.5;

function onUpdate(api) {
  let vx = 0, vz = 0;
  if (api.input.isDown('KeyW') || api.input.isDown('ArrowUp')) vz -= 1;
  if (api.input.isDown('KeyS') || api.input.isDown('ArrowDown')) vz += 1;
  if (api.input.isDown('KeyA') || api.input.isDown('ArrowLeft')) vx -= 1;
  if (api.input.isDown('KeyD') || api.input.isDown('ArrowRight')) vx += 1;
  const len = Math.hypot(vx, vz) || 1;
  const vy = api.velocity.get().y;
  api.velocity.set((vx / len) * speed, vy, (vz / len) * speed);

  if (api.input.pressed('Space') && api.isGrounded()) {
    api.velocity.add(0, jumpForce, 0);
  }
}`,
  cameraFollow:
`// Camera Follow — trails the entity tagged/named "Player".
let offset = { x: 0, y: 4.2, z: 8 }, smoothing = 4;

function onUpdate(api) {
  const target = api.find('Player');
  if (!target) return;
  const p = target.getPosition();
  const want = { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z };
  api.entity.moveToward(want, smoothing);
  api.entity.lookAt(p.x, p.y + 0.8, p.z);
}`,
  coinPickup:
`// Coin Pickup — spins, and adds score when the player gets close.
let collected = false;

function onUpdate(api) {
  if (collected) return;
  api.entity.rotateY(api.dt * 2.4);
  const player = api.find('Player');
  if (player && api.distance(player) < 1.2) {
    collected = true;
    api.score.add(10);
    api.log('Coin collected! +10');
    api.destroySelf();
  }
}`,
  patrolEnemy:
`// Patrol Enemy — walks back and forth; ends the game if it touches the player.
let dir = 1, range = 4, speed = 2.2, startX = 0;

function onStart(api) { startX = api.entity.getPosition().x; }

function onUpdate(api) {
  const p = api.entity.getPosition();
  p.x += dir * speed * api.dt;
  if (Math.abs(p.x - startX) > range) dir *= -1;
  api.entity.setPosition(p.x, p.y, p.z);

  const player = api.find('Player');
  if (player && api.distance(player) < 1.0) {
    api.end({ win: false, message: 'Caught by an enemy!' });
  }
}`,
  movingPlatform:
`// Moving Platform — bobs up and down forever.
let startY = 0, amplitude = 2, speed = 1;

function onStart(api) { startY = api.entity.getPosition().y; }

function onUpdate(api) {
  const p = api.entity.getPosition();
  p.y = startY + Math.sin(api.time * speed) * amplitude;
  api.entity.setPosition(p.x, p.y, p.z);
}`,
  winZone:
`// Win Zone — clear the level when the player steps on this.
function onUpdate(api) {
  const player = api.find('Player');
  if (player && api.distance(player) < 1.6) {
    api.end({ win: true, message: 'You reached the goal!' });
  }
}`,
  blank:
`// Write onStart(api) and/or onUpdate(api). Both are optional.
// Top-level variables persist across frames for this script instance.

function onStart(api) {
  // runs once when Play begins
}

function onUpdate(api) {
  // runs every frame while playing
}`,
};

/* ------------------------------------------------------------------ */
/* Geometry / material / light builders                               */
/* ------------------------------------------------------------------ */
function buildWedge() {
  // unit right-triangular prism: vertical face at -Z, sloping down toward +Z
  const g = new THREE.BufferGeometry();
  const v = [
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, // bottom
    -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,                                     // top back edge
  ];
  const idx = [
    0, 1, 2, 0, 2, 3,       // bottom
    0, 4, 5, 0, 5, 1,       // back vertical
    4, 3, 2, 4, 2, 5,       // slope
    0, 3, 4,                // left triangle
    1, 5, 2,                // right triangle
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function buildGeometry(shape) {
  switch (shape) {
    case 'sphere': return new THREE.SphereGeometry(0.5, 28, 20);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 24);
    case 'torus': return new THREE.TorusGeometry(0.5, 0.18, 12, 30);
    case 'wedge': return buildWedge();
    case 'plane': return new THREE.PlaneGeometry(1, 1, 1, 1);
    case 'box': default: return new THREE.BoxGeometry(1, 1, 1);
  }
}
function buildMaterial(m) {
  const transparency = m.transparency != null ? m.transparency : (1 - (m.opacity != null ? m.opacity : 1));
  const opacity = Math.max(0.05, 1 - transparency);
  if (!m.material) {
    // legacy path (scenes/prefabs authored before the material system)
    return new THREE.MeshStandardMaterial({
      color: m.color, metalness: m.metalness, roughness: m.roughness,
      emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
      transparent: opacity < 1, opacity, wireframe: !!m.wireframe,
    });
  }
  const preset = MATERIALS[m.material] || MATERIALS.plastic;
  const refl = m.reflectance || 0;
  const glow = preset.emissive || 0;
  const ff = m.material === 'forcefield';
  return new THREE.MeshStandardMaterial({
    color: m.color,
    metalness: Math.max(preset.metalness, refl),
    roughness: Math.max(0.02, preset.roughness * (1 - refl * 0.6)),
    emissive: glow > 0 ? m.color : (m.emissive || '#000000'),
    emissiveIntensity: glow > 0 ? glow : (m.emissiveIntensity || 0),
    transparent: opacity < 1 || preset.clear || ff,
    opacity: ff ? Math.min(opacity, 0.4) : (preset.clear ? Math.min(opacity, 0.6) : opacity),
    wireframe: !!m.wireframe,
  });
}
function buildLight(l) {
  let light;
  switch (l.type) {
    case 'directional': light = new THREE.DirectionalLight(l.color, l.intensity); break;
    case 'spot': light = new THREE.SpotLight(l.color, l.intensity, l.distance, l.angle, l.penumbra); break;
    case 'ambient': light = new THREE.AmbientLight(l.color, l.intensity); break;
    case 'point': default: light = new THREE.PointLight(l.color, l.intensity, l.distance); break;
  }
  if (l.castShadow && light.shadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    if (light.shadow.camera) {
      light.shadow.camera.near = 0.5; light.shadow.camera.far = 60;
      if (light.shadow.camera.left !== undefined) {
        light.shadow.camera.left = -14; light.shadow.camera.right = 14;
        light.shadow.camera.top = 14; light.shadow.camera.bottom = -14;
      }
    }
    light.shadow.bias = -0.002;
  }
  return light;
}
function disposeSceneDeep(root) {
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      }
    }
  });
}
function skyTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Scene defaults                                                      */
/* ------------------------------------------------------------------ */
function defaultSettings() {
  return {
    sky: { top: '#1a2036', bottom: '#0a0d18' },
    fogColor: '#0a0d18', fogNear: 24, fogDensity: 0.028,
    ambient: { color: '#8fa2ff', intensity: 0.35 },
    gravity: -18, shadows: true, bloom: true, bloomStrength: 0.55,
  };
}
function newScene(title) {
  return { id: uid(), title: title || '', updated: Date.now(), published: false, settings: defaultSettings(), entities: [] };
}

/* ------------------------------------------------------------------ */
/* Runtime: builds a live THREE + cannon world from scene JSON         */
/* ------------------------------------------------------------------ */
class Runtime {
  constructor(canvas, sceneData, opts) {
    this.canvas = canvas;
    this.opts = opts || {};
    this.keys = {}; this.pressedKeys = new Set(); this.mouseDX = 0; this.mouseDY = 0;
    this.logs = [];
    this._raf = 0;
    this._accum = 0;

    this._initThreeOnce();
    this.loadScene(sceneData);
    this._bindInput();
    this._resize();
    addEventListener('resize', this._resizeHandler = () => this._resize());
  }

  /* ---------------- three.js setup (once per Runtime instance) ---------------- */
  _initThreeOnce() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputColorSpace' in this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    else this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.editCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.editCamera.position.set(8, 6, 12);
    this.activeCamera = this.editCamera;

    this.scene = new THREE.Scene();
    this.renderPass = new THREE.RenderPass(this.scene, this.activeCamera);

    // UnrealBloomPass replaces its input with a bloom-ONLY buffer — it does not
    // composite over the original image. So bloom needs its own composer that
    // extracts+blurs bright pixels, and a second composer that additively mixes
    // that bloom texture back over a normal full-color render (the standard
    // "selective bloom" two-composer recipe from the three.js examples).
    this.bloomComposer = new THREE.EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(this.renderPass);
    this.bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.86);
    this.bloomComposer.addPass(this.bloomPass);

    const mixMaterial = new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
        }`,
    });
    this.mixPass = new THREE.ShaderPass(mixMaterial, 'baseTexture');
    this.mixPass.needsSwap = true;

    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.mixPass);
  }

  _resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomComposer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    for (const cam of [this.editCamera, ...[...this.entities.values()].filter(e => e.cameraObj).map(e => e.cameraObj)]) {
      cam.aspect = w / h; cam.updateProjectionMatrix();
    }
  }

  /* ---------------- scene (re)construction ----------------
     Loading a scene never recreates the renderer/GL context — it only
     rebuilds the THREE.Scene graph — so it's safe to call repeatedly
     (every editor edit, and to restore the exact pre-Play state on Stop). */
  applySettings() {
    const s = this.data.settings;
    this.scene.background = skyTexture(s.sky.top, s.sky.bottom);
    this.scene.fog = new THREE.FogExp2(s.fogColor, s.fogDensity);
    this.renderer.shadowMap.enabled = !!s.shadows;
    this.bloomPass.enabled = !!s.bloom;
    this.bloomPass.strength = s.bloomStrength;
    this.ambientLight = new THREE.HemisphereLight(s.ambient.color, '#11131c', s.ambient.intensity);
    this.scene.add(this.ambientLight);
  }

  loadScene(sceneData) {
    this.data = sceneData;
    this.playing = false;
    this.world = null;
    this.score = 0;
    this._ended = false;
    this.time = 0;
    if (this.scene) disposeSceneDeep(this.scene);
    this.scene = new THREE.Scene();
    this.renderPass.scene = this.scene;
    this.activeCamera = this.editCamera;
    this.renderPass.camera = this.activeCamera;
    this.entities = new Map();
    this.byName = new Map();
    this.byTag = new Map();

    this.applySettings();
    for (const ent of this.data.entities) this._buildEntity(ent, this.scene);
    const cams = [...this.entities.values()].filter(e => e.data.camera);
    this.mainCameraEntity = cams.find(e => e.data.camera.isMain) || cams[0] || null;
    this._resize();
  }

  _buildEntity(data, parentObj) {
    const rec = { data, object3d: null, meshObj: null, lightObj: null, cameraObj: null, body: null, scriptInstances: [] };
    const obj = new THREE.Group();
    obj.position.set(...data.transform.position);
    obj.rotation.set(THREE.MathUtils.degToRad(data.transform.rotation[0]), THREE.MathUtils.degToRad(data.transform.rotation[1]), THREE.MathUtils.degToRad(data.transform.rotation[2]));
    obj.scale.set(...data.transform.scale);
    obj.userData.entityId = data.id;
    parentObj.add(obj);
    rec.object3d = obj;

    if (data.mesh) {
      const geo = buildGeometry(data.mesh.shape);
      const mat = buildMaterial(data.mesh);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = data.mesh.castShadow; mesh.receiveShadow = data.mesh.receiveShadow;
      if (data.mesh.shape === 'plane') mesh.rotation.x = -Math.PI / 2;
      obj.add(mesh);
      rec.meshObj = mesh;
    }
    if (data.light) {
      const light = buildLight(data.light);
      obj.add(light);
      rec.lightObj = light;
    }
    if (data.camera) {
      const cam = new THREE.PerspectiveCamera(data.camera.fov, innerWidth / innerHeight, 0.1, 400);
      obj.add(cam);
      rec.cameraObj = cam;
    }

    this.entities.set(data.id, rec);
    if (data.name) this.byName.set(data.name, rec);
    if (data.tag) { if (!this.byTag.has(data.tag)) this.byTag.set(data.tag, []); this.byTag.get(data.tag).push(rec); }
    for (const child of data.children || []) this._buildEntity(child, obj);
    return rec;
  }

  /* ---------------- physics ---------------- */
  _initPhysics() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, this.data.settings.gravity, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.4;
    this.world.defaultContactMaterial.restitution = 0.1;

    for (const rec of this.entities.values()) {
      const rb = rec.data.rigidbody;
      if (!rb) continue;
      const pos = rec.object3d.getWorldPosition(new THREE.Vector3());
      const quat = rec.object3d.getWorldQuaternion(new THREE.Quaternion());
      const scale = rec.object3d.getWorldScale(new THREE.Vector3());

      let shape;
      if (rb.shape === 'sphere') {
        const r = 0.5 * Math.max(scale.x, scale.y, scale.z);
        shape = new CANNON.Sphere(r);
      } else if (rb.shape === 'cylinder') {
        shape = new CANNON.Cylinder(0.5 * scale.x, 0.5 * scale.x, 1 * scale.y, 16);
      } else {
        shape = new CANNON.Box(new CANNON.Vec3(0.5 * scale.x, 0.5 * scale.y, 0.5 * scale.z));
      }
      const mat = new CANNON.Material('m_' + rec.data.id);
      mat.friction = rb.friction; mat.restitution = rb.restitution;
      const body = new CANNON.Body({
        mass: rb.mass, shape, material: mat,
        position: new CANNON.Vec3(pos.x, pos.y, pos.z),
        quaternion: new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w),
        linearDamping: rb.linearDamping != null ? rb.linearDamping : 0.05,
        fixedRotation: !!rb.fixedRotation,
        isTrigger: !!rb.isTrigger,
        allowSleep: true,
      });
      body.updateMassProperties();
      body.gxEntityId = rec.data.id;
      body.addEventListener('collide', (e) => this._onCollide(rec, e));
      this.world.addBody(body);
      rec.body = body;
    }
  }
  _onCollide(rec, e) {
    const otherId = e.body.gxEntityId;
    const otherRec = otherId ? this.entities.get(otherId) : null;
    for (const inst of rec.scriptInstances) {
      if (inst.handlers.onCollide) this._safeCall(inst, 'onCollide', otherRec ? this._handle(otherRec) : null);
    }
  }

  /* ---------------- scripting ---------------- */
  _compile(code) {
    try {
      const factory = new Function(
        code + '\nreturn { onStart: typeof onStart==="function"?onStart:null, onUpdate: typeof onUpdate==="function"?onUpdate:null, onCollide: typeof onCollide==="function"?onCollide:null };'
      );
      return { handlers: factory() };
    } catch (err) {
      return { handlers: {}, error: err.message };
    }
  }
  _compileScript(s) {
    if (s.lang === 'gamx') {
      if (!window.GamX) return { handlers: {}, error: 'GamX language not loaded' };
      try { return this._compile(window.GamX.toJS(s.code)); }
      catch (e) { return { handlers: {}, error: e.message }; }
    }
    return this._compile(s.code);
  }
  _initScripts() {
    for (const rec of this.entities.values()) {
      for (const s of rec.data.scripts) {
        if (!s.enabled) continue;
        const compiled = this._compileScript(s);
        if (compiled.error) { this.log(rec.data.name, 'compile error: ' + compiled.error, true); continue; }
        const inst = { rec, script: s, handlers: compiled.handlers, api: this._makeApi(rec) };
        rec.scriptInstances.push(inst);
      }
    }
    for (const rec of this.entities.values()) {
      for (const inst of rec.scriptInstances) {
        if (inst.handlers.onStart) this._safeCall(inst, 'onStart');
      }
    }
  }
  _safeCall(inst, fn, arg) {
    try {
      inst.api.time = this.time; inst.api.dt = this._lastDt || 0;
      inst.handlers[fn](inst.api, arg);
    } catch (err) {
      this.log(inst.rec.data.name, fn + '() error: ' + err.message, true);
      inst.handlers[fn] = null; // stop erroring every frame
    }
  }

  /* handle wraps a runtime entity record for scripts */
  _handle(rec) {
    const self = this;
    return {
      id: rec.data.id, name: rec.data.name, tag: rec.data.tag,
      getPosition: () => rec.object3d.position.clone(),
      setPosition: (x, y, z) => { if (typeof x === 'object') rec.object3d.position.set(x.x, x.y, x.z); else rec.object3d.position.set(x, y, z); self._syncBodyFromObject(rec); },
      moveToward: (target, speed) => {
        const k = Math.min(1, (speed || 4) * (self._lastDt || 0.016));
        rec.object3d.position.lerp(new THREE.Vector3(target.x, target.y, target.z), k);
        self._syncBodyFromObject(rec);
      },
      getRotation: () => ({ x: THREE.MathUtils.radToDeg(rec.object3d.rotation.x), y: THREE.MathUtils.radToDeg(rec.object3d.rotation.y), z: THREE.MathUtils.radToDeg(rec.object3d.rotation.z) }),
      setRotation: (x, y, z) => { rec.object3d.rotation.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z)); },
      rotateY: (rad) => { rec.object3d.rotation.y += rad; },
      lookAt: (x, y, z) => {
        // Object3D.lookAt() treats cameras/lights specially (forward = -Z toward
        // the target) but faces plain Group/Mesh objects the opposite way. Scripts
        // call this on the entity's Group, so replicate the camera-style behavior
        // unconditionally — "forward always faces the target", regardless of
        // whether this entity happens to carry a camera child.
        const eye = rec.object3d.getWorldPosition(new THREE.Vector3());
        const m = new THREE.Matrix4().lookAt(eye, new THREE.Vector3(x, y, z), rec.object3d.up);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        if (rec.object3d.parent) {
          const pq = rec.object3d.parent.getWorldQuaternion(new THREE.Quaternion());
          q.premultiply(pq.invert());
        }
        rec.object3d.quaternion.copy(q);
      },
      setVisible: (v) => { rec.object3d.visible = v; },
      setColor: (hex) => { const mesh = rec.meshObj; if (mesh && mesh.material && mesh.material.color) mesh.material.color.set(hex); },
      destroy: () => self._destroyEntity(rec),
    };
  }
  _syncBodyFromObject(rec) {
    if (!rec.body) return;
    rec.body.position.set(rec.object3d.position.x, rec.object3d.position.y, rec.object3d.position.z);
    rec.body.velocity.set(0, rec.body.velocity.y, 0);
  }
  _destroyEntity(rec) {
    if (rec.object3d.parent) rec.object3d.parent.remove(rec.object3d);
    if (rec.body && this.world) this.world.removeBody(rec.body);
    this.entities.delete(rec.data.id);
    rec.scriptInstances = [];
  }

  _makeApi(rec) {
    const self = this;
    const entityHandle = this._handle(rec);
    return {
      entity: entityHandle,
      time: 0, dt: 0,
      input: {
        isDown: (code) => !!self.keys[code],
        pressed: (code) => self.pressedKeys.has(code),
        mouseDX: 0, mouseDY: 0,
      },
      velocity: {
        get: () => rec.body ? { x: rec.body.velocity.x, y: rec.body.velocity.y, z: rec.body.velocity.z } : { x: 0, y: 0, z: 0 },
        set: (x, y, z) => { if (rec.body) { rec.body.wakeUp(); rec.body.velocity.set(x, y, z); } },
        add: (x, y, z) => { if (rec.body) { rec.body.wakeUp(); rec.body.velocity.x += x; rec.body.velocity.y += y; rec.body.velocity.z += z; } },
      },
      isGrounded: () => self._isGrounded(rec),
      find: (name) => { const r = self.byName.get(name); return r ? self._handle(r) : null; },
      findAll: (tag) => (self.byTag.get(tag) || []).map(r => self._handle(r)),
      distance: (handle) => {
        if (!handle) return Infinity;
        const p = handle.getPosition ? handle.getPosition() : handle;
        return rec.object3d.position.distanceTo(new THREE.Vector3(p.x, p.y, p.z));
      },
      spawn: (opts) => {
        const clone = JSON.parse(JSON.stringify(rec.data));
        clone.id = uid();
        if (opts) clone.transform.position = [opts.x || 0, opts.y || 0, opts.z || 0];
        const newRec = self._buildEntity(clone, rec.object3d.parent);
        if (self.world) self._addBodyFor(newRec);
        for (const s of newRec.data.scripts) {
          if (!s.enabled) continue;
          const compiled = self._compileScript(s);
          const inst = { rec: newRec, script: s, handlers: compiled.handlers, api: self._makeApi(newRec) };
          newRec.scriptInstances.push(inst);
          if (inst.handlers.onStart) self._safeCall(inst, 'onStart');
        }
        return self._handle(newRec);
      },
      destroySelf: () => self._destroyEntity(rec),
      destroy: (handle) => { const r = handle && handle.id ? self.entities.get(handle.id) : null; if (r) self._destroyEntity(r); },
      score: { add: (n) => self._addScore(n), get: () => self.score || 0, set: (n) => { self.score = n; } },
      end: (result) => self._endGame(result),
      log: (...args) => self.log(rec.data.name, args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      random: (a, b) => a + Math.random() * (b - a),
      THREE,
    };
  }
  _addBodyFor(rec) {
    const rb = rec.data.rigidbody;
    if (!rb) return;
    const pos = rec.object3d.position, scale = rec.object3d.scale;
    let shape;
    if (rb.shape === 'sphere') shape = new CANNON.Sphere(0.5 * Math.max(scale.x, scale.y, scale.z));
    else if (rb.shape === 'cylinder') shape = new CANNON.Cylinder(0.5 * scale.x, 0.5 * scale.x, scale.y, 16);
    else shape = new CANNON.Box(new CANNON.Vec3(0.5 * scale.x, 0.5 * scale.y, 0.5 * scale.z));
    const body = new CANNON.Body({ mass: rb.mass, shape, position: new CANNON.Vec3(pos.x, pos.y, pos.z), fixedRotation: !!rb.fixedRotation });
    body.gxEntityId = rec.data.id;
    this.world.addBody(body);
    rec.body = body;
  }
  _isGrounded(rec) {
    if (!rec.body || !this.world) return false;
    const from = rec.body.position;
    const to = new CANNON.Vec3(from.x, from.y - 0.75, from.z);
    const result = new CANNON.RaycastResult();
    this.world.raycastClosest(from, to, {}, result);
    return result.hasHit;
  }
  _addScore(n) { this.score = (this.score || 0) + n; }
  _endGame(result) {
    if (this._ended) return;
    this._ended = true;
    (this.opts.onEnd || (() => {}))(result);
  }
  log(who, msg, isError) {
    this.logs.push({ who, msg, isError: !!isError, t: this.time });
    if (this.logs.length > 200) this.logs.shift();
    (this.opts.onLog || (() => {}))(who, msg, isError);
  }

  /* ---------------- input ---------------- */
  _bindInput() {
    this._onKeyDown = (e) => { if (!this.keys[e.code]) this.pressedKeys.add(e.code); this.keys[e.code] = true; };
    this._onKeyUp = (e) => { this.keys[e.code] = false; };
    this._onMouseMove = (e) => { this.mouseDX += e.movementX || 0; this.mouseDY += e.movementY || 0; };
    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('mousemove', this._onMouseMove);
  }

  /* ---------------- character playtest (Roblox-style "Play Solo") ----------------
     Spawns a controllable blocky avatar at a SpawnLocation, gives every part a
     collider (anchored = static, unanchored = falls), and drives a third-person
     camera with mouse-look + WASD + jump. Used when the scene has no scripted
     'player' entity. */
  _initCharacterColliders() {
    if (!this._groundMat) this._groundMat = new CANNON.Material('gxground');
    for (const rec of this.entities.values()) {
      if (rec.body) continue;                 // already has a collider (explicit rigidbody)
      const m = rec.data.mesh;
      if (!m || m.canCollide === false) continue;
      const scale = rec.object3d.getWorldScale(new THREE.Vector3());
      const pos = rec.object3d.getWorldPosition(new THREE.Vector3());
      const quat = rec.object3d.getWorldQuaternion(new THREE.Quaternion());
      const anchored = m.anchored !== false;
      let shape;
      if (m.shape === 'sphere') shape = new CANNON.Sphere(0.5 * Math.max(scale.x, scale.y, scale.z));
      else shape = new CANNON.Box(new CANNON.Vec3(Math.max(0.05, 0.5 * scale.x), Math.max(0.05, 0.5 * scale.y), Math.max(0.05, 0.5 * scale.z)));
      const mass = anchored ? 0 : Math.max(1, scale.x * scale.y * scale.z);
      const body = new CANNON.Body({ mass, shape, material: this._groundMat, position: new CANNON.Vec3(pos.x, pos.y, pos.z), quaternion: new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w) });
      body.gxEntityId = rec.data.id;
      this.world.addBody(body);
      if (!anchored) rec.body = body;         // dynamic parts follow their body
    }
  }
  _buildAvatar() {
    const g = new THREE.Group();
    const mk = (w, h, d, color, y) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
      mesh.position.y = y; mesh.castShadow = true; g.add(mesh); return mesh;
    };
    mk(1.0, 1.0, 0.5, '#f2c14e', 2.0);      // head
    mk(1.4, 1.4, 0.7, '#2d7dd2', 0.9);      // torso
    const la = mk(0.45, 1.3, 0.45, '#f2c14e', 0.85); la.position.x = -0.95;
    const ra = mk(0.45, 1.3, 0.45, '#f2c14e', 0.85); ra.position.x = 0.95;
    const ll = mk(0.55, 1.2, 0.55, '#3a7d3a', -0.3); ll.position.x = -0.35;
    const rl = mk(0.55, 1.2, 0.55, '#3a7d3a', -0.3); rl.position.x = 0.35;
    return g;
  }
  _spawnCharacter() {
    let sp = null;
    for (const rec of this.entities.values()) { const m = rec.data.mesh; if (rec.data.tag === 'spawn' || (m && m.isSpawn)) { sp = rec.object3d.getWorldPosition(new THREE.Vector3()); break; } }
    const start = sp ? { x: sp.x, y: sp.y + 2.4, z: sp.z } : { x: 0, y: 4, z: 0 };

    const group = this._buildAvatar();
    group.position.set(start.x, start.y - 1.2, start.z);
    this.scene.add(group);

    const charMat = new CANNON.Material('gxchar');
    const body = new CANNON.Body({
      mass: 5, fixedRotation: true, linearDamping: 0.0, allowSleep: false, material: charMat,
      shape: new CANNON.Sphere(1.1),
      position: new CANNON.Vec3(start.x, start.y, start.z),
    });
    body.updateMassProperties();
    this.world.addBody(body);
    // frictionless character-vs-ground contact so setting velocity actually moves it
    if (this._groundMat) this.world.addContactMaterial(new CANNON.ContactMaterial(charMat, this._groundMat, { friction: 0, restitution: 0 }));

    const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
    this.scene.add(cam);
    this.character = { body, group, cam, yaw: 0, pitch: 0.35, dist: 11, speed: 9, jump: 12 };
    this.activeCamera = cam;
    this.renderPass.camera = cam;
    this._resize();
  }
  _stepCharacter(dt) {
    const c = this.character; if (!c) return;
    c.yaw -= this.mouseDX * 0.0025;
    c.pitch = Math.max(-0.2, Math.min(1.2, c.pitch + this.mouseDY * 0.0025));

    // movement relative to camera yaw
    let fx = 0, fz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) fz -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) fz += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) fx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) fx += 1;
    const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
    // forward = (sin, cos) in this yaw convention (camera sits behind +)
    let wx = fx * cos - fz * sin;
    let wz = fx * sin + fz * cos;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx = wx / len * c.speed; wz = wz / len * c.speed; }
    c.body.wakeUp();
    c.body.velocity.x = wx; c.body.velocity.z = wz;

    // ground check + jump
    const from = c.body.position;
    const res = new CANNON.RaycastResult();
    this.world.raycastClosest(from, new CANNON.Vec3(from.x, from.y - 1.35, from.z), {}, res);
    const grounded = res.hasHit;
    if (grounded && (this.pressedKeys.has('Space'))) c.body.velocity.y = c.jump;

    // sync avatar
    c.group.position.set(from.x, from.y - 1.2, from.z);
    if (len > 0) { c.group.rotation.y = Math.atan2(wx, wz); }

    // respawn if fallen off the world
    if (from.y < -40) { const s = this._characterStart || { x: 0, y: 6, z: 0 }; c.body.position.set(s.x, s.y, s.z); c.body.velocity.set(0, 0, 0); }
    else if (!this._characterStart && grounded) this._characterStart = { x: from.x, y: from.y + 3, z: from.z };

    // third-person camera
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const cx = from.x - Math.sin(c.yaw) * c.dist * cp;
    const cy = from.y + 2.2 + sp * c.dist;
    const cz = from.z - Math.cos(c.yaw) * c.dist * cp;
    c.cam.position.set(cx, cy, cz);
    c.cam.lookAt(from.x, from.y + 1.2, from.z);
  }

  /* ---------------- play / stop ---------------- */
  play(opts) {
    if (this.playing) return;
    opts = opts || {};
    this._snapshot = JSON.parse(JSON.stringify(this.data));
    this.playing = true;
    this._ended = false;
    this.score = 0;
    this.time = 0;
    this.character = null;
    this._characterStart = null;
    this._initPhysics();
    const hasPlayer = [...this.entities.values()].some(r => r.data.tag === 'player');
    this.characterMode = opts.character != null ? opts.character : !hasPlayer;
    if (this.characterMode) { this._initCharacterColliders(); this._spawnCharacter(); }
    this._initScripts();
    if (!this.characterMode && this.mainCameraEntity) this.activeCamera = this.mainCameraEntity.cameraObj;
    this.renderPass.camera = this.activeCamera;
    this._resize();
  }
  stop() {
    if (!this.playing && !this._snapshot) return;
    const snap = this._snapshot;
    this._snapshot = null;
    this.world = null;
    this.characterMode = false;
    this.character = null;
    if (snap) {
      // restore in place so `this.data` stays the same object the editor holds
      const data = this.data;
      data.entities = snap.entities;
      data.settings = snap.settings;
      this.loadScene(data);
    } else {
      this.playing = false;
    }
  }

  /* ---------------- frame ---------------- */
  step(dt) {
    this._lastDt = dt;
    this.time += dt;
    if (this.playing && this.world) {
      if (this.characterMode) this._stepCharacter(dt);
      this._accum += dt;
      const FIXED = 1 / 60;
      let n = 0;
      while (this._accum >= FIXED && n < 5) { this.world.step(FIXED); this._accum -= FIXED; n++; }
      for (const rec of this.entities.values()) {
        if (rec.body && !rec.data.rigidbody.isTrigger) {
          rec.object3d.position.copy(rec.body.position);
          rec.object3d.quaternion.copy(rec.body.quaternion);
        }
      }
      for (const rec of this.entities.values()) {
        for (const inst of rec.scriptInstances) {
          if (inst.handlers.onUpdate) this._safeCall(inst, 'onUpdate');
        }
      }
    }
    this.pressedKeys.clear();
    this.mouseDX = 0; this.mouseDY = 0;
  }
  render() {
    if (this.bloomPass.enabled) {
      this.bloomComposer.render();
      this.composer.render();
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.activeCamera);
    }
  }
  dispose() {
    cancelAnimationFrame(this._raf);
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('mousemove', this._onMouseMove);
    removeEventListener('resize', this._resizeHandler);
  }
}

/* ------------------------------------------------------------------ */
/* Serialization helpers used by the editor                           */
/* ------------------------------------------------------------------ */
function cloneEntity(data) {
  const c = JSON.parse(JSON.stringify(data));
  (function relabel(e) { e.id = uid(); (e.children || []).forEach(relabel); (e.scripts || []).forEach(s => s.id = uid()); })(c);
  return c;
}
function validateScene(scene) {
  // Soft validation: character Play works with any parts. Only block on an
  // empty scene; a scripted-player scene still needs its main camera.
  const issues = [];
  let count = 0, hasPlayer = false, hasMain = false;
  (function walk(list) {
    for (const e of list) {
      count++;
      if (e.tag === 'player') hasPlayer = true;
      if (e.camera && e.camera.isMain) hasMain = true;
      walk(e.children || []);
    }
  })(scene.entities);
  if (!count) issues.push('Add at least one part or a Baseplate first.');
  if (hasPlayer && !hasMain) issues.push('Your scripted Player needs a Main Camera (select a Camera → check “Main Camera”).');
  return issues;
}

window.GXStudio = {
  newEntity, newScene, defaultSettings, PREFABS, SCRIPT_LIB,
  buildGeometry, buildMaterial, Runtime, cloneEntity, validateScene, uid,
  MATERIALS, MATERIAL_ORDER,
};
})();
