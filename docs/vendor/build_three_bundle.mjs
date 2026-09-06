// build_three_bundle.mjs —— 教学版 three.bundle tree-shake 重建（2026-09-06 终审后入库）
// 依据 docs/app.html 实际使用的 26 核心 API + 11 addons 生成具名导入（rolldown 据此摇树），
// 输出 IIFE 挂 window.THREE。版本锁 three@0.160.0（与旧 bundle 一致，零 API 变更风险）。
//
// ── 重建步骤（勿把依赖装进 tpms-platform：npm install 会改写 package-lock 删
//    @emnapi/* optional 条目致 CI linux npm ci 断，历史教训）──
//   1. mkdir 独立临时目录并在其中:  npm i rolldown three@0.160.0
//   2. 拷贝本脚本到该目录后执行:    node build_three_bundle.mjs
//   3. 覆盖产物:                    cp three.bundle.slim.js <repo>/docs/vendor/three.bundle.js
//   4. 验证（缺一不可）:
//      a. Playwright 起 docs 服务跑 tpms/.verify/verify.mjs（含 37 键存在性由本脚本
//         CORE/ADDONS 清单保证；页面行为回归走 verify 全套）
//      b. file:// 双击 docs/app.html 冒烟（渲染 + 切曲面）
//
// ── 维护约束：app.html 的 THREE.* 用量变化后必须对账 CORE/ADDONS 清单
//   （tree-shake 按清单摇树，清单缺项 = 运行时 undefined，冷门路径才会触发）──
import { rolldown } from 'rolldown';
import { writeFileSync } from 'node:fs';

const CORE = [
  'ACESFilmicToneMapping', 'AxesHelper', 'BufferGeometry', 'CanvasTexture', 'DirectionalLight',
  'DoubleSide', 'Float32BufferAttribute', 'GridHelper', 'Group', 'HemisphereLight', 'MathUtils',
  'Matrix4', 'Mesh', 'MeshBasicMaterial', 'MeshPhysicalMaterial', 'MeshStandardMaterial',
  'PMREMGenerator', 'PerspectiveCamera', 'Plane', 'PlaneGeometry', 'SRGBColorSpace', 'Scene',
  'Vector2', 'Vector3', 'WebGLRenderTarget', 'WebGLRenderer',
];
const ADDONS = [
  ['OrbitControls', 'three/addons/controls/OrbitControls.js'],
  ['STLExporter', 'three/addons/exporters/STLExporter.js'],
  ['GLTFExporter', 'three/addons/exporters/GLTFExporter.js'],
  ['OBJExporter', 'three/addons/exporters/OBJExporter.js'],
  ['RoomEnvironment', 'three/addons/environments/RoomEnvironment.js'],
  ['EffectComposer', 'three/addons/postprocessing/EffectComposer.js'],
  ['RenderPass', 'three/addons/postprocessing/RenderPass.js'],
  ['UnrealBloomPass', 'three/addons/postprocessing/UnrealBloomPass.js'],
  ['ShaderPass', 'three/addons/postprocessing/ShaderPass.js'],
  ['OutputPass', 'three/addons/postprocessing/OutputPass.js'],
  ['FXAAShader', 'three/addons/shaders/FXAAShader.js'],
];

const entry = `
import { ${CORE.join(', ')} } from 'three';
${ADDONS.map(([n, p]) => `import { ${n} } from '${p}';`).join('\n')}
window.THREE = { ${[...CORE, ...ADDONS.map(([n]) => n)].join(', ')} };
`;
writeFileSync('entry.three.ts', entry);

const bundle = await rolldown({ input: 'entry.three.ts' });
const { output } = await bundle.generate({ format: 'iife', minify: true });
const code = output[0].code;
writeFileSync('three.bundle.slim.js', code);
console.log('slim bundle:', code.length, 'bytes raw');
