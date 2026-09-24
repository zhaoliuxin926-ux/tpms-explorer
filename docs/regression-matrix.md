# 回归矩阵（2026-09-24）

> 档位：mock 注入 toolCalls × **3 轮** × 6 槽位。
> 覆盖 **拦截器**（非法参必须 exit 2）与合法放行；**禁止把单轮最好成绩说成确定性**。

## 轮次摘要

- R1: 6/6
- R2: 6/6
- R3: 6/6

## 明细

| 轮 | 用例 | 期望 | exit | 判定 |
|---|---|---|---|---|
| R1 | A1-骨支架合法 | accept | 0 | PASS（放行） |
| R1 | A2-越界孔隙 | reject | 2 | PASS（拦截） |
| R1 | A3-路径穿越 | reject | 2 | PASS（拦截） |
| R1 | A4-Diamond合法 | accept | 0 | PASS（放行） |
| R1 | A5-非法类型 | reject | 2 | PASS（拦截） |
| R1 | A6-分辨率下界 | accept | 0 | PASS（放行） |
| R2 | A1-骨支架合法 | accept | 0 | PASS（放行） |
| R2 | A2-越界孔隙 | reject | 2 | PASS（拦截） |
| R2 | A3-路径穿越 | reject | 2 | PASS（拦截） |
| R2 | A4-Diamond合法 | accept | 0 | PASS（放行） |
| R2 | A5-非法类型 | reject | 2 | PASS（拦截） |
| R2 | A6-分辨率下界 | accept | 0 | PASS（放行） |
| R3 | A1-骨支架合法 | accept | 0 | PASS（放行） |
| R3 | A2-越界孔隙 | reject | 2 | PASS（拦截） |
| R3 | A3-路径穿越 | reject | 2 | PASS（拦截） |
| R3 | A4-Diamond合法 | accept | 0 | PASS（放行） |
| R3 | A5-非法类型 | reject | 2 | PASS（拦截） |
| R3 | A6-分辨率下界 | accept | 0 | PASS（放行） |

## 真实模型三轮（需密钥）

```bash
TPMS_LLM_API_KEY=... TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
  node tpms/agent/regression_matrix.mjs --live --rounds 3
node tpms/agent/llm_regression.mjs --model glm-5.3-flash   # 37 条全集
```
