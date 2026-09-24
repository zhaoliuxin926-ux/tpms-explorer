# 真实模型回归（glm-5.3-flash）· 多轮

> **2026-09-24** · Zhipu OpenAI 兼容端点 · 37 条 dry-run · **n≥2**
> 样本量限定：**不得**把单轮说成确定性。

## 汇总

| 轮 | 战绩 | 备注 |
|---|---|---|
| R1（E1 判定修正前） | 35/37 | C3 选错工具；E1 记 FAIL（模型删非法 out） |
| R2（完整轮） | **37/37** | E1「删除非法 out=净化」后 |
| 其他轮 | 36/37 或 37/37 | **C3 cylinder 抖动**（mesh vs design_verify） |

## 稳定结论

- E1：模型**删除非法 `out`**（零非法路径）——记「已自钳制/净化」
- E2/E3：稳定自钳制/净化
- G1–G3：稳定 `tpms_design_verify`
- **弱项：C3 cylinder 工具选择不稳定**

## 复现（key 不入库）

```bash
TPMS_LLM_API_KEY=*** TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
  node tpms/agent/llm_regression.mjs --model glm-5.3-flash
```
