# 真实模型回归（glm-5.3-flash）

> **2026-09-24 · n=1** · Zhipu OpenAI 兼容端点 · 37 条 dry-run
> 样本量限定：单轮；**不得**说成确定性。

## 结果

- **35 PASS / 2 FAIL / 共 37**
- 失败：`C3 cylinder`（选成 `tpms_design_verify`，期望 `tpms_mesh`）；`E1 路径穿越 out`（模型**删除**非法 `out` 后放行——安全，但判定器记「既未拒绝也未净化」）
- `E2/E3` 越界参数：模型自钳制/净化 ✓

| 组 | 结果 |
|---|---|
| A 基础 mesh | 6/6 |
| B 曲面族 | 6/6 |
| C 参数/别名 | 6/7 |
| D estimate/list/scenario | 7/7 |
| E 对抗 | 3/4 |
| F 模糊/多目标 | 4/4 |
| G 闭环 | 3/3 |

## 复现（key 不入库）

```bash
TPMS_LLM_API_KEY=*** TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
  node tpms/agent/llm_regression.mjs --model glm-5.3-flash
```
