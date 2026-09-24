# 文献带 vs 平台 · 一键偏差卡

> 产品 **v1.0.3** · 与 `BENCHMARKS.md`「与文献实验数据的对照」同源  
> 复现：`node tpms/agent/lit-band-card.mjs`（默认孔隙率 60%）  
> **口径**：Gibson–Ashby 解析工程估算，**非 FEA**；打印件绝对值受工艺缺陷影响低于解析预测。

## 默认档（C1=0.38, C2=0.3, 孔隙率 60%）

| 量 | 平台 | 文献带 | 判定 |
|---|---|---|---|
| E* 标度指数 n | 2 | 1.5–2.5 | 带内 |
| C1 标定带 | 0.38 | 0.35–0.44 | 带内 |
| C1 打印开孔带 | 0.38 | 0.1–1 | 带内 |
| σ* 标度指数 | 1.5 | 1.5（经典） | 一致 |
| C2 | 0.3 | 0.23–0.3 | 带内 |

## 文献锚

- Gibson & Ashby《Cellular Solids》（`gibson1997cellular`）
- Maskery et al. 2018, *Polymer*（标度拟合）

## 一键命令

```bash
node tpms/agent/lit-band-card.mjs --porosity 0.6 --c1 0.38 --c2 0.3
```

## 边界

见 [HONESTY_BOUNDARIES](HONESTY_BOUNDARIES.md)；scenario 验证报告内建同款带内/带外判定。
