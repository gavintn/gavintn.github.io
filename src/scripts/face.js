import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/* ------------------------------------------------------------------ *
 *  Setup: where it draws. Put <div id="face"></div> and
 *  <p id="face-bark"></p> on your page. Set window.FACE_URL to the .glb.
 * ------------------------------------------------------------------ */
const params = new URLSearchParams(location.search);
const FREEZE = params.has('freeze'); // used for screenshots
const USE_TEXTURE = !params.has('grey'); // default: photo texture; ?grey shows the plain lit mesh
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

const container = document.getElementById('face') || document.body;
const barkEl = document.getElementById('face-bark');
const size = () => ({
  w: container.clientWidth || innerWidth,
  h: container.clientHeight || innerHeight,
});

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000);
container.appendChild(renderer.domElement);
renderer.domElement.style.display = 'block';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 10);
camera.position.set(0, 0.63, 1.0);
camera.lookAt(0, 0.63, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(0.25, 1.6, 1.4);
scene.add(key);

const pivot = new THREE.Group();
scene.add(pivot);

/* ------------------------------------------------------------------ *
 *  Glitch post-process
 * ------------------------------------------------------------------ */
const GlitchShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uLines: { value: 150.0 },   // scanline rows
    uShift: { value: REDUCE ? 0.002 : 0.010 }, // base horizontal tear
    uSplit: { value: 0.0035 },  // RGB channel split
    uBurst: { value: 0.0 },     // 0..1 pulse, set by clicks
    uGamma: { value: USE_TEXTURE ? 0.6 : 1.0 },
    uGain: { value: USE_TEXTURE ? 1.9 : 1.0 },
    uBlack: { value: USE_TEXTURE ? 0.17 : 0.03 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uLines, uShift, uSplit, uBurst, uGamma, uGain, uBlack;
    uniform vec2 uRes;
    varying vec2 vUv;

    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
    float sampleL(vec2 uv){ return lum(texture2D(tDiffuse, uv).rgb); }

    void main(){
      // keep effect sizes proportional to the canvas height, so any panel shape looks the same
      float k = uRes.y / 600.0;
      float ax = (uRes.y / uRes.x) * 1.3333;
      float tick = floor(uTime * 10.0);
      float row = floor(vUv.y * uLines);

      // vertical streaking: some columns get smeared up/down
      float colId = floor(vUv.x * uRes.x / (3.0 * k));
      float colRnd = hash(vec2(colId, floor(uTime * 4.0)));
      float smear = step(0.9, colRnd) * (hash(vec2(colId, 7.0)) - 0.3) * 0.035;
      float vy = vUv.y + smear;

      // horizontal tearing: per-row jitter + occasional hard bands
      float r = hash(vec2(row, tick));
      float tear = (r - 0.5) * uShift;
      float band = floor(vUv.y * 7.0 + tick * 0.31);
      float burst = step(0.9, hash(vec2(band, tick)));
      tear += burst * (hash(vec2(row, band)) - 0.5) * 0.025;
      tear += sin(vUv.y * 38.0 + uTime * 1.1) * 0.0012;
      tear *= (1.0 + uBurst * 4.0) * ax;

      vec2 uv = vec2(vUv.x + tear, vy);
      float s = uSplit * (1.0 + burst * 1.0 + uBurst * 4.0) * ax;
      // grey "ghost" echo instead of coloured fringes: the offset copies are blended in as plain brightness
      float cr = sampleL(uv + vec2( s, 0.0));
      float cg = sampleL(uv);
      float cb = sampleL(uv + vec2(-s, 0.0));
      vec3 col = vec3(0.5 * cg + 0.25 * (cr + cb));

      // soft glow
      vec2 px = k / uRes;
      float glow = sampleL(uv + vec2(6.0,0.0)*px) + sampleL(uv + vec2(-6.0,0.0)*px)
                 + sampleL(uv + vec2(0.0,6.0)*px) + sampleL(uv + vec2(0.0,-6.0)*px);
      col += vec3(glow * 0.25) * 0.15;

      col = pow(col, vec3(uGamma)) * uGain;
      col = (col - 0.5) * 1.2 + 0.5;
      col = max(col - uBlack, 0.0) * 1.2;

      // scanline rows
      float stripe = mod(row, 2.0);
      col *= mix(0.78, 1.0, stripe);
      float edge = smoothstep(0.0, 0.2, fract(vUv.y * uLines));
      col *= mix(0.85, 1.0, edge);

      // blown-out white bands on the lit areas
      float bandRow = floor(vUv.y * uLines / 3.0);
      float blown = step(0.95 - uBurst * 0.2, hash(vec2(bandRow, floor(uTime * 3.0))));
      float m = smoothstep(0.18, 0.5, lum(col));
      col = mix(col, vec3(1.0), blown * m);

      // chest fade + vignette
      col *= smoothstep(0.0, 0.08, vUv.y);
      float d = distance(vUv, vec2(0.5, 0.52));
      col *= smoothstep(1.15, 0.5, d);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const glitch = new ShaderPass(GlitchShader);
composer.addPass(glitch);

const TAN = Math.tan(THREE.MathUtils.degToRad(14)); // half of the 28 degree field of view
function resize() {
  const { w, h } = size();
  camera.aspect = w / h;
  // back the camera off until head, hair and collarbone fit the panel (0.60 m wide, 0.56 m tall)
  const z = Math.max(0.56 / (2 * TAN), 0.60 / (2 * TAN * camera.aspect));
  camera.position.set(0, 0.62, z);
  camera.lookAt(0, 0.62, 0);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  glitch.uniforms.uRes.value.set(w, h);
}
new ResizeObserver(resize).observe(container);
resize();

/* ------------------------------------------------------------------ *
 *  Model
 * ------------------------------------------------------------------ */
const BASE_PITCH = 0.32; // how far the head is bowed (radians). Bigger = looks down more
const loader = new GLTFLoader();
loader.load(window.FACE_URL || '/face.glb', (gltf) => {
  const model = gltf.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (USE_TEXTURE) {
      const mat = new THREE.MeshBasicMaterial({ map: o.material.map });
      // Show head, neck and the collarbone line only. Fade out below it so the shirt text
      // and arms are hidden. Uses raw scan coordinates (metres, y up).
      // Raise/lower the 0.405 / 0.45 numbers to show less/more of the chest.
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vRaw;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRaw = position.xy;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vRaw;')
          .replace('#include <opaque_fragment>',
            'outgoingLight *= smoothstep(0.405, 0.45, vRaw.y);\n' +
            // the shirt is black, so give the collar band a minimum brightness to make it show
            'float halfW = mix(0.27, 0.09, smoothstep(0.41, 0.50, vRaw.y));\n' + // slopes in toward the neck
            'float side = 1.0 - smoothstep(halfW - 0.07, halfW, abs(vRaw.x));\n' +
            'outgoingLight = max(outgoingLight, vec3(0.09) * smoothstep(0.405, 0.43, vRaw.y) * (1.0 - smoothstep(0.47, 0.51, vRaw.y)) * side);\n' +
            '#include <opaque_fragment>');
      };
      o.material = mat;
    } else {
      o.geometry.computeVertexNormals();
      o.material = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.85 });
    }
  });
  model.position.set(0, -0.6, 0);
  pivot.position.set(0, 0.6, 0);
  pivot.add(model);
  pivot.rotation.x = BASE_PITCH;
  window.__ready = true;
  setTimeout(() => bark('hello', true), 900);
});

/* ------------------------------------------------------------------ *
 *  Barks: short lines under the render. Edit the words freely.
 * ------------------------------------------------------------------ */
const BARKS = {
  hello:       ['Oh. Hi.', 'You found me.', 'Hey.'],
  click:       ['Ow.', 'Careful.', 'That tickles.', 'Bold.'],
  doubleclick: ['Twice? Really?', 'Okay, okay.'],
  scrollDown:  ['Going somewhere?', 'More down there, I guess.'],
  scrollUp:    ['Back again?', 'Changed your mind?'],
  idle:        ['...still there?', 'Hello?', "I'll just wait."],
  back:        ['Welcome back.', 'Missed me?'],
  leave:       ["Where'd you go?"],
  key:         ["Typing? I'm not a text box.", 'Noted.'],
};
const COOLDOWN = { hello: 0, click: 6, doubleclick: 8,
  scrollDown: 14, scrollUp: 14, idle: 40, back: 10, leave: 20, key: 20 };
const MIN_GAP = 2.2; // seconds between any two barks

let lastBarkAt = -99, lastLine = '';
const lastByKind = {};
let typeTimer = 0, fadeTimer = 0;
const nowS = () => performance.now() / 1000;

function bark(kind, force = false) {
  if (!barkEl) return;
  const t = nowS();
  if (!force) {
    if (t - lastBarkAt < MIN_GAP) return;
    if (t - (lastByKind[kind] ?? -99) < (COOLDOWN[kind] ?? 10)) return;
  }
  const pool = BARKS[kind].filter((l) => l !== lastLine);
  const line = pool[Math.floor(Math.random() * pool.length)] || BARKS[kind][0];
  lastLine = line; lastBarkAt = t; lastByKind[kind] = t;

  clearTimeout(typeTimer); clearTimeout(fadeTimer);
  barkEl.style.opacity = '1';
  if (REDUCE) { barkEl.textContent = line; }
  else {
    barkEl.textContent = '';
    let i = 0;
    const step = () => {
      barkEl.textContent = line.slice(0, ++i);
      if (i < line.length) typeTimer = setTimeout(step, 32);
    };
    step();
  }
  fadeTimer = setTimeout(() => { barkEl.style.opacity = '0'; }, 3600 + line.length * 40);
}
if (barkEl) {
  barkEl.setAttribute('aria-live', 'polite');
  barkEl.style.transition = 'opacity 0.6s';
}

/* ------------------------------------------------------------------ *
 *  Reactions (not to mouse movement): clicks, scrolling, keys, idle,
 *  leaving and returning to the tab.
 * ------------------------------------------------------------------ */
let lastInputAt = nowS(), hiddenAt = 0, lastScrollY = scrollY, scrollTimer = 0;
const touchInput = () => { lastInputAt = nowS(); };

addEventListener('pointermove', touchInput); // counts as "not idle", but triggers no reaction
addEventListener('click', () => { glitch.uniforms.uBurst.value = 1; bark('click'); touchInput(); }); // 'click' does not fire while scrolling on a phone
addEventListener('dblclick', () => bark('doubleclick'));
addEventListener('keydown', () => { bark('key'); touchInput(); });
addEventListener('scroll', () => {
  touchInput();
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const dir = scrollY - lastScrollY;
    lastScrollY = scrollY;
    if (Math.abs(dir) > 40) bark(dir > 0 ? 'scrollDown' : 'scrollUp');
  }, 250);
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = nowS();
  else if (nowS() - hiddenAt > 5) bark('back');
});
document.documentElement.addEventListener('mouseleave', () => bark('leave'));

/* ------------------------------------------------------------------ *
 *  Movement: a slow, small drift. Every few seconds it picks a new tiny
 *  offset (sometimes back to centre). Edit YAW / PITCH to change the range.
 * ------------------------------------------------------------------ */
const YAW = 0.14;    // radians left/right
const PITCH = 0.04;  // radians up/down
let gaze = { x: 0, y: 0 }, nextLookAt = 0;

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = nowS();
  const timeU = FREEZE || REDUCE ? 3.3 : clock.elapsedTime;
  glitch.uniforms.uTime.value = timeU;
  glitch.uniforms.uBurst.value *= Math.exp(-dt * 5);

  let yaw = 0, pitch = BASE_PITCH;
  if (!FREEZE && !REDUCE) {
    if (t >= nextLookAt) {
      gaze = Math.random() < 0.3 ? { x: 0, y: 0 }
        : { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 };
      nextLookAt = t + 2 + Math.random() * 4;
    }
    yaw = gaze.x * YAW;
    pitch = BASE_PITCH + gaze.y * PITCH;
    const idleFor = t - lastInputAt;
    if (idleFor > 20) { pitch += Math.min((idleFor - 20) * 0.01, 0.1); if (idleFor > 20.5) bark('idle'); }
  }
  const k = 1 - Math.exp(-dt * 2.2);
  pivot.rotation.y += (yaw - pivot.rotation.y) * k;
  pivot.rotation.x += (pitch - pivot.rotation.x) * k;
  composer.render();
  requestAnimationFrame(frame);
}
frame();
