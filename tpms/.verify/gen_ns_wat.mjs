// gen_ns_wat.mjs —— 发射 navier-stokes.wat（确定性生成；先落盘再 wabt+V8 双验证）
// 用法：node gen_ns_wat.mjs   （在 .verify/ 下；wabt 已装）
import { writeFileSync } from 'node:fs';
import initWabt from 'wabt';

const wat = `(module
  (memory (export "mem") 1 4096)
  (global $ci (mut i32) (i32.const 0))
  (global $ux (mut f64) (f64.const 0))
  (global $uy (mut f64) (f64.const 0))
  (global $uz (mut f64) (f64.const 0))
  (global $pc (mut f64) (f64.const 0))
  (global $lapx (mut f64) (f64.const 0))
  (global $lapy (mut f64) (f64.const 0))
  (global $lapz (mut f64) (f64.const 0))
  (global $gx (mut f64) (f64.const 0))
  (global $gy (mut f64) (f64.const 0))
  (global $gz (mut f64) (f64.const 0))
  (global $div (mut f64) (f64.const 0))
  (global $uo (mut i32) (i32.const 0))
  (global $po (mut i32) (i32.const 0))
  (global $mo (mut i32) (i32.const 0))
  (global $gnx (mut i32) (i32.const 0))
  (global $gny (mut i32) (i32.const 0))
  (global $gnz (mut i32) (i32.const 0))
  (global $gper (mut i32) (i32.const 0))

  ;; nbidx(axis, dir) -> 邻居格索引；出界（非周期）返回 $ci 自身（零贡献口径）
  (func $nbidx (param $axis i32) (param $dir i32) (result i32)
    (local $coord i32) (local $stride i32) (local $lim i32) (local $a i32)
    i32.const 1
    local.set $stride
    global.get $ci
    local.set $coord
    global.get $gnx
    local.set $lim
    local.get $axis
    i32.const 1
    i32.eq
    if
      global.get $ci
      global.get $gnx
      i32.div_s
      local.set $coord
      global.get $gnx
      local.set $stride
      global.get $gny
      local.set $lim
    end
    local.get $axis
    i32.const 2
    i32.eq
    if
      global.get $ci
      global.get $gnx
      global.get $gny
      i32.mul
      i32.div_s
      local.set $coord
      global.get $gnx
      global.get $gny
      i32.mul
      local.set $stride
      global.get $gnz
      local.set $lim
    end
    local.get $coord
    local.get $dir
    i32.add
    local.set $a
    global.get $gper
    if
      local.get $a
      local.get $lim
      i32.rem_s
      local.get $lim
      i32.add
      local.get $lim
      i32.rem_s
      local.set $a
    end
    local.get $a
    i32.const 0
    i32.lt_s
    if
      global.get $ci
      return
    end
    local.get $a
    local.get $lim
    i32.ge_s
    if
      global.get $ci
      return
    end
    global.get $ci
    local.get $a
    local.get $coord
    i32.sub
    local.get $stride
    i32.mul
    i32.add
  )

  ;; doDir(axis, dir)：lap[axis] += un - uc；g[axis] += dp*dir/2；div += du*dir/2（仅 x）
  (func $doDir (param $axis i32) (param $dir i32)
    (local $n i32) (local $un f64) (local $uc f64) (local $du f64) (local $dp f64)
    local.get $axis
    local.get $dir
    call $nbidx
    local.set $n
    local.get $n
    global.get $ci
    i32.eq
    if
      return
    end
    global.get $uo
    local.get $n
    i32.const 3
    i32.mul
    local.get $axis
    i32.add
    i32.const 3
    i32.shl
    i32.add
    f64.load
    local.set $un
    global.get $uo
    global.get $ci
    i32.const 3
    i32.mul
    local.get $axis
    i32.add
    i32.const 3
    i32.shl
    i32.add
    f64.load
    local.set $uc
    global.get $po
    local.get $n
    i32.const 3
    i32.shl
    i32.add
    f64.load
    global.get $po
    global.get $ci
    i32.const 3
    i32.shl
    i32.add
    f64.load
    f64.sub
    local.set $dp
    local.get $un
    local.get $uc
    f64.sub
    local.set $du
    local.get $axis
    i32.const 0
    i32.eq
    if
      global.get $lapx
      local.get $du
      f64.add
      global.set $lapx
    end
    local.get $axis
    i32.const 1
    i32.eq
    if
      global.get $lapy
      local.get $du
      f64.add
      global.set $lapy
    end
    local.get $axis
    i32.const 2
    i32.eq
    if
      global.get $lapz
      local.get $du
      f64.add
      global.set $lapz
    end
    local.get $axis
    i32.const 0
    i32.eq
    if
      global.get $gx
      local.get $dp
      f64.const 0.5
      f64.mul
      local.get $dir
      f64.convert_i32_s
      f64.mul
      f64.add
      global.set $gx
    end
    local.get $axis
    i32.const 1
    i32.eq
    if
      global.get $gy
      local.get $dp
      f64.const 0.5
      f64.mul
      local.get $dir
      f64.convert_i32_s
      f64.mul
      f64.add
      global.set $gy
    end
    local.get $axis
    i32.const 2
    i32.eq
    if
      global.get $gz
      local.get $dp
      f64.const 0.5
      f64.mul
      local.get $dir
      f64.convert_i32_s
      f64.mul
      f64.add
      global.set $gz
    end
    local.get $axis
    i32.const 0
    i32.eq
    if
      global.get $div
      local.get $du
      f64.const 0.5
      f64.mul
      local.get $dir
      f64.convert_i32_s
      f64.mul
      f64.add
      global.set $div
    end
  )

  ;; sweep：全格 Jacobi 扫掠（u 读旧写 unew，p 原地）
  (func (export "sweep")
    (param $uoP i32) (param $unoP i32) (param $poP i32) (param $moP i32)
    (param $nx i32) (param $ny i32) (param $nz i32) (param $periodic i32)
    (param $dt f64) (param $nu f64) (param $fx f64) (param $beta f64)
    (local $idx i32) (local $n i32) (local $isfl i32) (local $vn f64)
    local.get $uoP
    global.set $uo
    local.get $poP
    global.set $po
    local.get $moP
    global.set $mo
    local.get $nx
    global.set $gnx
    local.get $ny
    global.set $gny
    local.get $nz
    global.set $gnz
    local.get $periodic
    global.set $gper
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
        local.get $moP
        local.get $idx
        i32.add
        i32.load8_u
        local.set $isfl
        local.get $isfl
        i32.eqz
        if
          local.get $unoP
          local.get $idx
          i32.const 3
          i32.mul
          i32.const 3
          i32.shl
          i32.add
          f64.const 0
          f64.store
          local.get $unoP
          local.get $idx
          i32.const 3
          i32.mul
          i32.const 1
          i32.add
          i32.const 3
          i32.shl
          i32.add
          f64.const 0
          f64.store
          local.get $unoP
          local.get $idx
          i32.const 3
          i32.mul
          i32.const 2
          i32.add
          i32.const 3
          i32.shl
          i32.add
          f64.const 0
          f64.store
          local.get $poP
          local.get $idx
          i32.const 3
          i32.shl
          i32.add
          local.get $poP
          local.get $idx
          i32.const 3
          i32.shl
          i32.add
          f64.load
          f64.store
          local.get $idx
          i32.const 1
          i32.add
          local.set $idx
          br $loop
        end
        i32.const 0
        i32.const 1
        call $doDir
        i32.const 0
        i32.const -1
        call $doDir
        i32.const 1
        i32.const 1
        call $doDir
        i32.const 1
        i32.const -1
        call $doDir
        i32.const 2
        i32.const 1
        call $doDir
        i32.const 2
        i32.const -1
        call $doDir
        global.get $uo
        global.get $ci
        i32.const 3
        i32.mul
        i32.const 3
        i32.shl
        i32.add
        f64.load
        local.set $vn
        local.get $unoP
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
        global.get $uo
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
        local.get $unoP
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
        global.get $uo
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
        local.get $unoP
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
        local.get $poP
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

writeFileSync('../tpms-platform/src/physics/shaders/navier-stokes.wat', wat, 'utf8');
const wabt = await initWabt();
const clean = wat.replace(/[^\x00-\x7F]/g, ' ');
try {
  const buf = wabt.parseWat('ns.wat', clean).toBinary({}).buffer;
  await WebAssembly.instantiate(buf);
  console.log('wabt+V8 OK, bytes:', buf.length);
  console.log('written navier-stokes.wat');
} catch (e) {
  console.log('VALIDATE FAIL:', String(e.message).split('\n').slice(0, 6).join(' | '));
  process.exit(1);
}
