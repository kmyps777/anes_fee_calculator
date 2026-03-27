// ============================================================
//  마취비 계산기 — app.js
//  의존: index.html 에서 window.__db, window.__fsLib 주입됨
// ============================================================

"use strict";

/* ─── Firebase helpers ─────────────────────────────────── */
const db       = window.__db;
const fs       = window.__fsLib;
const auth     = window.__auth;
const authLib  = window.__authLib;

let currentUser = null;   // 로그인한 유저 (null = 비로그인)

// 현재 유저의 records 컬렉션 경로
function userCollection() {
  if (!db || !currentUser) return null;
  return fs.collection(db, "users", currentUser.uid, "records");
}

/* ─── 상수 ─────────────────────────────────────────────── */
const HOURS = Array.from({length: 24}, (_, i) => i);
const MINS5 = [0,5,10,15,20,25,30,35,40,45,50,55];
const pad   = n => String(n).padStart(2, "0");

/* ─── State ────────────────────────────────────────────── */
let cases  = [];   // { id, startH, startM, durationMin, emergency }
let nextId = 1;

/* ─── DOM refs ─────────────────────────────────────────── */
const casesList      = document.getElementById("casesList");
const btnAddCase     = document.getElementById("btnAddCase");
const btnCalculate   = document.getElementById("btnCalculate");
const btnReset       = document.getElementById("btnReset");
const btnSave        = document.getElementById("btnSave");
const btnHistory     = document.getElementById("btnHistory");
const btnCloseDrawer = document.getElementById("btnCloseDrawer");
const drawerOverlay  = document.getElementById("drawerOverlay");
const historyDrawer  = document.getElementById("historyDrawer");
const historyList    = document.getElementById("historyList");
const resultPanel    = document.getElementById("resultPanel");
const resultTotal    = document.getElementById("resultTotal");
const resultTimeline = document.getElementById("resultTimeline");
const resultBreakdown= document.getElementById("resultBreakdown");
const toast          = document.getElementById("toast");

/* ─── localStorage 자동저장 ─────────────────────────────── */
const DRAFT_KEY = "anesthesia_draft";

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ cases, nextId }));
  } catch (e) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const { cases: saved, nextId: savedId } = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length === 0) return false;
    cases  = saved;
    nextId = savedId || saved.length + 1;
    return true;
  } catch (e) { return false; }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}

/* ─── Init ─────────────────────────────────────────────── */
if (!loadDraft()) addCase();
else { renderCases(); showToast("✎ 작성 중인 내용을 불러왔습니다"); }

/* ─── Case management ──────────────────────────────────── */
function addCase() {
  const id = nextId++;
  cases.push({ id, startH: "", startM: 0, durationMin: 0, emergency: false });
  renderCases();
  saveDraft();
}

function removeCase(id) {
  if (cases.length === 1) { showToast("최소 1건의 수술이 필요합니다"); return; }
  cases = cases.filter(c => c.id !== id);
  renderCases();
  saveDraft();
}

function updateCase(id, field, value) {
  const c = cases.find(c => c.id === id);
  if (!c) return;
  if (field === "durationMin") value = Math.max(0, parseInt(value) || 0);
  if (field === "emergency")   value = Boolean(value);
  if (field === "startH")      value = value === "" ? "" : Number(value);
  if (field === "startM")      value = Number(value);
  c[field] = value;
  saveDraft();
}

/* ─── startTime 문자열 헬퍼 ─────────────────────────────── */
function getStartTime(c) {
  if (c.startH === "") return "";
  return `${pad(c.startH)}:${pad(c.startM)}`;
}

/* ─── Render case cards ─────────────────────────────────── */
function renderCases() {
  casesList.innerHTML = "";
  cases.forEach((c, idx) => {
    const card = document.createElement("div");
    card.className = "case-card";
    card.dataset.id = c.id;

    const durH = Math.floor(c.durationMin / 60);
    const durM = c.durationMin % 60;

    const hoursOptions = `<option value="">--</option>` +
      HOURS.map(h =>
        `<option value="${h}"${c.startH === h ? " selected" : ""}>${pad(h)}</option>`
      ).join("");

    const minsOptions = MINS5.map(m =>
      `<option value="${m}"${c.startM === m ? " selected" : ""}>${pad(m)}</option>`
    ).join("");

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
              <select class="field-select" data-field="startM"
                ${c.startH === "" ? "disabled" : ""}>${minsOptions}</select>
              <span class="sel-arrow">▼</span>
            </div>
            <span class="dur-unit">분</span>
          </div>
        </label>
        <div class="duration-group">
          <label class="field-label">마취 시간
            <div class="duration-inputs">
              <input type="number" class="field-input duration-h" min="0" max="23"
                     placeholder="0" value="${durH}" data-field="durH" />
              <span class="dur-unit">시간</span>
              <input type="number" class="field-input duration-m" min="0" max="59"
                     placeholder="0" value="${durM}" data-field="durM" />
              <span class="dur-unit">분</span>
            </div>
          </label>
        </div>
        <label class="emergency-label">
          <input type="checkbox" class="emergency-check" data-field="emergency"
                 ${c.emergency ? "checked" : ""} />
          <span class="emergency-badge">응급 가산 (+3만원)</span>
        </label>
      </div>
      <button class="btn-remove" data-id="${c.id}" aria-label="삭제">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
      </button>
    `;

    // Events
    const startHSel = card.querySelector("[data-field='startH']");
    const startMSel = card.querySelector("[data-field='startM']");

    startHSel.addEventListener("change", e => {
      updateCase(c.id, "startH", e.target.value);
      // 시간 비었으면 분 disable
      startMSel.disabled = (e.target.value === "");
    });
    startMSel.addEventListener("change", e =>
      updateCase(c.id, "startM", e.target.value));

    const hInput = card.querySelector("[data-field='durH']");
    const mInput = card.querySelector("[data-field='durM']");
    const syncDuration = () => {
      const h = Math.max(0, parseInt(hInput.value) || 0);
      const m = Math.max(0, Math.min(59, parseInt(mInput.value) || 0));
      updateCase(c.id, "durationMin", h * 60 + m);
    };
    hInput.addEventListener("input", syncDuration);
    mInput.addEventListener("input", syncDuration);

    card.querySelector("[data-field='emergency']").addEventListener("change", e =>
      updateCase(c.id, "emergency", e.target.checked));

    card.querySelector(".btn-remove").addEventListener("click", () => removeCase(c.id));

    casesList.appendChild(card);
  });
}

/* ─── Core calculation engine ───────────────────────────── */
function computeAnesthesiaTime(cases) {
  const timed   = [];
  const orphans = [];

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
    if (merged.length && seg.start < merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, seg.end);
    } else {
      merged.push({ ...seg });
    }
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

  // 초과 블록: 마취 시간 긴 순서대로 2만원씩 순차 배분
  // 단, 마취 시간이 60분 이하인 수술은 배분 대상 제외 (30만원 초과 불가)
  const blockShares = new Array(n).fill(0);
  if (extraBlocks > 0) {
    const order = cases
      .map((c, i) => ({ i, dur: c.durationMin }))
      .filter(x => x.dur > 60)          // 1시간 초과 수술만 배분 대상
      .sort((a, b) => b.dur - a.dur || a.i - b.i);
    if (order.length > 0) {
      let rem = extraBlocks, round = 0;
      while (rem > 0) {
        blockShares[order[round % order.length].i]++;
        rem--; round++;
      }
    }
    // order가 비어있으면 초과비는 전체 합계에만 반영되고 개별 배분은 없음
  }

  const breakdown = cases.map((c, i) => {
    const myExtra  = blockShares[i] * 2;
    const emergFee = c.emergency ? 3 : 0;
    return {
      case:      c,
      idx:       i,
      base:      30,
      extra:     myExtra,
      emergency: emergFee,
      total:     30 + myExtra + emergFee,
    };
  });

  const emergTotal = cases.reduce((s, c) => s + (c.emergency ? 3 : 0), 0);
  const grandTotal = baseFee + extraFee + emergTotal;

  return {
    n, baseFee, extraFee, emergTotal, grandTotal,
    totalEffectiveMin, freeMin, excessMin, extraBlocks,
    breakdown, intervals, orphans, timed,
  };
}

/* ─── Render results ────────────────────────────────────── */
function renderResult(result) {
  const { grandTotal, totalEffectiveMin, freeMin, excessMin, extraBlocks,
          breakdown, n, baseFee, extraFee, emergTotal } = result;

  resultTotal.textContent = `${grandTotal}만원`;

  const effH = Math.floor(totalEffectiveMin / 60);
  const effM = totalEffectiveMin % 60;
  resultTimeline.innerHTML = `
    <div class="timeline-row">
      <span class="tl-label">수술 건수</span>
      <span class="tl-value">${n}건</span>
    </div>
    <div class="timeline-row">
      <span class="tl-label">유효 마취 시간</span>
      <span class="tl-value">${effH > 0 ? effH + "시간 " : ""}${effM}분</span>
    </div>
    <div class="timeline-row">
      <span class="tl-label">기본 포함 시간</span>
      <span class="tl-value">${freeMin / 60}시간</span>
    </div>
    <div class="timeline-row ${excessMin > 0 ? "excess" : ""}">
      <span class="tl-label">초과 시간</span>
      <span class="tl-value">${excessMin}분${extraBlocks > 0 ? ` (${extraBlocks}구간)` : ""}</span>
    </div>
    <div class="timeline-divider"></div>
    <div class="timeline-row">
      <span class="tl-label">기본 마취비</span>
      <span class="tl-value">${baseFee}만원</span>
    </div>
    <div class="timeline-row">
      <span class="tl-label">초과 마취비</span>
      <span class="tl-value">+${extraFee}만원</span>
    </div>
    ${emergTotal > 0 ? `
    <div class="timeline-row emerg">
      <span class="tl-label">응급 가산 합계</span>
      <span class="tl-value">+${emergTotal}만원</span>
    </div>` : ""}
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

function formatDur(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}

/* ─── Validate ──────────────────────────────────────────── */
function validate() {
  for (let i = 0; i < cases.length; i++) {
    if (cases[i].durationMin <= 0) {
      showToast(`수술 ${i + 1}: 마취 시간을 입력해주세요`);
      return false;
    }
  }
  return true;
}

/* ─── Firebase ──────────────────────────────────────────── */
async function saveRecord(result) {
  if (!currentUser) { showToast("로그인 후 저장할 수 있습니다"); return; }
  const col = userCollection();
  if (!col) { showToast("Firebase 미연결 – 저장 불가"); return; }
  try {
    const payload = {
      createdAt: new Date().toISOString(),
      cases: cases.map(c => ({
        startH: c.startH, startM: c.startM,
        durationMin: c.durationMin, emergency: c.emergency
      })),
      grandTotal: result.grandTotal,
      totalEffectiveMin: result.totalEffectiveMin,
      n: result.n,
    };
    await fs.addDoc(col, payload);
    showToast("✓ 기록 저장 완료");
  } catch (e) {
    console.error(e);
    showToast("저장 실패: " + e.message);
  }
}

async function loadHistory() {
  if (!currentUser) {
    historyList.innerHTML = `<p class="empty-msg">로그인하면 저장된 기록을 볼 수 있습니다</p>`;
    return;
  }
  const col = userCollection();
  if (!col) {
    historyList.innerHTML = `<p class="empty-msg">Firebase 미연결 상태입니다.</p>`;
    return;
  }
  historyList.innerHTML = `<p class="empty-msg loading">불러오는 중…</p>`;
  try {
    const q    = fs.query(col, fs.orderBy("createdAt", "desc"));
    const snap = await fs.getDocs(q);
    if (snap.empty) {
      historyList.innerHTML = `<p class="empty-msg">저장된 기록이 없습니다</p>`;
      return;
    }
    historyList.innerHTML = "";
    snap.forEach(docSnap => {
      const d  = docSnap.data();
      const card = document.createElement("div");
      card.className = "history-card";
      const dt = new Date(d.createdAt);
      const dateStr = `${dt.getFullYear()}.${pad(dt.getMonth()+1)}.${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      card.innerHTML = `
        <div class="hc-meta">
          <span class="hc-date">${dateStr}</span>
          <span class="hc-badge">${d.n}건</span>
        </div>
        <div class="hc-total">${d.grandTotal}만원</div>
        <div class="hc-detail">${formatDur(d.totalEffectiveMin)} 마취</div>
        <button class="btn-del-rec" data-id="${docSnap.id}" aria-label="기록 삭제">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;
      card.querySelector(".btn-del-rec").addEventListener("click", async e => {
        e.stopPropagation();
        await deleteRecord(docSnap.id);
      });
      historyList.appendChild(card);
    });
  } catch (e) {
    console.error(e);
    historyList.innerHTML = `<p class="empty-msg">로드 실패: ${e.message}</p>`;
  }
}

async function deleteRecord(id) {
  if (!currentUser || !db) return;
  try {
    await fs.deleteDoc(fs.doc(db, "users", currentUser.uid, "records", id));
    showToast("기록 삭제됨");
    loadHistory();
  } catch (e) {
    showToast("삭제 실패: " + e.message);
  }
}

/* ─── Toast ─────────────────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2800);
}

/* ─── Drawer ─────────────────────────────────────────────── */
function openDrawer()  {
  historyDrawer.classList.remove("hidden");
  drawerOverlay.classList.remove("hidden");
  loadHistory();
}
function closeDrawer() {
  historyDrawer.classList.add("hidden");
  drawerOverlay.classList.add("hidden");
}

/* ─── Event listeners ───────────────────────────────────── */
btnAddCase.addEventListener("click", addCase);

btnCalculate.addEventListener("click", () => {
  if (!validate()) return;
  const result = calculateFee(cases);
  renderResult(result);
});

document.getElementById("btnReset").addEventListener("click", () => {
  openResetModal();
});

function openResetModal() {
  document.getElementById("resetModal").classList.remove("hidden");
}
function closeResetModal() {
  document.getElementById("resetModal").classList.add("hidden");
}

document.getElementById("btnResetConfirm").addEventListener("click", () => {
  cases  = [];
  nextId = 1;
  clearDraft();
  resultPanel.classList.add("hidden");
  closeResetModal();
  addCase();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("btnResetCancel").addEventListener("click", closeResetModal);
document.getElementById("resetModalOverlay").addEventListener("click", closeResetModal);

btnSave.addEventListener("click", () => {
  if (!validate()) return;
  const result = calculateFee(cases);
  saveRecord(result);
});

document.getElementById("btnSaveDraft").addEventListener("click", () => {
  saveDraft();
  showToast("✓ 임시저장 완료");
});

btnHistory.addEventListener("click", openDrawer);
btnCloseDrawer.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);

/* ─── Auth UI ────────────────────────────────────────────── */
function updateAuthUI(user) {
  currentUser = user;
  const btnLogin  = document.getElementById("btnLogin");
  const userInfo  = document.getElementById("userInfo");
  const userAvatar= document.getElementById("userAvatar");
  const btnSaveEl = document.getElementById("btnSave");

  if (user) {
    btnLogin.classList.add("hidden");
    userInfo.classList.remove("hidden");
    userAvatar.src = user.photoURL || "";
    // 저장 버튼 활성화
    btnSaveEl.disabled = false;
    btnSaveEl.style.opacity = "1";
  } else {
    btnLogin.classList.remove("hidden");
    userInfo.classList.add("hidden");
    // 저장 버튼 비활성화
    btnSaveEl.disabled = true;
    btnSaveEl.style.opacity = "0.4";
  }
}

if (auth && authLib) {
  // 로그인 상태 감지
  authLib.onAuthStateChanged(auth, user => {
    updateAuthUI(user);
  });

  // 리디렉트 결과 처리 (iOS Safari 복귀 후)
  authLib.getRedirectResult(auth).then(result => {
    if (result?.user) showToast("✓ 로그인 완료");
  }).catch(e => {
    if (e.code !== "auth/popup-closed-by-user")
      showToast("로그인 실패: " + e.message);
  });

  // 구글 로그인 — iOS Safari는 redirect, 그 외는 popup
  document.getElementById("btnLogin").addEventListener("click", async () => {
    const provider = new authLib.GoogleAuthProvider();
    const isSafariIOS = /iP(hone|ad|od)/.test(navigator.userAgent) &&
                        /WebKit/.test(navigator.userAgent) &&
                        !/CriOS|FxiOS/.test(navigator.userAgent);
    try {
      if (isSafariIOS) {
        await authLib.signInWithRedirect(auth, provider);
        // 페이지가 구글로 이동하므로 이 아래는 실행 안 됨
      } else {
        await authLib.signInWithPopup(auth, provider);
        showToast("✓ 로그인 완료");
      }
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user")
        showToast("로그인 실패: " + e.message);
    }
  });

  // 로그아웃
  document.getElementById("btnLogout").addEventListener("click", async () => {
    await authLib.signOut(auth);
    showToast("로그아웃 됐습니다");
  });
} else {
  // Firebase 미연결시 저장 버튼 비활성화
  const btnSaveEl = document.getElementById("btnSave");
  btnSaveEl.disabled = true;
  btnSaveEl.style.opacity = "0.4";
}

// 초기 저장 버튼 상태 (로그인 전 비활성)
document.getElementById("btnSave").disabled = true;
document.getElementById("btnSave").style.opacity = "0.4";
