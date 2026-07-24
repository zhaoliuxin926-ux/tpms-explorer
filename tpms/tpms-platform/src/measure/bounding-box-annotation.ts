/**
 * 3D Bounding Box 尺寸标注系统
 * 在场景中实时绘制当前 TPMS 结构的长宽高标注线与数值标签。
 */

import * as THREE from 'three';

const LABEL_COLOR = '#00ff88';
const LINE_COLOR = 0x00ff88;
const SCALE = 0.33; // 与主线程 mesh scale 一致

export class BoundingBoxAnnotation {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private line: THREE.LineSegments | null = null;
  private labels: THREE.Sprite[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
  }

  /** 根据几何体更新标注（geometry 应为原始未缩放空间） */
  update(geometry: THREE.BufferGeometry): void {
    this.clear();
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;

    const min = box.min.clone().multiplyScalar(SCALE);
    const max = box.max.clone().multiplyScalar(SCALE);
    const size = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

    // 12 条边线
    const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const edges = new THREE.EdgesGeometry(boxGeo);
    this.line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: LINE_COLOR,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.line.position.copy(center);
    this.line.renderOrder = 999;
    this.group.add(this.line);

    // 三轴尺寸标签（原始 mm 值 = world size / SCALE）
    const xmm = size.x / SCALE;
    const ymm = size.y / SCALE;
    const zmm = size.z / SCALE;
    this.addLabel(`${xmm.toFixed(1)} mm`, new THREE.Vector3(center.x, min.y - 0.12, min.z));
    this.addLabel(`${ymm.toFixed(1)} mm`, new THREE.Vector3(max.x + 0.12, center.y, min.z));
    this.addLabel(`${zmm.toFixed(1)} mm`, new THREE.Vector3(min.x - 0.12, min.y - 0.12, center.z));
  }

  private addLabel(text: string, position: THREE.Vector3): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 44);

    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        transparent: true,
      }),
    );
    sprite.scale.set(0.8, 0.2, 1);
    sprite.position.copy(position);
    sprite.renderOrder = 1000;
    this.group.add(sprite);
    this.labels.push(sprite);
  }

  clear(): void {
    if (this.line) {
      this.group.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
      this.line = null;
    }
    for (const label of this.labels) {
      this.group.remove(label);
      label.material.map?.dispose();
      (label.material as THREE.Material).dispose();
    }
    this.labels = [];
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }
}
