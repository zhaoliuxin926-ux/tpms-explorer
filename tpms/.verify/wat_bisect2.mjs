// wat_bisect2.mjs —— 增量构建 sweep 定位 V8 拒绝点
import { readFileSync } from 'node:fs';
import initWabt from 'wabt';

const wabt = await initWabt();
let src = readFileSync('../tpms-platform/src/physics/shaders/navier-stokes.wat', 'utf8').replace(/[^\x00-\x7F]/g, ' ');

// 切片：头部（memory+globals+nbidx+doDir 到 sweep 前）
const sweepIdx = src.indexOf('(func (export "sweep")');
const head = src.slice(0, sweepIdx);

// sweep 参数与全局设置
const prolog = `  (func (export "sweep")
    (param $uoP i32) (param $unoP i32) (param $poP i32) (param $moP i32)
    (param $nx i32) (param $ny i32) (param $nz i32) (param $periodic i32)
    (param $dt f64) (param $nu f64) (param $fx f64) (param $beta f64)
    (local $idx i32) (local $n i32) (local $isfl i32) (local $vn f64)
    local.get $uoP
    global.set $uo
    local.get $nx
    global.set $gnx
    local.get $nx
    local.get $ny
    i32.mul
    local.get $nz
    i32.mul
    local.set $n
    i32.const 0
    local.set $idx
    (block $done
      (loop $loop
        local.get $idx
        local.get $n
        i32.ge_s
        br_if $done
        local.get $idx
        global.set $ci
`;

const solidBranch = `        local.get $moP
        local.get $idx
        i32.add
        i32.load8_u
        local.set $isfl
        local.get $isfl
        i32.eqz
        if
          local.get $idx
          i32.const 1
          i32.add
          local.set $idx
          br $loop
        end
`;

const doDirCalls = `        i32.const 0
        i32.const 1
        call $doDir
`;

const uRead = `        global.get $uo
        global.get $ci
        i32.const 3
        i32.mul
        i32.const 3
        i32.shl
        i32.add
        f64.load
        local.set $vn
`;

const uWriteX = `        local.get $unoP
        global.get $ci
        i32.const 3
        i32.mul
        i32.const 3
        i32.shl
        i32.add
        local.get $vn
        local.get $fx
        global.get $gx
        f64.sub
        local.get $nu
        global.get $lapx
        f64.mul
        f64.add
        local.get $dt
        f64.mul
        f64.add
        f64.store
`;

const tail = `        local.get $idx
        i32.const 1
        i32.add
        local.set $idx
        br $loop
      )
    )
  )
)
`;

const tryV = async (name, body) => {
  const full = head + prolog + body + tail;
  try {
    const buf = wabt.parseWat('t', full).toBinary({}).buffer;
    await WebAssembly.instantiate(buf);
    console.log(name, 'OK');
    return true;
  } catch (e) {
    console.log(name, 'FAIL:', String(e.message).slice(28, 120));
    return false;
  }
};

console.log('== 增量构建 ==');
await tryV('v0-empty', '');
await tryV('v1-solid', solidBranch);
await tryV('v2-dodir', solidBranch + doDirCalls);
await tryV('v3-uread', solidBranch + doDirCalls + uRead);
await tryV('v4-uwx', solidBranch + doDirCalls + uRead + uWriteX);

const uReadY = `        global.get $uo
        global.get $ci
        i32.const 3
        i32.mul
        i32.const 1
        i32.add
        i32.const 3
        i32.shl
        i32.add
        f64.load
        local.set $vn
`;

const uWriteY = `        local.get $unoP
        global.get $ci
        i32.const 3
        i32.mul
        i32.const 1
        i32.add
        i32.const 3
        i32.shl
        i32.add
        local.get $vn
        global.get $gy
        f64.sub
        local.get $nu
        global.get $lapy
        f64.mul
        f64.add
        local.get $dt
        f64.mul
        f64.add
        f64.store
`;

const uReadZ = `        global.get $uo
        global.get $ci
        i32.const 3
        i32.mul
        i32.const 2
        i32.add
        i32.const 3
        i32.shl
        i32.add
        f64.load
        local.set $vn
`;

const uWriteZ = `        local.get $unoP
        global.get $ci
        i32.const 3
        i32.mul
        i32.const 2
        i32.add
        i32.const 3
        i32.shl
        i32.add
        local.get $vn
        global.get $gz
        f64.sub
        local.get $nu
        global.get $lapz
        f64.mul
        f64.add
        local.get $dt
        f64.mul
        f64.add
        f64.store
`;

const pWrite = `        local.get $poP
        global.get $ci
        i32.const 3
        i32.shl
        i32.add
        local.get $poP
        global.get $ci
        i32.const 3
        i32.shl
        i32.add
        f64.load
        local.get $beta
        global.get $div
        f64.mul
        f64.sub
        f64.store
`;

await tryV('v5-uy', solidBranch + doDirCalls + uRead + uWriteX + uReadY + uWriteY);
await tryV('v6-uz', solidBranch + doDirCalls + uRead + uWriteX + uReadY + uWriteY + uReadZ + uWriteZ);
await tryV('v7-p', solidBranch + doDirCalls + uRead + uWriteX + uReadY + uWriteY + uReadZ + uWriteZ + pWrite);
process.exit(0);
