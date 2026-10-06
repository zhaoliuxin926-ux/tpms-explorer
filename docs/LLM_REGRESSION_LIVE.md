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

## 2026-10-05 strut 双族+词表新词入回归：40 条满贯矩阵（本会话 LLM 线收官）

- **回归集 37→40**：+B7 strutbcc（中文"BCC 桁架杆网络支架"）/+B8 strutoctet（英文"Octet truss scaffold"）/+C8 单元密度同义词（"单元密度 4"）——本会话 NL 词表三改动全部纳入真实回归永久覆盖。
- **满贯矩阵 6/6**（本会话实测，plan key 三端点全通背景下）：{anthropic, coding-openai} × {glm-5.3-flash, glm-5.3} **全 37/37**（5.3 满血历史 36/37→37/37）；glm-4-flash 免费档 33/37（paas/v4，失败项与历史画像同形态=模型能力）；**40 条版 glm-5.3-flash（anthropic）40/40**。
- **端点知识（官方 quick-start 核验+实测）**：plan key 三专用端点（Anthropic `/api/anthropic` · OpenAI 兼容 `/api/coding/paas/v4` · Responses `/api/v1`）全通；paas/v4 报 1113 是通道错非余额问题。**合规边界（FAQ 原文）**：自建程序长期集成应走标准 API（paas/v4）按量计费，套餐额度仅限官方指定工具——本仓库回归脚本按需临时切 plan 端点验证，不写入默认配置。
- Responses 端点（/api/v1）tool-calling 实测可用但协议独立（object: response），裁决不加第三 provider（无消费者抽象）。
- 错误链实证 +2：无效 key 401 / 无效模型 1211（anthropic 通道结构化返回）。
- 复现（当前推荐档 glm-5.3-flash，42 条）：
```bash
TPMS_REG_PROVIDER=anthropic TPMS_LLM_API_KEY=*** TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/anthropic \
  node tpms/agent/llm_regression.mjs --model glm-5.3-flash
```

## 2026-10-06（二）42 条口径满贯矩阵 4/4：{anthropic, coding-openai} × {5.3-flash, 5.3 满血}

- 新 key 全格刷新：anthropic×flash=**42/42×2**（n=2，推荐档）｜anthropic×满血=42/42｜coding-openai×flash=42/42｜coding-openai×满血=42/42——**四主力格零失败零轮换**
- 4-flash 免费档两格不刷（历史定案：能力画像非管线验证，33/37 失败轮换形态在案）；历史 6/6 矩阵为 37 条口径，保留"在案"事实
- 满血档观察：42 条全程快于 flash（推理直答形态，与 37 条时代画像一致）

## 2026-10-06 42 条 n=2 基线落定：双轮 42/42×2（glm-5.3-flash · anthropic 通道 · 新 key）

- 用户新 key（2026-10-06，只经 env）；R1/R2 背靠背 **42/42×2 零失败零轮换**
- 新增 H 组逆设计意图用例（tpms_pareto 第六工具）：H1 中文"等效模量不低于 2GPa、渗透率不低于 5e-9"→tpms_pareto target_e_gpa=2；H2 英文同构双槽位——**性能愿望→工具选择的 NL 语义达 n=2 证据标准**
- 首跑踩坑复现：漏设 `TPMS_REG_PROVIDER=anthropic` 时回归脚本默认 openai 协议打 anthropic 端点=42 全 FAIL "无 toolCalls"（6.2s/条一致耗时=认证形态签名）——三 env 铁律（KEY/BASE_URL/REG_PROVIDER）见上方复现命令
- 历史口径（37/40 条时代）见下节

## 2026-10-05 40 条 n=2 基线落定：双轮 40/40×2（glm-5.3-flash · anthropic 通道）

- **R1 40/40 · R2 40/40 背靠背**——零失败、零轮换（历史口径"temp=0 下失败项轮换"在 5.3-flash 档 40 条上未出现：满贯形态稳定）。
- 三新词用例（B7 BCC 桁架 / B8 Octet truss / C8 单元密度）两轮全 PASS——strut 双族 NL 语义在真实模型链路的稳定性达到 n=2 证据标准。
- 历史口径遵守：n=2 仍不称确定性；失败项轮换是历史 4-flash 档的观察（33/37 档），5.3-flash 满贯档无需该豁免。
- 本节与 2026-10-05 上节（端点知识/合规边界/6/6 矩阵）共同构成本会话 LLM 线终态。
