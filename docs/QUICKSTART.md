# 快速开始 · 最短出件路径

> 产品版本 **v1.2.0**。四条最短路径，任选其一；命令均在仓库根执行。

## Demo 1 · 网页点选（最短）

1. 打开 [工程版](https://zhaoliuxin926-ux.github.io/tpms-explorer/platform/)（或本地 `cd tpms/tpms-platform && npm install && npm run dev`）
2. 侧栏「应用场景预设」→ **仿生骨支架**（一键 Gyroid 75%）
3. 视口右下 **导出中心 → STL 网格** → 得到可切片 STL

## Demo 2 · CLI 一行（可脚本化）

```bash
node tpms/agent/tpms.mjs mesh --type gyroid --porosity 0.75 --resolution 64 --periods 4 --out demo.stl
```

成功即水密三硬指标全过（否则 fail-closed 不落盘）。再要打印路径：

```bash
# 导出中心 UI 亦可；CLI 切片引擎（单壁+扫描填充，非工业全特征）
# 见工程版侧栏「G-code 工艺」参数后从导出中心导出
```

## Demo 3 · 逆设计一行（性能愿望 → 设计参数，v9.3.0+）

```bash
node tpms/agent/tpms.mjs pareto --target-e 2 --target-k 5
# "我要 E≥2GPa 且渗透率≥5×10⁻⁹ m²" → 26 族 832 点 Pareto 前沿 → top-3 设计
# 目标可达给最小超标达标点；不可达给最近妥协+log10 距离。确认后走 Demo 2 构建首推荐。
```

## Demo 4 · Agent 会话两步走（推荐 → 跨进程指代构建，2026-10-11+）

```bash
node tpms/agent/llm-agent.mjs --provider anthropic --session work.json "推荐 E≥2GPa 且渗透率≥5e-9 的支架"
node tpms/agent/llm-agent.mjs --session work.json "把第一个构建出来"
# 第二条不调用模型：指代被确定性绑定到会话推荐集的具体候选（type/porosity/periods
# 直读），STL 落在会话文件旁；越界/歧义/会话损坏/几何语义版本变化→exit2 结构化拒绝。
# 代理口径（解析近似非 FE）随候选快照落盘。key 走 TPMS_LLM_* env，绝不入会话文件。
```

## Demo 5 · 一步到位管线（推荐→构建→验收→可打印性，2026-10-11+）

```bash
node tpms/agent/agent-pipeline.mjs --target-e 2 --target-k 5
# 确定性串联 tpms_pareto → 候选选取（水密门失败按修复预算顺延）→ tpms_mesh（R96 水密验收）
# → overhang 悬垂审计；输出 pipeline-report.json（每步输入/输出/产物/预算用量，
# 代理推荐/网格验收/物理可打印性三层口径分开）。预算耗尽 exit4 如实报告已完成步骤；
# 全候选拒产 exit3 fail-closed。LLM 编排轮见 llm-agent --max-rounds N。
```

## Demo 6 · 自然语言 Agent（dry-run 不落盘；真实导出见 Demo 1/2）

```bash
node tpms/agent/llm-agent.mjs --provider mock --dry-run --json "孔隙率 75% 的 Gyroid 骨支架"
# 真实模型（智谱走 OpenAI 兼容）：--provider openai --model glm-5.3-flash（TPMS_LLM_* 见 tpms/README）
```

## 验收自检（约 1 分钟）

```bash
node tpms/agent/schema_check.mjs --fast
node tpms/agent/regression_matrix.mjs --rounds 3
node tpms/agent/gen-boundary-table.mjs --check
node tpms/agent/lit-band-card.mjs
node tpms/.verify/docs_consistency_check.mjs
node tpms/agent/sync-publish.mjs --check
```

## 进阶 · 设计→检查→交付完整闭环（2026-10+）

工程版侧栏顶部的**交付任务流**把全流程串成五步：每步一键直达对应面板，状态徽章标进度
（✓ 已完成 · ! 设计变更后结果过期需重做）。

1. **① 设计试样**：族/孔隙率/单胞；进阶「试样总宽 (mm)」可显式设定交付尺度（自动=1 周期 1mm；Pareto/逆设计采用候选时自动写入 3×单胞，性能预测在最终尺度成立）。
2. **② 比较候选**：Pareto 前沿点击采用 → 参数写回主界面（尺寸契约自动换算）。
3. **③ 制造几何检查**：壁厚/孔喉/封闭腔体素级审计（基础均匀多孔段口径；混合/渐变/端板等配置开启时会 fail-closed 拒绝——不静默审计与交付不符的几何）。
4. **④ 导出交付**：**交付包** = 一份 ZIP（design.json 完整设计 + 水密 STL + manifest 哈希链），换电脑可复现、同名导出带时间戳；网格未过水密审计会硬拒不落盘。
5. **⑤ 试验分析**：试验机 CSV 拖入反演——位移-载荷模式请按 [协议 §六](../PHYSICAL_TESTING_PROTOCOL.md) 模板加 `# lengthMm/widthMm/thicknessMm` 元数据行，**L₀/A₀ 自动预填**（越档有 ⚠ 兜底）。

**设计保存/复现**：导出中心「设计文件」保存完整状态；工具栏「导入设计」为**替换式**恢复——在已编辑的页面上导入普通设计，也不会残留当前页面的端板/混合/渐变等设置；无有效载荷的文件会被拒收。

## 更多

- 完整能力与互斥约束：`docs/WORKFLOW_GUIDE.md`
- 物理试样与 ISO 13314：`PHYSICAL_TESTING_PROTOCOL.md`
- 贡献与 issue 剧本：`CONTRIBUTING.md`
