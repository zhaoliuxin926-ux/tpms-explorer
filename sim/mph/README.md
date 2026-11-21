# sim/mph — COMSOL MPh 配方与动量审计范式（2026-11-21 收编）

T4 流体弧（K 双口径 0.4% 互证 + 真 Forchheimer β≈500-583 + WSS 窗口 29.4% 终判）的两件可复现配方，原在 `working/scratch/`（gitignored 试错区，仅宿舍机可见）。2026-11-21 同步审计发现跨机引用悬空——progress.md 以 tracked 文件引用 untracked 路径，工位机拿不到。收编入库：

| 文件 | 用途 | 口径依据 |
|---|---|---|
| `mph_t4_fluid.py` | COMSOL 6.2 MPh 批式流体求解（T3 口径复制：L=4.0mm/eps=0.70106/μ=0.00089 Pa·s，BC 值作 Darcy 速度，K=μ·v_in·L/ΔP） | [cfd-wss-window-caliber.md](../../docs/cfd-wss-window-caliber.md) |
| [momentum_audit.py](../cfd/momentum_audit.py) | OpenFOAM polyMesh 侧动量守恒审计（控制体=流体入口面 9.679 mm²，闭合度 103.6% 终审范式） | bugs.md 深夜 VII 段 |

## 运行前提

- COMSOL 6.2 + MPh（`pip install mph`）；OpenFOAM v13 case 已跑完（WSL）。
- STL 输入 `sim/out/rve_real_fix/*_labeled.stl` 为 p3 管线再生件（sim/out gitignored，缺则先跑 p3）。
- 脚本内绝对路径为宿舍机布局（D:\GITHUB\tpms\...），跨机按本目录相对布局替换。
- 运行结果落 `sim/out/`（gitignored，可再生）。

## 相关

- T4 弧结论与窗口口径披露：[docs/cfd-wss-window-caliber.md](../../docs/cfd-wss-window-caliber.md)
- 标定权威文档：[docs/cfd-calibration.md](../../docs/cfd-calibration.md)
