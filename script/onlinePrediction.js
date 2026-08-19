/* ==========================
   ==== 線上預測與回報系統 ====
   ========================== */

import { CONFIG, WEEKDAYS, TASK_TYPES } from './config.js';
import { DOMHelper, SupabaseHelper, RemoteConfig } from './utils.js';

const CONSTANTS = {
  PREDICTION_OFFSET_MINUTES: {
    START: 85, // +1h 25m
    END: 100,  // +1h 40m
  },
  GISHIKI_LOCATIONS: ['-', '雪原(叛軍駐地)', '樹林(北方討伐隊)', '染坊'],
  // GISHIKI_LOCATIONS: ['-', '黒森林', '巨岩海岸', '孤村', '土門客桟', '悲鳴村', '灰狼村', '豬豬農場', '鬼都', '雪原(叛軍駐地)', '樹林(北方討伐隊)', '染坊'],
};

export class OnlinePredictionManager {
  constructor(timeUtils, userManager, soundManager) {
    this.timeUtils = timeUtils;
    this.userManager = userManager;
    this.soundManager = soundManager;
    this.lastReports = {}; // 儲存從 GAS 獲取的最新回報資料
    this.historyCache = {}; // 儲存歷史記録快取，減少畫面閃爍
    // 初始化狀態旗標
    this.isInitialized = false;
    this.openHistoryType = null; // 記録當前開啟的歷史記録類型
    this.activeMessages = {}; // 記録各任務類型目前顯示中的回報訊息（跨重新渲染保留）
    this.msgTimers = {}; // 對應的自動清除計時器
  }

  /**
   * 顯示暫時性回報訊息，並記録其到期時間，
   * 讓訊息在 renderAllGroups 觸發的整頁重繪（例如 Realtime DB_UPDATE）後仍能還原顯示。
   * @param {string} typeKey
   * @param {HTMLElement} msgDiv
   * @param {string} text
   * @param {string} className
   * @param {number} durationMs
   */
  _showTemporaryMessage(typeKey, msgDiv, text, className, durationMs = 10000) {
    msgDiv.className = className;
    msgDiv.textContent = text;

    this.activeMessages[typeKey] = { text, className, expireAt: Date.now() + durationMs };

    clearTimeout(this.msgTimers[typeKey]);
    this.msgTimers[typeKey] = setTimeout(() => {
      delete this.activeMessages[typeKey];
      msgDiv.textContent = "";
    }, durationMs);
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
    const ranges = RemoteConfig.getDateRanges();
    if (!ranges) return false;
    const now   = this.timeUtils.getNowBySVR();
    const start = this.timeUtils.getShiftedDate(ranges.start);
    const end   = this.timeUtils.getShiftedDate(ranges.end);
    return now >= start && now <= end;
  }

  /**
   * 從 Supabase 獲取預測所需的回報數據
   * 規則：
   * 1. 優先抓取今日的最後一筆回報。
   * 2. 如果今日無任何回報，則抓取昨日的最後一筆回報。
   */
  async fetchPredictionData() {
    try {
      const supabase = await SupabaseHelper.getClient();
      const now = this.timeUtils.getNowBySVR();
      
      // 計算 WeekDay 數字 (1-7)
      const dayOfWeek = now.getDay();
      const todayWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek;
      const yesterdayWeekDay = todayWeekDay === 1 ? 7 : todayWeekDay - 1;

      // 同時抓取今天和昨天的回報資料
      const [todayRes, yesterdayRes] = await Promise.all([
        supabase
        .from('spawn_reports')
        .select('*')
        .eq('weekDay', todayWeekDay)
        .order('timeStamp', { ascending: false }),
        
        supabase
        .from('spawn_reports')
        .select('*')
        .eq('weekDay', yesterdayWeekDay)
        .order('timeStamp', { ascending: false })
      ]);

      const todayData = todayRes.data || [];
      const yesterdayData = yesterdayRes.data || [];

      const reports = {};
      const bossTypes = ['gishiki', 'shirao', 'sengen'];

      // 定義處理單日數據的內部邏輯
      const processDayData = (data, weekDay) => {
        bossTypes.forEach(type => {
          // 如果已經有資料（今天處理過了），就跳過（針對昨日資料處理時）
          if (reports[type]) return;

          const bossReports = data.filter(d => d.bossType === type);
          if (bossReports.length === 0) return;

          // 過濾掉未來時間的回報（針對今日數據），容許 5 分鐘緩衝
          if (weekDay === todayWeekDay) {
            const nowMins = now.getHours() * 60 + now.getMinutes();
            const filtered = bossReports.filter(r => this.timeUtils.timeToMinutes(r.timeStamp) <= (nowMins + 5));
            if (filtered.length === 0 && bossReports.length > 0) return; // 如果今日全是未來時間，則略過，改用昨日數據
          }

          // 1. 取得最晚的一筆回報時間作為基準點
          const latestT = this.timeUtils.timeToMinutes(bossReports[0].timeStamp);
          
          // 2. 篩選出屬於「同一場重生事件」的回報 (例如與最晚一筆相差 20 分鐘內)
          const eventReports = bossReports.filter(r => {
            const t = this.timeUtils.timeToMinutes(r.timeStamp);
            return (latestT - t) <= 20;
          });

          // 3. 透過判定函式計算基準時間
          const result = this._calculateBaseTime(eventReports);
          
          if (result) {
            reports[type] = {
              time: result.baseDate, // 這是一個 Date 物件
              location: result.targetReport.locationA,
              locationA: result.targetReport.locationA,
              weekDay: weekDay,
              method: result.targetReport.method
            };
          }
        });
      };

      // 先處理今天，再處理昨天
      processDayData(todayData, todayWeekDay);
      processDayData(yesterdayData, yesterdayWeekDay);

      this.lastReports = reports;
    } catch (e) {
      console.error("Fetch prediction data error:", e);
      this.lastReports = {};
    }
  }

  /**
   * 基準時間判定函式
   * 權重：系統出字(3) > 打雷中/召喚中(2) > 王已出/濁魔魂已出(1)
   * 修正：打雷中/召喚中 -1m, 王已出/濁魔魂已出 -5m
   * @param {Array} eventReports - 同一場事件的回報集合
   * @returns {Object|null} 包含計算後的 Date 物件與所選的回報原始資料
   */
  _calculateBaseTime(eventReports) {
    if (!eventReports || eventReports.length === 0) return null;

    const weights = { '系統出字': 3, '打雷中': 2, '王已出': 1, '召喚中': 2, '濁魔魂已出': 1 };
    const offsets = { '系統出字': 0, '打雷中': -1, '王已出': -5, '召喚中': -1, '濁魔魂已出': -5 };

    // 1. 找出目前的最高優先級權重
    let maxWeight = 0;
    eventReports.forEach(r => {
      const w = weights[r.method] || 1; // 預設權重為1
      if (w > maxWeight) maxWeight = w;
    });

    // 2. 篩選出符合最高權重的所有回報
    const topPriorityReports = eventReports.filter(r => (weights[r.method] || 1) === maxWeight);

    // 3. 在相同優先級中，多數一致時間 > 時間較早
    const timeCounts = {};
    topPriorityReports.forEach(r => {
      const t = r.timeStamp.substring(0, 5);
      timeCounts[t] = (timeCounts[t] || 0) + 1;
    });

    // 找出最大票數
    const maxVotes = Math.max(...Object.values(timeCounts));
    // 篩選出獲得最大票數的時間點
    const consensusTimes = Object.keys(timeCounts).filter(t => timeCounts[t] === maxVotes);

    // 如果有多個時間點同票，取最早的一個
    consensusTimes.sort((a, b) => this.timeUtils.timeToMinutes(a) - this.timeUtils.timeToMinutes(b));
    const targetTime = consensusTimes[0];
    const targetReport = topPriorityReports.find(r => r.timeStamp.startsWith(targetTime));
    
    // 4. 轉換為 Date 物件
    const baseDate = this.timeUtils.timeStringToDateToday(targetTime);
    if (!baseDate) return null;

    // 5. 根據狀態進行偏移修正
    const offsetMinutes = offsets[targetReport.method] || 0;
    if (offsetMinutes !== 0) {
      baseDate.setMinutes(baseDate.getMinutes() + offsetMinutes);
    }

    return {
      baseDate,
      targetReport
    };
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
   * @param {Object} savedStates - 保存的輸入狀態
   */
  updateView(savedStates = {}) {
    if (!this.isInitialized || !this.isInDateRange()) return;

    // 遍歷所有任務類型，根據 useOnlineSystem 開關決定是否更新 UI
    TASK_TYPES.forEach(type => {
      if (!type.useOnlineSystem) return; // 如果沒開啟線上系統，跳過此任務的動態更新

      const savedState = savedStates[type.key] || null;

      // 所有類型統一使用預測顯示
      this.updatePredictionDisplay(type.key);
      this.injectReportingUI(type.key, savedState);
    });
  }

  /**
   * 儲存目前的輸入狀態，避免渲染時重置
   */
  saveInputStates() {
    const states = {};
    TASK_TYPES.forEach(type => {
      const group = document.querySelector(`.group.${type.key}`);
      if (!group) return;
      const reportBox = group.querySelector('.online-box');
      if (!reportBox) return;

      const timeInput = reportBox.querySelector('.report-time-input');
      const state = {
        time: timeInput ? timeInput.value : null,
      };

      const select = reportBox.querySelector('.report-select');
      state.location = select ? select.value : null;
      
      const checkedRadio = reportBox.querySelector(`input[name="report-method-${type.key}"]:checked`);
      state.method = checkedRadio ? checkedRadio.value : null;
      states[type.key] = state;
    });
    return states;
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
    timeEl.classList.remove('gray', 'text-placeholder');
    contentEl.classList.remove('gray', 'text-placeholder');

    const lastReport = this.lastReports[typeKey];
    
    // 取得目前時間資訊以進行比對
    const now = this.timeUtils.getNowBySVR();
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    const dayOfWeek = now.getDay();
    const todayWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek;

    if (lastReport && lastReport.time) {
      // 計算預測時間
      // 規則：回報時間 + 1小時25分 (Start) ~ + 1小時40分 (End)
      const formattedTime = this._parseAndFormatTime(lastReport.time);

      // 動態警示判定：如果回報時間是在今天且在 5 分鐘窗口內
      const isAlert = (lastReport.weekDay === todayWeekDay) && this.timeUtils.isWithinWindow(formattedTime, 5);
      currentTaskRow.classList.toggle('task-alert-active', isAlert);

      const [h, m] = formattedTime.split(':').map(Number);

      if (isNaN(h) || isNaN(m)) {
        console.error("時間解析失敗:", lastReport.time);
        timeEl.textContent = "時間格式錯誤";
        contentEl.textContent = "無法計算預測";
        return;
      }
      const reportTotalMinutes = h * 60 + m;

      const isYesterday = lastReport.weekDay !== todayWeekDay;
      const startPredTotalMinutes = reportTotalMinutes + CONSTANTS.PREDICTION_OFFSET_MINUTES.START;
      const endPredTotalMinutes = reportTotalMinutes + CONSTANTS.PREDICTION_OFFSET_MINUTES.END;

      const formatMinutesToTime = (totalMinutes, showLabel = true) => {
        const totalHours = Math.floor(totalMinutes / 60);
        const realMinutes = totalMinutes % 60;
        const displayHours = totalHours % 24;
        
        const timeStr = `${String(displayHours).padStart(2, '0')}:${String(realMinutes).padStart(2, '0')}`;

        if (!showLabel) return timeStr;

        let label = '';
        // 以「今天的 00:00」為基準計算相對天數
        const dayOffset = isYesterday ? -1 : 0;
        const hoursFromTodayMidnight = totalHours + (dayOffset * 24);

        if (hoursFromTodayMidnight < 0) label = '昨天';
        else if (hoursFromTodayMidnight >= 24) label = '明天';

        return label ? `<span style="font-size: 0.8em;">${label}</span> ${timeStr}` : timeStr;
      };

      // 判斷是否已超過預測時間
      let effectiveCurrentMinutes = currentTotalMinutes;
      if (lastReport.weekDay !== todayWeekDay) {
        // 如果顯示的是昨天的資料，當前分鐘數需加上一整天的分鐘數 (1440) 來做比對
        effectiveCurrentMinutes += 1440;
      }

      let predInfo;
      let predTimeClass = "pred-row-time";
      if (effectiveCurrentMinutes > endPredTotalMinutes) {
        predInfo = "等待最新回報...";
        predTimeClass += " text-placeholder";
      } else {
        const predStartStr = formatMinutesToTime(startPredTotalMinutes, true);
        const predEndStr = formatMinutesToTime(endPredTotalMinutes, false);
        predInfo = `${predStartStr} ～ ${predEndStr}`;

      }

      const yesterdayPrefix = (lastReport.weekDay !== todayWeekDay) ? '<span style="font-size: 0.8em;">昨天</span> ' : '';
      const lastInfo = `${yesterdayPrefix}${formattedTime} ${lastReport.location || ''}`;

      if (typeKey === 'gishiki') {
        // gishiki: 只顯示上次出現時間
        timeEl.textContent = "上次出現";
        timeEl.classList.add('prediction-label');
        contentEl.innerHTML = `<div class="pred-row-info">${lastInfo}</div>`;
        // 推算時間不顯示（之後可再次啟用）
        // contentEl.innerHTML += `<div class="${predTimeClass}">${predInfo}</div>`;
      } else {
        // shirao / sengen: 顯示上次出現 + 推算時間
        timeEl.innerHTML = `
          <div class="pred-row-label">上次出現</div>
          <div class="pred-row-value">推算時間</div>
        `;
        timeEl.classList.remove('prediction-highlight', 'prediction-label');
        contentEl.innerHTML = `
          <div class="pred-row-info">${lastInfo}</div>
          <div class="${predTimeClass}">${predInfo}</div>
        `;
        contentEl.classList.remove('prediction-highlight');
      }
    } else {
      timeEl.textContent = "尚無數據";
      timeEl.classList.add('prediction-label', 'text-placeholder');
      contentEl.textContent = "等待回報...";
      contentEl.classList.add('text-placeholder');
      currentTaskRow.classList.remove('task-alert-active');
    }
  }

  /**
   * 注入回報區塊
   * @param {string} typeKey
   * @param {Object} savedState
   */
  injectReportingUI(typeKey, savedState = null) {
    const group = document.querySelector(`.group.${typeKey}`);
    if (!group) return;

    const wrapper = group.querySelector('.onlineWrapper');
    if (!wrapper) return;

    // 避免重複注入
    if (wrapper.querySelector('.online-box')) return;

    const reportBox = DOMHelper.createElement('div', 'online-box');
    const { timeInput, timeControlsRow } = this._createTimeControls(typeKey, savedState);
    
    const historyListDiv = DOMHelper.createElement('div', 'report-history-list');
    const { msgDiv, historyBtn, submitBtn, footerRow } = this._createFooterControls(typeKey, historyListDiv);

    // 若此類型有尚未到期的訊息（例如剛回報成功後，因 Realtime DB_UPDATE 觸發整頁重繪），還原顯示剩餘時間
    const activeMsg = this.activeMessages[typeKey];
    if (activeMsg) {
      const remaining = activeMsg.expireAt - Date.now();
      if (remaining > 0) {
        this._showTemporaryMessage(typeKey, msgDiv, activeMsg.text, activeMsg.className, remaining);
      } else {
        delete this.activeMessages[typeKey];
      }
    }

    let extraInputs, specificInputsRow;

    // 使用與其他王相同的輸入建立器，讓 gishiki 的 UI 與 shirao/sengen 一致
    const bossInputs = this._createBossInputs(typeKey, timeControlsRow, savedState);
    ({ specificInputsRow, extraInputs } = bossInputs);
    reportBox.appendChild(timeControlsRow);
    reportBox.appendChild(specificInputsRow);

    reportBox.appendChild(footerRow);
    reportBox.appendChild(historyListDiv);

    // 如果狀態記録為開啟，則自動顯示並加載數據
    if (this.openHistoryType === typeKey) {
      historyListDiv.classList.add('open');
      this.loadAndRenderHistory(typeKey, historyListDiv);
    }

    submitBtn.onclick = () => this.handleSubmit(typeKey, timeInput.value, extraInputs, submitBtn, msgDiv);

    wrapper.insertBefore(reportBox, wrapper.firstChild);
  }

  /**
   * 輔助函式：建立時間輸入相關的 UI
   * @param {string} typeKey
   * @param {Object} savedState
   */
  _createTimeControls(typeKey, savedState) {
    const timeControlsRow = DOMHelper.createElement('div', 'report-form-row flex-row');

    const now = this.timeUtils.getNowBySVR();
    let defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (savedState && savedState.time) defaultTime = savedState.time;
    
    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = defaultTime;
    timeInput.className = 'report-time-input';
    
    const nowBtn = document.createElement('button');
    nowBtn.textContent = "現在";
    nowBtn.type = "button";
    nowBtn.className = `${typeKey} now-btn`;
    nowBtn.onclick = () => {
      const n = this.timeUtils.getNowBySVR();
      timeInput.value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    };

    timeControlsRow.appendChild(DOMHelper.createElement('span', 'report-label time', '時間'));
    timeControlsRow.appendChild(timeInput);
    timeControlsRow.appendChild(nowBtn);

    return { timeInput, timeControlsRow };
  }



  /**
   * 輔助函式：建立野王專用的地點與方式輸入 UI
   * @param {string} typeKey
   * @param {HTMLElement} timeControlsRow
   * @param {Object} savedState
   */
  _createBossInputs(typeKey, timeControlsRow, savedState) {
    // 1. 地點
    const locationOptions = typeKey === 'shirao' ? ['白樺林', '風之平原'] : (typeKey === 'gishiki' ? CONSTANTS.GISHIKI_LOCATIONS : ['知性森林', '力王山脈', '武神荒野']);
    const locSelect = document.createElement('select');
    locSelect.className = 'report-select';
    locationOptions.forEach(l => {
      const o = document.createElement('option');
      o.value = l;
      o.textContent = l;
      locSelect.appendChild(o);
    });
    if (savedState && savedState.location) locSelect.value = savedState.location;
    timeControlsRow.appendChild(DOMHelper.createElement('span', 'report-label location', '地點'));
    timeControlsRow.appendChild(locSelect);

    // 2. 出現方式
    const specificInputsRow = DOMHelper.createElement('div', 'report-form-row');
    const methodOptions = typeKey === 'gishiki' ? ['系統出字', '召喚中', '濁魔魂已出'] : ['系統出字', '打雷中', '王已出'];
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
      if (savedState && savedState.method) {
        if (radio.value === savedState.method) radio.checked = true;
      } else if (index === 0) {
        radio.checked = true;
      }
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
    const footerRow = DOMHelper.createElement('div', 'report-form-row events');

    const msgDiv = DOMHelper.createElement('div', 'report-msg');

    const historyBtn = document.createElement('button');
    historyBtn.className = 'report-history-btn';
    historyBtn.innerHTML = '<img src="./images/history30_c.png" alt="今日記録" data-icon-light="./images/history30_c.png" data-icon-dark="./images/history30_w.png">';
    historyBtn.title = "今日記録";
    historyBtn.onclick = (e) => this.toggleHistory(typeKey, historyListDiv, e);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = "回報";
    submitBtn.className = `${typeKey} submit-btn`;

    footerRow.appendChild(msgDiv);
    footerRow.appendChild(historyBtn);
    footerRow.appendChild(submitBtn);

    return { msgDiv, historyBtn, submitBtn, footerRow };
  }

  /**
   * 切換顯示歷史記録
   */
  async toggleHistory(typeKey, listDiv, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const isOpening = !listDiv.classList.contains('open');

    // 關閉所有其他的歷史記録列表
    document.querySelectorAll('.report-history-list').forEach(el => el.classList.remove('open'));

    if (isOpening) {
      this.openHistoryType = typeKey;
      listDiv.classList.add('open');
      await this.loadAndRenderHistory(typeKey, listDiv);
    } else {
      this.openHistoryType = null;
      listDiv.classList.remove('open');
    }
  }

  /**
   * 載入並渲染歷史數據
   */
  async loadAndRenderHistory(typeKey, listDiv) {
    const hasCache = this.historyCache[typeKey] && this.historyCache[typeKey].length > 0;

    // 如果有快取，先行渲染以防止畫面閃爍
    if (hasCache) {
      this._renderHistoryItems(typeKey, listDiv, this.historyCache[typeKey], false);
    } else {
      listDiv.innerHTML = '<div class="report-loading">載入中...</div>';
    }

    try {
      const supabase = await SupabaseHelper.getClient();
      const now = this.timeUtils.getNowBySVR();
      const dayOfWeek = now.getDay();
      const todayWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek;

      const { data: historyData, error } = await supabase
        .from('spawn_reports')
        .select('*, Users!user_name(role)')
        .eq('bossType', typeKey)
        .eq('weekDay', todayWeekDay)
        .order('timeStamp', { ascending: false });

      if (error) throw error;

      const newData = historyData || [];
      
      // 比對資料是否有變動，若無變動則不重複渲染 DOM
      const isSameData = hasCache && JSON.stringify(this.historyCache[typeKey]) === JSON.stringify(newData);
      
      if (!isSameData) {
        this.historyCache[typeKey] = newData;
        this._renderHistoryItems(typeKey, listDiv, this.historyCache[typeKey], hasCache);
      }

    } catch (e) {
      console.error(e);
      if (!hasCache) {
        listDiv.innerHTML = '載入失敗';
      }
    }
  }

  /**
   * 內部方法：將歷史數據陣列渲染至 DOM
   */
  _renderHistoryItems(typeKey, listDiv, historyData, animate = false) {
    if (!historyData || historyData.length === 0) {
      listDiv.innerHTML = '尚無今日記録';
      return;
    }

    const currentUserName = this.userManager.getCurrentUser()?.userName;
    listDiv.innerHTML = '';

    historyData.forEach(item => {
      const row = document.createElement('div');
      row.className = 'report-history-item';
      if (animate) row.classList.add('history-item-animate');

      const formattedTime = this._parseAndFormatTime(item.timeStamp);
      const isAdmin = !!(item.Users && item.Users.role === 'admin');
      const userName = isAdmin ? '管理者' : (item.user_name ?? '');

      let methodClass = 'hist-tag';
      if (item.method === '系統出字') methodClass += ' tag-system';
      else if (item.method === '打雷中' || item.method === '召喚中') methodClass += ' tag-thunder';
      else methodClass += ' tag-spawned';

      let userClass = isAdmin ? 'hist-user admin-tag' : 'hist-user user-tag gray';
      
      // MVP 樣式注入邏輯
      if (!isAdmin) {
        const mvp = RemoteConfig.getMvpConfig();
        if (userName === mvp.first) userClass += " is-mvp-1";
        else if (userName === mvp.second) userClass += " is-mvp-2";
      }

      // 歷史記録顯示使用 location（若沒有則回退到 locationA）
      let locText = item.location || item.locationA || '-';

      row.innerHTML = `
        <div class="hist-left">
          <span class="hist-time">${formattedTime}</span>
          <span class="${methodClass}">${item.method || '王已出'}</span>
          <span class="hist-loc">${locText}</span>
        </div>
        <div class="hist-right">
          <span class="${userClass}" title="提交者">${userName}</span>
          <span class="hist-del"></span>
        </div>
      `;

      if (currentUserName && item.user_name === currentUserName) {
        const actionsSpan = row.querySelector('.hist-del'); // 修正選擇器
        const delBtn = document.createElement('span');
        delBtn.innerHTML = '<img src="./images/delete24_c.png" alt="刪除" class="icon-delete" data-icon-light="./images/delete24_c.png" data-icon-dark="./images/delete24_w.png">';
        delBtn.className = 'hist-del-btn';
        delBtn.title = "刪除回報";
        delBtn.onclick = () => this.deleteReport(item, typeKey, listDiv);
        if (actionsSpan) actionsSpan.appendChild(delBtn);
      }

      listDiv.appendChild(row);
    });
  }

  deleteReport(item, typeKey, listDiv) {
    this.userManager.showConfirmModal("確定刪除此記録？", async () => {
      try {
        const user = this.userManager.getCurrentUser();
        if (!user) return;

        const supabase = await SupabaseHelper.getClient();
        console.log('[表單刪除] 即時回報區:', {
          timeStamp: item.timeStamp,
          bossType: item.bossType,
          weekDay: item.weekDay,
          user_name: user.userName
        });

        // 使用複合主鍵 + user_name 刪除，確保只能刪除自己的資料
        const { error } = await supabase.from('spawn_reports').delete().match({
          timeStamp: item.timeStamp,
          bossType: item.bossType,
          weekDay: item.weekDay,
          user_name: user.userName
        });
        if (error) throw error;
        // 顯示成功訊息
        const msgDiv = document.createElement('div');
        msgDiv.className = 'delete-success-msg';
        msgDiv.textContent = '刪除成功！';
        listDiv.prepend(msgDiv);

        // 1. 立即重新抓取基準數據並更新當前任務列
        await this.fetchPredictionData();
        this.updateView();

        // 2. 1秒後刷新歷史清單，讓使用者有時間看到成功訊息
        setTimeout(() => {
          this.loadAndRenderHistory(typeKey, listDiv);
        }, 1000);
      } catch(e) {
        console.error("刪除失敗", e);
        alert("刪除失敗");
      }
    }, true);
  }

  /**
   * 處理回報送出
   */
  async handleSubmit(typeKey, timeVal, inputs, btnElement, msgDiv) {
    if (!timeVal) {
      msgDiv.className = "report-msg error";
      msgDiv.textContent = "請輸入時間";
      return;
    }

    const nowSVR = this.timeUtils.getNowBySVR();
    const [reportH, reportM] = timeVal.split(':').map(Number);
    const nowH = nowSVR.getHours();
    const nowM = nowSVR.getMinutes();

    // 未來時間判定：排除跨午夜回報昨天的情況（現在 0-3 點且回報時間 21-23 點）後，檢查是否超過目前時間
    const isReportingYesterday = (nowH < 3 && reportH >= 21);
    if (!isReportingYesterday && (reportH > nowH || (reportH === nowH && reportM > nowM))) {
      msgDiv.className = "report-msg error";
      msgDiv.textContent = "不可輸入未來時間";
      return;
    }

    const user = await this.userManager.requireUser();
    if (!user) return;

    delete this.activeMessages[typeKey];
    clearTimeout(this.msgTimers[typeKey]);
    msgDiv.textContent = "";

		// 增加一個鎖，避免短時間重複提交
		if (btnElement.dataset.isSubmitting === 'true') return;

    btnElement.disabled = true;
    btnElement.textContent = "傳送中...";

    // 準備 Payload
    const dayOfWeek = nowSVR.getDay(); // 0-6 (日-六)

    let weekdayNumber = dayOfWeek === 0 ? 7 : dayOfWeek;

    // 跨午夜處理：如果現在是凌晨 (0-3點) 且回報時間是深夜 (21-23點)
    // 則自動判定該回報屬於「昨天」
    if (isReportingYesterday) {
      weekdayNumber = (weekdayNumber === 1) ? 7 : weekdayNumber - 1;
    }
    
    const payload = {
      weekDay: weekdayNumber,
      timeStamp: `${timeVal}:00`, // 傳送 HH:MM:SS 格式
      bossType: typeKey,
      user_name: user.userName
    };

    const selectedMethod = inputs.methodRadios.find(radio => radio.checked);
    payload.method = selectedMethod ? selectedMethod.value : '王已出'; // Fallback
    payload.locationA = inputs.location.value;

    try {
      const supabase = await SupabaseHelper.getClient();
      console.log('[表單新增] 即時回報區:', payload);

      const { error } = await supabase
        .from('spawn_reports')
        .insert([payload]);
      
      if (error) {
        throw error;
      }

      this._showTemporaryMessage(typeKey, msgDiv, "回報成功！感謝您的貢獻。　　　　　點擊時鐘 可查看/刪除今日紀錄⇒", "report-msg success", 10000);

      // 1. 立即重新抓取預測基準數據
      await this.fetchPredictionData();
      
      // 2. 如果歷史記録是開啟的，強制重新載入歷史清單
      if (this.openHistoryType === typeKey) {
        const group = document.querySelector(`.group.${typeKey}`);
        const listDiv = group?.querySelector('.report-history-list');
        if (listDiv) this.loadAndRenderHistory(typeKey, listDiv);
      }

      // 3. 更新上方時間顯示
      this.updateView();

    } catch (error) {
      console.error("回報失敗:", error);
      msgDiv.className = "report-msg error";
      msgDiv.textContent = "回報失敗，請稍後再試。";
    } finally {
      btnElement.disabled = false;
      btnElement.textContent = "回報";
			btnElement.dataset.isSubmitting = 'false';
    }
  }

  /**
   * 由 Web Worker 的整分鐘事件呼叫，判斷是否到達推算開始時間並播放音效。
   * playForecastSound 內部以 lastPlayed 去重，同一分鐘只播一次。
   */
  checkForecastSounds() {
    if (!this.isInitialized || !this.isInDateRange()) return;

    const now = this.timeUtils.getNowBySVR();
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    const dayOfWeek = now.getDay();
    const todayWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek;

    ['shirao', 'sengen'].forEach(typeKey => {
      const lastReport = this.lastReports[typeKey];
      if (!lastReport || !lastReport.time) return;

      const formattedTime = this._parseAndFormatTime(lastReport.time);
      const [h, m] = formattedTime.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return;

      let effectiveCurrentMinutes = currentTotalMinutes;
      if (lastReport.weekDay !== todayWeekDay) effectiveCurrentMinutes += 1440;

      const startPredTotalMinutes = h * 60 + m + CONSTANTS.PREDICTION_OFFSET_MINUTES.START;
      if (effectiveCurrentMinutes === startPredTotalMinutes) {
        this.soundManager.playForecastSound(typeKey, lastReport.weekDay, todayWeekDay, formattedTime);
      }
    });
  }
}
