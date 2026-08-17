// 全自動パイプライン(指示書準拠): Riko収集 → Kai翻訳 → Yuto執筆 → Mio QA → ゲート②(投稿一括承認)
// 取締役の承認は最終ゲート②のみ。途中承認なし。
import { runRikoCrawl } from './riko'
import { translateSource } from './kai'
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

// 枠ごとの型ヒント(Yutoプロンプトに注入)
const SLOT_HINTS: Record<number, string> = {
  1: '冒頭「【海外速報】」で始め、要点3つ+出典URL。数字を1つ以上含める',
  2: '今日発信する内容の予告。期待感を持たせつつ100字以内',
  3: '図解画像を添付する前提の短文。図解の内容を要約する導入文',
  4: '5〜8連スレッド形式。「1/」「2/」の番号付き。各140字以内。最初のツイートにフックを',
  5: '昼休みに読める軽いTips。専門知識ゼロでも答えられる問いかけを含めても良い',
  6: '海外の話題ツイートを引用RTする想定のコメント。100字以内',
  7: '海外の成功/失敗事例を分解。「何が要因か」を僕の視点で',
  8: 'ツール比較。アフィリエイトリンク想定のため文末に #PR を明記',
  9: '読者への質問で終える。専門知識ゼロでも答えられる普遍的な問い',
  10: '一人称の実践報告・失敗談。「試したら〜だった」形式',
  11: 'note記事への誘導。売り込み感を出しすぎない',
  12: '1日の締めの一言。生活感や本音をこぼす',
}

function nextScheduledAt(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const now = new Date()
  const jstNow = new Date(now.getTime() + 9 * 3600 * 1000)
  const target = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + 1, h - 9, m))
  return target.toISOString().replace('T', ' ').slice(0, 19)
}

async function logWorker(db: D1Database, worker: string, action: string, ok: boolean, output: any) {
  await db
    .prepare(`INSERT INTO worker_logs (worker_name, action, status, output_json, finished_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .bind(worker, action, ok ? 'success' : 'failed', JSON.stringify(output))
    .run()
}

export interface PipelineResult {
  ok: boolean
  riko: { collected: number; inserted: number; costUsd: number; errors: string[] }
  kai: { translated: number; costUsd: number; errors: string[] }
  yuto: { postsCreated: number; costUsd: number; errors: string[] }
  mio: { checked: number; ok: number; needsFix: number; ng: number }
  totalCostUsd: number
  error?: string
}

// フルパイプライン実行(朝1回)
export async function runDailyPipeline(db: D1Database, apiKey: string): Promise<PipelineResult> {
  const result: PipelineResult = {
    ok: false,
    riko: { collected: 0, inserted: 0, costUsd: 0, errors: [] },
    kai: { translated: 0, costUsd: 0, errors: [] },
    yuto: { postsCreated: 0, costUsd: 0, errors: [] },
    mio: { checked: 0, ok: 0, needsFix: 0, ng: 0 },
    totalCostUsd: 0,
  }

  // ========== Phase 1: Riko 巡回(10ネタ) ==========
  const riko = await runRikoCrawl(db, apiKey)
  result.riko = { collected: riko.collected, inserted: riko.inserted, costUsd: riko.costUsd, errors: riko.errors.slice(0, 5) }
  await logWorker(db, 'riko', 'auto_crawl', riko.ok, { collected: riko.collected, inserted: riko.inserted, costUsd: riko.costUsd })
  if (!riko.ok || riko.topics.length === 0) {
    result.error = riko.error || 'Riko巡回で新規ネタが得られませんでした'
    // ネタゼロでも既存の翻訳済みネタで続行を試みる余地はあるが、シンプルに終了
    return result
  }

  // ========== Phase 2: Kai 翻訳(上位4ネタ: urgency優先) ==========
  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>
  const topTopics = [...riko.topics].sort((a, b) => (rank[a.urgency] ?? 1) - (rank[b.urgency] ?? 1)).slice(0, 4)
  const translations: { topic: any; markdown: string }[] = []
  for (const topic of topTopics) {
    const tr = await translateSource(apiKey, {
      title_ja: topic.title_ja,
      why_hit: topic.why_hit || '',
      source_url: topic.source_url || '',
      source_summary: topic.source_summary || '',
    })
    if (tr.ok) {
      translations.push({ topic, markdown: tr.content })
      result.kai.translated++
      result.kai.costUsd += tr.costUsd || 0
    } else {
      result.kai.errors.push(`${topic.title_ja}: ${tr.error}`)
    }
  }
  await logWorker(db, 'kai', 'auto_translate', result.kai.translated > 0, { translated: result.kai.translated, costUsd: result.kai.costUsd, errors: result.kai.errors.slice(0, 3) })
  if (translations.length === 0) {
    result.error = 'Kai翻訳が全件失敗しました'
    return result
  }

  // ========== Phase 3: Yuto 執筆(12枠) + Phase 4: Mio QA ==========
  const gl = await db.prepare('SELECT term, annotation FROM glossary LIMIT 30').all()
  const glossaryNote = ((gl.results || []) as any[]).map((g) => `※${g.term}=${g.annotation}`).join('\n')

  for (const slotDef of SLOT_TABLE) {
    const { topic, markdown } = translations[(slotDef.slot - 1) % translations.length]
    const userPrompt = `以下のKai(翻訳担当)の翻訳要約をもとに、「枠${slotDef.slot}: ${slotDef.type}(${slotDef.time}投稿 / ${slotDef.limit})」のX投稿を1本執筆してください。

▓枠の型: ${SLOT_HINTS[slotDef.slot]}

▓ネタ: ${topic.title_ja}
▓Kaiの翻訳要約:
${markdown.slice(0, 2500)}

▓参考: 既存の用語注釈集(同じ固有名詞はこの注釈を使う)
${glossaryNote}`

    const written = await callOpenAI(apiKey, 'gpt-5', YUTO_SYSTEM, userPrompt, 3000)
    if (!written.ok) {
      result.yuto.errors.push(`枠${slotDef.slot}: ${written.error}`)
      continue
    }
    result.yuto.costUsd += written.costUsd || 0

    // Mio QA(キーワードエンジン)。要修正ならYutoが1回だけ自動リライト
    let body = written.content
    let qa = runQaCheck(body, slotDef.slot === 8 || /\bhttps?:\/\//.test(body))
    if (qa.status !== 'ok') {
      const rewrite = await callOpenAI(
        apiKey,
        'gpt-5',
        YUTO_SYSTEM,
        `以下の投稿がQAで指摘を受けました。指摘を解消しつつ同じ内容・枠の型を維持して書き直してください。書き直した本文のみを出力:\n\n▓指摘:\n${qa.issues.map((i) => `- ${i.law}: ${i.matched}(${i.detail})`).join('\n')}\n\n▓元の投稿:\n${body}`,
        3000,
      )
      if (rewrite.ok) {
        result.yuto.costUsd += rewrite.costUsd || 0
        const qa2 = runQaCheck(rewrite.content, slotDef.slot === 8 || /\bhttps?:\/\//.test(rewrite.content))
        if (qa2.status === 'ok' || (qa2.status === 'needs_fix' && qa.status === 'ng')) {
          body = rewrite.content
          qa = qa2
        }
      }
    }
    result.mio.checked++
    if (qa.status === 'ok') result.mio.ok++
    else if (qa.status === 'needs_fix') result.mio.needsFix++
    else result.mio.ng++

    const postId = `p-auto-${Date.now()}-${slotDef.slot}`
    try {
      await db
        .prepare(
          `INSERT INTO x_posts (post_id, topic_id, slot_number, scheduled_at, body, approval_status, qa_status, qa_issues)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .bind(postId, topic.topic_id, slotDef.slot, nextScheduledAt(slotDef.time), body, qa.status, JSON.stringify(qa.issues))
        .run()
      result.yuto.postsCreated++
    } catch (e: any) {
      result.yuto.errors.push(`枠${slotDef.slot}保存失敗: ${e.message}`)
    }
  }

  // 使用したネタは published に(未使用の残りは pending のまま週次企画=ゲート①の材料に)
  for (const { topic } of translations) {
    await db.prepare(`UPDATE topic_candidates SET status = 'published' WHERE topic_id = ?`).bind(topic.topic_id).run()
  }

  await logWorker(db, 'yuto', 'auto_write', result.yuto.postsCreated > 0, { postsCreated: result.yuto.postsCreated, costUsd: result.yuto.costUsd, errors: result.yuto.errors.slice(0, 3) })
  await logWorker(db, 'mio', 'auto_qa', true, result.mio)

  result.totalCostUsd = result.riko.costUsd + result.kai.costUsd + result.yuto.costUsd
  result.ok = result.yuto.postsCreated > 0
  if (!result.ok) result.error = 'Yuto執筆が全件失敗しました'
  return result
}
