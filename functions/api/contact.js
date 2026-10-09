// お問い合わせフォームの受け口（Cloudflare Pages Functions）
//
// ハニーポット・送信速度の確認 → Turnstile 検証 → 営業疑いの判定 → info@ へ通知メール。
// Pages Functions は send_email バインディングを持てないので、送信は Service binding
// 経由で workers/contact-mailer に任せる。
// 運用手順は docs/contact-form.md。
//
// env:
//   TURNSTILE_SECRET_KEY  Turnstile の secret（Pages の secret。コードに書かない）
//   MAILER                Service binding → technoplasm-contact-mailer
//   CONTACT_AE            Analytics Engine（任意。無ければ記録しない）

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MIN_ELAPSED_MS = 3000;
const LIMITS = { kind: 40, name: 100, org: 200, email: 254, message: 5000 };

// 営業疑いの判定。破棄はせず社内通知の本文 1 行目に印を付けるだけ（正当な連絡を落とさないため）。
// 強いシグナルは 2 点、弱いシグナルは 1 点。合計 2 点以上で営業疑い。
const STRONG_PATTERNS = [
    /calendly\.com|timerex\.net|jicoo\.com|spirinc\.com|eeasy\.jp|youcanbook\.me|meetings\.hubspot\.com/i,
    /突然のご連絡/,
    /(お問い?合わ?せ)?フォームより失礼/,
    /(ホームページ|HP|サイト)を拝見/i,
];
const WEAK_PATTERNS = [
    /ご提案/,
    /弊社(は|では)/,
    /web\s*(会議|商談|面談)|オンライン(会議|商談|面談)|zoom|google\s*meet/i,
    /日程(調整|をご予約)/,
    /取材|掲載/,
    /無料/,
    /コスト削減|[0-9０-９]+\s*[/／]\s*[0-9０-９]+\s*の(価格|費用|コスト)/,
];
// 公的機関・大学のドメインは営業疑いにしない
const TRUSTED_DOMAIN = /\.(go|lg|ac|ed)\.jp$/i;

// Gmail フィルタで拾う印（社内通知の本文 1 行目）。日本語より ASCII の方が検索が確実
const SALES_MARKER = '[sales-suspect]';

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function field(form, key) {
    const value = form.get(key);
    return typeof value === 'string' ? value.trim() : '';
}

// 受付番号。紛らわしい文字（0/O, 1/l/I）を除いた 6 文字
function shortId() {
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// ヘッダに入る値は改行を潰す
function oneLine(value) {
    return value.replace(/[\r\n]+/g, ' ');
}

function salesScore(text) {
    const reasons = [];
    let score = 0;
    for (const re of STRONG_PATTERNS) {
        const m = text.match(re);
        if (m) { score += 2; reasons.push(m[0]); }
    }
    for (const re of WEAK_PATTERNS) {
        const m = text.match(re);
        if (m) { score += 1; reasons.push(m[0]); }
    }
    return { score, reasons };
}

function record(env, result, extra = {}) {
    // 個人情報はログに出さない
    console.log(JSON.stringify({ event: 'contact', result, ...extra }));
    env.CONTACT_AE?.writeDataPoint({
        indexes: [result],
        blobs: [result, extra.kind ?? '', extra.suspected ? '1' : '0'],
        doubles: [1],
    });
}

function json(body, status = 200) {
    return Response.json(body, { status });
}

// bot には成功と見分けがつかない応答を返す
const silentOk = () => json({ ok: true });

async function verifyTurnstile(env, token, ip) {
    const body = new FormData();
    body.append('secret', env.TURNSTILE_SECRET_KEY);
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const data = await res.json();
    return data.success === true && (!data.action || data.action === 'contact');
}

export async function onRequestPost({ request, env }) {
    let form;
    try {
        form = await request.formData();
    } catch {
        record(env, 'invalid');
        return json({ ok: false, message: '送信内容を読み取れませんでした。' }, 400);
    }

    if (field(form, 'website')) {
        record(env, 'honeypot');
        return silentOk();
    }
    // 経過時間はクライアント側だけで測った値（時計ずれの影響を受けない）。
    // 値が無い・数値でないとき（古い JS のキャッシュなど）は捨てずに通す
    const elapsed = Number.parseInt(field(form, 'elapsed'), 10);
    if (Number.isFinite(elapsed) && elapsed < MIN_ELAPSED_MS) {
        record(env, 'too_fast');
        return silentOk();
    }

    const data = {
        kind: oneLine(field(form, 'kind')),
        name: oneLine(field(form, 'name')),
        org: oneLine(field(form, 'org')),
        email: oneLine(field(form, 'email')),
        message: field(form, 'message'),
    };
    const tooLong = Object.entries(LIMITS).some(([key, max]) => data[key].length > max);
    if (!data.kind || !data.name || !data.message || !EMAIL_RE.test(data.email) || tooLong) {
        record(env, 'invalid');
        return json({ ok: false, message: '未入力の項目があるか、入力内容に誤りがあります。' }, 400);
    }

    if (!env.TURNSTILE_SECRET_KEY || !env.MAILER) {
        record(env, 'config_error');
        return json({ ok: false, message: 'ただいまフォームを利用できません。' }, 500);
    }

    let human = false;
    try {
        human = await verifyTurnstile(env, field(form, 'cf-turnstile-response'), request.headers.get('CF-Connecting-IP'));
    } catch {
        human = false;
    }
    if (!human) {
        record(env, 'turnstile_failed', { kind: data.kind });
        return json({ ok: false, message: 'スパム対策の確認に失敗しました。もう一度お試しください。' }, 403);
    }

    const trusted = TRUSTED_DOMAIN.test(data.email.split('@')[1] ?? '');
    const { score, reasons } = salesScore(`${data.org}\n${data.message}`);
    const suspected = !trusted && score >= 2;

    // 営業疑いの印は本文 1 行目に置く（Gmail フィルタで振り分ける）
    const ticket = shortId();
    const subject = `【お問い合わせ受付】${data.kind} #${ticket}`;
    const receivedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const text = [
        suspected ? `判定: 営業疑い ${SALES_MARKER}` : '判定: 通常',
        `（score=${score}${reasons.length ? ` / ${reasons.join(', ')}` : ''}${trusted ? ' / 公的機関・大学ドメイン' : ''}）`,
        '',
        `受付番号: #${ticket}`,
        `受付日時: ${receivedAt}`,
        `種別: ${data.kind}`,
        `お名前: ${data.name}`,
        `ご所属: ${data.org || '（未記入）'}`,
        `メール: ${data.email}`,
        `送信元の国: ${request.cf?.country ?? '不明'}`,
        '',
        '---- お問い合わせ内容 ----',
        data.message,
        '',
        '※ このメールに返信すると問い合わせ者に届きます（Reply-To）。',
    ].join('\n');

    let sent = false;
    try {
        const res = await env.MAILER.fetch('https://contact-mailer/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, text, replyTo: data.email }),
        });
        sent = res.ok;
        if (!sent) console.log(JSON.stringify({ event: 'contact', mailer_status: res.status, mailer_body: await res.text() }));
    } catch (err) {
        console.log(JSON.stringify({ event: 'contact', mailer_error: String(err) }));
    }
    const extra = { kind: data.kind, suspected, ticket };
    if (!sent) {
        record(env, 'send_failed', extra);
        return json({ ok: false, message: '送信処理でエラーが発生しました。' }, 502);
    }

    record(env, 'accepted', extra);
    return json({ ok: true });
}
