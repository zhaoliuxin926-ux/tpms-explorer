/** worker_bridge_audit.mjs —— Worker 请求生命周期回归审计 */

import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const entry = join(tmpdir(), 'tpms_worker_bridge_audit_entry.ts');
const bundle = join(tmpdir(), 'tpms_worker_bridge_audit_bundle.mjs');
writeFileSync(entry, `export * from ${JSON.stringify(join(PLATFORM, 'src/worker/worker-bridge.ts'))};`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
if (!existsSync(rolldown)) {
  console.error('rolldown 不存在:', rolldown);
  process.exit(1);
}
const built = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${bundle}"`, {
  shell: true,
  encoding: 'utf8',
});
if (built.status !== 0) {
  console.error('rolldown 打包失败:', built.stdout, built.stderr);
  process.exit(1);
}

const { WorkerBridge, WorkerRequestSupersededError, WorkerRequestTimeoutError } =
  await import(pathToFileURL(bundle));

class FakeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  terminated = false;
  posted = [];
  postMessage(message) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(response) {
    this.onmessage?.({ data: response });
  }
}

const params = {
  type: 'gyroid', iso: 0, periods: 1, resolution: 8, targetPorosity: 0.75,
  weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
  thickness: 1, gradientDir: 'z', hybrid: {
    enabled: false, typeB: 'diamond', blendFunction: 'sigmoid',
    blendCenter: 0, blendWidth: 1, axis: 'x',
  }, customFormula: '', preview: false,
};
const result = (id, type = 'result') => ({
  id, type, vertCount: 0, triCount: 0, porosityEstimate: 0.75,
  isoUsed: 0, resolution: 8, buildTimeMs: 1,
});

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const worker = new FakeWorker();
const bridge = new WorkerBridge(worker);
const first = bridge.buildAndWait(params, 200);
const firstId = worker.posted[0].id;
worker.emit(result(firstId));
const firstResult = await first;
check('成功响应 resolve', firstResult.id === firstId);

const second = bridge.buildAndWait(params, 200);
bridge.build(params);
let superseded = false;
try {
  await second;
} catch (err) {
  superseded = err instanceof WorkerRequestSupersededError;
}
check('新请求淘汰旧 Promise', superseded);

const fourth = bridge.buildAndWait(params, 200);
const fourthId = worker.posted.at(-1).id;
worker.emit({ ...result(fourthId, 'error'), error: 'bad formula' });
let workerError = false;
try {
  await fourth;
} catch (err) {
  workerError = err instanceof Error && err.message === 'bad formula';
}
check('Worker error reject', workerError);

const timeout = bridge.buildAndWait(params, 10);
let timedOut = false;
const timeoutId = worker.posted.at(-1).id;
try {
  await timeout;
} catch (err) {
  timedOut = err instanceof WorkerRequestTimeoutError;
}
check('超时 reject 且不挂起', timedOut);
let lateResultNotified = false;
bridge.setCallbacks(() => { lateResultNotified = true; }, () => {});
worker.emit(result(timeoutId));
check('超时推进请求世代并丢弃晚到响应', bridge.latestRequestId !== timeoutId && !lateResultNotified);

const afterTimeout = bridge.buildAndWait(params, 200);
const afterTimeoutId = worker.posted.at(-1).id;
worker.emit(result(afterTimeoutId));
let afterTimeoutResolved = false;
try {
  const response = await afterTimeout;
  afterTimeoutResolved = response.id === afterTimeoutId;
} catch { /* assertion below */ }
check('超时后新请求仍可正常 resolve', afterTimeoutResolved);

let cancelledNotified = false;
bridge.addResultListener((response) => { cancelledNotified = response.type === 'cancelled'; });
bridge.invalidate();
check('invalidate 释放 legacy listener', cancelledNotified);

bridge.terminate();
check('terminate 转发到底层 worker', worker.terminated);

const crashedWorker = new FakeWorker();
const crashedBridge = new WorkerBridge(crashedWorker);
let runtimeCallbackCount = 0;
let legacyFailureCount = 0;
let preventedCount = 0;
crashedBridge.setCallbacks(() => {}, (message) => {
  if (message === 'worker exploded') runtimeCallbackCount++;
});
const crashed = crashedBridge.buildAndWait(params, 200);
crashedBridge.addResultListener((response) => {
  if (response.type === 'error' && response.error === 'worker exploded') legacyFailureCount++;
});
crashedWorker.onerror?.({
  message: 'worker exploded',
  preventDefault() { preventedCount++; },
});
// Browsers may emit a related messageerror after error; it must not report the
// same failed request twice or invoke a listener that was already drained.
crashedWorker.onmessageerror?.({ preventDefault() { preventedCount++; } });
let runtimeRejected = false;
try {
  await crashed;
} catch (err) {
  runtimeRejected = err instanceof Error && err.message === 'worker exploded';
}
check('Worker runtime error 立即 reject', runtimeRejected);
check('runtime error 回调/legacy listener 去重且阻止默认处理',
  runtimeCallbackCount === 1 && legacyFailureCount === 1 && preventedCount === 2);

const messageWorker = new FakeWorker();
const messageBridge = new WorkerBridge(messageWorker);
const malformed = messageBridge.buildAndWait(params, 200);
messageWorker.onmessageerror?.({ preventDefault() {} });
let messageRejected = false;
try {
  await malformed;
} catch (err) {
  messageRejected = err instanceof Error && err.message === 'Worker response could not be deserialized';
}
check('Worker messageerror 立即 reject', messageRejected);

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  if (pass < 11) { console.error('GUARD FAIL: 断言执行数 ' + pass + ' < 基线 11（恒真/集体跳过防护，2026-09-04 审查纳管）'); process.exit(1); }
if (fail) process.exit(1);
