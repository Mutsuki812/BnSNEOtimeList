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
    this.settings = StorageHelper.get(SOUND_SETTINGS_KEY, {});
    this.isAudioUnlocked = false; // Flag to ensure unlock is only attempted once
    this.lastPlayed = {}; // 記錄每個任務類型最後播放的時間，防止重複播放
    // 用於解鎖瀏覽器自動播放限制的無聲 Audio 元素
    this.silentAudio = new Audio("data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAAgAAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV");
    this.silentAudio.volume = 0;

    // 監聽全域互動事件，一旦使用者與頁面互動（點擊、按鍵、觸控），就嘗試解鎖音訊
    const unlockHandler = () => {
      this.unlockAudio();
      ['click', 'keydown', 'touchstart'].forEach(e => document.removeEventListener(e, unlockHandler));
    };
    ['click', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, unlockHandler));
  }

  isSoundEnabled(taskTypeKey) {
    // 預設為關閉
    return !!this.settings[taskTypeKey];
  }

  toggleSound(taskTypeKey) {
    this.settings[taskTypeKey] = !this.isSoundEnabled(taskTypeKey);
    this.saveSettings();
    return this.settings[taskTypeKey];
  }

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
    this.silentAudio.play().then(() => {
      this.isAudioUnlocked = true;
      console.log('[Sound] Audio context unlocked by user interaction.');
    }).catch(e => {
      // 在某些極端情況下，即使是互動後也可能解鎖失敗
      console.warn('[Sound] Silent audio play failed to unlock.', e);
    });
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
    console.log(`[Sound] Playing alert for ${taskTypeKey} at ${taskTime}`);

    let audioSrc = `./audio/${taskTypeKey}.mp3`; // 預設音效 (gishiki 會用這個)
    
    if (SOUND_MAP[taskTypeKey] && taskItem.zh && SOUND_MAP[taskTypeKey][taskItem.zh]) {
      audioSrc = SOUND_MAP[taskTypeKey][taskItem.zh];
    }

    const audio = new Audio(audioSrc);
    const playPromise = audio.play();

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
}