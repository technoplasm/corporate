// お問い合わせの通知メールを info@ に 1 通送る（Cloudflare Email Sending）。
// Reply-To は問い合わせ者なので、通知にそのまま返信すれば相手に届く。

const SAFE_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

const errorText = (err) => `${err?.code ?? ''} ${err?.message ?? err}`.trim();

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
        const { subject, text, replyTo } = await request.json();
        if (typeof subject !== 'string' || typeof text !== 'string' || !SAFE_ADDRESS.test(replyTo ?? '')) {
            return new Response('bad request', { status: 400 });
        }
        const message = {
            to: env.MAIL_TO,
            from: { email: env.MAIL_FROM, name: 'テクノプラズム お問い合わせフォーム' },
            replyTo,
            subject: subject.replace(/[\r\n]+/g, ' '),
            text,
        };
        // 一時的な失敗に備えて 1 回だけ再送する
        let lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await env.EMAIL.send(message);
                return new Response('ok');
            } catch (err) {
                lastError = errorText(err);
            }
        }
        return new Response(lastError, { status: 502 });
    },
};
