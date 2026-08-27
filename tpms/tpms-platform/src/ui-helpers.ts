/**
 * UI 辅助函数与静态数据
 * 负责公式显示、提示栏、预设教学卡、术语解释层等纯 UI 逻辑。
 */

// import type { TpmType } from './types'; // not used directly

export const LABEL: Record<string, string> = {
  gyroid: 'Gyroid',
  diamond: 'Diamond',
  schwarz: 'Schwarz P',
  neovius: 'Neovius',
  iwp: 'I-WP',
  frd: 'F-RD',
  lidinoid: 'Lidinoid',
  splitp: 'Split-P',
};

export const MATERIAL_LABEL: Record<string, string> = {
  auto: '结构配色',
  tc4: 'TC4 钛合金',
  polymer: 'PLLA/PLA 高分子',
  thermal: '高导热复合材',
};

export const FORMULA: Record<string, string> = {
  gyroid: 'sin x · cos y + sin y · cos z + sin z · cos x',
  diamond: 'sin x sin y sin z + sin x cos y cos z + cos x sin y cos z + cos x cos y sin z',
  schwarz: 'cos x + cos y + cos z',
  neovius: '3(cos x + cos y + cos z) + 4 cos x cos y cos z',
  iwp: '2(cos x cos y + cos y cos z + cos z cos x) − (cos 2x + cos 2y + cos 2z)',
  frd: '4 cos x cos y cos z − (cos 2x cos 2y + cos 2y cos 2z + cos 2z cos 2x)',
  lidinoid: '0.5(2 sin x cos x cos y sin z + 2 sin y cos y cos z sin x + 2 sin z cos z cos x sin y) − 0.5(cos 2x cos 2y + cos 2y cos 2z + cos 2z cos 2x)',
  splitp: '1.1(2 sin x cos x cos y sin z + 2 sin x sin y cos y cos z + 2 cos x sin y sin z cos z) − 0.2(cos 2x cos 2y + cos 2y cos 2z + cos 2z cos 2x) − 0.4(cos 2x + cos 2y + cos 2z)',
};

export const WEIGHT_TERMS: Record<string, [string, string, number][]> = {
  gyroid:  [['sin x · cos y', 'a', 1], ['sin y · cos z', 'b', 1], ['sin z · cos x', 'c', 1]],
  diamond: [['sin x · sin y · sin z', 'a', 1], ['sin x · cos y · cos z', 'b', 1], ['cos x · sin y · cos z', 'c', 1], ['cos x · cos y · sin z', 'd', 1]],
  schwarz: [['cos x', 'a', 1], ['cos y', 'b', 1], ['cos z', 'c', 1]],
  neovius: [['3(cos x + cos y + cos z)', 'a', 1], ['4 cos x cos y cos z', 'b', 1]],
  iwp:     [['2(cos x cos y + cos y cos z + cos z cos x)', 'a', 1], ['cos 2x + cos 2y + cos 2z', 'b', -1]],
  frd:     [['4 cos x cos y cos z', 'a', 1], ['cos 2x cos 2y + cos 2y cos 2z + cos 2z cos 2x', 'b', -1]],
  lidinoid: [['2 sin x cos x cos y sin z + 2 sin y cos y cos z sin x + 2 sin z cos z cos x sin y', 'a', 0.5], ['cos 2x cos 2y + cos 2y cos 2z + cos 2z cos 2x', 'b', -0.5]],
  splitp:  [['2 sin x cos x cos y sin z + 2 sin x sin y cos y cos z + 2 cos x sin y sin z cos z', 'a', 1.1], ['cos 2x cos 2y + cos 2y cos 2z + cos 2z cos 2x', 'b', -0.2], ['cos 2x + cos 2y + cos 2z', 'c', -0.4]],
};

export const MODEL_DESC: Record<string, string> = {
  surface: '壳模型（Surface）：提取 TPMS 等值面薄壳，展示曲面几何与拓扑。最接近 3D 打印中的薄壁表示，可观察真实曲面形貌。',
  strut:   '杆模型（Lattice）：同一等值面网格的线框渲染视角，便于观察连接拓扑与孔道走向。它不改变几何，导出的仍是完整曲面（非杆件桁架点阵）。',
  solid:   '实体模型（Solid）：不透明的实体填充表示，模拟最终制造件外观。真实壁厚仅在“等厚双壳/梯度双壳”结构下生效，实体网络模式由孔隙率决定材料占比。',
};

export const PRESET_TEACH: Record<string, {
  ic: string;
  grad: string;
  title: string;
  body: string;
  chain: [string, string][];
}> = {
  bone: {
    ic: '🦴',
    grad: 'linear-gradient(140deg,#6366f1,#8b5cf6)',
    title: '仿生骨支架 · 为什么这样配？',
    body: '骨组织需要“长进去”的空间和接近人骨的力学环境，所以每个参数都围绕“连通 + 高孔隙 + 生物相容”选择：',
    chain: [
      ['Gyroid', '连续螺旋通道，孔隙全连通，利于骨长入与营养输运'],
      ['70% 高孔隙', '给细胞和组织留足空间，接近松质骨孔隙水平'],
      ['圆柱容器', '贴合骨植入物 / 填充物的轴对称外形'],
      ['TC4 钛合金', '生物相容性最好的医用金属之一'],
      ['梯度双壳', '壁厚沿 Z 轴渐变，底部致密承力、顶部疏松促骨长入'],
    ],
  },
  lightweight: {
    ic: '⚙️',
    grad: 'linear-gradient(140deg,#f59e0b,#f97316)',
    title: '轻量化零件 · 为什么这样配？',
    body: '轻量化的核心是“该省的材料省，该留的强度留”，所以选了连接强、可承力的组合：',
    chain: [
      ['Gyroid', '连续螺旋通道全连通无节点应力集中，孔隙率拉到 90% 极致减重'],
      ['90% 高孔隙', '极轻量、高比刚度，适合对重量敏感的结构件'],
      ['杆模型', '同一曲面的线框渲染视角，便于观察连接拓扑（导出仍为完整曲面）'],
      ['PLLA 高分子', '低密度材料，进一步减重'],
    ],
  },
  heat: {
    ic: '🌡',
    grad: 'linear-gradient(140deg,#10b981,#14b8a6)',
    title: '散热结构 · 为什么这样配？',
    body: '换热效率取决于“表面积 × 流动”，这个预设把两者都拉满：',
    chain: [
      ['Schwarz P', '同体积下比表面积最大，通道规则无死角，换热效率最高'],
      ['等厚双壳', '(V-bias)²-(t/2)² 生成真实壁厚薄壳，最接近 3D 打印形态'],
      ['壳模型', '提取曲面几何，直接观察真实拓扑形貌'],
      ['高导热复合材', '快速把热量从热源导走'],
    ],
  },
  catalyst: {
    ic: '⚗️',
    grad: 'linear-gradient(140deg,#0ea5e9,#22d3ee)',
    title: '催化载体 · 为什么这样配？',
    body: '催化剂载体要在“反应面积”和“传质通畅”之间平衡，所以选了均匀通透的组合：',
    chain: [
      ['I-WP', '平衡曲面，孔隙分布均匀、渗透性佳，最大化反应接触面积'],
      ['80% 高孔隙', '留足流体通道，降低压降、提升转化率'],
      ['实体网络', '材料集中在等值面一侧，形成连续骨架承载催化剂涂层'],
      ['PLLA 高分子', '可牺牲模板，烧结后留下贯通多孔结构'],
    ],
  },
  acoustic: {
    ic: '🔊',
    grad: 'linear-gradient(140deg,#f59e0b,#f97316)',
    title: '声学超材料 · 为什么这样配？',
    body: '声学超材料靠周期性结构制造“带隙”来调控声波，所以强调规则与对称：',
    chain: [
      ['Gyroid', '周期性螺旋通道高度对称，易于在目标频段形成声子带隙'],
      ['等厚双壳', '壁厚均一，声学散射特性可预测、带隙更锐利'],
      ['壳模型', '提取真实曲面几何，直接观察周期拓扑'],
      ['PLLA 聚合物', '轻量、易成形，适合声学样品快速制备'],
    ],
  },
  electrode: {
    ic: '🔋',
    grad: 'linear-gradient(140deg,#ec4899,#f472b6)',
    title: '电池电极 · 为什么这样配？',
    body: '电极要在“离子通路”和“结构强度”之间取舍，所以选了宽通道强节点的组合：',
    chain: [
      ['Neovius', 'Schwarz P 伴随曲面，通道更宽、节点更强，利于离子迁移与活性物质负载'],
      ['78% 高孔隙', '提升电解液浸润与活性表面积'],
      ['实体网络', '连续导电骨架，保障电子传输路径'],
      ['TC4 钛合金', '高导电性金属骨架，兼作集流体'],
    ],
  },
};

export const GLOSSARY: Record<string, { title: string; body: string }> = {
  periodicity: {
    title: '三重周期性 · Triply Periodic',
    body: 'TPMS 的“TP”即 Triply Periodic：曲面沿 x、y、z 三个独立方向平移一个周期后与自身重合，像三维壁纸图案一样无限重复填充空间。这正是它能作为“晶胞”堆叠成任意尺寸多孔材料的原因——单元密度就是这个重复次数。',
  },
  'minimal-surface': {
    title: '极小曲面 · Minimal Surface',
    body: '“极小”指平均曲率处处为零——像绷在框上的肥皂膜，表面积在给定边界下取到局部极小。严格的 TPMS 是 C=0 处那张零厚度曲面；把一侧填成实体或加厚成壳后，看到的是它的“截断/增厚表示”，等值面也随之偏离严格的极小位置。',
  },
  'structure-vs-model': {
    title: '结构拓扑 vs 表现形式',
    body: '“结构拓扑”（实体网络/等厚双壳/梯度双壳）改变数学场与几何，是真实的结构参数；“表现形式”（壳/杆/实体）多数情况只改变渲染视角（透明度/线框），不改变几何本身。导出的网格始终是完整等值面。',
  },
  porosity: {
    title: '孔隙率 · Porosity',
    body: '结构里“空”的体积占比，数学上等于水平集一侧的体积份额——孔隙率滑块正是通过移动等值面 C 来控制它。75% 表示约四分之三是贯通孔洞。孔隙越高越轻、越通透，但承载能力下降；仿生骨支架常用 70–85%。',
  },
  'cell-density': {
    title: '单元密度 · Cell Size',
    body: 'TPMS 在空间中重复的周期数。密度越高，曲面“褶皱”越密、结构越精细，同时算力开销越大。注意：文献里的 cell size 通常指单个单胞尺寸，语义与此处相反，检索时用 unit cells / periodicity 更易对上。',
  },
  thickness: {
    title: '壁厚系数 · Thickness',
    body: '曲面薄壳的等效厚度倍率，仅在“等厚双壳 / 梯度双壳”结构下改变真实壁厚与材料占比；实体网络模式下材料占比由孔隙率滑块决定。',
  },
  slice: {
    title: '截面扫描 · Cross-section',
    body: '用虚拟平面沿 Z 轴逐层切开曲面，露出内部连通的孔道。拖到中部即可观察 TPMS 的三维通道网络。',
  },
  gradient: {
    title: '梯度双壳 · Gradient Shell',
    body: '梯度双壳模式下，壁厚沿 Z 轴高度线性渐变（底部厚/致密、顶部薄/疏松），形成功能梯度多孔结构。骨支架常用：致密底端承力，疏松顶端促骨长入。',
  },
  'iso-c': {
    title: '等值常数 C · Isovalue',
    body: '公式 f(x,y,z)=C 里的 C。场函数值恰好等于 C 的所有点连成一张面，就是等值面。调高 C 材料变多、孔隙变小——这正是孔隙率滑块背后的数学。',
  },
  weight: {
    title: '权重系数 · Weight',
    body: '公式每一项前的乘数（a/b/c/d），决定各数学项对曲面的相对贡献。在"当前曲面隐函数"区拖动权重滑块可实时调节，曲面随各项配比重塑。注意：非对称加权后的曲面是启发式变体，一般不再是严格的 TPMS/极小曲面成员。',
  },
};

let activeWeightKey: string | null = null;

export function setActiveWeightKey(key: string | null): void {
  activeWeightKey = key;
}

/** 高亮公式中与正在拖动的权重对应的项 */
export function highlightWeightTerm(key: string): void {
  setActiveWeightKey(key);
  document.querySelectorAll('#formula-display .term').forEach(t => {
    t.classList.toggle('term-hl', (t as HTMLElement).dataset.w === key);
  });
  document.querySelectorAll('.fw-tag').forEach(t => {
    t.classList.toggle('on', (t as HTMLElement).dataset.w === key);
  });
}

export function clearWeightHighlight(): void {
  setActiveWeightKey(null);
  document.querySelectorAll('#formula-display .term').forEach(t => t.classList.remove('term-hl'));
  document.querySelectorAll('.fw-tag').forEach(t => t.classList.remove('on'));
}

/**
 * 按当前曲面类型生成公式权重滑块行（对齐单文件版 refreshWeightUI）。
 * 每次类型/预设/undo 恢复后重建 DOM 并重新绑定事件；
 * onInput(idx, val) 在拖动中触发（预览重建），onChange 在松手时触发（正式重建 + 高清升级）。
 */
export function refreshWeightUI(
  type: string,
  weights: number[],
  onInput: (idx: number, val: number) => void,
  onChange: () => void,
): void {
  // 重建即清残留高亮（拖动中切类型时原滑块的 change 不会再触发）
  clearWeightHighlight();
  const terms = WEIGHT_TERMS[type];
  const panel = document.getElementById('formula-weights');
  const container = document.getElementById('weight-rows');
  if (!panel || !container) return;
  // custom 等无权重曲面：隐藏权重面板
  if (!terms || terms.length === 0) {
    panel.classList.remove('show');
    container.innerHTML = '';
    return;
  }
  panel.classList.add('show');
  container.innerHTML = terms
    .map(([label, key], i) => {
      const v = weights[i] ?? 1;
      return (
        `<div class="fw-row"><span class="fw-tag" data-w="${key}">${label}</span>` +
        `<input type="range" id="fw-${key}" min="0" max="2" value="${v}" step="0.1" role="slider" aria-label="权重 ${label}" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${v}">` +
        `<span class="fw-val" id="fw-${key}-val">${v.toFixed(1)}</span></div>`
      );
    })
    .join('');
  terms.forEach(([, key], i) => {
    const el = document.getElementById(`fw-${key}`) as HTMLInputElement | null;
    const valEl = document.getElementById(`fw-${key}-val`);
    if (!el || !valEl) return;
    el.addEventListener('input', () => {
      valEl.textContent = (+el.value).toFixed(1);
      el.setAttribute('aria-valuenow', el.value);
      highlightWeightTerm(key);
      onInput(i, +el.value);
    });
    el.addEventListener('change', () => {
      clearWeightHighlight();
      onChange();
    });
  });
}

/** 更新公式显示面板 */
export function updateFormulaDisplay(type: string, weights: number[], iso: number): void {
  const suffix = `<span class="c">${iso.toFixed(3)}</span>`;
  const fd = document.getElementById('formula-display');
  if (!fd) return;
  const terms = WEIGHT_TERMS[type];
  if (!terms || terms.length === 0) {
    fd.innerHTML = `${FORMULA[type] || ''} = ${suffix}`;
    return;
  }
  const term = (expr: string, key: string, val: number) => {
    const coef = Math.abs(val - 1) < 0.05 ? '' : `<span class="wcoef">${val.toFixed(1)}·</span>`;
    return `<span class="term${activeWeightKey === key ? ' term-hl' : ''}" data-w="${key}">${coef}${expr}</span>`;
  };
  fd.innerHTML =
    terms
      .map(([expr, key, sg], i) =>
        `<span class="eq-line">${i > 0 ? `<span class="eq-plus">${sg < 0 ? '−' : '+'}</span> ` : ''}${term(expr, key, weights[i] ?? 1)}</span>`,
      )
      .join('') + `<span class="eq-line eq-result">= ${suffix}</span>`;
}

/** 更新底部提示栏 */
export function updateTips(
  type: string,
  porosity: number,
  thickness: number,
  lastPorosityEstimate: number | null,
): void {
  const tip1 = document.getElementById('tip1');
  const tip2 = document.getElementById('tip2');
  const tip3 = document.getElementById('tip3');
  if (!tip1 || !tip2 || !tip3) return;

  const est =
    lastPorosityEstimate == null
      ? `目标孔隙率 ${porosity}%`
      : `目标 ${porosity}% / 估算 ${(lastPorosityEstimate * 100).toFixed(1)}%`;
  tip1.textContent =
    porosity > 80
      ? `${est}：高孔隙，利于细胞/组织长入，但力学强度下降`
      : porosity < 70
        ? `${est}：偏致密，力学支撑更好，内部可用空间有限`
        : `${est}：平衡区间，兼顾力学性能与功能性`;

  const typeDesc: Record<string, string> = {
    gyroid: 'Gyroid 各向同性、无自交，应力分布均匀，是骨支架首选',
    diamond: 'Diamond 高对称、节点连接强，承载与轻量化表现优异',
    schwarz: 'Schwarz P 表面积最大、连通性极佳，适合换热与催化',
    neovius: 'Neovius 是 Schwarz P 的伴随曲面，通道更宽、节点更显著，力学刚度更高',
    iwp: 'I-WP 平衡曲面，孔隙分布均匀，兼顾强度与渗透性，常用于催化剂载体',
    frd: 'F-RD 形态复杂、比表面积大，通道曲折，适合需要长停留时间的反应与传质场景',
    lidinoid: 'Lidinoid 螺旋对称极小曲面，通道比 Gyroid 更错综交织，比表面积高、连通性好，适合催化与过滤',
    splitp: 'Split-P 是 Schwarz P 的广义分裂变体，兼具 P 型规则性与双曲特征，力学与渗透综合表现均衡',
  };
  tip2.textContent = typeDesc[type] || '';

  tip3.textContent =
    thickness > 1.5
      ? `壁厚 ${thickness}：偏厚，坚固但增重`
      : thickness < 0.8
        ? `壁厚 ${thickness}：偏薄，轻量化好，注意制造极限`
        : `壁厚 ${thickness}：适中，强度与重量平衡`;
}

/** 更新结构模式描述 */
export function updateStructureDesc(mode: string): void {
  const el = document.getElementById('structure-desc');
  if (!el) return;
  const descs: Record<string, string> = {
    solid_network:
      '实体网络：把等值面一侧填成实体——截断 TPMS 的 solid 表示（严格的 TPMS 是 C=0 的零厚度极小曲面），材料集中在等值面一侧。',
    shell:
      '等厚双壳：(V−bias)²−(t/2)² 生成有真实壁厚的双层薄壳，更接近 3D 打印的实际制造形态。',
    gradient_shell:
      '梯度双壳：壁厚随 Z 轴高度线性渐变（底部厚/致密、顶部薄/疏松），形成功能梯度多孔结构设计。',
  };
  el.textContent = descs[mode] || '';
}

/** 更新标题与工程描述 */
export function updateBadges(type: string, model: string, material: string, structureMode: string): void {
  const structLabel: Record<string, string> = {
    solid_network: '实体网络',
    shell: '等厚双壳',
    gradient_shell: '梯度双壳',
  };
  document.title = `${LABEL[type] || type} · ${structLabel[structureMode] || structureMode} · TPMS 探索器`;

  const md = document.getElementById('model-desc');
  if (md) md.textContent = MODEL_DESC[model] || '';

  const ed = document.getElementById('engineering-desc');
  if (ed) {
    ed.textContent =
      structureMode === 'gradient_shell'
        ? `梯度双壳：壁厚沿 Z 轴渐变，形成功能梯度多孔结构。当前材料：${MATERIAL_LABEL[material] || material}。`
        : `当前结构：${structLabel[structureMode] || structureMode}，材料：${MATERIAL_LABEL[material] || material}。`;
  }
}

/** 预设教学卡 */
let presetCardTimer: ReturnType<typeof setTimeout> | null = null;

export function showPresetCard(key: string): void {
  const d = PRESET_TEACH[key];
  if (!d) return;
  const card = document.getElementById('preset-card');
  if (!card) return;
  const pcIc = document.getElementById('pc-ic');
  const pcTitle = document.getElementById('pc-title');
  const pcBody = document.getElementById('pc-body');
  const pcChain = document.getElementById('pc-chain');
  if (pcIc) {
    pcIc.textContent = d.ic;
    pcIc.style.background = d.grad;
  }
  if (pcTitle) pcTitle.textContent = d.title;
  if (pcBody) pcBody.textContent = d.body;
  if (pcChain) {
    pcChain.innerHTML = d.chain.map(([b, t]) => `<span class="pc-item"><b>${b}</b>　${t}</span>`).join('');
  }
  card.classList.add('show');
  card.setAttribute('aria-hidden', 'false');
  if (presetCardTimer) clearTimeout(presetCardTimer);
  presetCardTimer = setTimeout(hidePresetCard, 9000);
}

export function hidePresetCard(): void {
  const card = document.getElementById('preset-card');
  if (!card) return;
  card.classList.remove('show');
  card.setAttribute('aria-hidden', 'true');
}

/** 初始化预设教学卡事件 */
export function initPresetCard(): void {
  document.getElementById('pc-close')?.addEventListener('click', hidePresetCard);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePresetCard();
  });
}

/** 初始化术语解释层（glossary tooltip） */
export function initGlossary(): void {
  const gloss = document.getElementById('gloss');
  const gt = document.getElementById('gloss-title');
  const gb = document.getElementById('gloss-body');
  if (!gloss || !gt || !gb) return;

  const g = gloss;
  const titleEl = gt;
  const bodyEl = gb;
  let cur: string | null = null;

  function place(anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const gW = Math.min(300, window.innerWidth - 24);
    g.style.maxWidth = `${gW}px`;
    const gH = g.offsetHeight || 150;
    let left = r.left;
    if (left + gW > window.innerWidth - 12) left = window.innerWidth - gW - 12;
    if (left < 12) left = 12;
    let top = r.bottom + 8;
    if (top + gH > window.innerHeight - 12) top = r.top - gH - 8;
    if (top < 12) top = 12;
    g.style.left = `${left}px`;
    g.style.top = `${top}px`;
  }

  function show(term: string, anchor: HTMLElement): void {
    const d = GLOSSARY[term];
    if (!d) return;
    cur = term;
    titleEl.textContent = d.title;
    bodyEl.textContent = d.body;
    g.classList.add('show');
    g.setAttribute('aria-hidden', 'false');
    place(anchor);
  }

  function hide(): void {
    cur = null;
    g.classList.remove('show');
    g.setAttribute('aria-hidden', 'true');
  }

  document.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest('.gloss-term') as HTMLElement | null;
    if (!t) return;
    const term = t.dataset.term;
    if (!term) return;
    if (cur !== term) show(term, t);
    else place(t);
  });

  document.addEventListener('mouseout', (e) => {
    const t = (e.target as HTMLElement).closest('.gloss-term') as HTMLElement | null;
    if (!t) return;
    hide();
  });

  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('.gloss-term') as HTMLElement | null;
    if (t) {
      const term = t.dataset.term;
      if (term) show(term, t);
      return;
    }
    hide();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });

  window.addEventListener('resize', () => {
    if (cur) {
      const t = document.querySelector<HTMLElement>(`.gloss-term[data-term="${CSS.escape(cur)}"]`);
      if (t) place(t);
    }
  });
}

/** 底部建议条收纳（方向 E）：默认仅孔隙率建议，曲面/壁厚建议按需展开 */
export function initTipToggle(): void {
  const bar = document.getElementById('tipbar');
  const btn = document.getElementById('tip-toggle');
  if (!bar || !btn) return;
  btn.addEventListener('click', () => {
    const open = bar.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? '收起 ▾' : '建议 ▸';
  });
}

/** 新手引导（6 步交互式，对齐单文件版；spotlight 聚焦 + 演示驱动） */
const ONBOARD_KEY = 'tpms_onboard_v1';

interface OnboardStep {
  title: string;
  body: string;
  demo: { label: string; run: () => void } | null;
  target: () => HTMLElement | null;
}

export function initOnboard(): void {
  const spotEl = document.getElementById('ob-spot');
  const cardEl = document.getElementById('ob-card');
  if (!spotEl || !cardEl) return;
  const spot: HTMLElement = spotEl;
  const card: HTMLElement = cardEl;
  let idx = 0;
  let opened = false;

  function demoPorosity(): void {
    const el = document.getElementById('porosity') as HTMLInputElement | null;
    if (!el) return;
    el.value = '88';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function demoType(): void {
    (document.querySelector('[data-type="schwarz"]') as HTMLElement | null)?.click();
  }
  function demoSlice(): void {
    const el = document.getElementById('slice') as HTMLInputElement | null;
    if (!el) return;
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const steps: OnboardStep[] = [
    {
      title: '欢迎来到 TPMS 探索器',
      body: '你眼前这个就是 <b>Gyroid 螺旋曲面</b>——三重周期性极小曲面家族里最经典的一员，蝴蝶翅膀、细胞膜里都能找到它的影子。<b>三重周期</b>指它沿 x/y/z 三个方向平移后与自身重合，能像晶胞一样无限堆叠；<b>极小</b>指它像肥皂膜一样处处平均曲率为零。先<b>拖动画面</b>转一圈，感受它的立体形态。',
      demo: null,
      target: () => document.querySelector('.viewer'),
    },
    {
      title: '孔隙率：把“空”调出来',
      body: '<b>孔隙率</b>就是结构里有多少比例是“空的”。拖动这个滑块，看 Gyroid 怎么从致密变得通透——这正是骨支架、滤膜设计的核心旋钮。',
      demo: { label: '演示 · 调到高孔隙', run: demoPorosity },
      target: () => (document.getElementById('porosity') as HTMLElement | null)?.closest('.field') ?? null,
    },
    {
      title: '一个家族，多种形态',
      body: 'TPMS 不止一种。点这里切到 <b>Diamond</b> 或 <b>Schwarz P</b>，对比螺旋、笼状、片状截然不同的几何，还可以在下方公式区拖动<b>权重滑块</b>重塑曲面。',
      demo: { label: '演示 · 切到 Schwarz P', run: demoType },
      target: () => document.querySelector('.controls .sect'),
    },
    {
      title: '截面扫描：切开看内部',
      body: '想知道内部孔道长什么样？拖动<b>截面滑块</b>，像切蛋糕一样沿 Z 轴逐层剖开曲面，看清内部连通的通道网络。',
      demo: { label: '演示 · 剖到中部', run: demoSlice },
      target: () => (document.getElementById('slice') as HTMLElement | null)?.closest('.field') ?? null,
    },
    {
      title: '一键进入真实应用',
      body: '最后试试这些<b>应用场景预设</b>：仿生骨支架、轻量化零件、散热结构——它们把“看懂结构”和“真实用途”直接连起来。',
      demo: null,
      target: () => document.querySelector('.scenes'),
    },
    {
      title: '把结果带走：导出与分享',
      body: '配好参数后，右下角工具栏提供 <b>截图 PNG</b>（论文配图）、<b>STL 导出</b>（3D 打印 / 仿真）、<b>复制分享链接</b>（含全部参数，打开即可复现）。<br><br>点击试试 ↓',
      demo: { label: '演示 · 复制分享链接', run: () => document.getElementById('btn-share')?.click() },
      target: () => document.querySelector('.v-tools'),
    },
  ];

  function positionSpot(el: HTMLElement | null): void {
    if (!el) {
      spot.classList.remove('show');
      return;
    }
    // 目标可能位于默认折叠的 <details> 内：先展开并滚入视野，否则聚光灯定位到全零矩形
    const det = el.closest('details');
    if (det && !det.open) det.open = true;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const pad = 7;
    spot.style.left = `${r.left - pad}px`;
    spot.style.top = `${r.top - pad}px`;
    spot.style.width = `${r.width + pad * 2}px`;
    spot.style.height = `${r.height + pad * 2}px`;
    spot.classList.add('show');
    const below = r.bottom < window.innerHeight * 0.6;
    card.style.bottom = below ? '28px' : 'auto';
    card.style.top = below ? 'auto' : '24px';
  }

  function closeOnboard(): void {
    opened = false;
    card.classList.remove('show');
    spot.classList.remove('show');
    try {
      localStorage.setItem(ONBOARD_KEY, '1');
    } catch {
      // ignore
    }
  }

  function go(i: number): void {
    idx = Math.max(0, Math.min(steps.length - 1, i));
    render();
  }

  function openOnboard(): void {
    idx = 0;
    opened = true;
    card.classList.add('show');
    render();
  }

  function render(): void {
    const s = steps[idx];
    const isLast = idx === steps.length - 1;
    const dots = steps.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('');
    const demoHtml = s.demo ? `<button class="ob-demo" id="ob-demo">${s.demo.label}</button>` : '';
    card.innerHTML =
      `<div class="ob-head"><span class="ob-step">第 ${idx + 1} 步 / 共 ${steps.length} 步</span><span class="ob-dots">${dots}</span></div>` +
      `<h4>${s.title}</h4><p>${s.body}</p>${demoHtml}` +
      `<div class="ob-foot"><button class="ob-btn ghost" id="ob-skip">跳过引导</button>` +
      `${idx > 0 ? '<button class="ob-btn ghost" id="ob-prev">上一步</button>' : ''}` +
      `<button class="ob-btn primary" id="ob-next">${isLast ? '开始探索' : '下一步'}</button></div>`;
    positionSpot(s.target());
    const demoBtn = document.getElementById('ob-demo');
    if (demoBtn && s.demo) demoBtn.addEventListener('click', s.demo.run);
    document.getElementById('ob-skip')?.addEventListener('click', closeOnboard);
    document.getElementById('ob-next')?.addEventListener('click', () => (isLast ? closeOnboard() : go(idx + 1)));
    document.getElementById('ob-prev')?.addEventListener('click', () => go(idx - 1));
  }

  document.getElementById('btn-onboard')?.addEventListener('click', openOnboard);
  window.addEventListener('resize', () => {
    if (opened) positionSpot(steps[idx].target());
  });
  document.addEventListener('keydown', (e) => {
    if (!opened) return;
    if (e.key === 'Escape') closeOnboard();
    else if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'ArrowLeft') go(idx - 1);
  });

  const hasParams = location.search && location.search.length > 1;
  let shown = false;
  try {
    shown = localStorage.getItem(ONBOARD_KEY) === '1';
  } catch {
    // ignore
  }
  if (!shown && !hasParams) {
    setTimeout(openOnboard, 750);
  }
}
