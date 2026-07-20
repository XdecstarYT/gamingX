/* ============================================================================
   AURORA — WebGPU renderer with a GPU-compute particle nebula (Three.js TSL).

   This is the showcase layer. It loads the modern Three.js WebGPU build from a
   CDN (see the importmap in index.html), runs ~150k particles entirely on the
   GPU via a TSL compute shader (swirl flow + attraction to your ship), and
   renders them with additive blending for a glowing nebula you fly through.

   WebGPURenderer automatically uses a WebGL2 backend when WebGPU isn't
   available, so this runs on most modern browsers. If ANYTHING here fails
   (no module support, an API mismatch, an old browser), it sets
   window.__auroraGpuFailed and ui.js silently uses the 2D fallback instead —
   the game is always playable.

   NOTE: this path can't be verified in the build sandbox (the CDN is blocked
   there and headless has no WebGPU), so it's written to the documented r17x
   TSL API and guarded end-to-end. It gets its real test on a live device.
   ========================================================================== */
import * as THREE from 'three';
import {
  Fn, instancedArray, instanceIndex, uniform, vec3, vec4, float, hash, color, mix,
} from 'three/tsl';

const AR = 62;          // arena radius (matches core.js)
const COUNT = 150000;   // GPU particles

(async function initAurora() {
  try {
    const canvas = document.getElementById('stage');
    if (!canvas) throw new Error('no canvas');

    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    await renderer.init();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060f);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);

    /* ---------- GPU-compute particle buffers ---------- */
    const positions = instancedArray(COUNT, 'vec3');
    const velocities = instancedArray(COUNT, 'vec3');
    const uShip = uniform(vec3(0, 0, 0));
    const uDt = uniform(0.016);

    const computeInit = Fn(() => {
      const p = positions.element(instanceIndex);
      const v = velocities.element(instanceIndex);
      const a = hash(instanceIndex.add(1)).mul(6.2831853);
      const rad = hash(instanceIndex.add(2)).sqrt().mul(AR);
      const z = hash(instanceIndex.add(3)).sub(0.5).mul(10);
      p.assign(vec3(a.cos().mul(rad), a.sin().mul(rad), z));
      v.assign(vec3(0, 0, 0));
    })().compute(COUNT);
    await renderer.computeAsync(computeInit);

    const computeUpdate = Fn(() => {
      const p = positions.element(instanceIndex);
      const v = velocities.element(instanceIndex);
      // swirl in the xy play-plane
      const swirl = vec3(p.y.negate(), p.x, float(0)).normalize().mul(6.0);
      // gentle attraction toward the ship
      const toShip = uShip.sub(p);
      const dd = toShip.length().max(0.001);
      const pull = toShip.div(dd).mul(float(26).div(dd.mul(0.12).add(1)));
      v.addAssign(swirl.add(pull).mul(uDt));
      v.mulAssign(0.985);
      p.addAssign(v.mul(uDt));
      // keep particles inside the arena cylinder
      const flat = vec3(p.x, p.y, float(0));
      const rxy = flat.length().max(0.001);
      const over = rxy.sub(AR).max(0.0);
      p.subAssign(flat.div(rxy).mul(over));
    })().compute(COUNT);

    /* ---------- particle material ---------- */
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.positionNode = positions.toAttribute();
    const speed = velocities.toAttribute().length().mul(0.12).clamp(0, 1);
    mat.colorNode = vec4(mix(color(0x1e5cff), color(0x66ffe6), speed), 0.55);
    mat.scaleNode = float(0.4);
    const particles = new THREE.Sprite(mat);
    particles.count = COUNT;
    particles.frustumCulled = false;
    scene.add(particles);

    /* ---------- ship + arena ring ---------- */
    const shipMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff });
    const ship = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 5), shipMat);
    ship.rotation.x = Math.PI / 2;
    scene.add(ship);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 16), new THREE.MeshBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    ship.add(glow);

    const ring = new THREE.Mesh(new THREE.RingGeometry(AR - 0.4, AR + 0.4, 128), new THREE.MeshBasicMaterial({ color: 0x3a6cff, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
    scene.add(ring);

    /* ---------- pickup pool ---------- */
    const coreGeo = new THREE.IcosahedronGeometry(1.4, 1);
    const voidGeo = new THREE.TorusGeometry(1.8, 0.35, 10, 24);
    const pool = [];
    function getPickupMesh(i, kind) {
      if (!pool[i]) {
        const m = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        scene.add(m); pool[i] = m;
      }
      const m = pool[i];
      if (m._kind !== kind) {
        m.geometry = kind === 'core' ? coreGeo : voidGeo;
        m.material.color.set(kind === 'core' ? 0x66ffe6 : 0xff5070);
        m.material.opacity = kind === 'core' ? 0.95 : 0.9;
        m._kind = kind;
      }
      m.visible = true;
      return m;
    }

    /* ---------- controller consumed by ui.js ---------- */
    let latest = null, latestDt = 0.016;
    let vw = 1, vh = 1;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      vw = canvas.clientWidth; vh = canvas.clientHeight;
      renderer.setPixelRatio(dpr);
      renderer.setSize(vw, vh, false);
      camera.aspect = vw / Math.max(1, vh); camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    renderer.setAnimationLoop(() => {
      const g = latest;
      if (g) {
        uShip.value.set(g.ship.x, g.ship.y, 0);
        uDt.value = Math.min(0.05, latestDt) * 60 * 0.016; // stabilise compute step
        ship.position.set(g.ship.x, g.ship.y, 0);
        ship.rotation.z = g.ship.angle - Math.PI / 2;
        glow.material.opacity = 0.2 + 0.5 * (g.ship.thrust || 0);
        // camera trails the ship, tilted for depth
        camera.position.set(g.ship.x, g.ship.y - 26, 60);
        camera.lookAt(g.ship.x, g.ship.y + 6, 0);
        // pickups
        let n = 0;
        for (; n < g.pickups.length; n++) {
          const pk = g.pickups[n];
          const m = getPickupMesh(n, pk.kind);
          m.position.set(pk.x, pk.y, 0);
          m.rotation.x += 0.02; m.rotation.y += 0.03;
          const s = 0.8 + 0.25 * Math.sin((g.time + pk.phase) * 4);
          m.scale.setScalar(s);
        }
        for (; n < pool.length; n++) if (pool[n]) pool[n].visible = false;
      }
      renderer.compute(computeUpdate);
      renderer.render(scene, camera);
    });

    const kind = (renderer.backend && renderer.backend.isWebGPUBackend) ? 'webgpu' : 'webgl';
    window.AuroraGPU = () => ({ draw: (g, dt) => { latest = g; latestDt = dt; }, resize, kind });
    window.__auroraGpuReady = true;
    console.log('[Aurora] GPU renderer ready:', kind, '·', COUNT.toLocaleString(), 'compute particles');
  } catch (e) {
    window.__auroraGpuFailed = true;
    console.warn('[Aurora] WebGPU renderer unavailable — using 2D fallback.', e && e.message);
  }
})();
