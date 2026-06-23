/* ============================================================
   主應用程式入口
   負責協調所有子模組的初始化、生命週期管理與計時器調度。

   應用程式架構：
   - 單一入口：DOMContentLoaded 事件觸發 TaskScheduleApp.init()
   - 資料流：ScheduleDataLoader → TaskDataProcessor → UIRenderer → DOM
   - 即時更新：Web Worker (Realtime) + setInterval (秒級 UI)
   - 線上系統：OnlinePredictionManager (活動期間啟用)
   ============================================================ */

import { CONFIG, WEEKDAYS } from "./config.js";
import { TimeUtils, TaskUtils, DOMHelper, RemoteConfig } from "./utils.js";
import { ScheduleDataLoader, TaskDataProcessor } from "./taskProcessor.js";
import { UIRenderer } from "./uiRenderer.js";
import { ReportManager } from "./reportManager.js";
import { SoundManager } from "./soundManager.js";
import { OnlinePredictionManager } from "./onlinePrediction.js";
import { UserManager } from "./userManager.js";
import { SupplementalManager } from "./supplementalManager.js";

// ============================================================
// 主應用程式類別
// ============================================================

/**
 * 劍靈 NEO 野王時刻表應用程式的主控制器。
 * 採用組合模式（Composition），將各功能委派給對應的子模組管理器。
 */
class TaskScheduleApp {
  constructor() {
    // --- 工具實例 ---
    this.timeUtils   = new TimeUtils();
    this.taskUtils   = new TaskUtils();

    // --- 資料層 ---
    this.scheduleLoader = new ScheduleDataLoader(this.timeUtils);
    this.taskProcessor  = new TaskDataProcessor(this.timeUtils, this.taskUtils);

    // --- 功能模組 ---
    this.soundManager            = new SoundManager();
    this.userManager             = new UserManager(this.soundManager);
    this.uiRenderer              = new UIRenderer(this.timeUtils, this.taskUtils, this.soundManager);
    this.reportManager           = new ReportManager(this.userManager, this.timeUtils);
    this.onlinePredictionManager = new OnlinePredictionManager(this.timeUtils, this.userManager, this.soundManager);
    this.supplementalManager     = new SupplementalManager(this.timeUtils, this.userManager, this.onlinePredictionManager);

    // --- 狀態 ---
    this.cachedScheduleRows = null; // 最後一次成功載入的排程資料快取

    // --- 計時器 ID ---
    this.secondlyIntervalId   = null;
    this.minuteRefreshIntervalId  = null; // 由 Worker TICK_MINUTE 取代，保留欄位以備降級使用
    this.minuteRefreshTimeoutId   = null;
    this.hourlyRefreshIntervalId  = null;
    this.hourlyRefreshTimeoutId   = null;

    // --- Web Worker ---
    this.worker    = null;
    this.loadToken = 0; // 渲染請求的序列號，用於取消過期的非同步渲染

    // --- 旗標 ---
    this.alertStatusLogged    = false; // 防止預警狀態日誌重複輸出
    this.isMaintenanceActive  = false; // 當前時段是否為維護狀態（影響音效播放）
    this.lastPlayedId         = null;  // 本分鐘世界王音效的播放 ID，防止重複播放
    this.lastStaticSoundPlayedId = null; // 本分鐘靜態班表音效的播放 ID，防止 0-5 秒重複播放
  }

  // ============================================================
  // 初始化流程
  // ============================================================

  /**
   * 應用程式主要初始化入口。
   * 依序啟動：UI 更新 → Web Worker → 功能按鈕 → 活動期間判斷 → 回報系統 → 計時器。
   */
  async init() {
    await RemoteConfig.refresh();
    this.uiRenderer.updateTopTime();
    this.initWorker();

    // 功能按鈕（世界王音效開關等）優先渲染，不等待資料載入
    this.renderFunctionalButtons();

    // 依據是否在活動期間內，決定公告文字與線上系統的啟用方式
    if (this.isInDateRange()) {
      this.initInDateRange();
    } else {
      this.initOutDateRange();
    }

    this.reportManager.updateAll();
    this.reportManager.loadReports();
    this.startTimers();

    // 綁定管理者登入的隱藏觸發點（點擊時間標籤區域的特定元素）
    const timeBox = document.getElementById("timeBox");
    if (timeBox) {
      timeBox.addEventListener("click", (e) => {
        if (e.target.classList.contains("admin-trigger")) {
          this.userManager.showAdminLoginModal();
        }
      });
    }

    // 延遲 500ms 後顯示音效解鎖提示，確保 DOM 已完整渲染後再彈出
    setTimeout(() => this.soundManager.showUnlockModal(), 500);
  }

  /**
   * 初始化 Web Worker，啟動 Supabase Realtime 監聽與精準分鐘計時器。
   * Worker 負責在分頁佇立時維持計時精準度，並於資料庫異動時通知主執行緒重新渲染。
   */
  initWorker() {
    if (typeof Worker === "undefined") return;

    // 使用 ES Module Worker 以支援 import 語法
    this.worker = new Worker("./script/worker.js", { type: "module" });

    this.worker.postMessage({
      type:   "INIT",
      config: { url: CONFIG.SUPABASE_URL, key: CONFIG.SUPABASE_KEY },
    });

    this.worker.onmessage = (e) => {
      const { type, reason } = e.data;

      if (type === "DB_UPDATE") {
        // Supabase Realtime 偵測到 spawn_reports 資料異動，觸發全域重新渲染
        console.log("[即時更新] 偵測到資料異動，重新載入資料並渲染");
        this.loadTasksAndRender();
      } else if (type === "TICK_MINUTE") {
        // Worker 精準分鐘計時觸發，在有快取資料的情況下重新渲染任務列表
        if (this.cachedScheduleRows) this.renderAllGroups(this.cachedScheduleRows);
      } else if (type === "REALTIME_READY") {
        console.log("[Worker] Realtime 連線成功，即時監聽已就緒");
      } else if (type === "INIT_FAILED") {
        // Worker 初始化失敗，應用程式降級為純定時器模式（仍可正常運作）
        console.warn(`[Worker] Realtime 初始化失敗：${reason}，已降級為純定時器模式`);
      }
    };
  }

  // ============================================================
  // 活動期間判斷與初始化
  // ============================================================

  /**
   * 判斷當前台灣時間是否在 event_config 設定的活動期間內。
   * 活動期間會啟用線上回報系統與限時公告。
   * @returns {boolean}
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
   * 通用初始化邏輯，依 isSpecialPeriod 決定顯示哪種公告文字。
   * @param {{ isSpecialPeriod: boolean }} options
   */
  initCommon({ isSpecialPeriod }) {
    // 標題公告：固定顯示，不受活動期間影響
    this.uiRenderer.updateTitleNotice();

    if (isSpecialPeriod) {
      // 活動期間：隱藏常態公告，顯示限時公告
      DOMHelper.updateElement("regularNotice", undefined, "none");
      this.uiRenderer.updateTemporaryNoticeText();
    } else {
      // 非活動期間：顯示常態公告，隱藏限時公告
      this.uiRenderer.updateRegularNotice();
      DOMHelper.updateElement("temporaryNotice", undefined, "none");
    }

    DOMHelper.updateElement("taskContainer", null, "block");
    this.loadTasksAndRender();
  }

  /** 非活動期間的初始化（顯示常態公告，不啟用線上系統）。 */
  initOutDateRange() {
    this.initCommon({ isSpecialPeriod: false });
  }

  /**
   * 活動期間內的初始化（顯示限時公告，啟用線上系統）。
   * OnlinePredictionManager 的初始化已移至 loadTasksAndRender 中，
   * 確保資料載入完成後才渲染 UI，避免畫面閃爍。
   */
  initInDateRange() {
    this.initCommon({ isSpecialPeriod: true });
  }

  // ============================================================
  // 資料載入與渲染
  // ============================================================

  /**
   * 從 Supabase 載入排程資料，並在完成後觸發全域渲染。
   * 使用 loadToken 機制處理非同步競爭問題：
   * 若在 await 期間有新的載入請求發出，本次渲染將被中止。
   */
  async loadTasksAndRender() {
    this.loadToken++;
    const currentToken = this.loadToken;

    const loadPromises = [this.scheduleLoader.loadSchedule()];

    if (this.isInDateRange()) {
      // 活動期間同時初始化線上預測系統（抓取最新回報資料）
      loadPromises.push(this.onlinePredictionManager.init());
    } else {
      this.onlinePredictionManager.isInitialized = false;
    }

    const [rows] = await Promise.all(loadPromises);

    // 檢查是否有更新的載入請求：若有，放棄本次渲染（避免用舊資料覆蓋新結果）
    if (currentToken !== this.loadToken) {
      console.log(`[渲染] 已中止（序號 ${currentToken}），新請求序號：${this.loadToken}`);
      return;
    }

    this.cachedScheduleRows = rows;
    this.renderAllGroups(rows);
  }

  /**
   * 渲染所有任務群組至 #taskContainer。
   * 每次呼叫前會儲存目前的展開狀態與輸入狀態，渲染後還原，
   * 以避免使用者操作在自動更新時被重置。
   * @param {Array} rows - 排程原始資料陣列
   */
  renderAllGroups(rows) {
    const container = document.getElementById("taskContainer");
    if (!container || container.style.display === "none") return;

    // 儲存目前的 UI 狀態，渲染後還原
    const openStates  = this.saveOpenStates(container);
    const inputStates = this.onlinePredictionManager.saveInputStates();

    container.innerHTML = "";

    const now          = this.timeUtils.getNowBySVR();
    const currentHour  = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay   = now.getDay();

    // 將 JS 星期格式 (0=日) 轉換為資料庫格式 (1=週一 ~ 7=週日)
    const todayWeek     = currentDay === 0 ? 7 : currentDay;
    const tomorrowDay   = (currentDay + 1) % 7;
    const tomorrowWeek  = tomorrowDay === 0 ? 7 : tomorrowDay;

    const isActivityPeriod = this.isInDateRange();

    // 判斷全域維護狀態：若任一任務類型當前時段為維護，則靜音所有音效
    this.isMaintenanceActive = this.taskProcessor.getVisibleTaskTypes().some((type) => {
      const todayList = this.taskProcessor.getTaskListForWeek(rows, type, todayWeek);
      const merged    = this.taskUtils.mergeConsecutiveMaintenance(todayList);
      const { isInMaintenance } = this.taskProcessor.categorizeTasksByTime(merged, currentHour, currentMinute);
      return isInMaintenance;
    });

    // 依序渲染每種任務類型的群組
    this.taskProcessor.getVisibleTaskTypes().forEach((type) => {
      const group = this.createTaskGroup(
        rows, type, todayWeek, tomorrowWeek,
        currentHour, currentMinute, currentDay,
        openStates, isActivityPeriod
      );
      container.appendChild(group);
    });

    // 渲染完成後，注入線上預測與回報 UI（並還原輸入狀態）
    this.onlinePredictionManager.updateView(inputStates);
  }

  /**
   * 儲存各任務群組的「其他時間」展開狀態。
   * 在 renderAllGroups 清空 container 前呼叫，渲染後可據此還原狀態。
   * @param {HTMLElement} container - 任務容器元素
   * @returns {Record<string, boolean>} - 各任務類型 key 對應的展開狀態
   */
  saveOpenStates(container) {
    const states = {};
    this.taskProcessor.getVisibleTaskTypes().forEach((type) => {
      const group = container.querySelector(`.group.${type.key}`);
      if (group) {
        const remContainer = group.querySelector(".remainingContainer");
        states[type.key]   = remContainer?.classList.contains("open") ?? false;
      }
    });
    return states;
  }

  // ============================================================
  // 任務群組建立
  // ============================================================

  /**
   * 建立單一任務類型的完整群組元素（包含傳統容器與線上回報容器）。
   * 兩個容器互斥顯示：活動期間且啟用線上系統時顯示 onlineWrapper，否則顯示 wrapper。
   *
   * @param {Array}   rows             - 排程原始資料
   * @param {object}  type             - 任務類型物件
   * @param {number}  todayWeek        - 今日星期數 (1-7)
   * @param {number}  tomorrowWeek     - 明日星期數 (1-7)
   * @param {number}  currentHour      - 當前小時
   * @param {number}  currentMinute    - 當前分鐘
   * @param {number}  currentDay       - 當前 JS 星期 (0-6)
   * @param {object}  openStates       - 各群組的展開狀態快取
   * @param {boolean} isGlobalActivity - 當前是否在活動期間內
   * @returns {HTMLElement} - 完整的群組 DOM 元素
   */
  createTaskGroup(rows, type, todayWeek, tomorrowWeek, currentHour, currentMinute, currentDay, openStates, isGlobalActivity) {
    const isActivityPeriod = this.isInDateRange();
    const isOnlineMode     = isGlobalActivity && type.useOnlineSystem;

    // 取得今日與明日的任務列表
    let todayList    = this.taskProcessor.getTaskListForWeek(rows, type, todayWeek);
    let tomorrowList = this.taskProcessor.getTaskListForWeek(rows, type, tomorrowWeek);

    // 21 點後加入明日清晨任務（標記為跨日，以便 UI 顯示「明天」標籤）
    let combinedList = [...todayList];
    if (tomorrowList.length > 0 && currentHour > 20) {
      const markedTomorrow = tomorrowList.map((item) => ({ ...item, isNextDay: true }));
      combinedList = [...todayList, ...markedTomorrow];
    }

    // 合併連續維護任務後進行時間分類
    combinedList = this.taskUtils.mergeConsecutiveMaintenance(combinedList);
    const { previousItem, currentItem, nextItems, remainingItems, isInMaintenance } =
      this.taskProcessor.categorizeTasksByTime(combinedList, currentHour, currentMinute);

    const group = DOMHelper.createElement("div", `group ${type.key}`);

    // --- 前一小時提示列 ---
    // 僅在非線上模式下顯示；仙幻島有額外的時間窗口條件
    const showPrevious =
      !isOnlineMode &&
      (
        type.key === "gishiki" ||
        type.key === "shirao"  ||
        (type.key === "sengen" && previousItem &&
          parseInt(previousItem.time.split(":")[1], 10) >= 55 && currentMinute <= 5)
      );

    if (showPrevious) {
      group.appendChild(
        this.uiRenderer.createPreviousHourTaskRow(previousItem, currentItem, currentHour, currentMinute, type)
      );
    }

    // --- 當前任務列 ---
    group.appendChild(this.uiRenderer.createCurrentTaskRow(type, currentItem, isOnlineMode));

    // --- 傳統任務容器（接下來 2 小時 + 其他時間）---
    const wrapper       = DOMHelper.createElement("div", "taskWrapper");
    const onlineWrapper = DOMHelper.createElement("div", "onlineWrapper");

    nextItems.forEach((item) => wrapper.appendChild(this.uiRenderer.createTaskRow(item, false, type)));

    const remWrapper = DOMHelper.createElement("div", "remainingContainer");
    if (openStates[type.key]) remWrapper.classList.add("open");
    remainingItems.forEach((item) => remWrapper.appendChild(this.uiRenderer.createTaskRow(item, true, type)));
    wrapper.appendChild(remWrapper);

    const footer = this.uiRenderer.createFooterWithButton(remWrapper, remainingItems, openStates[type.key]);
    wrapper.appendChild(footer);

    group.appendChild(wrapper);
    group.appendChild(onlineWrapper);

    // 根據活動期間狀態決定顯示哪個容器
    if (!this.onlinePredictionManager.isInitialized || !isOnlineMode) {
      onlineWrapper.style.display = "none";
      wrapper.style.display       = "block";
    } else {
      wrapper.style.display       = "none";
      onlineWrapper.style.display = "block";
    }

    return group;
  }

  // ============================================================
  // 功能按鈕渲染
  // ============================================================

  /**
   * 渲染功能區按鈕（目前包含世界王音效開關）。
   * 此函式獨立於任務列表渲染，在 init() 中優先執行，確保按鈕在資料載入前就可使用。
   */
  renderFunctionalButtons() {
    const bossSoundEl = document.querySelector(".bossSound");
    if (!bossSoundEl) return;

    bossSoundEl.innerHTML = "";
    this.renderWorldBossToggle(bossSoundEl);

    // 補完計畫按鈕（功能開發中，暫時隱藏）
    // this.supplementalManager.renderEntryButton(bossSoundEl);
  }

  /**
   * 在指定容器中渲染音效設定按鈕。
   * 點擊後在按鈕下方顯示 Popup，內含世界王音效開關與音量滑桿。
   * @param {HTMLElement} parentEl - 掛載目標元素
   */
  renderWorldBossToggle(parentEl) {
    const isEnabled = this.soundManager.isSoundEnabled("world_boss");
    const volume    = this.soundManager.getVolume();
    const volPct    = Math.round(volume * 100);

    const wrapper = DOMHelper.createElement("div", "sound-panel-wrapper");

    // --- 圖示按鈕 ---
    const btn = DOMHelper.createElement("button", "sound-panel-btn");
    btn.setAttribute("aria-label", "音效設定");
    btn.setAttribute("type", "button");
    btn.innerHTML = '<img src="./images/sound32_c.png" class="sound-icon" alt="音效設定" data-icon-light="./images/sound32_c.png" data-icon-dark="./images/sound32_w.png">';

    // --- Popup 面板 ---
    const popup = DOMHelper.createElement("div", "sound-popup");
    popup.hidden = true;
    popup.innerHTML = `
      <div class="sound-popup-row">
        <span class="sound-popup-label">世界王音效</span>
        <label class="neumo-switch">
          <input type="checkbox" id="wbSoundToggle" ${isEnabled ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="sound-popup-row">
        <span class="sound-popup-label">整體音量</span>
        <div class="sound-volume-row">
          <input type="range" class="sound-volume-slider"
                 min="0" max="100" value="${volPct}" aria-label="整體音量">
          <span class="sound-volume-value">${volPct}%</span>
        </div>
      </div>
    `;

    // 切換 Popup 顯示 / 隱藏
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.soundManager.unlockAudio();
      popup.hidden = !popup.hidden;
    });

    // 世界王音效開關
    const checkbox = popup.querySelector("#wbSoundToggle");
    checkbox.addEventListener("change", () => {
      this.soundManager.toggleSound("world_boss");
      if (checkbox.checked) {
        this.soundManager.playEffect("./audio/soundON.mp3");
      }
    });

    // 音量滑桿
    const slider   = popup.querySelector(".sound-volume-slider");
    const volLabel = popup.querySelector(".sound-volume-value");
    slider.addEventListener("input", () => {
      const v = parseInt(slider.value, 10) / 100;
      this.soundManager.setVolume(v);
      volLabel.textContent = slider.value + "%";
    });

    // 放開滑鼠／觸控時播放一次試聽音效
    const previewVolume = () => {
      this.soundManager.playVolumePreview("./audio/soundON.mp3");
    };
    slider.addEventListener("mouseup",  previewVolume);
    slider.addEventListener("touchend", previewVolume);

    // 點擊面板外部 → 關閉 Popup（避免多次渲染堆疊，使用 AbortController 管理生命週期）
    if (this._soundPanelAbort) this._soundPanelAbort.abort();
    this._soundPanelAbort = new AbortController();
    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) popup.hidden = true;
    }, { signal: this._soundPanelAbort.signal });

    wrapper.appendChild(btn);
    wrapper.appendChild(popup);
    parentEl.appendChild(wrapper);
  }


  // ============================================================
  // 計時器管理
  // ============================================================

  /**
   * 啟動所有計時器。
   * - 秒級計時器：每秒更新頂部時間、檢查音效觸發
   * - 時級計時器：與整點同步，每小時重新初始化一次（更新公告與任務群組）
   * - 分鐘計時器：由 Web Worker 的 TICK_MINUTE 事件取代，不在此啟動
   */
  startTimers() {
    // 清除所有現有計時器，防止重複啟動
    clearInterval(this.secondlyIntervalId);
    clearTimeout(this.minuteRefreshTimeoutId);
    clearInterval(this.minuteRefreshIntervalId);
    clearTimeout(this.hourlyRefreshTimeoutId);
    clearInterval(this.hourlyRefreshIntervalId);

    const now = this.timeUtils.getNowBySVR();

    // 秒級計時器：優先執行音效檢查，再更新 UI（避免 UI 渲染阻塞音效）
    this.secondlyIntervalId = setInterval(() => {
      this.checkAndPlayWorldBossSound();
      this.checkStaticTaskSounds();
      this.checkPreAlerts();
      this.uiRenderer.updateTopTime();
    }, 1000);

    // 時級計時器：對齊下一個整點後開始，每小時執行一次完整初始化
    const hourlyUpdate = async () => {
      await RemoteConfig.refresh();
      this.uiRenderer.updateTopTime();
      if (this.isInDateRange()) {
        this.initInDateRange();
      } else {
        this.initOutDateRange();
      }
    };

    const nextHour     = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    const msUntilNextHour = nextHour.getTime() - now.getTime();

    this.hourlyRefreshTimeoutId = setTimeout(() => {
      hourlyUpdate();
      this.hourlyRefreshIntervalId = setInterval(hourlyUpdate, CONFIG.HOUR_INTERVAL);
    }, msUntilNextHour);
  }

  // ============================================================
  // 音效檢查
  // ============================================================

  /**
   * 每秒檢查是否需要播放世界王倒計時提示音。
   * 觸發時間點（平日 + 週末 20:50 / 20:55 / 20:59，週末加 14:xx）。
   *
   * 設計考量：
   * - 只在每分鐘的前 5 秒內觸發，避免分頁佇立後計時器漂移導致的重複播放
   * - 使用 lastPlayedId 防止同一分鐘內重複觸發
   * - 維護期間強制靜音
   */
  checkAndPlayWorldBossSound() {
    if (this.isMaintenanceActive) return;

    const now    = this.timeUtils.getNowBySVR();
    const day    = now.getDay();
    const hour   = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();

    // 只在進入新分鐘的 0-5 秒內觸發（容忍計時器漂移）
    if (second > 5) return;

    const playId    = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    if (this.lastPlayedId === playId) return; // 此分鐘已處理

    const isWeekend = day === 0 || day === 6;
    let   audioSrc  = null;

    // 每日 20:50 / 20:55 / 20:59（世界王 21:00 登場倒計時）
    if (hour === 20) {
      if (minute === 50) audioSrc = "./audio/boss10.mp3";
      else if (minute === 55) audioSrc = "./audio/boss5.mp3";
      else if (minute === 59) audioSrc = "./audio/boss1.mp3";
    }
    // 週末加碼 14:50 / 14:55 / 14:59（週末世界王 15:00 登場倒計時）
    else if (isWeekend && hour === 14) {
      if (minute === 50) audioSrc = "./audio/boss10.mp3";
      else if (minute === 55) audioSrc = "./audio/boss5.mp3";
      else if (minute === 59) audioSrc = "./audio/boss1.mp3";
    }

    if (audioSrc) {
      this.lastPlayedId = playId;
      console.log(`[世界王] 觸發提示音 ${playId}：${audioSrc}`);
      this.soundManager.playWorldBossSound(audioSrc, playId);
    }
  }

  /**
   * 每秒檢查靜態班表中是否有任務在當前時間出現，若有則播放對應音效。
   * 適用條件：非活動期間，或該任務類型未啟用線上系統。
   * 維護任務不播放音效；世界王倒計時時間段內也不播放（避免音效堆疊）。
   */
  checkStaticTaskSounds() {
    if (!this.cachedScheduleRows) return;

    const now           = this.timeUtils.getNowBySVR();
    const currentHour   = now.getHours();
    const currentMinute = now.getMinutes();
    const second        = now.getSeconds();

    // 只在進入新分鐘的 0-5 秒內觸發（容忍計時器漂移）
    if (second > 5) return;

    // 同一分鐘內只播放一次：
    // 每秒計時器在 second=0~5 這 6 次都會通過上方的檢查，
    // 若不加此去重機制，同一個音效會被連續呼叫 6 次造成重複播放。
    const playId = `static_${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;
    if (this.lastStaticSoundPlayedId === playId) return;
    this.lastStaticSoundPlayedId = playId;

    const currentDay  = now.getDay();
    const todayWeek   = currentDay === 0 ? 7 : currentDay;
    const isActivityPeriod = this.isInDateRange();

    this.taskProcessor.getVisibleTaskTypes().forEach((type) => {
      // 活動期間且該類型啟用線上系統：跳過靜態音效（由線上回報系統負責）
      if (isActivityPeriod && type.useOnlineSystem) return;

      const todayList = this.taskProcessor.getTaskListForWeek(this.cachedScheduleRows, type, todayWeek);
      todayList.forEach((item) => {
        if (!item.time) return;
        const [h, m] = item.time.split(":").map(Number);
        if (h !== currentHour || m !== currentMinute) return;
        if (this.taskUtils.isMaintenanceTask(item)) return; // 維護任務不播放

        // 世界王倒計時時間段內，抑制野王任務音效（避免同時播放兩種音效）
        const isTargetTask = ["gishiki", "shirao", "sengen"].includes(type.key);
        if (isTargetTask) {
          const isWeekend    = currentDay === 0 || currentDay === 6;
          const isDailySupp  = currentHour === 20 && currentMinute >= 50;
          const isWeekendSupp = isWeekend && currentHour === 14 && currentMinute >= 50;
          if (isDailySupp || isWeekendSupp) return;
        }

        this.soundManager.playTaskSound(type.key, item);
      });
    });
  }

  /**
   * 每秒檢查是否需要播放仙幻島野王的預告音效（出現前 10 秒）。
   * 只在非活動期間執行（活動期間由線上回報系統負責）。
   * 觸發邏輯：當前秒數 = 50 且 4 分鐘前有仙幻島任務 → 播放預告音
   */
  checkPreAlerts() {
    if (!this.cachedScheduleRows) {
      if (!this.alertStatusLogged) {
        console.log("[預警] 排程資料尚未載入，靜待中...");
        this.alertStatusLogged = true;
      }
      return;
    }

    if (this.isInDateRange()) {
      if (!this.alertStatusLogged) {
        console.log("[預警] 活動期間：靜態班表預警已停用，改由線上預測系統處理");
        this.alertStatusLogged = true;
      }
      return;
    }

    this.alertStatusLogged = false; // 非活動期間，重置旗標以備下次狀態切換

    const now = this.timeUtils.getNowBySVR();
    if (now.getSeconds() !== 51) return; // 只在每分鐘第 50 秒觸發

    // 從當前時間回推 4 分鐘，找出對應的任務時間點
    const taskTime   = new Date(now.getTime() - 4 * 60_000);
    const tHour      = taskTime.getHours();
    const tMinute    = taskTime.getMinutes();
    const tDay       = taskTime.getDay();
    const week       = tDay === 0 ? 7 : tDay;

    const tasks = this.taskProcessor.getTaskListForWeek(this.cachedScheduleRows, { key: "sengen" }, week);
    const hasValidTask = tasks.some((t) => {
      const [h, m] = t.time.split(":").map(Number);
      return h === tHour && m === tMinute && !this.taskUtils.isMaintenanceTask(t);
    });

    if (hasValidTask) {
      this.soundManager.playSengenPreAlert();
    }
  }
}

// ============================================================
// 應用程式啟動
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const app = new TaskScheduleApp();
  app.init();
});