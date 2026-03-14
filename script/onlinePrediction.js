/* ==========================
   ==== 線上預測與回報系統 ====
   ========================== */

import { CONFIG, DATE_RANGES, WEEKDAYS } from './config.js';
import { DOMHelper } from './utils.js';

const CONSTANTS = {
  ACTIONS: {
    GET_REPORTS_FOR_DATE: 'getReportsForDate',
    GET_HISTORY: 'getHistory',
    REPORT_ONLINE: 'reportOnline',
  },
  PREDICTION_OFFSET_MINUTES: {
    START: 85, // +1h 25m
    END: 100,  // +1h 40m
  },
  GISHIKI_LOCATIONS: ['-', '黑森林', '巨岩海岸', '孤村', '土門客棧', '悲鳴村', '灰狼村', '豬豬農場', '鬼都', '雪原(叛軍駐地)', '樹林(北方討伐隊)', '染坊'],
};

export class OnlinePredictionManager {
  constructor(timeUtils) {
    this.timeUtils = timeUtils;
    this.lastReports = {}; // 儲存從 GAS 獲取的最新回報資料
    // 初始化狀態旗標
    this.isInitialized = false;
  }

  /**
   * 初始化
   */
  async init() {
    if (!this.isInDateRange()) return;

    // 載入最新回報數據
    await this.fetchPredictionData();
    this.isInitialized = true;
  }

  /**
   * 檢查是否在活動期間內
   */
  isInDateRange() {
    const now = this.timeUtils.getNowBySVR();
    const start = this.timeUtils.getShiftedDate(DATE_RANGES.start);
    const end = this.timeUtils.getShiftedDate(DATE_RANGES.end);
    return now >= start && now <= end;
  }

  /**
   * 從 GAS 獲取預測所需的回報數據
   * 規則：
   * 1. 優先抓取今日的最後一筆回報。
   * 2. 如果今日無任何回報，則抓取昨日的最後一筆回報。
   */
  async fetchPredictionData() {
    const nowSVR = this.timeUtils.getNowBySVR();
    const todayDayOfWeek = nowSVR.getDay(); // 0-6 (日-六)
    const todayWeekdayChar = WEEKDAYS[todayDayOfWeek];

    // 1. 嘗試獲取今日數據
    let reports = await this.fetchReportsForWeekday(todayWeekdayChar);

    // 2. 若今日無數據，則嘗試獲取昨日數據
    if (!reports || Object.keys(reports).length === 0) {
      console.log(`今日 (${todayWeekdayChar}) 無資料，正在抓取昨日資料。`);
      const yesterdayDayOfWeek = (todayDayOfWeek - 1 + 7) % 7;
      const yesterdayWeekdayChar = WEEKDAYS[yesterdayDayOfWeek];
      reports = await this.fetchReportsForWeekday(yesterdayWeekdayChar);
    }

    this.lastReports = reports || {};
  }

  /**
   * 從 GAS 獲取指定星期（中文字元）的回報數據
   * @param {string} weekdayChar - '日', '一', '二'...
   */
  async fetchReportsForWeekday(weekdayChar) {
    try {
      // 後端需支援 action=getReportsForDate&weekday=日 (範例)
      const response = await fetch(`${CONFIG.GAS_DATA_URL}?action=${CONSTANTS.ACTIONS.GET_REPORTS_FOR_DATE}&weekday=${weekdayChar}&t=${new Date().getTime()}`);
      const json = await response.json();
      
      if (json.status === 'success' && json.data) {
        return json.data;
      }
      return null;
    } catch (e) {
      console.error(`抓取星期 ${weekdayChar} 的回報失敗:`, e);
      return null;
    }
  }

  /**
   * 從多種格式的時間輸入中解析並格式化為 HH:MM
   * @param {string | Date} timeInput 
   * @returns {string} HH:MM 格式的時間
   */
  _parseAndFormatTime(timeInput) {
    if (!timeInput) return "--:--";

    // 如果是 Date 物件
    if (timeInput instanceof Date) {
      const h = String(timeInput.getHours()).padStart(2, '0');
      const m = String(timeInput.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }

    const timeStr = String(timeInput);

    // 格式 1: 已經是 "HH:MM"
    if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
      const [h, m] = timeStr.split(':');
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // 格式 2: 完整日期字串 "Sat Dec 30..."
    const match = timeStr.match(/(\d{1,2}):(\d{2}):\d{2}/);
    if (match) {
      return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
    }

    // 回退
    return timeStr;
  }

  /**
   * 更新 UI (由 main.js 的 renderAllGroups 呼叫)
   */
  updateView() {
    if (!this.isInitialized || !this.isInDateRange()) return;

    this.updatePredictionDisplay("shirao");
    this.updatePredictionDisplay("sengen");
    this.updateGishikiDisplay();
    
    this.injectReportingUI("gishiki");
    this.injectReportingUI("shirao");
    this.injectReportingUI("sengen");
  }

  /**
   * 更新儀式顯示 (只顯示上次出現時間)
   */
  updateGishikiDisplay() {
    const group = document.querySelector(`.group.gishiki`);
    if (!group) return;

    const currentTaskRow = group.querySelector('.taskRow.current');
    if (currentTaskRow) {
      const timeEl = currentTaskRow.querySelector('.col-time');
      const contentEl = currentTaskRow.querySelector('.col-content');

      // 移除可能由 uiRenderer 添加的灰色樣式
      timeEl.classList.remove('gray');
      contentEl.classList.remove('gray');
      
      const lastReport = this.lastReports['gishiki'];
      
      if (lastReport && lastReport.time) {
        const formattedTime = this._parseAndFormatTime(lastReport.time);
        timeEl.textContent = "上次出現";
        timeEl.classList.add('prediction-label');
        contentEl.textContent = `${formattedTime} ${lastReport.locationA || '-'}/${lastReport.locationB || '-'}`;
      } else {
        timeEl.textContent = "尚無數據";
        timeEl.classList.add('prediction-label');
        contentEl.textContent = "等待回報...";
      }
    }
  }

  /**
   * 更新預測顯示 (白青/仙幻島)
   */
  updatePredictionDisplay(typeKey) {
    const group = document.querySelector(`.group.${typeKey}`);
    if (!group) return;

    const currentTaskRow = group.querySelector('.taskRow.current');
    if (!currentTaskRow) return;

    const timeEl = currentTaskRow.querySelector('.col-time');
    const contentEl = currentTaskRow.querySelector('.col-content');

    // 移除可能由 uiRenderer 添加的灰色樣式
    timeEl.classList.remove('gray');
    contentEl.classList.remove('gray');

    const lastReport = this.lastReports[typeKey];

    if (lastReport && lastReport.time) {
      // 計算預測時間
      // 規則：回報時間 + 1小時25分 (Start) ~ + 1小時40分 (End)
      const formattedTime = this._parseAndFormatTime(lastReport.time);
      const [h, m] = formattedTime.split(':').map(Number);

      if (isNaN(h) || isNaN(m)) {
        console.error("時間解析失敗:", lastReport.time);
        timeEl.textContent = "時間格式錯誤";
        contentEl.textContent = "無法計算預測";
        return;
      }
      const reportTotalMinutes = h * 60 + m;

      const startPredTotalMinutes = reportTotalMinutes + CONSTANTS.PREDICTION_OFFSET_MINUTES.START;
      const endPredTotalMinutes = reportTotalMinutes + CONSTANTS.PREDICTION_OFFSET_MINUTES.END;

      const formatMinutesToTime = (totalMinutes) => {
        const totalHours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const displayHours = totalHours % 24;
        
        const timeStr = `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        return (totalHours >= 24)
          ? `明天 ${timeStr}`
          : timeStr;
      };

      const predStartStr = formatMinutesToTime(startPredTotalMinutes);
      const predEndStr = formatMinutesToTime(endPredTotalMinutes);
      const predInfo = `${predStartStr} ～ ${predEndStr}`;
      // 顯示兩行資訊：上次出現 & 推算時間
      timeEl.innerHTML = `
        <div class="pred-row-label">上次出現</div>
        <div class="pred-row-value">推算時間</div>
      `;
      timeEl.classList.remove('prediction-highlight', 'prediction-label');

      const lastInfo = `${formattedTime} ${lastReport.location || ''}`;
      contentEl.innerHTML = `
        <div class="pred-row-info">${lastInfo}</div>
        <div class="pred-row-time">${predInfo}</div>
      `;
      contentEl.classList.remove('prediction-highlight');
    } else {
      timeEl.textContent = "尚無數據";
      timeEl.classList.add('prediction-label');
      contentEl.textContent = "等待回報...";
    }
  }

  /**
   * 注入回報區塊
   */
  injectReportingUI(typeKey) {
    const group = document.querySelector(`.group.${typeKey}`);
    if (!group) return;

    const wrapper = group.querySelector('.onlineWrapper');
    if (!wrapper) return;

    // 避免重複注入
    if (wrapper.querySelector('.online-report-box')) return;

    const reportBox = DOMHelper.createElement('div', 'online-report-box');
    const { timeInput, timeControlsRow } = this._createTimeControls();
    
    const historyListDiv = DOMHelper.createElement('div', 'report-history-list');
    const { msgDiv, historyBtn, submitBtn, footerRow } = this._createFooterControls(typeKey, historyListDiv);

    let extraInputs, specificInputsRow;

    if (typeKey === 'gishiki') {
      reportBox.appendChild(timeControlsRow);
      ({ specificInputsRow, extraInputs } = this._createGishikiInputs());
      reportBox.appendChild(specificInputsRow);
    } else {
      // _createBossInputs 會直接修改 timeControlsRow，我們只需要接收它回傳的新元素即可。
      const bossInputs = this._createBossInputs(typeKey, timeControlsRow);
      ({ specificInputsRow, extraInputs } = bossInputs);
      reportBox.appendChild(timeControlsRow);
      reportBox.appendChild(specificInputsRow);
    }

    reportBox.appendChild(historyListDiv);
    reportBox.appendChild(footerRow);

    submitBtn.onclick = () => this.handleSubmit(typeKey, timeInput.value, extraInputs, submitBtn, msgDiv);

    wrapper.insertBefore(reportBox, wrapper.firstChild);
  }

  /**
   * 輔助函式：建立時間輸入相關的 UI
   */
  _createTimeControls() {
    const timeControlsRow = DOMHelper.createElement('div', 'report-form-row');
    timeControlsRow.style.display = 'flex';
    timeControlsRow.style.alignItems = 'center';
    timeControlsRow.style.gap = '10px';

    const now = this.timeUtils.getNowBySVR();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = defaultTime;
    timeInput.className = 'report-time-input';
    
    const nowBtn = document.createElement('button');
    nowBtn.textContent = "現在";
    nowBtn.type = "button";
    nowBtn.className = "report-now-btn";
    nowBtn.onclick = () => {
      const n = this.timeUtils.getNowBySVR();
      timeInput.value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    };

    timeControlsRow.appendChild(DOMHelper.createElement('span', 'report-label', '時間'));
    timeControlsRow.appendChild(timeInput);
    timeControlsRow.appendChild(nowBtn);

    return { timeInput, timeControlsRow };
  }

  /**
   * 輔助函式：建立儀式專用的地點輸入 UI
   */
  _createGishikiInputs() {
    const specificInputsRow = DOMHelper.createElement('div', 'report-form-row');
    specificInputsRow.style.marginTop = '10px';
    specificInputsRow.style.display = 'flex';
    specificInputsRow.style.alignItems = 'center';
    specificInputsRow.style.gap = '10px';
    specificInputsRow.style.flexWrap = 'wrap';

    const createSelect = (label) => {
      const wrap = DOMHelper.createElement('span', 'report-label', `${label} `);
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      const sel = document.createElement('select');
      sel.className = 'report-select';
      CONSTANTS.GISHIKI_LOCATIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        sel.appendChild(o);
      });
      wrap.appendChild(sel);
      return { wrap, sel };
    };

    const locA = createSelect("地點１");
    const locB = createSelect("地點２");
    
    specificInputsRow.appendChild(locA.wrap);
    specificInputsRow.appendChild(locB.wrap);
    
    const extraInputs = { locA: locA.sel, locB: locB.sel };
    return { specificInputsRow, extraInputs };
  }

  /**
   * 輔助函式：建立野王專用的地點與方式輸入 UI
   */
  _createBossInputs(typeKey, timeControlsRow) {
    // 1. 地點
    const locationOptions = typeKey === 'shirao' ? ['白樺林', '風之平原'] : ['知性森林', '力王山脈', '武神荒野'];
    const locSelect = document.createElement('select');
    locSelect.className = 'report-select';
    locationOptions.forEach(l => {
      const o = document.createElement('option');
      o.value = l;
      o.textContent = l;
      locSelect.appendChild(o);
    });
    timeControlsRow.appendChild(DOMHelper.createElement('span', 'report-label', '地點'));
    timeControlsRow.appendChild(locSelect);

    // 2. 出現方式
    const specificInputsRow = DOMHelper.createElement('div', 'report-form-row');
    specificInputsRow.style.marginTop = '10px';
    const methodOptions = ['系統出字', '打雷中', '不確定'];
    const radioGroupName = `report-method-${typeKey}`;
    const methodContainer = DOMHelper.createElement('div', 'report-radio-container');
    const radioInputs = [];
    methodOptions.forEach((m, index) => {
      const radioId = `radio-${typeKey}-${m.replace(/\s/g, '')}`;
      const label = document.createElement('label');
      label.className = 'report-radio-label';
      label.setAttribute('for', radioId);
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = radioGroupName;
      radio.value = m;
      radio.id = radioId;
      if (index === 0) radio.checked = true;
      radioInputs.push(radio);
      label.appendChild(radio);
      label.appendChild(document.createTextNode(` ${m}`));
      methodContainer.appendChild(label);
    });
    specificInputsRow.appendChild(methodContainer);

    const extraInputs = { methodRadios: radioInputs, location: locSelect };
    return { specificInputsRow, extraInputs };
  }

  /**
   * 輔助函式：建立包含送出按鈕的頁尾 UI
   */
  _createFooterControls(typeKey, historyListDiv) {
    const footerRow = DOMHelper.createElement('div', 'report-form-row');
    footerRow.style.display = 'flex';
    footerRow.style.alignItems = 'center';
    footerRow.style.marginTop = '10px';
    footerRow.style.gap = '5px';

    const msgDiv = DOMHelper.createElement('div', 'report-msg');
    msgDiv.style.flex = '1';
    msgDiv.style.margin = '0';

    const historyBtn = document.createElement('button');
    historyBtn.className = 'report-history-btn';
    historyBtn.innerHTML = '<img src="./images/history30.png" alt="今日紀錄">';
    historyBtn.title = "今日紀錄";
    historyBtn.onclick = () => this.toggleHistory(typeKey, historyListDiv);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = "回報";
    submitBtn.className = "report-submit-btn";
    const colors = { gishiki: '#7A4171', shirao: '#65A48D', sengen: '#B08F3E' };
    submitBtn.style.backgroundColor = colors[typeKey];

    footerRow.appendChild(msgDiv);
    footerRow.appendChild(historyBtn);
    footerRow.appendChild(submitBtn);

    return { msgDiv, historyBtn, submitBtn, footerRow };
  }

  /**
   * 切換顯示歷史紀錄
   */
  async toggleHistory(typeKey, listDiv) {
    // 檢查被點擊的列表目前是否為隱藏狀態
    const isCurrentlyHidden = listDiv.style.display === 'none' || !listDiv.style.display;

    // 關閉所有其他的歷史紀錄列表
    document.querySelectorAll('.report-history-list').forEach(otherList => {
      if (otherList !== listDiv) {
        otherList.style.display = 'none';
      }
    });

    // 如果原本是隱藏的，就打開它並載入資料
    if (isCurrentlyHidden) {
      listDiv.style.display = 'block';
      listDiv.innerHTML = '載入中...';

      try {
        const nowSVR = this.timeUtils.getNowBySVR();
        const todayDayOfWeek = nowSVR.getDay(); // 0-6 (日-六)
        const todayWeekdayChar = WEEKDAYS[todayDayOfWeek];
        // 呼叫 GAS 獲取指定 "星期" 的歷史紀錄
        const response = await fetch(`${CONFIG.GAS_DATA_URL}?action=${CONSTANTS.ACTIONS.GET_HISTORY}&taskType=${typeKey}&weekday=${todayWeekdayChar}&t=${new Date().getTime()}`);
        const json = await response.json();

        if (json.status === 'success' && json.data && json.data.length > 0) {
          listDiv.innerHTML = '';
          json.data.forEach(item => {
            const row = document.createElement('div');
            row.className = 'report-history-item';
            
            // 格式化時間，確保小時和分鐘都是兩位數
            let formattedTime = item.time;
            if (item.time && item.time.includes(':')) {
              const parts = item.time.split(':');
              const h = parts[0];
              const m = parts[1] || '00';
              formattedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            }

            // 假設回報資料包含 time, method, location 等欄位
            let text = `[${formattedTime}] `;
            if (item.method && item.method !== '不確定') text += `${item.method} `;
            if (item.location) text += `${item.location}`;
            if (item.gishikiA) text += `${item.gishikiA} / ${item.gishikiB}`;
            
            row.textContent = text;
            listDiv.appendChild(row);
          });
        } else {
          listDiv.innerHTML = '尚無今日紀錄';
        }
      } catch (e) {
        console.error(e);
        listDiv.innerHTML = '載入失敗';
      }
    } else {
      // 如果原本是可見的，就將其隱藏
      listDiv.style.display = 'none';
    }
  }

  /**
   * 處理回報送出
   */
  async handleSubmit(typeKey, timeVal, inputs, btnElement, msgDiv) {
    if (!timeVal) {
      alert("請輸入時間");
      return;
    }

    btnElement.disabled = true;
    btnElement.textContent = "傳送中...";
    msgDiv.textContent = "";

    // 準備 Payload
    const nowSVR = this.timeUtils.getNowBySVR();
    const dayOfWeek = nowSVR.getDay(); // 0-6 (日-六)
    const weekdayChar = WEEKDAYS[dayOfWeek];
    const payload = {
      action: CONSTANTS.ACTIONS.REPORT_ONLINE, // 區分 GAS 動作
      taskType: typeKey,
      time: timeVal,
      // 直接使用當前伺服器時間的星期
      weekday: weekdayChar, // '日', '一', ...
      // 增加傳送 YYYY-MM-DD 格式的日期，讓後端能精準判斷「今天」
      reportDate: `${nowSVR.getFullYear()}-${String(nowSVR.getMonth() + 1).padStart(2, '0')}-${String(nowSVR.getDate()).padStart(2, '0')}`
    };

    if (typeKey === 'gishiki') {
      payload.gishikiA = inputs.locA.value;
      payload.gishikiB = inputs.locB.value;
    } else {
      const selectedMethod = inputs.methodRadios.find(radio => radio.checked);
      payload.method = selectedMethod ? selectedMethod.value : '不確定'; // Fallback
      payload.location = inputs.location.value;
    }

    try {
      // 發送至 GAS
      const response = await fetch(CONFIG.GAS_DATA_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      
      if (result.status === "success") {
        msgDiv.textContent = "回報成功！感謝您的貢獻。";
        msgDiv.style.color = "green";
        
        // 更新本地緩存並刷新顯示 (模擬即時更新)
        this.updateLocalCache(typeKey, payload);
        this.updateView();
      } else {
        throw new Error(result.message || "Unknown error");
      }
    } catch (error) {
      console.error("回報失敗:", error);
      msgDiv.textContent = "回報失敗，請稍後再試。";
      msgDiv.style.color = "red";
    } finally {
      btnElement.disabled = false;
      btnElement.textContent = "回報";
    }
  }

  /**
   * 暫時更新本地緩存以即時反映 UI
   */
  updateLocalCache(typeKey, payload) {
    if (!this.lastReports[typeKey]) this.lastReports[typeKey] = {};
    
    this.lastReports[typeKey].time = payload.time;
    
    if (typeKey === 'gishiki') {
      this.lastReports[typeKey].locationA = payload.gishikiA;
      this.lastReports[typeKey].locationB = payload.gishikiB;
    } else {
      this.lastReports[typeKey].method = payload.method;
      this.lastReports[typeKey].location = payload.location;
    }
  }
}