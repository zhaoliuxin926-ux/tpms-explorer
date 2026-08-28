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
    local.get $dt
    local.set $vn
`;
const tail = `    ;; end
  )
)
`;
const tryV = async (name, body) => {
  try {
    const buf = wabt.parseWat('t', head + base + body + tail).toBinary({}).buffer;
    await WebAssembly.instantiate(buf);
    console.log(name, 'OK');
  } catch (e) { console.log(name, 'FAIL:', String(e.message).slice(28, 120)); }
};
await tryV('a-sub', '    local.get $vn\n    global.get $gy\n    f64.sub\n');
await tryV('b-sub-mul', '    local.get $vn\n    global.get $gy\n    f64.sub\n    local.get $nu\n    global.get $lapy\n    f64.mul\n');
await tryV('c-full-expr', '    local.get $vn\n    global.get $gy\n    f64.sub\n    local.get $nu\n    global.get $lapy\n    f64.mul\n    f64.add\n    local.get $dt\n    f64.mul\n    f64.add\n    drop\n');
process.exit(0);
