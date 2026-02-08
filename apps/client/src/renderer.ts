import * as THREE from 'three';

export class Renderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly webglRenderer: THREE.WebGLRenderer;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // sky blue
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
    document.body.appendChild(this.webglRenderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(50, 80, 30);
    this.scene.add(directional);

    // Handle resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.webglRenderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  render(): void {
    this.webglRenderer.render(this.scene, this.camera);
  }
}
