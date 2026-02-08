import * as THREE from 'three';

export class Renderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly webglRenderer: THREE.WebGLRenderer;
  readonly sunLight: THREE.DirectionalLight;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7ec8e3); // slightly desaturated sky
    this.scene.fog = new THREE.Fog(0xa9c2d0, 120, 320); // soft coastal haze for Shoreline

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
    this.webglRenderer.toneMappingExposure = 1.1;

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

    // Handle resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.webglRenderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /** Move the shadow camera to follow the player so shadows stay crisp nearby */
  updateSunTarget(playerPos: { x: number; y: number; z: number }): void {
    this.sunLight.target.position.set(playerPos.x, 0, playerPos.z);
    this.sunLight.position.set(playerPos.x + 60, 100, playerPos.z + 40);
  }

  render(): void {
    this.webglRenderer.render(this.scene, this.camera);
  }
}
