import Swup from 'swup';
import SwupHeadPlugin from '@swup/head-plugin';
import SwupScriptsPlugin from '@swup/scripts-plugin';

const swup = new Swup({
    containers: ['#site-header', 'main'],
    plugins: [
        new SwupHeadPlugin(),
        new SwupScriptsPlugin({ head: false, body: true, optin: true })
    ]
});

// テーマ切り替え（フェードアウト開始時にdata-theme変更 → CSS transitionが走る）
swup.hooks.on('animation:out:start', (visit) => {
    document.body.dataset.theme = visit.to.url === '/' ? 'dark' : 'light';
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

// モバイルメニュー（イベントデリゲーションで差し替え後も動作）
document.addEventListener('click', (e) => {
    if (e.target.closest('#mobile-menu-button')) {
        const menu = document.getElementById('mobile-menu');
        if (menu) menu.classList.toggle('hidden');
    }
});
