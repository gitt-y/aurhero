import './style.css';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

/* ==========================================================================
   AURANG — CINEMATIC ATMOSPHERIC EMERGENCE
   Philosophy: The logo already exists in the darkness.
   It does not "load" — it slowly awakens under cinematic light.
   ========================================================================== */

let scene, camera, renderer;
let mascotGroup;
let coreSystem, haloSystem, auraSystem;
let logoSpotlight;
let goldLeaves = [];
const leafCount = 250;

let logoAWidth = 0, logoAHeight = 0;
let logoBWidth = 0, logoBHeight = 0;
let scrollTimeline;

// Reveal is driven purely by a global 0→1 progress value.
// Each particle has its own random awakening threshold.
const revealParams = { reveal: 0, mistAlpha: 0, spotOpacity: 0, morphProgress: 0 };

const canvasEl    = document.getElementById('webgl-canvas');
const menuBtn     = document.getElementById('menu-btn');
const menuOverlay = document.getElementById('menu-overlay');

/* ==========================================================================
   THREE.JS INIT
   ========================================================================== */
function initThree() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020100, 0.012);

  const isMobile = window.innerWidth < 768;
  const startZ   = isMobile ? 18 : 12;

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, startZ);

  renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping    = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Volumetric light cone from above
  const coneCanvas = document.createElement('canvas');
  coneCanvas.width  = 64;
  coneCanvas.height = 128;
  const cCtx  = coneCanvas.getContext('2d');
  const cGrad = cCtx.createLinearGradient(0, 0, 0, 128);
  cGrad.addColorStop(0,   'rgba(255, 221, 67, 0.07)');
  cGrad.addColorStop(0.5, 'rgba(255, 200, 40, 0.02)');
  cGrad.addColorStop(1,   'rgba(0, 0, 0, 0.0)');
  cCtx.fillStyle = cGrad;
  cCtx.fillRect(0, 0, 64, 128);

  const cone    = new THREE.Mesh(
    new THREE.ConeGeometry(8, 25, 32, 1, true),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(coneCanvas),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  cone.position.set(0, 10, -3);
  scene.add(cone);

  loadLogoPoints();
  createGoldLeafField();

  window.addEventListener('resize', onWindowResize);
}

/* ==========================================================================
   LOGO PIXEL SCANNER (DUAL IMAGE MORPH)
   ========================================================================== */
async function loadLogoPoints() {
  try {
    const [pointsA, pointsB] = await Promise.all([
      extractPointsFromImage('/download.png',     5.5, 12000), // Hero: centred hero logo
      extractPointsFromImage('/download (1).png', 9.0, 12000, 0.52)  // About: Crop top 52% to ignore the logo graphic, just keep text. Scaled up slightly for readability.
    ]);

    const count = Math.min(Math.max(pointsA.length, pointsB.length), 12000);

    const finalA = matchPointCount(pointsA, count);
    const finalB = matchPointCount(pointsB, count);

    initParticleSystem(finalA, finalB);
  } catch (e) {
    console.error('Failed to load logo images:', e);
    const fallback = generateFallbackPoints(3500);
    initParticleSystem(fallback, fallback);
  }
}

/**
 * Extracts bright/opaque pixel positions from an image,
 * normalising them to 3D world space preserving the image's true aspect ratio.
 *
 * @param {string} src   - URL of the image in /public
 * @param {number} scale - World-space half-width of the rendered logo
 * @param {number} maxPts - Max number of sample points to return
 * @param {number} cropTop - Fraction (0.0 to 1.0) of the top of the image to ignore
 */
function extractPointsFromImage(src, scale, maxPts, cropTop = 0) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const W = img.width;
      const H = img.height;

      const canvas = document.createElement('canvas');
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);

      const { data } = ctx.getImageData(0, 0, W, H);

      // Detect whether the source image uses transparency or luminance
      let transp = 0;
      [0, W - 1, W * (H - 1), W * H - 1].forEach(idx => {
        if (data[idx * 4 + 3] < 100) transp++;
      });
      const useAlpha = transp >= 2;

      // Collect all valid pixel positions
      const valid = [];
      const startY = Math.floor(H * cropTop);
      for (let y = startY; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const a   = data[i + 3];
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (useAlpha ? a > 120 : lum > 80) valid.push({ x, y });
        }
      }

      if (valid.length === 0) {
        return resolve([]);
      }

      // Compute bounding box of valid points so we can center them perfectly
      let minX = W, maxX = 0, minY = H, maxY = 0;
      for (let pt of valid) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Down-sample to maxPts
      const step = Math.max(1, valid.length / maxPts);
      const points = [];
      for (let i = 0; i < valid.length; i += step) {
        const pt = valid[Math.floor(i)];
        // Normalise around the bounding box center, but scale by W/2 to preserve aspect ratio
        const nx =  (pt.x - cx) / (W / 2);
        const ny = -(pt.y - cy) / (W / 2); 
        points.push({ x: nx * scale, y: ny * scale });
      }

      resolve(points);
    };
    img.onerror = reject;
  });
}

function matchPointCount(points, targetCount) {
  const result = [];
  for (let i = 0; i < targetCount; i++) {
    const pt = points[i % points.length];
    result.push({
      x: pt.x, // Zero jitter for maximum sharpness
      y: pt.y
    });
  }
  // Shuffle for organic, criss-crossing morphing
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generateFallbackPoints(count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    pts.push({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 });
  }
  return pts;
}

/* ==========================================================================
   TEXTURE BUILDER
   ========================================================================== */
function buildGlowTexture(size, stops) {
  const c    = document.createElement('canvas');
  c.width    = c.height = size;
  const ctx  = c.getContext('2d');
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  stops.forEach(([pos, col]) => grad.addColorStop(pos, col));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/* ==========================================================================
   ATMOSPHERIC EMERGENCE SHADER
   Each particle has a random `aThreshold` (0.0–0.85).
   The particle becomes visible when uReveal > aThreshold.
   This creates a scattered, organic, non-spatial shimmer emergence
   — NOT a wave or a mask.
   ========================================================================== */
function createEmergenceShaderMaterial(texture, baseSize, baseOpacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:          { value: 0 },
      uReveal:        { value: 0.0 }, // 0 = all hidden, 1 = all visible
      uMorphProgress: { value: 0.0 }, // 0 = Logo A, 1 = Logo B
      uMap:           { value: texture },
      uSizeBase:      { value: baseSize },
      uOpacity:       { value: baseOpacity },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uReveal;
      uniform float uMorphProgress;
      uniform float uSizeBase;

      // aRandom.x = shimmer phase
      // aRandom.y = shimmer speed
      // aRandom.z = size multiplier
      attribute vec3 aRandom;

      // Each particle's personal awakening threshold (0.0 – 0.85)
      attribute float aThreshold;
      
      // Target position for morphing (About logo)
      attribute vec3 aTargetPosition;
      
      // Stagger morphing — per-particle organic delay
      attribute float aMorphDelay;

      varying float vAlpha;

      void main() {
        // --- Morph Logic with Organic Stagger ---
        float morphStart = aMorphDelay * 0.35; // 0 → 0.35
        float morph = clamp((uMorphProgress - morphStart) / 0.65, 0.0, 1.0);
        
        // Cinematic smooth ease in/out (smoothstep)
        morph = morph * morph * (3.0 - 2.0 * morph);

        vec3 posA = position;
        vec3 posB = aTargetPosition;
        vec3 pos  = mix(posA, posB, morph);

        // Soft turbulence — peaks at mid-morph, fades at start and end
        float turbulence = sin(morph * 3.14159) * 1.2;
        pos.x += sin(uTime * aRandom.y + pos.y * 2.5) * turbulence * aRandom.z * 0.4;
        pos.y += cos(uTime * aRandom.x + pos.x * 2.5) * turbulence * aRandom.z * 0.4;
        pos.z += sin(uTime * 0.7 + aRandom.x) * turbulence * 2.0;

        // Subtle atmospheric breathing drift
        // Reduce drift to near zero when morph is complete to maintain sharp text legibility
        float drift = mix(0.05, 0.002, morph) + (turbulence * 0.03);
        pos.x += sin(uTime * aRandom.y * 0.5 + aRandom.x) * drift;
        pos.y += cos(uTime * aRandom.y * 0.35 + aRandom.x + 1.5) * drift;
        pos.z += sin(uTime * aRandom.y * 0.25 + aRandom.x + 3.0) * drift * 0.5;

        // Per-particle emergence
        float delta    = 0.12;
        float rawAlpha = clamp((uReveal - aThreshold) / delta, 0.0, 1.0);
        rawAlpha = rawAlpha * rawAlpha * (3.0 - 2.0 * rawAlpha);

        // Gentle shimmer
        float shimmer = 0.88 + 0.12 * sin(uTime * aRandom.y * 1.5 + aRandom.x * 6.28);
        vAlpha = rawAlpha * shimmer;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize    = uSizeBase * aRandom.z * (10.0 / -mvPosition.z);
        gl_Position     = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.005) discard;
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(tex.rgb, tex.a * vAlpha * uOpacity);
      }
    `,
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
  });
}

/* ==========================================================================
   PARTICLE SYSTEM — ATMOSPHERIC EMERGENCE & MORPHING
   ========================================================================== */
function initParticleSystem(pointsA, pointsB) {
  // Calculate bounding box dimensions of both logos
  let minXA = Infinity, maxXA = -Infinity, minYA = Infinity, maxYA = -Infinity;
  for (let i = 0; i < pointsA.length; i++) {
    const x = pointsA[i].x;
    const y = pointsA[i].y;
    if (x < minXA) minXA = x;
    if (x > maxXA) maxXA = x;
    if (y < minYA) minYA = y;
    if (y > maxYA) maxYA = y;
  }
  logoAWidth = maxXA - minXA;
  logoAHeight = maxYA - minYA;

  let minXB = Infinity, maxXB = -Infinity, minYB = Infinity, maxYB = -Infinity;
  for (let i = 0; i < pointsB.length; i++) {
    const x = pointsB[i].x;
    const y = pointsB[i].y;
    if (x < minXB) minXB = x;
    if (x > maxXB) maxXB = x;
    if (y < minYB) minYB = y;
    if (y > maxYB) maxYB = y;
  }
  logoBWidth = maxXB - minXB;
  logoBHeight = maxYB - minYB;

  mascotGroup    = new THREE.Group();
  const count    = pointsA.length;

  const positions       = new Float32Array(count * 3);
  const targetPositions = new Float32Array(count * 3);
  const randoms         = new Float32Array(count * 3);
  const thresholds      = new Float32Array(count);
  const morphDelays     = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const ptA = pointsA[i];
    const ptB = pointsB[i];

    positions[i3]     = ptA.x;
    positions[i3 + 1] = ptA.y;
    positions[i3 + 2] = (Math.random() - 0.5) * 1.5;

    targetPositions[i3]     = ptB.x;
    targetPositions[i3 + 1] = ptB.y;
    targetPositions[i3 + 2] = 0.0; // Flat Z to avoid perspective smearing when shifted to the side

    randoms[i3]     = Math.random() * Math.PI * 2; // shimmer phase
    randoms[i3 + 1] = 0.3 + Math.random() * 0.9;  // shimmer speed
    randoms[i3 + 2] = 0.6 + Math.random() * 0.8;  // size multiplier

    thresholds[i]  = Math.random() * 0.80; // For initial emergence
    morphDelays[i] = Math.random();        // For organic staggered morphing
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',        new THREE.BufferAttribute(positions,       3));
  geo.setAttribute('aTargetPosition', new THREE.BufferAttribute(targetPositions, 3));
  geo.setAttribute('aRandom',         new THREE.BufferAttribute(randoms,         3));
  geo.setAttribute('aThreshold',      new THREE.BufferAttribute(thresholds,      1));
  geo.setAttribute('aMorphDelay',     new THREE.BufferAttribute(morphDelays,     1));

  const isMobile = window.innerWidth < 768;

  // --- LAYER 1: Core (tight bright white-gold) ---
  const coreTex = buildGlowTexture(64, [
    [0.0, 'rgba(255, 255, 255, 1.0)'],
    [0.2, 'rgba(255, 240, 160, 0.9)'],
    [0.5, 'rgba(255, 221,  67, 0.4)'],
    [1.0, 'rgba(0, 0, 0, 0.0)'],
  ]);
  // Reduced size and opacity to prevent 'over glowing' and keep text crisp
  const coreMat = createEmergenceShaderMaterial(coreTex, 8.0, isMobile ? 0.7 : 0.45);
  coreSystem    = new THREE.Points(geo, coreMat);
  mascotGroup.add(coreSystem);

  // --- LAYER 2: Halo (warm gold bloom) ---
  const haloTex = buildGlowTexture(128, [
    [0.0, 'rgba(255, 221,  67, 0.8)'],
    [0.3, 'rgba(220, 170,  20, 0.3)'],
    [0.7, 'rgba(150,  80,   0, 0.05)'],
    [1.0, 'rgba(0, 0, 0, 0.0)'],
  ]);
  const haloMat = createEmergenceShaderMaterial(haloTex, 20.0, isMobile ? 0.4 : 0.15);
  haloSystem    = new THREE.Points(geo, haloMat);
  mascotGroup.add(haloSystem);

  // --- LAYER 3: Aura (atmospheric outer haze) ---
  const auraTex = buildGlowTexture(128, [
    [0.0, 'rgba(255, 200,  40, 0.4)'],
    [0.4, 'rgba(200, 120,  10, 0.1)'],
    [0.8, 'rgba(100,  50,   0, 0.02)'],
    [1.0, 'rgba(0, 0, 0, 0.0)'],
  ]);
  const auraMat = createEmergenceShaderMaterial(auraTex, 40.0, isMobile ? 0.2 : 0.04);
  auraSystem    = new THREE.Points(geo, auraMat);
  mascotGroup.add(auraSystem);

  scene.add(mascotGroup);

  // Localized atmospheric gold spotlight behind logo
  const spotTex = buildGlowTexture(256, [
    [0.0, 'rgba(180, 130, 10, 0.35)'],
    [0.4, 'rgba(100,  60,  5, 0.12)'],
    [0.8, 'rgba( 30,  15,  0, 0.03)'],
    [1.0, 'rgba(0, 0, 0, 0.0)'],
  ]);
  logoSpotlight = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18),
    new THREE.MeshBasicMaterial({
      map: spotTex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    })
  );
  logoSpotlight.position.set(0, 0, -2);
  scene.add(logoSpotlight);

  // Both GSAP timelines require mascotGroup to exist — call them here
  triggerGSAPAnimations();
  triggerScrollAnimations();
}

/* ==========================================================================
   GOLD ATMOSPHERIC DUST FIELD
   ========================================================================== */
function createGoldLeafField() {
  const leafTex = buildGlowTexture(32, [
    [0.0, 'rgba(255, 221, 67, 0.8)'],
    [0.5, 'rgba(255, 180, 20, 0.2)'],
    [1.0, 'rgba(0,0,0,0.0)'],
  ]);
  const leafMat = new THREE.MeshBasicMaterial({
    map: leafTex, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });

  for (let i = 0; i < leafCount; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), leafMat);
    leaf.position.set(
      (Math.random() - 0.5) * 16,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 8
    );
    leaf.userData = {
      driftSpeed:   0.001 + Math.random() * 0.002,
      wobbleSpeed:  0.1   + Math.random() * 0.2,
      wobbleOffset: Math.random() * Math.PI * 2,
      wobbleAmp:    0.002 + Math.random() * 0.002,
    };
    scene.add(leaf);
    goldLeaves.push(leaf);
  }
}

/* ==========================================================================
   RESIZE
   ========================================================================== */
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  if (mascotGroup) {
    triggerScrollAnimations();
  }
}

/* ==========================================================================
   ANIMATION LOOP
   ========================================================================== */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

  // Push reveal, morphProgress, and time into all shader uniforms every frame
  [coreSystem, haloSystem, auraSystem].forEach(sys => {
    if (!sys) return;
    sys.material.uniforms.uTime.value          = time;
    sys.material.uniforms.uReveal.value        = revealParams.reveal;
    sys.material.uniforms.uMorphProgress.value = revealParams.morphProgress;
  });

  // Spotlight opacity from GSAP
  if (logoSpotlight) logoSpotlight.material.opacity = revealParams.spotOpacity;

  // Mascot slow atmospheric float
  if (mascotGroup) {
    mascotGroup.position.y += (Math.sin(time * 0.20) * 0.07 - mascotGroup.position.y) * 0.02;
    mascotGroup.rotation.y  = Math.sin(time * 0.10) * 0.025;
    mascotGroup.rotation.x  = Math.cos(time * 0.07) * 0.012;
  }

  // Gold dust drift upward
  goldLeaves.forEach(leaf => {
    leaf.position.y += leaf.userData.driftSpeed;
    leaf.position.x += Math.sin(time * leaf.userData.wobbleSpeed + leaf.userData.wobbleOffset) * leaf.userData.wobbleAmp;
    if (leaf.position.y > 6.0) {
      leaf.position.y = -6.0;
      leaf.position.x = (Math.random() - 0.5) * 16;
    }
  });

  // Very slow cinematic camera breathing
  camera.position.x = Math.sin(time * 0.08) * 0.15;
  camera.position.y = Math.cos(time * 0.11) * 0.15;

  renderer.render(scene, camera);
}

/* ==========================================================================
   GSAP CINEMATIC TIMELINE — 5 PHASES

   Phase 1 (0–1.5s):   Pure darkness — floating gold dust only
   Phase 2 (1.5–4.0s): Atmospheric gold light awakens behind logo
   Phase 3 (3.0–7.5s): Particles shimmer into existence (scattered, organic)
   Phase 4 (7.5–9.0s): Full bloom — logo fully visible, atmosphere peaks
   Phase 5 (8.5s+):    Camera drifts back, hero UI reveals elegantly
   ========================================================================== */
function triggerGSAPAnimations() {
  const tl      = gsap.timeline();
  const isMobile = window.innerWidth < 768;
  const endZ     = isMobile ? 22 : 15;

  tl.to(revealParams, { mistAlpha: 0.0, duration: 1.0 }, 0);
  tl.to(revealParams, { spotOpacity: 0.35, duration: 2.5, ease: 'power2.inOut' }, 1.0);
  tl.to(revealParams, { reveal: 1.0, duration: 4.0, ease: 'power3.inOut' }, 1.8);
  tl.to(revealParams, { spotOpacity: 0.9, duration: 1.5, ease: 'power2.inOut' }, 4.0);
  tl.to(camera.position, { z: endZ, duration: 3.0, ease: 'power2.inOut' }, 4.5);
  tl.to(revealParams, { spotOpacity: 0.5, duration: 2.0, ease: 'power2.out' }, 6.0);

  const ui = { y: 0, opacity: 1, filter: 'blur(0px)', autoAlpha: 1, duration: 1.4, ease: 'power3.out' };
  tl.to('.tagline',           ui,                       6.0);
  tl.to('.title-row',        { ...ui, stagger: 0.12 }, 6.2);
  tl.to('.description-block', ui,                       6.6);
  tl.to('.cta-container',     ui,                       6.9);
  tl.to('.navbar',           { ...ui, autoAlpha: 1 },  7.2);
}

/* ==========================================================================
   SCROLL ANIMATION (HERO → ABOUT)
   — Seamless cinematic transition driven by ScrollTrigger scrub
   ========================================================================== */
function triggerScrollAnimations() {
  if (scrollTimeline) {
    scrollTimeline.kill();
  }

  const width = window.innerWidth;
  const isStacked = width <= 1024;
  const aspect = window.innerWidth / window.innerHeight;
  const fovRad = (45 * Math.PI) / 360;

  // Camera z-distance during About section sequence (22 for mobile/stacked, 15 for desktop)
  const currentZ = isStacked ? 22 : 15;
  const visibleHeight = 2 * Math.tan(fovRad) * currentZ;
  const visibleWidth = visibleHeight * aspect;

  // Dynamically calculate scales and positions to fit the screen aspect ratio beautifully
  // Hero logo scale (centered, fits within 82% of screen width)
  const heroScale = isStacked ? Math.min((visibleWidth * 0.82) / logoAWidth, 1.0) : 1.0;
  
  // About logo scale (centered on stacked viewports, fits within 82% of screen width)
  const targetScale = isStacked ? Math.min((visibleWidth * 0.82) / logoBWidth, 1.0) : 1.0;

  const targetX = isStacked ? 0.0 : 4.8;   // Always centered horizontally on mobile/tablet
  const targetY = isStacked ? (width < 580 ? 2.3 : 2.5) : 0.0; // Sits above the About Us text block

  // Set the initial scale immediately so the Hero logo is sized correctly on load / resize
  if (mascotGroup) {
    gsap.set(mascotGroup.scale, { x: heroScale, y: heroScale, z: heroScale });
  }

  // The main scroll timeline
  scrollTimeline = gsap.timeline({
    scrollTrigger: {
      trigger: '.about-section',
      start: 'top 85%',   // Begin as About section enters viewport
      end:   'top 15%',   // Complete when it's near top
      scrub: isStacked ? 0.5 : 2.0, // Removing mobile lag while retaining luxury feel on desktop
    }
  });

  const tl = scrollTimeline;

  // 1. Hero typography slowly dissolves and drifts upward
  tl.to(['.tagline', '.description-block', '.cta-container'], {
    y: -80,
    opacity: 0,
    duration: 1.0,
    stagger: 0.06,
    ease: 'power2.inOut'
  }, 0);

  tl.to('.title-row', {
    y: -60,
    opacity: 0,
    duration: 0.9,
    stagger: 0.04,
    ease: 'power2.inOut'
  }, 0.05);

  // 2. Particles morph from hero logo → full AURANG about logo
  tl.to(revealParams, {
    morphProgress: 1.0,
    duration: 1.8,
    ease: 'power1.inOut'
  }, 0.15);

  // 3. Particle group shifts position
  tl.to(mascotGroup.position, {
    x: targetX,
    y: targetY,
    duration: 1.6, // Shorter duration to lock position faster
    ease: 'power2.out' // Snappier convergence
  }, 0.15);

  // 4. Particle group scales appropriately
  tl.fromTo(mascotGroup.scale, 
    { x: heroScale, y: heroScale, z: heroScale },
    {
      x: targetScale,
      y: targetScale,
      z: targetScale,
      duration: 1.6,
      ease: 'power2.out'
    }, 
    0.15
  );

  // 5. About content blurs in from below ONCE particles have formed the logo
  tl.to('.about-content', {
    y: 0,
    opacity: 1,
    duration: 1.2,
    ease: 'power3.out'
  }, 0.75);
}

/* ==========================================================================
   MENU TOGGLE
   ========================================================================== */
function initMenuToggle() {
  menuBtn.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') === 'true';
    menuBtn.setAttribute('aria-expanded', !open);
    menuBtn.classList.toggle('active');
    menuOverlay.classList.toggle('active');
    if (!open) {
      document.body.style.overflow = 'hidden';
      menuOverlay.setAttribute('aria-hidden', 'false');
      gsap.fromTo('.menu-link',
        { y: 60, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.0, ease: 'power4.out', stagger: 0.1, delay: 0.3 }
      );
    } else {
      document.body.style.overflow = '';
      menuOverlay.setAttribute('aria-hidden', 'true');
    }
  });
  document.querySelectorAll('.menu-link').forEach(link => {
    link.addEventListener('click', () => {
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.classList.remove('active');
      menuOverlay.classList.remove('active');
      document.body.style.overflow = '';
      menuOverlay.setAttribute('aria-hidden', 'true');
    });
  });
}

/* ==========================================================================
   SMOOTH SCROLLING (LENIS)
   ========================================================================== */
let lenis;
function initLenis() {
  lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Apple-like buttery easing curve
    smoothWheel: true,
    smoothTouch: false, // Keep native touch scroll on mobile for raw performance
  });

  // Keep GSAP ScrollTrigger in perfect sync with Lenis
  lenis.on('scroll', ScrollTrigger.update);

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });

  gsap.ticker.lagSmoothing(0);
}

/* ==========================================================================
   BOOTSTRAP
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
  const mist = document.getElementById('mist-canvas');
  if (mist) mist.style.display = 'none';

  // Always start at top for best cinematic effect
  window.scrollTo(0, 0);

  initLenis();
  initThree();
  animate();
  initMenuToggle();
  // NOTE: triggerScrollAnimations() is called inside initParticleSystem()
  // after the async image loading completes and mascotGroup is ready.
});
