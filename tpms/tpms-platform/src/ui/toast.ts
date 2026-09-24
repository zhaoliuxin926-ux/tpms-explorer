/** 简洁的浮动提示 */
let toastTimer: number | undefined;
let toastClearTimer: number | undefined;

export function flashToast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    // 失败/警告提示对读屏可见（与教学版 app.html 的 aria-live 口径对齐）
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  if (toastClearTimer) clearTimeout(toastClearTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 1500);
  // C1 真机体验：淡出后清空残留文本（无障碍树/DOM 不再滞留旧警告；新 toast 前 el 复用重建文本）
  toastClearTimer = window.setTimeout(() => { if (el && !el.classList.contains('show')) el.textContent = ''; }, 1850);
}
