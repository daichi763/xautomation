// 自動サイクルオーケストレータ
// 朝サイクル: Riko巡回 → ネタ候補が承認キューに並ぶ
// 夕サイクル: 承認済みネタ → Yuto執筆 → QA → 投稿承認キューに並ぶ
import { runRikoCrawl } from './riko'
import { callOpenAI, YUTO_SYSTEM } from './llm'
import { runQaCheck } from './qa-rules'

// 指示書§05 12枠タイムテーブル
export const SLOT_TABLE: { slot: number; time: string; type: string; limit: string }[] = [
  { slot: 1, time: '06:30', type: '朝のニュース速報', limit: '200字' },
  { slot: 2, time: '07:30', type: '1日の予告', limit: '100字' },
  { slot: 3, time: '09:00', type: 'ノウハウ図解1枚', limit: '100字+画像' },
  { slot: 4, time: '11:00', type: 'バズ狙いスレッド', limit: '各140字×5-8連' },
  { slot: 5, time: '12:15', type: '昼休みTips', limit: '100字' },
  { slot: 6, time: '14:00', type: '引用RT', limit: '100字' },
  { slot: 7, time: '16:00', type: 'ケーススタディ分解', limit: '200字orスレッド' },
  { slot: 8, time: '18:00', type: 'ツール比較・アフィ', limit: '200字' },
  { slot: 9, time: '19:30', type: '質問投げかけ', limit: '100字' },
  { slot: 10, time: '21:00', type: '実践報告・失敗談', limit: '200字' },
  { slot: 11, time: '22:30', type: 'note告知', limit: '100字' },
  { slot: 12, time: '23:30', type: '深夜の一言', limit: '100字' },
]

// 1回の夕サイクルで自動生成する枠(コスト管理のため主要6枠に絞る。残りは手動 or 将来拡張)
const AUTO_SLOTS = [1, 3, 5, 8, 9, 10]

export interface YutoAutoResult {
  ok: boolean
  topicsUsed: number
  postsCreated: number
  posts: { post_id: string; slot: number; qa_status: string }[]
  costUsd: number
  errors: string[]
}

function nextScheduledAt(time: string): string {
  // 翌日のJST時刻をUTC DATETIMEで返す(JST = UTC+9)
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const jstNow = new Date(now.getTime() + 9 * 3600 * 1000)
  const target = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + 1, h - 9, m))
  return target.toISOString().replace('T', ' ').slice(0, 19)
}

export async function runYutoAutoWrite(db: D1Database, apiKey: string, maxTopics = 3): Promise<YutoAutoResult> {
  const errors: string[] = []
  const posts: { post_id: string; slot: number; qa_status: string }[] = []
  let costUsd = 0

  // 1. 承認済みネタを取得
  const topicRows = await db
    .prepare(`SELECT * FROM topic_candidates WHERE status = 'approved' ORDER BY urgency = 'high' DESC, created_at ASC LIMIT ?`)
    .bind(maxTopics)
    .all()
  const topics = (topicRows.results || []) as any[]
  if (topics.length === 0) {
    return { ok: true, topicsUsed: 0, postsCreated: 0, posts: [], costUsd: 0, errors: ['承認済みネタがありません(承認ゲート1で承認してください)'] }
  }

  // 2. 用語集注入
  const gl = await db.prepare('SELECT term, annotation FROM glossary LIMIT 30').all()
  const glossaryNote = ((gl.results || []) as any[]).map((g) => `※${g.term}=${g.annotation}`).join('\n')

  // 3. ネタ×枠の割り当て(ネタをローテーションして6枠分生成)
  const tasks: { topic: any; slotDef: (typeof SLOT_TABLE)[0] }[] = []
  AUTO_SLOTS.forEach((slotNum, i) => {
    const topic = topics[i % topics.length]
    const slotDef = SLOT_TABLE.find((s) => s.slot === slotNum)!
    tasks.push({ topic, slotDef })
  })

  // 4. 順次執筆(並列だとレート制限リスクがあるため直列)
  for (const { topic, slotDef } of tasks) {
    let sourceUrl = ''
    try { sourceUrl = JSON.parse(topic.source_urls || '[]')[0] || '' } catch {}
    const userPrompt = `以下のネタで「枠${slotDef.slot}: ${slotDef.type}(${slotDef.time}投稿 / ${slotDef.limit})」のX投稿を1本執筆してください。

ネタ: ${topic.title_ja}
狙い: ${topic.why_hit || ''}
訴求軸: ${topic.appeal_axis || ''}
出典URL: ${sourceUrl}

枠の型に忠実に。枠1なら「【海外速報】」で始め要点3つ+出典。枠3なら図解前提の短文。枠8ならツール比較でアフィリエイト想定(#PR明記)。枠9なら読者への問いかけで終える。枠10なら一人称の実践報告調。

▓参考: 既存の用語注釈集(同じ固有名詞はこの注釈を使う)
${glossaryNote}`

    const result = await callOpenAI(apiKey, 'gpt-5', YUTO_SYSTEM, userPrompt, 3000)
    if (!result.ok) {
      errors.push(`枠${slotDef.slot}執筆失敗: ${result.error}`)
      continue
    }
    costUsd += result.costUsd || 0

    const qa = runQaCheck(result.content, slotDef.slot === 8 || /\bhttps?:\/\//.test(result.content))
    const postId = `p-auto-${Date.now()}-${slotDef.slot}`
    try {
      await db
        .prepare(
          `INSERT INTO x_posts (post_id, topic_id, slot_number, scheduled_at, body, approval_status, qa_status, qa_issues)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .bind(postId, topic.topic_id, slotDef.slot, nextScheduledAt(slotDef.time), result.content, qa.status, JSON.stringify(qa.issues))
        .run()
      posts.push({ post_id: postId, slot: slotDef.slot, qa_status: qa.status })
    } catch (e: any) {
      errors.push(`枠${slotDef.slot}保存失敗: ${e.message}`)
    }
  }

  // 5. 使用したネタをpublishedに更新(再利用防止。実際のX投稿は承認ゲート経由)
  for (const topic of topics) {
    await db.prepare(`UPDATE topic_candidates SET status = 'published' WHERE topic_id = ?`).bind(topic.topic_id).run()
  }

  return { ok: true, topicsUsed: topics.length, postsCreated: posts.length, posts, costUsd, errors }
}

// ============ サイクル全体 ============
export type CronCycle = 'morning' | 'evening' | 'auto'

export function resolveCycle(cycle: string | undefined): CronCycle {
  if (cycle === 'morning' || cycle === 'evening') return cycle
  // auto: JST時刻で判定(0-12時=morning / 12-24時=evening)
  const jstHour = (new Date().getUTCHours() + 9) % 24
  return jstHour < 12 ? 'morning' : 'evening'
}

export async function runCronCycle(
  db: D1Database,
  apiKey: string,
  cycle: CronCycle,
): Promise<{ cycle: CronCycle; riko?: any; yuto?: any }> {
  const resolved: CronCycle = cycle === 'auto' ? resolveCycle(undefined) : cycle
  const out: { cycle: CronCycle; riko?: any; yuto?: any } = { cycle: resolved }

  if (resolved === 'morning') {
    const started = Date.now()
    const riko = await runRikoCrawl(db, apiKey)
    out.riko = riko
    await db
      .prepare(
        `INSERT INTO worker_logs (worker_name, action, status, output_json, finished_at) VALUES ('riko', 'auto_crawl', ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        riko.ok ? 'success' : 'failed',
        JSON.stringify({ collected: riko.collected, inserted: riko.inserted, costUsd: riko.costUsd, ms: Date.now() - started, errors: riko.errors.slice(0, 5), error: riko.error }),
      )
      .run()
  } else {
    const started = Date.now()
    const yuto = await runYutoAutoWrite(db, apiKey)
    out.yuto = yuto
    await db
      .prepare(
        `INSERT INTO worker_logs (worker_name, action, status, output_json, finished_at) VALUES ('yuto', 'auto_write', ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        yuto.ok ? 'success' : 'failed',
        JSON.stringify({ topicsUsed: yuto.topicsUsed, postsCreated: yuto.postsCreated, costUsd: yuto.costUsd, ms: Date.now() - started, errors: yuto.errors.slice(0, 5) }),
      )
      .run()
  }
  return out
}
