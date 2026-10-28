# 跨设备机器事实（多设备协作补录 · 2026-10-26）

> 目的：换机器的会话缺一块本机背景（工位 memory 机器特定不同步）。本文件随仓库走，
> 只记**跨设备有用的事实**；单机细节留在各自 memory。私有仓库，可含内网拓扑
> （172.26/172.30 段外网不可路由）。

## 网络拓扑（工位机视角实测 2026-10-26）

| 角色 | 地址 | 说明 |
|---|---|---|
| 工位机（zlx 身份） | 172.26.166.130 | 本仓库所在开发机 |
| 记忆中心 hub | http://172.26.166.58:8008（主）/ 8008/<host>/mcp 分主机 | 跑在 QI-7950X 上，**不在工位机**——hub 所在机关机时③层不可用 |
| 文件中心 SMB | \\172.26.166.108\AI-Center（hxh 机） | 公开账号见 hub_info；大文件资产走这里不走 git |
| GitHub | zhaoliuxin926-ux/tpms-explorer（私有） | 代码+交接层唯一真源 |

- **③层（记忆中心）仅工位机接入**（用户定案 2026-10-26：hub 为导师部署，工位接入，宿舍
  电脑不接）——宿舍侧同步只走①②层（GitHub）。宿舍侧项目的经验沉淀（如仿真管线调研）
  经 GitHub 提交入库，不走 hub/SMB（宿舍可能不在同一内网，SMB 亦不保证可达）。
- hub 曾出现 MCP "Session not found" 长期失效（2026-10-25~26）——需 hub 侧重启服务；
  失效期间按纪律静默跳过，汇报内容留痕 progress.md 事后补报。

## 凭证纪律（跨机器不变）

- 智谱 key：**只经环境变量**（TPMS_LLM_KEY/BASE_URL/REG_PROVIDER 三件套，漏第三个=
  openai 协议打 anthropic 端点全 FAIL）；key 权威来源=用户本人，任何文档不落盘。
- Gitea / Nextcloud / SMB 凭证：记忆中心有记录——`search_memory_semantic("<服务名> 凭证
  token 端点")`；确无记录才问用户。
- GitHub push：git credential（HTTPS+PAT）；推送超时用
  `git -c http.postBuffer=524288000 -c http.version=HTTP/1.1 push`。

## 环境差异备忘

- Node：工位 25.2.1 / CI 22——跨版本断言只钉语义不钉错误码（spawnSync 行为差异在案）。
- Shell：Git Bash；沙箱 cd 常失效一律绝对路径；**改源码用 Write/Edit 工具**（bash 内嵌
  引号转义会损坏文件）；python-heredoc 多层转义不可靠，含反斜杠内容一律字面 Edit。
- `git commit` 长中文消息：Write 写 UTF-8 文件 + `commit -F`；**bash 显示乱码≠存储损坏**
  （判定用 `git cat-file | od -c` 或 GitHub API，严禁见乱码就 amend）。
- 大文件资产（STL/ODB/网格）：specimens/* 已被 .gitignore 挡住（README 例外）——
  新大资产一律走文件中心，git 只管代码与文档。

## 交接文档通道（本批定案）

`agent_memory/`（本目录）+ `plans/` 自 2026-10-26 起随仓库跟踪：交接上下文随 git 走，
任何设备 clone 即得完整开工指引（progress.md 开工指引=每次会话第一步）。
