/** 拦截三段式卡片（原因→推荐→行动）——导出门硬拦截的持久可行动反馈。
 *  动机：flashToast TTL 1.5s 对长拦截消息不可靠（慢跑者上"点了没反应"体感），
 *  status 行随面板滚走；卡片持久、语义色阶（原因绯红/推荐琥珀）、带行动按钮。
 *  设计源：collab/gemini/2026-11-07-ui-ux-polish-consult-reply.md §2「拦截改三段式卡片」；
 *  外调研佐证：NNGroup 渐进披露 + Configurator UX 2025（约束输入+清晰反馈）。
 *  依赖零——复用全局 CSS 变量（--panel-solid/--panel-border/--ink 系），明暗主题自动适配。 */

export interface BlockCardAction {
  label: string;
  run: () => void;
  disabled?: boolean;
}

export interface BlockCardOpts {
  title: string;
  /** 段1 原因（绯红段） */
  reason: string;
  /** 可选指标行（键值对，等宽数字） */
  metrics?: Array<[string, string]>;
  /** 段2 推荐（琥珀段，逐条列表） */
  recommendations: string[];
  /** 段3 行动按钮（缺省仅 [知道了]） */
  actions?: BlockCardAction[];
}

let bound = false;

export function showBlockCard(opts: BlockCardOpts): void {
  let root = document.getElementById('block-card') as HTMLElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = 'block-card';
    root.innerHTML =
      '<div class="bc-box" role="alertdialog" aria-modal="true" aria-labelledby="bc-title">' +
      '  <div class="bc-head"><span id="bc-title" class="bc-title"></span>' +
      '  <button class="bc-x" aria-label="关闭">✕</button></div>' +
      '  <div class="bc-reason"></div>' +
      '  <div class="bc-metrics"></div>' +
      '  <div class="bc-recs"></div>' +
      '  <div class="bc-actions"></div>' +
      '</div>';
    document.body.appendChild(root);
    bound = true;
  }
  (root.querySelector('.bc-title') as HTMLElement).textContent = opts.title;
  (root.querySelector('.bc-reason') as HTMLElement).textContent = opts.reason;
  const met = root.querySelector('.bc-metrics') as HTMLElement;
  met.innerHTML = '';
  if (opts.metrics && opts.metrics.length) {
    for (const [kk, vv] of opts.metrics) {
      const cell = document.createElement('div');
      cell.className = 'bc-metric';
      cell.innerHTML = '<span class="bc-mk"></span><span class="bc-mv"></span>';
      (cell.querySelector('.bc-mk') as HTMLElement).textContent = kk;
      (cell.querySelector('.bc-mv') as HTMLElement).textContent = vv;
      met.appendChild(cell);
    }
    met.style.display = 'grid';
  } else {
    met.style.display = 'none';
  }
  const recs = root.querySelector('.bc-recs') as HTMLElement;
  recs.innerHTML = '';
  for (const r of opts.recommendations) {
    const li = document.createElement('div');
    li.className = 'bc-rec';
    li.textContent = '• ' + r;
    recs.appendChild(li);
  }
  const acts = root.querySelector('.bc-actions') as HTMLElement;
  acts.innerHTML = '';
  const mkBtn = (label: string, run: () => void, primary: boolean, disabled: boolean) => {
    const b = document.createElement('button');
    b.className = 'bc-btn' + (primary ? ' bc-btn-primary' : '');
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', () => {
      hide();
      run();
    });
    return b;
  };
  for (const a of opts.actions ?? []) acts.appendChild(mkBtn(a.label, a.run, true, !!a.disabled));
  acts.appendChild(mkBtn('知道了', () => {}, false, false));
  const hide = () => root!.classList.remove('show');
  const x = root.querySelector('.bc-x') as HTMLElement;
  const newX = x.cloneNode(true) as HTMLElement;
  x.replaceWith(newX);
  newX.addEventListener('click', hide);
  if (!bound) {
    bound = true;
  }
  root.classList.add('show');
}
