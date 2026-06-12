/* ============================================================
   主題切換系統 (Theme Switch)
   管理 Light Mode / Dark Mode 切換，並將偏好儲存至 localStorage。
   由 index.html 的 <head> 中的 inline script 負責無閃爍還原主題，
   本模組負責渲染切換按鈕、綁定事件，以及自動更新主題敏感圖示。
   ============================================================ */

/**
 * 掃描所有帶有 data-icon-light / data-icon-dark 屬性的 <img>，
 * 並依目前主題更新其 src。
 * 由 MutationObserver 在 DOM 變更時自動呼叫，也在主題切換時手動呼叫。
 */
function updateThemeIcons() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.querySelectorAll('img[data-icon-light]').forEach(img => {
    img.src = isDark
      ? (img.dataset.iconDark || img.dataset.iconLight)
      : img.dataset.iconLight;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // ── 主題切換按鈕 ──
  const modeToggle = document.querySelector('.modeToggle');
  if (modeToggle) {
    const btn = document.createElement('button');
    btn.className = 'theme-toggle-btn';
    btn.id = 'themeToggle';
    btn.setAttribute('aria-label', '切換深色/淺色主題');

    function isDarkMode() {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function updateBtn() {
      if (isDarkMode()) {
        btn.innerHTML = '<img src="./images/modeLlight32.png" class="theme-icon">';
      } else {
        btn.innerHTML = '<img src="./images/modeDark32.png" class="theme-icon">';
      }
    }

    btn.addEventListener('click', () => {
      if (isDarkMode()) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      }
      updateBtn();
      updateThemeIcons();
    });

    updateBtn();
    modeToggle.appendChild(btn);
  }

  // ── 初回適用 + DOM 変更時自動更新 ──
  updateThemeIcons();

  let _iconDebounce;
  new MutationObserver(() => {
    clearTimeout(_iconDebounce);
    _iconDebounce = setTimeout(updateThemeIcons, 50);
  }).observe(document.body, { childList: true, subtree: true });
});
