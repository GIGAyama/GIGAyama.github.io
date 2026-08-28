/* eslint-disable */
/**
 * =====================================================================
 * giga-sw-updater.js — GIGAスクール向け PWA更新通知トースト（正本）
 * =====================================================================
 *
 * 児童・教員が「アプリの新しいバージョン」にすぐ気づき、1タップで
 * 安全にキャッシュを更新して最新版へ切り替えるための軽量コンポーネント。
 *
 * ── 特徴 ─────────────────────────────────────────────────────────────
 * 1. 外部依存ゼロ・自己完結 (Zero Dependency)
 *    外部CSSやフォントを一切読まず、Shadow DOM で親のスタイルと完全分離。
 *
 * 2. 児童目線UI/UX (Child-Centric)
 *    ・学年配当漢字へのルビ（「新しい」「更新する」）
 *    ・押し間違いを防ぐ 48px 以上の大ボタン
 *    ・Chromebook / iPad に最適化された下部フローティング配置
 *
 * 3. Service Worker 連携 (Robust SW Lifecycle)
 *    ・既存の waiting ワーカーおよび新規 updatefound を自動検知
 *    ・ボタン押下で SKIP_WAITING を送信し controllerchange で安全リロード
 *
 * ── 使い方（アプリの HTML の end body 直前に 1 行）────────────────────
 *   <script src="./giga-sw-updater.js" defer></script>
 * =====================================================================
 */

(function () {
  'use strict';

  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // 二重登録防止
  if (window.__GIGA_SW_UPDATER_LOADED__) return;
  window.__GIGA_SW_UPDATER_LOADED__ = true;

  const TOAST_TAG = 'giga-sw-updater';

  class GigaSwUpdater extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._waitingWorker = null;
    }

    connectedCallback() {
      this.render();
    }

    setWaitingWorker(worker) {
      this._waitingWorker = worker;
      this.show();
    }

    show() {
      const container = this.shadowRoot.querySelector('.giga-toast-container');
      if (container) {
        container.classList.add('visible');
      }
    }

    hide() {
      const container = this.shadowRoot.querySelector('.giga-toast-container');
      if (container) {
        container.classList.remove('visible');
      }
    }

    applyUpdate() {
      if (this._waitingWorker) {
        // Service Worker に待機解除を指示
        this._waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    }

    render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", sans-serif;
            pointer-events: none;
          }

          .giga-toast-container {
            display: flex;
            align-items: center;
            gap: 16px;
            background: rgba(15, 23, 42, 0.94);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: #ffffff;
            padding: 12px 20px;
            border-radius: 9999px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.15);
            opacity: 0;
            transform: translateY(30px) scale(0.95);
            transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
            max-width: calc(100vw - 32px);
            box-sizing: border-box;
          }

          .giga-toast-container.visible {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: auto;
          }

          .giga-message {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 15px;
            font-weight: 600;
            line-height: 1.4;
            white-space: nowrap;
          }

          .giga-icon {
            font-size: 20px;
            display: inline-flex;
            animation: giga-sparkle 2s infinite ease-in-out;
          }

          ruby {
            ruby-position: over;
          }

          rt {
            font-size: 0.65em;
            font-weight: 500;
            color: #93c5fd;
            letter-spacing: 0;
          }

          .giga-btn-group {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .giga-btn-update {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #2563eb, #1d4ed8);
            color: #ffffff;
            border: none;
            border-radius: 9999px;
            padding: 8px 20px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            min-height: 48px;
            min-width: 110px;
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
            transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
            touch-action: manipulation;
            user-select: none;
            -webkit-user-select: none;
          }

          .giga-btn-update:hover {
            background: linear-gradient(135deg, #1d4ed8, #1e40af);
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(37, 99, 235, 0.5);
          }

          .giga-btn-update:active {
            transform: translateY(1px);
            box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
          }

          .giga-btn-close {
            background: transparent;
            color: #94a3b8;
            border: none;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            cursor: pointer;
            transition: color 0.15s, background 0.15s;
          }

          .giga-btn-close:hover {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.1);
          }

          @keyframes giga-sparkle {
            0%, 100% { transform: scale(1) rotate(0deg); }
            50% { transform: scale(1.15) rotate(10deg); }
          }

          @media (max-width: 480px) {
            .giga-toast-container {
              flex-direction: column;
              border-radius: 20px;
              padding: 14px 18px;
              gap: 12px;
              width: calc(100vw - 32px);
            }
            .giga-btn-update {
              width: 100%;
            }
          }
        </style>
        <div class="giga-toast-container" role="alert" aria-live="assertive">
          <div class="giga-message">
            <span class="giga-icon" aria-hidden="true">✨</span>
            <span><ruby>新<rt>あたら</rt></ruby>しいバージョンがあります</span>
          </div>
          <div class="giga-btn-group">
            <button class="giga-btn-update" id="giga-update-btn">
              <ruby>更新<rt>こうしん</rt></ruby>する
            </button>
            <button class="giga-btn-close" id="giga-close-btn" aria-label="閉じる">×</button>
          </div>
        </div>
      `;

      const updateBtn = this.shadowRoot.querySelector('#giga-update-btn');
      if (updateBtn) {
        updateBtn.addEventListener('click', () => {
          updateBtn.disabled = true;
          updateBtn.innerHTML = 'こうしん中…';
          this.applyUpdate();
        });
      }

      const closeBtn = this.shadowRoot.querySelector('#giga-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.hide();
        });
      }
    }
  }

  // カスタム要素の定義
  if (!customElements.get(TOAST_TAG)) {
    customElements.define(TOAST_TAG, GigaSwUpdater);
  }

  // UI インスタンスの確保
  function getOrCreateToast() {
    let toast = document.querySelector(TOAST_TAG);
    if (!toast) {
      toast = document.createElement(TOAST_TAG);
      document.body.appendChild(toast);
    }
    return toast;
  }

  // Service Worker 監視の初期化
  function initSwWatcher() {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    navigator.serviceWorker.ready.then((reg) => {
      // 1. 既に待機中のワーカーがある場合
      if (reg.waiting) {
        getOrCreateToast().setWaitingWorker(reg.waiting);
        return;
      }

      // 2. インストール中のワーカーがある場合
      if (reg.installing) {
        listenInstalling(reg.installing);
        return;
      }

      // 3. 将来の更新を監視
      reg.addEventListener('updatefound', () => {
        if (reg.installing) {
          listenInstalling(reg.installing);
        }
      });
    });

    function listenInstalling(worker) {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          getOrCreateToast().setWaitingWorker(worker);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSwWatcher);
  } else {
    initSwWatcher();
  }

  // グローバル公開（テストおよび外部呼び出し用）
  window.GigaSwUpdater = {
    showTest: function () {
      getOrCreateToast().show();
    },
    hideTest: function () {
      getOrCreateToast().hide();
    }
  };
})();
