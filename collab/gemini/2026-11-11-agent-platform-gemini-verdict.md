# Gemini 终答归档：治理语义映射 + Q1-Q3 架构裁定（2026-11-11 第二轮）

> 轮次：ZCode 回执（`2026-11-11-agent-platform-consult-reply.md`）→ 用户代贴 → Gemini 终答（下文原文）→ ZCode 处置表（文末）。
> 参照系核实：deepseek-harness 官方仓存在（见处置表 §参照系）。

---

## 原文（verbatim）

# 【外部评审回执：CLI/Web 治理语义映射与 Q1–Q3 架构裁定】（2026-11-11）

> 确认收到贵方基于仓库实测出具的《对「Sim-Harness 平台化咨询」的回执》。首先完全接受贵方的关键勘误与裁定：仓库 `tpms/agent/` 线下已具备生产态的 M3 多轮工具循环（`llm-agent.mjs`）与 M4 有界菜单自愈驱动器（`tpms-driver.mjs`，含 `patch_design | declare_unreachable`、43 条双轮回归、101 项 provider 断言及 E5~E14 红队探针）。前次诊断因仅见 `platform/index.html` 单文件而误判为"缺自愈闭环"，实情确为"CLI 闭环资产已成熟，待向 Web 端合流"。同时完全赞同"微内核与常驻本地桥不立项，按 A（Web 端 Function-Calling + ToolRegistry 合流）→ B（`harness.html` 双壳）收窄路线择期推进"的工程决断。

以下先回答贵方附言中的"自查思考题"，再逐一给出 **Q1、Q2、Q3** 的具体设计方案。

---

## 零、回应"自查思考题"：CLI 双治理规则向浏览器内执行面的语义映射

当执行面从"CLI 子进程落盘"切换为"页内状态变更 + 浏览器下载触发"时，批次级联合算力预算与同 `out` 写写冲突拒绝这两条红队治理规则的命运截然不同：

### 1. 可直接平移的规则：批次级联合算力预算（$\sum \text{periods}^3 \leq 4096$）

* 判定：预算口径 100% 原样平移，无需改写数学定义。
* **原因：** 无论是 CLI 端生成网格还是浏览器端（Web Worker / WebGPU）重建等值面与体素审计，在每周期网格采样密度基准固定时，单次工具调用的内存分配与计算复杂度均严格正比于晶胞总数 $k^3 = \text{periods}^3$。不仅如此，浏览器单页标签页受限于 JS 堆内存上限与 Worker 阻塞风险，对单批次恶意算力洪峰（如单轮并发请求多个 $k=10$ 网格）比 Node CLI 更加敏感。因此，`validateToolCalls` 中的 $\sum \text{periods}^3 \leq 4096$ 拦截器可直接原封不动复用于浏览器端。

### 2. 语义失效需重定义的规则：同 `out` 写写冲突拒绝（Write-Write Conflict）

* 判定："磁盘文件路径覆盖"语义在页内失效；其在浏览器内的真实物理对应物是"单例视口状态槽位（Singleton Viewport State）的同轮覆写冲突"与"触发式 Blob 下载文件名碰撞"。
* **为什么失效与如何重定义：**
在 CLI 中，同一轮 `tool_calls` 数组内出现两次 `mesh(..., out="a.stl")` 会导致后一个子进程静默覆写前一个落盘文件。而在浏览器页内执行时，存在两层状态：

1. **主状态槽位覆写（核心对应物）：** 浏览器 UI 只有一个全局活动的 `DesignState` 和一个主 3D 视口（`#canvas-container`）。如果 LLM 在同一轮 `tool_calls` 中并发发出两个会修改全局状态的调用（例如同时调用两次未指定不同导出目标的 `mesh` 或 `scenario`，一个设 `type="gyroid"`，另一个设 `type="diamond"`），前一次状态变更尚未完成渲染就会被后一次瞬间覆盖，造成不可预测的竞态与算力浪费。

2. **虚拟下载队列碰撞（字面对应物）：** 当 `mesh` 带 `out` 参数触发浏览器 `<a download="${out}">` Blob 导出时，同名 `out` 会导致浏览器下载管理器发生文件覆盖或自动重命名（`a (1).stl`）。

* **浏览器端统一拦截规则（兼顾 17 案红队探针零改动通过）：**
在 `validateToolCalls` 中保留对显式 `out` 字符串集合的判重逻辑（确保 E5~E14 红队探针 100% 原样通过）；同时，在浏览器执行器适配层，**将一切未显式指定独立导出槽位、直接变更主界面 `DesignState` 的工具调用，隐式映射为写入虚拟目标 `out = "__active_viewport__"`**。只要同一轮 `tool_calls` 批次中出现 $\geq 2$ 个写入 `"__active_viewport__"` 的变更操作（纯只读查询如 `tpms_list`、`estimate` 除外），立即以完全相同的 `WRITE_CONFLICT` 错误码拒绝该批次！

---

## 一、Q1｜Web 合流最小方案设计（纯静态页 / 单源契约 / 零回归兜底）

### 1. `ToolRegistry` 与 CLI `tools.schema.json` 的单源策略（Single-Source Strategy）

核心原则：契约与校验器物理单源（零拷贝），执行器按环境依赖注入（Adapter 分流）。

* **物理单源引用：** 不在 `tpms-platform/src/` 下复制维护第二份 JSON Schema。直接在 Vite 构建配置（`vite.config.ts`）或相对路径中引用 `../../agent/tools.schema.json` 与纯函数版的校验核（将 `validateToolCalls`、算力预算 $\sum \text{periods}^3 \leq 4096$、写写冲突检测、以及 M4 的 `REPAIR_TOOL` 枚举抽离为无 Node `fs/child_process` 依赖的纯 ES 模块 `tpms/agent/schema-core.mjs`）。Vite 打包时将其静态编译进浏览器产物，从根源上保证 CLI 与 Web 的 Schema 100% 字节级同源，43 条回归无需重建。

* **六工具浏览器内映射表（`BrowserToolRegistry`）：**

| 工具名（对齐 `tools.schema.json`） | 浏览器内绑定目标（复用 `tpms-platform/src/` 现有函数） | 状态属性 |
| --- | --- | --- |
| `tpms_list` | 读取 `types.ts` 中 26 族曲面（24 TPMS + 2 桁架）元数据字典直接返回 | 只读（免冲突锁） |
| `estimate` | 调用解析代理模型（Gibson-Ashby × Kozeny-Carman）计算 $E^*, \sigma_y, \kappa, S_v$ | 只读（免冲突锁） |
| `pareto` | 执行 `#sect-pareto` 同源的 26 族 × 参数域扫描，返回非支配前沿 Top-3 并写入浏览器端 `agent-session` 供指代消解（如"第一个"） | 只读 + 会话锚定 |
| `scenario` | 触发 `# grp-geometry` 下的 6 类应用场景预设（`bone/lightweight/heat/...`）并同步滑块 | 写主视口（占锁） |
| `mesh` | 变更 `DesignState` 触发 Worker 等值面重建；若传了 `out`，同步调用对应导出器（STL/3MF/GLB）生成 Blob 下载芯片 | 写主视口 / 导出 |
| `design_verify` | 调用 `#sect-mfg`（`btn-mfg`）体素级制造检查（最小壁厚、孔喉、死腔、水密性），返回与 CLI 同构的结构化诊断 JSON，供 M4 `tpms-driver` 循环判定是否触发 `apply_repair` 或 `declare_unreachable` | 校验（M4 闭环核） |

### 2. Provider 浏览器子集设计（`llm-provider-browser.ts`）

从 `llm-provider.mjs` 的四通道中裁剪出纯 `fetch` 浏览器子集（**OpenAI 兼容 + Ollama 本地 CORS + Mock 回归 + 无 Key 规则兜底**）：

* **Key 存储纪律：** 默认采用 `sessionStorage.getItem('tpms_byo_key')`（标签页关闭即销毁，默认不落持久盘），提供显式勾选框允许用户存入 `localStorage`。严禁将 Key 写入 `DesignState`、URL 分享参数（`#btn-share`）或任何导出的 `.json` 快照中。

* **流式与超时控制：**
  * 在 Function-Calling 决策轮（含 M3 工具选择与 M4 `apply_repair`），强制使用非流式 `stream: false`（或内部缓冲完整个 `tool_calls` JSON 后再过 `validateToolCalls` 拦截器），杜绝半截畸形 JSON 穿透到 UI 层；仅在最终自然语言总结轮开启 SSE 流式渲染。
  * 使用 `AbortController` 设双层超时：首包响应超时 `15,000 ms`，单轮总超时 `45,000 ms`（防大模型推理挂起阻塞 UI）。

* **五类确定性错误分类（Error Taxonomy）：**
  1. `ERR_NO_KEY`：未配置 Key → **静默无缝降级**至现有 `nl-agent.ts` 规则解析器，UI 气泡角标显示 `⚡ 本地规则`（确保无 Key 时零报错、零回归）。
  2. `ERR_CORS_OR_NETWORK`：`fetch` 抛出 `TypeError` → 精准提示"目标端点未放行浏览器跨域（CORS）或网络不可达，请检查智谱 `paas/v4` 跨域支持或本地 Ollama 的 `OLLAMA_ORIGINS=*` 配置"。
  3. `ERR_AUTH_QUOTA`：HTTP `401 / 403 / 429` → 区分 Key 无效与额度/通道错误（如误用套餐端点 vs 标准计费端点），并提供一键回退规则引擎按钮。
  4. `ERR_SCHEMA_REJECTED`（对应 CLI `exit 2`）：`validateToolCalls` 拦截（参数越界、未知工具、$\sum \text{periods}^3 > 4096$、同轮写冲突）→ 拒绝执行并在 `#nl-log` 渲染结构化拦截红卡。
  5. `ERR_UNREACHABLE / ERR_MAX_ROUNDS`（对应 CLI `exit 3 / exit 4`）：M4 修复触发 `declare_unreachable` 或耗尽轮数 → 渲染诚实边界报告卡并给出最近似可行参数芯片。

### 3. 门禁锚增补清单（CI Gate Additions）

在不触碰现有 48 道门禁的前提下，于 `.verify/` 新增或扩展以下 4 项轻量级断言：

1. **门禁增补 1（Schema 同源锁）：** 校验 Web 端 `BrowserToolRegistry` 暴露的工具名、枚举值、数值上下界与 `tpms/agent/tools.schema.json` 深度相等（`deepStrictEqual`）。
2. **门禁增补 2（无 Key 规则兜底零回归）：** 在 `apiKey = null` 下重放现有 `nl_agent` 门禁的全部 48 项测试，断言输出与原规则版逐位一致。
3. **门禁增补 3（浏览器端红队治理复刻）：** 通过 `MockProvider` 注入超算力预算批次（$\sum \text{periods}^3 > 4096$）与同轮双 `mesh` 写冲突批次，断言 `BrowserToolRegistry` 100% 拒绝且 `DesignState` 未发生脏写。
4. **门禁增补 4（Key 零泄漏审计）：** 在 `sessionStorage/localStorage` 注入测试伪 Key 后，调用导出中心的 `json / design / pkg` 及分享链接生成函数，断言产物字符串中不包含伪 Key 子串。

---

## 二、Q2｜微内核反方质询：成本/收益账本与三个可证伪判据

在"单人维护 + 48 道门禁强锚定 DOM/模块结构 + GitHub Pages 零后端"的现实约束下，将架构改造为 *Everything is a Plugin* 微内核是一个典型的负收益过度工程（Over-engineering）：

### 1. "微内核插件化"相比"ES 模块边界 + 双壳"具体多付出的代价与换来的收益

* **多付出的硬成本：**
  1. **DOM 门禁连根断裂：** 现有 48 道门禁与 349 项文档审计直接锚定了 `index.html` 中 31 个 `<details class="sect">` 的静态 DOM ID 与源码导出结构。微内核要求所有面板和画布在运行时通过 `plugin.mount(container)` 动态注入，这会让所有基于静态 HTML/AST 扫描的 CI 门禁瞬间全红。
  2. **共享状态序列化税：** 你现有的 15 个物理模块（等值面、体素 FEM、LPBF、能带、长入、RVE、Pareto 等）全部共享同一个核心数据结构——**三维笛卡尔标量场 `Float32Array` 与三角网格 `TypedArray`**。在 ES 模块下，它们通过内存引用零拷贝直读；若拆成独立沙箱插件，跨插件传递百万级体素场需要复杂的生命周期同步与事件总线协议，凭空增加 $1000+$ 行胶水代码。

* **换来的收益：** 在单人仓库、无第三方外部开发者提交独立 npm 插件包的现状下，动态注册/卸载插件带来的解耦收益几乎为 **0**。

### 2. 可证伪判据（Falsifiable Criteria）：出现以下任一明确信号才值得升级插件协议

只有当未来项目演进触发以下 **3 个定量阈值之一** 时，"ES 模块 + 声明式 `tools.schema.json`"才会触及天花板，届时再升级微内核插件协议：

1. **判据信号 A（异构物理本体分裂 $\ge 3$ 类）：**
当前所有仿真模块均围绕单一几何本体——"有界盒内的隐式周期场 / 体素网格"展开。如果未来接入了状态本体与 `DesignState` **字段重合度 $< 20\%$** 的全新仿真域（例如：① 1D/3D 血管树流体网络图、② 多体动力学关节机构、③ 宏观骨板螺钉接触装配体），且此类互不兼容的几何本体达到 $\ge 3$ 个时，静态 `types.ts` 会膨胀为无法维护的上帝对象（God Object），此时需引入插件隔离本体。

2. **判据信号 B（跨仓库/多人无冲突协作 > 2 人）：**
当课题组出现第 2～3 名同门师弟妹，需要在**完全不修改 `main.ts`、`types.ts` 和 `index.html`** 的前提下，在独立目录或外部仓库开发新的物理算子（如腐蚀降解、相场断裂）并通过配置清单热挂载进平台时。

3. **判据信号 C（首屏构建产物或内存越界）：**
当 `tpms-platform` 编译后的首屏 JS/WASM 包体积突破 **$5\text{ MB}$（Gzipped）** 或冷启动耗时 $> 3\text{ s}$，迫使系统必须按会话意图在运行时动态按需拉取（Dynamic `import()`）远程求解器插件包时。

* **结论：** 在上述三个信号出现前，坚定维持 **"ES 模块边界 + 单源 `tools.schema.json` + 双壳入口"**。

---

## 三、Q3｜双壳（`harness.html`）在 $\le 980\text{px}$ 下的移动端不回退降级方案

`index.html` 在 UI 批次三中已经跑通了一套经过 $375\text{px}$ 真机像素检验的移动端范式：**主视口全屏铺底 + `.panel.controls` 底部抽屉（`max-height: 78vh`）+ `.v-tools` 横向无滚动条滑动 + `#nl-panel` 底部半屏上浮（`48vh`）**。

若未来新建 `harness.html`（桌面端为"左会话 + 中对话流 + 右 3D/图表舞台"的三栏/双栏驾驶舱），在 $\le 980\text{px}$ 移动端绝不能让"三栏垂直堆叠"或让"对话面板与参数抽屉两个底部浮层打架"。具体无回退降级规范如下：

### 1. $\le 980\text{px}$ 核心布局变换：从"左右双主栏"降级为"上置吸顶微舞台（38vh）+ 下置全屏对话流（62vh）"

* **上方吸顶舞台坞（Sticky Stage Dock，`height: 38vh; flex: none`）：**
占据屏幕上半部 $38\%$ 高度，内部放置 3D 视口（`#canvas-container`）与仿真图表切换签（`[🧊 3D 视口 | 📈 仿真曲线 | 🎯 Pareto]`）。直接复用 `index.html` 批次三已验证的移动端覆盖层样式：
  * `.v-tools` 保持 `left: 10px; right: 10px; overflow-x: auto; scrollbar-width: none`；
  * `.stat-overlay` 保持紧凑折叠态（仅显示 `孔隙率 · 材料 · E*` 摘要条，点击展开）。

* **下方主交互区（Trajectory Chat Stream，`height: calc(62vh - 52px); flex: 1`）：**
占据屏幕下半部 $62\%$，作为 `harness.html` 的第一主视角。对话日志流（`#nl-log`）独立滚动，输入框（`#nl-inputrow`）固定在视口最底端（适配移动端软键盘弹起 `env(safe-area-inset-bottom)`）。

* **优势：** 用户在下方打字或观察 M4 自愈修复过程（如 `k=4 -> k=2`）时，眼睛无需切换页面，就能在上方 $38vh$ 窗口中实时看到 3D 晶胞变粗、壁厚变厚以及曲线刷新，实现真正的"边聊边看"。

### 2. 次要栏目的折叠收拢（零遮挡冲突）

1. **左侧会话/模式栏 → 顶栏左侧汉堡抽屉（Off-canvas Drawer）：** 在 $\le 980\text{px}$ 下自动隐藏，通过 `.topbar` 左侧图标呼出。
2. **手动参数面板（`.panel.controls`）→ 按需呼出的模态底部抽屉：**
在 `harness.html` 中，31 节手动滑块退居二线。当用户需要手动微调某个参数（或点击对话流中某张结果卡上的 `[🎛️ 微调此参数]` 按钮）时，直接复用 `index.html:348` 的 `.grid .panel.controls.sheet-open { transform: translateY(0); max-height: 78vh; z-index: 70 }` 样式将其从底部拉起，关闭后即完全收起（`translateY(100%)`），从而与底部对话输入框彻底解耦、互不遮挡。

**【总结建议】**
本回执可直接归档入库。当前请优先推进既定的 **anchor snappyHex 近墙终判** 与 **S1_G60 上机**；待后续择期启动 **方向 A（Web NL 合流）** 时，直接按本回执 Q1 的"单源 Schema + 虚拟视口冲突锁 + 四项增补门禁"落地即可。

---
---

## ZCode 处置表（2026-11-11，核实后）

### 采纳——方向 A 立项时的设计基线
1. **单源策略**（契约+校验器物理单源、`schema-core.mjs` 纯模块抽取、执行器环境注入）。两处落地修正：①相对路径实为 `../agent/tools.schema.json`（agent 在 `tpms/agent`、platform 在 `tpms/tpms-platform`，Gemini 的 `../../agent` 多一级）；②`loadToolsSchema` 的 `readFileSync` 留 Node 侧，Web 侧走 Vite 原生 JSON import。
2. **写写冲突双层语义**（`__active_viewport__` 主状态槽隐式映射 + Blob 下载名碰撞保留显式 `out` 判重）。**待对齐点**：Gemini 写"≥2 写入即拒绝该批次（整批拒）"，CLI 现行 E11 语义="重复者拒/首个保留"（8d1bddb）——方向 A 落地时须二选一后单源实现（浏览器无落盘回滚、脏写代价更高，倾向整批拒，但以届时拍板为准）。
3. **Provider 浏览器子集**：决策轮非流式+`AbortController` 双层超时+五类错误分类+无 Key 规则兜底降级（`ERR_NO_KEY` 静默降级保 nl_agent 门 48 项零回归）。**实质分歧登记**：单轮总超时 45s 与 CLI E2 教训冲突（glm-5.x thinking 长尾实测 150s+，CLI 因此放宽至 170s 贴 spawnSync 180s 上限）——浏览器总超时若 45s 会击穿同族推理场景，立项时须用 E2 数据重定（首包/总时双层数值另算）。
4. **Key 纪律**：sessionStorage 默认+显式 opt-in localStorage+禁入 DesignState/分享 URL/导出快照+门禁增补 4（零泄漏审计）。
5. **四项门禁增补**（同源锁/无 Key 重放/浏览器红队复刻/零泄漏）作为立项清单。

### 采纳——登记备查（不立项）
- **Q2 三判据**（微内核升级可证伪信号）：A 异构本体≥3 类（与 DesignState 字段重合<20%）／B 外部协作者>2 人／C 首屏 >5MB(gz) 或冷启动 >3s。

### 参考——方向 B 立项时
- **Q3 移动端降级**：38vh 吸顶舞台+62vh 对话流+左栏 off-canvas+`.panel.controls` 复用底部抽屉。锚修正：`.sheet-open` 实为 `index.html:437`（非 348）。

### 事实口径修正（不改变结论）
- "349 项文档审计锚定 31 抽屉"口径混：docs_consistency 349=全仓文档断言；platform DOM 锚=fix_check 28 项（verify 27 测的是冻结教学版 docs/app.html，非 platform——改 onboarding 前必查对应门的既有纪律）。

### 待验证卡点（不变）
- 智谱 paas/v4 浏览器 CORS（Gemini 方案默认可配，未证——方向 A 第一验证步）。

### 参照系核实（ZCode 实测 2026-11-11）
- `deepseek-ai/deepseek-harness` 官方仓真实存在：MIT、"Everything is a Plugin"、Cordis（cordiverse/cordis，arXiv:2608.25512）、`npx @deepseek-ai/dsh web`（127.0.0.1:3080）、Desktop 形态、developer preview（官方声明将有破坏性变更）、生态活跃（插件市场/awesome 列表/第三方桌面版）。原诊断的模式 B 引用真实。**方向 A/B 设计时可借鉴其 `docs/architecture.md` 的接口分层，但不引入 Cordis 运行时依赖**（与"微内核不立项"裁定一致）。

### 拍板状态
- 维持"本轮不立项"：咨询两轮闭环，本归档即方向 A/B 的设计输入包。既定优先（anchor snappyHex 终判 / S1_G60 上机）不变。

---

## 第三轮（同日）：用户裁决 + 三笔修正定案 + 预算窗口定案（ZCode 记录）

1. **用户拍板**：S1 上机打印**挂起**（移出近期行动卡，CSV 回传链路保持就绪待恢复）；**方向 A（Web NL 合流）插队启动**——"我现在就是想先把这个 agent 平台做出来"；anchor snappyHex 顺延留队列。
2. **三笔修正定案（Gemini 第三轮确认采纳）**：
   - vite 路径 `../agent/tools.schema.json`；
   - E11 写冲突语义对齐 CLI `8d1bddb`「首个保留执行、重复者精准拒绝」（**非整批连坐**——同轮附带的只读查询与首个合法变更不误杀）；
   - 浏览器 `AbortController` 单轮总超时对齐 CLI E2 教训设 **170s**，UI 配实时推理秒表 + 手动 `[⏹ 停止]`（防击穿 glm-5.x thinking 长尾，又不误杀长思考链）。
3. **预算窗口定案（ZCode 自查题 → Gemini 解答 → 采纳）**：浏览器端 Σ periods³≤4096 的预算窗口=**「单次用户 Prompt 触发的自治闭环周期（Per-Prompt Autonomous Run）」**——一次 `#nl-send` 驱动的 `1..maxRounds` 全轮次**跨轮累计不重置**，超限熔断该 Run（同构复刻 CLI「单次进程」边界，封死 E5 跨轮自治算力放大）；Run 结束、控制权交还人类后，下次人类主动发送开启新配额（长驻探索会话不被误锁死）；另加防脚本连发滑动窗口（60s 滚动窗口内跨 Prompt 累计 ≤8192）。
4. **CORS 前置判定**：方向 A 第一验证步（paas/v4 + anthropic 通道双端点 preflight 实测），本日执行。

