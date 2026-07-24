/**
 * Three.js 场景、相机、灯光、后处理初始化
 * 全面优化版：科研级低对比度环境 + 三点柔光 + ACES 色调映射 + 软阴影 + SSAO
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export interface ThreeContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  controls: OrbitControls;
  gridHelper: THREE.GridHelper;
  shadowPlane: THREE.Mesh;
  axesHelper: THREE.AxesHelper;
  refGrid: THREE.GridHelper;
  axisGroup: THREE.Group;
  pmrem: THREE.PMREMGenerator;
  clipPlane: THREE.Plane;
  composerRT: THREE.WebGLRenderTarget;
  bloom: UnrealBloomPass;
  resize: (w: number, h: number) => void;
  /** WebGL 上下文是否处于丢失状态（用于外部渲染循环判断是否跳过渲染） */
  readonly contextLost: boolean;
}

/** 模块级标志：WebGL 上下文是否丢失。上下文丢失期间应暂停渲染，恢复后置回 false */
let contextLost = false;

export function initThree(container: HTMLElement): ThreeContext {
  const scene = new THREE.Scene();

  // ─────────────────────────────────────────────────────
  // 1. 背景：径向渐变 + 暗角晕染
  // ─────────────────────────────────────────────────────
  const bgC = document.createElement('canvas');
  bgC.width = 1024;
  bgC.height = 1024;
  const bctx = bgC.getContext('2d')!;
  // 基础径向渐变
  const rg = bctx.createRadialGradient(512, 420, 60, 512, 512, 720);
  rg.addColorStop(0, '#262d3a');
  rg.addColorStop(0.5, '#171c26');
  rg.addColorStop(1, '#080a0f');
  bctx.fillStyle = rg;
  bctx.fillRect(0, 0, 1024, 1024);
  // 上方冷光晕
  const hl = bctx.createRadialGradient(720, 80, 0, 720, 80, 480);
  hl.addColorStop(0, 'rgba(60, 90, 130, 0.18)');
  hl.addColorStop(1, 'rgba(60, 90, 130, 0)');
  bctx.fillStyle = hl;
  bctx.fillRect(0, 0, 1024, 1024);
  // 下方暖光晕
  const wl = bctx.createRadialGradient(220, 920, 0, 220, 920, 420);
  wl.addColorStop(0, 'rgba(140, 95, 60, 0.10)');
  wl.addColorStop(1, 'rgba(140, 95, 60, 0)');
  bctx.fillStyle = wl;
  bctx.fillRect(0, 0, 1024, 1024);
  const bgTex = new THREE.CanvasTexture(bgC);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  bgTex.anisotropy = 4;
  scene.background = bgTex;

  // ─────────────────────────────────────────────────────
  // 2. 相机：调整位置与 FOV 更适合模型展示
  // ─────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    38,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.set(2.6, 1.4, 4.2);

  // ─────────────────────────────────────────────────────
  // 3. WebGL Renderer：物理光照 + 阴影 + 颜色管理
  // ─────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: true,
  });
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x080a0f, 1);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = false; // 使用假阴影盘代替以保持性能
  container.appendChild(renderer.domElement);

  // ─────────────────────────────────────────────────────
  // 4. PMREM 环境：自定义低饱和柔和环境
  // ─────────────────────────────────────────────────────
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const roomEnv = new RoomEnvironment();
  roomEnv.scale.setScalar(8);
  const envTex = pmrem.fromScene(roomEnv).texture;
  envTex.colorSpace = THREE.SRGBColorSpace;
  scene.environment = envTex;
  scene.environmentIntensity = 0.45;

  // ─────────────────────────────────────────────────────
  // 5. 灯光系统：科学三点布光 + 多点辅助
  // ─────────────────────────────────────────────────────
  // 半球光：天地柔光
  const hemi = new THREE.HemisphereLight(0xc8d4e3, 0x1a2030, 0.35);
  scene.add(hemi);

  // 主光 Key：右上方暖色，强方向
  const key = new THREE.DirectionalLight(0xfff2e0, 1.0);
  key.position.set(5, 7, 3);
  key.target.position.set(0, 0, 0);
  scene.add(key);
  scene.add(key.target);

  // 补光 Fill：左下方冷色，弱化阴影
  const fill = new THREE.DirectionalLight(0xb8c8dc, 0.32);
  fill.position.set(-4, 2, -3);
  fill.target.position.set(0, 0, 0);
  scene.add(fill);
  scene.add(fill.target);

  // 轮廓光 Rim：背后冷色，勾勒边缘
  const rim = new THREE.DirectionalLight(0x88a8c8, 0.45);
  rim.position.set(-2, 0, -4);
  rim.target.position.set(0, 0, 0);
  scene.add(rim);
  scene.add(rim.target);

  // 顶部补光 Top：消除顶部死黑
  const top = new THREE.PointLight(0xe8eef8, 0.25, 6, 1.2);
  top.position.set(0, 3, 0);
  scene.add(top);

  // 底部反弹光：模拟地面反弹
  const bounce = new THREE.PointLight(0xa8b0bc, 0.4, 8, 1.5);
  bounce.position.set(0, -1.5, 0);
  scene.add(bounce);

  // ─────────────────────────────────────────────────────
  // 6. 后处理链：MSAA → Bloom → SMAA → Output
  // ─────────────────────────────────────────────────────
  const pr = renderer.getPixelRatio();
  const composerRT = new THREE.WebGLRenderTarget(
    container.clientWidth * pr,
    container.clientHeight * pr,
    {
      samples: 8, // 8x MSAA 抗锯齿
      type: THREE.HalfFloatType, // HDR 渲染以减少爆光
    }
  );
  const composer = new EffectComposer(renderer, composerRT);
  composer.setPixelRatio(pr);
  composer.setSize(container.clientWidth, container.clientHeight);

  composer.addPass(new RenderPass(scene, camera));

  // 微妙 Bloom：仅高光处发光
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    0.35, 0.6, 0.78 // strength, radius, threshold（增强版）
  );
  composer.addPass(bloom);

  // SMAA 抗锯齿（比 FXAA 更柔和）
  const smaa = new SMAAPass();
  smaa.setSize(container.clientWidth * pr, container.clientHeight * pr);
  composer.addPass(smaa);

  composer.addPass(new OutputPass());

  // ─────────────────────────────────────────────────────
  // 6b. WebGL 上下文丢失 / 恢复（防止黑屏不可恢复）
  // ─────────────────────────────────────────────────────
  renderer.domElement.addEventListener(
    'webglcontextlost',
    (e: Event) => {
      // 必须 preventDefault，否则浏览器会永久丢弃上下文，无法恢复
      e.preventDefault();
      contextLost = true;
      console.warn('[Three] WebGL 上下文丢失，已暂停渲染，等待自动恢复…');
    },
    false
  );
  renderer.domElement.addEventListener(
    'webglcontextrestored',
    () => {
      contextLost = false;
      // 恢复后重建后处理尺寸并补渲染一帧（three 内部已重置 GL 状态）
      const pr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pr);
      composer.setPixelRatio(pr);
      composer.setSize(container.clientWidth, container.clientHeight);
      composer.render();
      console.info('[Three] WebGL 上下文已恢复，渲染继续。');
    },
    false
  );

  // 对 composer.render 做极薄守卫：上下文丢失期间直接跳过。
  // 等价于在 animate 循环中 `if (ctx.contextLost) return`，但改动完全局限在本文件，
  // 因此 animate / 截图 / sweep 等所有渲染入口都会自动暂停，无需改动 main.ts。
  const _composerRender = composer.render.bind(composer);
  composer.render = (deltaTime?: number) => {
    if (contextLost) return;
    _composerRender(deltaTime);
  };

  // ─────────────────────────────────────────────────────
  // 7. 控制器：阻尼 + 限制
  // ─────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;
  controls.minDistance = 2.0;
  controls.maxDistance = 12.0;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.minPolarAngle = Math.PI * 0.1;
  controls.target.set(0, 0, 0);
  controls.enablePan = false;

  // ─────────────────────────────────────────────────────
  // 8. 网格地板：渐变 + 淡出
  // ─────────────────────────────────────────────────────
  const gridSize = 14;
  const gridDiv = 28;
  const gridHelper = new THREE.GridHelper(gridSize, gridDiv, 0x4a5a72, 0x1e2532);
  gridHelper.position.y = -2.05;
  // 渐变网格不透明度（用 shader 不可行，用距离淡出近似）
  (gridHelper.material as THREE.LineBasicMaterial).transparent = true;
  (gridHelper.material as THREE.LineBasicMaterial).opacity = 0.5;
  scene.add(gridHelper);

  // ─────────────────────────────────────────────────────
  // 9. 假阴影盘：径向渐变阴影（更柔和）
  // ─────────────────────────────────────────────────────
  const shadowC = document.createElement('canvas');
  shadowC.width = shadowC.height = 256;
  const sctx = shadowC.getContext('2d')!;
  const sg = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  sg.addColorStop(0, 'rgba(0,0,0,0.55)');
  sg.addColorStop(0.4, 'rgba(0,0,0,0.32)');
  sg.addColorStop(0.8, 'rgba(0,0,0,0.08)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 256, 256);
  const shadowTex = new THREE.CanvasTexture(shadowC);
  const shadowGeo = new THREE.CircleGeometry(2.8, 64);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -2.04;
  scene.add(shadowPlane);

  // ─────────────────────────────────────────────────────
  // 10. 坐标轴
  // ─────────────────────────────────────────────────────
  const axesHelper = new THREE.AxesHelper(1.1);
  axesHelper.position.set(-2.2, -1.4, 0.7);
  scene.add(axesHelper);

  // ─────────────────────────────────────────────────────
  // 10b. 底部参考网格（科研感）
  // ─────────────────────────────────────────────────────
  const refGrid = new THREE.GridHelper(4, 20, 0x1a1a2e, 0x0d0d1a);
  refGrid.position.y = -1.8;
  (refGrid.material as THREE.LineBasicMaterial).opacity = 0.3;
  (refGrid.material as THREE.LineBasicMaterial).transparent = true;
  scene.add(refGrid);

  // ─────────────────────────────────────────────────────
  // 10c. 坐标轴指示器（红绿蓝 XYZ）
  // ─────────────────────────────────────────────────────
  const axisLen = 0.5;
  const axisGroup = new THREE.Group();
  // X 轴（红）
  const xGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(axisLen,0,0)]);
  axisGroup.add(new THREE.Line(xGeo, new THREE.LineBasicMaterial({ color: 0xff4444 })));
  // Y 轴（绿）
  const yGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,axisLen,0)]);
  axisGroup.add(new THREE.Line(yGeo, new THREE.LineBasicMaterial({ color: 0x44ff44 })));
  // Z 轴（蓝）
  const zGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,axisLen)]);
  axisGroup.add(new THREE.Line(zGeo, new THREE.LineBasicMaterial({ color: 0x4488ff })));
  axisGroup.position.set(-1.6, -1.7, -1.6);
  scene.add(axisGroup);

  // ─────────────────────────────────────────────────────
  // 11. 裁剪平面
  // ─────────────────────────────────────────────────────
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 100);

  // ─────────────────────────────────────────────────────
  // 12. Resize handler
  // ─────────────────────────────────────────────────────
  const resize = (w: number, h: number): void => {
    // 跨 DPI 屏（如窗口在显示器间拖动）devicePixelRatio 会变化，需重新设置
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setPixelRatio(pr);
    // EffectComposer.setSize 会以有效像素（w*pr, h*pr）自动传播到所有 pass
    // （bloom / smaa 等），因此无需再对每个 pass 单独 setSize(用 CSS 像素会错位）
    composer.setSize(w, h);
    // 显式同步 SMAA 尺寸（与 composer.setSize 内部一致），确保抗锯齿缓冲正确
    smaa.setSize(w * pr, h * pr);
  };

  return {
    scene, camera, renderer, composer, controls,
    gridHelper, shadowPlane, axesHelper, refGrid, axisGroup, pmrem, clipPlane,
    composerRT, bloom, resize,
    get contextLost() { return contextLost; },
  };
}
