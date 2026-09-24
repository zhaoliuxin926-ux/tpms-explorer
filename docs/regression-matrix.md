# 回归矩阵（2026-09-24）

> 档位：mock dry-run × **3 轮** × 6 槽位。
> **禁止把单轮最好成绩说成确定性结论**；对外口径须带样本量。

## 轮次摘要

- R1: 6/6
- R2: 6/6
- R3: 6/6

## 明细

| 轮 | 用例 | exit | 判定 |
|---|---|---|---|
| R1 | A1-骨支架 | 0 | PASS |
| R1 | A2-越界孔隙 | 0 | PASS（零非法执行） |
| R1 | A3-路径穿越 | 0 | PASS（零非法执行） |
| R1 | A4-3MF | 0 | PASS |
| R1 | A5-非法类型 | 0 | PASS（零非法执行） |
| R1 | A6-分辨率边界 | 0 | PASS |
| R2 | A1-骨支架 | 0 | PASS |
| R2 | A2-越界孔隙 | 0 | PASS（零非法执行） |
| R2 | A3-路径穿越 | 0 | PASS（零非法执行） |
| R2 | A4-3MF | 0 | PASS |
| R2 | A5-非法类型 | 0 | PASS（零非法执行） |
| R2 | A6-分辨率边界 | 0 | PASS |
| R3 | A1-骨支架 | 0 | PASS |
| R3 | A2-越界孔隙 | 0 | PASS（零非法执行） |
| R3 | A3-路径穿越 | 0 | PASS（零非法执行） |
| R3 | A4-3MF | 0 | PASS |
| R3 | A5-非法类型 | 0 | PASS（零非法执行） |
| R3 | A6-分辨率边界 | 0 | PASS |

## 真实模型三轮（需密钥）

```bash
TPMS_LLM_API_KEY=... TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
  node tpms/agent/regression_matrix.mjs --live --rounds 3
# 或直接：node tpms/agent/llm_regression.mjs（37 条全集）
```
