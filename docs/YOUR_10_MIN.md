# 你的 10 分钟（项目侧已清零）

## 1 · 转化（推荐先做）
1. GitHub → Settings → Social preview → 上传 `docs/screenshots/social-preview.png`
2. 打开 `docs/blog/publish/README.md`，掘金/知乎各粘贴一篇
3. 把 4 条链接丢回本仓任一会话 → AI 回填 README / job_narrative

## 2 · 物理闭环（有打印机时）
1. `docs/LAB_ONE_PAGER.md` 打印 `specimens/S*_r1.stl`（18 件已在 `specimens/`）
2. ISO 13314 压缩 → CSV 放 `specimens/csv/`
3. `node tpms/agent/fit-batch.mjs`；正式 ISO 以工程版「试验曲线反演」复核为准

## 3 · 模型回归 —— ✅ 已完成（2026-09-24 首轮，2026-10-05 刷新）
- **glm-5.3-flash 双轮：40/40×2（n=2）**；**勿称确定性**；端点×模型矩阵 6/6 在案
- 稳定：路径穿越删非法 `out`、越界自钳制、G 组闭环；历史弱项 C3 cylinder 工具选择抖动已缓解（37 条时代记录在案）
- 明细：`docs/LLM_REGRESSION_LIVE.md`；key **未入库**

> 仓内命令、门禁、32 件试样（含 strut 对照组）、文档、真实模型回归已齐。剩余两步（转化 / 上机）仍需你侧。
> 虚拟标定闭环（合成曲线，**非实机**）：`node tpms/agent/virtual-calibration.mjs` → `docs/VIRTUAL_CALIBRATION.md`
