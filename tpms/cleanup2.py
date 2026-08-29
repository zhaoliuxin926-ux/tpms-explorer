# -*- coding: utf-8 -*-
# cleanup.py v2 —— 两遍式历史垃圾清理（del_list 修正版）
import os, re, io, subprocess

HERE = 'D:/AI Project/tpms/tpms/.verify'
KEEP = {'run_ci_suite.mjs','run_all.mjs','parity_math.mjs','mesh_audit.mjs','webgpu_parity_audit.mjs',
        'gpu_plasticity_audit.mjs','digital_twin_compression_audit.mjs','wasm_navier_stokes_audit.mjs',
        'lpbf_thermo_mechanical_audit.mjs','nl_agent_audit.mjs','gen_ns_wat.mjs','gen_ns_wasm.mjs',
        'evaluator_check.mjs','fix_check.mjs','verify.mjs'}
RT_KEEP = {'verify_fixes.mjs','verify_followups.mjs','verify_tip_toggle.mjs'}

def referenced(name, corpus):
    pat = re.compile(r'[^A-Za-z0-9_]' + re.escape(name))
    return bool(pat.search(corpus))

def build_corpus():
    parts = []
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'shots', 'web')]
        for f in files:
            if f.endswith(('.mjs', '.json')):
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, HERE).replace(os.sep, '/')
                try:
                    parts.append((rel, io.open(fp, encoding='utf-8', errors='ignore').read()))
                except Exception:
                    pass
    main_ts = io.open('D:/AI Project/tpms/tpms/tpms-platform/src/main.ts', encoding='utf-8').read()
    parts.append(('__main_ts__', main_ts))
    return parts

def orphans():
    corpus_parts = build_corpus()
    del_list = []
    for f, _ in corpus_parts:
        if f in KEEP or f == '__main_ts__':
            continue
        base = os.path.basename(f)
        if base in RT_KEEP:
            continue
        rest = ''.join(src for name, src in corpus_parts if name != f)
        if not referenced(base, rest):
            del_list.append(f)
    return del_list

total = 0
for rnd in (1, 2, 3):
    batch = orphans()
    if not batch:
        break
    print(f'pass{rnd} 孤儿:', len(batch))
    for f in batch:
        fp = os.path.join(HERE, f)
        rel = os.path.relpath(fp, 'D:/AI Project/tpms').replace(os.sep, '/')
        if os.path.exists(fp):
            subprocess.run(['git', 'rm', '-q', '--cached', rel], cwd='D:/AI Project/tpms')
            os.remove(fp)
            total += 1
print('共删除:', total)
print('剩余:', sorted(f for f in os.listdir(HERE) if f.endswith(('.mjs', '.json'))))
