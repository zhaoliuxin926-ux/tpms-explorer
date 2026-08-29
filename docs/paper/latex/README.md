# LaTeX 手稿包（SoftwareX / JOSS 投稿口径）

TPMS Explorer v7.0.0-generative-biophysics 学术投稿资产。

## 文件

| 文件 | 说明 |
|---|---|
| `main.tex` | 正文（elsarticle 5p 双栏口径；SoftwareX 风格 Impact/Necessary resources/Method design/Quality control/Availability 结构） |
| `references.bib` | 参考文献（SIREN、Hill-48、Tsai-Wu、Gurson、Born–von Kármán、F&H EDT、Osher–Sethian、水平集拓扑优化、Gibson–Ashby 等） |
| `figures/` | 矢量图表位（正文以 TikZ/表格为主，渲染截图建议从平台导出 SVG/PNG 后置入） |

## 编译

```bash
pdflatex main && bibtex main && pdflatex main && pdflatex main
```

依赖：TeX Live / MiKTeX（elsarticle 属标准发行版）。无私有宏包。

## 诚实声明

- 手稿中所有数值断言（周期偏差 2.16e-15、RMSE 带、声速比 2.2%、质量守恒 0.000%、κ 增益 ×1.50 等）均对应 `.verify/` 门禁断言，可由 `npm run test:all` 复现；
- 各模块的「诚实边界」（点阵模型近似、路径禁带口径、连续介质单尺度、界面敏感度代理等）随正文相应小节披露；
- 匿名口径：作者栏留空（投稿时按期刊要求填写）。
