# bugs — 问题与风险

## 2026-10-24 实用性审查首批四组执行后开放项

- **【已处置 2026-10-24 同日】UI 导出档分辨率不足以产水密网格**：CLI 矩阵实测显示档 hdResolution=19+k·14 下 gyroid/diamond 全组合非水密（UI 历史静默交付非水密 STL）。处置=导出门（审计+硬拒）+ 32 格/周期升档重试（min(128,max(hdR,k·32))，ensureExportGradeGeometry overrideR）：gyroid 全 k/diamond k1-4/gprime 救回；**diamond k5 与 fcks 薄壁自触族在 128 帽内结构性不可产仍拒**（fcks 96/120/128 全 exit3 实测——诚实拒+报数值）。探针 probe_export_gate.mjs 6/0（fcks 拒/gyroid 救回/schwarz 直通）。后续可选项：>128 需 BufferPool 扩容，另批。
- UI Pareto 扫描域 cs∈[2,5] 无 1——采用入口阻断后该面板点击应用实质全禁（Pareto/逆设计两入口待 UI 独立尺寸批次解锁）；阻断 toast 已给 CLI 等效命令。

- 风险：裸 npm install 会改写 package-lock.json 删 optional 条目（@emnapi/@napi-rs），禁止
- 新发现：`npm install --package-lock-only` 同样会删 @emnapi/core、@emnapi/runtime（2026-09-22 实测）——凡改 tpms-platform 依赖分类/增删包，lock 更新即丢 optional，npm ci 后 optional 平台依赖可能缺装
- 已定案（2026-09-22）：反演求解器保持 [0.02,0.98] 宽域；回 UI 应用时与滑块同域 [60,90] 钳制并 toast 提示（NL/红队 D 同策略）
- schema_check spawnSync 无 timeout：残留 _schema_tmp_*.stl 或脏环境可导致本地长挂（CI 无此问题）；复现时先清 tpms/agent/_schema_tmp_*.stl

## 2026-10-02 全仓对抗审查待修清单（HEAD=24da17f，46/46 实跑全绿背景下的发现）

**CRITICAL**
- C1 exact 求解器 iso 二分域硬编码 ±1.6（porosity-solver.ts:100 / tpms.mjs:100 / 割线校正三处同钳）：dg/slotp/iwp/neovius 等 11 族在 UI 域 [60,90]% 高段被静默截断——dg 目标 85% 实测 51.5% 仍 exit0 交付（CLI 一手复现）；修法=按族场值域自适应或卡界 fail-closed
- C2 periodic-surface.ts:92-94 useLookup 排除集漏第六批 slotp/fs/qstar/ws：RVE 导出静默产出 Schwarz P（四族 posHash 与 schwarz 逐位一致实证）；主管线 surface-nets.ts:164-167 已含且有警告注释，此分支漏网

**HIGH**
- lidinoid 漏 MiniSurf 源的 +0.15 常偏置（tpms-functions.ts:57-66；iso=0 两相体积差 12pp；同库其余常偏置族全对）
- geoCache 键缺 mesh 容器/blend 维度（geo-cache.ts:53）：blend 滑块拖动与外部 STL 容器替换被缓存吞（缓存命中旧几何直接 return）
- CI 测 runner 重建产物、Pages 部署 commit 产物，二者无强约束（ci.yml:98-102；run_ci_suite drift 守卫只 warn 不 fail）——忘 commit 重建产物=线上陈旧且 CI 全绿
- SEO 三件+CLS+Lighthouse 零 CI 门禁（.verify 全库零命中；删 robots/sitemap/canonical 全绿）
- webgpu_parity 能力强制断言仅 win32 本机路径生效（webgpu_parity_audit.mjs:407-416 chromeCapable 硬编码 C:/Program Files 路径）：linux/mac CI 上真漂移恒走合法 SKIP

**MEDIUM（择要）**
- llm-provider.mjs:95 toolCalls 数组含 null 元素裸崩 exit1（网络面实证可达；Anthropic 通道免疫）
- tpms.mjs scenario isoGrad 只查有限性不查 [-1.5,1.5] 幅值（同构命令四方口径分裂；0.38% 冒称 65% 目标 exit0 交付）
- inverse-design C1_MAP 与 UI GA 面板 gibson-ashby 不同源（差~27%）但文件头宣称"同源"
- NL 词表裸 "cs" 子串劫持（nl-agent.ts:59，"physics"→fcks）
- external STL 容器激活时 INP/polyMesh/VTI/CAE 导出静默回退 cube（main.ts:4511-4571）
- static-server.mjs:41 const file 重赋值：目录 URL（/platform/）500；无 gzip；MIME 缺 .xml
- guard_audit B 段"消息任一数字==阈值"放过 verify.mjs:264 的 22/27 双数字漂移
- docs_consistency 197 断言是机器相关值（本机 job_narrative.md 贡献 9 条；CI 实为 188）
- 文档旧数字 23 处：tpms/README（45/45、35、10 套、1.3MB 等 6 处）、interview-pack 11 处、README_EN 2 处（含 schema 108 错，实跑权威=105）、已发布博客一 3 处
- HD 升级路径绕过 exact 求解器且污染 lastExactIso（main.ts:2000-2035）
- fs 族 p≈0.5 / shell 模式 p<0.18 结构性不可达段静默 11~13pp 交付

**流程**
- progress.md 停在 09-23，其后 122 commits 未记录（本清单即补账；10-02 已修复轮覆盖）
- pack 86.57MiB 历史残留（2026-10-03 普查定案，等用户拍板执行）：**第一档无争议全清 ~40MB**——纯历史残留（tip 树不存在，零现役影响）：`tpms/.verify/tpms_selftest_scn_*.inp`(9.8)+`tpms/.verify/_schema_tmp_*.inp`(5.6)+`docs/screenshots/page@*.webm` 双录屏(15.1)+`docs/platform/assets/*.map` 四版(5.6)+plat-*.png 历史版(~8.8)；**第二档现役瘦身 ~14MB**——demo-tour.webm tip 现役仅一版，历史旧三版(6.5+7.2+7.3)需"保 tip 清历史"区间 filter（复杂度高一档，第一档后视收益决定）。执行序（照 git 历史膨胀清洗模式记忆）：本地 bundle 备份（勿推远程）→ `git filter-branch --index-filter 'git rm -r --cached --ignore-unmatch <通配>' --tag-name-filter cat -- --all` → 清远程跟踪引用 → HTTP/1.1+postBuffer 强推 → **强推之后**才本地 gc（先 gc 清不掉实测）→ CI/Pages 全量复验（force push 自动重触发）→ 附注 tag 重写后 ls-remote ^{} 核验。风险披露：重写后 commit SHA 变化使外部旧 SHA 引用失效（在案 PR #1 一个，个人项目影响可控）

## 2026-10-05 深水风暴挂账关闭定案（用户授权裁决）

- **关闭依据链（全部学证背书）**：①真根因之一 gzip 已修（撤销即愈确定性挂）；②五假说排除（CPU 节流/满载/时序/Edge 版本/纯负载）；③嫌疑三件套定量全灭（clone 3.2ms/回传 54ms 差 31~500× 于 1.7s longtask）；④双路径轰炸 67/67 零复现（轻/大 fixture）；⑤ r6 起 12+ 轮 CI 零触发零重试膨胀（时长旁证带内）。**定案：风暴大概率已被 gzip 根修+升档单 job 化结构性压制；挂账关闭转历史档案**。冷冻自愈双试+五探针保留常驻（零成本）——若未来 CI 真红 traceTop 仍自动落证据（机制不死，只是不再作为挂赦项追踪）。

## 2026-10-05 strut 族层切验证（新维度巡检，定案非缺陷）

- gcode 直接层切在 strut 双族上首验：bcc 切片 vs 体素对拍 4.09%（与 TPMS 量级相当偏高）；**octet 10.54%@R48/12 层**——双向收敛定性（R96 5.5%/40 层 3.87%）=纯离散收敛行为非缺陷：细杆（r≈1-2 格距）在体素判定里"长胖"高估，扫描线如实——**对拍锚选同阶口径纪律的新例证**（体素 0 阶对细杆几何的偏置方向与 TPMS 相反）。slice --type 路径对 26 族无特判全通。

## 2026-10-05 智谱官网调研结论（项目机会清单+裁决，全部学证）

- **合规边界先行（FAQ 原文）**：“自建应用、网站、机器人、SaaS 等通过 API 集成，需改用标准 API 服务并按协议计费，**套餐额度不可用**”——即 plan key 在自建程序（含本项目 CLI/LLM 回归）的合规用法=标准 API 计费通道（paas/v4）；**plan 专用端点面向指定工具**（Claude Code/Codex/Cursor/ZCode 等）。本会话已实测三端点均通+满贯 6/6——但 **长期绑定需按此条欿ea：regression 默认走 paas/v4 标准通道（按量），plan 端点仅作临时验证用**（已实测记录，不写进默认配置）。
- **可偕机会清单（裁决后）**：①**web_search 工具**（tools 数组声明 type:web_search，与 function calling 并列）——NL 助手可加“查文献/查标准”能力，但 0.01-0.05 元/次+仅 paas/v4 通道，**边际小不做**；②MCP 四件（视觉/搜索/网页/zread）——本机已有同类 MCP（rag-kb/web-search-prime），重复不做；③context 缓存/1M 上下文——单轮工具调用场景用不上；④**thinking 始终开启+reasoning_effort 三档**——已由 170s 超时教训覆盖，可选加 reasoning_effort=low 降时延不做（行为差异未验证不硬加）；⑤Managed Agents/Responses 协议——协议独立无消费者，不加（前批已裁）。**全部裁决=不立项**，登记备查。

## 2026-10-03 追杀轮（"继续"批）：r4 iwp 误诊更正 + 缝 band 根修

- **【深水挂账】meshcont 上传路径主线程 native 风暴（偶发 ~40%，冻结 SDF 卡 0%）**：取证链=主线程活着但 longtask ~1.7s 首尾相接 + CPU profile `(program)` native 吃满 3.5s（JS 帧近零）+ rAF=3/2s（渲染静默）+ 双 tpms-worker respawn——worker onmessage 回调永无主线程空隙。**非 r5 回归（r4 bundle A/B 同败率 3/5 实证）**、非 gzip 残留（已撤即愈确定性挂）、非渲染循环。假说演进（复审 M3 时间线论证）：~~看门狗超时-重生循环~~ **被排除出首因**（首次 respawn 需 build 看门狗 120s，而冻结上传后即时发生——respawn 是次生症状）；"GC 风暴"与"JS 帧近零"表面矛盾（主线程不跑 JS 即无分配——除非 native 侧消息反序列化临时对象）。**当前嫌疑三件套**：①worker→主线程大 mesh 回传反序列化（R96 positions+indices 20MB+）②containerMeshSdf 每次 build 主线程 structuredClone（3.65MB@R96——collectTransferables 明确不 transfer 它）③applyGeometry 大分配。**【第二十二批定量收缩 2026-10-04】嫌疑②被定量排除**：实测 structuredClone R96 档（3.48MB）=3.2ms、R128 档（8.19MB）=7.2ms——与风暴 longtask 签名 1.7s 差 250~500 倍量级，不可能是主因；"worker 侧持有 SDF 缓存"的协议升级不立项（收益 3-7ms/build 不可感知+复杂度中高=过度设计；transfer 直方案本就不可行——会掏空 meshCont 缓存档）。**嫌疑①同批定量排除**：42.7MB 几何（1.4M 顶点级 positions+normals+indices）worker clone 回传含主线程反序列化=54.4ms（transfer 41.7ms 仅省 13ms——回传 transfer 化同样不值得）；与 1.7s 差 31 倍。嫌疑③量级与①同数量级（叠加全部<120ms 仍差一个数量级以上）。**三件套终局：单独与叠加都不可能构成 1.7s 级 longtask——真根因在引擎 native 层（V8 GC 病态全局暂停/分配器行为）或系统层未知路径；本地轰炸（67/67）+静态协议复审+定量排除三路穷尽后，traceTop 伏击（native 帧聚合，装备与目标对齐）是唯一取证路径**。meshCont.ab transfer 协议已复审自洽（slice 副本可 transfer、原件保留）。**取证装备（已全部上线）**：traceTop（Tracing ReportEvents——初版 ReturnAsStream 交付即死已修）/heap 双采样斜率/midPoll@60s 中途 profile（看门狗 120s 前后分界）/longtask/rAF/profileTop。另：CPU 节流 ×4/6/8 与上传时序扫描（300~3800ms×6）共 12 试均不复现——纯负载与"上传撞 boot 竞态"两假说排除，触发依赖未知状态因子（内存态/系统调度）。**止血**：冒烟改冻结自愈双试（每试冻结必留 DIAG 后重载，双冻才红；8/8 实测绿）。**10-03 晚后续**：本地复现窗口关闭（22/22 过，冻结与机器负载态强相关）；DIAG 已加 CDP Tracing 切片聚合（traceTop top10）——**伏击策略**：下次 CI 自然冻结自动落 traceTop 进 artifact，配合 longtask/profileTop/rAF 三探针即可定轰源，无需再本地复现。CI r6/r7 连续全绿（双试未触发或自愈）。**10-03 第九批主动轰炸**：升档三连修（单 job 化）改变 Worker 时序面后重开复现窗口——30 试 reload+上传+升档/降档拖动交错时序（12 三角盒，2/3 试次上传 2s 后拖 cellSize 3→5/3→2），**零冻结（30/30 OK，7-13s 就绪，555s 总）**；累计 52/52。**假说（未证因果，如实登记）**：单 job 化减少 meshcont/build Worker 并存竞争面，可能顺带收窄触发面——历史签名之一"双 tpms-worker respawn"的并存前提在升档场景已消除；但冻结与机器负载态强相关的既有结论意味着 52/52 也可能只是未进触发窗口。伏击网维持（等 CI 自然冻结）。**第十七批大 fixture 轰炸补全（2026-10-04）**：12 盒快路径打不中嫌疑三件套（20MB 回传/3.65MB clone/大分配只在大 STL 激活）——5120 球 15 试（setInputFiles 真实路径+上传中 2s 拖 cellSize 时序）**零冻结零 pageerror**（每试 23-28s 全链路）；本地轰炸账本 67/67（30 盒+15 球+22 历史冒烟）。本地窗口覆盖双路径后仍全关，伏击网（CI 自然冻结落 traceTop）维持为唯一剩余取证路径。
- **【误诊更正】r2~r4 归因"iwp Node 环境确定差"是错的**——真根因：M-3 编辑把 `band:[lo,hi]` 写成**二分收敛后的指针**（34 轮后 ~5e-10 缝）而非求根域本身 → clamped 恒真 + 任何割线校正步都"触界"：solve 全线 iso_boundary 早退（CI iwp 0.78pp 不可达=冷算真面目）、mesh 校正被钳死失效。本地曾因命中无 band 的旧缓存条目走 ±1.6 兜底而"幸运绿"（0.015pp 恰是 ±1.6 兜底与真 band 对 iwp 的同轨迹）。三平台逐位同值恰证 JS 确定性无恙。**修复**：porosity-solver.ts/tpms.mjs 分离 bandLo/bandHi（域）与 lo/hi（二分指针）+ 缓存键 v2→v3（带毒 band 强制失活）+ selftest 紧容差恢复（splitp/iwp 0.05pp 全过=r4 的 1pp 放宽是对误诊的权宜，已回滚）
- **fieldRange 采样余量实证（Q1）**：24³ vs 64³ 全 24 族扫描——低估量全部被 pad 兜住，最差 cdd=0.79×pad（5% 宽度比例 pad 随谐波族自动放大，neovius ±13 也有 1.28 pad）。**新族扩展规则：加入 >3× 谐波族时重跑此探针**（/tmp/fr_probe.mjs 模式：双分辨率对拍低估/pad 比）
- **契约断言 exit 码可见性（Q2）定案**：frd/fky/lidinoid 双接受断言文本已含"实测 exit=N"——三平台 CI 日志并排即可见"永远 exit3"漂移，不另建机器；跨平台聚合属 CI 后分析，暂不为它加机制（先精简）
- benchmarks.mjs 生成器模板内嵌旧数字（20 族/45 道/0.13pp）——每次重算冲掉 BENCHMARKS.md 手修（本轮实证复发一次），已源头修模板；**教训：生成器模板数字与产物同源维护，手修产物=下次重算必回退**
- pendingExactFix 补 stateSig 守卫（复审 L-3 收口）：响应到达时几何指纹已变则弃用旧 fix，与 forceExactIso 防护对称

## 2026-10-03 第八批：升档路径三连修（修复史+方法论）

- **双 Worker 互拖（修 B 根除）**：升档（拖大 cellSize）时 l2 档与 HD 档都大于已缓存最大档 → rebuild(l2) 与 scheduleHdUpgrade(HD) 各自 meshSdfEnsure 全量并行，status 双档号交错闪烁、互相抢核。修复=升档态 l2 让位 HD（`R+1>缓存最大档` 时 R=hdResolution），sdfEnsureJobs 同档共享保证单 job；HD 就绪后 l2 由降采样瞬时供给（与 58a7784 降档设计同构）。**教训：给"缓存 miss 补算"类机制加档位时，必须推演多入口（rebuild+HD 升级调度）同时 miss 的并行形态——两入口各自补算=双倍算力+文案互踩**。
- **首帧拦截（修 A 根除）**：rebuild 的"档未就绪 return"写于降采样机制之前，降采样成功的结果被无条件丢弃——preview/l2/HD 三级重建全部 no-op，升档期间屏幕定格旧帧（5120 三角 167s / 82k 20 分钟零视觉反馈）。修复=meshSdfFor 返回非 null（降采样命中）继续重建。**教训：新机制（降采样）落地后必须复审旧守卫（未就绪 return）的拦截范围是否误伤新路径**。
- **ETA 实测外推（修 C）**：elapsed×(1−p)/p 免标定吞吐模型；前 3% 单条进度噪声大不显示；秒级 5s 步进防跳变。82k 升档全程如实收敛（10% 报 20 分钟 → 47% 报 10 分钟）。
- **82k@90³ 全量升档实测 ~20 分钟**（交接预估 5-10 分钟低估一倍；166s@62³ × (90/62)³=3.04 线性外推 8.5 分钟，实际超线性——worker 内 BVH/内存效应+机器负载）。**规模外推须留超线性余量，锚点须实测**。
- 探针自设阈值过紧误报（像素 diff 5.45% vs 基线 1.89%，判据 noise×3+1%=6.67% 打 ✗）——**变化为真但阈值拍脑袋定的：A/B 判据阈值应从基线分布定，而非经验乘数**（未改：一次性取证探针已删，经验入账）。
- push curl 52 空回复（7890 代理通但 HTTP/2 传输抖）→ `git -c http.postBuffer=524288000 -c http.version=HTTP/1.1 push` 一次过（已入 progress.md 铁律）。
- probe_meshcont_scale 升 7 项（+C 升档单 job 档号唯一+ETA+零错）；GUARD 4→7；run_all 标签同步"7 项"。
- **【第十三批红队】升档三连修快速拖动序列实测通过（2026-10-04）**：3→4→5→3→5 @300ms 间隔（快于 150ms rebuild/350ms HD 双 debounce）→ 零 pageerror、tier 集合=[89] 唯一（**比推演更干净：debounce 天然合并快速序列，中间档 R75 job 根本不发起**——第十批"快速拖动中途档可能并行"的担忧实际不成立，无需披露条款）、终态收敛 R89 档就绪。tag 账实同批核验无漂移（本地=v9.0.0/v9.1.0/v9.2.0=远程，附注 ^{} 行在）。**探针自坑再证**：canvas 在位断言对 WebGL canvas 调 getContext('2d') 必返 null 误打 FAIL——WebGL canvas 判在位不能用 2d context 探针（先疑探针纪律第 N 例）。
- **【溯源闭环】"README 性能数字 FCP 4.5s/分数 39"交接漂移的完整解释链（第十批补全）**：数字真实存在——出处是 c1cfa4e（教学版 app.html 的 three.bundle 迁 body 尾性能修复 commit，FCP 5.8→4.5s/分数 31→39，是**教学版 Pages 形态的 lighthouse simulated 口径**）；交接叙述把它误挂到"README 性能数字"名下（README 全文 grep 零命中）。交接时二手数字要溯源到一手 commit/文档再引用；lighthouse 模拟节流值与 Navigation Timing 未节流值**口径不可比**（教学版 10-04 实测未节流 FCP 928ms，不能宣称"4.5s→928ms 优化"）。教学版健康自 b9505cb（lidinoid 镜像）后被 run_all file 冒烟套件持续覆盖（r13/r15/r16 绿）。

## 2026-10-04 dg MT 立项假设检验（负结果归档，用户授权立项后的第一步交付）

- **假设证伪：MT 裸接入不救 dg 高段（Double Gyroid 与 diamond 两族都实测）**。探针（solveIsoAnalytic+marchingTetrahedra R96，p 0.50~0.75 七档）：dg 族 nm 1968~2400 全段、diamond 族 nm 798~1152 全段——**可产域（p≤0.53）也 nm**，恒定级指向**周期场立方域边界开口**（TPMS 周期结构在立方域切开处固相与域外交界→边界 cell 开口边），非薄壁免疫性问题；radial-grad 先例水密是因为 cylinder 封闭域+clip 边界节点恒 0 处理，周期族无此适配。回代偏差 diamond 2~6pp / dg ~15pp=探针未跑割线校正（secantCorrectPorosity）的口径差（dg 的 MC 积分系统偏差更大，主管线靠校正拉回——与 C1 修复史一致），非 MT 网格缺陷。**首测族名踩坑：'diamond'≠'dg'（Double Gyroid 是独立族）——首版结论只对 diamond 成立，换 dg 重测后证伪同样成立**。
- **【已关闭 2026-10-04 用户确认】原 dg MT 拍板项（决策实测三路闭环）**（2026-10-04 R128 实测补全）：①真实拒产域修正——k6（CLI 默认 periods）下 R96 p0.55~0.70 全可产、仅 p0.75 拒产（nm 20736）；R48 p0.6 拒（nm 18354，schema 钉一致）；**旧叙述"dg>53% 段拒产"与实测不符**（真实缺口=k6 p≥0.75 一小段）——首测还踩了 periods 口径坑（k3 跑出全可产的假象，拒产域登记在默认 k6）。②提 R 路线证伪——R128 非单调交错（p0.65 拒 nm 768 而 R96 同档可产；p0.70 反向；p0.75 双拒 nm 4608），分辨敏感性混沌，"提 R 系统性更安全"不成立。③MT 裸接入证伪（见上条）。**推荐**：关闭拍板项（收益=k6 p≥0.75 一小段 ≪ 工程=周期域适配+割线校正+全段回归）；fail-closed 诚实拒产语义已完备；**用户真需要 dg 高 p 时参数绕行即可：periods=3 实测 R96/R128 p0.55~0.75 全可产**（k3 薄壁更厚）。
- 探针坑：diamond 场函数需 weights 第四参（w[0]×… 加权和——f(x,y,z) 不传 w 裸崩"reading '0'"）；bash heredoc 无引号吃反斜杠再犯（正则 /\\/g 变 /\/g 语法错——探针类文件一律 Write 工具不走 shell）。

## 2026-10-04 性能边界登记（profile 定案，无代码改动）

- **platform 首开无本地可修瓶颈**：chrome-devtools trace 本地 LCP 638ms（TTFB 6ms+render 632ms）——渲染本身快，线上 4.7s 主体=325KB gzip 网络传输（主包已动态分包 2026-09-25）。缓存面：线上 Pages `Cache-Control: max-age=600`+ETag 协商——**hash 资源理论上可 immutable 长缓存但 GitHub Pages 不支持自定义响应头（平台边界）**；实际访客成本=10 分钟后一次 304 协商 RTT（ETag 兜底非全量重下载——本地 trace 的 TTL=0/wasted 943kB 是门禁服特性非线上）。DocumentLatency 87kB 未压缩=本地服无 gzip（门禁服纪律：不做响应字节实验），线上 Pages 自动 gzip 不适用。

## 2026-10-02 修复轮后仍开放项（复审定级，均已核实非紧急）


- fs 族 p≈0.5 / shell 模式 p<0.18 结构性不可达段：现在 warnings 数组+文本路径双披露（不再静默），但仍是解析上不可达——如需覆盖须换提取器/降壳厚上限（设计决策）
- secantCorrectPorosity 是无消费者导出 API（复审 L-1）：本轮签名 _f→f 后若被外部调用传 undefined 会 throw——无仓内调用方，保留（删导出属 breaking）；如未来启用须传 f/W
- pendingExactFix 消费无 stateKey 匹配（复审 L-3，预先存在）：in-flight exact 响应回来时用户已改参的场景会用旧 est 校正新 fix；forceExactIso 有 stateKey 防护、此路径不对称——低概率（需 150ms 防抖窗内改参）
- BENCHMARKS dprime/cdd R48 nm 同值 18252（tris 不同）与 volume_loss 表部分行同值 pattern：新旧表均在，未证实成因（巧合或生成复用）——观察项
- docs_consistency GUARD 313=CI 实测零余量：设计上最大灵敏度；docs 扫描全静态确定性，无平台方差，理论无抖动——若 CI 实测≠313 会即红即查
- .iso-cache.json 293 条 v1 条目永不命中驻留 ~30KB（无实害，键 ':v2' 无碰撞已核）
- expfit wPts 用首对采样间距估窗宽（experimental-fit.ts:163）：非均匀采样下失真——试验机分段采样场景登记
- lidinoid 口径注记：+0.15 后 iso=0 两相 61.6/38.4 是官方几何真实特性（非自对偶）；此前"12pp 差"实为漏抄版 por(−0.15)=0.728 vs 官方 por(0)=0.616
- neural-implicit-weights.ts 已对新教师重蒸馏（lidinoid RMSE 0.0311）；公式再变更须重跑 gen_neural_weights.mjs（本轮经验）
