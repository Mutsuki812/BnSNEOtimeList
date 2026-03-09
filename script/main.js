/* ==========================
   ==== メインアプリケーション ====
   ========================== */

import { CONFIG, DATE_RANGES } from './config.js';
import { LanguageManager, TimeUtils, TaskUtils, DOMHelper } from './utils.js';
import { ExcelDataLoader, TaskDataProcessor } from './taskProcessor.js';
import { UIRenderer } from './uiRenderer.js';
import { ReportManager } from './reportManager.js';
import { SoundManager } from './soundManager.js';
import { OnlinePredictionManager } from './onlinePrediction.js';

/**
 * メインアプリケーションクラス
 */
class TaskScheduleApp {
  constructor() {
    // 依存関係の初期化
    this.languageManager = new LanguageManager();
    this.timeUtils = new TimeUtils(this.languageManager);
    this.taskUtils = new TaskUtils(this.languageManager);
    this.excelLoader = new ExcelDataLoader(this.languageManager, this.timeUtils);
    this.taskProcessor = new TaskDataProcessor(this.languageManager, this.timeUtils, this.taskUtils);
    this.soundManager = new SoundManager();
    this.uiRenderer = new UIRenderer(this.languageManager, this.timeUtils, this.taskUtils, this.soundManager);
    this.reportManager = new ReportManager(this.languageManager);
    this.onlinePredictionManager = new OnlinePredictionManager(this.languageManager, this.timeUtils);

    // データキャッシュ
    this.cachedExcelRows = null;
    this.minuteRefreshIntervalId = null;
    this.minuteRefreshTimeoutId = null;
    this.hourlyRefreshIntervalId = null;
    this.hourlyRefreshTimeoutId = null;
    this.secondlyIntervalId = null;
    this.loadToken = 0; // ロード操作の世代を管理するトークン
  }

  /**
   * アプリケーション初期化
   */
  async init() {
    this.languageManager.detect();
    this.setupLanguageToggle();
    this.setupViewDailyButton();
    this.uiRenderer.updateTopTime();
    this.uiRenderer.updateViewDailyButtonVisibility();

    if (this.isInDateRange()) {
      this.initInDateRange();
    } else {
      this.initOutDateRange();
    }

    this.reportManager.updateAll();
    this.reportManager.loadReports();
    this.startTimers();

    // 僅在中文環境下，延遲短時間後顯示音效解鎖提示，引導使用者互動
    // 這樣可以確保音效功能正常運作
    if (this.languageManager.current === 'zh') {
      setTimeout(() => {
        this.soundManager.showUnlockModal();
      }, 500);
    }
  }

  /**
   * 言語切り替えボタンの設定
   */
  setupLanguageToggle() {
    const langBtn = document.getElementById("langBtn");
    if (!langBtn) return;

    this.updateLangButtonText();

    langBtn.addEventListener("click", () => {
      this.languageManager.toggle();
      this.updateLangButtonText();

      // 古い言語環境の状態を破棄するために onlinePredictionManager を再作成します。
      // これにより、オンラインシステムを使用する中国語モードから日本語モードに切り替えた後に発生する競合状態を防ぎます。
      // 中国語モードからの非同期操作（バックグラウンドで実行中）が誤って isInitialized を true に設定し、
      // 日本語モードの画面描画が正しく行われない問題を回避します。
      this.onlinePredictionManager = new OnlinePredictionManager(this.languageManager, this.timeUtils);

      // タイマーをリセットして、新しいタイムゾーンに同期させます
      this.startTimers();

      this.uiRenderer.updateTopTime();
      this.uiRenderer.updateViewDailyButtonVisibility();

      if (this.isInDateRange()) {
        this.initInDateRange();
      } else {
        this.initOutDateRange();
      }

      this.reportManager.updateAll();
    });
  }

  /**
   * 終日タスクボタンの設定
   */
  setupViewDailyButton() {
    const btn = document.getElementById("viewDailyBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        // dailyQuest.html へ遷移
        window.location.href = "dailyQuest.html";
      });
    }
  }

  /**
   * 言語ボタンテキスト更新
   */
  updateLangButtonText() {
    const langBtn = document.getElementById("langBtn");
    if (langBtn) {
      langBtn.textContent = this.languageManager.current === "zh"
        ? "日本鯖切替"
        : "切換到台服";
    }
  }

  /**
   * 特定期間内かチェック
   */
  isInDateRange() {
    // const now = this.timeUtils.getNowBySVR();
    // const range = DATE_RANGES[this.languageManager.current];
    // return now >= range.start && now <= range.end;
    const now = this.timeUtils.getNowBySVR();
    const range = DATE_RANGES[this.languageManager.current];
    const start = this.timeUtils.getShiftedDate(range.start);
    const end = this.timeUtils.getShiftedDate(range.end);
    return now >= start && now <= end;
  }

  /**
   * 共通初期化処理
   */
  initCommon({ showTemporaryNotice }) {
    this.uiRenderer.updateRegularNotice();

    // 期間限定のお知らせ
    const temporaryNoticeDiv = document.getElementById("temporaryNotice");
    if (temporaryNoticeDiv) {
      //　中文のみ
      const isZh = this.languageManager.current === "zh";
      const shouldShow = showTemporaryNotice && isZh;
      
      temporaryNoticeDiv.style.display = shouldShow ? "block" : "none";

      if (shouldShow) {
        this.uiRenderer.updateTemporaryNoticeText();
      }
    }

    DOMHelper.updateElement("taskContainer", null, "block");
    this.loadTasksAndRender();

    // 分単位の更新タイマー
    if (this.minuteRefreshIntervalId) {
      clearInterval(this.minuteRefreshIntervalId);
    }
    this.minuteRefreshIntervalId = setInterval(() => {
      if (this.cachedExcelRows) {
        this.renderAllGroups(this.cachedExcelRows);
      }
    }, CONFIG.REFRESH_INTERVAL);
    // 分単位の更新タイマーは startTimers で一元管理されます。
  }

  /**
   * 期間外の初期化
   */
  initOutDateRange() {
    this.initCommon({ showTemporaryNotice: false });
  }

  /**
   * 期間内の初期化
   */
  initInDateRange() {
    this.initCommon({ showTemporaryNotice: true });
    // onlinePredictionManager の初期化は loadTasksAndRender 内に移動しました。
    // データのロード完了前に古いUIがレンダリングされ、画面がちらつくのを防ぐためです。
  }

  /**
   * タスクデータのロードとレンダリング
   */
  async loadTasksAndRender() {
    this.loadToken++; // 新しいロードリクエストごとにトークンをインクリメント
    const currentToken = this.loadToken;

    const loadPromises = [this.excelLoader.loadExcel()];

    // 特別イベント期間中の場合、オンライン予測システムも同時に初期化します
    if (this.isInDateRange()) {
      loadPromises.push(this.onlinePredictionManager.init());
    } else {
      this.onlinePredictionManager.isInitialized = false;
    }

    // 必要なすべてのデータがロードされるのを待ちます
    const [rows] = await Promise.all(loadPromises);

    // awaitの後に、新しいロードが開始されていないか確認します。もしそうなら、レンダリングを中止します。
    if (currentToken !== this.loadToken) {
      console.log(`Render aborted for token ${currentToken}, current is ${this.loadToken}.`);
      return;
    }

    this.cachedExcelRows = rows;
    this.renderAllGroups(rows);
  }

  /**
   * すべてのタスクグループをレンダリング
   */
  renderAllGroups(rows) {
    const container = document.getElementById("taskContainer");
    if (!container || container.style.display === "none") {
      return;
    }

    // 展開状態を保存
    const openStates = this.saveOpenStates(container);

    container.innerHTML = "";

    const now = this.timeUtils.getNowBySVR();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay = now.getDay();
    
    const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
    const todayWeekZh = WEEKDAYS_ZH[currentDay];
    const tomorrowWeekZh = WEEKDAYS_ZH[(currentDay + 1) % 7];

    this.taskProcessor.getVisibleTaskTypes().forEach(type => {
      const group = this.createTaskGroup(
        rows,
        type,
        todayWeekZh,
        tomorrowWeekZh,
        currentHour,
        currentMinute,
        currentDay,
        openStates
      );
      container.appendChild(group);
    });

    // レンダリング完了後、オンライン予測と報告UIを注入します
    this.onlinePredictionManager.updateView();

    this.checkAndPlayWorldBossSound();
  }

  /**
   * 檢查並播放預告音效
   */
  checkPreAlerts() {
    if (!this.cachedExcelRows) return;

    const now = this.timeUtils.getNowBySVR();
    const s = now.getSeconds();

    // 仙幻島 (sengen) 野王出現前10秒提示 (任務時間 + 4分50秒)
    if (s === 50) {
      // 當前時間是 HH:MM:50，我們要找的任務時間是 HH:(MM-4):00
      // 所以我們從當前時間回推4分鐘，來取得任務應該開始的小時與分鐘
      const taskTime = new Date(now.getTime() - (4 * 60 * 1000));
      const tHour = taskTime.getHours();
      const tMinute = taskTime.getMinutes();
      const tDay = taskTime.getDay();
      
      const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
      const weekZh = WEEKDAYS_ZH[tDay];

      const type = { key: "sengen" };
      const tasks = this.taskProcessor.getTaskListForWeek(this.cachedExcelRows, type, weekZh);

      // 檢查在 4 分鐘前是否有仙幻島任務
      const hasTask = tasks.some(t => {
        const [h, m] = t.time.split(":").map(Number);
        return h === tHour && m === tMinute;
      });

      if (hasTask) {
        this.soundManager.playSengenPreAlert();
      }
    }
  }

  /**
   * 檢查並播放世界王提示音
   */
  checkAndPlayWorldBossSound() {
    // 只在中文環境下觸發
    if (this.languageManager.current !== 'zh') {
      return;
    }

    const now = this.timeUtils.getNowBySVR();
    const day = now.getDay(); // 0=日, 1=一, ..., 6=六
    const hour = now.getHours();
    const minute = now.getMinutes();

    let audioSrc = null;

    const isWeekend = (day === 0 || day === 6);

    if (hour === 20) {
      if (minute === 50) audioSrc = './audio/boss10.mp3';
      else if (minute === 55) audioSrc = './audio/boss5.mp3';
      else if (minute === 59) audioSrc = './audio/boss1.mp3';
    } else if (isWeekend && hour === 15) {
      if (minute === 50) audioSrc = './audio/boss10.mp3';
      else if (minute === 55) audioSrc = './audio/boss5.mp3';
      else if (minute === 59) audioSrc = './audio/boss1.mp3';
    }

    if (audioSrc) {
      const playId = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      this.soundManager.playWorldBossSound(audioSrc, playId);
    }
  }

  /**
   * 展開状態を保存
   */
  saveOpenStates(container) {
    const openStates = {};
    this.taskProcessor.getVisibleTaskTypes().forEach(type => {
      const existingGroup = container.querySelector(`.group.${type.key}`);
      if (existingGroup) {
        const remContainer = existingGroup.querySelector('.remainingContainer');
        if (remContainer && remContainer.classList.contains('open')) {
          openStates[type.key] = true;
        }
      }
    });
    return openStates;
  }

  /**
   * タスクグループの作成
   */
  createTaskGroup(rows, type, todayWeekZh, tomorrowWeekZh, currentHour, currentMinute, currentDay, openStates) {
    // 今日と明日のタスクリストを取得
    let todayList = this.taskProcessor.getTaskListForWeek(rows, type, todayWeekZh);
    let tomorrowList = this.taskProcessor.getTaskListForWeek(rows, type, tomorrowWeekZh);

    // 組み合わせ
    let combinedList = [...todayList];
    if (tomorrowList.length > 0 && currentHour > 20) {
      const markedTomorrowList = tomorrowList.map(item => ({
        ...item,
        isNextDay: true,
        displayTime: item.time
      }));
      combinedList = [...todayList, ...markedTomorrowList];
    }

    // メンテナンスタスクのマージ
    combinedList = this.taskUtils.mergeConsecutiveMaintenance(combinedList);

    // タスクの分類
    const { previousItem, currentItem, nextItems, remainingItems, isInMaintenance } =
      this.taskProcessor.categorizeTasksByTime(combinedList, currentHour, currentMinute);

    // 効果音再生チェック：現在のタスクがあり、まだ効果音が再生されていない場合は再生します
    if (!isInMaintenance) {
      combinedList.forEach(item => {
        if (item.time) {
          const [h, m] = item.time.split(":").map(Number);
          if (h === currentHour && m === currentMinute) {
            // 在世界王出現的時間 (每日 20:50-59, 週末 14:50-59) 暫停儀式/白青/仙幻島的音效
            const isTargetTask = ['gishiki', 'shirao', 'sengen'].includes(type.key);
            if (isTargetTask) {
              const day = currentDay; // 0 = Sunday, 6 = Saturday
              const hour = currentHour;
              const minute = currentMinute;
              const isWeekend = (day === 0 || day === 6);

              const isDailySuppressionTime = (hour === 20 && minute >= 50 && minute <= 59);
              const isWeekendSuppressionTime = (isWeekend && hour === 14 && minute >= 50 && minute <= 59);

              if (isDailySuppressionTime || isWeekendSuppressionTime) {
                console.log(`[Sound Check] Sound suppressed for ${type.key} at ${hour}:${minute} due to world boss time.`);
                return; // continue to next item in forEach
              }
            }
            console.log(`[Sound Check] 時間吻合! 任務: ${type.key}, 時間: ${item.time}`);
            this.soundManager.playTaskSound(type.key, item);
          }
        }
      });
    }

    // グループ要素の作成
    const group = DOMHelper.createElement("div", `group ${type.key}`);

    // 前の時間のタスク
    const lang = this.languageManager.current;
    let showPrevious = false;

    if (lang === "jp") {
      showPrevious = true;
    } else if (lang === "zh") {
      if (type.key === "gishiki") {
        showPrevious = true;
      } else if ((type.key === "shirao" || type.key === "sengen") && previousItem) {
        const prevMin = parseInt(previousItem.time.split(":")[1], 10);
        if (prevMin >= 55 && currentMinute <= 5) {
          showPrevious = true;
        }
      }
    }

    if (showPrevious) {
      const previousRow = this.uiRenderer.createPreviousHourTaskRow(
        previousItem,
        currentItem,
        currentHour,
        currentMinute,
        type
      );
      group.appendChild(previousRow);
    }

    // 現在のタスク
    const curRow = this.uiRenderer.createCurrentTaskRow(type, currentItem);
    group.appendChild(curRow);

    // 期間外に表示される従来のタスクラッパー
    const wrapper = DOMHelper.createElement("div", "taskWrapper");
    // 期間内に表示されるオンライン回報システム用のラッパー
    const onlineWrapper = DOMHelper.createElement("div", "onlineWrapper");

    // 従来のラッパーにコンテンツを常に追加
    // 次の2時間のタスク
    nextItems.forEach(item => {
      wrapper.appendChild(this.uiRenderer.createTaskRow(item, false, type));
    });

    // 残りのタスク（折りたたみ可能）
    const remWrapper = DOMHelper.createElement("div", "remainingContainer");
    if (openStates[type.key]) {
      remWrapper.classList.add('open');
    }
    remainingItems.forEach(item => {
      remWrapper.appendChild(this.uiRenderer.createTaskRow(item, true, type));
    });
    wrapper.appendChild(remWrapper);

    // フッターとボタン
    const footer = this.uiRenderer.createFooterWithButton(remWrapper, remainingItems, openStates[type.key]);
    wrapper.appendChild(footer);

    group.appendChild(wrapper);
    group.appendChild(onlineWrapper);

    // isInitialized の状態に基づいて表示を切り替える
    if (!this.onlinePredictionManager.isInitialized) {
      onlineWrapper.style.display = 'none';
    } else {
      wrapper.style.display = 'none';
    }

    return group;
  }

  /**
   * タイマーの開始とリセット
   */
  startTimers() {
    // 既存のタイマーをすべてクリア
    clearInterval(this.secondlyIntervalId);
    clearTimeout(this.minuteRefreshTimeoutId);
    clearInterval(this.minuteRefreshIntervalId);
    clearTimeout(this.hourlyRefreshTimeoutId);
    clearInterval(this.hourlyRefreshIntervalId);

    // 1秒ごとに時刻を更新
    this.secondlyIntervalId = setInterval(() => {
      this.uiRenderer.updateTopTime();
      this.checkPreAlerts();
    }, 1000);

    // 毎分更新（分頭に同期）
    const minuteUpdate = () => {
      if (this.cachedExcelRows) {
        this.renderAllGroups(this.cachedExcelRows);
      }
    };

    const now = this.timeUtils.getNowBySVR();

    const nextMinute = new Date(now);
    nextMinute.setMinutes(now.getMinutes() + 1, 0, 0);
    const msUntilNextMinute = nextMinute.getTime() - now.getTime();

    this.minuteRefreshTimeoutId = setTimeout(() => {
      minuteUpdate();
      this.minuteRefreshIntervalId = setInterval(minuteUpdate, CONFIG.REFRESH_INTERVAL);
    }, msUntilNextMinute);

    // 毎時更新（時頭に同期）
    const hourlyUpdate = () => {
      this.uiRenderer.updateTopTime();
      if (this.isInDateRange()) {
        this.initInDateRange();
      } else {
        this.initOutDateRange();
      }
    };

    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    const msUntilNextHour = nextHour.getTime() - now.getTime();

    this.hourlyRefreshTimeoutId = setTimeout(() => {
      hourlyUpdate();
      this.hourlyRefreshIntervalId = setInterval(hourlyUpdate, CONFIG.HOUR_INTERVAL);
    }, msUntilNextHour);
  }
}

// アプリケーションの起動
document.addEventListener("DOMContentLoaded", () => {
  const app = new TaskScheduleApp();
  app.init();
});