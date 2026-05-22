import './style.css';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

gsap.registerPlugin(ScrollTrigger);

let lenis;

let scene, camera, renderer, pmremGenerator;
let emblemGroup, loadedModel, emblemMaterial;
let gridGroup;

// Smooth scroll-driven state for the 3D emblem
const emblemScrollState = {
  y: 0,
  opacity: 1.0,
  roughness: 0.18,
  metalness: 1.0
};

const canvasEl = document.getElementById('webgl-canvas');
const menuBtn = document.getElementById('menu-btn');
const menuOverlay = document.getElementById('menu-overlay');

// Reveal parameters
const revealParams = { reveal: 0 };

// Layout responsive variables
let baseScale = 1.0;
let baseX = 3.0;
let baseY = 0.0;
let cameraZ = 13;

function updateResponsiveLayout() {
  const width = window.innerWidth;
  const isMobile = width < 768;
  const isTablet = width >= 768 && width <= 1024;
  
  if (isMobile) {
    baseScale = 0.65;
    baseX = 0.0;
    baseY = 2.2;
    cameraZ = 20;
  } else if (isTablet) {
    baseScale = 0.75;
    baseX = 0.0;
    baseY = 2.4;
    cameraZ = 16;
  } else {
    baseScale = 1.0;
    baseX = 3.0;
    baseY = 0.0;
    cameraZ = 13;
  }
  
  if (camera) {
    camera.position.z = cameraZ;
  }
  
  if (emblemGroup) {
    emblemGroup.position.x = baseX;
    // Set scale to baseScale if GSAP has completed or initialized
    if (revealParams.reveal > 0.9) {
      emblemGroup.scale.set(baseScale, baseScale, baseScale);
    }
  }
}

function initThree() {
  scene = new THREE.Scene();
  // Deep cinematic charcoal fog to match body background #08080a
  scene.fog = new THREE.FogExp2(0x08080a, 0.015);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, cameraZ);

  renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Environment Map for premium gold reflections
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const environment = new RoomEnvironment();
  scene.environment = pmremGenerator.fromScene(environment).texture;
  environment.dispose();

  // Load the 3D Emblem from GLB
  loadEmblem();

  // Create Nothing-inspired luxury grid network
  createLuxuryGridNetwork();

  // Spotlights
  setupLighting();

  window.addEventListener('resize', onWindowResize);
}

function loadEmblem() {
  emblemGroup = new THREE.Group();
  scene.add(emblemGroup);

  emblemMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdfb050, // Warm luxury gold
    metalness: 1.0,
    roughness: 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    envMapIntensity: 2.0,
    transparent: true,
    opacity: 1.0,
  });

  const loader = new GLTFLoader();
  loader.load('./golden mountain logo 3d.glb', (gltf) => {
    loadedModel = gltf.scene;

    // Center the model
    const box = new THREE.Box3().setFromObject(loadedModel);
    const center = box.getCenter(new THREE.Vector3());
    loadedModel.position.x = -center.x;
    loadedModel.position.y = -center.y;
    loadedModel.position.z = -center.z;
    
    // Scale it to fit beautifully (target visual size ~ 6 units)
    const size = box.getSize(new THREE.Vector3()).length();
    const targetScale = 6.0 / (size || 1); 
    
    // Increase the X-axis scale to make the logo physically thicker/deeper (since its axes are swapped)
    const thicknessMultiplier = 10.0; 
    loadedModel.scale.set(targetScale * thicknessMultiplier, targetScale, targetScale);

    // Apply the luxury material to all meshes inside the GLB
    loadedModel.traverse((child) => {
      if (child.isMesh) {
        child.material = emblemMaterial;
      }
    });

    emblemGroup.add(loadedModel);
    
    // Start hidden, will be revealed by GSAP
    emblemGroup.scale.set(0, 0, 0);
    
    // Apply layout positions
    updateResponsiveLayout();
  });
}

function buildGlowTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  stops.forEach(([pos, col]) => grad.addColorStop(pos, col));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function createLuxuryGridNetwork() {
  gridGroup = new THREE.Group();
  scene.add(gridGroup);

  // Muted champagne gold tone
  const color = new THREE.Color(0xdcb570); 

  // Create a soft glowing dot texture
  const dotTex = buildGlowTexture(64, [
    [0.0, 'rgba(255, 255, 255, 1.0)'],
    [0.2, 'rgba(235, 210, 160, 0.8)'],
    [0.5, 'rgba(215, 185, 120, 0.1)'],
    [1.0, 'rgba(0, 0, 0, 0.0)'],
  ]);

  const pointMat = new THREE.PointsMaterial({
    size: 0.18,
    map: dotTex,
    transparent: true,
    opacity: 0, // GSAP will reveal this
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: color
  });

  const lineMat = new THREE.LineBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0, // GSAP will reveal
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Multi-layer depth (3 layers)
  const layers = [
    { z: -6, spacing: 2.0, size: 30, opacityMulti: 0.75 },
    { z: -16, spacing: 3.5, size: 45, opacityMulti: 0.4 },
    { z: -32, spacing: 5.0, size: 60, opacityMulti: 0.15 }
  ];

  layers.forEach((layer) => {
    const points = [];
    const layerGroup = new THREE.Group();
    
    // Create points
    const cols = Math.floor(layer.size / layer.spacing);
    const rows = Math.floor(layer.size / layer.spacing);
    const offsetX = (cols * layer.spacing) / 2;
    const offsetY = (rows * layer.spacing) / 2;

    // Use a mathematical grid with extremely minimal organic jitter
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const rx = (Math.random() - 0.5) * (layer.spacing * 0.1);
        const ry = (Math.random() - 0.5) * (layer.spacing * 0.1);
        const x = (i * layer.spacing) - offsetX + rx;
        const y = (j * layer.spacing) - offsetY + ry;
        points.push(new THREE.Vector3(x, y, layer.z));
      }
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    
    // Clone materials to control opacity independently per layer
    const lPointMat = pointMat.clone();
    lPointMat.userData = { maxOpacity: layer.opacityMulti };
    const pMesh = new THREE.Points(geometry, lPointMat);
    layerGroup.add(pMesh);

    // Create sparse, elegant connecting lines
    const lineIndices = [];
    for (let i = 0; i < points.length; i++) {
      // Connect to a few nearby points
      for (let j = i + 1; j < points.length; j++) {
        const dist = points[i].distanceTo(points[j]);
        if (dist < layer.spacing * 1.6 && Math.random() > 0.65) {
          lineIndices.push(i, j);
        }
      }
    }
    
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    lineGeo.setIndex(lineIndices);
    
    const lLineMat = lineMat.clone();
    lLineMat.userData = { maxOpacity: layer.opacityMulti * 0.22 }; // Lines much softer than points
    const lMesh = new THREE.LineSegments(lineGeo, lLineMat);
    layerGroup.add(lMesh);
    
    // Store for animation drift
    layerGroup.userData = {
      z: layer.z,
      speedX: (Math.random() - 0.5) * 0.0008,
      speedY: (Math.random() - 0.5) * 0.0008,
      pointMat: lPointMat,
      lineMat: lLineMat
    };

    gridGroup.add(layerGroup);
  });
}

function setupLighting() {
  // Cinematic Rim Light
  const rimLight = new THREE.DirectionalLight(0xffeedd, 3.0);
  rimLight.position.set(5, 5, -5);
  scene.add(rimLight);

  // Soft Fill Light
  const fillLight = new THREE.DirectionalLight(0xd4af37, 1.0);
  fillLight.position.set(-5, 0, 5);
  scene.add(fillLight);

  // Ambient backing
  const ambientLight = new THREE.AmbientLight(0x221100, 1.0);
  scene.add(ambientLight);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  updateResponsiveLayout();
}

const clock = new THREE.Clock();
let mouseX = 0;
let mouseY = 0;
let targetMouseX = 0;
let targetMouseY = 0;

document.addEventListener('mousemove', (e) => {
  targetMouseX = (e.clientX / window.innerWidth) * 2 - 1;
  targetMouseY = -(e.clientY / window.innerHeight) * 2 + 1;
});

function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

  mouseX += (targetMouseX - mouseX) * 0.02;
  mouseY += (targetMouseY - mouseY) * 0.02;

  // Cinematic Parallax
  camera.position.x = mouseX * 0.5 + Math.sin(time * 0.1) * 0.1;
  camera.position.y = mouseY * 0.5 + Math.cos(time * 0.1) * 0.1;
  camera.lookAt(0, 0, 0);

  // Floating & Breathing Emblem (incorporating scroll movement and material updates)
  if (emblemGroup) {
    emblemGroup.position.x = baseX;
    emblemGroup.position.y = baseY + emblemScrollState.y + Math.sin(time * 0.4) * 0.2;
    if (loadedModel) {
      loadedModel.rotation.y = time * 0.15; // Slow rotation of the 3D logo
    }
    if (emblemMaterial) {
      emblemMaterial.opacity = emblemScrollState.opacity;
      emblemMaterial.roughness = emblemScrollState.roughness;
      emblemMaterial.metalness = emblemScrollState.metalness;
    }
  }

  // Luxury Grid Network Drift & Pulse
  if (typeof gridGroup !== 'undefined') {
    gridGroup.children.forEach((layer, idx) => {
      // Slow ambient drift
      layer.position.x += layer.userData.speedX;
      layer.position.y += layer.userData.speedY;

      // Soft opacity breathing
      const breath = (Math.sin(time * 0.6 + idx) * 0.1) + 0.9;
      layer.userData.pointMat.opacity = revealParams.reveal * layer.userData.pointMat.userData.maxOpacity * breath;
      layer.userData.lineMat.opacity = revealParams.reveal * layer.userData.lineMat.userData.maxOpacity * breath;
    });
  }

  renderer.render(scene, camera);
}

function triggerGSAPAnimations() {
  const tl = gsap.timeline();

  // Reveal the 3D Emblem with a smooth scale and rotation
  tl.fromTo(emblemGroup.scale, {x:0, y:0, z:0}, { x: baseScale, y: baseScale, z: baseScale, duration: 4.0, ease: 'power3.out' }, 1.0);
  tl.fromTo(emblemGroup.rotation, {y: Math.PI}, { y: 0, duration: 4.0, ease: 'power3.out' }, 1.0);

  tl.to(revealParams, { reveal: 1.0, duration: 3.0, ease: 'power2.inOut' }, 1.5);

  const ui = { y: 0, opacity: 1, filter: 'blur(0px)', autoAlpha: 1, duration: 1.4, ease: 'power3.out' };
  tl.to('.tagline', ui, 2.5);
  tl.to('.title-row', { ...ui, stagger: 0.12 }, 2.7);
  tl.to('.description-block', ui, 3.1);
  tl.to('.cta-container', ui, 3.4);
  tl.to('.navbar', { ...ui, autoAlpha: 1 }, 3.7);
}

function initMenuToggle() {
  menuBtn.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') === 'true';
    menuBtn.setAttribute('aria-expanded', !open);
    menuBtn.classList.toggle('active');
    menuOverlay.classList.toggle('active');
    if (!open) {
      if (lenis) lenis.stop();
      document.body.style.overflow = 'hidden';
      menuOverlay.setAttribute('aria-hidden', 'false');
      gsap.fromTo('.menu-link',
        { y: 60, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.0, ease: 'power4.out', stagger: 0.1, delay: 0.3 }
      );
    } else {
      if (lenis) lenis.start();
      document.body.style.overflow = ''; 
      menuOverlay.setAttribute('aria-hidden', 'true');
    }
  });
  document.querySelectorAll('.menu-link').forEach(link => {
    link.addEventListener('click', () => {
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.classList.remove('active');
      menuOverlay.classList.remove('active');
      if (lenis) lenis.start();
      document.body.style.overflow = '';
      menuOverlay.setAttribute('aria-hidden', 'true');
    });
  });
}

function initScrollAnimations() {
  // Fade and blur out hero content softly when scrolling down
  gsap.to('.hero-content', {
    y: -100,
    opacity: 0,
    filter: 'blur(15px)',
    ease: 'none',
    scrollTrigger: {
      trigger: '.hero-section',
      start: 'top top',
      end: 'bottom top',
      scrub: true
    }
  });

  // Move 3D emblem up and fade out / blur reflections in sync with scroll
  gsap.to(emblemScrollState, {
    y: 8.0, // Move up by 8 units in ThreeJS space
    opacity: 0.0,
    roughness: 1.0,
    metalness: 0.0,
    ease: 'none',
    scrollTrigger: {
      trigger: '.hero-section',
      start: 'top top',
      end: 'bottom top',
      scrub: true
    }
  });

  // Reveal About Section (Triggered cleanly on scroll, stays sharp when in view, reverses on scroll back up)
  const aboutTl = gsap.timeline({
    scrollTrigger: {
      trigger: '.about-section',
      start: 'top 75%', // Fires when the top of the about section is 25% into viewport
      toggleActions: 'play none none reverse'
    },
    onUpdate: function() {
      const progress = this.progress();
      const target = document.querySelector('.about-content');
      if (target) {
        if (progress >= 0.99) {
          target.style.filter = 'none';
        } else {
          const blurVal = (1 - progress) * 15;
          target.style.filter = `blur(${blurVal}px)`;
        }
      }
    }
  });

  aboutTl.fromTo('.about-content',
    {
      opacity: 0,
      y: 50
    },
    {
      opacity: 1,
      y: 0,
      duration: 1.2,
      ease: 'power3.out'
    },
    0
  );

  // Architectural Frame drawing lines
  aboutTl.fromTo('.line-top', { width: '0%' }, { width: '100%', ease: 'power2.inOut', duration: 0.6 }, 0.2);
  aboutTl.fromTo('.line-right', { height: '0%' }, { height: '100%', ease: 'power2.inOut', duration: 0.6 }, 0.4);
  aboutTl.fromTo('.line-bottom', { width: '0%' }, { width: '100%', ease: 'power2.inOut', duration: 0.6 }, 0.6);
  aboutTl.fromTo('.line-left', { height: '0%' }, { height: '100%', ease: 'power2.inOut', duration: 0.6 }, 0.8);
  aboutTl.fromTo('.frame-corner', { opacity: 0 }, { opacity: 1, ease: 'power1.out', duration: 0.3, stagger: 0.08 }, 1.0);
}

window.addEventListener('DOMContentLoaded', () => {
  const mist = document.getElementById('mist-canvas');
  if (mist) mist.style.display = 'none';

  window.scrollTo(0, 0);

  updateResponsiveLayout();
  initThree();
  animate();
  initMenuToggle();
  
  // Initialize Lenis
  lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => { lenis.raf(time * 1000) });
  gsap.ticker.lagSmoothing(0);

  // Trigger animations
  triggerGSAPAnimations();
  initScrollAnimations();
});
