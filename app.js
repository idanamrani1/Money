/* ============ מעטפות v2 - Rise-Up style ============ */
const DATA_KEY = "budget_v2_data";
const USER_KEY = "budget_v2_user";

/* Built-in categories. חשבונות has sub-items */
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

const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const mk = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const mkLabel = key => { const [y,m] = key.split("-"); return `${HE_MONTHS[Number(m)-1]} ${y}`; };
const daysInMonth = d => new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
const fmt = n => Math.round(n).toLocaleString("he-IL");

let state = JSON.parse(localStorage.getItem(DATA_KEY) || "null");
let me = JSON.parse(localStorage.getItem(USER_KEY) || "null");
const save = () => localStorage.setItem(DATA_KEY, JSON.stringify(state));
const saveMe = () => localStorage.setItem(USER_KEY, JSON.stringify(me));

let tab = "home";            // home | history | settings
let onboardStep = 1;
let draftTotal = 0;
let draftLimits = {};
let selCat = null, selSub = null, amountStr = "0";
let expandedMonth = null;

/* ===== month rollover: archive & reset ===== */
function ensureMonth(){
  if(!state) return;
  const cur = mk(new Date());
  if(state.monthKey === cur) return;
  const spentBy = {};
  state.transactions.forEach(t => spentBy[t.catId] = (spentBy[t.catId]||0) + t.amount);
  state.history.unshift({
    monthKey: state.monthKey,
    totalBudget: state.totalBudget,
    limits: {...state.limits},
    spentBy,
    totalSpent: Object.values(spentBy).reduce((a,b)=>a+b,0),
    txCount: state.transactions.length
  });
  state.transactions = [];
  state.monthKey = cur;
  save();
}

/* ===== derived ===== */
function spentOf(catId){ return state.transactions.filter(t=>t.catId===catId).reduce((s,t)=>s+t.amount,0); }
function totalSpent(){ return state.transactions.reduce((s,t)=>s+t.amount,0); }

/* ============ RENDER ============ */
function render(){
  const root = document.getElementById("app");
  if(!me || !state){ root.innerHTML = onboardHTML(); return; }
  ensureMonth();
  let inner = "";
  if(tab==="home") inner = homeHTML();
  else if(tab==="history") inner = historyHTML();
  else inner = settingsHTML();
  root.innerHTML = inner + navHTML() + sheetHTML();
}

/* ===== onboarding ===== */
function onboardHTML(){
  if(onboardStep===1){
    return `<div class="onboard">
      <div class="step-progress"><div class="active"></div><div></div></div>
      <div class="onboard-body">
        <h2>נעים להכיר 👋</h2>
        <p class="sub">האפליקציה מתייגת כל הוצאה לפי מי שהזין אותה, אז נתחיל מהשמות.</p>
        <div class="field"><label>השם שלך</label><input id="obName" type="text" placeholder="עידן"></div>
        <div class="field"><label>בן/בת זוג (לא חובה)</label><input id="obPartner" type="text" placeholder="—"></div>
        <div class="field"><label>תקציב חודשי כולל (₪)</label><input id="obTotal" type="number" inputmode="numeric" placeholder="6000"></div>
      </div>
      <button class="primary-btn" onclick="obNext()">המשך</button>
    </div>`;
  }
  const rows = CATEGORIES.map(c=>`
    <div class="set-row">
      <span>${c.icon} ${c.name}</span>
      <input type="number" inputmode="numeric" value="${draftLimits[c.id]}"
        oninput="draftLimits['${c.id}']=Number(this.value)||0; updAlloc()">
    </div>`).join("");
  return `<div class="onboard">
    <div class="step-progress"><div class="active"></div><div class="active"></div></div>
    <div class="onboard-body">
      <h2>חלוקת התקציב</h2>
      <p class="sub">חלקו ${fmt(draftTotal)} ₪ בין הקטגוריות. אפשר לשנות בכל רגע בהגדרות.</p>
      <div class="set-group">${rows}</div>
      <div class="alloc-note" id="allocNote"></div>
    </div>
    <button class="primary-btn" onclick="obFinish()">סיימו והתחילו ✓</button>
  </div>`;
}
function obNext(){
  const name = document.getElementById("obName").value.trim() || "אני";
  const partner = document.getElementById("obPartner").value.trim() || null;
  draftTotal = Number(document.getElementById("obTotal").value) || 0;
  me = { name, partner }; saveMe();
  const defSum = CATEGORIES.reduce((s,c)=>s+c.defLimit,0);
  CATEGORIES.forEach(c=>{
    draftLimits[c.id] = draftTotal>0 ? Math.round(c.defLimit*draftTotal/defSum) : c.defLimit;
  });
  onboardStep = 2; render(); updAlloc();
}
function updAlloc(){
  const el = document.getElementById("allocNote"); if(!el) return;
  const sum = Object.values(draftLimits).reduce((a,b)=>a+b,0);
  const diff = draftTotal - sum;
  el.className = "alloc-note" + (diff<0 ? " neg" : "");
  el.textContent = diff>=0 ? `נשארו ${fmt(diff)} ₪ לחלוקה` : `חילקתם ${fmt(-diff)} ₪ מעבר לתקציב`;
}
function obFinish(){
  state = { monthKey: mk(new Date()), totalBudget: draftTotal, limits: {...draftLimits}, transactions: [], history: [] };
  save(); render();
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
  const projected = pace*dim;
  const projDiff = state.totalBudget - projected;
  const pct = Math.min(100, Math.round(spent/(state.totalBudget||1)*100));
  const fillCls = pct>=100 ? "fill-over" : pct>=80 ? "fill-warn" : "fill-ok";

  const catsHTML = CATEGORIES.map(c=>{
    const sp = spentOf(c.id), lim = state.limits[c.id]||0, rm = lim - sp;
    const p = Math.round(sp/(lim||1)*100);
    const f = p>=100 ? "fill-over" : p>=80 ? "fill-warn" : "fill-ok";
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

  const txs = state.transactions.slice(0,8);
  const txHTML = txs.length ? txs.map(t=>{
    const c = catOf(t.catId);
    const d = new Date(t.date);
    const when = `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} · ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    return `<div class="tx">
      <div class="tx-right">
        <div class="tx-ic" style="background:${c?c.color:"#f2f2f2"}">${c?c.icon:"💳"}</div>
        <div style="min-width:0">
          <div class="tx-name">${t.label}</div>
          <div class="tx-meta">${t.who} · ${when}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center">
        <div class="tx-amt">-${fmt(t.amount)} ₪</div>
        <div class="tx-del" onclick="event.stopPropagation(); delTx('${t.id}')">🗑️</div>
      </div>
    </div>`;
  }).join("") : `<div class="empty-note">אין עדיין הוצאות החודש.<br>לחצו + כדי להוסיף את הראשונה.</div>`;

  /* insights */
  const insights = [];
  insights.push(`<div class="insight"><div class="i-ic">📅</div><div class="i-txt">נשארו <b>${daysLeft} ימים</b> לחודש - אפשר להוציא בממוצע <b>${fmt(Math.max(0,dailyAllow))} ₪ ליום</b> כדי להישאר בתקציב.</div></div>`);
  if(spent>0){
    insights.push(`<div class="insight"><div class="i-ic">${projDiff>=0?"📈":"⚠️"}</div><div class="i-txt">${projDiff>=0
      ? `בקצב הנוכחי תסיימו את החודש עם <b>${fmt(projDiff)} ₪ בפלוס</b>.`
      : `בקצב הנוכחי תחרגו בכ-<b>${fmt(-projDiff)} ₪</b> עד סוף החודש.`}</div></div>`);
    const by = {}; state.transactions.forEach(t=>by[t.catId]=(by[t.catId]||0)+t.amount);
    const top = Object.entries(by).sort((a,b)=>b[1]-a[1])[0];
    if(top){ const c = catOf(top[0]);
      insights.push(`<div class="insight"><div class="i-ic">${c.icon}</div><div class="i-txt">הקטגוריה עם הכי הרבה הוצאות החודש: <b>${c.name}</b> - ${fmt(top[1])} ₪.</div></div>`);
    }
  }

  return `<div class="screen">
    <div class="topbar">
      <div>
        <div class="greet">שלום, ${me.name}${me.partner? " ו"+me.partner : ""} 👋</div>
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
      <div class="pill"><div class="p-label">תנועות</div><div class="p-val">${state.transactions.length}</div></div>
    </div>

    ${insights.join("")}

    <div class="section-head" style="margin-top:20px"><h3>קטגוריות</h3></div>
    <div class="cats">${catsHTML}</div>

    <div class="section-head"><h3>תנועות אחרונות</h3>${state.transactions.length>8?`<span class="link" onclick="setTab('history')">הכל</span>`:""}</div>
    <div class="tx-list">${txHTML}</div>
  </div>
  <button class="fab" onclick="openSheet()">+</button>`;
}

/* ===== history ===== */
function historyHTML(){
  /* current month full list */
  const curTx = state.transactions.map(t=>{
    const c = catOf(t.catId); const d = new Date(t.date);
    const when = `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}`;
    return `<div class="tx">
      <div class="tx-right">
        <div class="tx-ic" style="background:${c?c.color:"#eee"}">${c?c.icon:"💳"}</div>
        <div style="min-width:0"><div class="tx-name">${t.label}</div><div class="tx-meta">${t.who} · ${when}</div></div>
      </div>
      <div style="display:flex;align-items:center">
        <div class="tx-amt">-${fmt(t.amount)} ₪</div>
        <div class="tx-del" onclick="delTx('${t.id}')">🗑️</div>
      </div>
    </div>`;
  }).join("") || `<div class="empty-note">אין תנועות החודש.</div>`;

  const past = state.history.length ? state.history.map((h,i)=>{
    const diff = h.totalBudget - h.totalSpent;
    const open = expandedMonth===i;
    const breakdown = open ? `<div class="month-breakdown">
      ${CATEGORIES.filter(c=>h.spentBy[c.id]).map(c=>`
        <div class="mb-row"><span>${c.icon} ${c.name}</span><span>${fmt(h.spentBy[c.id])} ₪ מתוך ${fmt(h.limits[c.id]||0)}</span></div>`).join("")}
      <div class="mb-row" style="font-weight:700;border-top:1px solid var(--line);padding-top:7px">
        <span>סה"כ</span><span>${fmt(h.totalSpent)} ₪ מתוך ${fmt(h.totalBudget)}</span></div>
    </div>` : "";
    return `<div class="month-card" onclick="toggleMonth(${i})">
      <div class="month-card-top">
        <h4>${mkLabel(h.monthKey)}</h4>
        <span class="badge ${diff>=0?"pos":"neg"}">${diff>=0? `+${fmt(diff)} ₪ נשאר` : `${fmt(diff)} ₪ חריגה`}</span>
      </div>${breakdown}</div>`;
  }).join("") : `<div class="empty-note">עוד אין חודשים קודמים.<br>בתחילת החודש הבא, החודש הנוכחי יישמר כאן אוטומטית.</div>`;

  return `<div class="screen">
    <div class="topbar"><div class="month-title">היסטוריה</div></div>
    <div class="section-head"><h3>החודש הנוכחי - ${mkLabel(state.monthKey)}</h3></div>
    <div class="tx-list" style="margin-bottom:24px">${curTx}</div>
    <div class="section-head"><h3>חודשים קודמים</h3></div>
    ${past}
  </div>`;
}
function toggleMonth(i){ expandedMonth = expandedMonth===i ? null : i; render(); }

/* ===== settings ===== */
function settingsHTML(){
  const rows = CATEGORIES.map(c=>`
    <div class="set-row"><span>${c.icon} ${c.name}</span>
      <input type="number" inputmode="numeric" value="${state.limits[c.id]||0}"
        onchange="state.limits['${c.id}']=Number(this.value)||0; save(); render()">
    </div>`).join("");
  return `<div class="screen">
    <div class="topbar"><div class="month-title">הגדרות</div></div>
    <div class="set-title">תקציב חודשי כולל</div>
    <div class="set-group">
      <div class="set-row"><span>💰 סכום כולל (₪)</span>
        <input type="number" inputmode="numeric" value="${state.totalBudget}"
          onchange="state.totalBudget=Number(this.value)||0; save(); render()"></div>
    </div>
    <div class="set-title">תקרה לכל קטגוריה (₪)</div>
    <div class="set-group">${rows}</div>
    <div class="set-title">שמות</div>
    <div class="set-group">
      <div class="set-row"><span>השם שלך</span>
        <input type="text" value="${me.name}" onchange="me.name=this.value||'אני'; saveMe(); render()"></div>
      <div class="set-row"><span>בן/בת זוג</span>
        <input type="text" value="${me.partner||""}" placeholder="—" onchange="me.partner=this.value||null; saveMe(); render()"></div>
    </div>
    <button class="danger-btn" onclick="resetAll()">איפוס מלא של האפליקציה</button>
  </div>`;
}
function resetAll(){
  if(confirm("בטוח? כל הנתונים וההיסטוריה יימחקו לצמיתות.")){
    localStorage.removeItem(DATA_KEY); localStorage.removeItem(USER_KEY);
    state = null; me = null; onboardStep = 1; tab="home"; render();
  }
}

/* ===== nav ===== */
function navHTML(){
  const items = [["home","🏠","בית"],["history","🗂️","היסטוריה"],["settings","⚙️","הגדרות"]];
  return `<div class="bottom-nav">${items.map(([id,ic,lb])=>
    `<div class="nav-item ${tab===id?"active":""}" onclick="setTab('${id}')"><span class="n-ic">${ic}</span>${lb}</div>`).join("")}</div>`;
}
function setTab(t){ tab = t; expandedMonth=null; render(); window.scrollTo(0,0); }

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
  selCat = catId || CATEGORIES[0].id; selSub = null; amountStr = "0";
  render();
  document.getElementById("ovl").classList.add("open");
  document.getElementById("sheet").classList.add("open");
}
function closeSheet(){
  document.getElementById("ovl").classList.remove("open");
  document.getElementById("sheet").classList.remove("open");
}
function pickCat(id){
  const keep = amountStr, note = document.getElementById("noteInput").value;
  selCat = id; selSub = null; amountStr = keep;
  render();
  document.getElementById("ovl").classList.add("open");
  document.getElementById("sheet").classList.add("open");
  document.getElementById("noteInput").value = note;
}
function pickSub(s){
  const keep = amountStr, note = document.getElementById("noteInput").value;
  selSub = selSub===s ? null : s;
  render();
  document.getElementById("ovl").classList.add("open");
  document.getElementById("sheet").classList.add("open");
  document.getElementById("noteInput").value = note;
  amountStr = keep;
  document.getElementById("amt").innerHTML = amountStr + '<span> ₪</span>';
}
function press(k){
  if(k==="⌫") amountStr = amountStr.slice(0,-1) || "0";
  else amountStr = amountStr==="0" ? k : (amountStr+k).slice(0,7);
  document.getElementById("amt").innerHTML = amountStr + '<span> ₪</span>';
}
function saveTx(){
  const amt = Number(amountStr);
  if(!amt){ closeSheet(); return; }
  const c = catOf(selCat);
  const note = document.getElementById("noteInput").value.trim();
  const label = note || (selSub ? `${c.name} - ${selSub}` : c.name);
  state.transactions.unshift({
    id: "t"+Date.now()+Math.random().toString(16).slice(2),
    catId: selCat, sub: selSub, amount: amt, label,
    who: me.name, date: new Date().toISOString()
  });
  save(); render();
}
function delTx(id){
  const t = state.transactions.find(x=>x.id===id);
  if(!t) return;
  if(confirm(`למחוק את ההוצאה "${t.label}" (${fmt(t.amount)} ₪)?`)){
    state.transactions = state.transactions.filter(x=>x.id!==id);
    save(); render();
  }
}

/* ===== boot ===== */
render();
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=> navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
