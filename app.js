// ============================================================
//  마취비 계산기 — app.js
// ============================================================

"use strict";

/* ─── 상수 ─────────────────────────────────────────────── */
const HOURS = Array.from({length: 24}, (_, i) => i);
const MINS5 = [0,5,10,15,20,25,30,35,40,45,50,55];
const pad   = n => String(n).padStart(2, "0");

/* ─── 계산 엔진 (DOM 불필요, 최상단 선언 OK) ───────────── */
function computeAnesthesiaTime(cases) {
  const timed = [], orphans = [];
  cases.forEach(c => {
    if (c.startH !== "" && c.durationMin > 0) {
      const s = Number(c.startH) * 60 + Number(c.startM);
      timed.push({ start: s, end: s + c.durationMin, case: c });
    } else if (c.durationMin > 0) {
      orphans.push(c);
    }
  });
  timed.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const seg of timed) {
    if (merged.length && seg.start < merged[merged.length - 1].end)
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, seg.end);
    else merged.push({ ...seg });
  }
  const timedMin  = merged.reduce((s, iv) => s + (iv.end - iv.start), 0);
  const orphanMin = orphans.reduce((s, c) => s + c.durationMin, 0);
  return { totalEffectiveMin: timedMin + orphanMin, intervals: merged, orphans, timed };
}

function calculateFee(cases) {
  const n       = cases.length;
  const baseFee = n * 30;
  const freeMin = n * 60;
  const { totalEffectiveMin, intervals, orphans, timed } = computeAnesthesiaTime(cases);
  const excessMin   = Math.max(0, totalEffectiveMin - freeMin);
  const extraBlocks = excessMin > 0 ? Math.ceil(excessMin / 15) : 0;
  const extraFee    = extraBlocks * 2;

  const blockShares = new Array(n).fill(0);
  if (extraBlocks > 0) {
    const order = cases
      .map((c, i) => ({ i, dur: c.durationMin }))
      .filter(x => x.dur > 60)
      .sort((a, b) => b.dur - a.dur || a.i - b.i);
    if (order.length > 0) {
      let rem = extraBlocks, round = 0;
      while (rem > 0) { blockShares[order[round % order.length].i]++; rem--; round++; }
    }
  }

  const breakdown = cases.map((c, i) => {
    const myExtra  = blockShares[i] * 2;
    const emergFee = c.emergency ? 3 : 0;
    return { case: c, idx: i, base: 30, extra: myExtra, emergency: emergFee, total: 30 + myExtra + emergFee };
  });

  const emergTotal = cases.reduce((s, c) => s + (c.emergency ? 3 : 0), 0);
  const grandTotal = baseFee + extraFee + emergTotal;
  return { n, baseFee, extraFee, emergTotal, grandTotal, totalEffectiveMin, freeMin, excessMin, extraBlocks, breakdown, intervals, orphans, timed };
}

function formatDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}

function getStartTime(c) {
  if (c.startH === "") return "";
  return `${pad(c.startH)}:${pad(c.startM)}`;
}

/* ─── localStorage ──────────────────────────────────────── */
const DRAFT_KEY = "anesthesia_draft";
function saveDraft(cases, nextId) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ cases, nextId })); } catch(e) {}
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!Array.isArray(d.cases) || !d.cases.length) return null;
    return d;
  } catch(e) { return null; }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}
}

/* ─── 앱 진입점 — DOM 준비 후 실행 ─────────────────────── */
document.addEventListener("DOMContentLoaded", () => {

  /* Firebase */
  const db      = window.__db;
  const fs      = window.__fsLib;
  const auth    = window.__auth;
  const authLib = window.__authLib;
  let currentUser = null;

  function userCol() {
    if (!db || !currentUser) return null;
    return fs.collection(db, "users", currentUser.uid, "records");
  }

  /* DOM refs */
  const casesList       = document.getElementById("casesList");
  const btnAddCase      = document.getElementById("btnAddCase");
  const btnCalculate    = document.getElementById("btnCalculate");
  const btnSave         = document.getElementById("btnSave");
  const btnSaveDraft    = document.getElementById("btnSaveDraft");
  const btnHistory      = document.getElementById("btnHistory");
  const btnCloseDrawer  = document.getElementById("btnCloseDrawer");
  const drawerOverlay   = document.getElementById("drawerOverlay");
  const historyDrawer   = document.getElementById("historyDrawer");
  const historyList     = document.getElementById("historyList");
  const resultPanel     = document.getElementById("resultPanel");
  const resultTotal     = document.getElementById("resultTotal");
  const resultTimeline  = document.getElementById("resultTimeline");
  const resultBreakdown = document.getElementById("resultBreakdown");
  const toastEl         = document.getElementById("toast");
  const resetModalOvl   = document.getElementById("resetModalOverlay");

  /* State */
  let cases  = [];
  let nextId = 1;

  /* ── Toast ── */
  let toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2800);
  }

  /* ── Case management ── */
  function addCase() {
    const id = nextId++;
    cases.push({ id, startH: "", startM: 0, durationMin: 0, emergency: false });
    renderCases();
    saveDraft(cases, nextId);
  }

  function removeCase(id) {
    if (cases.length === 1) { showToast("최소 1건의 수술이 필요합니다"); return; }
    cases = cases.filter(c => c.id !== id);
    renderCases();
    saveDraft(cases, nextId);
  }

  function updateCase(id, field, value) {
    const c = cases.find(c => c.id === id);
    if (!c) return;
    if (field === "durationMin") value = Math.max(0, parseInt(value) || 0);
    if (field === "emergency")   value = Boolean(value);
    if (field === "startH")      value = value === "" ? "" : Number(value);
    if (field === "startM")      value = Number(value);
    c[field] = value;
    saveDraft(cases, nextId);
  }

  /* ── Render cases ── */
  function renderCases() {
    casesList.innerHTML = "";
    cases.forEach((c, idx) => {
      const card = document.createElement("div");
      card.className = "case-card";
      card.dataset.id = c.id;

      const durH = Math.floor(c.durationMin / 60);
      const durM = c.durationMin % 60;

      const hoursOptions = `<option value="">--</option>` +
        HOURS.map(h => `<option value="${h}"${c.startH === h ? " selected" : ""}>${pad(h)}</option>`).join("");
      const minsOptions = MINS5.map(m =>
        `<option value="${m}"${c.startM === m ? " selected" : ""}>${pad(m)}</option>`).join("");

      card.innerHTML = `
        <div class="case-num">수술 ${idx + 1}</div>
        <div class="case-fields">
          <label class="field-label">마취 시작 시간
            <div class="time-select-row">
              <div class="sel-wrap">
                <select class="field-select" data-field="startH">${hoursOptions}</select>
                <span class="sel-arrow">▼</span>
              </div>
              <span class="dur-unit">시</span>
              <div class="sel-wrap">
                <select class="field-select" data-field="startM" ${c.startH === "" ? "disabled" : ""}>${minsOptions}</select>
                <span class="sel-arrow">▼</span>
              </div>
              <span class="dur-unit">분</span>
            </div>
          </label>
          <div class="duration-group">
            <label class="field-label">마취 시간
              <div class="duration-inputs">
                <input type="number" class="field-input duration-h" min="0" max="23" placeholder="0" value="${durH}" data-field="durH" />
                <span class="dur-unit">시간</span>
                <input type="number" class="field-input duration-m" min="0" max="59" placeholder="0" value="${durM}" data-field="durM" />
                <span class="dur-unit">분</span>
              </div>
            </label>
          </div>
          <label class="emergency-label">
            <input type="checkbox" class="emergency-check" data-field="emergency" ${c.emergency ? "checked" : ""} />
            <span class="emergency-badge">응급 가산 (+3만원)</span>
          </label>
        </div>
        <button class="btn-remove" aria-label="삭제">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      `;

      const startHSel = card.querySelector("[data-field='startH']");
      const startMSel = card.querySelector("[data-field='startM']");
      startHSel.addEventListener("change", e => {
        updateCase(c.id, "startH", e.target.value);
        startMSel.disabled = (e.target.value === "");
      });
      startMSel.addEventListener("change", e => updateCase(c.id, "startM", e.target.value));

      const hInput = card.querySelector("[data-field='durH']");
      const mInput = card.querySelector("[data-field='durM']");
      const syncDur = () => updateCase(c.id, "durationMin",
        Math.max(0, parseInt(hInput.value)||0) * 60 + Math.max(0, Math.min(59, parseInt(mInput.value)||0)));
      hInput.addEventListener("input", syncDur);
      mInput.addEventListener("input", syncDur);

      card.querySelector("[data-field='emergency']").addEventListener("change", e =>
        updateCase(c.id, "emergency", e.target.checked));
      card.querySelector(".btn-remove").addEventListener("click", () => removeCase(c.id));

      casesList.appendChild(card);
    });
  }

  /* ── Render result ── */
  function renderResult(result) {
    const { grandTotal, totalEffectiveMin, freeMin, excessMin, extraBlocks,
            breakdown, n, baseFee, extraFee, emergTotal } = result;

    resultTotal.textContent = `${grandTotal}만원`;

    const effH = Math.floor(totalEffectiveMin / 60), effM = totalEffectiveMin % 60;
    resultTimeline.innerHTML = `
      <div class="timeline-row"><span class="tl-label">수술 건수</span><span class="tl-value">${n}건</span></div>
      <div class="timeline-row"><span class="tl-label">유효 마취 시간</span><span class="tl-value">${effH > 0 ? effH+"시간 " : ""}${effM}분</span></div>
      <div class="timeline-row"><span class="tl-label">기본 포함 시간</span><span class="tl-value">${freeMin/60}시간</span></div>
      <div class="timeline-row ${excessMin > 0 ? "excess" : ""}">
        <span class="tl-label">초과 시간</span>
        <span class="tl-value">${excessMin}분${extraBlocks > 0 ? ` (${extraBlocks}구간)` : ""}</span>
      </div>
      <div class="timeline-divider"></div>
      <div class="timeline-row"><span class="tl-label">기본 마취비</span><span class="tl-value">${baseFee}만원</span></div>
      <div class="timeline-row"><span class="tl-label">초과 마취비</span><span class="tl-value">+${extraFee}만원</span></div>
      ${emergTotal > 0 ? `<div class="timeline-row emerg"><span class="tl-label">응급 가산 합계</span><span class="tl-value">+${emergTotal}만원</span></div>` : ""}
    `;

    resultBreakdown.innerHTML = `
      <div class="breakdown-title">수술별 상세</div>
      ${breakdown.map(b => {
        const st = getStartTime(b.case);
        return `
        <div class="breakdown-card">
          <div class="breakdown-header">
            <span>수술 ${b.idx + 1}</span>
            <span class="bc-time">${st ? st + " · " : ""}${formatDur(b.case.durationMin)}</span>
            ${b.case.emergency ? `<span class="bc-emerg">응급</span>` : ""}
          </div>
          <div class="breakdown-rows">
            <div class="bc-row"><span>기본</span><span>30만원</span></div>
            ${b.extra > 0 ? `<div class="bc-row"><span>초과 배분</span><span>+${b.extra}만원</span></div>` : ""}
            ${b.emergency > 0 ? `<div class="bc-row emerg-row"><span>응급 가산</span><span>+3만원</span></div>` : ""}
          </div>
          <div class="bc-total">${b.total}만원</div>
        </div>`;
      }).join("")}
    `;

    resultPanel.classList.remove("hidden");
    resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ── Validate ── */
  function validate() {
    for (let i = 0; i < cases.length; i++) {
      if (cases[i].durationMin <= 0) { showToast(`수술 ${i+1}: 마취 시간을 입력해주세요`); return false; }
    }
    return true;
  }

  /* ── Firebase CRUD ── */
  async function saveRecord(result) {
    if (!currentUser) { showToast("로그인 후 저장할 수 있습니다"); return; }
    const col = userCol();
    if (!col) { showToast("Firebase 미연결 – 저장 불가"); return; }
    try {
      await fs.addDoc(col, {
        createdAt: new Date().toISOString(),
        cases: cases.map(c => ({ startH: c.startH, startM: c.startM, durationMin: c.durationMin, emergency: c.emergency })),
        grandTotal: result.grandTotal,
        totalEffectiveMin: result.totalEffectiveMin,
        n: result.n,
      });
      showToast("✓ 기록 저장 완료");
    } catch(e) { console.error(e); showToast("저장 실패: " + e.message); }
  }

  async function loadHistory() {
    if (!currentUser) { historyList.innerHTML = `<p class="empty-msg">로그인하면 기록을 볼 수 있습니다</p>`; return; }
    const col = userCol();
    if (!col) { historyList.innerHTML = `<p class="empty-msg">Firebase 미연결</p>`; return; }
    historyList.innerHTML = `<p class="empty-msg loading">불러오는 중…</p>`;
    try {
      const snap = await fs.getDocs(fs.query(col, fs.orderBy("createdAt", "desc")));
      if (snap.empty) { historyList.innerHTML = `<p class="empty-msg">저장된 기록이 없습니다</p>`; return; }
      historyList.innerHTML = "";
      snap.forEach(docSnap => {
        const d = docSnap.data();
        const dt = new Date(d.createdAt);
        const dateStr = `${dt.getFullYear()}.${pad(dt.getMonth()+1)}.${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        const card = document.createElement("div");
        card.className = "history-card";
        card.innerHTML = `
          <div class="hc-meta"><span class="hc-date">${dateStr}</span><span class="hc-badge">${d.n}건</span></div>
          <div class="hc-total">${d.grandTotal}만원</div>
          <div class="hc-detail">${formatDur(d.totalEffectiveMin)} 마취</div>
          <button class="btn-del-rec" aria-label="삭제">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>`;
        card.querySelector(".btn-del-rec").addEventListener("click", async e => {
          e.stopPropagation();
          try {
            await fs.deleteDoc(fs.doc(db, "users", currentUser.uid, "records", docSnap.id));
            showToast("기록 삭제됨"); loadHistory();
          } catch(e) { showToast("삭제 실패: " + e.message); }
        });
        historyList.appendChild(card);
      });
    } catch(e) { console.error(e); historyList.innerHTML = `<p class="empty-msg">로드 실패: ${e.message}</p>`; }
  }

  /* ── Auth UI ── */
  function updateAuthUI(user) {
    currentUser = user;
    const btnLogin   = document.getElementById("btnLogin");
    const userInfo   = document.getElementById("userInfo");
    const userAvatar = document.getElementById("userAvatar");
    if (user) {
      btnLogin.classList.add("hidden");
      userInfo.classList.remove("hidden");
      userAvatar.src = user.photoURL || "";
      btnSave.disabled = false;
      btnSave.style.opacity = "1";
    } else {
      btnLogin.classList.remove("hidden");
      userInfo.classList.add("hidden");
      btnSave.disabled = true;
      btnSave.style.opacity = "0.4";
    }
  }

  /* ── Drawer ── */
  function openDrawer()  { historyDrawer.classList.remove("hidden"); drawerOverlay.classList.remove("hidden"); loadHistory(); }
  function closeDrawer() { historyDrawer.classList.add("hidden"); drawerOverlay.classList.add("hidden"); }

  /* ── Reset modal ── */
  function openResetModal()  { resetModalOvl.classList.remove("hidden"); }
  function closeResetModal() { resetModalOvl.classList.add("hidden"); }

  /* ── Init: draft 복원 ── */
  const draft = loadDraft();
  if (draft) {
    cases  = draft.cases;
    nextId = draft.nextId || cases.length + 1;
    renderCases();
    showToast("✎ 작성 중인 내용을 불러왔습니다");
  } else {
    addCase();
  }

  /* ── 저장 버튼 초기 비활성 ── */
  btnSave.disabled = true;
  btnSave.style.opacity = "0.4";

  /* ── Event listeners ── */
  btnAddCase.addEventListener("click", addCase);

  btnCalculate.addEventListener("click", () => {
    if (!validate()) return;
    renderResult(calculateFee(cases));
  });

  btnSave.addEventListener("click", () => {
    if (!validate()) return;
    saveRecord(calculateFee(cases));
  });

  btnSaveDraft.addEventListener("click", () => {
    saveDraft(cases, nextId);
    showToast("✓ 임시저장 완료");
  });

  btnHistory.addEventListener("click", openDrawer);
  btnCloseDrawer.addEventListener("click", closeDrawer);
  drawerOverlay.addEventListener("click", closeDrawer);

  document.getElementById("btnReset").addEventListener("click", openResetModal);
  document.getElementById("btnResetConfirm").addEventListener("click", () => {
    cases = []; nextId = 1;
    clearDraft();
    resultPanel.classList.add("hidden");
    closeResetModal();
    addCase();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("btnResetCancel").addEventListener("click", closeResetModal);
  resetModalOvl.addEventListener("click", closeResetModal);

  /* ── Auth 이벤트 ── */
  if (auth && authLib) {
    authLib.getRedirectResult(auth)
      .then(r => { if (r?.user) showToast("✓ 로그인 완료"); })
      .catch(e => console.error("redirect:", e));

    authLib.onAuthStateChanged(auth, updateAuthUI);
  }

  document.getElementById("btnLogin").addEventListener("click", async () => {
    if (!auth || !authLib) { showToast("Firebase 설정을 확인해주세요"); return; }
    const provider = new authLib.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) &&
                  /WebKit/.test(navigator.userAgent) &&
                  !/CriOS|FxiOS/.test(navigator.userAgent);
    try {
      if (isIOS) {
        await authLib.signInWithRedirect(auth, provider);
      } else {
        await authLib.signInWithPopup(auth, provider);
        showToast("✓ 로그인 완료");
      }
    } catch(e) {
      console.error("login:", e);
      if (e.code === "auth/popup-blocked") {
        await authLib.signInWithRedirect(auth, provider);
      } else if (e.code !== "auth/popup-closed-by-user") {
        showToast("로그인 실패: " + e.code);
      }
    }
  });

  document.getElementById("btnLogout").addEventListener("click", async () => {
    if (!auth || !authLib) return;
    await authLib.signOut(auth);
    showToast("로그아웃 됐습니다");
  });

}); // DOMContentLoaded
