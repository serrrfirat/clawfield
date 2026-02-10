import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GodRaysPass } from './shaders/god-rays';

export class Renderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly webglRenderer: THREE.WebGLRenderer;
  readonly sunLight: THREE.DirectionalLight;
  private composer: EffectComposer;
  private fxaaPass: ShaderPass;
  private ssaoPass: SSAOPass;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = null; // Sky shader mesh handles the sky
    // Fog is handled by custom height+distance shader in world-renderer.ts
    // (no scene.fog — our shader replaces #include <fog_fragment>)

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      400
    );
    this.camera.position.set(0, 5, 0);

    // Camera must be added to scene so that children (e.g. viewmodel) render
    this.scene.add(this.camera);

    this.webglRenderer = new THREE.WebGLRenderer({ antialias: false });
    this.webglRenderer.setSize(window.innerWidth, window.innerHeight);
    this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Tone mapping for richer colors and natural falloff
    this.webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.webglRenderer.toneMappingExposure = 0.75;

    // Shadow mapping
    this.webglRenderer.shadowMap.enabled = true;
    this.webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.body.appendChild(this.webglRenderer.domElement);

    // --- Lighting ---

    // Hemisphere light: sky blue from above, warm earth tone from below
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x5c4033, 0.5);
    this.scene.add(hemi);

    // Warm directional sun
    this.sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
    this.sunLight.position.set(60, 100, 40);
    this.sunLight.castShadow = true;

    // Shadow frustum — covers 120x120 unit area around target
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 300;
    this.sunLight.shadow.camera.left = -60;
    this.sunLight.shadow.camera.right = 60;
    this.sunLight.shadow.camera.top = 60;
    this.sunLight.shadow.camera.bottom = -60;
    this.sunLight.shadow.bias = -0.001;
    this.sunLight.shadow.normalBias = 0.3;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Subtle cool fill light from the opposite side to soften shadows
    const fill = new THREE.DirectionalLight(0xb0d0e8, 0.3);
    fill.position.set(-40, 30, -50);
    this.scene.add(fill);

    // --- Post-processing pipeline ---

    const w = window.innerWidth;
    const h = window.innerHeight;
    const pixelRatio = this.webglRenderer.getPixelRatio();

    this.composer = new EffectComposer(this.webglRenderer);

    // 1. Render the scene
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // 2. SSAO — darkens crevices between voxels
    this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
    this.ssaoPass.kernelRadius = 4;
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.08;
    this.ssaoPass.output = SSAOPass.OUTPUT.Default;
    this.composer.addPass(this.ssaoPass);

    // 3. God rays — volumetric light scattering from the sun
    const godRaysPass = new GodRaysPass(this.camera, this.sunLight.position);
    this.composer.addPass(godRaysPass);

    // 4. Bloom — muzzle flash, explosions, bright sky glow
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.15, // strength  — subtle, only for muzzle flash / explosions
      0.3,  // radius    — tight focus
      0.95  // threshold — very high, sky won't trigger this
    );
    this.composer.addPass(bloomPass);

    // 5. FXAA — anti-aliasing to smooth voxel edges
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.uniforms['resolution'].value.set(
      1 / (w * pixelRatio),
      1 / (h * pixelRatio)
    );
    this.composer.addPass(this.fxaaPass);

    // 6. Output pass — handles tone mapping and color space conversion
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    // Handle resize
    window.addEventListener('resize', () => {
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      const pr = this.webglRenderer.getPixelRatio();

      this.camera.aspect = newW / newH;
      this.camera.updateProjectionMatrix();
      this.webglRenderer.setSize(newW, newH);
      this.composer.setSize(newW, newH);

      // Update FXAA resolution uniform
      this.fxaaPass.uniforms['resolution'].value.set(
        1 / (newW * pr),
        1 / (newH * pr)
      );

      // Update SSAO resolution
      this.ssaoPass.setSize(newW, newH);
    });
  }

  /** Move the shadow camera to follow the player so shadows stay crisp nearby */
  updateSunTarget(playerPos: { x: number; y: number; z: number }): void {
    this.sunLight.target.position.set(playerPos.x, 0, playerPos.z);
    this.sunLight.position.set(playerPos.x + 60, 100, playerPos.z + 40);
  }

  render(): void {
    this.composer.render();
  }
}
