# 快速开始 · 最短出件路径

> 产品版本 **v1.0.3**。三条最短路径，任选其一；命令均在仓库根执行。

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

## Demo 3 · 自然语言 Agent（dry-run 不落盘；真实导出见 Demo 1/2）

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

## 更多

- 完整能力与互斥约束：`docs/WORKFLOW_GUIDE.md`
- 物理试样与 ISO 13314：`PHYSICAL_TESTING_PROTOCOL.md`
- 贡献与 issue 剧本：`CONTRIBUTING.md`
