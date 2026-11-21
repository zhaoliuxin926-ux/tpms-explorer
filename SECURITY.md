# 安全策略（Security Policy）

> **EN summary**: This is a fully client-side personal project (no backend, no telemetry). Please report vulnerabilities privately via GitHub *Security → Report a vulnerability* — do not open public issues. Response target: acknowledge ≤72h, assessment ≤14d. Security-relevant surfaces: the LLM tool-call interceptor (`tpms/agent/llm-provider.mjs`), the custom-equation AST sandbox, and the local-only dev static server.

## 支持版本

| 版本 | 支持状态 |
|---|---|
| v1.0.x（main） | ✅ 仅收安全/一致性修复 |
| v9.x 及更早原型期 | ❌ 已冻结，请升级到 main |

## 报告漏洞

**请勿用公开 Issue 报告安全漏洞。**

1. 优先：GitHub 私密安全报告（Security → Report a vulnerability）
2. 备选：Issue 模板「bug_report」并明确标注 `security` 前缀（仅当内容可公开）

请附：影响面（CLI / 教学版 / 工程版）、复现步骤或输入样例、期望行为。

## 响应目标

- 确认：72 小时内
- 修复或缓解评估：14 天内
- 修复发布：随下一个 patch（涉及 Agent 拦截器/路径狱/沙箱逃逸类的加速处理）

## 范围说明

本项目安全面集中在：

- **LLM Agent 拦截器**（`tpms/agent/llm-provider.mjs`）：越界拒绝、路径穿越、未知属性/工具、工具名形状（原型链键）
- **Agent 执行映射**（`tpms/agent/llm-agent.mjs` / `tpms-driver.mjs`）与 CLI 落盘约束（`tpms/agent/tpms.mjs` 的 out 槽位）
- **自定义公式沙箱**（`tpms/tpms-platform/src/core/equation-parser.ts`：AST+AD，拒副作用/原型链/求值成本放大）与公式入口（`url-params.ts`）
- **浏览器单文件版**（`docs/app.html`，纯本地运行）
- **静态服务器**（`tpms/.verify/static-server.mjs`，仅限本地门禁用，不作生产部署）

浏览器单文件版为纯本地运行（无后端、无遥测）；API key 一律走环境变量，不入库。

## BYO API key 存储口径（工程版，2026-11-21 外裁定案）

工程版浏览器 BYO key：默认 `sessionStorage`（关标签页即销毁）+ 显式勾选「记住」才落 `localStorage` + 取消勾选再保存即清除；key 不进分享链接/设计文件/任何导出产物（结构级门禁在案）。经外部评审裁定（2026-11-21，见 `collab/gemini/2026-11-21-fp-audit-consult-reply.md` 卡 B）：WebCrypto 加密存储在同源脚本面前为假阳性安全，本方案为纯前端零后端约束下的工程最优解。**残余暴露面**：`username.github.io` 下多仓库共享同源——在意者可将本项目 Fork 后绑定独立自定义域名获得独立 Origin 隔离（低成本、零代码）。
