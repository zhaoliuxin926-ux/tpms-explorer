# 对「Sim-Harness 平台化咨询」的回执（2026-11-11）

> 背景：你基于 `platform/index.html` 单文件给出了四大差距诊断与改造建议。本回执由仓库侧
> ZCode 核实后出具：**一处关键勘误、半张你没看到的仓库地图、四大差距逐项裁定、收窄路线、
> 三个待你回答的问题**。全部引文为仓库实测源码，非转述。

---

## 一、关键勘误：你描述的"Plan→Act→Observe→Self-Correct 自愈闭环"已经在仓库里，只是不在浏览器里

你举的例子——*"制造检查发现 k=4 壁厚 0.29mm 不达标 → Agent 自主下调周期数/换构型 → 复验通过
或结构化宣告不可达"*——**这就是仓库 CLI 线 `tpms/agent/tpms-driver.mjs`（M4 闭环驱动器）的
现行生产行为**，不是待建能力：

```text
tpms-driver.mjs（213 行，摘录）：
propose → 确定性执行 verify → 读结构化失败诊断
  → LLM 在【有界策略菜单】里选修复动作（apply_repair）
  → 确定性应用 patches → 复验 …… 最多 12 轮

REPAIR_TOOL.patches 枚举（节选）：
  type: 26 族枚举 | porosity: [0.05,0.99] | periods: [1,12]
  resolution: [48,128] | container: cube|cylinder | mode | material
  action: patch_design | declare_unreachable   ← 不可达=结构化诚实宣告，非静默失败
exit 码：0=收敛交付  2=LLM 输出被拒  3=宣告不可达  4=轮数耗尽
```

设计铁律与你的 Harness 理念一致且更保守：**LLM 只在有界菜单里选动作填槽位，修复的应用/
执行/验收全部由确定性代码完成**（`validateToolCalls` 同源拦截器校验，越界拒绝）。

配套资产（均为生产态，非原型）：

| 资产 | 规模/守护 |
|---|---|
| `llm-agent.mjs`（M3 循环） | 自然语言→tool calling→CLI 执行，`--max-rounds` 多轮，六工具路由 |
| `tpms-driver.mjs`（M4 自愈） | 上文；离线回归走 mock 决策队列+真实 verify |
| `tools.schema.json` | 六工具契约：`tpms_list / estimate / mesh / scenario / design_verify / pareto` |
| `llm-provider.mjs` | 四通道：OpenAI 兼容 / Anthropic 兼容 / Ollama 本地 / Mock |
| 回归 | 43 条 n=2 双轮满贯 + `llm_provider_selftest` 101 断言 |
| 红队 | E5~E14 黑盒探针 17 案零穿透；已落地的治理含**批次级联合算力预算**（Σ periods³≤4096）与**同输出文件写写冲突拒绝** |
| 会话 | `agent-session.mjs`：推荐候选→指代词确定性绑定（"第一个"→候选序号，不经模型猜） |

**结论：差距 2（单步 vs 自愈闭环）的准确表述是"闭环已存在、未与 Web 合流"**——Web 侧
`nl-agent.ts`（201 行）是纯规则槽位解析器，这一半你说对了。另有一处小勘误：折叠抽屉实测
31 个（`class="sect"` 计数），非 29，不影响你的结论。

## 二、你没看到的半张仓库地图

```
tpms/tpms-platform/src/          ← Web 线（Vite+TS 单页，GitHub Pages 零后端）
  main.ts(5722 行) types.ts(413) core/nl-agent.ts(201 规则版)
  core/ physics/ geometry/ export/ measure/ viewers/ worker/ ui/ utils/
tpms/agent/                      ← CLI 线（Node，无浏览器依赖）
  tpms.mjs(CLI 主体) tpms-driver.mjs llm-agent.mjs llm-provider.mjs
  tools.schema.json llm_regression.mjs(43) llm_provider_selftest.mjs(101)
  agent-session.mjs schema_check.mjs selftest.mjs …
sim/                             ← 真实 CAE 管线（Python+ABAQUS+OpenFOAM+gmsh）
  p0 生成→p1 划网→p2 装配→p3 CFD 几何；anchor1-3 CFD 标定阶梯
tpms/.verify/                    ← 48 道 CI 门禁（run_ci_suite；docs 349 断言等）
```

## 三、四大差距逐项裁定

| # | 你的诊断 | 裁定 | 理由 |
|---|---|---|---|
| 1 | 交互主次倒置（仪表盘 vs 会话流） | **真差距，属产品定位决策** | 平台 v1.2.0 稳定序列+UI 三批收官"无遗留"；改主视角=开新产品形态，非还债 |
| 2 | 单步解析器 vs 自愈闭环 | **半真** | 闭环资产已在 CLI（见勘误）；缺的是浏览器合流 |
| 3 | 微内核插件架构 | **不采纳** | 29→31 抽屉是信息架构问题非架构耦合；48 门门禁锚定现有 DOM/结构，微内核协议会连根拆散锚点；单人维护，收益/成本倒挂 |
| 4 | 本地 CAE 桥接 | **不立项** | 重 CAE 已由 `sim/` 管线+CLI 承担（真跑路径）；网页加常驻桥与"GitHub Pages 零后端"定位冲突并引入安全面。远期可选形态=CLI 会话模式流式日志，非常驻服务 |

## 四、你两个确认问题的回答（仓库证据）

**1. 大模型接入**：现行四通道（OpenAI 兼容=智谱 paas/v4 标准计费——条款已裁定自建应用
不可用套餐额度、Anthropic 兼容=智谱 Coding Plan 通道、Ollama 本地、Mock 回归）。key 铁律=
只经 env 不落盘。**浏览器直连 BYO key 是新增决策点**，两个前置卡点：① paas/v4 端点浏览器
CORS 是否放行（未实测）；② key 若进 localStorage 属"落盘到用户浏览器"，与现行纪律的边界
需用户拍板（永不入仓库是底线）。

**2. 本地 CAE 桥**：见裁定 4——不做常驻桥。你要的"终端日志流式推到网页+跑完自动读 CSV
画对比图"体验，`sim/` 管线已覆盖功能本体，差的只是呈现层。

## 五、收窄路线（已获用户拍板：本轮不立项，择期启动 A）

- **A｜Web NL 接 LLM function-calling + 浏览器内 ToolRegistry**：把平台现有函数（参数配置/
  估算/制造审计/逆设计/仿真/导出）包成 6-10 个工具；规则版作无 key 兜底。A 是 B 的前置。
- **B｜harness.html 双壳驾驶舱**（对话流主视角新入口，共享 `src/`，不动 index.html 现有门禁）。
- **C｜微内核+本地桥**：不立项。

## 六、请回答的三问（自包含，无需仓库上下文）

**Q1｜Web 合流最小方案设计。** 约束：纯静态页（GitHub Pages，无后端）；工具契约须与 CLI
`tools.schema.json` 单源对齐（43 条回归不重建）；无 key 时规则版兜底且行为不回归（现有
`nl_agent` 门 48 项）；治理不回退（联合算力预算/写写冲突拒绝语义须带到浏览器面）。请给出：
provider 浏览器子集设计（fetch 流式/超时/错误分类）、ToolRegistry 与 CLI schema 的单源策略、
门禁锚增补清单。

**Q2｜微内核反方质询。** 在单人维护、48 门锚定、零后端定位下，"Everything is a Plugin"
相比"模块边界+双壳"具体多付出什么、换来什么？请给**可证伪判据**：出现什么信号（如第 N 个
异构仿真域接入、多人协作）才值得升级插件协议？

**Q3｜双壳不回退移动端。** index.html 刚完成移动端 IA 改造（批次三）。harness.html 的
三栏/双栏布局在 ≤980px 下如何降级才不回退已交付的移动端体验？

---

*归档：collab/gemini/（Gemini 通道惯例：无仓库上下文、出题自包含）。咨询参照系=deepseek-harness 开源 Agent 平台（借鉴对象，非对话方）；裁定权在用户；分歧以仓库实测为准。*
