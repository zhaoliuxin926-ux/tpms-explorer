/**
 * 交互式三维游标卡尺
 * 用户在 TPMS 曲面上点击两点，实时计算并显示空间距离。
 */

import * as THREE from 'three';

const MARKER_COLOR = 0xff3366;
const LINE_COLOR = 0xff3366;
// 坐标缩放因子，必须与 main.ts 中 meshFill / meshStrut 的 scale（0.33）保持一致
const MESH_SCALE = 0.33;

export class CaliperTool {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private targetMesh: THREE.Mesh | null;
  private points: THREE.Vector3[] = [];
  private markers: THREE.Mesh[] = [];
  private line: THREE.Line | null = null;
  private label: THREE.Sprite | null = null;
  private raycaster = new THREE.Raycaster();
  private onClickBound: (e: MouseEvent) => void;

  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    scene: THREE.Scene,
    targetMesh: THREE.Mesh | null,
  ) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.targetMesh = targetMesh;
    this.onClickBound = this.onClick.bind(this);
  }

  enable(): void {
    this.renderer.domElement.style.cursor = 'crosshair';
    this.renderer.domElement.addEventListener('click', this.onClickBound);
  }

  disable(): void {
    this.renderer.domElement.style.cursor = '';
    this.renderer.domElement.removeEventListener('click', this.onClickBound);
  }

  private onClick(e: MouseEvent): void {
    if (!this.targetMesh) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    const hits = this.raycaster.intersectObject(this.targetMesh, false);
    if (hits.length === 0) return;
    this.addPoint(hits[0].point.clone());
  }

  private addPoint(p: THREE.Vector3): void {
    if (this.points.length >= 2) this.clearPoints();
    this.points.push(p);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 16, 16),
      new THREE.MeshBasicMaterial({ color: MARKER_COLOR, depthTest: false }),
    );
    marker.position.copy(p);
    marker.renderOrder = 1001;
    this.scene.add(marker);
    this.markers.push(marker);

    if (this.points.length === 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(this.points);
      this.line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: LINE_COLOR, depthTest: false }),
      );
      this.line.renderOrder = 1001;
      this.scene.add(this.line);

      const dist = this.points[0].distanceTo(this.points[1]);
      const mid = new THREE.Vector3()
        .addVectors(this.points[0], this.points[1])
        .multiplyScalar(0.5);
      this.label = this.createLabel(`${(dist / MESH_SCALE).toFixed(3)} mm`, mid);
      this.label.renderOrder = 1002;
      this.scene.add(this.label);
    }
  }

  private createLabel(text: string, pos: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#ff3366';
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 44);

    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
    );
    sprite.scale.set(0.6, 0.15, 1);
    sprite.position.copy(pos);
    return sprite;
  }

  clearPoints(): void {
    for (const m of this.markers) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.markers = [];
    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
      this.line = null;
    }
    if (this.label) {
      this.scene.remove(this.label);
      (this.label.material as THREE.SpriteMaterial).map?.dispose();
      (this.label.material as THREE.Material).dispose();
      this.label = null;
    }
    this.points = [];
  }

  dispose(): void {
    this.disable();
    this.clearPoints();
  }
}
