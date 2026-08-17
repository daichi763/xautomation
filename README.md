# AI Virtual Office — Mさん / 海外AI副業の検証部屋

## プロジェクト概要
- **名称**: AI Virtual Office(Mさん / 海外AI副業の検証部屋 運用ダッシュボード)
- **目的**: 9人のAIワーカーが海外一次情報の収集→翻訳→執筆→QA→投稿を自走し、取締役(あなた)は**3つの承認ゲートのみ**を操作する擬似オフィスの管理画面
- **主な機能**:
  - 🏢 **オフィスビュー**: 取締役デスク+9ワーカーの稼働状態をリアルタイム表示(15秒毎に自動更新/デモ用「時間を進める」ボタンあり)
  - ✅ **承認3ゲート**: ①週次企画の選定 ②日次X投稿12本の一括/個別承認・差戻(理由付き) ③有料note全文プレビュー→公開
  - 📊 **KPIダッシュボード**: フォロワー・売上の2軸グラフ(Chart.js)+日次明細テーブル
  - 🛡️ **QAチェッカー(Mio)**: 禁止表現・法令リスク(薬機法/景表法/金商法/ステマ規制)を実際に検出する実動ロジック
  - 🔗 **アフィリンク自動埋め込み**: 提携済みリンクを1回登録すれば、投稿文からツール名を自動検出してリンク+PR表記を自動挿入(承認画面のワンボタン/埋め込み後に自動再QA)
  - 📖 **用語注釈辞書**: 固有名詞(KDP・Etsy等)の素人向け注釈を辞書管理。Yutoの執筆ルールに組み込み

## URL
- **本番**: https://0c9c4d00-0596-4d2b-8bc9-5a2b11a4709d.vip.gensparksite.com
- **GitHub**: https://github.com/daichi763/xautomation
- **サンドボックスプレビュー(開発用)**: https://3000-i94l1sj6tl7trvmsyql1g-3844e1b6.sandbox.novita.ai

## 機能エントリ(API)
| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/office` | ワーカー状態+タスク+KPI+承認待ち+直近ログ |
| GET | `/api/workers/:name` | ワーカー詳細と実行ログ |
| GET | `/api/topics?status=pending` | 企画ネタ一覧(ゲート①) |
| POST | `/api/topics/:id/decision` | 企画の採用/見送り `{decision}` |
| GET | `/api/posts?status=pending` | X投稿一覧(ゲート②) |
| POST | `/api/posts/:id/decision` | 投稿の承認/差戻 `{decision, reason?}` |
| POST | `/api/posts/approve-all` | QA通過分を一括承認 |
| GET | `/api/notes` / `/api/notes/:id` | note記事一覧/全文(ゲート③) |
| POST | `/api/notes/:id/publish` | note公開(QA=NGは拒否) |
| GET | `/api/kpi?days=14` | KPI履歴+サマリ |
| POST | `/api/qa/check` | QAチェック実行 `{text, has_affiliate?}` |
| GET | `/api/qa/rules` | 禁止表現ルールDB |
| POST | `/api/simulate/tick` | デモ: ワーカー状態を擬似進行 |
| GET/POST | `/api/affiliate/links` | アフィリンク一覧/登録 |
| POST | `/api/affiliate/links/:id/toggle` `/delete` | リンク停止・再開/削除 |
| POST | `/api/affiliate/embed` | 埋め込みプレビュー `{text}` |
| POST | `/api/posts/:id/embed-affiliate` | 投稿へ自動埋め込み+再QA |
| GET | `/api/glossary` / POST `/api/glossary/suggest` | 用語辞書/注釈サジェスト |
| POST | `/api/riko/crawl` | Riko実巡回(RSS/Reddit収集→gpt-5-mini選定→ネタ投入) |
| POST | `/api/yuto/auto-write` | Yuto一括執筆(承認済みネタ→6枠の投稿生成→承認キュー) |
| GET | `/api/cron/status` | 自動サイクル状態+実行履歴 |
| POST | `/api/cron/run?cycle=morning\|evening\|auto` | 定時実行エンドポイント(`Authorization: Bearer CRON_SECRET` 必須) |

## データアーキテクチャ
- **ストレージ**: Cloudflare D1(ローカルは `--local` SQLite) + R2(生成画像の保存)
- **テーブル**: `worker_status` / `worker_logs` / `topic_candidates` / `x_posts` / `note_articles` / `kpi_daily` / `approval_queue` / `task_queue` / `affiliate_links` / `glossary` / `generated_images`
- **データフロー**: 企画承認→Kai翻訳タスク投入 / 投稿承認→Sora予約タスク投入 / 差戻→Yuto書き直しタスク投入(task_queue経由で連鎖)
- **QAロジック**: `src/qa-rules.ts` に禁止表現DB(指示書08章)を実装。API・UI両方から利用

## コンテンツ方針(2回目の修正で反映)
- **素人向け注釈**: 固有名詞初出時に「※KDP=Amazonで誰でも無料で電子書籍を出せる仕組み」形式の1行注釈を必須化(glossaryテーブル+Yutoプロンプトに反映)
- **金額は円換算を先に**: 「月45万円($3,000)」形式
- **リプ誘発枠(枠5・9・12)**: 専門知識ゼロでも答えられる普遍的なお金の質問(「月3万円あったら何に使う?」「副業を始めない理由①〜④」等)を毎日3本配置
- **アフィリエイト運用**: ASP提携申請のみ人間が実施(規約上必須)。リンク登録後は完全自動 — ツール名検出→リンク挿入→PR表記→再QAまでワンボタン/本番ではYuto執筆時に自動実行

## 指示書からの変更点(改善)
元の指示書はAI作成のため、以下を現実的な構成に調整しました:
1. **Cloudflare Queues → D1テーブル(task_queue)**: Queues は Pages では利用不可+有料機能のため、D1で同等のキュー機構を実装(挙動は同一、後からWorkers移行可)
2. **Cron Triggers → GitHub Actions 定時実行**: Pages では Cron 未対応のため、GitHub Actionsから `/api/cron/run` を定時呼び出し。JST 06:00=朝サイクル(Riko巡回)、JST 21:00=夕サイクル(Yuto執筆)。CRON_SECRETのBearer認証で保護
   - **有効化手順(2分・手動)**: GitHub App権限の制約でワークフローの自動配置ができないため、①リポジトリ直下の `github-actions-cron.yml` を `.github/workflows/cron.yml` にリネームして配置(GitHub Web UIの「Add file」でOK)、② Settings → Secrets and variables → Actions で `CRON_SECRET` を登録(値は取締役に別途共有)。それまでは承認画面の手動ボタンで同じ処理を実行可能
3. **LLM/Buffer/note自動投稿は未接続**: APIキー(OpenAI/Buffer)とnote認証情報が必要なため、タスク投入までを実装。キー提供後に接続可能
4. **LLMをAnthropic Claude→OpenAI GPT-5ファミリに変更**: ユーザーのOpenAI APIキーで運用可能に。モデル割当とコスト試算はダッシュボードの「AIコスト」タブで可視化(`src/model-plan.ts` / `/api/models/cost`)
5. **React → CDNベースのVanilla JS SPA**: ビルド構成を単純化し、同一Pagesプロジェクト内でAPI+UIを完結

## AIモデル構成(OpenAI移行プラン)
**OpenAI APIキーで運用可能です(Anthropicキー不要)**。詳細はダッシュボードの「AIコスト」タブ参照。

| モデル | 担当ワーカー | 位置づけ |
|---|---|---|
| **gpt-5** | Yuto(ライター) | 収益の生命線である投稿・note執筆は最上位モデル |
| **gpt-5-mini** | Riko(企画) / Kai(翻訳) / Rui(分析) / Mio(QA) | 中程度の推論が必要な作業 |
| **gpt-5-nano** | Alex(PM) / Aki(画像) / Sora(SNS) / Nana(秘書) | 定型・オーケストレーション作業 |

- **試算コスト**: 約 $0.40/日 → 約 $12/月(約¥1,800/月) ※旧Claude構成($45/月)比で約73%削減
- 料金・トークン前提は `src/model-plan.ts` に一元管理(変更すればUIに即反映)

### 実LLM接続(稼働中)
- ヘルパー: `src/llm.ts` (fetchのみ使用、Workers完全対応、`reasoning_effort: low` で推論トークンを抑制)
- API: `GET /api/llm/status` / `POST /api/llm/write` (Yuto執筆) / `POST /api/llm/qa` (Mio審査) / `POST /api/posts/:id/rewrite` (Yutoリライト)
- キー管理: ローカル=`.dev.vars`(gitignore済み) / 本番=Workerシークレット `OPENAI_API_KEY`。**キーはコード・Gitに一切含まない**

## 未実装(次の開発ステップ)
- [x] OpenAI API 接続 — Yuto(gpt-5)の実AI執筆/リライト、Mio(gpt-5-mini)の実AI法務審査が稼働中
- [x] Rikoの実LLM化 — RSS/Reddit実巡回 + gpt-5-miniによるネタ選定・日本向けアレンジが稼働中(`src/sources.ts` / `src/riko.ts`)
- [ ] Kaiの実LLM化(翻訳タスクの自動化)
- [x] X API 直接接続 — OAuth1.0a署名実装済み。`X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_TOKEN_SECRET` の4シークレット登録で自動投稿が有効化(未登録時はコピペ半自動運用)
  - ※Buffer APIは新規開発者受付終了のため、指示書のBuffer経由構成からX API直接接続に変更
- [ ] note Browser Rendering(有料プラン+専用Workerが必要)
- [x] Reddit/RSS の実巡回 — 指示書§04の12 subreddit + 4 RSSフィードを巡回(subredditは日替わり6つローテーション)
- [ ] YouTube/X監視アカウントの巡回(YouTube Data APIキー / X APIキー取得後に有効化)
- [x] Cron自動サイクル — 朝: Riko巡回でネタ収集→ゲート① / 夕: 承認済みネタからYutoが6枠(1/3/5/8/9/10)を自動執筆→ゲート②。GitHub Actionsで定時実行
- [x] アクセス制限 — Gensparkサインインの許可リスト方式(d.omori@dissectera.com のみ許可、`/api/cron/**` は別途CRON_SECRET認証)
- [x] 画像生成連携(Aki) — gpt-image-2でブランド準拠画像を生成しR2に保存。「画像」タブで操作
- [x] 画像QA(Mio) — GPT-5 visionで誤字/法令/権利/ブランド準拠を自動審査。生成時に自動実行+再審査ボタン

## 使い方(取締役向け)
1. **オフィス**: 9人の稼働状況を眺める。デスクをクリックすると実行ログが見える
2. **承認**: オレンジのバッジが付いたら承認画面へ。「QA通過分を一括承認」でスマホ5分運用。QA要修正(枠8など)は指摘内容を確認して個別判断
3. **KPI**: フォロワーと売上の推移を確認
4. **QAチェック**: 自分で書いた投稿文を貼ると、Mioが禁止表現を検出(例:「誰でも簡単に稼げる」→ 景表法指摘)。「Mio 実AIチェック」ボタンでGPT-5 miniによる深い審査+書き直し案も取得可能
5. **AI執筆(Yuto)**: QAタブの「Yuto AI執筆スタジオ」でテーマを入れるとGPT-5が注釈・円換算・法令ルールを守った投稿を執筆。承認キューへの追加も可能
6. **AIリライト**: 承認画面でQA要修正の投稿に「Yuto(AI)にリライトさせる」ボタンが出現。指摘を解消した文面に自動書き換え
7. **自動サイクル(「朝起きたらネタが並んでいる」運用)**: 毎朝JST 06:00にRikoが海外ソースを巡回しゲート①にネタを並べる。取締役が承認すると、毎晚JST 21:00にYutoが翌日分6枠分を執筆しゲート②に並べる。承認画面の「Riko巡回を今すぐ実行」「Yutoに一括執筆させる」ボタンで手動実行も可能

## 開発
```bash
npm run build                                          # ビルド
npx wrangler d1 migrations apply webapp-production --local  # マイグレーション
npx wrangler d1 execute webapp-production --local --file=./seed.sql  # シード
pm2 start ecosystem.config.cjs                         # 起動(port 3000)
```

## デプロイ
- **プラットフォーム**: Cloudflare Workers(Genspark管理ホスティング / Workers for Platform)
- **ステータス**: ✅ 本番稼働中
- **DB**: 管理D1(スキーマ+シードデータ適用済み)
- **技術スタック**: Hono + TypeScript + D1(SQLite) + TailwindCSS(CDN) + Chart.js
- **最終更新**: 2026-08-17
