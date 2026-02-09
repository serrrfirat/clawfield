import * as THREE from 'three';

const ORBIT_SPEED = 0.005;
const PAN_SPEED = 0.5;
const ZOOM_SPEED = 2;
const FLY_SPEED = 40;
const MIN_DIST = 5;
const MAX_DIST = 500;

export class EditorCamera {
  readonly camera: THREE.PerspectiveCamera;

  // Orbit state
  private target = new THREE.Vector3(0, 0, 0);
  private spherical = new THREE.Spherical(80, Math.PI / 4, Math.PI / 4);

  // Input state
  private keys = new Set<string>();
  private isRightDown = false;
  private isMiddleDown = false;
  private lastMouse = { x: 0, y: 0 };

  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.5,
      600
    );
    this.updateCameraFromSpherical();

    // Mouse events on container
    container.addEventListener('mousedown', this.onMouseDown);
    container.addEventListener('mousemove', this.onMouseMove);
    container.addEventListener('mouseup', this.onMouseUp);
    container.addEventListener('wheel', this.onWheel, { passive: false });
    container.addEventListener('contextmenu', (e) => e.preventDefault());

    // Key events on window
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Resize
    window.addEventListener('resize', this.onResize);
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 2) this.isRightDown = true;
    if (e.button === 1) this.isMiddleDown = true;
    this.lastMouse.x = e.clientX;
    this.lastMouse.y = e.clientY;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.isRightDown = false;
    if (e.button === 1) this.isMiddleDown = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.lastMouse.x = e.clientX;
    this.lastMouse.y = e.clientY;

    if (this.isRightDown) {
      // Orbit
      this.spherical.theta -= dx * ORBIT_SPEED;
      this.spherical.phi -= dy * ORBIT_SPEED;
      this.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.spherical.phi));
      this.updateCameraFromSpherical();
    }

    if (this.isMiddleDown) {
      // Pan
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      this.camera.getWorldDirection(new THREE.Vector3());
      right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      up.setFromMatrixColumn(this.camera.matrixWorld, 1);

      const panScale = this.spherical.radius * PAN_SPEED * 0.002;
      this.target.addScaledVector(right, -dx * panScale);
      this.target.addScaledVector(up, dy * panScale);
      this.updateCameraFromSpherical();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 1.1 : 0.9;
    this.spherical.radius = Math.max(MIN_DIST, Math.min(MAX_DIST, this.spherical.radius * zoomDelta));
    this.updateCameraFromSpherical();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // Don't capture when typing in inputs
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    this.keys.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w > 0 && h > 0) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  };

  private updateCameraFromSpherical(): void {
    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  update(dt: number): void {
    if (!this.isRightDown) return;

    // WASD fly when right-mouse held
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, this.camera.up).normalize();

    const speed = FLY_SPEED * dt;
    const move = new THREE.Vector3();

    if (this.keys.has('w')) move.add(forward);
    if (this.keys.has('s')) move.sub(forward);
    if (this.keys.has('d')) move.add(right);
    if (this.keys.has('a')) move.sub(right);
    if (this.keys.has(' ')) move.y += 1;
    if (this.keys.has('shift')) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      this.target.add(move);
      this.updateCameraFromSpherical();
    }
  }

  focusOn(position: THREE.Vector3): void {
    this.target.copy(position);
    this.spherical.radius = 30;
    this.updateCameraFromSpherical();
  }

  dispose(): void {
    this.container.removeEventListener('mousedown', this.onMouseDown);
    this.container.removeEventListener('mousemove', this.onMouseMove);
    this.container.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
  }
}
