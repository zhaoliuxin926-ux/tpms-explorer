# 你的 WGSL 从未被执行过——一个 secure context 静默陷阱的排查实录

> 数字与命令均可在本仓库复现：CI run 36539049138 的 ubuntu artifact（1.89e-4 的原始取证）与 36542586368（修复后三平台绿），门禁 `webgpu_parity_audit.mjs` [I] 段。本文粘贴版在 `docs/blog/publish/` 同名镜像（`node tpms/agent/sync-publish.mjs --check` 校验零漂移）。

## 起点：一个"从未被执行"的挂账

TPMS Explorer 有 46 道 CI 门禁，其中一道叫"WebGPU 数学同源审计"：把三周期极小曲面公式编译成 WGSL compute shader，声称与 CPU 双精度参考实现对拍。红队审查那周，这条挂账被翻了出来：

**对拍确实存在，但对拍的另一端是 JavaScript 写的"模拟 GPU 内核"——真正的 WGSL 文本从未被任何 GPU 编译和执行过。** 门禁绿了将近四周，绿的只是"WGSL 字符串看起来语法正确"。

这类挂账的修法看起来很简单：在 CI 里真跑一次浏览器，把 WGSL 喂给 WebGPU，回读结果比对。于是有了接下来三层的坑。

## 第一层：四组 Chrome flag 全部 adapter:null

用 Playwright 起 headless Chrome，`navigator.gpu.requestAdapter()` 拿适配器。第一次跑：

```text
--enable-unsafe-webgpu --use-angle=swiftshader --enable-unsafe-swiftshader → adapter:null
--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --enable-unsafe-swiftshader → adapter:null
（另两组同样失败）→ 四组 flag 全军覆没
```

自然的归因：headless 限制、SwiftShader 没启用、playwright 默认参数里有 `--disable-gpu`。逐一排除——显式剔除默认 flag、换自带 chromium、甚至非 headless 模式：全部 `adapter:null`。

**转折点是一个更基础的检查**：不再看 adapter，先看 `navigator.gpu` 本身——

```js
navigator.gpu  // undefined
```

不是"拿不到适配器"，是 **WebGPU API 整个不存在**。打开 `chrome://gpu`：零报错、零提示，像这个 API 从未被发明过。

## 第二层：secure context——about:blank 上 WebGPU 不暴露

根因：WebGPU 规范要求 **secure context**（HTTPS 或 localhost）。而 Playwright 的 `page.setContent(html)` 创建的是 about:blank 页面——它继承的 origin 是空的，**不属于 secure context**，于是 `navigator.gpu` 这个属性根本不会被挂到 window 上。

这就是为什么所有 flag 组合都"无效"：我们一直在调参一个根本没被暴露的 API。也是为什么这个坑如此安静：没有报错、没有警告、`chrome://gpu` 里一片祥和。

修复是一行概念、三行代码：起一个本地 HTTP 服务，用 `page.goto('http://127.0.0.1:PORT/')` 真正导航（127.0.0.1 是 secure context），API 就出现了：

```text
[chrome headless] => OK amd/gcn-4   ← 本机 RX 580 真 GPU
```

headless 都不需要放弃。**教训：浏览器 API 探测必须先确认页面 origin 的 secure context 状态，`setContent` 是 WebGPU/摄像头/剪贴板等一批 API 的共同静默陷阱。**

## 第三层：真执行成功之后，坑才刚开始

API 通了，17³ 格点 gyroid 场真跑起来，本机 GPU 对拍最坏偏差 1.12e-6——收工？CI 先教做人：

- **SwiftShader 的 sin/cos 是多项式逼近**。ubuntu runner 上走软件光栅真执行，最坏偏差飙到 1.89e-4——是真 GPU 的 170 倍。阈值若按"我本机"定 2e-5，CI 必红。**对拍阈值要按最差后端实测定标**，不能按开发机。
- **catch 块吞掉了真执行失败**。第一版把整个 [I] 段包在一个 try/catch 里，异常降级为 SKIP——包括断言代码自身的 `ReferenceError`（真实发生过：函数名写错，被吞成 SKIP，门禁照样绿）。修正后的结构：**环境探测失败=SKIP 合法；设备已确认后的执行段异常=FAIL**，并注入错误验证过 FAIL 路径真的会红。
- **能力在场却失败要显式红**。Chrome 路径漂移（比如浏览器升级换目录）时，真执行会静默退化成 SKIP，而断言基线恰好不炸。加了一条"chrome 二进制在场却 launch 失败=能力漂移=FAIL"——同时学会了区分：GitHub 的 Windows runner 预装了 Chrome 但虚拟机没有 WebGPU 后端，adapter 为 null 是环境真实上限，合法 SKIP。

## 可迁移清单

1. 浏览器新 API 探测前先 `window.isSecureContext`；`setContent`/`about:blank` 会让 API 静默消失，且 `chrome://gpu` 不会告诉你。
2. localhost / 127.0.0.1 是 secure context——本地起 HTTP 服务再 `goto`，比研究 flag 组合值得。
3. 数值对拍阈值按**最慢/最软的后端**定标（本例：软件光栅的超越函数误差是真 GPU 的 170 倍）。
4. "环境不可用就跳过"的 catch 要拆两层：探测失败可以 SKIP，执行失败必须 FAIL——否则你的测试框架会替你把 bug 藏起来。
5. 挂账三个月的"未验证"宣称，值得真的去验证一次：这次排查的最终产物是一道在真 GPU 和软件光栅器上都真执行的 CI 门，以及这篇博客。

（完）
