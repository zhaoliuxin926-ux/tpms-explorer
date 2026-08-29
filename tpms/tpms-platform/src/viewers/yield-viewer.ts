/**
 * 三维屈服面包络预览窗（v7.0 Stage II）
 *
 * 轻量 Three.js 视口：惰性创建 WebGL 渲染器（首次点击才实例化，不占启动 WebGL 上下文），
 * 自动慢旋转 + 指针拖拽交互；包络面半透明 + 当前工作应力状态点标记。
 * dispose() 释放几何/材质/渲染器（run_all UI 回归含创建→销毁→再创建稳定性断言）。
 */

import * as THREE from 'three';

export interface YieldViewer {
  /** 更新包络面网格与应力状态点（主应力空间坐标，MPa） */
  update(positions: Float32Array, indices: Uint32Array, stressPoint: [number, number, number] | null): void;
  dispose(): void;
  /** 是否已销毁（重复 dispose 幂等） */
  readonly disposed: boolean;
}

export function createYieldViewer(canvas: HTMLCanvasElement): YieldViewer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6);
  camera.position.set(1.4, 1.0, 1.6);

  const lights = new THREE.Group();
  lights.add(new THREE.AmbientLight(0xffffff, 1.6));
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.set(1, 1.6, 0.8);
  lights.add(dir);
  scene.add(lights);

  const pivot = new THREE.Group();   // 拖拽/自转载体
  scene.add(pivot);

  // 主应力轴（三轴细线 + 端点）
  const axisMat = new THREE.LineBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.55 });
  const axisGeo = new THREE.BufferGeometry();
  const L = 1.35;
  axisGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -L, 0, 0, L, 0, 0,
    0, -L, 0, 0, L, 0,
    0, 0, -L, 0, 0, L,
  ], 3));
  pivot.add(new THREE.LineSegments(axisGeo, axisMat));

  let envelopeMesh: THREE.Mesh | null = null;
  let markerMesh: THREE.Mesh | null = null;
  let rafId = 0;
  let disposed = false;

  // 指针拖拽（球面轨道简化版）
  let dragging = false;
  let lastX = 0, lastY = 0;
  let velX = 0.006, velY = 0;
  const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    velY = (e.clientX - lastX) * 0.008;
    velX = (e.clientY - lastY) * 0.008;
    pivot.rotation.y += velY;
    pivot.rotation.x += velX;
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = () => { dragging = false; };
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  const tick = () => {
    if (disposed) return;
    if (!dragging) {
      pivot.rotation.y += velX;   // 缺省慢自转（拖拽后沿用最后速度衰减）
      velX *= 0.995;
      if (velX < 0.002) velX = 0.002;
    }
    const w = canvas.clientWidth || 280;
    const h = canvas.clientHeight || 220;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return {
    update(positions, indices, stressPoint) {
      if (disposed) return;
      if (envelopeMesh) {
        pivot.remove(envelopeMesh);
        envelopeMesh.geometry.dispose();
        (envelopeMesh.material as THREE.Material).dispose();
        envelopeMesh = null;
      }
      if (markerMesh) {
        pivot.remove(markerMesh);
        markerMesh.geometry.dispose();
        (markerMesh.material as THREE.Material).dispose();
        markerMesh = null;
      }
      // 归一化尺度（包络最大半径 → 1.1）
      let maxR = 0;
      for (let i = 0; i < positions.length; i += 3) {
        const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
        if (r > maxR) maxR = r;
      }
      const scale = maxR > 0 ? 1.1 / maxR : 1;
      const geo = new THREE.BufferGeometry();
      const scaled = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i++) scaled[i] = positions[i] * scale;
      geo.setAttribute('position', new THREE.BufferAttribute(scaled, 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x4a9eff, metalness: 0.15, roughness: 0.45,
        transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false,
      });
      envelopeMesh = new THREE.Mesh(geo, mat);
      pivot.add(envelopeMesh);
      if (stressPoint) {
        const mg = new THREE.SphereGeometry(0.045, 16, 12);
        const mm = new THREE.MeshBasicMaterial({ color: 0xff5544 });
        markerMesh = new THREE.Mesh(mg, mm);
        // 应力点与包络同尺度归一
        markerMesh.position.set(stressPoint[0] * scale, stressPoint[1] * scale, stressPoint[2] * scale);
        pivot.add(markerMesh);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (envelopeMesh) { envelopeMesh.geometry.dispose(); (envelopeMesh.material as THREE.Material).dispose(); }
      if (markerMesh) { markerMesh.geometry.dispose(); (markerMesh.material as THREE.Material).dispose(); }
      axisGeo.dispose();
      axisMat.dispose();
      renderer.dispose();
    },
    get disposed() { return disposed; },
  };
}
