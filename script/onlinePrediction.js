/* ==========================
   ==== 線上預測與回報系統 ====
   ========================== */

import { CONFIG, DATE_RANGES, WEEKDAYS } from './config.js';
import { DOMHelper } from './utils.js';

export class OnlinePredictionManager {
  constructor(languageManager, timeUtils) {
    this.languageManager = languageManager;
    this.timeUtils = timeUtils;
    this.lastReports = {}; // 儲存從 GAS 獲取的最新回報資料
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
   * 檢查是否在活動期間內 (僅限中文語系)
   */
  isInDateRange() {
    if (this.languageManager.current !== 'zh') return false;
    const now = this.timeUtils.getNowBySVR();
    const range = DATE_RANGES.zh;
    const start = this.timeUtils.getShiftedDate(range.start);
    const end = this.timeUtils.getShiftedDate(range.end);
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
    const todayWeekdayChar = WEEKDAYS.zh[todayDayOfWeek];

    // 1. 嘗試獲取今日數據
    let reports = await this.fetchReportsForWeekday(todayWeekdayChar);

    // 2. 若今日無數據，則嘗試獲取昨日數據
    if (!reports || Object.keys(reports).length === 0) {
      console.log(`No data for today (${todayWeekdayChar}), fetching yesterday's data.`);
      const yesterdayDayOfWeek = (todayDayOfWeek - 1 + 7) % 7;
      const yesterdayWeekdayChar = WEEKDAYS.zh[yesterdayDayOfWeek];
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
      // 後端需支援 action=getReportsForDate&weekday=日
      const response = await fetch(`${CONFIG.GAS_DATA_URL}?action=getReportsForDate&weekday=${weekdayChar}&t=${new Date().getTime()}`);
      const json = await response.json();
      
      if (json.status === 'success' && json.data) {
        return json.data;
      }
      return null;
    } catch (e) {
      console.error(`Failed to fetch reports for weekday ${weekdayChar}:`, e);
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

      const startPredTotalMinutes = reportTotalMinutes + 85;  // +1h 25m
      const endPredTotalMinutes = reportTotalMinutes + 100; // +1h 40m

      const formatMinutesToTime = (totalMinutes) => {
        const totalHours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const displayHours = totalHours % 24;
        
        const timeStr = `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        return (totalHours >= 24)
          ? `${this.languageManager.current === "zh" ? "明天" : "翌日"} ${timeStr}`
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
      // timeEl.textContent = "推算時間";
      // timeEl.classList.add('prediction-label');
      // timeEl.classList.remove('prediction-highlight');
      // contentEl.textContent = "尚無回報數據";
      // contentEl.classList.remove('prediction-highlight');
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

    // 1. 時間輸入 (共通)
    const now = this.timeUtils.getNowBySVR();
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = defaultTime;
    timeInput.className = 'report-time-input';
    
    // 方便按鈕：現在
    const nowBtn = document.createElement('button');
    nowBtn.textContent = "現在";
    nowBtn.type = "button";
    nowBtn.className = "report-now-btn";
    nowBtn.onclick = () => {
      const n = this.timeUtils.getNowBySVR();
      timeInput.value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    };

    const timeLabel = DOMHelper.createElement('span', 'report-label', '時間');

    // 歷史紀錄按鈕
    const historyBtn = document.createElement('button');
    historyBtn.className = 'report-history-btn';
    historyBtn.innerHTML = '<img src="./images/history30.png" alt="今日紀錄">';
    historyBtn.title = "今日紀錄";
    
    // 歷史紀錄列表容器 (放在 formContainer 外部，但在 reportBox 內部)
    const historyListDiv = DOMHelper.createElement('div', 'report-history-list');
    historyBtn.onclick = () => this.toggleHistory(typeKey, historyListDiv);

    // 送出按鈕
    const submitBtn = document.createElement('button');
    submitBtn.textContent = "回報";
    submitBtn.className = "report-submit-btn";
    
    // 設定按鈕顏色
    if (typeKey === 'gishiki') submitBtn.style.backgroundColor = '#7A4171';
    else if (typeKey === 'shirao') submitBtn.style.backgroundColor = '#65A48D';
    else if (typeKey === 'sengen') submitBtn.style.backgroundColor = '#B08F3E';
    
    // 訊息顯示區
    const msgDiv = DOMHelper.createElement('div', 'report-msg');
    msgDiv.style.flex = '1';
    msgDiv.style.margin = '0';

    // 2. 類型特定的輸入項
    let extraInputs = [];

    // Row 1: 時間 (共通部分)
    const row1 = DOMHelper.createElement('div', 'report-form-row');
    row1.style.display = 'flex';
    row1.style.alignItems = 'center';
    row1.style.gap = '10px';
    row1.appendChild(timeLabel);
    row1.appendChild(timeInput);
    row1.appendChild(nowBtn);

    if (typeKey === 'gishiki') {
      // 儀式布局
      // 第一行：時間
      reportBox.appendChild(row1);

      // 第二行：地點
      const row2 = DOMHelper.createElement('div', 'report-form-row');
      row2.style.marginTop = '10px';
      row2.style.display = 'flex';
      row2.style.alignItems = 'center';
      row2.style.gap = '10px';
      row2.style.flexWrap = 'wrap';

      const locOptions = ['-', '黑森林', '巨岩海岸', '孤村', '土門客棧', '悲鳴村', '灰狼村', '豬豬農場', '鬼都', '雪原(叛軍駐地)', '樹林(北方討伐隊)', '染坊'];
      
      const createSelect = (label) => {
        const wrap = document.createElement('span');
        wrap.className = 'report-label';
        wrap.textContent = `${label} `;
        wrap.style.display = 'inline-flex';
        wrap.style.alignItems = 'center';
        const sel = document.createElement('select');
        sel.className = 'report-select';
        locOptions.forEach(opt => {
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
      
      row2.appendChild(locA.wrap);
      row2.appendChild(locB.wrap);
      reportBox.appendChild(row2);
      
      extraInputs = { locA: locA.sel, locB: locB.sel };

    } else {
      // 白青/仙幻島布局
      // 第一行：時間、地點
      const locSelect = document.createElement('select');
      locSelect.className = 'report-select';
      let locationOptions = [];
      if (typeKey === 'shirao') {
        locationOptions = ['白樺林', '風之平原'];
      } else if (typeKey === 'sengen') {
        locationOptions = ['知性森林', '力王山脈', '武神荒野'];
      }

      locationOptions.forEach(l => {
        const o = document.createElement('option');
        o.value = l;
        o.textContent = l;
        locSelect.appendChild(o);
      });
      
      const locLabel = DOMHelper.createElement('span', 'report-label', '地點');
      row1.appendChild(locLabel);
      row1.appendChild(locSelect);
      reportBox.appendChild(row1);

      // 第二行：出現方式
      const row2 = DOMHelper.createElement('div', 'report-form-row');
      row2.style.marginTop = '10px';

      const methodOptions = ['系統出字', '打雷中', '不確定'];
      const radioGroupName = `report-method-${typeKey}`;
      const methodContainer = DOMHelper.createElement('div', 'report-radio-container');

      // const methodLabel = DOMHelper.createElement('span', 'report-label', '');
      // methodContainer.appendChild(methodLabel);

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
        if (index === 0) radio.checked = true; // 預設選取第一項

        radioInputs.push(radio);
        label.appendChild(radio);
        label.appendChild(document.createTextNode(` ${m}`));
        methodContainer.appendChild(label);
      });

      row2.appendChild(methodContainer);
      reportBox.appendChild(row2);

      extraInputs = { methodRadios: radioInputs, location: locSelect };
    }

    // 第三行：今天的歷史紀錄
    reportBox.appendChild(historyListDiv);

    // 第四行：訊息顯示區、歷史紀錄按鈕、回報按鈕
    const row4 = DOMHelper.createElement('div', 'report-form-row');
    row4.style.display = 'flex';
    row4.style.alignItems = 'center';
    row4.style.marginTop = '10px';
    row4.style.gap = '5px';

    row4.appendChild(msgDiv);
    row4.appendChild(historyBtn);
    row4.appendChild(submitBtn);

    reportBox.appendChild(row4);

    submitBtn.onclick = () => this.handleSubmit(typeKey, timeInput.value, extraInputs, submitBtn, msgDiv);

    // 插入到 taskWrapper 的最前面 (或最後面，依需求)
    wrapper.insertBefore(reportBox, wrapper.firstChild);
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
        const todayWeekdayChar = WEEKDAYS.zh[todayDayOfWeek];
        // 呼叫 GAS 獲取指定 "星期" 的歷史紀錄
        const response = await fetch(`${CONFIG.GAS_DATA_URL}?action=getHistory&taskType=${typeKey}&weekday=${todayWeekdayChar}&t=${new Date().getTime()}`);
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
    const weekdayChar = WEEKDAYS.zh[dayOfWeek];
    const payload = {
      action: "reportOnline", // 區分 GAS 動作
      taskType: typeKey,
      time: timeVal,
      // 直接使用當前伺服器時間的星期，不考慮遊戲重置時間
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
      console.error("Report failed:", error);
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