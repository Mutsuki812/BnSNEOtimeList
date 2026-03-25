import { DOMHelper, StorageHelper, SupabaseHelper } from './utils.js';

export class UserManager {
  constructor() {
    this.storageKey = 'bnsneo_user';
    this.currentUser = StorageHelper.get(this.storageKey, null);
    this.modal = null;
    this.userInfoEl = document.querySelector('.userInfo');
    this.renderUserInfo();
  }

  getCurrentUser() {
    return this.currentUser;
  }

  async requireUser() {
    if (this.currentUser) return this.currentUser;
    
    return new Promise((resolve) => {
      this.showLoginModal((user) => {
        this.currentUser = user;
        StorageHelper.set(this.storageKey, user);
        this.renderUserInfo();
        resolve(user);
      }, () => {
        resolve(null); // User cancelled
      });
    });
  }

  renderUserInfo() {
    if (!this.userInfoEl) return;
    
    if (this.currentUser) {
      this.userInfoEl.innerHTML = `
        <div class="user-info-content">
          <img src="./images/userC32.png" class="user-info-icon" alt="user">
          <span class="user-name-label">${this.currentUser.userName}</span>
          <span class="rename-btn" title="修改名稱">✎</span>
          <span class="logout-separator">|</span>
          <span class="logout-btn">登出</span>
        </div>
      `;
      this.userInfoEl.querySelector('.rename-btn').onclick = () => this.showRenameModal();
      this.userInfoEl.querySelector('.logout-btn').onclick = () => this.logout();
    } else {
      this.userInfoEl.innerHTML = `
        <div class="user-info-content unlogged">
          <img src="./images/user32.png" class="user-info-icon" alt="guest">
          <span class="login-btn">點擊登入</span>
        </div>
      `;
      this.userInfoEl.querySelector('.user-info-content.unlogged').onclick = () => this.requireUser();
    }
  }

  logout() {
    this.showConfirmModal("確定要登出嗎？", () => {
      this.currentUser = null;
      StorageHelper.remove(this.storageKey);
      this.renderUserInfo();
      window.location.reload();
    });
  }

  showLoginModal(onSuccess, onCancel) {
    if (this.modal) return;

    const overlay = DOMHelper.createElement('div', 'modal-overlay');

    const box = DOMHelper.createElement('div', 'modal-box');

    box.innerHTML = `
      <h3>請輸入暱稱</h3>
      <p>用於管理您的回報紀錄</p>
      <input type="text" id="loginNameInput" class="modal-input" placeholder="輸入名稱...">
      <div id="loginMsg" class="modal-msg"></div>
      <div class="modal-btn-group">
        <button id="loginCancelBtn" class="btn-cancel">取消</button>
        <button id="loginConfirmBtn" class="btn-confirm">確定</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const input = box.querySelector('#loginNameInput');
    const msg = box.querySelector('#loginMsg');
    const cancelBtn = box.querySelector('#loginCancelBtn');
    const confirmBtn = box.querySelector('#loginConfirmBtn');

    input.focus();

    const close = () => { 
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay); 
      }
      this.modal = null; 
    };

    cancelBtn.onclick = () => { close(); onCancel(); };

    const submit = async () => {
      const name = input.value.trim();
      if (!name) { msg.textContent = "請輸入名稱"; return; }
      
      msg.textContent = "登入中...";
      confirmBtn.disabled = true;
      input.disabled = true;

      try {
        const supabase = await SupabaseHelper.getClient();
        const { data: users } = await supabase.from('Users').select('id, userName, role').eq('userName', name);
        
        let user = (users && users.length > 0) ? users[0] : null;
        if (!user) {
          const { data: newUsers, error } = await supabase.from('Users').insert([{ userName: name }]).select('id, userName, role');
          if (error) throw error;
          user = newUsers[0];
        }
        close(); onSuccess(user);
      } catch (e) { console.error(e); msg.textContent = "發生錯誤，請重試"; confirmBtn.disabled = false; input.disabled = false; }
    };
    confirmBtn.onclick = submit;
    input.onkeydown = (e) => { if(e.key === 'Enter') submit(); };
  }

  showRenameModal() {
    if (this.modal) return;

    const overlay = DOMHelper.createElement('div', 'modal-overlay');

    const box = DOMHelper.createElement('div', 'modal-box');

    box.innerHTML = `
      <h3>修改名稱</h3>
      <input type="text" id="renameInput" class="modal-input" value="${this.currentUser.userName}">
      <div id="renameMsg" class="modal-msg"></div>
      <div class="modal-btn-group">
        <button id="renameCancelBtn" class="btn-cancel">取消</button>
        <button id="renameConfirmBtn" class="btn-confirm">確定</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const input = box.querySelector('#renameInput');
    const msg = box.querySelector('#renameMsg');
    const cancelBtn = box.querySelector('#renameCancelBtn');
    const confirmBtn = box.querySelector('#renameConfirmBtn');

    input.focus();
    input.select();

    const close = () => { 
      if (document.body.contains(overlay)) document.body.removeChild(overlay); 
      this.modal = null; 
    };

    cancelBtn.onclick = () => close();

    const submit = async () => {
      const newName = input.value.trim();
      if (!newName) { msg.textContent = "名稱不能為空"; return; }
      if (newName === this.currentUser.userName) { close(); return; }
      
      msg.textContent = "更新中...";
      confirmBtn.disabled = true;
      input.disabled = true;

      try {
        const supabase = await SupabaseHelper.getClient();
        // 檢查名稱是否重複
        const { data: existing } = await supabase.from('Users').select('id').eq('userName', newName);
        if (existing && existing.length > 0) {
          msg.textContent = "該名稱已被使用";
          confirmBtn.disabled = false;
          input.disabled = false;
          return;
        }

        const { error } = await supabase.from('Users').update({ userName: newName }).eq('id', this.currentUser.id);
        if (error) throw error;

        this.currentUser.userName = newName;
        StorageHelper.set(this.storageKey, this.currentUser);
        this.renderUserInfo();
        close();
      } catch (e) { 
        console.error(e); 
        msg.textContent = "發生錯誤，請重試"; 
        confirmBtn.disabled = false; 
        input.disabled = false; 
      }
    };
    confirmBtn.onclick = submit;
    input.onkeydown = (e) => { if(e.key === 'Enter') submit(); };
  }

  showConfirmModal(message, onConfirm, isDanger = false) {
    if (this.modal) return;

    const overlay = DOMHelper.createElement('div', 'modal-overlay');

    const box = DOMHelper.createElement('div', 'modal-box');

    const btnText = isDanger ? '刪除' : '確定';
    const confirmBtnClass = isDanger ? 'btn-confirm danger' : 'btn-confirm';

    box.innerHTML = `
      <h3>確認</h3>
      <p class="modal-text">${message}</p>
      <div class="modal-btn-group">
        <button id="confirmCancelBtn" class="btn-cancel">取消</button>
        <button id="confirmOkBtn" class="${confirmBtnClass}">${btnText}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); this.modal = null; };

    box.querySelector('#confirmCancelBtn').onclick = close;
    box.querySelector('#confirmOkBtn').onclick = () => { close(); onConfirm(); };
  }
}