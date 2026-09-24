# 你的 10 分钟（项目侧已清零）

## 1 · 转化（推荐先做）
1. GitHub → Settings → Social preview → 上传 `docs/screenshots/social-preview.png`
2. 打开 `docs/blog/publish/README.md`，掘金/知乎各粘贴一篇
3. 把 4 条链接丢回本仓任一会话 → AI 回填 README / job_narrative

## 2 · 物理闭环（有打印机时）
1. `docs/LAB_ONE_PAGER.md` 打印 `specimens/S*_r1.stl`（18 件已在 `specimens/`）
2. ISO 13314 压缩 → CSV 放 `specimens/csv/`
3. `node tpms/agent/fit-batch.mjs` → 示意报告；**正式 ISO 以工程版「试验曲线反演」复核为准**

## 3 · 模型回归（有 API key 时）
```bash
TPMS_LLM_API_KEY=... TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
  node tpms/agent/regression_matrix.mjs --live --rounds 3
```

> 仓内命令、门禁、试样、文档已齐；这三步都需要你侧输入，AI 无法替代。
