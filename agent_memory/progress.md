# progress — 当前任务进度

> ## 🔖 新会话开工指引（2026-11-02 · 全仓整理轮）
>
> **仓库态**：main=**5bbb4da 已推送**（全仓整理轮：探针清理/RELEASE_NOTES 归档/agent_memory 收编/钉值链 331→349/文案修正；对抗式审查九项复核+必修项全落地）。工作树净。
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
> ### diamond 刚度入库轮 + 探针不可行记录（2026-11-02，紧随整理轮）
> - **diamond 刚度入库落地**（Codex 第四轮批准"刚度单独放行"前提全满足）：C1_MAP[diamond] 0.42→0.8509 + GA_EXPONENT_MAP[diamond]=2.1979（名义口径，与 gyroid 代码先例一致；实测口径 0.7871/2.0709 双披露）；tpms.mjs estimate model/feaCalibration diamond 分支；selftest 标度律锚 (0.5/0.2)^2.1979 + schwarz 缺省档 ρ² 不变量锚（62→63）；FEA_STRENGTH 未加（强度两点暂不发幂律）。本地 48 门全量绿（SUITE_EXIT=0）。
> - **条件匹配 DT 探针不可行实锤**：probe_dt_fea_matched k2R24 单档 P=0.6 >130min CPU 未完成（进程满负荷非挂死；tol 1e-5×13,824 体素×32 步 PCG 代价超预期；11-01"后台跑中"未回填实为同一不可行性）。四选项挂 Codex 表态（collab/codex/ 回执），本机不再自行重试。
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
