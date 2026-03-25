/* ==========================
   ==== 音效管理 ====
   ========================== */

import { StorageHelper } from './utils.js';

const SOUND_SETTINGS_KEY = 'bnsneo_soundSettings';

const SOUND_MAP = {
  shirao: {
    '白樺林': './audio/shiraoForest.mp3',
    '風之平原': './audio/shiraoHavoc.mp3'
  },
  sengen: {
    '知性森林': './audio/sengenForest.mp3',
    '力王山脈': './audio/sengenMountains.mp3',
    '武神荒野': './audio/sengenWilderness.mp3'
  }
};

/**
 * 管理音效提示的設定
 */
export class SoundManager {
  constructor() {
    // 預設開啟所有音效。如果使用者之前有手動關閉，則會保留該設定。
    // 對於初次使用的訪客，所有音效提示都會是開啟狀態。
    const allSoundKeys = ['gishiki', 'shirao', 'sengen', 'world_boss'];
    let loadedSettings = StorageHelper.get(SOUND_SETTINGS_KEY, null);

    if (loadedSettings === null) {
      // 首次訪問，預設開啟所有音效
      loadedSettings = {};
      allSoundKeys.forEach(key => {
        loadedSettings[key] = true;
      });
    } else {
      // 後續訪問，檢查是否有新的音效類型需要預設開啟，而不覆蓋舊的設定
      allSoundKeys.forEach(key => {
        if (typeof loadedSettings[key] === 'undefined') {
          loadedSettings[key] = true;
        }
      });
    }
    this.settings = loadedSettings;
    this.saveSettings(); // 將更新後的設定存回，確保狀態同步

    this.modalShown = false;
    this.isAudioUnlocked = false; // Flag to ensure unlock is only attempted once
    this.lastPlayed = {}; // 記錄每個任務類型最後播放的時間，防止重複播放
    // 改為使用單一 Audio 物件並重複使用，解決手機版 Chrome 禁止自動播放新 Audio 物件的問題
    this.audioPlayer = new Audio();
    this.silentSource = "data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAAgAAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

    // 監聽全域互動事件，一旦使用者與頁面互動（點擊、按鍵、觸控），就嘗試解鎖音訊
    this.modalElement = null; // Reference to the unlock modal
    const unlockHandler = () => {
      this.unlockAudio();
      // 如果互動時解鎖彈窗還在，就將其移除
      if (this.modalElement && this.modalElement.parentNode) {
        this.modalElement.parentNode.removeChild(this.modalElement);
        this.modalElement = null;
      }
      ['click', 'keydown', 'touchstart'].forEach(e => document.removeEventListener(e, unlockHandler));
    };
    ['click', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, unlockHandler));
  }

  /**
   * 檢查指定任務類型的音效是否開啟
   * @param {string} taskTypeKey - 任務類型 Key
   * @returns {boolean}
   */
  isSoundEnabled(taskTypeKey) {
    // 預設為關閉
    return !!this.settings[taskTypeKey];
  }

  /**
   * 切換指定任務類型的音效開關
   * @param {string} taskTypeKey - 任務類型 Key
   * @returns {boolean} - 切換後的新狀態
   */
  toggleSound(taskTypeKey) {
    this.settings[taskTypeKey] = !this.isSoundEnabled(taskTypeKey);
    this.saveSettings();
    return this.settings[taskTypeKey];
  }

  /**
   * 儲存音效設定到 localStorage
   */
  saveSettings() {
    StorageHelper.set(SOUND_SETTINGS_KEY, this.settings);
  }

  /**
   * 嘗試解鎖瀏覽器的音訊播放限制。
   * 這應該在第一次使用者互動（例如點擊）時呼叫。
   * 現代瀏覽器要求使用者先與頁面互動，才能播放音訊。
   */
  unlockAudio() {
    if (this.isAudioUnlocked) {
      return;
    }
    // 建立一個 Web Audio Context 並嘗試恢復它。
    // 透過播放一段無聲的音訊來取得瀏覽器的播放權限，這是更可靠的方法。
    this.audioPlayer.src = this.silentSource;
    this.audioPlayer.volume = 0; // 靜音
    this.audioPlayer.play().then(() => {
      this.isAudioUnlocked = true;
      console.log('[音效] 音訊已由使用者互動解鎖。');
    }).catch(e => {
      // 在某些極端情況下，即使是互動後也可能解鎖失敗
      console.warn('[音效] 透過播放靜音音訊解鎖失敗。', e);
    });
  }

  /**
   * 顯示一個互動式彈窗，引導使用者點擊以解鎖音訊。
   * 這是為了應對瀏覽器對自動播放的限制。
   */
  showUnlockModal() {
    if (this.isAudioUnlocked || this.modalShown) {
      return;
    }
    this.modalShown = true;

    // 如果使用者手動關閉了所有音效，則不顯示彈窗
    const allSoundsDisabled = Object.values(this.settings).every(v => v === false);
    if (allSoundsDisabled) {
      return;
    }

    // 創建彈窗元素
    const overlay = document.createElement('div');
    this.modalElement = overlay; // 保存對彈窗的引用
    overlay.className = 'sound-unlock-overlay';

    const modal = document.createElement('div');
    modal.className = 'sound-unlock-modal';

    modal.innerHTML = `
      <h3>點擊畫面 啟用音效</h3>
      <p>
        為了確保音效正常運作<br>請點擊頁面任意處。
      </p>
      <div class="sound-unlock-hint">(這是瀏覽器的安全限制，需要您的互動來授權聲音播放)</div>
    `;

    // 點擊彈窗內的任何地方都會關閉它（因為全域的 unlockHandler 會觸發）
    // 這樣可以讓互動更自然
    modal.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止事件冒泡兩次
      // 手動觸發一次解鎖流程，然後移除元素
      this.unlockAudio();
      if (this.modalElement && this.modalElement.parentNode) {
        this.modalElement.parentNode.removeChild(this.modalElement);
        this.modalElement = null;
      }
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  /**
   * 播放任務提示音
   * @param {string} taskTypeKey - 任務類型 (gishiki, shirao, sengen)
   * @param {object} taskItem - 任務物件，包含時間和地點等資訊
   */
  playTaskSound(taskTypeKey, taskItem) {
    if (!this.isSoundEnabled(taskTypeKey)) {
      console.log(`[Sound] 音效設定為關閉，跳過播放 (${taskTypeKey})`);
      return;
    }

    const taskTime = taskItem.time;

    // 如果該時間點的任務已經播放過，則跳過
    if (this.lastPlayed[taskTypeKey] === taskTime) {
      // console.log(`[Sound] 此時間點已播放過，跳過 (${taskTime})`);
      return;
    }

    this.lastPlayed[taskTypeKey] = taskTime;
    console.log(`[音效] 正在播放 ${taskTypeKey} 的提示音，時間點 ${taskTime}`);

    let audioSrc = `./audio/${taskTypeKey}.mp3`; // 預設音效 (gishiki 會用這個)
    
    if (SOUND_MAP[taskTypeKey] && taskItem.content && SOUND_MAP[taskTypeKey][taskItem.content]) {
      audioSrc = SOUND_MAP[taskTypeKey][taskItem.content];
    }

    this.audioPlayer.src = audioSrc;
    this.audioPlayer.volume = 1; // 恢復音量
    const playPromise = this.audioPlayer.play();

    if (playPromise !== undefined) {
      playPromise.catch(error => {
        // 如果是 NotAllowedError (自動播放被阻擋)，則靜默處理或僅顯示 Log，避免控制台報錯干擾
        if (error.name === 'NotAllowedError') {
          console.log(`[Sound] 自動播放被阻擋 (${taskTypeKey})。等待使用者互動後即可播放。`);
        } else {
          console.warn(`[Sound] 播放失敗 (${taskTypeKey})。`, error);
        }
      });
    }
  }

  /**
   * 播放世界王提示音
   * @param {string} audioSrc - 音效檔案路徑
   * @param {string} playId - 用於防止重複播放的唯一ID (例如 '20:50')
   */
  playWorldBossSound(audioSrc, playId) {
    const taskTypeKey = 'world_boss';
    if (!this.isSoundEnabled(taskTypeKey)) {
      console.log(`[Sound] 世界王音效設定為關閉，跳過播放`);
      return;
    }

    // 如果該時間點的音效已經播放過，則跳過
    if (this.lastPlayed[taskTypeKey] === playId) {
      return;
    }

    this.lastPlayed[taskTypeKey] = playId;
    console.log(`[音效] 正在播放世界王提示音，ID ${playId}`);

    this.audioPlayer.src = audioSrc;
    this.audioPlayer.volume = 1; // 恢復音量
    const playPromise = this.audioPlayer.play();

    if (playPromise !== undefined) {
      playPromise.catch(error => {
        if (error.name === 'NotAllowedError') {
          console.log(`[Sound] 自動播放被阻擋 (world_boss)。等待使用者互動後即可播放。`);
        } else {
          console.warn(`[Sound] 播放失敗 (world_boss)。`, error);
        }
      });
    }
  }

  /**
   * 播放仙幻島野王 10秒前預告音效
   */
  playSengenPreAlert() {
    if (!this.isSoundEnabled('sengen')) return;

    const now = new Date();
    const timeTag = `${now.getHours()}:${now.getMinutes()}`;
    
    if (this.lastPlayed['sengen_pre'] === timeTag) return;
    this.lastPlayed['sengen_pre'] = timeTag;

    console.log('[音效] 正在播放仙幻島預告音效');
    this.audioPlayer.src = './audio/sengen10.mp3';
    this.audioPlayer.volume = 1;
    this.audioPlayer.play().catch(e => {
      console.warn('[音效] 預告音效播放失敗', e);
    });
  }

  /**
   * 播放特殊期間預報音效 (白青/仙幻島)
   * @param {string} taskTypeKey - shirao 或 sengen
   */
  playForecastSound(taskTypeKey) {
    if (!this.isSoundEnabled(taskTypeKey)) return;

    const now = new Date();
    const timeTag = `forecast_${taskTypeKey}_${now.getHours()}:${now.getMinutes()}`;
    
    if (this.lastPlayed[timeTag]) return;
    this.lastPlayed[timeTag] = true;

    console.log(`[音效] 正在播放 ${taskTypeKey} 的預報音效`);
    this.audioPlayer.src = `./audio/${taskTypeKey}Forecast.mp3`;
    this.audioPlayer.volume = 1;
    this.audioPlayer.play().catch(e => {
      console.warn(`[音效] ${taskTypeKey} 預報音效播放失敗`, e);
    });
  }
}