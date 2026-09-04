---
name: Bug report
about: Report a reproducible problem in the TPMS explorer or CLI
title: ''
labels: bug
assignees: ''
---

**Edition** (single-file `docs/` / engineering `tpms-platform/` / CLI `tpms/agent/`):

**What happened**:

**Steps to reproduce** (parameters, URL, or CLI command):

**Expected behaviour**:

**Evidence** (screenshot / console output / gate `RESULT` line):

**Environment** (OS / browser / Node version):

---

> 提交前自检 / Before submitting:
> - 改过公式或导出逻辑？先跑 `cd tpms/tpms-platform && node ../.verify/parity_math.mjs`
> - Changed formulas or export logic? Run `parity_math.mjs` first.
> - 孔隙率问题请附 `--porosity-solver exact --json` 的完整 JSON（含 `porosityTrace`）。
