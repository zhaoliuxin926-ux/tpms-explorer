# progress — 当前任务进度

> ## 🔖 新会话开工指引（2026-11-02 · 全仓整理轮）
>
> **仓库态**：main=**3e40a69+ 已推送**（f8b71bb stale 修正 + 3e40a69 diamond 主公式回滚 + 本提交 Codex 第八轮意见处置）。**Codex 第八轮四条已全落**：①宿舍对齐改**纯离线 bundle**（backup-\* 分支会把待清洗历史变成远端可达引用——已删该方案）；②diamond 再放行条件收紧=**同几何局部修复后的 E\* 敏感性证据**（两点拟合对照明确不足）；③DT 探针"粗体素偏软"方向性归因撤回（平台窗前未收敛不可判物理），**DT/FEA 维持固定 R6 算例回归容差**；④CI 秒败根因=**账单状态阻止任务启动**（check-run 注释：近期支付失败或支出限额需提高——具体待 Billing），等用户手动登录网页确认后 rerun 41381733898。工作树净。
>
> **待用户**：~~登录查 Billing~~（2026-11-02 computer-use 已查）。**Billing 一手读数**：账户=**GitHub Free**（免费计划；Next payment due=-）；11 月 metered usage=$0、按仓库计费维度 "No usage found"；深层支付页触发 2FA 重验证（未碰）。**定性**：Free 私有仓库 included 2000 min/月 + spending limit 默认 $0 + 免费账户无支付方式 → included 耗尽即拒（秒败零日志、被拒 job 不产生 usage→metered $0 自洽；时间线吻合：11/1 重置→两天 ~9 全量×3 平台、win/mac 2× 计费+rerun→11/2 03:11 UTC 起秒败）。**非"支付失败"型**。精确分钟数自看路径=Settings→Billing→Usage。**恢复四选项**：(a) 等 12/1 重置（零成本，本地 48 门替代验证）；(b) 升 Pro $4/月（3000 min）；(c) 绑卡+spending limit（按量）；(d) **历史清洗后转回 public（Actions 永久免费）**——前置=2098067 blob+pack 清洗已挂账。**billing 恢复前勿推 docs/**|tpms/**（触发 CI=秒败红噪音）；agent_memory/** 提交不触发 CI 安全。
>
> ### 全仓整理轮（2026-11-02，ZCode 执行）
> 1. **探针清理**：删 14 个一次性探针/旧产物（.verify 下 _verify_mode/probe_consistency_p1/probe_delivery_pkg/p3/probe_design_roundtrip/probe_empty_retain/probe_export_gate/probe_mfg_card/probe_specimen/probe_taskflow/probe_cae_contract/probe_inverse_alpha/probe_fwd_unified/benchmarks-latest.json）+ guard_audit EXCLUDE 同步；有消费方的探针全保留（probe_dt_fea_matched/band、probe_taskflow_e2e 等）。
> 2. **RELEASE_NOTES 归档**：17 份 → docs/releases/；README 双语+gate readdir 2 处+PROJECT_INVENTORY/SUMMARY/ROADMAP 连带；v9.1.0 内两条 ../ 相对链接补一层。
> 3. **tpms/agent_memory 收编**：bugs.md §一「已定案边界」并入根 bugs.md（**第 2 条按 10-26 批十六更正版回填**——残留目录的副本停在 10-12 旧文本，比现役边界表更陈旧，直接合并会回退边界）；gen-boundary-table 改读 agent_memory/bugs.md；interview_prep/job_narrative 入库根 agent_memory/；残留目录删除；.gitignore 移除条目+加 .zcode/。
> 4. **钉值链 331→349**：job_narrative 入库后本机=CI 同口径（331+17+1），gate 正向钉+README 双语+PROJECT_INVENTORY 同步。
> 5. **agent_memory 维护**：README 重写（旧指针指向已删目录）；release-v930-promo.md 删除（零引用）；旧 progress 全文归档 archive/progress_2026-10.md；context.md 刷新。
> 6. **文案修正**：ci.yml 步骤名 46→48；tpms/README run_all 自起服务措辞；体验说明 1.3MB→0.53MB；.gitignore 乱码注释修复；collab/README 处置表补 11-01 Codex 条目。
> 7. **本地产物清理**：~230MB STL 产物（根/tpms/agent/.verify）+ sim/out 求解中间文件 ~11GB + specimens .err/旧存档 + .mimocode + .verify web/shots。
>
> ### 新会话第一优先
>
> 1. **CI 确认**（5bbb4da 整理提交 attempt2 重跑中；diamond 入库提交随其后 push）；
> 2. **Codex 续对接**：collab/codex/2026-11-02-diamond-stiffness-ingest-zcode-response.md 两项待表态——①代码侧密度口径（名义 vs 实测）；②条件匹配 DT 探针不可行（单档 >130min CPU）的四选项（降 tol/R12/维持 R6 现状/FEA 侧产出）；
> 3. **LLM 回归 43 条**（需 TPMS_LLM_KEY 三 env，Windows 用户/机器级均无——用户手动 export）；
> 4. **S1_G60 上机**（卡用户）：CSV（df+三尺寸+可选 # porosity=）回传即反演+幂律叠图；**CFD license**/单元形态拍板。
>
> ### diamond 刚度入库轮→回滚 + 条件匹配探针回填（2026-11-02，紧随整理轮）
> - **diamond 主公式入库（eb56456）经 Codex 复核后已回滚**——"刚度单独放行"=数据层面可发布，主公式替换（影响平台预测）当时明确暂缓；缺"p50 近退化单元对 E\* 拟合影响"定量分析。回滚：C1_MAP 回 0.42/GA_EXPONENT_MAP 删条目/estimate feaCalibration 改候选披露/selftest 锚回 ρ²（schwarz 锚保留 63 断言）/fea-calibration.md 记再放行条件/docs-platform 重建。候选值存档待补证据后独立轮再入库。
> - **Codex 复核连带**：2026-11-01 清洗回执复述被清洗数值一处改定性（全仓唯一命中；2098067 旧 blob 残留**挂后续历史清理**，与 pack 清洗同议）；machine-facts.md 宿舍对齐补全（未推送提交先备份分支/bundle；stash 只保未提交改动明示；新 clone 无 upstream 处理）。
> - **条件匹配 DT 探针完成回填（2026-11-02 凌晨）**：~5.5h CPU 后两档全出——P=0.6 DT/FEA=0.644、P=0.65=0.720（refPred/dtRatio 见 collab/codex 回执）；**两档均带坍塌旗标**（failureStrain=1.0 关单元生死仍在 ε≈4-5% 坍塌，未达平台窗——dtRatio 平台语义存疑）+同 ρ̄ 跨分辨率漂移 0.720 vs R6 先例 0.798（~10%，粗体素偏软方向一致）。解释权留 Codex（回执三观察+四选项）。计算代价修正：可行但重（单档 2.5-3h CPU）。
>
> ### 铁律速查（整理轮后恢复精简版；全量见 archive/progress_2026-10.md）
> - **平台 src 变更必须同提交重建 docs/platform**（部署链：规范 cwd vite build → rm -rf docs/platform && cp -r dist → 删 *.map → diff 零差异才提交；漏了=CI parity 三平台齐红，2026-11-02 eb56456 实锤）
> - 构建必须规范 cwd（`bash -c "cd <abs>/tpms/tpms-platform && node node_modules/vite/bin/vite.js build"`；license-headers 按 cwd 解析）
> - 发版链：本地 48 门→推→CI+Pages 双绿才算成；**中间环境性红由最后 push 的 SUCCESS 超越，绝不 rerun 中间旧 run**（最新 run 的失败 job 可 rerun）
> - docs_consistency 正向钉=README 双语+gate 三行+PROJECT_INVENTORY，断言集变化全链同步；计数以实测为准（schema=113 无参实测，注释会 stale）
> - bash 一律绝对路径；改源码用 Write/Edit（bash 内嵌引号转义损文件）；管道 `| tail` 吃退出码；gh run watch 限流，查 CI 用 git credential fill+API（**仓库转私有后匿名 API 404**）
> - git 显示层 GBK 乱码≠存储损坏（python utf-8 解码判定，严禁显示层 amend）
> - UI 数值断言取 HD 收敛终值；toast 1.5s 自清空（MutationObserver）；慢 runner 环境红三连定性链=ubuntu/macos/本地绿+零源码变更+跨提交同签名
> - git add 显式路径（agent_memory/ 与 plans/ 已入库，.zcode/ 已 ignore）
>
> ### 多设备纪律（machine-facts.md=新设备第一读）
> 开工 `git pull` → 干活 → 收尾 push；hub=导师部署仅工位接入；大文件走文件中心不走 git。
>
> ---
>
> ## 详细历史
>
> - 2026-10 月全月详细记录（二十三轮提交总账/批次表/坑与铁律）：archive/progress_2026-10.md
> - 2026-10-01 之前：git log 可查；早期会话批次详录（archive/progress_2026-10-01_02_session48batches.md 等）原在 tpms/agent_memory/ 残留目录，**该目录从未入库（gitignored），2026-11-01 整理时已删除、不可从 git 恢复**——早期细节以本 archive/progress_2026-10.md 与 git 提交消息为准。
