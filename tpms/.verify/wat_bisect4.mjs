// wat_bisect4.mjs —— y 块微二分（每个用例栈平衡）
import { readFileSync } from 'node:fs';
import initWabt from 'wabt';
const wabt = await initWabt();
let src = readFileSync('../tpms-platform/src/physics/shaders/navier-stokes.wat', 'utf8').replace(/[^\x00-\x7F]/g, ' ');
const sweepIdx = src.indexOf('(func (export "sweep")');
const head = src.slice(0, sweepIdx);
const base = `  (func (export "sweep")
    (param $uoP i32) (param $unoP i32) (param $poP i32) (param $moP i32)
    (param $nx i32) (param $ny i32) (param $nz i32) (param $periodic i32)
    (param $dt f64) (param $nu f64) (param $fx f64) (param $beta f64)
    (local $idx i32) (local $n i32) (local $isfl i32) (local $vn f64)
    local.get $nx
    global.set $gnx
`;
const tail = '  )\n)\n';
const tryV = async (name, body) => {
  try {
    const buf = wabt.parseWat('t', head + base + body + tail).toBinary({}).buffer;
    await WebAssembly.instantiate(buf);
    console.log(name, 'OK');
  } catch (e) { console.log(name, 'FAIL:', String(e.message).slice(28, 130)); }
};

// 每个用例以恰好 1 个 f64 在栈上结束（函数尾隐式丢弃由 tail 的 ) 不允许——用 drop 收尾）
await tryV('t1-addr', `        global.get $ci
        i32.const 3
        i32.mul
        i32.const 1
        i32.add
        i32.const 3
        i32.shl
        i32.const 0
        i32.add
        drop
        f64.const 1
        drop
`);
await tryV('t2-vn-gy', `        f64.const 2
        global.get $gy
        f64.sub
        drop
`);
await tryV('t3-vn-nu-lapy', `        f64.const 2
        local.get $nu
        global.get $lapy
        f64.mul
        f64.add
        drop
`);
await tryV('t4-expr-dt', `        f64.const 2
        global.get $gy
        f64.sub
        local.get $nu
        global.get $lapy
        f64.mul
        f64.add
        local.get $dt
        f64.mul
        f64.add
        drop
`);
await tryV('t5-unoP-addr', `        local.get $unoP
        global.get $ci
        i32.const 3
        i32.mul
        i32.const 1
        i32.add
        i32.const 3
        i32.shl
        i32.add
        drop
`);
process.exit(0);
