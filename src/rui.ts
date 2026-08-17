// Rui(分析): 日次KPI分析 + 週次(日曜)7日総括+改善提案3つ(指示書 L312-330 準拠)
// 品質優先方針: 分析の質が改善サイクルの起点のため gpt-5 + 推論medium
import { callOpenAI, type LlmResult } from './llm'

export const RUI_SYSTEM = `あなたは「Rui」— AIバーチャルオフィス「Mさん / 海外AI副業の検証部屋」の分析担当です。
X投稿とnoteのKPIデータを分析し、仮説と改善アクションを導きます。

## 分析ルール
- 数字の変化には必ず仮説を付ける(「なぜそうなったか」)
- 前日比・前週比が5%未満の変化は「有意な変化なし」と扱い、無理に理由づけしない
- 提案は「実行可能な具体アクション」のみ。抽象論(「もっと頑張る」等)は禁止
- データが少ない・デモデータの場合は正直にその旨を明記し、データが揃った時に見るべき観点を示す
- 敬体。Markdownで簡潔に

## 日次分析の構成
1. 昨日のハイライト(数字+仮説)
2. 気になる点(あれば)
3. 今日注視すべき指標

## 週次分析の構成(日曜のみ)
1. 7日間の総括(主要数字の推移+仮説)
2. うまくいったこと / いかなかったこと
3. 改善提案3つ(それぞれ: タイトル / 理由 / 具体的な実行手順 / 期待効果)`

export interface RuiResult {
  ok: boolean
  reportType: 'daily' | 'weekly'
  reportId?: string
  bodyMd?: string
  proposals?: { title: string; reason: string; action: string; expected: string }[]
  costUsd: number
  error?: string
}

// 直近データの収集(日次/週次共通)
async function collectKpiFacts(db: D1Database, days: number): Promise<string> {
  const kpiRows = await db
    .prepare(`SELECT * FROM kpi_daily ORDER BY date DESC LIMIT ?`)
    .bind(days + 1)
    .all()
  const kpis = (kpiRows.results || []) as any[]

  // 投稿別パフォーマンス(公開済み・直近)
  const postRows = await db
    .prepare(
      `SELECT slot_number, substr(body, 1, 60) AS body_head, impressions, engagements, date(published_at) AS pub_date
       FROM x_posts WHERE published_at IS NOT NULL AND published_at > datetime('now', ?)
       ORDER BY impressions DESC LIMIT 20`,
    )
    .bind(`-${days} days`)
    .all()
  const posts = (postRows.results || []) as any[]

  // 枠別平均
  const slotRows = await db
    .prepare(
      `SELECT slot_number, COUNT(*) AS n, AVG(impressions) AS avg_imp, AVG(engagements) AS avg_eng
       FROM x_posts WHERE published_at IS NOT NULL AND published_at > datetime('now', ?)
       GROUP BY slot_number ORDER BY avg_imp DESC`,
    )
    .bind(`-${days} days`)
    .all()
  const slots = (slotRows.results || []) as any[]

  // note状況
  const noteRows = await db
    .prepare(
      `SELECT title, type, price_yen, view_count, sales_count, revenue_yen, date(published_at) AS pub_date
       FROM note_articles WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 10`,
    )
    .all()
  const notes = (noteRows.results || []) as any[]

  const kpiText = kpis.length
    ? kpis.map((k) => `${k.date}: フォロワー${k.x_followers} / imp${k.x_impressions_total} / eng${k.x_engagements_total} / note販売${k.note_paid_sales} / アフィ収益${k.affiliate_revenue}円`).join('\n')
    : '(KPIデータなし)'
  const postText = posts.length
    ? posts.map((p) => `[枠${p.slot_number}|${p.pub_date}] imp${p.impressions} eng${p.engagements}: ${p.body_head}…`).join('\n')
    : '(公開済み投稿の実績データなし — X API未接続のため計測値は未取得)'
  const slotText = slots.length
    ? slots.map((s) => `枠${s.slot_number}: ${s.n}本 / 平均imp${Math.round(s.avg_imp)} / 平均eng${(s.avg_eng || 0).toFixed(1)}`).join('\n')
    : '(枠別データなし)'
  const noteText = notes.length
    ? notes.map((n) => `[${n.type}|${n.pub_date}] ${n.title}: view${n.view_count} 売上${n.sales_count}件/${n.revenue_yen}円`).join('\n')
    : '(公開済みnoteなし)'

  return `## KPI日次推移(直近${days + 1}日)
${kpiText}

## 投稿別実績(直近${days}日・imp上位)
${postText}

## 枠別平均(直近${days}日)
${slotText}

## note実績
${noteText}

※注意: X API未接続の期間は投稿実績・KPIがデモ/ゼロ値の可能性があります。その場合は分析にその前提を明記してください。`
}

// 日次分析(毎日実行)
export async function runRuiDaily(db: D1Database, apiKey: string): Promise<RuiResult> {
  const result: RuiResult = { ok: false, reportType: 'daily', costUsd: 0 }
  try {
    const facts = await collectKpiFacts(db, 3)
    const llm: LlmResult = await callOpenAI(
      apiKey,
      'gpt-5',
      RUI_SYSTEM,
      `以下のデータをもとに【日次分析】を作成してください。\n\n${facts}`,
      12000, // 推論トークン込み
      'medium',
    )
    if (!llm.ok) {
      result.error = `Rui日次分析失敗: ${llm.error}`
      return result
    }
    result.costUsd = llm.costUsd || 0
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    const reportId = `ar-d-${Date.now()}`
    await db
      .prepare(`INSERT INTO analysis_reports (report_id, report_type, report_date, body_md, cost_usd) VALUES (?, 'daily', ?, ?, ?)`)
      .bind(reportId, today, llm.content, result.costUsd)
      .run()
    result.ok = true
    result.reportId = reportId
    result.bodyMd = llm.content
    return result
  } catch (e: any) {
    result.error = e?.message || 'Rui日次実行エラー'
    return result
  }
}

// 週次分析(日曜実行): 7日総括 + 改善提案3つ → Alexの週次計画の入力になる
export async function runRuiWeekly(db: D1Database, apiKey: string): Promise<RuiResult> {
  const result: RuiResult = { ok: false, reportType: 'weekly', costUsd: 0 }
  try {
    const facts = await collectKpiFacts(db, 7)
    const userPrompt = `以下のデータをもとに【週次分析】を作成してください。

${facts}

## 出力形式(必ずこの2部構成)
まずMarkdownで週次分析本文(7日間総括/うまくいったこと・いかなかったこと)を書き、
最後に必ず以下のJSONブロックを出力してください:

\`\`\`json
{"proposals":[{"title":"提案タイトル","reason":"理由","action":"具体的な実行手順","expected":"期待効果"},{...},{...}]}
\`\`\`

提案は必ず3つ。実行可能な具体アクションのみ。`

    const llm: LlmResult = await callOpenAI(apiKey, 'gpt-5', RUI_SYSTEM, userPrompt, 14000, 'medium') // 推論トークン込み
    if (!llm.ok) {
      result.error = `Rui週次分析失敗: ${llm.error}`
      return result
    }
    result.costUsd = llm.costUsd || 0

    // JSONブロック抽出
    let proposals: RuiResult['proposals'] = []
    const jsonMatch = llm.content.match(/```json\s*([\s\S]*?)```/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        if (Array.isArray(parsed.proposals)) proposals = parsed.proposals.slice(0, 3)
      } catch {
        /* 解析失敗時は本文のみ保存 */
      }
    }
    const bodyMd = llm.content.replace(/```json[\s\S]*?```/, '').trim()

    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    const reportId = `ar-w-${Date.now()}`
    await db
      .prepare(
        `INSERT INTO analysis_reports (report_id, report_type, report_date, body_md, proposals_json, cost_usd) VALUES (?, 'weekly', ?, ?, ?, ?)`,
      )
      .bind(reportId, today, bodyMd, JSON.stringify(proposals), result.costUsd)
      .run()
    result.ok = true
    result.reportId = reportId
    result.bodyMd = bodyMd
    result.proposals = proposals
    return result
  } catch (e: any) {
    result.error = e?.message || 'Rui週次実行エラー'
    return result
  }
}
