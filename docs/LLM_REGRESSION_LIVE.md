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
# Coding Plan 订阅（推荐，零额外成本）：见文末 2026-10-01 节 anthropic 通道命令
```

## 2026-09-30 glm-4-flash 双轮 34/37（拦截器改动真实链路验证轮）

- **轮次 n=2**：两轮均 34 PASS / 3 FAIL，失败项完全相同（B5/B6/F2）——稳定弱项非方差。
- **失败定性（单条复现取证）**：B5=fks/fcks 一字母族名混淆（选 fks，工具/参数正确）；B6=无动词指令判成 estimate；F2=多目标只发 1 调用——**全部为 4-flash 档位模型能力边界，与历史画像（33/37）一致**。
- **本会话拦截器改动（toolCalls≤64 / hybrid pattern / Map 化 / design 裸点串封堵）真实链路零误伤**：34 条通过的参数校验/放行全部正确；**E 组对抗 4/4 两轮全 PASS**（路径穿越拒绝/越界拒绝真实有效）。
- 勿称确定性；5.3 档基线（37/37）待账户余额。

## 2026-10-01 Coding Plan 通道打通：glm-5.3 满血 37/37（Anthropic 协议 provider 新增）

- **根因链**：GLM Coding Plan 订阅额度绑定 **Anthropic 兼容通道**（open.bigmodel.cn/api/anthropic，Claude Code 类工具路径），不抵扣开放平台 paas/v4 按量通道——同 key 在 paas/v4 调 5.3 得 429/1113。
- **新增 `AnthropicCompatProvider`**（llm-provider.mjs）：/v1/messages 协议（system 顶层抽取 / tools input_schema 转换 / tool_use 块解析回 OpenAI 形——validateToolCalls 零改动）；`--provider anthropic`；回归脚本 `TPMS_REG_PROVIDER=anthropic` 切换。
- **五档矩阵（2026-10-01）**：glm-5.3 **37/37×2 轮（n=2）** · glm-5.3-flash **37/37×2 轮（n=2）** · glm-5.3-flashx 套餐未开放（429/1311）· glm-4-flash 34/37×2 轮（paas/v4 免费档，失败=族名混淆/工具判断/多目标，档位能力边界）。**M4 闭环 driver 亦在 anthropic+glm-5.3 首验通过**（首轮 verify 直接过，边界声明完整）。
- 错误处理链实证再 +2：429/1113（余额）与 429/1311（套餐权限）均被结构化捕获。
- 复现（Coding Plan）：
```bash
TPMS_REG_PROVIDER=anthropic TPMS_LLM_API_KEY=*** TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/anthropic \
  node tpms/agent/llm_regression.mjs --model glm-5.3
```

## 2026-10-01 M4 修复决策双路径真实模型首验（glm-5.3 · anthropic 通道）

此前 (viii) 节"LLM selects repairs from a bounded strategy menu + structured unreachability declarations"仅有 mock 队列证据——本轮两路径全部真实模型走通：

- **declare_unreachable 路径**：design=diamond+cylinder p0.6 R96（在案拒产域）→ verify exit 3 water_tightness → glm-5.3 在有界菜单选择 `declare_unreachable`，理由与 bugs.md 人类定案一致（"该 (曲面族,容器) 组合结构不可达、避免无效修补"）——诚实宣告而非盲目打补丁。
- **patch_design 路径**：design type=`gyr0id`（拼写错误）→ paramErrors → 选择 `patch_design {"type":"gyroid"}`，理由体现最小修补原则（仅改 type、无关参数保持原值）→ 第 2 轮 verify pass，产出 `tpms-gyroid-verified.stl`（水密）。
- 层间语义注记：resolution 200 在 verify 层被钳制直过（拦截器拒 LLM 越界输出 ≠ design 文件越界值被拒，两语义并存为设计口径）。
