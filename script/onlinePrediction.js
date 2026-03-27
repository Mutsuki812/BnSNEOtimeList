/* ==========================
   ==== 線上預測與回報系統 ====
   ========================== */

import { CONFIG, DATE_RANGES, WEEKDAYS } from './config.js';
import { DOMHelper, SupabaseHelper } from './utils.js';

const CONSTANTS = {
  PREDICTION_OFFSET_MINUTES: {
    START: 85, // +1h 25m
    END: 100,  // +1h 40m
  },
  GISHIKI_LOCATIONS: ['-', '黑森林', '巨岩海岸', '孤村', '土門客棧', '悲鳴村', '灰狼村', '豬豬農場', '鬼都', '雪原(叛軍駐地)', '樹林(北方討伐隊)', '染坊'],
};

export class OnlinePredictionManager {
  constructor(timeUtils, userManager, soundManager) {
    this.timeUtils = timeUtils;
    this.userManager = userManager;
    this.soundManager = soundManager;
    this.lastReports = {}; // 儲存從 GAS 獲取的最新回報資料
    this.historyCache = {}; // 儲存歷史紀錄快取，減少畫面閃爍
    // 初始化狀態旗標
    this.isInitialized = false;
    this.openHistoryType = null; // 紀錄當前開啟的歷史紀錄類型
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
          // 這是為了避免把 2 小時前的舊資料跟現在的資料混在一起判定
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
              locationB: result.targetReport.locationB,
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
   * 權重：系統出字(3) > 打雷中(2) > 王已出(1)
   * 修正：打雷 -1m, 王已出 -5m
   * @param {Array} eventReports - 同一場事件的回報集合
   * @returns {Object|null} 包含計算後的 Date 物件與所選的回報原始資料
   */
  _calculateBaseTime(eventReports) {
    if (!eventReports || eventReports.length === 0) return null;

    const weights = { '系統出字': 3, '打雷中': 2, '王已出': 1 };
    const offsets = { '系統出字': 0, '打雷中': -1, '王已出': -5 };

    // 1. 找出目前的最高優先級權重
    let maxWeight = 0;
    eventReports.forEach(r => {
      const w = weights[r.method] || 1; // 預設權重為1
      if (w > maxWeight) maxWeight = w;
    });

    // 2. 篩選出符合最高權重的所有回報
    const topPriorityReports = eventReports.filter(r => (weights[r.method] || 1) === maxWeight);

    // 3. 在相同優先級中，取「時間最早」的那一筆 (timeStamp 升序排序)
    topPriorityReports.sort((a, b) => {
      return this.timeUtils.timeToMinutes(a.timeStamp) - this.timeUtils.timeToMinutes(b.timeStamp);
    });

    const targetReport = topPriorityReports[0];
    
    // 4. 轉換為 Date 物件
    const baseDate = this.timeUtils.timeStringToDateToday(targetReport.timeStamp);
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
      timeEl.classList.remove('gray', 'text-placeholder');
      contentEl.classList.remove('gray', 'text-placeholder');
      
      const lastReport = this.lastReports['gishiki'];
      
      if (lastReport && lastReport.time) {
        const now = this.timeUtils.getNowBySVR();
        const dayOfWeek = now.getDay();
        const todayWeekDay = dayOfWeek === 0 ? 7 : dayOfWeek;
        const yesterdayPrefix = (lastReport.weekDay !== todayWeekDay) ? '<span style="font-size: 0.8em;">昨天</span> ' : '';

        const formattedTime = this._parseAndFormatTime(lastReport.time);
        timeEl.textContent = "上次出現";
        timeEl.classList.add('prediction-label');
        const locText = (lastReport.locationA === '-' && lastReport.locationB === '-') ? '-' : `${lastReport.locationA || '-'}/${lastReport.locationB || '-'}`;
        contentEl.innerHTML = `${yesterdayPrefix}${formattedTime} ${locText}`;
      } else {
        timeEl.textContent = "尚無數據";
        timeEl.classList.add('prediction-label', 'text-placeholder');
        contentEl.textContent = "等待回報...";
        contentEl.classList.add('text-placeholder');
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
        else if (hoursFromTodayMidnight >= 48) label = '後天';
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

        // 檢查是否到達啟動音效的時間點
        if (effectiveCurrentMinutes === startPredTotalMinutes) {
          this.soundManager.playForecastSound(typeKey);
        }
      }

      // 顯示兩行資訊：上次出現 & 推算時間
      timeEl.innerHTML = `
        <div class="pred-row-label">上次出現</div>
        <div class="pred-row-value">推算時間</div>
      `;
      timeEl.classList.remove('prediction-highlight', 'prediction-label');

      const yesterdayPrefix = (lastReport.weekDay !== todayWeekDay) ? '<span style="font-size: 0.8em;">昨天</span> ' : '';
      const lastInfo = `${yesterdayPrefix}${formattedTime} ${lastReport.location || ''}`;
      contentEl.innerHTML = `
        <div class="pred-row-info">${lastInfo}</div>
        <div class="${predTimeClass}">${predInfo}</div>
      `;
      contentEl.classList.remove('prediction-highlight');
    } else {
      timeEl.textContent = "尚無數據";
      timeEl.classList.add('prediction-label', 'text-placeholder');
      contentEl.textContent = "等待回報...";
      contentEl.classList.add('text-placeholder');
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

    // 如果狀態紀錄為開啟，則自動顯示並加載數據
    if (this.openHistoryType === typeKey) {
      historyListDiv.classList.add('open');
      this.loadAndRenderHistory(typeKey, historyListDiv);
    }

    submitBtn.onclick = () => this.handleSubmit(typeKey, timeInput.value, extraInputs, submitBtn, msgDiv);

    wrapper.insertBefore(reportBox, wrapper.firstChild);
  }

  /**
   * 輔助函式：建立時間輸入相關的 UI
   */
  _createTimeControls() {
    const timeControlsRow = DOMHelper.createElement('div', 'report-form-row flex-row');

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
    const specificInputsRow = DOMHelper.createElement('div', 'report-form-row flex-row wrap');

    const createSelect = (label) => {
      const wrap = DOMHelper.createElement('span', 'report-label label-inline', `${label} `);
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
    const methodOptions = ['系統出字', '打雷中', '王已出'];
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
    const footerRow = DOMHelper.createElement('div', 'report-form-row flex-row mt-10 gap-5');

    const msgDiv = DOMHelper.createElement('div', 'report-msg');

    const historyBtn = document.createElement('button');
    historyBtn.className = 'report-history-btn';
    historyBtn.innerHTML = '<img src="./images/history30.png" alt="今日紀錄">';
    historyBtn.title = "今日紀錄";
    historyBtn.onclick = (e) => this.toggleHistory(typeKey, historyListDiv, e);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = "回報";
    submitBtn.className = "report-submit-btn";
    // 根據任務類型添加對應的背景顏色類別
    submitBtn.classList.add(`type-${typeKey}`);

    footerRow.appendChild(msgDiv);
    footerRow.appendChild(historyBtn);
    footerRow.appendChild(submitBtn);

    return { msgDiv, historyBtn, submitBtn, footerRow };
  }

  /**
   * 切換顯示歷史紀錄
   */
  async toggleHistory(typeKey, listDiv, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const isOpening = !listDiv.classList.contains('open');

    // 關閉所有其他的歷史紀錄列表
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
        .select('*, Users(userName, role)')
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
      listDiv.innerHTML = '尚無今日紀錄';
      return;
    }

    const currentUserId = this.userManager.getCurrentUser()?.id;
    listDiv.innerHTML = '';

    historyData.forEach(item => {
      const row = document.createElement('div');
      row.className = 'report-history-item';
      if (animate) row.classList.add('history-item-animate');

      const formattedTime = this._parseAndFormatTime(item.timeStamp);
      const isAdmin = !!(item.Users && item.Users.role === 'admin'); // 判斷是否為管理者
      const userName = isAdmin ? '管理者' : (item.Users ? item.Users.userName : ''); // 管理者顯示為 [管理者]，一般使用者顯示其名稱

      let methodClass = 'hist-tag';
      if (item.method === '系統出字') methodClass += ' tag-system';
      else if (item.method === '打雷中') methodClass += ' tag-thunder';
      else methodClass += ' tag-spawned';

      const userClass = isAdmin ? 'hist-user admin-tag' : 'hist-user user-tag gray';

      let locText = item.locationA || '-';
      if (typeKey === 'gishiki' && item.locationB && item.locationB !== '-') {
        locText += ` / ${item.locationB}`;
      }

      row.innerHTML = `
        <div class="hist-left">
          <span class="hist-time gray">${formattedTime}</span>
          <span class="${methodClass}">${item.method || '王已出'}</span>
          <span class="hist-loc">${locText}</span>
        </div>
        <div class="hist-right">
          <span class="${userClass}" title="提交者">${userName}</span>
          <span class="hist-actions"></span>
        </div>
      `;

      if (currentUserId && item.user_id === currentUserId) {
        const actionsSpan = row.querySelector('.hist-actions');
        const delBtn = document.createElement('span');
        delBtn.innerHTML = '<img src="./images/delete24.png" alt="刪除" class="icon-delete">';
        delBtn.className = 'hist-del-btn';
        delBtn.title = "刪除回報";
        delBtn.onclick = () => this.deleteReport(item, typeKey, listDiv);
        actionsSpan.appendChild(delBtn);
      }

      listDiv.appendChild(row);
    });
  }

  deleteReport(item, typeKey, listDiv) {
    this.userManager.showConfirmModal("確定刪除此紀錄？", async () => {
      try {
        const user = this.userManager.getCurrentUser();
        if (!user) return;

        const supabase = await SupabaseHelper.getClient();
        console.log('[DB Delete] spawn_reports:', {
          timeStamp: item.timeStamp,
          bossType: item.bossType,
          weekDay: item.weekDay,
          user_id: user.id
        });

        // 使用複合主鍵 + user_id 刪除，確保只能刪除自己的資料
        const { error } = await supabase.from('spawn_reports').delete().match({
          timeStamp: item.timeStamp,
          bossType: item.bossType,
          weekDay: item.weekDay,
          user_id: user.id
        });
        if (error) throw error;
        // 顯示成功訊息
        const msgDiv = document.createElement('div');
        msgDiv.className = 'delete-success-msg';
        msgDiv.textContent = '刪除成功！';
        listDiv.prepend(msgDiv);

        // 1秒後刷新數據，但不關閉列表
        setTimeout(() => this.loadAndRenderHistory(typeKey, listDiv), 1000);
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

    if (typeKey === 'gishiki') {
      if (inputs.locA.value === '-' && inputs.locB.value === '-') {
        msgDiv.className = "report-msg error";
        msgDiv.textContent = "請至少選擇一個地點";
        return;
      }
    }

    const user = await this.userManager.requireUser();
    if (!user) return;

    msgDiv.textContent = "";
		
		// 增加一個鎖，避免短時間重複提交
		if (btnElement.dataset.isSubmitting === 'true') return;

    btnElement.disabled = true;
    btnElement.textContent = "傳送中...";

    // 準備 Payload
    const nowSVR = this.timeUtils.getNowBySVR();
    const dayOfWeek = nowSVR.getDay(); // 0-6 (日-六)

    let weekdayNumber = dayOfWeek === 0 ? 7 : dayOfWeek;

    // 跨午夜處理：如果現在是凌晨 (0-3點) 且回報時間是深夜 (21-23點)
    // 則自動判定該回報屬於「昨天」
    const [reportH] = timeVal.split(':').map(Number);
    if (nowSVR.getHours() < 3 && reportH >= 21) {
      weekdayNumber = (weekdayNumber === 1) ? 7 : weekdayNumber - 1;
    }
    
    const payload = {
      weekDay: weekdayNumber,
      timeStamp: `${timeVal}:00`, // 傳送 HH:MM:SS 格式
      bossType: typeKey,
      user_id: user.id
    };

    if (typeKey === 'gishiki') {
      payload.locationA = inputs.locA.value;
      payload.locationB = inputs.locB.value;
      payload.method = "系統出字";
    } else {
      const selectedMethod = inputs.methodRadios.find(radio => radio.checked);
      payload.method = selectedMethod ? selectedMethod.value : '王已出'; // Fallback
      payload.locationA = inputs.location.value;
      payload.locationB = "";
    }

    try {
      const supabase = await SupabaseHelper.getClient();
      console.log('[DB Insert] spawn_reports:', payload);

      const { error } = await supabase
        .from('spawn_reports')
        .insert([payload]);
      
      if (error) {
        throw error;
      }

      msgDiv.className = "report-msg success";
      msgDiv.textContent = "回報成功！感謝您的貢獻。";
      
      // 1. 立即重新抓取預測基準數據
      await this.fetchPredictionData();
      
      // 2. 如果歷史紀錄是開啟的，強制重新載入歷史清單
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
}