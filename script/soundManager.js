/* ============================================================
   音效管理器
   統一管理所有音效的開關設定、播放邏輯與音訊解鎖流程。

   音效架構：
   - audioPlayer:  一般任務觸發音效（儀式/白青/仙幻島出現）
   - bossPlayer:   世界王倒計時提示音（獨立播放器，避免與任務音效互相中斷）
   - silentSource: 靜音資料 URI，用於在使用者互動前預熱 Audio 引擎
   ============================================================ */

import { StorageHelper } from "./utils.js";

// ============================================================
// 常數定義
// ============================================================

/** localStorage 儲存音效設定的鍵名 */
const SOUND_SETTINGS_KEY = "bnsneo_soundSettings";

/** 所有受管理的音效類型識別鍵 */
const ALL_SOUND_KEYS = ["gishiki", "shirao", "sengen", "world_boss"];

/**
 * 地點對應音效檔的映射表。
 * 結構：{ [任務類型 key]: { [地點名稱]: '音效檔路徑' } }
 * 僅白青 (shirao) 與仙幻島 (sengen) 有地點音效；儀式統一使用預設音效。
 */
const SOUND_MAP = {
  shirao: {
    白樺林:   "./audio/shiraoForest.mp3",
    風之平原: "./audio/shiraoHavoc.mp3",
  },
  sengen: {
    知性森林: "./audio/sengenForest.mp3",
    力王山脈: "./audio/sengenMountains.mp3",
    武神荒野: "./audio/sengenWilderness.mp3",
  },
};

/** 各音效類型對應的通知顯示名稱 */
const TASK_LABELS = {
  gishiki:    "可疑的儀式",
  shirao:     "白青野王",
  sengen:     "仙幻島野王",
  world_boss: "世界王",
};

// ============================================================
// SoundManager 類別
// ============================================================

/**
 * 負責統一管理音效設定與播放的核心類別。
 * 使用單一 Audio 物件重複播放，解決行動版 Chrome 禁止建立新 Audio 物件的限制。
 */
export class SoundManager {
  constructor() {
    // 載入或初始化音效設定
    // - 初次訪問：所有音效預設開啟
    // - 後續訪問：保留使用者的偏好設定，並補上新增的音效類型
    let loadedSettings = StorageHelper.get(SOUND_SETTINGS_KEY, null);

    if (loadedSettings === null) {
      // 首次訪問：預設全部開啟
      loadedSettings = Object.fromEntries(ALL_SOUND_KEYS.map((key) => [key, true]));
    } else {
      // 後續訪問：補上可能新增的音效類型（不覆蓋舊設定）
      ALL_SOUND_KEYS.forEach((key) => {
        if (typeof loadedSettings[key] === "undefined") {
          loadedSettings[key] = true;
        }
      });
    }

    this.settings = loadedSettings;
    this.saveSettings(); // 同步寫回，確保設定完整性

    this.modalShown      = false; // 音訊解鎖提示 Modal 是否已顯示過
    this.isAudioUnlocked = false; // 使用者是否已透過互動解鎖音訊自動播放
    this.lastPlayed      = {};    // 記錄各 playId 是否已播放，防止世界王音效重複觸發

    // 使用固定的 Audio 物件，重複設定 src 來播放不同音效
    // 這是行動版瀏覽器的必要做法（禁止連續建立新 Audio 實例）
    this.audioPlayer = new Audio(); // 一般任務音效播放器
    this.bossPlayer  = new Audio(); // 世界王倒計時音效播放器（獨立，防止互相中斷）

    // 靜音 MP3 Data URI：在使用者首次互動時播放此音訊，
    // 提前解鎖瀏覽器的音訊自動播放限制，讓後續的自動播放可以成功
    this.silentSource =
      "data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAAgAAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

    // 預置靜音資源，確保 Audio 引擎在第一次互動前已完成初始化
    this.audioPlayer.src = this.silentSource;
    this.bossPlayer.src  = this.silentSource;

    this.modalElement = null; // 音訊解鎖提示 Modal 的 DOM 參考

    this.volume = StorageHelper.get('bnsneo_volume', 0.8);
  }

  // ============================================================
  // 音效設定管理
  // ============================================================

  /**
   * 將當前音效設定寫入 localStorage 以持久化保存。
   */
  saveSettings() {
    StorageHelper.set(SOUND_SETTINGS_KEY, this.settings);
  }

  /**
   * 查詢指定音效類型的開關狀態。
   * @param {string} key - 音效類型鍵（如 "gishiki", "world_boss"）
   * @returns {boolean} - true 表示啟用
   */
  isSoundEnabled(key) {
    return this.settings[key] === true;
  }

  /**
   * 切換指定音效類型的開關狀態並儲存。
   * @param {string} key - 音效類型鍵
   */
  toggleSound(key) {
    this.settings[key] = !this.settings[key];
    this.saveSettings();
    console.log(`[音效] 切換 ${key}：${this.settings[key] ? "開啟" : "關閉"}`);
  }

  /** 取得目前音量 (0.0 ~ 1.0)。 */
  getVolume() {
    return this.volume;
  }

  /**
   * 設定音量並立即套用至所有播放器。
   * @param {number} v - 音量值 (0.0 ~ 1.0)
   */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    StorageHelper.set('bnsneo_volume', this.volume);
    this.audioPlayer.volume = this.volume;
    this.bossPlayer.volume  = this.volume;
  }

  // ============================================================
  // 音訊解鎖
  // ============================================================

  /**
   * 解鎖瀏覽器的音訊自動播放限制。
   * 必須在使用者的互動事件（點擊、觸控）中呼叫，才能成功解鎖。
   * 解鎖後，後續的 play() 呼叫才不會被 NotAllowedError 阻擋。
   */
  unlockAudio() {
    if (this.isAudioUnlocked) return;

    // 同時解鎖兩個播放器
    [this.audioPlayer, this.bossPlayer].forEach((player) => {
      player.src = this.silentSource;
      player.play().catch(() => {}); // 靜默捕獲錯誤，解鎖動作本身即已達成目的
    });

    this.isAudioUnlocked = true;
    console.log("[音效] 音訊播放已解鎖");

    // 趁使用者互動時一併申請桌面通知權限（分頁隱藏時的替代提醒）
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    // 解鎖後移除提示 Modal
    if (this.modalElement) {
      this.modalElement.remove();
      this.modalElement = null;
    }
  }

  /**
   * 顯示音訊解鎖提示 Modal，引導使用者點擊以解鎖自動播放。
   * 只在尚未解鎖且尚未顯示過 Modal 時觸發。
   */
  showUnlockModal() {
    if (this.isAudioUnlocked || this.modalShown) return;
    this.modalShown = true;

    const overlay = document.createElement("div");
    overlay.className = "sound-unlock-overlay";

    const modal = document.createElement('div');
    modal.className = 'sound-unlock-modal';

    modal.innerHTML = `
      <h3>點擊畫面 啟用音效</h3>
      <p>
        為了確保音效正常運作<br>請點擊頁面任意處。
      </p>
      <div class="sound-unlock-hint">(這是瀏覽器的安全限制，需要您的互動來授權聲音播放)</div>
    `;

    const unlock = () => {
      this.unlockAudio();
      overlay.remove();
      this.modalElement = null;
    };

    overlay.addEventListener("click", unlock);
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this.modalElement = overlay;
  }

  // ============================================================
  // 音效播放
  // ============================================================

  /**
   * 播放一般任務觸發音效（儀式/白青/仙幻島）。
   * 依據任務地點從 SOUND_MAP 查找對應音效；找不到時使用預設音效。
   * @param {string} taskTypeKey - 任務類型鍵（如 "gishiki"）
   * @param {object} item        - 任務項目物件（含 content 地點資訊）
   */
  playTaskSound(taskTypeKey, item) {
    if (!this.isSoundEnabled(taskTypeKey)) {
      console.log(`[音效] ${taskTypeKey} 音效已關閉，跳過`);
      return;
    }
    if (!this.isAudioUnlocked) {
      console.log(`[音效] 音訊未解鎖，跳過播放 (${taskTypeKey})`);
      return;
    }

    // 依地點查找對應音效，找不到時使用預設音效
    const locationMap = SOUND_MAP[taskTypeKey];
    const location    = item?.content || "";
    let   audioSrc    = locationMap?.[location] ?? `./audio/${taskTypeKey}.mp3`;

    if (document.hidden) {
      const label = TASK_LABELS[taskTypeKey] || taskTypeKey;
      this._notify(`${label}將在十分鐘後出現`, location);
      return;
    }

    this._play(this.audioPlayer, audioSrc, taskTypeKey);
  }

  /**
   * 播放仙幻島野王出現前 10 秒的預告音效。
   * 在任務時間前 4 分 50 秒由主執行緒觸發。
   */
  playSengenPreAlert() {
    if (!this.isSoundEnabled("sengen")) return;
    if (!this.isAudioUnlocked) return;
    if (document.hidden) {
      return;
    }
    this._play(this.audioPlayer, "./audio/sengen10.mp3", "sengen_pre_alert");
  }

  /**
   * 播放活動期間的預測提醒音效（白青 / 仙幻島推算開始時間到達）。
   * 由 OnlinePredictionManager.updatePredictionDisplay 在推算開始分鐘呼叫。
   * 使用 lastPlayed 去重，確保同一分鐘內無論 renderAllGroups 被呼叫幾次都只播一次。
   * @param {string} typeKey - "shirao" 或 "sengen"
   */
  playForecastSound(typeKey) {
    if (!this.isSoundEnabled(typeKey)) return;
    if (!this.isAudioUnlocked) return;

    const now    = new Date();
    const playId = `forecast_${typeKey}_${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (this.lastPlayed[playId]) return;
    this.lastPlayed[playId] = true;

    const src = typeKey === "shirao"
      ? "./audio/shiraoForecast.mp3"
      : "./audio/sengenForecast.mp3";

    if (document.hidden) {
      const label = TASK_LABELS[typeKey] || typeKey;
      this._notify(`${label} 將在接下來10分鐘內出現`);
      return;
    }

    console.log(`[音效] 播放預測提醒音 (${typeKey})：${src}`);
    this._play(this.audioPlayer, src, `${typeKey}_forecast`);
  }

  /**
   * 播放世界王倒計時提示音（20:50、20:55、20:59 等時間點）。
   * 使用獨立的 bossPlayer，不干擾一般任務音效。
   * @param {string} audioSrc - 音效檔案路徑
   * @param {string} playId   - 本分鐘的唯一識別 ID（格式 "HH:MM"），防止重複播放
   */
  playWorldBossSound(audioSrc, playId) {
    if (!this.isSoundEnabled("world_boss")) {
      console.log("[音效] 世界王音效已關閉，跳過");
      return;
    }
    if (!this.isAudioUnlocked) {
      console.log("[音效] 音訊未解鎖，跳過世界王音效");
      return;
    }
    if (this.lastPlayed[playId]) return; // 此分鐘已播放過，不重複

    this.lastPlayed[playId] = true;
    console.log(`[音效] 播放世界王提示音 (${playId})：${audioSrc}`);

    if (document.hidden) {
      if (playId === "20:50" || playId === "14:50") {
        this._notify("世界王將在十分鐘後出現", playId);
      }
      return;
    }

    this._play(this.bossPlayer, audioSrc, "world_boss");
  }

  /**
   * 播放任意指定路徑的音效（用於 UI 互動回饋，如開關切換確認音）。
   * @param {string} audioSrc - 音效檔案路徑
   */
  playEffect(audioSrc) {
    if (!this.isAudioUnlocked) return;
    this._play(this.audioPlayer, audioSrc, "effect");
  }

  /**
   * 播放音量試聽音效（放開滑桿時呼叫）。
   * 與 playEffect 不同，此方法每次都會從頭重播，確保使用者聽到當前音量的即時回饋。
   * @param {string} audioSrc - 音效檔案路徑
   */
  playVolumePreview(audioSrc) {
    if (!this.isAudioUnlocked) return;
    this.audioPlayer.pause();
    this.audioPlayer.currentTime = 0;
    this.audioPlayer.src         = audioSrc;
    this.audioPlayer.volume      = this.volume;
    this.audioPlayer.play().catch((err) => {
      if (err.name !== "NotAllowedError") {
        console.warn("[音效] 音量試聽播放失敗", err);
      }
    });
  }

  // ============================================================
  // 私有輔助方法
  // ============================================================

  /**
   * 送出系統桌面通知（分頁隱藏時的音效替代手段）。
   * 需要使用者已授予通知權限；未授權時靜默略過。
   * @param {string} title - 通知標題
   * @param {string} body  - 通知內文（可空白）
   */
  _notify(title, body = "") {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "./images/BSNEO.png" });
  }

  /**
   * 通用音效播放邏輯，包含錯誤處理。
   * @param {HTMLAudioElement} player     - 要使用的 Audio 播放器
   * @param {string}           audioSrc   - 音效檔案路徑
   * @param {string}           contextKey - 用於日誌識別的上下文名稱
   */
  _play(player, audioSrc, contextKey) {
    // 若正在播放相同音效，不中斷直接返回（避免重複呼叫導致從頭重播）
    if (
      !player.paused &&
      player.src.endsWith(audioSrc.replace(/^\.\//, "")) &&
      player.currentTime > 0
    ) {
      console.log(`[音效] 已在播放中，跳過重複呼叫 (${contextKey})`);
      return;
    }

    player.pause();
    player.currentTime = 0;
    player.src         = audioSrc;
    player.volume      = this.volume;

    const playPromise = player.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => console.log(`[音效] 播放成功 (${contextKey})`))
        .catch((error) => {
          if (error.name === "NotAllowedError") {
            console.log(`[音效] 自動播放被阻擋 (${contextKey})，重置解鎖狀態`);
            this.isAudioUnlocked = false;
            this.modalShown = false;
            this.showUnlockModal();
          } else if (error.name === "NotSupportedError") {
            console.warn(`[音效] 音訊格式不支援或來源無效 (${contextKey})`, error);
          } else {
            console.warn(`[音效] 播放失敗 (${contextKey})`, error);
          }
        });
    }
  }
}
