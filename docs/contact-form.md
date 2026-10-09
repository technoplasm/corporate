# お問い合わせフォーム（Turnstile + Pages Functions + Email Sending）

Google フォームの iframe 埋め込みをやめ、自前フォームに置き換えた（営業スパム対策）。

## 構成

```
/contact/ (Hugo)  ──POST /api/contact──▶  functions/api/contact.js (Pages Functions)
                                            ├ ハニーポット / 表示から 3 秒未満の送信 → 黙って破棄（bot には成功を返す）
                                            ├ Turnstile siteverify（TURNSTILE_SECRET_KEY）
                                            ├ 営業疑い判定 → 社内通知の本文 1 行目に印（破棄はしない）
                                            ├ 件数を Analytics Engine（technoplasm_contact）とログに記録
                                            └ Service binding MAILER ──▶ workers/contact-mailer (Worker)
                                                                           └ Email Sending → info@technoplasm.jp
                                                                             （送信元・宛先はバインディングで contact-form@ → info@ に固定）
```

- Pages Functions は `send_email` バインディングを持てない（対応バインディング一覧に無い）ので、
  送信だけを別 Worker `technoplasm-contact-mailer` に分けている。この Worker は公開 URL を持たない。
- 送信は Cloudflare Email Sending（Workers Paid）。送信元・宛先は mailer の `[vars]` の `MAIL_FROM`
  （`contact-form@technoplasm.jp`）/ `MAIL_TO`（`info@technoplasm.jp`）。`[[send_email]]` バインディングの
  `allowed_sender_addresses` / `allowed_destination_addresses` でも同じ 2 つに固定しているので、
  Pages 側から任意のアドレスへは送れない（フォームを踏み台にした第三者への送りつけができない）。
- キーワードでの自動破棄はしない。正当な連絡（公的機関など）を落とさないため。
  `.go.jp` `.lg.jp` `.ac.jp` `.ed.jp` から来たものは営業疑いにしない。
- 「3 秒未満」は、ブラウザ側で測った経過時間（hidden の `elapsed`。フォーム表示からの
  `performance.now()` の差）で判定する。送信時刻を送ってサーバーの時計と比べる方式だと、利用者の PC の
  時計が進んでいるだけで本物の問い合わせが黙って消えるため。`elapsed` が無い・数値でない場合は捨てずに通す
  （判定できないときは落とさない側に倒す）。
- 同意チェックボックスは置かない。送信ボタンの前に「送信いただいた内容はプライバシーポリシーに従って
  取り扱います」と表示し、利用目的は `content/privacy.md` で公表している（問い合わせへの回答目的の利用に
  本人同意は要らない。公表・通知で足りる）。

### 社内通知メール

- 件名: `【お問い合わせ受付】<種別> #<受付番号>`（受付番号は 6 文字）
- From `contact-form@technoplasm.jp` / To `info@technoplasm.jp` / Reply-To 問い合わせ者
- 本文 1 行目: `判定: 通常` または `判定: 営業疑い [sales-suspect]`

件名に営業疑いを入れないのは、相手に返信したとき件名に社内の判定が残らないようにするため。

## データの流れと保管場所

```
ブラウザ（/contact/）
  │ ① Turnstile ウィジェット: IP・ブラウザ情報を Cloudflare に送って bot 判定 → トークン
  │ ② POST /api/contact（入力内容 + トークン + elapsed + ハニーポット）
  ▼
Pages Functions（functions/api/contact.js）   … 保存しない
  │ ③ siteverify: トークンと送信者 IP を Cloudflare に照会
  │ ④ ログ・Analytics Engine に「結果・種別・営業疑い・受付番号」だけ記録（氏名・メール・本文は出さない）
  │ ⑤ Service binding で入力内容を渡す
  ▼
送信用 Worker（workers/contact-mailer）        … 保存しない
  │ ⑥ Cloudflare Email Sending で info@technoplasm.jp 宛てに送信
  ▼
info@technoplasm.jp（Cloudflare Email Routing） … 転送のみ
  │ ⑦ 転送
  ▼
Gmail（info@ の転送先）                        … ここにだけ問い合わせ内容が残る
```

問い合わせ者側にはメールを送らない。

| どこ | 何が残るか | どれくらい残るか | 消し方 |
|---|---|---|---|
| Gmail | 社内通知メール（入力内容すべて・送信元の国・受付番号） | 削除するまで | Gmail で検索して削除（下記「開示・削除の請求」） |
| Pages Functions のログ | 結果・種別・営業疑い・受付番号（個人情報なし） | 保存設定をしていなければ `wrangler pages deployment tail` で流れる間だけ | 不要 |
| Analytics Engine `technoplasm_contact` | 結果・種別・営業疑いの件数（個人情報なし） | 約 3 か月 | 不要（自動で消える） |
| Cloudflare Turnstile / Email Sending | 判定・送信の処理記録（Cloudflare 側。内容は Cloudflare のポリシーによる） | Cloudflare の定めによる | 当社からは操作しない |
| 旧 Google フォーム | 導入前の回答 | 削除するまで | 件数比較が済んだら回答とフォームを削除する |

この取り扱いは `content/privacy.md`（プライバシーポリシー）と対応している。流れを変えたら（問い合わせ者にメールを送る、
保存先を増やす、外部サービスを足す等）ポリシーの「取得する情報」「外部サービスの利用」「安全管理措置」も直す。

## 初回セットアップ（ken）

順番が大事: **mailer Worker を先にデプロイ → Pages の secret → site key を入れて push**。

1. **Email Sending の DNS を確認**
   technoplasm.jp には Email Sending 用のレコード（`cf-bounce` の MX / SPF、`cf-bounce._domainkey` の DKIM、
   `_dmarc` の `p=none`）が既に入っている（2026-10-08 に dig で確認）。ダッシュボードの Email → Email Sending で
   technoplasm.jp が有効（Verified）になっていることだけ確かめる。CLI なら:
   ```sh
   pnpm wrangler email sending list
   pnpm wrangler email sending dns get technoplasm.jp
   ```
   （wrangler 4.45 に無ければ `pnpm dlx wrangler@latest ...`）
2. **Turnstile ウィジェットを作る**
   Cloudflare ダッシュボード → Turnstile → Add widget
   - Hostnames: `technoplasm.jp`（`www.technoplasm.jp` を使うなら追加。プレビューで試すなら `technoplasm-corporate.pages.dev`）
   - Widget mode: Managed
   - Site key と Secret key をメモしておく
3. **mailer Worker をデプロイ**
   ```sh
   pnpm wrangler deploy -c workers/contact-mailer/wrangler.toml
   ```
4. **Pages に Turnstile の secret を登録**
   ```sh
   pnpm wrangler pages secret put TURNSTILE_SECRET_KEY --project-name technoplasm-corporate
   ```
5. **site key を入れてデプロイ**
   `hugo.toml` の `turnstile_site_key` に Site key を書いて master に push する（GitHub Actions がデプロイする）。
   - ルートの `wrangler.toml` がある間は、Pages のバインディングと変数は**ダッシュボードではなくこのファイルが正**になる。
     初回の push 前に、ダッシュボードの Settings → Variables and Secrets / Bindings を確認しておく。
     ダッシュボードに独自の変数があれば `wrangler.toml` に移す（secret は影響を受けない）。

## Gmail の設定

- **返信元アドレス**: 設定 → アカウント →「返信時:」で **「メールを受信したアドレスから返信する」** を選ぶ（推奨）。
  社内通知は To info@ なので、返信は自動で info@ から出る（info@ の send-as は設定済み）。
  毎回 From を手で切り替えずに済み、個人アドレスで返信してしまう事故を防げる。
- **営業疑いの振り分け**: 検索条件（含む語句）`"sales-suspect"` → 受信トレイをスキップ、ラベル「問い合わせ/営業疑い」。
  誤判定に備えて、このラベルは週に一度ざっと目を通す。

## 問い合わせ対応の手順

1. **受信**: Gmail に `【お問い合わせ受付】<種別> #<受付番号>` が届く。本文 1 行目が判定（`判定: 通常` /
   `判定: 営業疑い [sales-suspect]`）。営業疑いはフィルタでラベル「問い合わせ/営業疑い」に入り、受信トレイには出ない。
2. **判断**: 種別・ご所属・メールのドメイン・本文を見て、対応が要るかを決める。
   - 公的機関（`go.jp` `lg.jp`）・大学（`ac.jp`）・取引先は最優先。営業疑いの判定からは外れている。
   - 判定は目安。報道機関からの正当な取材依頼も `[sales-suspect]` になることがある。
3. **返信**: Gmail で社内通知に「返信」する。Reply-To が問い合わせ者なので宛先は自動で入る。
   差出人は「返信時: メールを受信したアドレスから返信する」設定で自動的に info@ になる（下記「Gmail の設定」）。
   担当者として名乗るなら差出人を enda@ に切り替えてよい。**個人の Gmail アドレスでは返信しない。**
   件名の受付番号は残したまま返信する（後で検索できるように）。
4. **営業・勧誘には返信しない。** 本文中の日程予約 URL（Calendly・TimeRex など）や資料ダウンロードのリンクは踏まない。
   「取材させてほしい」で後から掲載料を求める取材商法もここに含める。返信しないことで、送信元リストから「生きている窓口」と
   扱われるのを避ける。
5. **週に一度**、ラベル「問い合わせ/営業疑い」をざっと見て、正当な連絡が紛れていないか確認する。紛れていたら返信し、
   誤判定の原因になった語を `functions/api/contact.js` の `STRONG_PATTERNS` / `WEAK_PATTERNS` から外すか点数を見直す。

### 開示・削除の請求が来たとき

プライバシーポリシーの「開示などのご請求」の窓口は info@。

1. **本人確認**: 請求メールの差出人アドレスが、問い合わせ時のメールアドレスと一致するかを見る。一致しなければ、
   問い合わせ時のアドレスから改めて連絡してもらう（それ以上の書類は通常求めない）。
2. **該当メールを探す**: Gmail で次のどちらかで検索する（ゴミ箱・ラベル付きも対象になるよう「すべてのメール」で）。
   - `subject:"【お問い合わせ受付】" "<メールアドレス>"`
   - `"#<受付番号>"`
   こちらからの返信（送信済み）も同じスレッドにあるので一緒に確認する。
3. **対応**:
   - 開示: 保管している内容（社内通知の本文の入力欄）をメールで返す。
   - 削除・利用停止: 該当スレッドを削除し、ゴミ箱からも削除する。旧 Google フォームの回答に同じ人がいれば、
     回答タブからその回答も削除する。
   - Pages のログと Analytics Engine には個人情報が無いので対応不要。
4. **回答**: 対応した旨を info@ から本人に返信する。法令上「遅滞なく」なので、目安として 2 週間以内に終える。

## デプロイ後の確認

1. `/contact/` を開き、Turnstile が表示されることを確認する。普通の問い合わせを 1 通送り、info@ 経由で Gmail に届くか、
   Reply-To が入力したアドレスになっているかを見る。
2. 本文に「突然のご連絡失礼いたします。弊社は…Web会議を」と書いて送り、本文 1 行目が `判定: 営業疑い [sales-suspect]` になり、
   Gmail フィルタでラベルに振り分けられることを確認する。
3. ログを見る:
   ```sh
   pnpm wrangler pages deployment tail --project-name technoplasm-corporate
   ```
   `{"event":"contact","result":"accepted","kind":"...","suspected":false,"ticket":"..."}` が出る。
   `send_failed` のときは、その直前に `{"event":"contact","mailer_status":...,"mailer_body":...}`（mailer が
   エラーを返した）か `{"event":"contact","mailer_error":...}`（mailer を呼べなかった）が出る。`mailer_body` に
   Email Sending のエラーコード（`E_SENDER_NOT_VERIFIED` など）が入る。
4. **Google フォームを閉じる**: Google フォーム → 回答タブ →「回答を受け付ける」を OFF にする。
   回答を受け付けないときのメッセージは「お問い合わせは https://technoplasm.jp/contact/ または info@technoplasm.jp へ」とする。
   フォームの URL は公開済みなので、閉じないと自動送信ツールは今後もこちらに投稿し続ける。回答データは件数比較のために消さない。

## 件数の比較（導入前後）

| 指標 | 導入前 | 導入後 |
|---|---|---|
| 届いた件数 | Google フォームの回答タブ（スプレッドシートに出力して月別に集計） | Gmail で `subject:"【お問い合わせ受付】" after:YYYY/MM/DD` |
| うち営業 | 回答を目で仕分ける | Gmail で `subject:"【お問い合わせ受付】" "sales-suspect" after:YYYY/MM/DD`（判定は目安） |
| 弾いた件数 | なし | Analytics Engine（下記） |

Analytics Engine（日別・結果別）。`blob1` = result（accepted / honeypot / too_fast / turnstile_failed / invalid /
send_failed / config_error）、`blob2` = 種別、`blob3` = 営業疑い（1/0）:

```sh
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_ANALYTICS_TOKEN" \
  --data "SELECT toStartOfDay(timestamp) AS day, blob1 AS result, blob3 AS suspected, SUM(_sample_interval) AS n
          FROM technoplasm_contact
          WHERE timestamp > NOW() - INTERVAL '30' DAY
          GROUP BY day, result, suspected ORDER BY day"
```

`CF_ANALYTICS_TOKEN` には「Account Analytics: Read」権限の API トークンを使う。Analytics Engine は 3 か月でデータが消えるので、長期の比較には Gmail の件数を使う。

## 調整する場所

- 営業疑いのキーワードと点数: `functions/api/contact.js` の `STRONG_PATTERNS` / `WEAK_PATTERNS`
- 問い合わせ種別: `hugo.toml` の `contact_kinds`
- 送信元・宛先: `workers/contact-mailer/wrangler.toml` の `[vars]` の `MAIL_FROM` / `MAIL_TO`。変えたら同じファイルの
  `[[send_email]]` の `allowed_sender_addresses` / `allowed_destination_addresses` も直す（直さないと送信が拒否される）
