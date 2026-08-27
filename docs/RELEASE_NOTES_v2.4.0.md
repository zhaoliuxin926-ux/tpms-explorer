# TPMS Explorer v2.4.0-ultimate-engine

十二道 CI 门禁全绿 · 三平台（Ubuntu/Windows/macOS）CI 矩阵 · 六阶段全系统加固

## 六阶段交付（中英双语 Release Notes）

### I. Custom Equation AST Sandbox 自定义公式 AST 沙箱
- 零依赖递归下降解析器（Tokenizer → AST → 快速闭包），无 eval / new Function
- Dual Number AD：单次遍历精确梯度 ∇F（D1 jet），forward-over-forward 精确 Hessian（D2 jet）
- 坐标扩展：x/y/z + 派生球坐标 r/θ/φ（AST 脱糖）；全局参数 k/t/iso
- NumPy / MATLAB 向量化代码生成（wrap 坐标 + 精确括号策略）
- UI 沙箱面板：实时校验（错误字符定位）、8 预设样例、错误不触发重建
- Gate 9 custom_equation_audit：73 断言（语法容错/万点求值/AD 梯度/解析锚点 Hessian/NumPy 实跑等价）

### II. RVE Homogenization & Directional Modulus RVE 均质化与方向模量
- Voigt–Reuss 精确解析界（C_V = φ·C0；真孔隙 Reuss = 0）
- E(n) = 1/(nᵢnⱼnₖnℓSᵢⱼₖₗ) 方向模量 + 球面热力图（迂曲度调制方向刚度）
- 各向同性极限精确自检（剪切柔度 (1+ν)(1/Ei+1/Ej) → 2(1+ν)/E）
- Gate 10 homogenization_audit：13 断言
- 诚实声明：体素 FE 求解器研究受阻（均值漂移泊松污染 −18%/高对比 CG 崩溃/均值钉扎盲区），机理归档 bugs.md，交付解析路线

### III. Single-file Full Parity 单文件版全量同步（parity 74 → 184）
- app.html 移植：Hybrid 四向波前混合、三向迂曲度（26 连通 Dijkstra）、三轴动态剖切、3MF 工业导出
- 行为级双实现对拍：波前 α（40 断言 ≤1e-12）、迂曲度（18 断言逐点相等）
- 开发期抓出并修复：迂曲度流体语义反相（跨实现漂移在 DOM 全绿下存活的典型）

### IV. Manifold Space Mapping 非欧度规空间映射
- 四族保形顶点 warp：圆柱弯曲 / 环面闭合 / 双曲径向 / 应力线各向异性
- det(J)>0 全域采样验证 + 水密继承（open edges=0）+ 周期对齐（Δ<1e-6）
- Gate 11 manifold_audit：12 断言

### V. Red-team Adversarial Matrix 红队极端工况矩阵
- 100+ 案例：孔隙率 {1%,99%} × 8 曲面 × 3 模式 × 双容器 + 长宽比 + 高频 + 鞍点 + 极端权重
- 三硬指标：零未捕获异常 / 零开放边 / 零退化三角
- 80³ 全量重建 621ms 哨兵；泄漏探针轮数参数化（200 轮 Δ=1.0MB < 5MB 预算）

### VI. CI/CD & Docs 持续集成与文档
- GitHub Actions 三平台并行矩阵（.github/workflows/ci.yml）
- WORKFLOW_GUIDE 九~十二章：AST 语法规范 / 空间映射 / RVE 均质化 / 红队矩阵

## Validation 12-Gate Matrix 十二道门禁

| Gate | Suite | Assertions |
|---|---|---|
| 1 | mesh_audit | 29 cases |
| 2 | parity_math | 184 |
| 3 | sim_export_check | 13 |
| 4 | endplate_audit | 26 |
| 5 | micro_physics_audit | 17 |
| 6 | hybrid_audit | 5 |
| 7 | industrial_export_audit | 12 |
| 8 | custom_equation_audit | 73 |
| 9 | homogenization_audit | 13 |
| 10 | manifold_audit | 12 |
| 11 | redteam_matrix_audit | 100+ |
| 12 | run_all UI | 6 suites |

**Full pass: 12/12 gates on Ubuntu/Windows/macOS.**
