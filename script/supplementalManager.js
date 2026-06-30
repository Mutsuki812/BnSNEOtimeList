/* ==========================
   ==== 補完計畫管理器 ====
   ========================== */

import { CONFIG, TASK_TYPES, WEEKDAYS } from './config.js';
import { DOMHelper, SupabaseHelper } from './utils.js';

export class SupplementalManager {
  constructor(timeUtils, userManager, onlinePredictionManager) {
    this.timeUtils = timeUtils;
    this.userManager = userManager;
    this.onlinePredictionManager = onlinePredictionManager;
    this.activeTaskKey = 'gishiki';
    this.modal = null;
  }

  /**
   * 渲染進入點按鈕
   */
  renderEntryButton(parentEl) {
    if (!parentEl) return;
    
    // 避免重複渲染
    if (parentEl.querySelector('.supplemental-trigger')) return;

    const btn = document.createElement('div');
    btn.className = 'user-info-content unlogged supplemental-trigger';
    btn.innerHTML = `
      <img src="./images/data.gif" class="user-info-icon" alt="supplemental" width="18px" height="18px">
      <span class="login-btn">補完計畫</span>
    `;
    btn.title = '進入歷史數據補完計畫';
    btn.onclick = (e) => {
      e.preventDefault();
      this.openPage();
    };
    
    // 確保插入到容器的最末端（最右側）
    parentEl.appendChild(btn);
  }

  /**
   * 以「跳轉頁面」的方式打開補完計畫
   */
  openPage() {
    const appContainer = document.getElementById('app');
    if (!appContainer) return;

    // 保存目前主畫面的顯示狀態並隱藏
    this.mainContentDisplay = [];
    Array.from(appContainer.children).forEach(child => {
      this.mainContentDisplay.push({ el: child, display: child.style.display });
      child.style.display = 'none';
    });

    const page = DOMHelper.createElement('div', 'supplemental-page-view');
    page.innerHTML = `
      <div class="supplemental-top-nav neumo-card">
        <div class="nav-left">
          <button class="nav-back-btn">← 返回主頁</button>
          <h2 class="dateValue">資料補完計畫 2026 4/15三-21二</h2>
        </div>
        <div class="supplemental-tabs">
        ${TASK_TYPES.filter(t => t.useOnlineSystem).map(t => `
          <button class="tab-btn ${t.key === this.activeTaskKey ? 'active' : ''}" data-key="${t.key}">${t.label}</button>
        `).join('')}
        </div>
      </div>
      <div class="supplemental-content neumo-inset">
        <div id="suppGrid" class="supplemental-grid">
          <!-- 數據列表/矩陣將渲染於此 -->
          <div class="loading">讀取歷史數據中...</div>
        </div>
      </div>
      <div id="suppMsg" class="modal-msg"></div>
    `;
    
    appContainer.appendChild(page);
    this.pageElement = page;

    // 綁定事件
    page.querySelector('.nav-back-btn').onclick = () => this.closePage();
    page.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        this.activeTaskKey = btn.dataset.key;
        page.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.loadGridData();
      };
    });

    this.loadGridData();
  }

  closePage() {
    if (this.pageElement) {
      this.pageElement.remove();
      this.pageElement = null;
    }
    // 恢復主畫面所有組件的顯示
    if (this.mainContentDisplay) {
      this.mainContentDisplay.forEach(item => {
        item.el.style.display = item.display;
      });
    }
  }

  async loadGridData() {
    const container = document.getElementById('suppGrid');
    if (!container) return;

    try {
      const supabase = await SupabaseHelper.getClient();
      // 只抓取本週 (1-7) 的數據
      const { data, error } = await supabase
        .from('spawn_reports')
        .select('*')
        .eq('bossType', this.activeTaskKey)
        .gte('weekDay', 1)
        .lte('weekDay', 7);

      if (error) throw error;
      this.renderGrid(container, data || []);
    } catch (e) {
      container.innerHTML = '讀取失敗';
    }
  }

  renderGrid(container, data) {
    // 建立 24x7 映射表
    const gridMap = {};
    data.forEach(item => {
      const hour = parseInt(item.timeStamp.split(':')[0]);
      const key = `${hour}-${item.weekDay}`;
      if (!gridMap[key]) gridMap[key] = [];
      gridMap[key].push(item);
    });

    let html = `<div class="grid-header">時</div>`;
    const displayDays = ["一", "二", "三", "四", "五", "六", "日"];
    displayDays.forEach(w => {
      html += `<div class="grid-header">${w}</div>`;
    });

    for (let h = 0; h < 24; h++) {
      html += `<div class="grid-hour">${String(h).padStart(2, '0')}</div>`;
      for (let w = 1; w <= 7; w++) {
        const cellData = gridMap[`${h}-${w}`] || [];
        const item = this._calculateBestReport(cellData);
        const hasData = !!item;

        let cellInner = '';
        if (hasData) {
          const shortTime = item.timeStamp.substring(0, 5);
          if (this.activeTaskKey === 'gishiki') {
            const locText = [item.locationA, item.locationB].filter(l => l && l !== '-').join(' / ');
            cellInner = `<div class="cell-record" title="[${item.method}] ${shortTime} ${locText}">${shortTime} ${locText || '-'}</div>`;
          } else {
            let methodClass = 'hist-tag';
            if (item.method === '系統出字') methodClass += ' tag-system';
            else if (item.method === '打雷中') methodClass += ' tag-thunder';
            else methodClass += ' tag-spawned';

            cellInner = `
              <div class="cell-record" title="${item.method} ${shortTime} ${item.locationA || ''}">
                <span class="${methodClass}">${item.method}</span>
                <span>${shortTime}</span>
                <span>${item.locationA || '-'}</span>
              </div>`;
          }
        } else {
          cellInner = '<span class="edit-icon">✎</span>';
        }

        html += `
          <div class="grid-cell ${hasData ? 'has-data' : 'empty'}" data-hour="${h}" data-weekday="${w}">
            ${cellInner}
          </div>
        `;
      }
    }
    container.innerHTML = html;

    // 綁定儲存格點擊
    container.querySelectorAll('.grid-cell').forEach(cell => {
      cell.onclick = () => this.showCellEditor(cell, gridMap[`${cell.dataset.hour}-${cell.dataset.weekday}`] || []);
    });
  }

  showCellEditor(cell, existingReports) {
    const { hour, weekday } = cell.dataset;
    // 簡易 Prompt 或建立一個 Popover
    const timeVal = prompt(`補完計畫 - 週${WEEKDAYS[weekday % 7]} ${hour}時\n請輸入精確時間 (mm):`, "00");
    if (timeVal === null) return;
    
    const fullTime = `${String(hour).padStart(2, '0')}:${String(timeVal).padStart(2, '0')}`;
    this.handleSubmit(parseInt(weekday), fullTime);
  }

  /**
   * 根據權重與共識演算法找出最佳回報
   */
  _calculateBestReport(reports) {
    if (!reports || reports.length === 0) return null;
    if (reports.length === 1) return reports[0];

    const weights = { '系統出字': 3, '打雷中': 2, '王已出': 1 };
    let maxWeight = 0;
    reports.forEach(r => {
      const w = weights[r.method] || 1;
      if (w > maxWeight) maxWeight = w;
    });

    const topPriorityReports = reports.filter(r => (weights[r.method] || 1) === maxWeight);
    const timeCounts = {};
    topPriorityReports.forEach(r => {
      const t = r.timeStamp.substring(0, 5);
      timeCounts[t] = (timeCounts[t] || 0) + 1;
    });

    const maxVotes = Math.max(...Object.values(timeCounts));
    const consensusTimes = Object.keys(timeCounts).filter(t => timeCounts[t] === maxVotes);
    consensusTimes.sort((a, b) => this.timeUtils.timeToMinutes(a) - this.timeUtils.timeToMinutes(b));
    const targetTime = consensusTimes[0];
    return topPriorityReports.find(r => r.timeStamp.startsWith(targetTime));
  }

  async handleSubmit(weekDay, timeVal) {
    const user = this.userManager.getCurrentUser();
    const msg = document.getElementById('suppMsg');

    try {
      const supabase = await SupabaseHelper.getClient();
      
      // 判定方式：補完計畫預設為「系統出字」以提供最高權重，除非是修正
      const payload = {
        weekDay,
        timeStamp: `${timeVal}:00`,
        bossType: this.activeTaskKey,
        locationA: "補完數據",
        method: '補完計畫',
        user_name: user.userName
      };

      const { error } = await supabase.from('spawn_reports').insert([payload]);
      if (error) throw error;

      // 數據流連動判定
      const now = this.timeUtils.getNowBySVR();
      const currentWeekDay = now.getDay() === 0 ? 7 : now.getDay();
      
      // 如果填寫的是今天，或是昨天的晚於 22:15 (這裡簡化為：如果是本週最新數據則更新)
      await this.onlinePredictionManager.fetchPredictionData();
      this.onlinePredictionManager.updateView();
      
      this.loadGridData();
    } catch (e) {
      msg.className = "modal-msg error";
      msg.textContent = e.code === '23505' ? "該時段已存在記録" : "提交失敗";
    }
  }

  close() {
    if (this.modal) {
      document.body.removeChild(this.modal);
      this.modal = null;
    }
  }
}
