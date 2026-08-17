/* Virtual Office SPA */
const $app = document.getElementById('app');
let currentView = 'office';
let officeTimer = null;
let kpiChart = null;

const STATUS_JA = { idle: '待機中', working: '作業中', error: 'エラー' };
const STATUS_CLS = {
  idle: 'bg-white',
  working: 'bg-blue-50 border-blue-300 desk-working',
  error: 'bg-red-50 border-red-300 desk-error'
};
const DOT_CLS = { idle: 'bg-gray-300', working: 'bg-blue-500', error: 'bg-red-500' };
const GATE_JA = { weekly_planning: '週次企画', daily_posts: '日次投稿', paid_note: '有料note' };
const SLOT_NAMES = ['', '朝のニュース速報', '1日の予告', 'ノウハウ図解', 'バズ狙いスレッド', '昼休みTips', '引用RT', 'ケーススタディ分解', 'ツール比較・アフィ', '質問投げかけ', '実践報告・失敗談', 'note告知', '深夜の一言'];
const SLOT_TIMES = ['', '06:30', '07:30', '09:00', '11:00', '12:15', '14:00', '16:00', '18:00', '19:30', '21:00', '22:30', '23:30'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `fade-in px-4 py-3 rounded-lg shadow-lg text-white text-sm ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`;
  el.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check' : 'fa-triangle-exclamation'} mr-2"></i>${esc(msg)}`;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function setNav(view) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

async function updateApprovalBadge() {
  try {
    const { data } = await axios.get('/api/office');
    const total = (data.pending_approvals || []).reduce((s, r) => s + r.cnt, 0);
    const badge = document.getElementById('approval-badge');
    if (total > 0) { badge.textContent = total; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch (e) { /* noop */ }
}

/* ============ オフィスビュー ============ */
async function renderOffice() {
  const { data } = await axios.get('/api/office');
  const { workers, tasks, kpi_today, kpi_yesterday, pending_approvals, recent_logs } = data;

  const followerDelta = kpi_today && kpi_yesterday ? kpi_today.x_followers - kpi_yesterday.x_followers : 0;
  const revenueToday = kpi_today ? (kpi_today.note_paid_sales || 0) + (kpi_today.affiliate_revenue || 0) : 0;

  const pendingTotal = (pending_approvals || []).reduce((s, r) => s + r.cnt, 0);

  $app.innerHTML = `
  <div class="fade-in space-y-6">
    ${pendingTotal > 0 ? `
    <section id="approval-alert" class="bg-orange-50 border border-orange-300 rounded-xl p-4 flex items-center justify-between flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <i class="fas fa-bell text-brand-orange text-xl"></i>
        <div>
          <p class="font-bold text-brand-navy">承認待ちが ${pendingTotal} 件あります</p>
          <p class="text-xs text-slate-500">${(pending_approvals || []).map((r) => `${GATE_JA[r.gate_type] || r.gate_type}: ${r.cnt}件`).join(' / ')}</p>
        </div>
      </div>
      <button onclick="navigate('approve')" class="bg-brand-orange text-white px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90">承認画面へ</button>
    </section>` : ''}

    <section id="office-floor">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-bold text-lg text-brand-navy"><i class="fas fa-building mr-2"></i>オフィスフロア</h2>
        <button id="sim-btn" class="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-lg hover:opacity-90"><i class="fas fa-rotate mr-1"></i>時間を進める(デモ)</button>
      </div>
      <div class="bg-gradient-to-br from-slate-200 to-slate-300 rounded-2xl p-5">
        <!-- 取締役デスク(上座) -->
        <div class="flex justify-center mb-5">
          <article class="bg-brand-navy text-white rounded-xl px-8 py-4 shadow-lg text-center border-2 border-brand-orange">
            <div class="text-3xl">🪑</div>
            <div class="font-bold">取締役(あなた)</div>
            <div class="text-xs text-slate-300">承認のみ担当 — 平日6分/日</div>
          </article>
        </div>
        <!-- 9ワーカー -->
        <div id="worker-grid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          ${workers.map((w) => `
          <article class="worker-desk cursor-pointer rounded-xl border-2 p-3 shadow transition hover:scale-[1.03] ${STATUS_CLS[w.status] || 'bg-white'}" data-worker="${esc(w.worker_name)}">
            <div class="flex items-start justify-between">
              <span class="text-3xl">${w.icon}</span>
              <span class="status-dot ${DOT_CLS[w.status] || 'bg-gray-300'}"></span>
            </div>
            <div class="font-bold mt-1">${esc(w.display_name)}</div>
            <div class="text-[11px] text-slate-500">${esc(w.role)}</div>
            <div class="text-xs mt-2 text-slate-700 leading-snug min-h-[2rem]">${esc(w.current_task)}</div>
            <div class="text-[10px] mt-1 font-bold ${w.status === 'working' ? 'text-blue-600' : w.status === 'error' ? 'text-red-600' : 'text-slate-400'}">${STATUS_JA[w.status] || w.status}</div>
          </article>`).join('')}
        </div>
      </div>
    </section>

    <div class="grid md:grid-cols-3 gap-4">
      <section id="kpi-summary" class="bg-white rounded-xl shadow p-4">
        <h3 class="font-bold text-brand-navy mb-3"><i class="fas fa-gauge mr-2"></i>本日のKPI</h3>
        ${kpi_today ? `
        <ul class="space-y-2 text-sm">
          <li class="flex justify-between"><span>Xフォロワー</span><span class="font-bold">${kpi_today.x_followers.toLocaleString()} <span class="${followerDelta >= 0 ? 'text-emerald-600' : 'text-red-500'} text-xs">(${followerDelta >= 0 ? '+' : ''}${followerDelta})</span></span></li>
          <li class="flex justify-between"><span>インプレッション</span><span class="font-bold">${(kpi_today.x_impressions_total || 0).toLocaleString()}</span></li>
          <li class="flex justify-between"><span>本日売上</span><span class="font-bold text-brand-orange">¥${revenueToday.toLocaleString()}</span></li>
          <li class="flex justify-between"><span>メンバーシップ</span><span class="font-bold">${kpi_today.membership_count}人(¥${(kpi_today.membership_revenue || 0).toLocaleString()}/月)</span></li>
        </ul>` : '<p class="text-sm text-slate-400">データなし</p>'}
        <button onclick="navigate('kpi')" class="mt-3 text-xs text-brand-navy underline">詳細グラフを見る →</button>
      </section>

      <section id="task-board" class="bg-white rounded-xl shadow p-4">
        <h3 class="font-bold text-brand-navy mb-3"><i class="fas fa-list-check mr-2"></i>タスクボード</h3>
        <ul class="space-y-2 text-xs max-h-52 overflow-y-auto">
          ${tasks.length ? tasks.map((t) => `
          <li class="flex items-center gap-2 border-b border-slate-100 pb-1.5">
            <span class="px-1.5 py-0.5 rounded font-bold ${t.status === 'processing' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}">${t.status === 'processing' ? '処理中' : '待機'}</span>
            <span class="font-bold text-brand-navy">${esc(t.worker_name)}</span>
            <span class="text-slate-600 truncate">${esc(t.task_type)}</span>
          </li>`).join('') : '<li class="text-slate-400">キューは空です</li>'}
        </ul>
      </section>

      <section id="activity-log" class="bg-white rounded-xl shadow p-4">
        <h3 class="font-bold text-brand-navy mb-3"><i class="fas fa-clock-rotate-left mr-2"></i>直近のアクティビティ</h3>
        <ul class="space-y-2 text-xs max-h-52 overflow-y-auto">
          ${recent_logs.map((l) => `
          <li class="flex items-start gap-2 border-b border-slate-100 pb-1.5">
            <i class="fas ${l.status === 'success' ? 'fa-circle-check text-emerald-500' : l.status === 'running' ? 'fa-spinner text-blue-500' : 'fa-circle-xmark text-red-500'} mt-0.5"></i>
            <div><span class="font-bold text-brand-navy">${esc(l.worker_name)}</span> <span class="text-slate-600">${esc(l.action)}</span></div>
          </li>`).join('')}
        </ul>
      </section>
    </div>
  </div>`;

  document.querySelectorAll('.worker-desk').forEach((el) => {
    el.addEventListener('click', () => openWorkerModal(el.dataset.worker));
  });
  document.getElementById('sim-btn')?.addEventListener('click', async () => {
    await axios.post('/api/simulate/tick');
    toast('ワーカーの状態を更新しました');
    if (currentView === 'office') renderOffice();
  });
}

async function openWorkerModal(name) {
  const { data } = await axios.get(`/api/workers/${name}`);
  const { worker, logs } = data;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onclick="if(event.target===this)this.parentNode.innerHTML=''">
    <div class="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl fade-in">
      <div class="bg-brand-navy text-white p-4 rounded-t-2xl flex items-center gap-3 sticky top-0">
        <span class="text-4xl">${worker.icon}</span>
        <div class="flex-1">
          <div class="font-bold text-lg">${esc(worker.display_name)}</div>
          <div class="text-xs text-slate-300">${esc(worker.role)}</div>
        </div>
        <button onclick="document.getElementById('modal-root').innerHTML=''" class="text-white/70 hover:text-white text-xl"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="p-4 space-y-3">
        <div class="bg-slate-50 rounded-lg p-3 text-sm">
          <span class="status-dot ${DOT_CLS[worker.status]} mr-2"></span>
          <span class="font-bold">${STATUS_JA[worker.status]}</span> — ${esc(worker.current_task)}
        </div>
        <h4 class="font-bold text-sm text-brand-navy">実行ログ</h4>
        <ul class="space-y-2 text-xs">
          ${logs.length ? logs.map((l) => `
          <li class="border border-slate-200 rounded-lg p-2">
            <div class="flex items-center gap-2">
              <i class="fas ${l.status === 'success' ? 'fa-circle-check text-emerald-500' : l.status === 'running' ? 'fa-spinner fa-spin text-blue-500' : 'fa-circle-xmark text-red-500'}"></i>
              <span class="font-bold">${esc(l.action)}</span>
            </div>
            <div class="text-slate-400 mt-1">${esc(l.started_at)}${l.output_json ? ' / ' + esc(l.output_json) : ''}</div>
          </li>`).join('') : '<li class="text-slate-400">ログはまだありません</li>'}
        </ul>
      </div>
    </div>
  </div>`;
}

/* ============ 承認ビュー ============ */
async function renderApprove() {
  const [postsRes, topicsRes, notesRes] = await Promise.all([
    axios.get('/api/posts?status=pending'),
    axios.get('/api/topics?status=pending'),
    axios.get('/api/notes')
  ]);
  const posts = postsRes.data.posts;
  const topics = topicsRes.data.topics;
  const notes = notesRes.data.articles.filter((a) => a.approval_status === 'pending');

  $app.innerHTML = `
  <div class="fade-in space-y-8">
    <section id="gate-daily">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 class="font-bold text-lg text-brand-navy"><i class="fas fa-calendar-day mr-2"></i>ゲート② 明日のX投稿承認(${posts.length}本)</h2>
        ${posts.length ? `<button id="approve-all-btn" class="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"><i class="fas fa-check-double mr-1"></i>QA通過分を一括承認</button>` : ''}
      </div>
      ${posts.length ? `<div class="grid md:grid-cols-2 gap-3">${posts.map(postCard).join('')}</div>`
        : '<p class="bg-white rounded-xl p-6 text-center text-slate-400 text-sm">承認待ちの投稿はありません 🎉</p>'}
    </section>

    <section id="gate-weekly">
      <h2 class="font-bold text-lg text-brand-navy mb-3"><i class="fas fa-lightbulb mr-2"></i>ゲート① 週次企画の選定(${topics.length}案)</h2>
      ${topics.length ? `<div class="grid md:grid-cols-2 gap-3">${topics.map(topicCard).join('')}</div>`
        : '<p class="bg-white rounded-xl p-6 text-center text-slate-400 text-sm">選定待ちの企画はありません</p>'}
    </section>

    <section id="gate-note">
      <h2 class="font-bold text-lg text-brand-navy mb-3"><i class="fas fa-file-lines mr-2"></i>ゲート③ 有料note公開承認(${notes.length}本)</h2>
      ${notes.length ? notes.map(noteCard).join('')
        : '<p class="bg-white rounded-xl p-6 text-center text-slate-400 text-sm">公開待ちのnote記事はありません</p>'}
    </section>
  </div>`;

  document.getElementById('approve-all-btn')?.addEventListener('click', async () => {
    const { data } = await axios.post('/api/posts/approve-all');
    toast(`${data.approved}本を承認しました${data.skipped ? `(QA未通過 ${data.skipped}本は保留)` : ''}`);
    renderApprove(); updateApprovalBadge();
  });
  bindDecisionButtons();
}

function qaBadge(qa_status, qa_issues) {
  if (qa_status === 'ok') return '<span class="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold"><i class="fas fa-shield-halved mr-1"></i>QA通過</span>';
  if (qa_status === 'needs_fix') return '<span class="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold"><i class="fas fa-triangle-exclamation mr-1"></i>要修正</span>';
  if (qa_status === 'ng') return '<span class="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">NG</span>';
  return '<span class="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">QA待ち</span>';
}

function postCard(p) {
  let issues = [];
  try { issues = JSON.parse(p.qa_issues || '[]'); } catch (e) {}
  const isAffiliateSlot = p.slot_number === 8 || (p.body || '').includes('#PR');
  return `
  <article class="post-card bg-white rounded-xl shadow p-4 flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-xs font-bold text-brand-navy bg-slate-100 px-2 py-1 rounded">枠${p.slot_number} ${SLOT_TIMES[p.slot_number]} ${esc(SLOT_NAMES[p.slot_number])}</span>
      ${qaBadge(p.qa_status, p.qa_issues)}
    </div>
    <p class="text-sm whitespace-pre-wrap leading-relaxed flex-1">${esc(p.body)}</p>
    ${issues.length ? `<div class="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">${issues.map((i) => `<div><b>[${esc(i.rule)}]</b> ${esc(i.detail)}</div>`).join('')}</div>` : ''}
    ${isAffiliateSlot ? `<button class="embed-affiliate-btn w-full bg-brand-orange/10 text-brand-orange border border-brand-orange/40 py-1.5 rounded-lg text-xs font-bold hover:bg-brand-orange/20" data-id="${esc(p.post_id)}"><i class="fas fa-link mr-1"></i>アフィリンクを自動埋め込み</button>` : ''}
    <div class="flex gap-2 pt-1">
      <button class="decision-btn flex-1 bg-emerald-600 text-white py-1.5 rounded-lg text-xs font-bold hover:opacity-90" data-kind="post" data-id="${esc(p.post_id)}" data-decision="approved"><i class="fas fa-check mr-1"></i>承認</button>
      <button class="decision-btn flex-1 bg-slate-200 text-slate-700 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-300" data-kind="post" data-id="${esc(p.post_id)}" data-decision="rejected"><i class="fas fa-rotate-left mr-1"></i>差戻</button>
    </div>
  </article>`;
}

function topicCard(t) {
  let axes = [];
  try { axes = JSON.parse(t.appeal_axis || '[]'); } catch (e) {}
  const mediumJa = { x_single: 'X単発', x_thread: 'Xスレッド', note_free: 'note無料', note_paid: 'note有料' };
  return `
  <article class="topic-card bg-white rounded-xl shadow p-4 flex flex-col gap-2">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${t.urgency === 'high' ? 'bg-red-100 text-red-700' : t.urgency === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}">${t.urgency}</span>
      <span class="text-[10px] bg-brand-navy text-white px-2 py-0.5 rounded-full">${mediumJa[t.target_medium] || t.target_medium}</span>
      ${axes.map((a) => `<span class="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">${esc(a)}</span>`).join('')}
    </div>
    <h3 class="font-bold text-sm">${esc(t.title_ja)}</h3>
    <p class="text-xs text-slate-500 flex-1"><i class="fas fa-bullseye mr-1"></i>${esc(t.why_hit)}</p>
    <div class="flex gap-2 pt-1">
      <button class="decision-btn flex-1 bg-emerald-600 text-white py-1.5 rounded-lg text-xs font-bold hover:opacity-90" data-kind="topic" data-id="${esc(t.topic_id)}" data-decision="approved"><i class="fas fa-check mr-1"></i>採用</button>
      <button class="decision-btn flex-1 bg-slate-200 text-slate-700 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-300" data-kind="topic" data-id="${esc(t.topic_id)}" data-decision="rejected"><i class="fas fa-xmark mr-1"></i>見送り</button>
    </div>
  </article>`;
}

function noteCard(n) {
  const typeJa = { free: '無料', paid_single: `有料 ¥${n.price_yen}`, monthly_summary: `月次まとめ ¥${n.price_yen}`, membership: 'メンバーシップ' };
  return `
  <article class="note-card bg-white rounded-xl shadow p-4 mb-3">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[10px] bg-brand-orange text-white px-2 py-0.5 rounded-full font-bold">${typeJa[n.type] || n.type}</span>
          ${qaBadge(n.qa_status, null)}
        </div>
        <h3 class="font-bold">${esc(n.title)}</h3>
      </div>
      <div class="flex gap-2">
        <button class="note-preview-btn bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-300" data-id="${esc(n.article_id)}"><i class="fas fa-eye mr-1"></i>全文プレビュー</button>
        <button class="note-publish-btn bg-brand-orange text-white px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90" data-id="${esc(n.article_id)}"><i class="fas fa-paper-plane mr-1"></i>公開する</button>
      </div>
    </div>
  </article>`;
}

function bindDecisionButtons() {
  document.querySelectorAll('.embed-affiliate-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { data } = await axios.post(`/api/posts/${btn.dataset.id}/embed-affiliate`);
      if (data.ok) {
        toast(`${data.result.detected.map((d) => d.tool_name).join('・')} のリンクを埋め込みました${data.result.pr_added ? '(PR表記も自動追加)' : ''}`);
        renderApprove();
      } else {
        toast(data.message || '埋め込み対象が見つかりませんでした', 'error');
        btn.disabled = false;
      }
    });
  });
  document.querySelectorAll('.decision-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { kind, id, decision } = btn.dataset;
      let reason;
      if (decision === 'rejected' && kind === 'post') {
        reason = prompt('差戻理由(Yutoに伝わります):') || undefined;
      }
      const url = kind === 'post' ? `/api/posts/${id}/decision` : `/api/topics/${id}/decision`;
      await axios.post(url, { decision, reason });
      toast(decision === 'approved' ? '承認しました' : '差戻しました');
      renderApprove(); updateApprovalBadge();
    });
  });
  document.querySelectorAll('.note-preview-btn').forEach((btn) => {
    btn.addEventListener('click', () => openNotePreview(btn.dataset.id));
  });
  document.querySelectorAll('.note-publish-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('この記事を公開しますか?')) return;
      try {
        await axios.post(`/api/notes/${btn.dataset.id}/publish`);
        toast('公開処理をキューに投入しました');
        renderApprove(); updateApprovalBadge();
      } catch (e) {
        toast(e.response?.data?.error || '公開に失敗しました', 'error');
      }
    });
  });
}

async function openNotePreview(id) {
  const { data } = await axios.get(`/api/notes/${id}`);
  const a = data.article;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onclick="if(event.target===this)this.parentNode.innerHTML=''">
    <div class="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl fade-in">
      <div class="bg-brand-navy text-white p-4 rounded-t-2xl flex items-center justify-between sticky top-0">
        <h3 class="font-bold">${esc(a.title)}</h3>
        <button onclick="document.getElementById('modal-root').innerHTML=''" class="text-white/70 hover:text-white text-xl"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="p-5">
        <div class="text-xs text-slate-400 mb-3">種別: ${esc(a.type)} / 価格: ¥${a.price_yen} ${a.paywall_position ? `/ 有料化ライン: ${a.paywall_position}行目` : ''}</div>
        <pre class="whitespace-pre-wrap text-sm leading-relaxed font-sans">${esc(a.body_md)}</pre>
      </div>
    </div>
  </div>`;
}

/* ============ KPIビュー ============ */
async function renderKPI() {
  const { data } = await axios.get('/api/kpi?days=14');
  const { history, summary } = data;

  $app.innerHTML = `
  <div class="fade-in space-y-6">
    <h2 class="font-bold text-lg text-brand-navy"><i class="fas fa-chart-line mr-2"></i>KPIダッシュボード(直近14日)</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${summary ? `
      <div class="bg-white rounded-xl shadow p-4"><div class="text-xs text-slate-400">フォロワー増(前日比)</div><div class="text-2xl font-bold ${summary.followers_delta >= 0 ? 'text-emerald-600' : 'text-red-500'}">${summary.followers_delta >= 0 ? '+' : ''}${summary.followers_delta}</div></div>
      <div class="bg-white rounded-xl shadow p-4"><div class="text-xs text-slate-400">本日売上</div><div class="text-2xl font-bold text-brand-orange">¥${summary.revenue_today.toLocaleString()}</div></div>
      <div class="bg-white rounded-xl shadow p-4"><div class="text-xs text-slate-400">期間累計売上</div><div class="text-2xl font-bold text-brand-navy">¥${summary.revenue_total.toLocaleString()}</div></div>
      <div class="bg-white rounded-xl shadow p-4"><div class="text-xs text-slate-400">メンバーシップ</div><div class="text-2xl font-bold text-brand-navy">${history[history.length-1]?.membership_count ?? 0}人</div></div>
      ` : ''}
    </div>
    <div class="bg-white rounded-xl shadow p-4">
      <h3 class="font-bold text-sm text-brand-navy mb-3">Xフォロワー / 売上の推移</h3>
      <canvas id="kpi-chart" height="110"></canvas>
    </div>
    <div class="bg-white rounded-xl shadow p-4 overflow-x-auto">
      <h3 class="font-bold text-sm text-brand-navy mb-3">日次明細</h3>
      <table class="w-full text-xs">
        <thead><tr class="text-left text-slate-400 border-b">
          <th class="py-2 pr-3">日付</th><th class="py-2 pr-3">フォロワー</th><th class="py-2 pr-3">インプ</th><th class="py-2 pr-3">エンゲージ</th><th class="py-2 pr-3">note売上</th><th class="py-2 pr-3">サブスク</th><th class="py-2">アフィ</th>
        </tr></thead>
        <tbody>
          ${[...history].reverse().map((r) => `
          <tr class="border-b border-slate-50">
            <td class="py-1.5 pr-3">${r.date}</td>
            <td class="py-1.5 pr-3 font-bold">${r.x_followers.toLocaleString()}</td>
            <td class="py-1.5 pr-3">${(r.x_impressions_total || 0).toLocaleString()}</td>
            <td class="py-1.5 pr-3">${(r.x_engagements_total || 0).toLocaleString()}</td>
            <td class="py-1.5 pr-3">¥${(r.note_paid_sales || 0).toLocaleString()}</td>
            <td class="py-1.5 pr-3">¥${(r.membership_revenue || 0).toLocaleString()}</td>
            <td class="py-1.5">¥${(r.affiliate_revenue || 0).toLocaleString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;

  if (kpiChart) { kpiChart.destroy(); kpiChart = null; }
  const ctx = document.getElementById('kpi-chart');
  kpiChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map((r) => r.date.slice(5)),
      datasets: [
        { label: 'Xフォロワー', data: history.map((r) => r.x_followers), borderColor: '#1E3A5F', backgroundColor: 'rgba(30,58,95,0.08)', fill: true, tension: 0.3, yAxisID: 'y' },
        { label: '日次売上(¥)', data: history.map((r) => (r.note_paid_sales || 0) + (r.affiliate_revenue || 0)), borderColor: '#FF7A45', backgroundColor: 'rgba(255,122,69,0.08)', fill: true, tension: 0.3, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { position: 'left', title: { display: true, text: 'フォロワー' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '売上(¥)' } }
      }
    }
  });
}

/* ============ QAチェックビュー ============ */
async function renderQA() {
  $app.innerHTML = `
  <div class="fade-in max-w-3xl mx-auto space-y-5">
    <h2 class="font-bold text-lg text-brand-navy"><i class="fas fa-shield-halved mr-2"></i>QAチェッカー(Mio)</h2>
    <p class="text-sm text-slate-500">投稿予定の本文を貼り付けると、Mioが禁止表現・法令リスク(薬機法/景表法/金商法/ステマ規制)をチェックします。</p>
    <section id="qa-form" class="bg-white rounded-xl shadow p-4 space-y-3">
      <textarea id="qa-text" rows="6" class="w-full border border-slate-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange" placeholder="例: この方法なら誰でも簡単に稼げる!絶対おすすめです!"></textarea>
      <label class="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" id="qa-affiliate" class="rounded">
        アフィリエイトリンクを含む投稿
      </label>
      <button id="qa-check-btn" class="bg-brand-navy text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:opacity-90"><i class="fas fa-magnifying-glass mr-1"></i>チェック実行</button>
    </section>
    <section id="qa-result"></section>
  </div>`;

  document.getElementById('qa-check-btn').addEventListener('click', async () => {
    const text = document.getElementById('qa-text').value.trim();
    if (!text) { toast('本文を入力してください', 'error'); return; }
    const { data } = await axios.post('/api/qa/check', { text, has_affiliate: document.getElementById('qa-affiliate').checked });
    const box = document.getElementById('qa-result');
    if (data.status === 'ok') {
      box.innerHTML = `<div class="fade-in bg-emerald-50 border border-emerald-300 rounded-xl p-5 text-center">
        <i class="fas fa-circle-check text-emerald-500 text-3xl mb-2"></i>
        <p class="font-bold text-emerald-700">判定: OK — 問題は検出されませんでした</p></div>`;
    } else {
      box.innerHTML = `<div class="fade-in ${data.status === 'ng' ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'} border rounded-xl p-5">
        <p class="font-bold ${data.status === 'ng' ? 'text-red-700' : 'text-amber-700'} mb-3">
          <i class="fas fa-triangle-exclamation mr-1"></i>判定: ${data.status === 'ng' ? 'NG(公開停止)' : '要修正'} — ${data.issues.length}件の指摘
        </p>
        <ul class="space-y-2">
          ${data.issues.map((i) => `
          <li class="bg-white rounded-lg p-3 text-sm">
            <div class="font-bold text-brand-navy">[${esc(i.rule)}] 検出語: 「${esc(i.matched)}」</div>
            <div class="text-xs text-slate-500 mt-1">根拠: ${esc(i.law)}</div>
            <div class="text-xs text-slate-700 mt-1">${esc(i.detail)}</div>
          </li>`).join('')}
        </ul>
      </div>`;
    }
  });
}

/* ============ アフィリンク管理ビュー ============ */
async function renderAffiliate() {
  const [linksRes, glossaryRes] = await Promise.all([
    axios.get('/api/affiliate/links'),
    axios.get('/api/glossary')
  ]);
  const links = linksRes.data.links;
  const glossary = glossaryRes.data.glossary;

  $app.innerHTML = `
  <div class="fade-in max-w-4xl mx-auto space-y-6">
    <h2 class="font-bold text-lg text-brand-navy"><i class="fas fa-link mr-2"></i>アフィリエイトリンク管理</h2>
    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-slate-700">
      <p class="font-bold text-brand-navy mb-1"><i class="fas fa-circle-info mr-1"></i>仕組み</p>
      <p>ASP(A8.net等)への提携申請は規約上、人間の操作が必要です。<b>提携承認後にここへ1回登録</b>すれば、以後は投稿文からツール名を自動検出し、リンク+PR表記を自動で埋め込みます(承認画面のボタン、または本番ではYutoが執筆時に自動実行)。</p>
    </div>

    <section id="affiliate-register" class="bg-white rounded-xl shadow p-4 space-y-3">
      <h3 class="font-bold text-sm text-brand-navy">新規リンク登録</h3>
      <div class="grid sm:grid-cols-2 gap-3">
        <input id="af-tool" class="border border-slate-300 rounded-lg p-2 text-sm" placeholder="ツール名(例: ElevenLabs)">
        <input id="af-aliases" class="border border-slate-300 rounded-lg p-2 text-sm" placeholder="検出ワード カンマ区切り(例: イレブンラボ,elevenlabs)">
        <input id="af-url" class="border border-slate-300 rounded-lg p-2 text-sm sm:col-span-2" placeholder="アフィリエイトURL(提携承認後に発行されたもの)">
        <input id="af-program" class="border border-slate-300 rounded-lg p-2 text-sm" placeholder="ASP名(例: A8.net)">
        <input id="af-note" class="border border-slate-300 rounded-lg p-2 text-sm" placeholder="メモ(報酬率など)">
      </div>
      <button id="af-add-btn" class="bg-brand-navy text-white px-5 py-2 rounded-lg text-sm font-bold hover:opacity-90"><i class="fas fa-plus mr-1"></i>登録</button>
    </section>

    <section id="affiliate-list" class="bg-white rounded-xl shadow p-4">
      <h3 class="font-bold text-sm text-brand-navy mb-3">登録済みリンク(${links.length}件)</h3>
      <div class="space-y-2">
        ${links.length ? links.map((l) => `
        <div class="border border-slate-200 rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-bold text-sm">${esc(l.tool_name)}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${l.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${l.status === 'active' ? '自動埋め込み中' : '停止中'}</span>
              ${l.program ? `<span class="text-[10px] text-slate-400">${esc(l.program)}</span>` : ''}
            </div>
            <div class="text-xs text-slate-500 truncate max-w-md">${esc(l.affiliate_url)}</div>
            ${l.note ? `<div class="text-[11px] text-amber-600">${esc(l.note)}</div>` : ''}
          </div>
          <div class="flex gap-2">
            <button class="af-toggle-btn text-xs bg-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-300" data-id="${esc(l.link_id)}">${l.status === 'active' ? '停止' : '再開'}</button>
            <button class="af-delete-btn text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-200" data-id="${esc(l.link_id)}">削除</button>
          </div>
        </div>`).join('') : '<p class="text-sm text-slate-400">まだ登録がありません</p>'}
      </div>
    </section>

    <section id="embed-tester" class="bg-white rounded-xl shadow p-4 space-y-3">
      <h3 class="font-bold text-sm text-brand-navy">埋め込みテスター</h3>
      <p class="text-xs text-slate-500">投稿文を貼ると、検出されるリンクと埋め込み後の本文をプレビューできます。</p>
      <textarea id="embed-text" rows="4" class="w-full border border-slate-300 rounded-lg p-3 text-sm" placeholder="例: AIナレーションならElevenLabsが自然な印象です。動画編集はCapCutで十分でした。"></textarea>
      <button id="embed-test-btn" class="bg-brand-orange text-white px-5 py-2 rounded-lg text-sm font-bold hover:opacity-90"><i class="fas fa-wand-magic-sparkles mr-1"></i>プレビュー</button>
      <div id="embed-result"></div>
    </section>

    <section id="glossary-list" class="bg-white rounded-xl shadow p-4">
      <h3 class="font-bold text-sm text-brand-navy mb-3"><i class="fas fa-book mr-1"></i>用語注釈辞書(${glossary.length}語)— Yutoが素人向け注釈に使用</h3>
      <div class="grid sm:grid-cols-2 gap-2 text-xs">
        ${glossary.map((g) => `<div class="border border-slate-100 rounded-lg p-2"><b class="text-brand-navy">${esc(g.term)}</b> — ${esc(g.annotation)}</div>`).join('')}
      </div>
    </section>
  </div>`;

  document.getElementById('af-add-btn').addEventListener('click', async () => {
    const tool_name = document.getElementById('af-tool').value.trim();
    const affiliate_url = document.getElementById('af-url').value.trim();
    if (!tool_name || !affiliate_url) { toast('ツール名とURLは必須です', 'error'); return; }
    const aliases = [tool_name, ...document.getElementById('af-aliases').value.split(',').map((s) => s.trim()).filter(Boolean)];
    await axios.post('/api/affiliate/links', {
      tool_name, affiliate_url, aliases,
      program: document.getElementById('af-program').value.trim() || null,
      note: document.getElementById('af-note').value.trim() || null
    });
    toast('リンクを登録しました。以後自動埋め込み対象になります');
    renderAffiliate();
  });
  document.querySelectorAll('.af-toggle-btn').forEach((b) => b.addEventListener('click', async () => {
    await axios.post(`/api/affiliate/links/${b.dataset.id}/toggle`); renderAffiliate();
  }));
  document.querySelectorAll('.af-delete-btn').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('削除しますか?')) return;
    await axios.post(`/api/affiliate/links/${b.dataset.id}/delete`); toast('削除しました'); renderAffiliate();
  }));
  document.getElementById('embed-test-btn').addEventListener('click', async () => {
    const text = document.getElementById('embed-text').value.trim();
    if (!text) { toast('本文を入力してください', 'error'); return; }
    const { data } = await axios.post('/api/affiliate/embed', { text });
    const box = document.getElementById('embed-result');
    if (!data.changed) {
      box.innerHTML = '<div class="fade-in bg-slate-50 rounded-lg p-3 text-sm text-slate-500">検出されたツール名はありませんでした</div>';
      return;
    }
    box.innerHTML = `
    <div class="fade-in space-y-2">
      <div class="text-xs text-emerald-700 font-bold"><i class="fas fa-check mr-1"></i>検出: ${data.detected.map((d) => `${esc(d.tool_name)}(「${esc(d.matched)}」にマッチ)`).join(' / ')}${data.pr_added ? ' + PR表記を自動追加' : ''}</div>
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div class="text-[10px] text-slate-400 mb-1">埋め込み後の本文:</div>
        <pre class="whitespace-pre-wrap text-sm font-sans">${esc(data.embedded)}</pre>
      </div>
    </div>`;
  });
}

/* ============ ルーティング ============ */
function navigate(view) {
  currentView = view;
  setNav(view);
  if (officeTimer) { clearInterval(officeTimer); officeTimer = null; }
  if (view === 'office') {
    renderOffice();
    officeTimer = setInterval(() => { if (currentView === 'office') renderOffice(); }, 15000);
  }
  else if (view === 'approve') renderApprove();
  else if (view === 'kpi') renderKPI();
  else if (view === 'qa') renderQA();
  else if (view === 'affiliate') renderAffiliate();
}
window.navigate = navigate;

document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.view)));
navigate('office');
updateApprovalBadge();
setInterval(updateApprovalBadge, 30000);
