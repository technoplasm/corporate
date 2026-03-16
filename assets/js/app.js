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
