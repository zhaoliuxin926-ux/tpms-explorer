# -*- coding: utf-8 -*-
"""batch5 历史试验数据 → fit-batch 契约 CSV 转换（strain-stress 模式）。

红线：论文未发表原始数据不入仓库——转换产物写 sim/out/csv_hist/（gitignored），
本脚本本身入库（可复现转换逻辑，不携带数据）。

来源：D:/FEA_Bone_Scaffold/Compression_TestData/batch5/{K_x}/{n_x}.txt
原始：UTF-8 BOM 中文头（试验信息+表头"压缩应力 kN/mm² | 压缩应变 mm/mm"），
     两列制表符分隔，应力在前（col0）、应变在后（col1），kN/mm² → MPa ×1000。
契约输出：# source=lab-2022-history / # inputType=ss / # group=K_x
         strain,stress_MPa 表头 + 数据行。
"""
import sys
from pathlib import Path

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('D:/FEA_Bone_Scaffold/Compression_TestData/batch5')
DST = Path('sim/out/csv_hist')

groups = sorted(d.name for d in SRC.iterdir() if d.is_dir() and d.name.startswith('K_'))
DST.mkdir(parents=True, exist_ok=True)
n_ok = n_skip = 0
for g in groups:
    for f in sorted((SRC / g).glob('*.txt')):
        lines = f.read_text(encoding='utf-8-sig').splitlines()
        # 表头行：含"压缩应力"或制表符双列行——跳过头部非数据行（前 8 行左右）
        data = []
        for ln in lines:
            if '\t' not in ln:
                continue
            p = ln.split('\t')
            if len(p) < 2:
                continue
            try:
                stress_kn = float(p[0])   # col0 = 压缩应力 kN/mm²
                strain = float(p[1])      # col1 = 压缩应变 mm/mm
            except ValueError:
                continue
            data.append((strain, stress_kn * 1000.0))   # → MPa，列序换 strain,stress
        if len(data) < 10:
            n_skip += 1
            continue
        # 均匀抽稀 ≤400 点（原始 10887 点/0.6 应变超高密度，内核 Toe 弹性段检测窗口
        # 策略在其上失败——ISO 反演点数无需试验机原始采样率；保留首末点）
        if len(data) > 400:
            step = len(data) / 400.0
            data = [data[int(i * step)] for i in range(400)] + [data[-1]]
        stem = f.stem.lower().replace('_', '')
        outp = DST / f'{g.lower()}_{stem}.csv'
        with open(outp, 'w', encoding='utf-8', newline='') as w:
            w.write('# source=lab-2022-history\n')
            w.write('# inputType=ss\n')
            w.write(f'# group={g}\n')
            w.write('strain,stress_MPa\n')
            for s, sg in data:
                w.write(f'{s:.8g},{sg:.6g}\n')
        n_ok += 1
print(f'[OK] 转换 {n_ok} 件 → {DST}（跳过 {n_skip}）')
