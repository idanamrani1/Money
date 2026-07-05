/* ============ התקציב שלנו v5 - Firebase sync ============ */

/* ---- Firebase ---- */
const firebaseConfig = {
  apiKey: "AIzaSyBiOp78xlg5ysvKhZ9UK0zFTv7zSmgey4g",
  authDomain: "moneymanage-8963b.firebaseapp.com",
  projectId: "moneymanage-8963b",
  storageBucket: "moneymanage-8963b.firebasestorage.app",
  messagingSenderId: "388008766113",
  appId: "1:388008766113:web:3cbf7e961ac64e42ec1ee0"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs:true }).catch(()=>{});
const FieldValue = firebase.firestore.FieldValue;

/* ---- constants ---- */
const USER_KEY = "budget_v5_user";
const CATEGORIES = [
  { id:"fuel",     name:"דלק",      icon:"⛽", color:"#fdf3e2", defLimit:600 },
  { id:"food",     name:"אוכל",     icon:"🛒", color:"#e2f7f2", defLimit:1500 },
  { id:"clothing", name:"ביגוד",    icon:"👕", color:"#eef1fb", defLimit:400 },
  { id:"bills",    name:"חשבונות",  icon:"🧾", color:"#fdeeeb", defLimit:1200,
    subs:["חשמל","מים","ארנונה","אינטרנט","גז","טלפון"] },
  { id:"fun",      name:"בילויים",  icon:"🎉", color:"#f6ecfa", defLimit:500 },
  { id:"health",   name:"בריאות",   icon:"💊", color:"#e8f6ec", defLimit:200 },
  { id:"home",     name:"לבית",     icon:"🏠", color:"#f0f0ea", defLimit:300 },
  { id:"other",    name:"אחר",      icon:"📦", color:"#f2f2f2", defLimit:300 },
];
const catOf = id => CATEGORIES.find(c => c.id === id);
const DEFAULT_PRESETS = [
  { id:"p1", name:"מים", amount:6, catId:"food", icon:"💧" },
  { id:"p2", name:"קפה", amount:12, catId:"food", icon:"☕" },
  { id:"p3", name:"חטיף", amount:8, catId:"food", icon:"🍫" },
];
const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const mk = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const mkLabel = key => { const [y,m] = key.split("-"); return `${HE_MONTHS[Number(m)-1]} ${y}`; };
const daysInMonth = d => new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
const fmt = n => Math.round(n).toLocaleString("he-IL");

/* ---- local user (name + budget code live on this device) ---- */
let me = JSON.parse(localStorage.getItem(USER_KEY) || "null");
const saveMe = () => localStorage.setItem(USER_KEY, JSON.stringify(me));

/* ---- synced state (mirror of Firestore doc) ---- */
let state = null;
let docRef = null;
let unsub = null;
let connecting = false;
let joinError = "";

let tab = "home";
let onboardStep = 1;
let draftName = "", draftTotal = 0, draftLimits = {};
let selCat = null, selSub = null, amountStr = "0";
let expandedMonth = null;
let toastTimer = null;

/* ---- firestore helpers ---- */
function newCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for(let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function upd(patch){ if(docRef) docRef.update(patch).catch(e=>console.error(e)); }

function connect(code){
  if(unsub) unsub();
  docRef = db.collection("budgets").doc(code);
  unsub = docRef.onSnapshot(snap=>{
    if(!snap.exists){
      if(me && me.code === code){ me = null; saveMe(); localStorage.removeItem(USER_KEY); }
      state = null; render(); return;
    }
    state = snap.data();
    ensureMonth();
    applyRecurring();
    render();
  }, err=>{ console.error(err); });
}

/* ---- month rollover (first device to open in a new month archives) ---- */
function ensureMonth(){
  if(!state || !docRef) return;
  const cur = mk(new Date());
  if(state.monthKey === cur) return;
  const spentBy = {};
  (state.transactions||[]).forEach(t => spentBy[t.catId] = (spentBy[t.catId]||0) + t.amount);
  const entry = {
    monthKey: state.monthKey, totalBudget: state.totalBudget,
    limits: {...state.limits}, spentBy,
    totalSpent: Object.values(spentBy).reduce((a,b)=>a+b,0),
    txCount: (state.transactions||[]).length
  };
  upd({ monthKey: cur, transactions: [], history: [entry, ...(state.history||[])] });
}

/* ---- recurring auto-apply ---- */
function applyRecurring(){
  if(!state || !state.recurring || !state.recurring.length || !docRef) return;
  const today = new Date().getDate();
  const toAdd = [];
  state.recurring.forEach(r=>{
    const already = (state.transactions||[]).some(t=>t.recId===r.id);
    if(!already && today >= r.day){
      toAdd.push({
        id: "t"+Date.now()+Math.random().toString(16).slice(2),
        recId: r.id, catId: r.catId, sub:null, amount: r.amount,
        label: r.name + " (קבוע)", who: "אוטומטי",
        date: new Date(new Date().getFullYear(), new Date().getMonth(), r.day, 8).toISOString()
      });
    }
  });
  if(toAdd.length) upd({ transactions: FieldValue.arrayUnion(...toAdd) });
}

/* ---- derived ---- */
function txSorted(){ return [...(state.transactions||[])].sort((a,b)=> new Date(b.date)-new Date(a.date)); }
function spentOf(catId){ return (state.transactions||[]).filter(t=>t.catId===catId).reduce((s,t)=>s+t.amount,0); }
function totalSpent(){ return (state.transactions||[]).reduce((s,t)=>s+t.amount,0); }

/* ============ RENDER ============ */
function render(){
  const root = document.getElementById("app");
  if(!me){ root.innerHTML = onboardHTML(); return; }
  if(!state){ root.innerHTML = loadingHTML(); return; }
  let inner = tab==="home" ? homeHTML() : tab==="history" ? historyHTML() : settingsHTML();
  root.innerHTML = inner + navHTML() + sheetHTML();
}
function loadingHTML(){
  return `<div class="onboard" style="justify-content:center;align-items:center;text-align:center">
    <div>
      <div style="font-size:44px;margin-bottom:14px">💸</div>
      <h2 style="margin-bottom:8px">מתחברים לתקציב...</h2>
      <p class="sub">קוד: <b>${me.code}</b></p>
      <button class="ghost-btn" style="max-width:220px" onclick="leaveBudget()">התנתק ונסה קוד אחר</button>
    </div>
  </div>`;
}
function leaveBudget(){
  if(unsub) unsub();
  me = null; state = null; localStorage.removeItem(USER_KEY);
  onboardStep = 1; render();
}

/* ===== onboarding: name → create-or-join ===== */
function onboardHTML(){
  if(onboardStep===1){
    return `<div class="onboard">
      <div class="step-progress"><div class="active"></div><div></div></div>
      <div class="onboard-body">
        <h2>נעים להכיר 👋</h2>
        <p class="sub">השם ישמש לתיוג ההוצאות שלך, כדי ששניכם תדעו מי הוציא מה.</p>
        <div class="field"><label>השם שלך</label><input id="obName" type="text" placeholder="עידן" value="${draftName}"></div>
      </div>
      <button class="primary-btn" onclick="obName()">המשך</button>
    </div>`;
  }
  if(onboardStep===2){
    return `<div class="onboard">
      <div class="step-progress"><div class="active"></div><div class="active"></div></div>
      <div class="onboard-body">
        <h2>תקציב משותף</h2>
        <p class="sub">אחד מכם יוצר תקציב ומקבל קוד. השני מזין את הקוד ומצטרף - ומאז שניכם רואים הכל ביחד, בזמן אמת.</p>
        <button class="primary-btn" onclick="startCreate()">🆕 צור תקציב חדש</button>
        <div style="text-align:center;color:var(--muted);font-size:13px;margin:16px 0">- או -</div>
        <div class="field"><label>קוד הצטרפות שקיבלת</label>
          <input id="joinCode" type="text" placeholder="למשל: X7K2P9" style="text-align:center;letter-spacing:3px;text-transform:uppercase" maxlength="6"></div>
        ${joinError?`<div class="alloc-note neg">${joinError}</div>`:""}
        <button class="ghost-btn" onclick="joinBudget()">הצטרף לתקציב קיים</button>
      </div>
    </div>`;
  }
  /* step 3: create - total + limits */
  const rows = CATEGORIES.map(c=>`
    <div class="set-row">
      <span>${c.icon} ${c.name}</span>
      <input type="number" inputmode="numeric" value="${draftLimits[c.id]}"
        oninput="draftLimits['${c.id}']=Number(this.value)||0; updAlloc()">
    </div>`).join("");
  return `<div class="onboard">
    <div class="step-progress"><div class="active"></div><div class="active"></div></div>
    <div class="onboard-body">
      <h2>הגדרת התקציב</h2>
      <div class="field"><label>תקציב חודשי כולל (₪)</label>
        <input id="obTotal" type="number" inputmode="numeric" value="${draftTotal||""}" placeholder="6000"
          oninput="draftTotal=Number(this.value)||0; reDraft()"></div>
      <div class="set-title">חלוקה לקטגוריות</div>
      <div class="set-group">${rows}</div>
      <div class="alloc-note" id="allocNote"></div>
    </div>
    <button class="primary-btn" onclick="createBudget()">צור והתחל ✓</button>
  </div>`;
}
function obName(){
  draftName = document.getElementById("obName").value.trim() || "אני";
  onboardStep = 2; joinError=""; render();
}
function startCreate(){
  const defSum = CATEGORIES.reduce((s,c)=>s+c.defLimit,0);
  draftTotal = draftTotal || 6000;
  CATEGORIES.forEach(c=> draftLimits[c.id] = Math.round(c.defLimit*draftTotal/defSum));
  onboardStep = 3; render(); updAlloc();
}
function reDraft(){
  const defSum = CATEGORIES.reduce((s,c)=>s+c.defLimit,0);
  CATEGORIES.forEach(c=> draftLimits[c.id] = draftTotal>0 ? Math.round(c.defLimit*draftTotal/defSum) : c.defLimit);
  const inputs = document.querySelectorAll(".set-group input");
  CATEGORIES.forEach((c,i)=>{ if(inputs[i]) inputs[i].value = draftLimits[c.id]; });
  updAlloc();
}
function updAlloc(){
  const el = document.getElementById("allocNote"); if(!el) return;
  const sum = Object.values(draftLimits).reduce((a,b)=>a+b,0);
  const diff = draftTotal - sum;
  el.className = "alloc-note" + (diff<0 ? " neg" : "");
  el.textContent = diff>=0 ? `נשארו ${fmt(diff)} ₪ לחלוקה` : `חילקתם ${fmt(-diff)} ₪ מעבר לתקציב`;
}
async function createBudget(){
  draftTotal = Number(document.getElementById("obTotal").value)||draftTotal||0;
  const code = newCode();
  const doc = {
    createdAt: new Date().toISOString(),
    monthKey: mk(new Date()),
    totalBudget: draftTotal,
    limits: {...draftLimits},
    transactions: [], history: [],
    presets: DEFAULT_PRESETS.map(p=>({...p})),
    recurring: [],
    members: [draftName]
  };
  try{
    await db.collection("budgets").doc(code).set(doc);
    me = { name: draftName, code }; saveMe();
    connect(code);
  }catch(e){ alert("שגיאה ביצירה: "+e.message); }
}
async function joinBudget(){
  const code = (document.getElementById("joinCode").value||"").trim().toUpperCase();
  if(code.length!==6){ joinError="קוד צריך להיות 6 תווים"; render(); return; }
  try{
    const snap = await db.collection("budgets").doc(code).get();
    if(!snap.exists){ joinError="לא נמצא תקציב עם הקוד הזה"; render(); return; }
    me = { name: draftName, code }; saveMe();
    upd; /* noop */
    db.collection("budgets").doc(code).update({ members: FieldValue.arrayUnion(draftName) }).catch(()=>{});
    connect(code);
  }catch(e){ joinError = "שגיאה: "+e.message; render(); }
}

/* ===== SVG donut ===== */
const CAT_CHART_COLORS = { fuel:"#e8a33d", food:"#17c3a2", clothing:"#7b8fe0", bills:"#e5604c",
  fun:"#c17bd6", health:"#5bbf7a", home:"#a5a08a", other:"#9aa3ab" };
function donutHTML(spentBy){
  const entries = Object.entries(spentBy).filter(([,v])=>v>0);
  const total = entries.reduce((s,[,v])=>s+v,0);
  if(!total) return "";
  const R=54, CX=70, CY=70, C=2*Math.PI*R;
  let offset=0;
  const segs = entries.map(([id,v])=>{
    const frac=v/total;
    const seg=`<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${CAT_CHART_COLORS[id]||"#ccc"}" stroke-width="22"
      stroke-dasharray="${(frac*C).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-offset*C).toFixed(1)}"
      transform="rotate(-90 ${CX} ${CY})"/>`;
    offset+=frac; return seg;
  }).join("");
  const legend = entries.sort((a,b)=>b[1]-a[1]).map(([id,v])=>{
    const c=catOf(id);
    return `<div class="lg-row"><span class="lg-dot" style="background:${CAT_CHART_COLORS[id]||"#ccc"}"></span>
      <span class="lg-name">${c?c.icon+" "+c.name:id}</span>
      <span class="lg-val">${fmt(v)} ₪ · ${Math.round(v/total*100)}%</span></div>`;
  }).join("");
  return `<div class="donut-wrap">
    <svg viewBox="0 0 140 140" class="donut">${segs}
      <text x="${CX}" y="${CY-4}" text-anchor="middle" class="donut-total">${fmt(total)}</text>
      <text x="${CX}" y="${CY+14}" text-anchor="middle" class="donut-sub">₪ סה"כ</text>
    </svg>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

/* ===== home ===== */
function homeHTML(){
  const now = new Date();
  const spent = totalSpent();
  const remain = state.totalBudget - spent;
  const day = now.getDate(), dim = daysInMonth(now);
  const daysLeft = dim - day + 1;
  const dailyAllow = daysLeft>0 ? remain/daysLeft : 0;
  const pace = day>0 ? spent/day : 0;
  const projDiff = state.totalBudget - pace*dim;
  const pct = Math.min(100, Math.round(spent/(state.totalBudget||1)*100));
  const fillCls = pct>=100?"fill-over":pct>=80?"fill-warn":"fill-ok";
  const txs = txSorted();

  const catsHTML = CATEGORIES.map(c=>{
    const sp = spentOf(c.id), lim = state.limits[c.id]||0, rm = lim-sp;
    const p = Math.round(sp/(lim||1)*100);
    const f = p>=100?"fill-over":p>=80?"fill-warn":"fill-ok";
    return `<div class="cat-row" onclick="openSheet('${c.id}')">
      <div class="cat-row-top">
        <div class="cat-id">
          <div class="cat-ic" style="background:${c.color}">${c.icon}</div>
          <div><div class="cat-name">${c.name}</div>
          ${c.subs?`<div class="cat-sub">${c.subs.slice(0,4).join(" · ")}</div>`:""}</div>
        </div>
        <div class="cat-left">
          <div class="cat-remain ${rm<0?"neg":""}">${rm<0?`-${fmt(-rm)}`:fmt(rm)} ₪</div>
          <div class="cat-of">מתוך ${fmt(lim)}</div>
        </div>
      </div>
      <div class="cat-bar"><div class="cat-bar-fill ${f}" style="width:${Math.min(100,p)}%"></div></div>
    </div>`;
  }).join("");

  const recent = txs.slice(0,8);
  const txHTML = recent.length ? recent.map(t=>txRowHTML(t)).join("")
    : `<div class="empty-note">אין עדיין הוצאות החודש.<br>לחצו + כדי להוסיף את הראשונה.</div>`;

  const insights = [];
  insights.push(`<div class="insight"><div class="i-ic">📅</div><div class="i-txt">נשארו <b>${daysLeft} ימים</b> לחודש - אפשר להוציא בממוצע <b>${fmt(Math.max(0,dailyAllow))} ₪ ליום</b> כדי להישאר בתקציב.</div></div>`);
  if(spent>0){
    insights.push(`<div class="insight"><div class="i-ic">${projDiff>=0?"📈":"⚠️"}</div><div class="i-txt">${projDiff>=0
      ? `בקצב הנוכחי תסיימו את החודש עם <b>${fmt(projDiff)} ₪ בפלוס</b>.`
      : `בקצב הנוכחי תחרגו בכ-<b>${fmt(-projDiff)} ₪</b> עד סוף החודש.`}</div></div>`);
    const by={}; (state.transactions||[]).forEach(t=>by[t.catId]=(by[t.catId]||0)+t.amount);
    const top = Object.entries(by).sort((a,b)=>b[1]-a[1])[0];
    if(top){ const c=catOf(top[0]);
      insights.push(`<div class="insight"><div class="i-ic">${c.icon}</div><div class="i-txt">הקטגוריה עם הכי הרבה הוצאות החודש: <b>${c.name}</b> - ${fmt(top[1])} ₪.</div></div>`);
    }
    const prev = (state.history||[])[0];
    if(prev && prev.totalSpent>0){
      const prevPace = prev.totalSpent*(day/dim);
      const diff = spent - prevPace;
      const pctDiff = Math.round(Math.abs(diff)/prevPace*100);
      if(pctDiff>=5){
        insights.push(`<div class="insight"><div class="i-ic">${diff<0?"👏":"👀"}</div><div class="i-txt">${diff<0
          ? `אתם מוציאים <b>${pctDiff}% פחות</b> מאשר בשלב הזה ב${mkLabel(prev.monthKey).split(" ")[0]}.`
          : `אתם מוציאים <b>${pctDiff}% יותר</b> מאשר בשלב הזה ב${mkLabel(prev.monthKey).split(" ")[0]}.`}</div></div>`);
      }
    }
  }

  const members = (state.members||[]).join(" ו");

  return `<div class="screen">
    <div class="topbar">
      <div>
        <div class="greet">שלום, ${members||me.name} 👋</div>
        <div class="month-title">${mkLabel(state.monthKey)}</div>
      </div>
      <div class="icon-btn" onclick="setTab('settings')">⚙️</div>
    </div>

    <div class="hero">
      <div class="hero-label">נשאר לכם החודש</div>
      <div class="hero-amount ${remain>=0?"pos":"neg"}">${remain<0?"-":""}${fmt(Math.abs(remain))} ₪</div>
      <div class="hero-of">מתוך תקציב של ${fmt(state.totalBudget)} ₪</div>
      <div class="hero-bar"><div class="hero-bar-fill ${fillCls}" style="width:${pct}%"></div></div>
    </div>

    <div class="pills">
      <div class="pill"><div class="p-label">יצא החודש</div><div class="p-val">${fmt(spent)} ₪</div></div>
      <div class="pill"><div class="p-label">ליום שנשאר</div><div class="p-val ${dailyAllow>=0?"pos":"neg"}">${fmt(Math.max(0,dailyAllow))} ₪</div></div>
      <div class="pill"><div class="p-label">תנועות</div><div class="p-val">${(state.transactions||[]).length}</div></div>
    </div>

    ${state.presets && state.presets.length ? `
    <div class="section-head"><h3>הוצאה בלחיצה</h3><span class="link" onclick="setTab('settings')">עריכה</span></div>
    <div class="preset-row">
      ${state.presets.map(p=>`<div class="preset-chip" onclick="quickAdd('${p.id}')">
        <span class="pc-ic">${p.icon}</span><span>${p.name}</span><b>${p.amount} ₪</b></div>`).join("")}
    </div>` : ""}

    ${insights.join("")}

    <div class="section-head" style="margin-top:20px"><h3>קטגוריות</h3></div>
    <div class="cats">${catsHTML}</div>

    <div class="section-head"><h3>תנועות אחרונות</h3>${(state.transactions||[]).length>8?`<span class="link" onclick="setTab('history')">הכל</span>`:""}</div>
    <div class="tx-list">${txHTML}</div>
  </div>
  <button class="fab" onclick="openSheet()">+</button>`;
}

function txRowHTML(t, compact){
  const c = catOf(t.catId);
  const d = new Date(t.date);
  const when = compact
    ? `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}`
    : `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} · ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `<div class="tx">
    <div class="tx-right">
      <div class="tx-ic" style="background:${c?c.color:"#f2f2f2"}">${c?c.icon:"💳"}</div>
      <div style="min-width:0"><div class="tx-name">${t.label}</div><div class="tx-meta">${t.who} · ${when}</div></div>
    </div>
    <div style="display:flex;align-items:center">
      <div class="tx-amt">-${fmt(t.amount)} ₪</div>
      <div class="tx-del" onclick="event.stopPropagation(); delTx('${t.id}')">🗑️</div>
    </div>
  </div>`;
}

/* ===== history ===== */
function historyHTML(){
  const txs = txSorted();
  const curTx = txs.map(t=>txRowHTML(t,true)).join("") || `<div class="empty-note">אין תנועות החודש.</div>`;
  const curBy={}; (state.transactions||[]).forEach(t=>curBy[t.catId]=(curBy[t.catId]||0)+t.amount);
  const curDonut = donutHTML(curBy);

  const hist = state.history||[];
  const past = hist.length ? hist.map((h,i)=>{
    const diff = h.totalBudget - h.totalSpent;
    const open = expandedMonth===i;
    const breakdown = open ? `<div class="month-breakdown">
      ${donutHTML(h.spentBy)}
      ${CATEGORIES.filter(c=>h.spentBy[c.id]).map(c=>`
        <div class="mb-row"><span>${c.icon} ${c.name}</span><span>${fmt(h.spentBy[c.id])} ₪ מתוך ${fmt(h.limits[c.id]||0)}</span></div>`).join("")}
      <div class="mb-row" style="font-weight:700;border-top:1px solid var(--line);padding-top:7px">
        <span>סה"כ</span><span>${fmt(h.totalSpent)} ₪ מתוך ${fmt(h.totalBudget)}</span></div>
    </div>` : "";
    return `<div class="month-card" onclick="toggleMonth(${i})">
      <div class="month-card-top">
        <h4>${mkLabel(h.monthKey)}</h4>
        <span class="badge ${diff>=0?"pos":"neg"}">${diff>=0?`+${fmt(diff)} ₪ נשאר`:`${fmt(diff)} ₪ חריגה`}</span>
      </div>${breakdown}</div>`;
  }).join("") : `<div class="empty-note">עוד אין חודשים קודמים.<br>בתחילת החודש הבא, החודש הנוכחי יישמר כאן אוטומטית.</div>`;

  return `<div class="screen">
    <div class="topbar"><div class="month-title">היסטוריה</div></div>
    <div class="section-head"><h3>החודש הנוכחי - ${mkLabel(state.monthKey)}</h3></div>
    ${curDonut?`<div class="month-card" style="cursor:default">${curDonut}</div>`:""}
    <div class="tx-list" style="margin-bottom:24px">${curTx}</div>
    <div class="section-head"><h3>חודשים קודמים</h3></div>
    ${past}
  </div>`;
}
function toggleMonth(i){ expandedMonth = expandedMonth===i?null:i; render(); }

/* ===== settings ===== */
function settingsHTML(){
  const rows = CATEGORIES.map(c=>`
    <div class="set-row"><span>${c.icon} ${c.name}</span>
      <input type="number" inputmode="numeric" value="${state.limits[c.id]||0}"
        onchange="setLimit('${c.id}', this.value)">
    </div>`).join("");
  return `<div class="screen">
    <div class="topbar"><div class="month-title">הגדרות</div></div>

    <div class="set-title">תקציב משותף</div>
    <div class="set-group">
      <div class="set-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <span style="font-size:13px;color:var(--muted)">קוד הצטרפות - שלחו לבן/בת הזוג:</span>
        <div class="code-box" onclick="copyCode()">${me.code} <span style="font-size:12px;color:var(--muted)">(לחיצה מעתיקה)</span></div>
        <span style="font-size:12px;color:var(--muted)">בטלפון השני: פותחים את האפליקציה → "הצטרף לתקציב קיים" → מזינים את הקוד.</span>
      </div>
      <div class="set-row"><span>מחוברים</span><span style="font-weight:700">${(state.members||[]).join(", ")}</span></div>
    </div>

    <div class="set-title">תקציב חודשי כולל</div>
    <div class="set-group">
      <div class="set-row"><span>💰 סכום כולל (₪)</span>
        <input type="number" inputmode="numeric" value="${state.totalBudget}"
          onchange="upd({totalBudget: Number(this.value)||0})"></div>
    </div>

    <div class="set-title">תקרה לכל קטגוריה (₪)</div>
    <div class="set-group">${rows}</div>

    <div class="set-title">הוצאות קבועות (נכנסות אוטומטית כל חודש)</div>
    <div class="set-group">
      ${(state.recurring||[]).length ? state.recurring.map((r,i)=>`
      <div class="set-row" style="flex-wrap:wrap;gap:8px">
        <span style="display:flex;gap:8px;align-items:center;flex:1;min-width:0">
          <input type="text" value="${r.name}" style="width:104px;text-align:right"
            onchange="editRec(${i},'name',this.value)">
          <select onchange="editRec(${i},'catId',this.value)"
            style="padding:8px;border-radius:10px;border:1.5px solid var(--line);background:var(--bg);font-family:'Heebo';font-size:13px">
            ${CATEGORIES.map(c=>`<option value="${c.id}" ${r.catId===c.id?"selected":""}>${c.icon} ${c.name}</option>`).join("")}
          </select>
        </span>
        <span style="display:flex;gap:8px;align-items:center">
          <input type="number" inputmode="numeric" value="${r.amount}" style="width:70px"
            onchange="editRec(${i},'amount',Number(this.value)||1)">
          <span style="font-size:12px;color:var(--muted)">ביום</span>
          <input type="number" inputmode="numeric" value="${r.day}" min="1" max="28" style="width:52px"
            onchange="editRec(${i},'day',Math.min(28,Math.max(1,Number(this.value)||1)))">
          <span style="color:var(--red);cursor:pointer;padding:4px" onclick="delRecurring(${i})">✕</span>
        </span>
      </div>`).join("") : `<div class="set-row" style="color:var(--muted);font-size:13px">אין עדיין - למשל: שכירות, חשמל, ספוטיפיי</div>`}
      <div class="set-row" style="justify-content:center;color:var(--mint);font-weight:700;cursor:pointer"
        onclick="addRecurring()">+ הוסף הוצאה קבועה</div>
    </div>

    <div class="set-title">הוצאות בלחיצה (מים, קפה, קטנות...)</div>
    <div class="set-group">
      ${(state.presets||[]).map((p,i)=>`
      <div class="set-row">
        <span style="display:flex;gap:8px;align-items:center">
          <input type="text" value="${p.icon}" style="width:44px" onchange="editPreset(${i},'icon',this.value||'💸')">
          <input type="text" value="${p.name}" style="width:90px;text-align:right" onchange="editPreset(${i},'name',this.value||'הוצאה')">
        </span>
        <span style="display:flex;gap:8px;align-items:center">
          <input type="number" inputmode="numeric" value="${p.amount}" style="width:66px" onchange="editPreset(${i},'amount',Number(this.value)||1)">
          <span style="color:var(--red);cursor:pointer;padding:4px" onclick="delPreset(${i})">✕</span>
        </span>
      </div>`).join("")}
      <div class="set-row" style="justify-content:center;color:var(--mint);font-weight:700;cursor:pointer"
        onclick="addPreset()">+ הוסף הוצאה מהירה</div>
    </div>

    <div class="set-title">השם שלי במכשיר הזה</div>
    <div class="set-group">
      <div class="set-row"><span>שם</span>
        <input type="text" value="${me.name}" onchange="renameMe(this.value)"></div>
    </div>

    <button class="ghost-btn" onclick="leaveBudget()">התנתק מהתקציב במכשיר הזה</button>
    <button class="danger-btn" onclick="deleteBudget()">מחיקת התקציב לצמיתות (לשניכם)</button>
  </div>`;
}
function setLimit(id, v){ const limits = {...state.limits}; limits[id]=Number(v)||0; upd({limits}); }
function editRec(i,k,v){ const r=[...state.recurring]; r[i]={...r[i],[k]:v}; upd({recurring:r}); }
function addRecurring(){ upd({recurring: FieldValue.arrayUnion({id:'r'+Date.now(),name:'חדש',amount:100,catId:'bills',day:1})}); }
function delRecurring(i){
  const r = state.recurring[i];
  if(!confirm(`למחוק את "${r.name}"? ההוצאה שכבר נרשמה החודש תימחק גם.`)) return;
  const txs = (state.transactions||[]).filter(t=>t.recId!==r.id);
  const rec = state.recurring.filter((_,j)=>j!==i);
  upd({transactions: txs, recurring: rec});
}
function editPreset(i,k,v){ const p=[...state.presets]; p[i]={...p[i],[k]:v}; upd({presets:p}); }
function addPreset(){ upd({presets: FieldValue.arrayUnion({id:'p'+Date.now(),name:'חדש',amount:10,catId:'other',icon:'💸'})}); }
function delPreset(i){ upd({presets: state.presets.filter((_,j)=>j!==i)}); }
function renameMe(v){
  const old = me.name;
  me.name = v||'אני'; saveMe();
  const members = (state.members||[]).map(m=>m===old?me.name:m);
  upd({members});
}
function copyCode(){
  navigator.clipboard && navigator.clipboard.writeText(me.code);
  showToast("הקוד הועתק 📋", null);
}
async function deleteBudget(){
  if(!confirm("בטוח?? כל הנתונים יימחקו לצמיתות אצל שניכם.")) return;
  if(!confirm("אין דרך חזרה. למחוק?")) return;
  await docRef.delete();
  leaveBudget();
}

/* ===== nav ===== */
function navHTML(){
  const items=[["home","🏠","בית"],["history","🗂️","היסטוריה"],["settings","⚙️","הגדרות"]];
  return `<div class="bottom-nav">${items.map(([id,ic,lb])=>
    `<div class="nav-item ${tab===id?"active":""}" onclick="setTab('${id}')"><span class="n-ic">${ic}</span>${lb}</div>`).join("")}</div>`;
}
function setTab(t){ tab=t; expandedMonth=null; render(); window.scrollTo(0,0); }

/* ===== add-expense sheet ===== */
function sheetHTML(){
  const cat = catOf(selCat);
  const subsHTML = cat && cat.subs ? `<div class="sub-row">${cat.subs.map(s=>
    `<div class="sub-chip ${selSub===s?"selected":""}" onclick="pickSub('${s}')">${s}</div>`).join("")}</div>` : "";
  return `
  <div class="sheet-overlay" id="ovl" onclick="closeSheet()"></div>
  <div class="sheet" id="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-amount" id="amt">${amountStr}<span> ₪</span></div>
    <div class="sheet-hint">בחרו קטגוריה והזינו סכום</div>
    <div class="cat-grid">${CATEGORIES.map(c=>
      `<div class="cat-btn ${selCat===c.id?"selected":""}" onclick="pickCat('${c.id}')"><span class="ic">${c.icon}</span>${c.name}</div>`).join("")}
    </div>
    ${subsHTML}
    <input class="note-input" id="noteInput" type="text" placeholder="הערה (לא חובה) - למשל: סופר שופרסל">
    <div class="keypad">${["1","2","3","4","5","6","7","8","9","⌫","0","00"].map(k=>
      `<button class="key" onclick="press('${k}')">${k}</button>`).join("")}
    </div>
    <button class="primary-btn" onclick="saveTx()">שמור הוצאה</button>
  </div>`;
}
function openSheet(catId){
  selCat = catId || CATEGORIES[0].id; selSub=null; amountStr="0";
  render();
  document.getElementById("ovl").classList.add("open");
  document.getElementById("sheet").classList.add("open");
}
function closeSheet(){
  const o=document.getElementById("ovl"), s=document.getElementById("sheet");
  if(o) o.classList.remove("open");
  if(s) s.classList.remove("open");
}
function reopenSheet(note){
  render();
  document.getElementById("ovl").classList.add("open");
  document.getElementById("sheet").classList.add("open");
  document.getElementById("noteInput").value = note;
  document.getElementById("amt").innerHTML = amountStr + '<span> ₪</span>';
}
function pickCat(id){
  const note = document.getElementById("noteInput").value;
  selCat=id; selSub=null;
  reopenSheet(note);
}
function pickSub(s){
  const note = document.getElementById("noteInput").value;
  selSub = selSub===s?null:s;
  reopenSheet(note);
}
function press(k){
  if(k==="⌫") amountStr = amountStr.slice(0,-1)||"0";
  else amountStr = amountStr==="0"?k:(amountStr+k).slice(0,7);
  document.getElementById("amt").innerHTML = amountStr + '<span> ₪</span>';
}
function saveTx(){
  const amt = Number(amountStr);
  if(!amt){ closeSheet(); return; }
  const c = catOf(selCat);
  const note = document.getElementById("noteInput").value.trim();
  const label = note || (selSub ? `${c.name} - ${selSub}` : c.name);
  const tx = {
    id: "t"+Date.now()+Math.random().toString(16).slice(2),
    catId: selCat, sub: selSub||null, amount: amt, label,
    who: me.name, date: new Date().toISOString()
  };
  upd({transactions: FieldValue.arrayUnion(tx)});
  closeSheet();
}
function delTx(id){
  const t = (state.transactions||[]).find(x=>x.id===id);
  if(!t) return;
  if(confirm(`למחוק את ההוצאה "${t.label}" (${fmt(t.amount)} ₪)?`)){
    upd({transactions: FieldValue.arrayRemove(t)});
  }
}

/* ===== quick add + toast ===== */
function quickAdd(pid){
  const p = state.presets.find(x=>x.id===pid);
  if(!p) return;
  const tx = {
    id: "t"+Date.now()+Math.random().toString(16).slice(2),
    catId: p.catId, sub:null, amount: p.amount, label: p.name,
    who: me.name, date: new Date().toISOString()
  };
  upd({transactions: FieldValue.arrayUnion(tx)});
  showToast(`${p.icon} ${p.name} - ${p.amount} ₪ נרשם`, tx.id);
}
function showToast(msg, txId){
  const old=document.getElementById("toast"); if(old) old.remove();
  clearTimeout(toastTimer);
  const t=document.createElement("div");
  t.id="toast"; t.className="toast";
  t.innerHTML = `<span>${msg}</span>${txId?`<b onclick="undoTx('${txId}')">ביטול</b>`:""}`;
  document.getElementById("app").appendChild(t);
  toastTimer = setTimeout(()=>{ t.classList.add("out"); setTimeout(()=>t.remove(),300); }, 3500);
}
function undoTx(id){
  const t=(state.transactions||[]).find(x=>x.id===id);
  if(t) upd({transactions: FieldValue.arrayRemove(t)});
  const el=document.getElementById("toast"); if(el) el.remove();
}

/* ===== boot ===== */
if(me && me.code) connect(me.code);
render();
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=> navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
