# TPMS Platform · T18 路线图打磨 — 验证报告

**日期**：2026-07-24
**目标**：将单文件版 `web/app.html` 的路线图打磨（新曲面族 / 预设 / 主题 / 导出物理对齐）迁移到工程版 `tpms/tpms-platform/`，并完成构建与端到端验证。

## 构建结果
- `cd tpms/tpms-platform && rm -rf dist && npm run build`
- `tsc` 0 错误，`vite build` 成功（41 模块，dist 已再生）
- ⚠️ Vite 8 的 safe-delete 在沙箱内 trash 失败会 fail-closed，须先 `rm -rf dist` 再 build

## 迁移内容（源码级）
| 模块 | 改动 |
|---|---|
| `tpms-functions.ts` | 新增 `lidinoid`(2 权重)、`splitp`(3 权重) 两个隐函数，并入 map，`getWeightCount` 返回 2/3 |
| `geometry/surface-nets.ts` | `useLookup` 排除新曲面（走实时 `getTpmsFunction`）；补两者解析法线梯度 |
| `types.ts` | `TpmType` 扩 `lidinoid\|splitp`；`TYPE_COLORS` 补色；`PRESET_SCENES` 补 catalyst/acoustic/electrode |
| `ui-helpers.ts` | `LABEL`/`FORMULA`/`WEIGHT_TERMS`/`updateTips`/`PRESET_TEACH` 补齐 |
| `url-params.ts` + `index.html` | type 校验补两项；新增按钮；修预存 `data-scene`→`data-preset` CSS bug；顶栏文案改「8 类曲面 · 3 种结构拓扑」 |
| `index.html` + `main.ts` | 浅/深/自动三态主题（`data-theme` + `localStorage('tpms-theme-platform')` + 刷新前预应用）；快捷键 6→8 |
| 物理/导出对齐 | `gibson-ashby`(C1/各向异性)、`pore-analysis`(PORE_FACTOR)、`bibtex-sidecar`(DOI)、`script-exporter`(Python/MATLAB 主+hybrid 共 4 处) |

## 顺手修复的预存 bug（高价值）
曲面 / 渲染模式 / 结构 / 容器 / 材质 按钮的 click handler 只调 `updateBadges` + `scheduleRebuild`，**从不调 `syncUI`**（快捷键路径却调了）。后果：点击任何曲面后激活高亮永远停在初始 gyroid，用户看不出选了哪个。已给这 5 个 handler 补 `syncUI(s)` —— 属全工程版通用修复。

## 端到端验证（Playwright + 系统 Chrome）
脚本：`tpms/.verify/check_platform.mjs`（服务器与 node 同 shell 启动）
**结果：49 / 49 PASS**

- 新曲面族：lidinoid / splitp 在 p65/75/85 均渲染（51.6k / 47.3k / 39.5k 顶点），C1 身份正确（0.37 / 0.39），无运行时报错
- 预设：catalyst→I-WP、acoustic→gyroid、electrode→neovius，教学卡均弹出且切到正确曲面族（C1 0.44 / 0.38 / 0.36）
- 主题：浅/深/自动切换写 `data-theme`、持久化 `tpms-theme-platform`、刷新后恢复

## 复用验证坑（已记入 memory 备用）
1. 服务器与 Playwright 必须同一条 Bash 命令启动，否则沙箱隔离网络命名空间导致连不上
2. `page.waitForFunction` 回调在浏览器上下文执行，不能引用 Node 作用域函数
3. 工程版 `#stat-verts` 带 `k` 后缀，解析需处理 k/M
4. 工程版主题用 `data-theme` 属性（非 `classList.contains('dark')`），旧 `check_*.mjs` 不能直接复用

## 结论
T18 路线图打磨已全量迁移到工程版并验证通过，顺带修复了激活高亮不跟随选择的预存缺陷。
