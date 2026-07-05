/* ===== Storage helpers ===== */
const STORAGE_KEY = "maatafot_data_v1";
const USER_KEY = "maatafot_user_v1";

const DEFAULT_ENVELOPES = [
  { id: "food", name: "אוכל", icon: "🍔", limit: 1000 },
  { id: "transport", name: "תחבורה", icon: "🚗", limit: 700 },
  { id: "fun", name: "בילויים", icon: "🎉", limit: 500 },
  { id: "other", name: "אחר", icon: "🛍️", limit: 300 },
];

function monthKeyOf(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function daysInMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); }

function loadData(){
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}
function saveData(data){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function loadUser(){
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
function saveUser(u){ localStorage.setItem(USER_KEY, JSON.stringify(u)); }

/* ===== State ===== */
let state = loadData();
let me = loadUser();
let onboardStep = 1;
let draftEnvelopes = [];
let draftTotal = 0;
let selectedEnvelopeId = null;
let amountStr = "0";

/* ===== Month rollover ===== */
function ensureCurrentMonth(){
  if(!state) return;
  const now = new Date();
  const curKey = monthKeyOf(now);
  if(state.monthKey !== curKey){
    // archive previous month summary
    state.history = state.history || [];
    const spentTotal = state.envelopes.reduce((s,e)=>s+e.spent,0);
    state.history.unshift({ monthKey: state.monthKey, totalBudget: state.totalBudget, spent: spentTotal });

    // reset envelopes spent
    state.envelopes.forEach(e => e.spent = 0);
    state.transactions = [];
    state.monthKey = curKey;

    // apply recurring expenses fresh for the new month
    (state.recurring || []).forEach(r => {
      const env = state.envelopes.find(e => e.id === r.envelopeId);
      if(env){
        env.spent += r.amount;
        state.transactions.unshift({
          id: "t"+Date.now()+Math.random().toString(16).slice(2),
          envelopeId: r.envelopeId, amount: r.amount, note: r.name + " (קבוע)",
          who: "אוטומטי", date: new Date().toISOString(), icon: r.icon || "🔁"
        });
      }
    });
    saveData(state);
  }
}

/* ===== Rendering: entry point ===== */
function render(){
  const root = document.getElementById("app");
  if(!state || !me){
    root.innerHTML = onboardHTML();
    bindOnboardEvents();
    return;
  }
  ensureCurrentMonth();
  root.innerHTML = dashboardHTML();
  bindDashboardEvents();
}

/* ================= ONBOARDING ================= */
function onboardHTML(){
  if(!me){
    return `
    <div class="onboard">
      <div class="step-progress"><div class="active"></div><div></div><div></div></div>
      <div class="onboard-step">
        <h2>איך קוראים לך?</h2>
        <p class="sub">כדי לתייג מי הזין כל הוצאה. תצטרך למלא את זה פעם אחת בלבד, בכל מכשיר.</p>
        <div class="field">
          <label>השם שלך</label>
          <input type="text" id="myName" placeholder="למשל: עידן" />
        </div>
        <div class="field">
          <label>השם של בן/בת הזוג (אופציונלי כרגע)</label>
          <input type="text" id="partnerName" placeholder="למשל: נטלי" />
        </div>
      </div>
      <button class="primary-btn" onclick="submitName()">המשך</button>
    </div>`;
  }
  if(onboardStep === 2){
    return `
    <div class="onboard">
      <div class="step-progress"><div class="active"></div><div class="active"></div><div></div></div>
      <div class="onboard-step">
        <h2>מה התקציב החודשי?</h2>
        <p class="sub">כמה כסף יש לכם לחלק החודש, סה"כ.</p>
        <div class="field">
          <label>סכום חודשי (₪)</label>
          <input type="number" id="totalBudgetInput" placeholder="5600" value="${draftTotal || ""}" />
        </div>
      </div>
      <button class="primary-btn" onclick="submitTotal()">המשך</button>
    </div>`;
  }
  if(onboardStep === 3){
    const rows = draftEnvelopes.map((e,i) => `
      <div class="env-edit-row">
        <span class="ic">${e.icon}</span>
        <input type="text" value="${e.name}" oninput="draftEnvelopes[${i}].name=this.value" />
        <input type="number" value="${e.limit}" oninput="draftEnvelopes[${i}].limit=Number(this.value)||0" />
        <span class="remove-x" onclick="removeDraftEnv(${i})">✕</span>
      </div>`).join("");
    const allocated = draftEnvelopes.reduce((s,e)=>s+Number(e.limit||0),0);
    const remain = draftTotal - allocated;
    return `
    <div class="onboard">
      <div class="step-progress"><div class="active"></div><div class="active"></div><div class="active"></div></div>
      <div class="onboard-step">
        <h2>חלוקה למעטפות</h2>
        <p class="sub">חלקו את ${draftTotal} ₪ לקטגוריות. אפשר לערוך שם, סכום, או להוסיף מעטפה.</p>
        ${rows}
        <div class="add-env-btn" onclick="addDraftEnv()">+ הוסף מעטפה</div>
        <div class="budget-remain">${remain >= 0 ? `נשארו לחלוקה ${remain} ₪` : `חרגתם ב-${Math.abs(remain)} ₪ מהתקציב`}</div>
      </div>
      <button class="primary-btn" onclick="submitEnvelopes()">סיימו והתחילו</button>
    </div>`;
  }
}

function bindOnboardEvents(){}

function submitName(){
  const myName = document.getElementById("myName").value.trim() || "אני";
  const partnerName = document.getElementById("partnerName").value.trim();
  me = { name: myName, partner: partnerName || null };
  saveUser(me);
  onboardStep = 2;
  render();
}

function submitTotal(){
  const v = Number(document.getElementById("totalBudgetInput").value) || 0;
  draftTotal = v;
  draftEnvelopes = DEFAULT_ENVELOPES.map(e => ({...e}));
  // scale defaults proportionally to entered budget if very different from default sum(2500)
  const defaultSum = DEFAULT_ENVELOPES.reduce((s,e)=>s+e.limit,0);
  if(defaultSum > 0 && v > 0){
    draftEnvelopes = draftEnvelopes.map(e => ({...e, limit: Math.round(e.limit * v / defaultSum)}));
  }
  onboardStep = 3;
  render();
}

function addDraftEnv(){
  draftEnvelopes.push({ id: "cat"+Date.now(), name: "קטגוריה חדשה", icon: "📦", limit: 0 });
  render();
}
function removeDraftEnv(i){
  draftEnvelopes.splice(i,1);
  render();
}

function submitEnvelopes(){
  const now = new Date();
  state = {
    monthKey: monthKeyOf(now),
    totalBudget: draftTotal,
    envelopes: draftEnvelopes.map(e => ({ ...e, spent: 0 })),
    recurring: [],
    transactions: [],
    history: []
  };
  saveData(state);
  render();
}

/* ================= DASHBOARD ================= */
function statusOf(pct){
  if(pct >= 100) return "over";
  if(pct >= 75) return "watch";
  return "good";
}

function dashboardHTML(){
  const now = new Date();
  const totalSpent = state.envelopes.reduce((s,e)=>s+e.spent,0);
  const remain = state.totalBudget - totalSpent;
  const dim = daysInMonth(now);
  const dayOfMonth = now.getDate();
  const dailyPace = dayOfMonth > 0 ? totalSpent / dayOfMonth : 0;
  const projected = Math.round(dailyPace * dim);
  const projDiff = state.totalBudget - projected;
  const heroPct = Math.min(100, Math.round((totalSpent / (state.totalBudget||1)) * 100));
  const heroStatus = statusOf(heroPct);

  const monthName = now.toLocaleDateString("he-IL", { month: "long", year: "numeric" });

  const envelopesHTML = state.envelopes.map(e => {
    const pct = Math.min(999, Math.round((e.spent / (e.limit||1)) * 100));
    const st = statusOf(pct);
    const remainE = e.limit - e.spent;
    return `
    <div class="envelope" onclick="openSheet('${e.id}')">
      <div class="env-top">
        <div class="env-name"><span class="env-icon">${e.icon}</span> ${e.name}</div>
        <div class="env-seal ${st}-seal">${pct}%</div>
      </div>
      <div class="env-nums">
        <span>${remainE >= 0 ? `נשאר <b>${remainE} ₪</b>` : `חריגה של <b>${Math.abs(remainE)} ₪ ⚠</b>`}</span>
        <span>מתוך ${e.limit} ₪</span>
      </div>
      <div class="env-bar"><div class="env-bar-fill ${st}-fill" style="width:${Math.min(100,pct)}%"></div></div>
    </div>`;
  }).join("");

  const recentTx = state.transactions.slice(0, 6);
  const recentHTML = recentTx.length ? recentTx.map(t => {
    const env = state.envelopes.find(e => e.id === t.envelopeId);
    const when = new Date(t.date);
    const whenStr = when.toLocaleDateString("he-IL", { day:"2-digit", month:"2-digit" }) + " · " + when.toLocaleTimeString("he-IL", { hour:"2-digit", minute:"2-digit" });
    return `
    <div class="recent-item">
      <div class="recent-left">
        <div class="recent-icon">${t.icon || (env ? env.icon : "💳")}</div>
        <div><div>${t.note || (env ? env.name : "הוצאה")}</div><div class="recent-who">${t.who} · ${whenStr}</div></div>
      </div>
      <div class="recent-amt">-${t.amount} ₪</div>
    </div>`;
  }).join("") : `<div class="empty-note">עוד אין תנועות החודש. לחצו על + כדי להתחיל.</div>`;

  const avatarInitials = me.partner
    ? `<div class="avatar-pair"><span>${me.name[0]||"א"}</span><span>${me.partner[0]||"ב"}</span></div>`
    : "";

  return `
  <div class="screen">
    <div class="topbar">
      <div>
        <div class="eyebrow">${monthName} · ${me.partner ? "תקציב משותף" : "תקציב אישי"}</div>
        <h1 style="font-size:22px;">שלום, ${me.name} ✦</h1>
      </div>
      ${avatarInitials}
    </div>

    <div class="hero">
      <div class="hero-label">נשאר החודש</div>
      <div class="hero-amount">${remain.toLocaleString()}<span>₪ מתוך ${state.totalBudget.toLocaleString()} ₪</span></div>
      <div class="hero-sub"><span class="dot ${projDiff >= 0 ? "good-dot" : "over-dot"}"></span>
        ${projDiff >= 0
          ? `בקצב הזה תסיימו את החודש בפלוס של ${projDiff.toLocaleString()} ₪`
          : `בקצב הזה תחרגו בכ-${Math.abs(projDiff).toLocaleString()} ₪ עד סוף החודש`}
      </div>
      <div class="hero-bar"><div class="hero-bar-fill ${heroStatus}-fill" style="width:${heroPct}%"></div></div>
    </div>

    <div class="section-title">המעטפות שלכם <em>${state.envelopes.length} קטגוריות</em></div>
    <div class="envelopes">${envelopesHTML}</div>

    <div class="section-title">תנועות אחרונות</div>
    <div class="recent">${recentHTML}</div>
  </div>

  <button class="fab" onclick="openSheet()">+</button>

  <div class="sheet-overlay" id="overlay" onclick="closeSheet()"></div>
  <div class="sheet" id="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-amount" id="amountDisplay">0<span> ₪</span></div>
    <div class="sheet-hint">בחר קטגוריה והזן סכום</div>
    <div class="cat-grid" id="catGrid">
      ${state.envelopes.map(e => `<div class="cat-btn" data-id="${e.id}" onclick="selectCat('${e.id}')"><span class="ic">${e.icon}</span>${e.name}</div>`).join("")}
    </div>
    <div class="keypad">
      ${["1","2","3","4","5","6","7","8","9","⌫","0","00"].map(k => `<button class="key" onclick="press('${k}')">${k}</button>`).join("")}
    </div>
    <button class="primary-btn" onclick="saveExpense()">שמור הוצאה</button>
  </div>`;
}

function bindDashboardEvents(){
  if(state.envelopes.length){
    selectedEnvelopeId = selectedEnvelopeId || state.envelopes[0].id;
  }
}

function openSheet(envelopeId){
  amountStr = "0";
  selectedEnvelopeId = envelopeId || (state.envelopes[0] && state.envelopes[0].id);
  document.getElementById("amountDisplay").innerHTML = '0<span> ₪</span>';
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.toggle("selected", b.dataset.id === selectedEnvelopeId));
  document.getElementById("overlay").classList.add("open");
  document.getElementById("sheet").classList.add("open");
}
function closeSheet(){
  document.getElementById("overlay").classList.remove("open");
  document.getElementById("sheet").classList.remove("open");
}
function selectCat(id){
  selectedEnvelopeId = id;
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.toggle("selected", b.dataset.id === id));
}
function press(k){
  if(k === "⌫"){ amountStr = amountStr.slice(0,-1) || "0"; }
  else { amountStr = amountStr === "0" ? k : amountStr + k; }
  document.getElementById("amountDisplay").innerHTML = amountStr + '<span> ₪</span>';
}
function saveExpense(){
  const amt = Number(amountStr);
  if(!amt || !selectedEnvelopeId){ closeSheet(); return; }
  const env = state.envelopes.find(e => e.id === selectedEnvelopeId);
  if(env) env.spent += amt;
  state.transactions.unshift({
    id: "t"+Date.now()+Math.random().toString(16).slice(2),
    envelopeId: selectedEnvelopeId, amount: amt, note: env ? env.name : "הוצאה",
    who: me.name, date: new Date().toISOString(), icon: env ? env.icon : "💳"
  });
  saveData(state);
  closeSheet();
  render();
}

/* ===== boot ===== */
render();

if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}
