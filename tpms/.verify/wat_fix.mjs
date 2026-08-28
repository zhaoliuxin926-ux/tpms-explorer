// wat_fix.mjs —— 从文件提取 x 块，机械派生 y/z/p'，逐段验证后重组（栈平衡兜底校验）
import { readFileSync, writeFileSync } from 'node:fs';
import initWabt from 'wabt';
const wabt = await initWabt();
let src = readFileSync('../tpms-platform/src/physics/shaders/navier-stokes.wat', 'utf8').replace(/[^\x00-\x7F]/g, ' ');

const sweepIdx = src.indexOf('(func (export "sweep")');
const head = src.slice(0, sweepIdx);
const body = src.slice(sweepIdx);

// 提取 u'x 块（vn load 到 store）
const marker = 'f64.load\n        local.set $vn';
const firstLoad = body.indexOf(marker);
const xStart = body.indexOf('global.get $uo', firstLoad - 400);
const xEnd = body.indexOf('f64.store', firstLoad) + 'f64.store'.length;
const xBlock = body.slice(xStart, xEnd);
console.log('xBlock extracted:', xBlock.length, 'chars');

// 派生：轴常量与场替换
function derive(block, axisConst, addConst, fx, gx, lap) {
  let t = block
    .replace('i32.const 3\n        i32.shl\n        i32.add\n        f64.load\n        local.set $vn',
             `i32.const ${axisConst}\n        i32.${addConst}\n        i32.const 3\n        i32.shl\n        i32.add\n        f64.load\n        local.set $vn`)
    .replace(new RegExp(`i32\\.const 3\\n        i32\\.shl`, 'g'), `i32.const ${axisConst}\n        i32.${addConst}\n        i32.const 3\n        i32.shl`);
  // 只应改前两处地址（load 地址 + store 地址）——上面全局替换会把 load 的改两次，改为手动两步：
  return t;
}

// 简化：直接构造三个块（与 x 块同构）
function mkBlock(axisConst, addConst, fx, gx, lap) {
  return `        global.get $uo
        global.get $ci
        i32.const 3
        i32.mul
${axisConst !== null ? `        i32.const ${axisConst}
        i32.${addConst}
` : ''}        i32.const 3
        i32.shl
        i32.add
        f64.load
        local.set $vn
        local.get $unoP
        global.get $ci
        i32.const 3
        i32.mul
${axisConst !== null ? `        i32.const ${axisConst}
        i32.${addConst}
` : ''}        i32.const 3
        i32.shl
        i32.add
        local.get $vn
${fx ? `        local.get $fx
` : ''}        global.get $gx
        f64.sub
        local.get $nu
        global.get ${lap}
        f64.mul
        f64.add
        local.get $dt
        f64.mul
        f64.add
        f64.store`;
}

const bx = mkBlock(null, null, '$fx', '$gx', '$lapx');
const by = mkBlock(1, 'add', null, '$gy', '$lapy');
const bz = mkBlock(2, 'add', null, '$gz', '$lapz');

// p' 块
const bp = `        local.get $poP
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
        f64.store`;

// 验证单独的 y 块
const tryV = async (name, s2) => {
  try {
    const buf = wabt.parseWat('t', s2).toBinary({}).buffer;
    await WebAssembly.instantiate(buf);
    console.log(name, 'OK');
    return true;
  } catch (e) { console.log(name, 'FAIL:', String(e.message).slice(28, 130)); return false; }
};

// 单块验证壳：sweep 只含该块（vn 先入栈、drop 收尾）
const shell = (blk) => `${head}${body.slice(0, body.indexOf('        i32.const 0\n        i32.const 1\n        call $doDir'))}
        f64.const 1
        local.set $vn
${blk}
        local.get $idx
        i32.const 1
        i32.add
        local.set $idx
        br $loop
      )
    )
  )
)
`;

// x 寻址 + y 场名
const bxYFields = bx.replace('        local.get $fx\n', '').replace('$gx', '$gy').replace('$lapx', '$lapy');
await tryV('shell-x-addr-y-fields', shell(bxYFields));
// y 寻址 + x 场名
const byXFields = by.replace('$gy', '$gx').replace('$lapy', '$lapx');
await tryV('shell-y-addr-x-fields', shell(byXFields));
await tryV('shell-x', shell(bx));
await tryV('shell-y', shell(by));
await tryV('shell-z', shell(bz));
await tryV('shell-p', shell(bp));

// 重组：body 中从首个 doDir call 到最后 f64.store 的整段替换
const dStart = body.indexOf('        i32.const 0\n        i32.const 1\n        call $doDir');
const dEnd = body.lastIndexOf('f64.store') + 'f64.store'.length;
const newBody = body.slice(0, dStart) + bx + '\n' + by + '\n' + bz + '\n' + bp + '\n' + body.slice(dEnd).replace('f64.store', '');
const full = head + newBody;
writeFileSync('../tpms-platform/src/physics/shaders/navier-stokes.wat.new', full, 'utf8');
await tryV('assembled', full);
process.exit(0);
