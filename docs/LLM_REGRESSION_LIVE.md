# 真实模型回归（glm-5.3-flash）· 多轮

> **2026-09-24** · Zhipu OpenAI 兼容端点 · 37 条 dry-run  
> 样本量：n≥2；**不得**称确定性。

## C3 缓解后（SYSTEM 提示：容器≠验证意图）

| 轮 | 战绩 | C3 |
|---|---|---|
| R-a | **37/37** | ✓ tpms_mesh |
| R-b | **37/37** | ✓ tpms_mesh |
| R-c | **37/37** | ✓ tpms_mesh |

**C3 cylinder：缓解后 0 次工具选错。**

## 缓解前

| 轮 | 战绩 | 备注 |
|---|---|---|
| R1（E1 判定修正前） | 35/37 | C3 选 design_verify；E1 误记 FAIL |
| R2（E1 修正后） | 37/37 | C3 仍偶发抖动 |

## 稳定结论

- E1 路径穿越：删除非法 `out` = 净化（零非法路径）
- E2/E3：自钳制/净化
- G1–G3：稳定 `tpms_design_verify`
- **C3**：提示层修复后稳定 `tpms_mesh`

## 复现（key 不入库）

```bash
TPMS_LLM_API_KEY=*** TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
  node tpms/agent/llm_regression.mjs --model glm-5.3-flash
```
