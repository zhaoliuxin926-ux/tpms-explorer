# 求职素材包：TPMS Explorer 项目（AI 应用开发岗对齐版）

> 自用素材，不进站点导航。三个部分：①简历项目描述（中英，两档长度）②面试深挖问题+回答弹药（全部来自真实工程实录，附证据锚点）③口述脚本（2 分钟版/5 分钟版）。
> 使用原则：**只讲能被追问三层的故事**——下面每个弹药都标了证据位置，讲之前先跑一遍命令确认数字仍是当前值。

---

## 一、简历项目描述

### 中文 · 一段版（简历主项目栏）

**TPMS Explorer — 浏览器端三维曲面设计平台 + LLM Agent 闭环**（个人项目，2026.08–至今）

用 TypeScript/three.js 从零构建三周期极小曲面（TPMS）生成式设计平台：24 族解析曲面、实时 WebGL 渲染、一键交付水密 STL / Abaqus / OpenFOAM 工业文件；为平台构建 LLM Agent 闭环——自然语言直达水密 STL（智谱 GLM 四档模型回归 37/37），核心是自研 tool-calling 安全层：JSON Schema 逐槽位钳制拦截器 + 106 断言契约对拍门禁 + 退出码分层契约。全仓 44 道 CI 门禁（1000+ 断言、三平台矩阵），4 轮独立红队 0 Critical 收官。

### 中文 · 两句版（多项目简历/一句话场合）

为科研级几何平台自建 LLM Agent 安全层（schema 钳制拦截器/契约对拍门禁/有界修复闭环，四模型对抗零透传），并配套 44 道 CI 门禁的验证体系——理念：LLM 产出按不可信输入处理，确定性代码守住交付物。技术叙事见博客《44 道门禁》《LLM Agent 的安全架构实录》。

### English · one-paragraph (for English resume)

**TPMS Explorer — Browser-based TPMS design platform with an LLM agent loop** (solo project, Aug 2026 – present). Built a generative-design platform for triply periodic minimal surfaces (24 analytical families, real-time WebGL, watertight STL / Abaqus / OpenFOAM export) in TypeScript + three.js, plus an LLM agent that turns natural language into watertight STL (37/37 on a 4-model GLM regression). Core contribution: a tool-calling safety layer — per-slot JSON-Schema clamping interceptor, a 106-assertion contract-parity gate, and exit-code-tiered rejection semantics — inside a 44-gate, 1000+-assertion, 3-platform CI matrix.

---

## 二、面试深挖弹药（按被问概率排序）

### Q1 "LLM 应用怎么保证不乱来？"（必问，主线故事）

要点链：**LLM 产出 = 不可信用户输入** → tool call 逐槽位过 schema 钳制（enum/min/max/未知属性/未知工具/缺必填，任一命中 exit 2 不达执行层）→ schema 与 CLI 实际校验由 106 断言门禁逐项对拍（防两份清单漂移）→ 真机回归分三层语义：拦截器保证"错的不执行"（确定性）、37 条回归保证"好的能通过"（统计性）、对抗指令四模型零透传。
杀手锏补充：**红队六洞**——路径穿越正则首字符放行整串 `..`；崩溃被错误处理包装成"结构化拒绝"（语义污染）；校验函数存在但不在执行路径（校验死代码）；同一槽位两份 schema 口径分裂致链路死锁；`in` 原型链键误判（应 `Object.hasOwn`）；JSON 解析失败分支曾 exit 0。**没有一条是 LLM 骗过了系统，全是确定性代码自己的缝**——LLM 只是高频模糊测试器。
证据：`node tpms/agent/llm_provider_selftest.mjs`（33 断言离线可跑）+ 博客二。

### Q2 "最难的 bug 是什么？"（讲这个：SDF 顶点区距离反转）

故事：任意解剖流形保形填充功能里，点到三角形距离函数（Ericson《Real-Time Collision Detection》标准实现）B 顶点区条件写反（`d4≤d3` 误为 `d3≤d4`）——越界到 B 外侧时返回查询点自身，远壁距离被低估（0.72→0.34）。两种独立加速结构（BVH 与暴力）**同错**，因为共享同一个原语——**对拍失效的经典形态：两条路径同源，对拍无意义**。破案签名："比顶点级暴力下界还近"在物理上不可能。修复后远壁距离 0.34→0.72 全链一致。
引申观点：单元测试过 ≠ 实现对——参考实现也要先被质疑；**共享原语的对拍是假对拍**。

### Q3 "性能优化做过什么？"（三个有数字的）

1. 自写静态服务器无 gzip：公网首屏 5–7s，静态资源 gzip 后体积显著下降（当前构建实测约 353KB gzip 量级，历史优化记录 624KB→约 160KB 为更早构建口径，面试引用请以现测为准），首屏回到 1s 内。
2. 瓦片预烘焙：Canvas `drawImage` 每帧 400 次→启动烘焙 25 次/帧，预算断言 ≤80 进 CI。
3. Boids 类项目沉淀的 SoA+counting-sort 思路迁移：2000 个体 5.6ms/步（若被问泛化能力）。

### Q4 "CI 怎么组织的？跨平台踩过什么坑？"

44 道门禁三平台矩阵（Ubuntu/Windows/macOS），1000+ 断言。核心机制：行为级断言（rolldown 把真实 TS 源码打包进测试进程，禁 mock 数学）、最小断言数守卫（防"断言集体跳过仍绿灯"）、fail-closed 交付门（水密三硬指标任一非零拒产 STL）。
跨平台坑实录（挑两个讲）：win32 假设六层剥离（.cmd shim/路径分隔符/chromePath/swiftshader/404 形态/python 漂移+CRLF）；"本地假绿"三形态——改 UI 不重建部署目录=CI 测旧站；分支 workflow 只在 main 触发=长活分支 21 提交零次真 CI 无人发现。
证据：博客一 + `npm run test:all`。

### Q5 "为什么自己写门禁，不用现成测试框架？"（理念题）

不是不用（playwright/node:test 都在用），而是**门禁的产品定义**：断言对象是"用户拿到的交付物行为"而非"代码单元"。举例：STL 交付门禁会**独立读回二进制字节**复核顶点配对，不复用生成器的自检代码——因为最贵的事故就是复刻品与真品漂移（查表版 diamond 公式差一个符号，2 万点 maxDiff 2.91，屏幕所见与导出物是两张曲面）。

### Q6 "AI 怎么用在工作流里？"（诚实版）

AI 结对为主力（生成/重构/探针），但配套两条纪律：**功能宣称必须指认一条跑过的命令**（曾抓出 CLI 假实装——补丁静默失败+门禁不覆盖该 flag 路径）；**性能/架构属性宣称须 grep 调用点核实**（"Worker 异步执行"实为主线程同步）。AI 也当红队——四轮独立红队 5C+20M+0C 收官，其中"空输出恒真断言"（vertCount=0 三断言零迭代全绿）就是变异测试实证抓出的。

### Q7 领域题备胎（材料背景加分项）

- 为什么 TPMS 适合骨支架：孔隙连通（营养输送）、比表面积、Gibson-Ashby 标度律 ρ̄² 可解析预测力学响应。
- 目标孔隙率 vs 实测偏差：iso 二分格点分位与发散体积口径差，随分辨率收敛（R48 5.4pp→R96 1.0pp），CLI 如实披露双口径——**不粉饰口径差本身就是可信度卖点**。
- 24 族曲线怎么来的：经典文献解析式 + CC BY 数据集 Fourier fit 逐字转录，四方同源（TS/Python/MATLAB/GPU IR）对拍位级一致。

---

## 三、口述脚本

### 2 分钟版（开场自我介绍后）

"我最重要的个人项目是 TPMS Explorer——一个浏览器端的三维曲面设计平台，面向骨支架和增材制造场景：24 族解析曲面，实时渲染，一键交付可打印的水密 STL 和 Abaqus/OpenFOAM 文件。工程上两条主线：一是**验证体系**，44 道 CI 门禁、三平台、1000 多条断言，核心是行为级断言和 fail-closed 交付门；二是 **LLM Agent 闭环**——自然语言一句话直达水密 STL，四档真实模型回归 37/37。Agent 这条线我最有心得的是安全问题：LLM 产出按不可信输入处理，自研了 schema 逐槽位钳制拦截器和 106 断言契约对拍门禁，独立红队打了两轮，抓出六个真实漏洞全部修复，零 Critical 收官。整个过程写成两篇技术博客，每条宣称都带复现命令。"

### 5 分钟版追加（按面试官兴趣展开）

- 问工程细节 → Q1 红队六洞（可白板画拦截器位置）
- 问 debug 能力 → Q2 SDF 条件反转（"共享原语对拍是假对拍"金句收尾）
- 问 DevOps → Q4 三平台矩阵 + 本地假绿三形态
- 问业务感 → Q7 口径差披露（"科研工具交付错误几何比不交付更贵——一个不水密的骨支架 STL 浪费一周打印时间"）

---

## 四、证据锚点速查（面试前刷新数字用）

```bash
npm run test:all                          # 44 门全量（三平台）
node tpms/agent/schema_check.mjs          # 106 断言
node tpms/agent/selftest.mjs              # 49 断言
node tpms/agent/llm_provider_selftest.mjs # 33 断言（离线）
node tpms/agent/tpms.mjs list --json      # 24 族
```

博客：《44 道门禁》`docs/blog/2026-09-16-44-gates.md` ｜ Agent 架构 `docs/blog/2026-09-17-agent-architecture.md`。
