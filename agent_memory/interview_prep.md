# 面试考点预习包（20 问）

> 与 job_narrative 配套：那边讲"经历叙事"，这边练"技术追问的当场回答"。
> 每题=三句话答案+仓库证据指针。面试前过两遍，对着指针能现场打开佐证。

## A. 验证方法论（最可能被深挖——这是项目人设）

**1. 你说 46 道 CI 门禁，怎么保证它们不是摆设？**
三层：每门带最小断言数守卫（GUARD，防断言被删后集体静默仍绿）；一个元门扫全部门禁源码查恒真模式与 GUARD 基线漂移；关键宣称绑定可复现命令（docs_consistency 把 README 数字与代码断言对拍）。证据：`node tpms/.verify/guard_audit.mjs`（0.4 秒，任何人可跑）。

**2. 什么是"对拍"而不是"自证"？**
同一个量由两条独立实现路径算出来比差值：解析公式 vs 数值 MC 积分 vs CLI 输出 vs UI 显示，四方互证；GPU 路径 vs CPU f64 参考。自证是"测试复述实现"，对拍是"两条来源互不认识的路径殊途同归"。证据：parity_math 332 断言（容差 1e-9~1e-12）。

**3. 你的断言体系抓到过自己的什么问题？**
实例三则：GUARD 代码阈值 180 与文案"基线 160"分裂（元门首跑抓出）；我上午写的 37/37 限定词表下午拦住我自己的新宣称；CI 三平台全红抓出我漏改的对拍断言。证据：progress.md 2026-09-29/30 各批记录。

## B. 物理与数学（会被问"到底懂不懂"）

**4. 为什么力学用 Gibson-Ashby 而不是 FEA？**
目标定位是参数设计平台不是物理预言引擎；GA 给出相对密度-模量的标度律（E*/E₀=C₁ρ̄ⁿ），对拓扑趋势的筛选够用且浏览器端实时。诚实边界：绝对值是 surrogate 级，文档明示（HONESTY_BOUNDARIES）。

**5. 你的均质化有什么已知结构性偏差？**
剪切分量 C44-C66 恒为 Voigt 上界：6 连通体素网格上体积平均形函数导数完美配对抵消（8 共角体素 ±1/4 系数），剪切波动场恒零——这是离散化结构问题不是代码 bug，根治需非结构网格或 Q2 高阶元（数月级，超出平台口径，定案在案）。法向分量不受影响。

**6. 孔隙率怎么从目标值反解出等值面阈值 iso？**
解析曲面用确定性 MC 积分建立 iso→孔隙率单调映射后二分求根，再用实际网格的固相分数做割线校正闭环（解析根+网格实测两源）。证据：porosity-solver.ts + solveIsoAnalytic。

**7. 水密性（watertight）怎么保证，为什么重要？**
等值面拓扑上每条网格边至多一次穿越⇒每条穿越边恰产一个 quad⇒共享边配对无开放边；3D 打印/CAE 体网格化的前置条件。审计口径：开放边=0、非流形边阈值、退化面三项断言。证据：mesh_audit 34 案例。

## C. 几何管线

**8. 两个网格提取器为什么并存？**
Surface Nets 对光滑场质量高但薄壁自触域 fail-closed；Marching Tetrahedra 免疫不光滑场（径向梯度度规的折线 stops）——按场的光滑性路由。证据：v9.1 双提取器，radial-grad 卡走 MT。

**9. 索引池上界 18·R³ 怎么来的？**
结构计数：3 向网格边 × 每 quad 2 三角 × 3 索引 = 18·R³，与场无关的硬上界（曾用 6×N³ 经验值三次踩满溢出，OOB 写静默截断引发 NaN 死循环——根因轮定案）。帽 18M 的充分性有最坏组合实测表（cdd k12 R128 余量 23.5%）。证据：BENCHMARKS §7。

**10. 直接层切和 mesh 切片有什么区别？**
直接层切在隐式场上扫描线区间填充，不经过三角网格——体积偏差 ≤0.4%（mesh 路径发散 0.4-1.2%），工业 CLI 格式 hatch 保真 ≤0.1%。证据：gcode_slicer_audit 32 断言。

## D. Agent 与 LLM 工程（AI 岗核心考点）

**11. 你的 LLM Agent 安全模型是什么？**
LLM 只填槽位不写数字：五工具 schema 逐槽位校验（枚举/范围/未知属性/路径穿越拒绝），执行是确定性 CLI；闭环修复时 LLM 只在有界菜单 {patch_design, declare_unreachable} 里选择，应用与验收仍是确定性代码。"模型自觉"与"护栏功劳"分开归因。证据：llm_provider_selftest 39 断言 + M4 驱动器。

**12. 拦截器防住过什么真实攻击？**
路径穿越（../ 与 CON.stl Windows 设备名大小写绕过）、原型链键（__proto__/constructor）、批量 spawn DoS（toolCalls>64）、公式 460 倍成本放大（分享链接 ?formula=）。全部有回归钉。证据：红队 C/D 系列 + selftest E 组。

**13. 多模型回归怎么做才不虚？**
n≥2 多轮、勿称确定性；对抗指令单独分组（拦截路径与能力路径分开归因）；档位差异如实画像（4-flash 的失败=族名混淆/多目标拆解是能力边界，不是管线 bug）。回归集 43 条（含 H 组逆设计意图+E5 指代 fail-safe）：glm-5.3-flash 双轮 43/43×2（n=2，Coding Plan anthropic 通道）；42 条口径满贯矩阵 4/4（{anthropic, coding-openai}×{flash, 满血}）；4-flash 免费 33~34 档历史画像；历史 6/6 矩阵=37 条口径在案——LLM_REGRESSION_LIVE 有复现命令（三 env 铁律：KEY/BASE_URL/REG_PROVIDER）。

**14. Coding Plan 通道那件事讲一下？**
同一把 key 调 glm-5.3：开放平台按量通道 429 余额不足、Anthropic 兼容通道成功——订阅额度绑定接入通道。我给项目加了 Anthropic 协议 provider（messages 协议/tools input_schema/tool_use 块三转换），订阅用户零成本跑满血模型回归。教训：provider 类能力要逐跳转发（驱动器曾漏 anthropic 分支会静默断链）。

## E. 工程坑（讲得出细节才可信）

**15. 讲一个你最难的 bug。**
WGSL"从未被执行"：门禁绿了三周，绿的只是 JS 写的模拟内核——真 WGSL 从没上过 GPU。排查三层：四组 Chrome flag 全 adapter:null（假归因：headless 限制）→ navigator.gpu 本身 undefined + chrome://gpu 零报错（转折）→ 根因 secure context：about:blank 不暴露 WebGPU API。修完还有两层：SwiftShader 残差是真 GPU 的 170 倍（阈值按最差后端定标）、catch 吞掉执行段异常（探测失败=SKIP 合法，执行失败必须 FAIL）。证据：webgpu_parity_audit [I] 段 + 博客第三篇草稿。

**16. CI 三平台为什么必要？举一个只有跨平台才抓到的。**
win32 六层假设剥离（路径分隔符/playwright 通道/SwiftShader 差异）；最狠一例：tee+pipefail 让"全绿日志"被判 exit 1（macOS 日志结尾 45/45 全绿但步骤红）——先查 shell 管道再怀疑门禁。证据：progress 2026-09-29 CI 假红根修。

**17. 性能断言在 CI 里怎么不 flaky？**
按最慢 runner 校准阈值（本机 1.2s 的 80³ 构建哨兵定 5s，macOS 实测 3.3s 曾超 3s 假红）；固定等待改事件等待（toast 快照→MutationObserver 历史）；偶发一次 rerun 定案、复发两次才动阈值。四例家族全留档。

**18. 内存/缓冲管理怎么做的？**
TypedArray 池跨构建复用（R48 预览不吃 R128 的 178MB 预算），增量清零（只清上次用过的段，比全量 fill 快 10 倍），顶点/索引按结构性上界分配。soak 实测 30 轮随机交互 heap 增长 18.8MB（池正常暖机非泄漏）。证据：buffer-pool.ts + probe_ui_soak。

**19. npm 生态踩过什么坑？**
npm install/audit 会改写 lock 删 @emnapi optional 条目（CI 的 wasm 构建链会断）——每次跑完必 git diff lock 审查，被删条目 JSON 级回填；同坑当日复发当日拦。证据：progress 2026-09-30。

**20. 这个项目你最想让人记住的一点？**
不是 46 门也不是 26 族，是"错误留下痕迹且每个都变成防线"——三十多个 commit 里能看到每次犯错（git rm 原子失败/heredoc 转义/GUARD 漏改被三平台打回）和每次犯错后的机制化。可信度不是没有错误，是错误的可追溯与不可复发。
