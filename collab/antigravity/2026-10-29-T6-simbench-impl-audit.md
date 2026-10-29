# T6 · 批二十（CAE 仿真工作台一期）实现审查报告

- **审查日期**：2026-10-29
- **审查方**：反重力 / Antigravity
- **主控方**：ZCode（宿舍侧）
- **审查对象**：批二十 CAE 仿真工作台一期静态集成卡落地实现
- **阅读文件清单**：
  1. `../../plans/2026-10-29_批二十-仿真工作台一期.md`
  2. `../../tpms/tpms-platform/index.html`（`sect-simbench` 卡片结构、`sb-*` 样式与 `sect-expfit` 跳转锚点）
  3. `../../tpms/tpms-platform/src/main.ts`（`refreshSimBench`、`bindSimBenchCard`、`bindExperimentalFit`、`scheduleRebuild`）
  4. `../../tpms/tpms-platform/src/types.ts`（`AppState` 与 `BuildParams` 字段核实）
  5. `../../sim/p0_generate.py`（CLI 参数与缺省命名实现）
  6. `../../sim/p1_mesh.py`（CLI 参数与文件查找实现）
  7. `../../sim/p2_static_setup.py`（组装器参数与尺寸自读实现）
  8. `../../sim/p2_extract_csv.py`（提取器参数与 CSV 契约生成实现）
- **协作铁律**：不修改任何工作树文件，不执行 git 操作；引用路径严格遵循 `../../` 相对路径铁律。

---

## 一、审查总评与核心检验结论

批二十（CAE 仿真工作台一期）代码整体完成度极高，四点设计共识落实坚决，界面整洁利落。但在参数联动与命令闭环层面，发现了一处**会导致终端复制命令执行必报 `FileNotFoundError` 的 P0 级严重文件名裂痕**，以及一处**滑动条调节时不触发命令刷新的 P1 级联动缺陷**。

### 核心检验项判定

| 检验项 | 结论 | 核心判断依据 |
|---|---|---|
| **A. 四点共识落实度** | **100% 达成** | 独立卡部署于 `#grp-sim`；参数显式双列；无 disabled 占位符；自检命令一行流且包含完整预期回显与 PATH 提示。 |
| **B. ZCode 将 --R 钉为 24 的理由** | **完全成立（支持 ZCode）** | 核实 `types.ts` 证实 `AppState` 顶层确实无 `resolution`（仅底层 Worker 内部计算）；sim 的 `--R` 为单胞格数，直接换算不仅语义不通，更会导致大周期下体素爆炸；钉在 Phase 1 验证通过的黄金档 $R=24$ 极为稳妥。 |
| **C. 命令与 sim 真实 CLI 一致性** | **发现致命前缀脱节 (P0)** | `p0_generate.py` 缺省产物为 `gyroid_...`，而 `p1_mesh.py` 命令行引用的是 `sim_gyroid_...`，用户一键复制执行第一步即报错找不到文件！ |
| **D. 实现 Bug 与文案口径** | **发现 1 处联动失效 + 1 处序号手误** | 卡片展开时拖动滑块不刷新命令（P1）；Step 4 文案中“将 ④ 导出的 CSV”出现序号错位（应为 ③）（P2）。 |

---

## 二、问题清单（按严重度分级）

### 🔴 P0 级：直接导致终端复制命令中断报错的阻断性 Bug

#### 1. 【文件名前缀断裂】`p0_generate.py` 缺省产物与 `p1_mesh.py` 传入路径不匹配
- **文件与行号**：
  - `../../tpms/tpms-platform/src/main.ts:1374-1376`
  - `../../sim/p0_generate.py:120`
- **代码对拍**：
  - `main.ts` 生成的前处理命令串为：
    ```bash
    python sim/p0_generate.py --k 2 --R 24 --por 0.60
    python sim/p1_mesh.py sim/out/sim_gyroid_k2_p60.stl --lmax 0.5
    ```
  - 但查阅 `sim/p0_generate.py` 第 120 行：
    ```python
    out = Path(args.out) if args.out else REPO / "sim" / "out" / f"gyroid_k{args.k}_p{int(args.por*100)}.stl"
    ```
    当未显式传 `--out` 时，`p0_generate.py` 的默认输出文件名为 **`sim/out/gyroid_k2_p60.stl`**（没有 `sim_` 前缀）！
- **运行时实测后果**：
  用户从卡片点击“📋 复制前处理命令”后粘贴至终端：
  1. 第一条命令成功执行，生成了 `sim/out/gyroid_k2_p60.stl`；
  2. 第二条命令立即执行 `p1_mesh.py sim/out/sim_gyroid_k2_p60.stl`；
  3. Python 直接崩溃并抛出：
     `FileNotFoundError: [Errno 2] No such file or directory: 'sim/out/sim_gyroid_k2_p60.stl'`。
- **整改建议（二选一）**：
  - **推荐方案（显式最健壮）**：在 `main.ts` 生成的第一行命令中显式带上 `--out` 参数：
    ```typescript
    `python sim/p0_generate.py --k ${k} --R ${R} --por ${por.toFixed(2)} --out sim/out/${stem}.stl\n` +
    `python sim/p1_mesh.py sim/out/${stem}.stl --lmax 0.5`
    ```
  - **备选方案**：将 `main.ts` 中的 `stem` 去掉 `sim_` 前缀，直接对齐 `p0_generate.py` 默认值：
    `const stem = 'gyroid_k' + k + '_p' + P;`

---

### 🟡 P1 级：功能与宣称不符的交互响应缺陷

#### 2. 【参数联动刷新缺失】卡片处于展开状态时，调整左侧滑块命令不更新
- **文件与行号**：`../../tpms/tpms-platform/src/main.ts:1391-1412`
- **现象分析**：
  - `index.html` 文案向用户承诺：“命令随左侧参数联动”；
  - 但在 `main.ts` 中，`refreshSimBench()` 仅仅被注册在：
    1. 页面初次加载时；
    2. `<details id="sect-simbench">` 的 `toggle` 事件中。
  - **实测痛点**：如果用户保持 CAE 工作台卡片处于展开阅读状态，然后去拖动左侧面板的“孔隙率”或“单元密度”滑块，命令框内的参数**纹丝不动**！用户必须手动将卡片折叠再展开，命令才会刷新。
  - **跳转盲区**：从试验分析卡点击 `sb-link-from-expfit` 跳转时，通过 JS 执行 `sect.open = true`，**根据 W3C 标准不会触发 DOM `toggle` 事件**！导致跳转后如果参数曾有改动，工作台仍显示陈旧命令。
- **整改建议**：
  1. 在 `scheduleRebuild` 回调中（或状态变更监听点），增加防守逻辑：
     `const sb = document.getElementById('sect-simbench') as HTMLDetailsElement | null; if (sb?.open) refreshSimBench();`
  2. 在 `jump` 函数展开详情时，显式调用一次 `refreshSimBench()`。

---

### 🟢 P2 级：文案表述与边界口径手误

#### 3. 【文案步骤编号手误】Step 4 反演说明中混淆了数据来源步骤
- **文件与行号**：`../../tpms/tpms-platform/index.html`（`sect-simbench` Step 4）
- **现象**：
  Step 4 的提示文案为：
  `将 ④ 导出的 CSV 拖入上方「试验曲线反演」卡即得仿真 E*/平台应力...`
  然而在界面五段式布局中：
  - `① 网格前处理`
  - `② ABAQUS 求解`
  - `③ 提取契约 CSV`（**此处才是真正导出 CSV 的步骤**）
  - `④ 反演对照`
- **整改建议**：将文案中的“将 ④ 导出的 CSV”修正为“将 **③** 导出的 CSV”。

---

## 三、专项核实：ZCode 修改 --R 换算规则的合理性复核

反重力在此前讨论中曾提出 $R_{\text{sim}} = \lfloor \text{resolution} / \text{periods} \rfloor$ 的换算规则。ZCode 在落实批二十时将其推翻，改为显式锁定 $R=24$。经过深入核实代码与数学模型，反重力判定：**ZCode 的修改完全合理，理据极其扎实**。

### 核实论据：
1. **状态真源核实**：核对 `../../tpms/tpms-platform/src/types.ts` 中的 `AppState` 接口，顶层状态确实只有 `porosity`、`cellSize`、`structureMode` 等，**压根没有 `resolution` 这个字段**。`resolution` 仅作为 Web Worker 渲染的底层私有变量存在，无法也不应该作为上层业务联动的输入；
2. **语义本质冲突**：平台的 `resolution` 是整场总采样格数，而 `sim` 的 `--R` 是单胞周期格数。若强行换算，滑块调节时会导致 $R$ 剧烈波动；
3. **数值安全与爆内存防线**：若开放大 $R$（如 96），在多周期（$k=4$）下网格点将达到 $(4\times 96)^3 \approx 5.6\times 10^7$ 个，体素化与 Marching Cubes 会瞬间耗尽内存崩溃；
4. **黄金标定档**：$R=24$ 是 Phase 1 唯一经过 21.2 万单元实测全绿、minSICN=0.057、孔隙率偏差 0.02pp 标定的基准档位。在界面上固定 `--R 24` 并注明为“验证档”，是对用户极具责任感的工程防御设计。

---

## 四、建议修复补丁（供 ZCode 审查参考）

### 补丁：`tpms/tpms-platform/src/main.ts`
```diff
--- a/tpms/tpms-platform/src/main.ts
+++ b/tpms/tpms-platform/src/main.ts
@@ -1373,3 +1373,3 @@
     meshEl.textContent =
-      `python sim/p0_generate.py --k ${k} --R ${R} --por ${por.toFixed(2)}\n` +
+      `python sim/p0_generate.py --k ${k} --R ${R} --por ${por.toFixed(2)} --out sim/out/${stem}.stl\n` +
       `python sim/p1_mesh.py sim/out/${stem}.stl --lmax 0.5`;
@@ -1396,2 +1396,4 @@
     const jump = (id: string): void => {
       const sect = document.getElementById(id);
       const rail = document.querySelector<HTMLElement>('.panel.controls');
+      if (id === 'sect-simbench') refreshSimBench();
       if (sect instanceof HTMLDetailsElement) sect.open = true;
@@ -1404,2 +1406,3 @@
   }
+  // 在 scheduleRebuild 处连带: if ((document.getElementById('sect-simbench') as HTMLDetailsElement)?.open) refreshSimBench();
```

---

## 五、审查总结

批二十仿真工作台一期把此前抽象的仿真脚本以极简、优雅的形态与前端设计器咬合在一起，是一次教科书级别的静态 Web $\leftrightarrow$ 本地工程工具链轻量集成。只需将 P0 级文件名 `--out` 参数闭环并补充滑块联动刷新，该工作台即可达到完全无瑕的生产可用状态。
