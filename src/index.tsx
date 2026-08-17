import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { runQaCheck, FORBIDDEN_RULES } from './qa-rules'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ============================================================
// Virtual Office API
// ============================================================

// オフィス全体の状態(ワーカー + 承認待ち件数 + 本日KPI)
app.get('/api/office', async (c) => {
  const { DB } = c.env
  const [workers, tasks, kpi, pendingApprovals, recentLogs] = await Promise.all([
    DB.prepare('SELECT * FROM worker_status ORDER BY rowid').all(),
    DB.prepare("SELECT * FROM task_queue WHERE status IN ('queued','processing') ORDER BY priority LIMIT 20").all(),
    DB.prepare("SELECT * FROM kpi_daily ORDER BY date DESC LIMIT 2").all(),
    DB.prepare("SELECT gate_type, COUNT(*) as cnt FROM approval_queue WHERE responded_at IS NULL GROUP BY gate_type").all(),
    DB.prepare('SELECT * FROM worker_logs ORDER BY started_at DESC LIMIT 10').all()
  ])
  return c.json({
    workers: workers.results,
    tasks: tasks.results,
    kpi_today: kpi.results?.[0] ?? null,
    kpi_yesterday: kpi.results?.[1] ?? null,
    pending_approvals: pendingApprovals.results,
    recent_logs: recentLogs.results
  })
})

// ワーカー詳細(ログ履歴)
app.get('/api/workers/:name', async (c) => {
  const { DB } = c.env
  const name = c.req.param('name')
  const [worker, logs] = await Promise.all([
    DB.prepare('SELECT * FROM worker_status WHERE worker_name = ?').bind(name).first(),
    DB.prepare('SELECT * FROM worker_logs WHERE worker_name = ? ORDER BY started_at DESC LIMIT 30').bind(name).all()
  ])
  if (!worker) return c.notFound()
  return c.json({ worker, logs: logs.results })
})

// ============================================================
// 承認ゲート① 週次企画(月曜朝)
// ============================================================

app.get('/api/topics', async (c) => {
  const { DB } = c.env
  const status = c.req.query('status') ?? 'pending'
  const rows = await DB.prepare('SELECT * FROM topic_candidates WHERE status = ? ORDER BY CASE urgency WHEN "high" THEN 0 WHEN "medium" THEN 1 ELSE 2 END, created_at DESC').bind(status).all()
  return c.json({ topics: rows.results })
})

app.post('/api/topics/:id/decision', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { decision } = await c.req.json<{ decision: 'approved' | 'rejected' }>()
  if (!['approved', 'rejected'].includes(decision)) return c.json({ error: 'invalid decision' }, 400)
  await DB.prepare('UPDATE topic_candidates SET status = ? WHERE topic_id = ?').bind(decision, id).run()
  // 承認されたら Kai(翻訳)へタスク投入
  if (decision === 'approved') {
    await DB.prepare("INSERT INTO task_queue (worker_name, task_type, payload, priority) VALUES ('kai', 'translate', ?, 2)")
      .bind(JSON.stringify({ topic_id: id })).run()
  }
  return c.json({ ok: true, topic_id: id, decision })
})

// ============================================================
// 承認ゲート② 日次X投稿12本(毎晩22:00)
// ============================================================

app.get('/api/posts', async (c) => {
  const { DB } = c.env
  const status = c.req.query('status') ?? 'pending'
  const rows = await DB.prepare('SELECT * FROM x_posts WHERE approval_status = ? ORDER BY slot_number').bind(status).all()
  return c.json({ posts: rows.results })
})

app.post('/api/posts/:id/decision', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { decision, reason } = await c.req.json<{ decision: 'approved' | 'rejected'; reason?: string }>()
  if (!['approved', 'rejected'].includes(decision)) return c.json({ error: 'invalid decision' }, 400)
  await DB.prepare('UPDATE x_posts SET approval_status = ? WHERE post_id = ?').bind(decision, id).run()
  if (decision === 'approved') {
    // Sora へ Buffer予約タスク投入
    await DB.prepare("INSERT INTO task_queue (worker_name, task_type, payload, priority) VALUES ('sora', 'buffer_schedule', ?, 1)")
      .bind(JSON.stringify({ post_id: id })).run()
  } else if (reason) {
    // 差戻理由を Yuto へ
    await DB.prepare("INSERT INTO task_queue (worker_name, task_type, payload, priority) VALUES ('yuto', 'rewrite', ?, 1)")
      .bind(JSON.stringify({ post_id: id, reason })).run()
  }
  return c.json({ ok: true, post_id: id, decision })
})

// 一括承認(QAがOKの投稿のみ)
app.post('/api/posts/approve-all', async (c) => {
  const { DB } = c.env
  const result = await DB.prepare("UPDATE x_posts SET approval_status = 'approved' WHERE approval_status = 'pending' AND qa_status = 'ok'").run()
  const approved = result.meta.changes ?? 0
  if (approved > 0) {
    await DB.prepare("INSERT INTO task_queue (worker_name, task_type, payload, priority) VALUES ('sora', 'buffer_schedule_batch', ?, 1)")
      .bind(JSON.stringify({ approved_count: approved })).run()
    await DB.prepare("UPDATE approval_queue SET responded_at = CURRENT_TIMESTAMP, decision = 'approved' WHERE gate_type = 'daily_posts' AND responded_at IS NULL").run()
  }
  const skipped = await DB.prepare("SELECT COUNT(*) as cnt FROM x_posts WHERE approval_status = 'pending'").first<{ cnt: number }>()
  return c.json({ ok: true, approved, skipped: skipped?.cnt ?? 0 })
})

// ============================================================
// 承認ゲート③ 有料note公開直前
// ============================================================

app.get('/api/notes', async (c) => {
  const { DB } = c.env
  const rows = await DB.prepare('SELECT article_id, topic_id, title, type, price_yen, approval_status, qa_status, published_at, view_count, sales_count, revenue_yen, created_at FROM note_articles ORDER BY created_at DESC').all()
  return c.json({ articles: rows.results })
})

app.get('/api/notes/:id', async (c) => {
  const { DB } = c.env
  const row = await DB.prepare('SELECT * FROM note_articles WHERE article_id = ?').bind(c.req.param('id')).first()
  if (!row) return c.notFound()
  return c.json({ article: row })
})

app.post('/api/notes/:id/publish', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const article = await DB.prepare('SELECT * FROM note_articles WHERE article_id = ?').bind(id).first<any>()
  if (!article) return c.notFound()
  if (article.qa_status === 'ng') return c.json({ error: 'QA判定がNGのため公開できません' }, 400)
  await DB.prepare("UPDATE note_articles SET approval_status = 'published', published_at = CURRENT_TIMESTAMP WHERE article_id = ?").bind(id).run()
  await DB.prepare("UPDATE approval_queue SET responded_at = CURRENT_TIMESTAMP, decision = 'approved' WHERE gate_type = 'paid_note' AND responded_at IS NULL AND target_ids LIKE ?").bind(`%${id}%`).run()
  // note_publisher タスク投入(本番では Browser Rendering)
  await DB.prepare("INSERT INTO task_queue (worker_name, task_type, payload, priority) VALUES ('sora', 'note_publish', ?, 1)")
    .bind(JSON.stringify({ article_id: id })).run()
  return c.json({ ok: true, article_id: id })
})

// ============================================================
// KPI
// ============================================================

app.get('/api/kpi', async (c) => {
  const { DB } = c.env
  const days = Math.min(parseInt(c.req.query('days') ?? '14'), 90)
  const rows = await DB.prepare('SELECT * FROM kpi_daily ORDER BY date DESC LIMIT ?').bind(days).all()
  const history = (rows.results as any[]).reverse()
  const latest = history[history.length - 1]
  const prev = history[history.length - 2]
  return c.json({
    history,
    summary: latest && prev ? {
      followers_delta: latest.x_followers - prev.x_followers,
      revenue_today: (latest.note_paid_sales ?? 0) + (latest.membership_revenue ?? 0) + (latest.affiliate_revenue ?? 0),
      revenue_total: history.reduce((s: number, r: any) => s + (r.note_paid_sales ?? 0) + (r.affiliate_revenue ?? 0), 0) + (latest.membership_revenue ?? 0)
    } : null
  })
})

// ============================================================
// QAチェック(Mio)— 実動デモ
// ============================================================

app.post('/api/qa/check', async (c) => {
  const { text, has_affiliate } = await c.req.json<{ text: string; has_affiliate?: boolean }>()
  if (!text) return c.json({ error: 'text is required' }, 400)
  const result = runQaCheck(text, has_affiliate ?? false)
  return c.json(result)
})

app.get('/api/qa/rules', (c) => c.json(FORBIDDEN_RULES))

// ============================================================
// シミュレーション: ワーカー活動の擬似進行(デモ用)
// 本番では Cron Triggers + LLM API がこの役割を担う
// ============================================================

const SIM_TASKS: Record<string, string[]> = {
  alex: ['週次テーマをタスク分解中', 'KPI集計を指示中', '日次タスクをキュー投入中'],
  riko: ['Reddit巡回 - r/SideHustle', 'YouTube新着チェック中', 'Product Hunt 巡回中', 'ネタ候補を選定中'],
  kai: ['KDPスレッドを翻訳中', 'Indie Hackers記事を要約中', '一次情報を精読中'],
  yuto: ['枠4スレッド執筆中', 'note有料記事を執筆中', '枠1速報を執筆中'],
  aki: ['図解画像を生成中', 'noteアイキャッチ作成中', 'サムネのプロンプト設計中'],
  sora: ['業界アカウント巡回中', 'Buffer予約投稿を設定中', 'エンゲージ数値を取得中'],
  nana: ['日次レポート作成中', '承認リマインドを準備中', 'KPIを集計中'],
  rui: ['本日の投稿を分析中', '週次改善提案を作成中', '伸びた投稿の仮説検証中'],
  mio: ['本日分の投稿レビュー中', '引用URLの実在確認中', '禁止表現スキャン中']
}

app.post('/api/simulate/tick', async (c) => {
  const { DB } = c.env
  const workers = Object.keys(SIM_TASKS)
  const updates: { worker: string; status: string; task: string }[] = []
  for (const w of workers) {
    const r = Math.random()
    const status = r < 0.55 ? 'working' : r < 0.97 ? 'idle' : 'error'
    const task = status === 'working'
      ? SIM_TASKS[w][Math.floor(Math.random() * SIM_TASKS[w].length)]
      : status === 'error' ? 'エラー: API応答なし(リトライ中)' : '待機中'
    await DB.prepare('UPDATE worker_status SET status = ?, current_task = ?, last_updated = CURRENT_TIMESTAMP WHERE worker_name = ?')
      .bind(status, task, w).run()
    updates.push({ worker: w, status, task })
  }
  // ランダムでログも1件追加
  const w = workers[Math.floor(Math.random() * workers.length)]
  await DB.prepare("INSERT INTO worker_logs (worker_name, action, status, finished_at) VALUES (?, ?, 'success', CURRENT_TIMESTAMP)")
    .bind(w, SIM_TASKS[w][Math.floor(Math.random() * SIM_TASKS[w].length)].replace('中', '完了')).run()
  return c.json({ ok: true, updates })
})

// ============================================================
// フロントエンド(SPA)
// ============================================================

app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Virtual Office | Mさん / 海外AI副業の検証部屋</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: { brand: { navy: '#1E3A5F', orange: '#FF7A45' } }
        }
      }
    }
  </script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="/static/style.css" rel="stylesheet">
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
</head>
<body class="bg-slate-100 text-slate-800">
  <header id="app-header" class="bg-brand-navy text-white shadow-lg sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <span class="text-2xl">🏢</span>
        <div>
          <h1 class="font-bold text-lg leading-tight">AI Virtual Office</h1>
          <p class="text-xs text-slate-300">Mさん / 海外AI副業の検証部屋</p>
        </div>
      </div>
      <nav id="main-nav" class="flex gap-1 text-sm flex-wrap">
        <button data-view="office" class="nav-btn px-3 py-2 rounded-lg hover:bg-white/10"><i class="fas fa-building mr-1"></i>オフィス</button>
        <button data-view="approve" class="nav-btn px-3 py-2 rounded-lg hover:bg-white/10"><i class="fas fa-check-double mr-1"></i>承認<span id="approval-badge" class="hidden ml-1 bg-brand-orange text-white text-xs px-1.5 py-0.5 rounded-full"></span></button>
        <button data-view="kpi" class="nav-btn px-3 py-2 rounded-lg hover:bg-white/10"><i class="fas fa-chart-line mr-1"></i>KPI</button>
        <button data-view="qa" class="nav-btn px-3 py-2 rounded-lg hover:bg-white/10"><i class="fas fa-shield-halved mr-1"></i>QAチェック</button>
      </nav>
    </div>
  </header>

  <main id="app" class="max-w-7xl mx-auto px-4 py-6"></main>

  <footer class="text-center text-xs text-slate-400 py-6">
    取締役の承認3ゲート以外は9人のAIワーカーが自走します(現在はデモモード)
  </footer>

  <div id="modal-root"></div>
  <div id="toast-root" class="fixed bottom-4 right-4 z-50 space-y-2"></div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>`)
})

export default app
