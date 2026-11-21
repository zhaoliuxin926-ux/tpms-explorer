# Gemini 裁定回执：第一性原理对抗审查三问题卡（2026-11-21，用户代贴）

> 出题背景：2026-11-21 第一性原理对抗审查弧（几何层 86/86 零缺陷+安全面三修 11f7bdc/1541812）后，按「A > B >> C」优先级出三张自包含问题卡请外部评审。本文为 Gemini 裁定原文收录（用户代贴），处置见 bugs.md 同日续批三。

---

## 问题卡 A 裁定：`qstar`（Q*）公式核验与轴非对称性

### 1. 原文公式与你的实现逐项比对

在数据集 `Equation-Based-Lattice-Structure-Dataset`（对应论文 *Generating a library of triply periodic minimal surface (TPMS) unit cells*, PMC10439271，基于 Maciejewski, Wicklein & Blum 1996 年对低阶傅里叶展开的拟合）中，Q* 曲面的经典单频点 Fourier 近似方程标准形式为：

f_Q*(x, y, z) = cos(X)cos(Z) − 2cos(Y)cos(Z) − √3·sin(Z)(cos(X−Y) − cos(X)) + cos(X−Y)cos(Z) = t

展开合并同类项后，与代码中的表达式 (cosX − 2cosY)cosZ − √3·sinZ(cos(X−Y) − cosX) + cos(X−Y)cosZ **系数（1, −2, −√3, +1）及三角项组合（包括 cos(X−Y) 与 sinZ 项）完全一致**，不存在转录或符号抄错。

（注：若在部分资料或变体中看到整体乘以 2 或展开为 −2cos(X−Y)cosZ，通常是 X, Y 坐标平移 π 后的等价相位形式；在标准晶胞原点定义下，表达式与 PMC10439271 原文逐字吻合。）

### 2. 为何 Q* 在笛卡尔坐标系下呈现"轴非对称"？（设计如此，非错误）

- **晶系归属不同**：大多数常见 TPMS（Gyroid/Diamond/Primitive/I-WP/Neovius）属**立方晶系**（Ia-3d / Pn-3m / Im-3m），空间群含 C3 体对角线旋转对称，在 (X,Y,Z) 坐标下严格满足循环置换不变性 (X,Y,Z)→(Y,Z,X)。
- **Q* 属六方/菱方晶系（Hexagonal/Rhombohedral，空间群 R-3m 或 P6₂22 家族相关投影）**：基矢在 xy 平面呈 120° 夹角（导致 cos(X−Y) 与 cosX−2cosY 的特征组合），z 轴为六方晶系唯一主轴（导致 sinZ 与 cosZ 独立耦合）。
- **结论**：在正交（立方）网格采样空间 (X,Y,Z) 中表达六方对称性，数学上必然破坏循环置换对称。豁免完全正确，升级为"已逐字核验"。

## 问题卡 B 裁定：零后端纯前端（GitHub Pages）BYO API Key 存储上限

### 1. WebCrypto non-extractable CryptoKey 是否可行？

**根本不可行（纯前端直连 LLM API 场景）。**
- extractable:false 只保证密钥材料无法经 exportKey 导出，但同源恶意脚本依然可直接调用 crypto.subtle.decrypt() 解密密文，或直接 Hook window.fetch/XHR 拦截 Authorization: Bearer 请求头。
- 只要请求从浏览器直发 LLM Provider，明文 token 在请求发出瞬间必然在 JS 运行时内存中，同源脚本拥有同等访问权限（Same-Origin Policy 边界内无隔离）。

### 2. 方案对比矩阵

| 方案路线 | 同源 XSS 防护增量 | 跨项目隔离度 | 实现与运维成本 | 综合评价 |
|---|---|---|---|---|
| 1. 现状：默认 sessionStorage + Opt-in localStorage + 一键清除 + 风险披露 | 基准线（关标签页即销毁；未勾选持久化不落盘） | 仅 sessionStorage 隔离标签页，localStorage 跨同域项目共享 | 极低（已完成） | **零后端约束下的工程最优解** |
| 2. WebCrypto 加密存入 localStorage | 假阳性安全（防不住同源 XSS，仅防本地磁盘明文翻找） | 无改善（同源脚本可调用解密或 Hook fetch） | 中 | **不推荐**（增复杂度无实质安全收益） |
| 3. 独立子域名隔离（Custom Domain） | 无（同页 XSS 仍可读） | **极高**（彻底切断 username.github.io 其他仓库的同源读取） | 低（需绑定独立域名） | **最有效的低成本加固**（解决多项目共享 Origin） |
| 4. 轻量无状态 Edge Proxy + HttpOnly Cookie / OAuth PKCE | 质变级（JS 接触不到长期 Key，仅短期 token） | 极高 | 中高（打破零后端前提，用户需信任代理中转） | 仅在放弃纯前端零中转架构时考虑 |

### 3. 拍板建议

- **M-2 架构定案**：现状方案=纯前端零后端约束下的理论与工程最优解，无需引入客户端加密。
- **唯一零代码补充**：在安全披露或部署文档注明——在意 username.github.io 其他仓库同源脚本风险的用户，可 Fork 后绑定独立自定义域名获得独立 Origin 隔离。

## 问题卡 C 裁定：Agent 跨调用联合算力预算设计

### 1. 选型：双轨混合（硬水位熔断 + 滑窗令牌桶）而非单一计数器

- 静态权重（mesh=periods³）面对不同网格拓扑与实际 RSS/磁盘占用有 2~5× 非线性偏差——纯单价累加阈值低了必杀长任务、高了依然 OOM。
- 推荐架构：
  1. **执行面物理水位硬熔断**：每次调用前/后检查进程组 RSS 内存占用率（>可用内存 80% 拒新任务）与临时工作区磁盘（单会话产出 >2GB 拒绝并提示清理），零误杀。
  2. **会话级非对称衰减令牌桶**：保留调用次数×单价作防死循环兜底，但用泄漏桶（Leaky Bucket）——允许短时突发，每完成有效产物消费或每 T 秒自动回血部分额度；仅连续高频空转时熔断。

### 2. 误杀合法长任务的代价定价与缓解

- 长扫描在临近完成时被硬预算误杀的沉没成本极高，且 LLM 难以断点续跑，易引发重试风暴。
- 工程对策（软降级优于硬拒绝）：预算达 80% 软阈值时不抛 Error，而在工具返回体注入系统级状态警告（磁盘水位/预算消耗），让 Agent 自主清理中间产物或降采样分辨率；硬熔断留给真正触及物理安全红线（95% 水位）的极端情况。

---

## 处置记录（我方对拍）

- **卡 A**：Gemini 引文展开后与本仓 tpms-functions.ts qstar 实现逐字吻合（系数 1/−2/−√3/+1 零偏差，独立复算核对）——豁免升级"已逐字核验"，tpms-functions.ts 注释+探针豁免注同步升级。
- **卡 B**：与本仓预判一致（CryptoKey 原理死锁）；M-2 定案=维持现状方案，SECURITY.md 补 Custom Domain 零代码建议。
- **卡 C**：软降级 80% 警告与本仓 E2E 预算三件套方法论（warnSlow 80% 预警线）独立同构——设计方案登记 E5 项待拍板。
