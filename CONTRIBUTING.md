# 贡献指南（CONTRIBUTING）

产品版本 **v1.0.3** · 门禁说了算 · 边界诚实。

## 开发者 5 分钟

```bash
cd tpms/tpms-platform && npm install
npm run test:all          # 45 门本地全量（约 6–10 min）
node ../agent/schema_check.mjs --fast   # 30s 契约快检
```

改动后 **必跑**（秒级；命令均在**仓库根**执行）：

```bash
node tpms/.verify/docs_consistency_check.mjs
node tpms/agent/sync-publish.mjs --check
```

涉及 `docs/platform` 部署产物：`npm run build` 后同步，且 **不要** 提交 `*.map`。

## 宣称纪律

1. 功能宣称必须能指认一条跑过的命令
2. 性能/架构宣称须 grep 调用点核实
3. 数字与 `run_ci_suite` SCHEDULE / GUARD 基线冲突时以代码为准并改文档

## Issue 剧本（请按模板）

| 类型 | 用模板 | 必附 |
|---|---|---|
| 缺陷 | `bug_report.md` | 复现命令 / 参数 / 退出码 / `--json` 输出 |
| 功能 | `feature_request.md` | 场景、验收标准、是否触碰互斥矩阵 |
| 文档穿帮 | 直接 issue | 文件:行 + 原文 + 建议口径 |

## PR 检查单

- [ ] `tsc` 0 错 / 相关门禁绿
- [ ] 新宣称有断言或命令锚
- [ ] 未引入原生 `alert()`
- [ ] 用户可见文案：失败用全角「：」，省略号用 `…`
- [ ] 功能阶段标签写「原型期 vN」，产品号只写 v1.0.x

## 不要做的事

- 为拆而拆 `main.ts`、无痛点扩抽象
- 只加文档数字不加门禁
- 在未更新 SCHEDULE 时改「N 道门禁」口径
