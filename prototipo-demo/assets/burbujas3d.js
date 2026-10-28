/* Burbujas grandes con Three.js (prueba híbrida), dentro del recuadro del título.
   Van encima de la espuma 2D: pocas (unas 40), con iridiscencia y reflejos calculados en un shader.
   Se cargan después de que la página termina, y se apagan solas si el dispositivo va lento. */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const hero = document.querySelector('.hero');
const cv = document.getElementById('burbujas3d');

if (!hero || !cv || matchMedia('(prefers-reduced-motion: reduce)').matches) {
  if (cv) cv.remove();
} else {
  iniciar().catch(() => cv.remove());
}

async function iniciar() {
  if (document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
  await new Promise((r) => ('requestIdleCallback' in window ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 300)));

  const THREE = await import(THREE_URL);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (_) { cv.remove(); return; }
  renderer.setClearColor(0x000000, 0);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---- shader: película de jabón ---- */
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aSeed;
      attribute float aPop;
      varying vec3 vN;
      varying float vSeed;
      varying float vPop;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
        vSeed = aSeed;
        vPop = aPop;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec3 vN;
      varying float vSeed;
      varying float vPop;

      // colores de interferencia de una película delgada (paleta coseno)
      vec3 film(float t) {
        return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
      }

      void main() {
        vec3 n = normalize(vN);
        vec3 v = vec3(0.0, 0.0, 1.0);
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        float fres = pow(1.0 - ndv, 2.4);

        // el grosor de la película cambia con el ángulo y se arremolina despacio
        float swirl = sin(n.y * 4.0 + uTime * 0.55 + vSeed * 6.28) * 0.5
                    + sin(n.x * 3.0 - uTime * 0.38 + vSeed * 3.0) * 0.5;
        float t = (1.0 - ndv) * 1.25 + swirl * 0.22 + vSeed;
        vec3 irid = film(t);

        // reflejos tipo ventana: uno grande arriba a la izquierda y otro tenue abajo a la derecha
        vec3 r = reflect(-v, n);
        float s1 = pow(max(dot(r, normalize(vec3(-0.55, 0.65, 0.55))), 0.0), 26.0);
        float s2 = pow(max(dot(r, normalize(vec3(0.6, -0.5, 0.6))), 0.0), 22.0);

        vec3 col = irid * (fres * 1.5 + 0.12) + vec3(0.55, 0.78, 1.0) * fres * 0.25 + vec3(1.0) * (s1 * 1.1 + s2 * 0.5);
        float a = clamp(fres * 1.05 + s1 * 0.9 + s2 * 0.5 + 0.05, 0.0, 1.0);

        // al reventar: se abre y se desvanece
        a *= (1.0 - vPop);
        gl_FragColor = vec4(col, a);
      }`,
  });

  const geometry = new THREE.SphereGeometry(1, 40, 28);
  const scene = new THREE.Scene();
  let camera, mesh, seedAttr, popAttr;
  const dummy = new THREE.Object3D();

  let W = 0, H = 0, B = [];
  function crear() {
    const r = cv.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera = new THREE.OrthographicCamera(0, W, H, 0, -1000, 1000);

    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    const escala = clamp(W / 1000, 0.5, 1.1);
    const n = clamp(Math.round((W * H) / 24000), 8, 40);
    B = [];
    for (let i = 0; i < n; i++) {
      B.push({
        x: rnd(0, W), y: rnd(0, H), r: rnd(11, 46) * escala,
        sp: rnd(7, 24), ph: rnd(0, 6.28), wob: rnd(6, 18), fw: rnd(0.4, 0.9),
        seed: Math.random(), pop: -1, vuelve: 0,
      });
    }
    mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.frustumCulled = false;
    seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(B.map((b) => b.seed)), 1);
    popAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    popAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSeed', seedAttr);
    geometry.setAttribute('aPop', popAttr);
    scene.add(mesh);
  }
  crear();

  /* ---- movimiento ---- */
  let T = 0;
  function reventar(b) { if (b.pop < 0 && T >= b.vuelve) b.pop = 0; }
  function actualizar(t, dt) {
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.pop >= 0) {
        b.pop += dt / 0.2;
        if (b.pop >= 1) { b.pop = -1; b.y = H + b.r + rnd(0, 60); b.x = rnd(0, W); b.vuelve = t + rnd(0.5, 1.6); }
      } else {
        b.y -= b.sp * dt;
        b.x += Math.sin(t * b.fw + b.ph) * b.wob * dt;
        if (b.y < -b.r * 1.5) { b.y = H + b.r * 1.5; b.x = rnd(0, W); }
        if (Math.random() < dt * 0.012) reventar(b);          // revientan solas de vez en cuando
      }
      const osc = 1 + 0.045 * Math.sin(t * 2.1 + b.ph * 2);
      const k = b.pop >= 0 ? 1 + 0.28 * b.pop : 1;
      dummy.position.set(b.x, H - b.y, 0);
      dummy.scale.set(b.r * osc * k, b.r / osc * k, b.r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      popAttr.array[i] = b.pop >= 0 ? b.pop : (t < b.vuelve ? 1 : 0);
    }
    mesh.instanceMatrix.needsUpdate = true;
    popAttr.needsUpdate = true;
    material.uniforms.uTime.value = t;
  }

  /* el mouse o el dedo revienta las que toca */
  hero.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    for (const b of B) if (b.pop < 0 && Math.hypot(b.x - px, b.y - py) < b.r + 4) reventar(b);
  }, { passive: true });

  /* ---- bucle, con pausa fuera de pantalla y freno si va lento ---- */
  let raf = 0, last = 0, enVista = true, frames = 0, suma = 0;
  function bucle(now) {
    raf = requestAnimationFrame(bucle);
    const dt = clamp((now - (last || now)) / 1000, 0, 0.05);
    last = now;
    T += dt;
    actualizar(T, dt);
    renderer.render(scene, camera);

    if (frames < 120) {                          // si tras 2 s el promedio supera ~28 ms, se apaga
      frames++; suma += dt * 1000;
      if (frames === 120 && suma / frames > 28) { parar(); cv.style.display = 'none'; document.documentElement.dataset.burbujas3d = 'apagado'; }
    }
  }
  function empezar() { if (!raf && enVista && cv.style.display !== 'none') { last = 0; raf = requestAnimationFrame(bucle); } }
  function parar() { cancelAnimationFrame(raf); raf = 0; }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { enVista = en.isIntersecting; enVista ? empezar() : parar(); }).observe(cv);
  }

  let rt = 0, w0 = W;
  new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(() => { const w = cv.getBoundingClientRect().width; if (Math.abs(w - w0) > 30) { w0 = w; crear(); } }, 200);
  }).observe(cv.parentElement);

  cv.classList.add('listo');
  document.documentElement.dataset.burbujas3d = 'activo';
  empezar();
}
