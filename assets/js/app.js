import Swup from 'swup';
import SwupHeadPlugin from '@swup/head-plugin';
import SwupScriptsPlugin from '@swup/scripts-plugin';
import { OverlayScrollbars } from 'overlayscrollbars';

const swup = new Swup({
    animateHistoryBrowsing: true,
    containers: ['#site-header', 'main'],
    plugins: [
        new SwupHeadPlugin(),
        new SwupScriptsPlugin({ head: false, body: true, optin: true })
    ]
});

// テーマ切り替え（visit開始時にdata-theme変更 → CSS transitionが走る）
swup.hooks.on('visit:start', (visit) => {
    const theme = visit.to.url === '/' ? 'dark' : 'light';
    console.log('[swup] visit:start →', visit.to.url, theme);
    document.documentElement.dataset.theme = theme;
});

// コンテンツ差し替え後、レイアウト完了を待ってからフェードイン開始
swup.hooks.before('animation:in:start', () => {
    return new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
});

// スクリプトcleanup（ページ離脱時にタイマー・リスナー除去）
swup.hooks.on('visit:start', () => {
    if (window.__pageCleanup) {
        window.__pageCleanup();
        window.__pageCleanup = null;
    }
});

// カスタムスクロールバー（コンテンツに被せるオーバーレイ）
OverlayScrollbars(document.body, {
    scrollbars: { autoHide: 'move', autoHideDelay: 800 }
});

// モバイルメニュー（イベントデリゲーションで差し替え後も動作）
function closeMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (!menu) return;
    menu.classList.remove('mobile-menu-open');
    menu.style.maxHeight = '0';
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#mobile-menu-button')) {
        const menu = document.getElementById('mobile-menu');
        if (!menu) return;
        const isOpen = menu.classList.toggle('mobile-menu-open');
        menu.style.maxHeight = isOpen ? menu.scrollHeight + 'px' : '0';
    } else if (e.target.closest('#mobile-menu a')) {
        closeMobileMenu();
    }
});

// お問い合わせフォーム（Turnstile は明示レンダリング。swup で差し替わるたびに描画し直す）
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let turnstileLoading = null;
let contactWidgetId = null;
let contactShownAt = 0;

function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileLoading) {
        turnstileLoading = new Promise((resolve, reject) => {
            // head は SwupHeadPlugin が差し替えるので body に足す
            const script = document.createElement('script');
            script.src = TURNSTILE_SRC;
            script.onload = () => resolve(window.turnstile);
            script.onerror = () => {
                turnstileLoading = null;
                reject(new Error('turnstile load failed'));
            };
            document.body.appendChild(script);
        });
    }
    return turnstileLoading;
}

function showContactError(message) {
    const box = document.getElementById('contact-error');
    if (!box) return;
    document.getElementById('contact-error-message').textContent = message;
    box.classList.remove('hidden');
}

function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;
    // 送信までの経過時間を測る（サーバーの時計とは比べない）
    contactShownAt = performance.now();
    const container = document.getElementById('contact-turnstile');
    loadTurnstile().then((turnstile) => {
        if (!container.isConnected) return;
        contactWidgetId = turnstile.render(container, {
            sitekey: container.dataset.sitekey,
            action: 'contact',
            language: 'ja',
            theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        });
    }).catch(() => {
        showContactError('スパム対策の読み込みに失敗しました。ページを再読み込みしてください。');
    });
}

initContactForm();
swup.hooks.on('page:view', initContactForm);
swup.hooks.on('visit:start', () => {
    if (contactWidgetId !== null && window.turnstile) {
        window.turnstile.remove(contactWidgetId);
    }
    contactWidgetId = null;
});

document.addEventListener('submit', async (e) => {
    const form = e.target.closest('#contact-form');
    if (!form) return;
    e.preventDefault();
    document.getElementById('contact-error').classList.add('hidden');
    if (!form.reportValidity()) return;

    form.elements.namedItem('elapsed').value = Math.round(performance.now() - contactShownAt);
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '送信中…';
    try {
        const res = await fetch(form.action, { method: 'POST', body: new FormData(form) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
            const done = document.getElementById('contact-done');
            form.classList.add('hidden');
            done.classList.remove('hidden');
            done.focus();
            return;
        }
        showContactError(data.message || '送信に失敗しました。時間をおいて再度お試しください。');
    } catch {
        showContactError('送信に失敗しました。通信環境をご確認ください。');
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
    if (contactWidgetId !== null && window.turnstile) {
        window.turnstile.reset(contactWidgetId);
    }
});
