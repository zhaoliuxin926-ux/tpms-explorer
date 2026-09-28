# 安全策略（Security Policy）

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

- **LLM Agent 拦截器**（`tpms/agent/llm-provider.mjs`）：越界拒绝、路径穿越、未知属性/工具
- **自定义公式沙箱**（AST + AD，拒收副作用/原型链）
- **静态服务器**（`tpms/.verify/static-server.mjs`，仅限本地门禁用，不作生产部署）

浏览器单文件版为纯本地运行（无后端、无遥测）；API key 一律走环境变量，不入库。
