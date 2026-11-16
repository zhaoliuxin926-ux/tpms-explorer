# Release Notes — v1.3.0（双壳 Agent 驾驶舱 + DSH CAE 工作台 + FEA/CFD 双标定线收官）

> 本文件为**发布时点快照**（含当轮门禁数/断言数，不得当现态引用）；现态以 `run_ci_suite.mjs` SCHEDULE 与 README 为准。
> 功能别名 tag 同提交发布：**v9.5.0**（双轨体系下与产品号 v1.3.0 指向同一提交）。

> 2026-11-16 · 语义化 minor：双壳 Agent 驾驶舱、DSH 三栏 CAE 工作台与本地求解桥、CLI/Web 单源核心、FEA/CFD 双标定线与四级保真度对标全链收官。

## 新能力（用户可见）

- **双壳 Agent 驾驶舱（`platform/harness.html`）与同源桥（`iframe-bridge.ts`）**：左侧自治轨迹流 + 右侧 3D 工程视口双壳协同；开桥同源+嵌入双校验、请求-回执 ID 配对、60s 重活滑动窗算力上限（$\Sigma\le 4096$）执行面自守；无 Key 环境自动降级确定性规则解析。
- **DSH 三栏 CAE 工作台与本地求解桥（`cae-daemon.mjs`）**：`127.0.0.1:4830` 本地桥支持 `preprocess-bl` / `openfoam-cfd` / `abaqus-fea` / `comsol-cfd` / `pipeline` 五类求解作业（localhost origin 白名单 + 路径穿越封堵 + 参数钳制）。
- **CLI / Web 双端单源核心（`schema-core.mjs` + `session-core.mjs`）**：工具 schema 逐槽位校验拦截、Per-Prompt Run 联合算力预算（E5）与写冲突检测（E11）、双语义锁会话与确定性指代绑定（`resolveReference` 白名单）在 CLI 与浏览器端共享单一真源（零 `node:*`/DOM 依赖）。
- **高保真 FEA 标定线收官（`docs/fea-calibration.md`）**：network 形态 gyroid（$E^*/E_s=0.9914\bar{\rho}^{2.2028}$）与 diamond（$0.7871\bar{\rho}^{2.0709}$）STL 实测密度口径幂律落库 + 名义→实测密度入口幂律映射；T4 ABAQUS C3D10 静态盲测双点验证（p70 $-1.07\%$ / p50 $-0.90\%$，实测 $\bar{\rho}$ 口径偏差 $<0.3\%$）；35 份标定 ODB 载荷-位移曲线全量提取归档 `sim/csv_archive/`。
- **高保真 CFD 渗透率标定线收官（`docs/cfd-calibration.md` · `docs/cfd-k-curve.csv`）**：WSL OpenFOAM v13 通透池压差驱动标定幂律 $K_{\text{cell}}=0.461\varepsilon^{3.17}$；$k_2$ 双胞四点入口效应实测定案统一修正因子 $0.9594$（实用交付口径 $K_{\text{true}}=0.442\varepsilon^{3.17}$）；$k_3$ 三胞实验验证与 $k_\infty$ 三点渐近外推（$K_\infty=0.1342\text{ mm}^2$）；STL 实测 $S_v$ 重算 Kozeny 常数（$9.6\to 13.5$）；FVM 体素兜底轨注入 `fidelity_warning` 冒烟档护栏。
- **试验曲线真实内核反演与网页导出水密门**：`fit-batch.mjs` 桥接平台 `experimental-fit.ts` 真实内核（Toe 双指针窗口 + 截断 $\varepsilon_d$ 判别 + 样本标准差 CV）；网页导出中心与 NL 助手接入 `mesh-audit.ts` 单源水密审计 + 32 格/周期升档重试。

## 门禁

- 全量 CI 门 48→**50**（三平台）：+`agent_bridge_audit`（双端同源锁/红队 E5-E11/M4 真跑/daemon 安全，53 断言满配档 / 52 CI 基线）、+`harness_ui_check`（双壳驾驶舱与 DSH 工作台真浏览器 E2E，38 断言）
- `agent_selftest` 55→**61**；`experimental_fit_audit` 19→**22**；`periodic_rve_audit` 88→**92**；`docs_consistency_check` **349**（GUARD 313）
- 诚实边界表更新至 **16 条**（新增 #18 纯静态隐式体素 FEM 塑性坍塌段收敛边界定理，`gen-boundary-table.mjs --check` 零漂移）

## 版本口径

- 产品号 v1.2.0 → **v1.3.0**（语义化 minor）；功能别名 tag v9.4.0 → **v9.5.0**（双轨体系不变）
- 导出物产品标识/包版本同步 v1.3.0，并重建同步 `docs/platform` 部署产物
