-- ワーカー初期データ(9人 + 取締役)
INSERT OR REPLACE INTO worker_status (worker_name, display_name, role, icon, current_task, status) VALUES
  ('alex', 'Alex', 'PM(進行管理)', '👨‍💼', '週次計画をタスク分解中', 'working'),
  ('riko', 'Riko', '企画(リサーチャー)', '🔍', 'Reddit巡回 - r/SideHustle', 'working'),
  ('kai',  'Kai',  '翻訳', '🌐', '待機中', 'idle'),
  ('yuto', 'Yuto', 'ライター', '✍️', '枠4スレッド執筆中', 'working'),
  ('aki',  'Aki',  '画像担当', '🎨', '待機中', 'idle'),
  ('sora', 'Sora', 'SNS管理', '📱', '業界アカウント巡回中', 'working'),
  ('nana', 'Nana', '秘書', '📋', '待機中', 'idle'),
  ('rui',  'Rui',  '分析', '📊', '待機中', 'idle'),
  ('mio',  'Mio',  'QA', '✅', '本日分の投稿レビュー中', 'working');

-- ネタ候補サンプル
INSERT OR IGNORE INTO topic_candidates (topic_id, title_ja, appeal_axis, target_medium, source_urls, why_hit, urgency, status) VALUES
  ('t-001', 'Redditで月$3k達成のKDP新手法、日本未上陸っぽい', '["男=欲望","貧乏人=希望"]', 'x_thread', '["https://reddit.com/r/KDP/example1"]', '日本語圏で未検証の一次情報+具体的な数字がある', 'high', 'approved'),
  ('t-002', 'ElevenLabs新機能でFaceless動画の量産コストが1/3に', '["貧乏人=希望"]', 'x_single', '["https://elevenlabs.io/blog/example"]', 'ツール新機能は速報価値が高い', 'high', 'approved'),
  ('t-003', 'Etsyデジタル商品で不労…ではなく「仕組み収益」を作る話', '["親=安心","貧乏人=希望"]', 'note_paid', '["https://reddit.com/r/Etsy/example2"]', '再現手順を有料で完結できる構造', 'medium', 'pending'),
  ('t-004', 'Indie Hackersで話題のAIエージェント受託、単価が異常', '["男=欲望","金持ち=安全"]', 'x_thread', '["https://indiehackers.com/example"]', '高単価事例はエンゲージが伸びやすい', 'medium', 'pending'),
  ('t-005', 'YouTube切り抜き自動化パイプラインの海外事例まとめ', '["貧乏人=希望"]', 'note_free', '["https://youtube.com/watch?v=example"]', '集客用の無料記事に最適', 'low', 'pending'),
  ('t-006', 'Gumroadで売れてるAIプロンプト集の価格帯分析', '["男=欲望"]', 'x_single', '["https://gumroad.com/example"]', '価格の具体数字で保存されやすい', 'medium', 'pending'),
  ('t-007', 'Print on Demand × AIデザインの最新ワークフロー', '["貧乏人=希望","子供=夢"]', 'note_paid', '["https://reddit.com/r/PrintOnDemand/example"]', '実践手順を画像付きで解説できる', 'medium', 'pending');

-- 明日のX投稿12本(承認待ちサンプル)
INSERT OR IGNORE INTO x_posts (post_id, topic_id, slot_number, scheduled_at, body, image_urls, approval_status, qa_status) VALUES
  ('p-001', 't-001', 1, datetime('now', '+1 day', 'start of day', '+6 hours', '+30 minutes'),
   '【海外速報】RedditのKDPスレで月$3,000達成の報告が話題です。' || char(10) || '要点3つ:' || char(10) || '・ニッチ特化のローコンテンツ本' || char(10) || '・表紙はAI生成で外注ゼロ' || char(10) || '・出版数は月40冊ペース' || char(10) || '日本のKindleで再現できるか、僕も検証してみます。' || char(10) || '出典→ reddit.com/r/KDP' || char(10) || '#海外副業 #AI副業', NULL, 'pending', 'ok'),
  ('p-002', NULL, 2, datetime('now', '+1 day', 'start of day', '+7 hours', '+30 minutes'),
   '今日はKDP新手法の深掘りと、ElevenLabs新機能の検証結果を出します。11時のスレッドは保存推奨の内容になりそうです👇', NULL, 'pending', 'ok'),
  ('p-003', 't-002', 3, datetime('now', '+1 day', 'start of day', '+9 hours'),
   'Faceless動画の音声コスト、ElevenLabsの新プランでここまで下がりました。図解にまとめたので見てください。' || char(10) || '#AI副業', '["placeholder_zukai_1.png"]', 'pending', 'ok'),
  ('p-004', 't-001', 4, datetime('now', '+1 day', 'start of day', '+11 hours'),
   '海外のKDP事情、正直ここまで来てるとは思いませんでした。' || char(10) || '月$3,000を「本を書かずに」達成した方法、全部分解します👇' || char(10) || '(スレッド 2〜8本目は詳細画面で確認)', NULL, 'pending', 'ok'),
  ('p-005', NULL, 5, datetime('now', '+1 day', 'start of day', '+12 hours', '+15 minutes'),
   '昼休みTips: ChatGPTのプロンプト、英語圏では「役割+制約+出力形式」の3点セットが定番化してる印象です。日本語でも同じ構造が効きます。', NULL, 'pending', 'ok'),
  ('p-006', NULL, 6, datetime('now', '+1 day', 'start of day', '+14 hours'),
   '(引用RT)この視点は日本だとまだ少ないですね。海外では「作る前に売る」が完全に定着してるっぽい。', NULL, 'pending', 'ok'),
  ('p-007', 't-004', 7, datetime('now', '+1 day', 'start of day', '+16 hours'),
   'Indie Hackersで見つけたAIエージェント受託の事例。個人で月$8k、稼働は週20時間とのこと。単価設定の考え方が日本と根本的に違う印象です。詳細を分解します。', NULL, 'pending', 'ok'),
  ('p-008', NULL, 8, datetime('now', '+1 day', 'start of day', '+18 hours'),
   'AI音声ツール3つを同条件で比較しました。結論、日本語品質ならA、コスパならB、速度ならCという住み分けな印象。詳細は画像で。' || char(10) || '#PR(アフィリエイトリンクを含みます)', NULL, 'pending', 'needs_fix'),
  ('p-009', NULL, 9, datetime('now', '+1 day', 'start of day', '+19 hours', '+30 minutes'),
   'みなさんは副業の情報収集、どこでやってますか?僕はRedditとYouTubeが中心なんですが、他に良いソースあれば教えてください。', NULL, 'pending', 'ok'),
  ('p-010', NULL, 10, datetime('now', '+1 day', 'start of day', '+21 hours'),
   '今週の失敗談: Etsyのデジタル商品、リサーチ不足で出品3日ゼロ売上でした。ニッチ選定を飛ばすとこうなるという実例です。来週は選定からやり直します。', NULL, 'pending', 'ok'),
  ('p-011', NULL, 11, datetime('now', '+1 day', 'start of day', '+22 hours', '+30 minutes'),
   'KDP新手法の完全版、noteにまとめました。無料部分だけでも全体像はつかめるようにしてあります。' || char(10) || 'note.com/m_fukugyou', NULL, 'pending', 'ok'),
  ('p-012', NULL, 12, datetime('now', '+1 day', 'start of day', '+23 hours', '+30 minutes'),
   '今日も1日お疲れさまでした。海外の事例を見てると「小さく試して数字で判断」が徹底されてるなと感じます。僕も明日また1つ検証します。おやすみなさい。', NULL, 'pending', 'ok');

-- QA指摘サンプル(枠8に要修正)
UPDATE x_posts SET qa_issues = '[{"rule":"ステマ規制","detail":"アフィリンク付き投稿の画像にPR表記が必要です。画像未添付のため、Akiに画像生成を依頼してください。","severity":"needs_fix"}]' WHERE post_id = 'p-008';

-- note記事サンプル
INSERT OR IGNORE INTO note_articles (article_id, topic_id, title, type, price_yen, body_md, paywall_position, approval_status, qa_status, view_count, sales_count, revenue_yen) VALUES
  ('n-001', 't-001', '【2026年8月版】海外Redditで話題のKDP新手法5選(検証済み)', 'paid_single', 500,
   '# 導入' || char(10) || char(10) || 'こんにちは、Mです。先週Redditを巡回していて、KDPの新しい手法が話題になっているのを見つけました。僕自身で1週間検証した結果をまとめます。' || char(10) || char(10) || '## この記事でわかること' || char(10) || '- 海外で話題のKDP新手法5つの全体像' || char(10) || '- 日本のKindleで再現する際の注意点' || char(10) || '- 僕が実際に試した結果の数字' || char(10) || char(10) || '# 本題① 概要(無料)' || char(10) || char(10) || '手法の全体像はシンプルです。ローコンテンツ本 × ニッチ特化 × AI表紙生成の3点セット...' || char(10) || char(10) || '---ここから有料---' || char(10) || char(10) || '# 本題② 詳細1' || char(10) || char(10) || '(購入者限定コンテンツ)...',
   14, 'pending', 'ok', 342, 12, 6000),
  ('n-002', 't-005', 'YouTube切り抜き自動化の海外事例まとめ(無料)', 'free', 0,
   '# はじめに' || char(10) || char(10) || '海外のFaceless系YouTuberの間で定番化している自動化パイプラインを紹介します...',
   NULL, 'published', 'ok', 1205, 0, 0);

UPDATE note_articles SET published_at = datetime('now', '-2 days') WHERE article_id = 'n-002';

-- 承認キュー(3ゲート分)
INSERT OR IGNORE INTO approval_queue (approval_id, gate_type, target_ids) VALUES
  ('a-001', 'daily_posts', '["p-001","p-002","p-003","p-004","p-005","p-006","p-007","p-008","p-009","p-010","p-011","p-012"]'),
  ('a-002', 'weekly_planning', '["t-003","t-004","t-005","t-006","t-007"]'),
  ('a-003', 'paid_note', '["n-001"]');

-- 日次KPI(過去14日分のサンプル)
INSERT OR IGNORE INTO kpi_daily (date, x_followers, x_impressions_total, x_engagements_total, note_followers, note_paid_sales, membership_count, membership_revenue, affiliate_revenue) VALUES
  (date('now','-13 days'), 120, 8500, 320, 15, 0, 0, 0, 0),
  (date('now','-12 days'), 128, 9200, 350, 17, 500, 0, 0, 0),
  (date('now','-11 days'), 135, 11000, 410, 20, 0, 1, 580, 0),
  (date('now','-10 days'), 149, 15400, 620, 24, 1000, 1, 580, 120),
  (date('now','-9 days'),  163, 13200, 540, 28, 500, 2, 1160, 0),
  (date('now','-8 days'),  171, 12800, 500, 31, 0, 2, 1160, 240),
  (date('now','-7 days'),  185, 18900, 810, 36, 1500, 3, 1740, 0),
  (date('now','-6 days'),  204, 22400, 960, 42, 2000, 4, 2320, 360),
  (date('now','-5 days'),  219, 19800, 850, 47, 500, 4, 2320, 0),
  (date('now','-4 days'),  231, 17600, 720, 51, 1000, 5, 2900, 120),
  (date('now','-3 days'),  248, 24100, 1050, 58, 2500, 6, 3480, 480),
  (date('now','-2 days'),  266, 26700, 1180, 64, 1500, 7, 4060, 0),
  (date('now','-1 days'),  289, 31200, 1420, 72, 3000, 8, 4640, 600),
  (date('now'),            301, 12400, 520, 76, 1000, 9, 5220, 120);

-- ワーカーログサンプル
INSERT INTO worker_logs (worker_name, action, status, output_json, started_at, finished_at) VALUES
  ('riko', 'ソース巡回(Reddit 11サブレディット)', 'success', '{"collected":23,"selected":10}', datetime('now','-2 hours'), datetime('now','-2 hours','+8 minutes')),
  ('kai', '翻訳: KDP新手法スレッド', 'success', '{"chars":1240}', datetime('now','-100 minutes'), datetime('now','-95 minutes')),
  ('yuto', '枠1〜12 本文執筆', 'success', '{"posts":12}', datetime('now','-80 minutes'), datetime('now','-60 minutes')),
  ('mio', 'QAレビュー 12投稿', 'success', '{"ok":11,"needs_fix":1,"ng":0}', datetime('now','-50 minutes'), datetime('now','-45 minutes')),
  ('aki', '枠3 図解生成', 'success', '{"images":1}', datetime('now','-40 minutes'), datetime('now','-38 minutes')),
  ('sora', '業界30アカウント巡回', 'running', NULL, datetime('now','-10 minutes'), NULL);

-- タスクキューサンプル
INSERT INTO task_queue (worker_name, task_type, payload, status, priority) VALUES
  ('aki', 'image_generation', '{"post_id":"p-008","type":"comparison_chart"}', 'queued', 2),
  ('yuto', 'note_draft', '{"topic_id":"t-003"}', 'queued', 3),
  ('sora', 'buffer_schedule', '{"approval_id":"a-001"}', 'queued', 1),
  ('nana', 'daily_report', '{"date":"today"}', 'queued', 5);
