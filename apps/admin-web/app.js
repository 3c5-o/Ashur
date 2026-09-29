(()=>{
const cfg=window.ASHUR_ADMIN_CONFIG;
const sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const nativeApiBase=()=>{try{return window.AshurNative?.getApiBaseUrl?.()||""}catch{return ""}};
const apiBase=()=> (cfg.apiBaseUrl||nativeApiBase()||location.origin).replace(/\/$/,"");
const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

const THEME_KEY="ashur_admin_theme_v1";
const isNative=()=>{try{return Boolean(window.AshurNative?.getApiBaseUrl)}catch{return false}};
if(isNative())document.documentElement.classList.add("native-app");

function currentTheme(){
  try{return localStorage.getItem(THEME_KEY)==="light"?"light":"dark"}catch{return "dark"}
}
function applyTheme(theme,{persist=false}={}){
  const next=theme==="light"?"light":"dark";
  document.documentElement.dataset.theme=next;
  document.documentElement.style.colorScheme=next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",next==="light"?"#f6f8f7":"#050706");
  if(persist){try{localStorage.setItem(THEME_KEY,next)}catch(_){}}
  try{window.AshurNative?.setThemeMode?.(next)}catch(_){}
  return next;
}
function toggleTheme(){applyTheme(currentTheme()==="dark"?"light":"dark",{persist:true})}
applyTheme(currentTheme());

let toastSerial=0;
function showToast(message,{type="info",duration=3200}={}){
  const root=$("#toastStack");
  if(!root)return;
  const id="toast-"+(++toastSerial);
  const node=document.createElement("div");
  node.id=id;
  node.className="admin-toast "+type;
  node.innerHTML='<span class="toast-mark"></span><div class="grow">'+esc(message||"تم")+'</div>';
  root.appendChild(node);
  requestAnimationFrame(()=>node.classList.add("show"));
  setTimeout(()=>{
    node.classList.remove("show");
    setTimeout(()=>node.remove(),180);
  },duration);
}

let adminDialogResolver=null;
function closeAdminDialog(value=null){
  const dialog=$("#adminActionDialog");
  if(dialog?.open)dialog.close();
  const resolve=adminDialogResolver;
  adminDialogResolver=null;
  if(resolve)resolve(value);
}
function openAdminDialog({title="تأكيد الإجراء",text="",acceptLabel="تأكيد",input=false,inputLabel="القيمة",defaultValue="",placeholder="",danger=false}={}){
  return new Promise(resolve=>{
    const dialog=$("#adminActionDialog");
    if(!dialog)return resolve(null);
    if(adminDialogResolver)adminDialogResolver(null);
    adminDialogResolver=resolve;
    $("#adminDialogTitle").textContent=title;
    $("#adminDialogText").textContent=text||"";
    $("#adminDialogAccept").textContent=acceptLabel;
    $("#adminDialogAccept").classList.toggle("danger-primary",danger);
    const row=$("#adminDialogInputRow");
    row.classList.toggle("hidden",!input);
    const field=$("#adminDialogInput");
    $("#adminDialogInputLabel").textContent=inputLabel||"القيمة";
    field.value=defaultValue??"";
    field.placeholder=placeholder||"";
    dialog.showModal();
    if(input)setTimeout(()=>field.focus(),60);
  });
}
async function adminConfirm(title,text="",options={}){
  const result=await openAdminDialog({title,text,acceptLabel:options.acceptLabel||"تأكيد",danger:Boolean(options.danger)});
  return result===true;
}
async function adminPrompt(title,{text="",label="القيمة",defaultValue="",placeholder="",acceptLabel="حفظ"}={}){
  return openAdminDialog({title,text,acceptLabel,input:true,inputLabel:label,defaultValue,placeholder});
}

$("#adminActionForm")?.addEventListener("submit",event=>{
  event.preventDefault();
  const wantsInput=!$("#adminDialogInputRow").classList.contains("hidden");
  closeAdminDialog(wantsInput?$("#adminDialogInput").value:true);
});
$("#adminDialogCancel")?.addEventListener("click",()=>closeAdminDialog(null));
$("#adminDialogClose")?.addEventListener("click",()=>closeAdminDialog(null));
$("#adminActionDialog")?.addEventListener("cancel",event=>{event.preventDefault();closeAdminDialog(null)});

let connectionOnline=navigator.onLine;
function setConnectionState(online){
  connectionOnline=Boolean(online);
  $("#connectionBanner")?.classList.toggle("hidden",connectionOnline);
  document.documentElement.classList.toggle("is-offline",!connectionOnline);
}
window.addEventListener("online",()=>{setConnectionState(true);showToast("عاد الاتصال بالإنترنت",{type:"success"});});
window.addEventListener("offline",()=>setConnectionState(false));
setConnectionState(navigator.onLine);

const titles={
  dashboard:"الرئيسية",
  users:"المستخدمون",
  content:"المحتوى",
  comments:"التعليقات",
  reports:"البلاغات",
  support:"الدعم",
  storage:"التخزين",
  uploads:"عمليات الرفع",
  errors:"أخطاء النظام",
  notifications:"الإشعارات",
  admins:"المشرفون",
  audit:"سجل الإدارة",
  releases:"الإصدارات",
  appSettings:"إعدادات التطبيق",
  siteSettings:"الموقع الرسمي",
  health:"حالة النظام"
};
const roleLabel={
  owner:"المالك",
  secondary_admin:"مدير ثانوي",
  moderator:"مشرف",
  content_moderator:"مشرف محتوى",
  support:"الدعم",
  analyst:"محلل"
};
const actionLabel={
  ban_user:"حظر مستخدم",
  unban_user:"رفع حظر مستخدم",
  delete_content:"حذف محتوى",
  resolve_report:"حل بلاغ",
  link_storage_channel:"ربط قناة تخزين",
  add_admin:"إضافة مشرف",
  update_admin:"تعديل مشرف",
  user_verify:"توثيق مستخدم",
  user_unverify:"إلغاء توثيق مستخدم",
  user_warn:"تحذير مستخدم",
  hide_content:"إخفاء محتوى",
  restore_content:"استعادة محتوى",
  cancel_upload:"إلغاء رفع",
  resolve_system_error:"حل خطأ",
  reply_support:"رد على تذكرة دعم",
  create_release:"إنشاء إصدار",
  update_release:"تعديل إصدار",
  send_notification:"إرسال إشعار",
  schedule_notification:"جدولة إشعار"
};

async function token(){return (await sb.auth.getSession()).data.session?.access_token||""}
async function api(path,opt={}){
  const h=new Headers(opt.headers||{});
  const t=await token();
  if(t)h.set("Authorization","Bearer "+t);
  if(opt.body&&!h.has("Content-Type"))h.set("Content-Type","application/json");
  let r;
  try{
    r=await fetch(apiBase()+path,{...opt,headers:h});
    setConnectionState(true);
  }catch(error){
    setConnectionState(false);
    const networkError=new Error("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجددًا.");
    networkError.cause=error;
    throw networkError;
  }
  const b=await r.json().catch(()=>({}));
  if(!r.ok){
    if(r.status===401)showToast("انتهت جلسة الإدارة. سجّل الدخول من جديد.",{type:"error",duration:4500});
    throw new Error(b.error||"تعذر تنفيذ الطلب");
  }
  return b
}
async function mediaAccess(id){
  if(!id)return null;
  return api("/v1/media-ticket/"+encodeURIComponent(id));
}
async function hydrateAdminMedia(root=document){
  const nodes=[...root.querySelectorAll("[data-media-id]:not([data-media-ready])")];
  await Promise.all(nodes.map(async node=>{
    try{
      const access=await mediaAccess(node.dataset.mediaId);
      const mediaUrl=access?.url||(access?.path?apiBase()+access.path:"");
      if(!mediaUrl)throw new Error("تعذر تجهيز رابط الوسائط");
      node.dataset.mediaReady="1";
      if(access.mime_type?.startsWith("video/")){
        const v=document.createElement("video");
        v.className=node.className;
        v.src=mediaUrl;
        v.controls=true;
        v.playsInline=true;
        v.preload="metadata";
        node.replaceWith(v);
      }else{
        node.src=mediaUrl;
      }
    }catch{
      node.classList.add("media-error");
    }
  }));
}
function formatBytes(value){
  const n=Number(value||0);
  if(n<1024)return n+" B";
  if(n<1024*1024)return (n/1024).toFixed(1)+" KB";
  if(n<1024*1024*1024)return (n/1024/1024).toFixed(1)+" MB";
  return (n/1024/1024/1024).toFixed(2)+" GB";
}
function statusLabel(s){
  return ({
    active:"نشط",hidden:"مخفي",open:"جديد",review:"قيد المراجعة",resolved:"تم الحل",rejected:"مرفوض",
    queued:"بالانتظار",receiving:"جارٍ الاستلام",storing:"جارٍ التخزين",completed:"مكتمل",failed:"فشل",
    cancelled:"ملغي",in_progress:"قيد المتابعة",answered:"تم الرد",closed:"مغلق",new:"جديد",
    draft:"مسودة",testing:"اختبار",published:"منشور",retired:"متقاعد",scheduled:"مجدول",sent:"تم الإرسال",
    processing:"قيد الإرسال",pending:"قيد الانتظار"
  })[s]||s||"—";
}
function pillClass(s){
  return ["active","resolved","completed","sent","published","connected","answered"].includes(s)?"ok":
    ["failed","cancelled","rejected","hidden","error"].includes(s)?"bad":"";
}

let currentAdminPage="dashboard";
const adminPageHistory=[];

function showApp(ok){
  $("#loginView").classList.toggle("hidden",ok);
  $("#adminApp").classList.toggle("hidden",!ok);
  document.body.classList.toggle("admin-authenticated",ok);
}
function showPageLoading(page){
  const map={
    users:"#usersList",content:"#contentList",comments:"#commentsList",reports:"#reportsList",
    support:"#supportList",storage:"#channelsList",uploads:"#uploadsList",errors:"#errorsList",
    notifications:"#notificationHistory",admins:"#adminsList",audit:"#auditList",releases:"#releasesList",
    health:"#healthCards"
  };
  const root=$(map[page]||"");
  if(!root)return;
  root.innerHTML='<div class="admin-skeleton-list">'+Array.from({length:4},()=>'<div class="admin-skeleton-row"><i></i><div><b></b><span></span></div></div>').join("")+'</div>';
}
async function verify(){
  try{
    await api("/v1/admin/me");
    showApp(true);
    navigate("dashboard",{history:false,loading:false});
    await loadDashboard();
  }catch(e){
    showApp(false);
    if((await sb.auth.getSession()).data.session)$("#loginMessage").textContent=e.message==="تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجددًا."?e.message:"هذا الحساب لا يملك صلاحية الإدارة.";
  }
}

$("#loginForm").onsubmit=async e=>{
  e.preventDefault();
  const button=$("#loginSubmitButton");
  button.disabled=true;
  $("#loginMessage").textContent="جارٍ التحقق من الحساب...";
  try{
    const {error}=await sb.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
    if(error)throw error;
    await verify();
  }catch(error){
    $("#loginMessage").textContent=error.message||"تعذر تسجيل الدخول.";
  }finally{button.disabled=false}
};
$("#forgotPasswordButton")?.addEventListener("click",async()=>{
  const email=$("#email").value.trim();
  if(!email){
    $("#loginMessage").textContent="اكتب البريد الإلكتروني أولًا.";
    $("#email").focus();
    return;
  }
  $("#forgotPasswordButton").disabled=true;
  try{
    const {error}=await sb.auth.resetPasswordForEmail(email);
    if(error)throw error;
    $("#loginMessage").textContent="تم إرسال رابط استعادة كلمة المرور إلى البريد.";
  }catch(error){
    $("#loginMessage").textContent=error.message||"تعذر إرسال رابط الاستعادة.";
  }finally{$("#forgotPasswordButton").disabled=false}
});
$("#logoutButton").onclick=async()=>{
  const ok=await adminConfirm("تسجيل الخروج","سيتم إنهاء جلسة الإدارة على هذا الجهاز.",{acceptLabel:"تسجيل الخروج"});
  if(!ok)return;
  await sb.auth.signOut();
  adminPageHistory.length=0;
  currentAdminPage="dashboard";
  showApp(false);
};
$("#menuButton").onclick=()=>$("#sidebar").classList.toggle("open");
$("#moreAdminButton")?.addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
$("#refreshButton").onclick=()=>navigate(currentAdminPage,{history:false});
$("#themeButton")?.addEventListener("click",toggleTheme);
$("#loginThemeButton")?.addEventListener("click",toggleTheme);
$("#retryConnectionButton")?.addEventListener("click",()=>{
  setConnectionState(navigator.onLine);
  if(navigator.onLine)navigate(currentAdminPage,{history:false});
});
document.addEventListener("click",e=>{
  if(window.innerWidth>920)return;
  const side=$("#sidebar");
  if(!side.classList.contains("open"))return;
  if(side.contains(e.target)||$("#menuButton").contains(e.target)||$("#moreAdminButton")?.contains(e.target))return;
  side.classList.remove("open");
});
[...$$(".nav"),...$$(".mobile-nav")].filter(x=>x.dataset.page).forEach(b=>b.onclick=()=>navigate(b.dataset.page));

function navigate(page,{history=true,loading=true}={}){
  if(!titles[page])page="dashboard";
  if(history&&currentAdminPage&&currentAdminPage!==page)adminPageHistory.push(currentAdminPage);
  currentAdminPage=page;
  $$(".page").forEach(x=>x.classList.toggle("active",x.id===page));
  $$("[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  $("#headerSectionName").textContent=titles[page]||"إدارة آشور";
  $("#sidebar").classList.remove("open");
  $("#moreAdminButton")?.classList.remove("active");
  window.scrollTo({top:0,behavior:"auto"});
  if(loading)showPageLoading(page);
  const loader={
    dashboard:loadDashboard,
    users:loadUsers,
    content:()=>loadContent(currentContentKind),
    comments:loadCommentsAdmin,
    reports:loadReports,
    support:loadSupport,
    storage:loadStorage,
    uploads:loadUploads,
    errors:loadErrors,
    notifications:loadNotificationHistory,
    admins:loadAdmins,
    audit:loadAudit,
    releases:loadReleases,
    appSettings:loadAppSettings,
    siteSettings:loadSiteSettings,
    health:loadHealth
  }[page];
  if(loader)Promise.resolve(loader()).catch(error=>showToast(error.message,{type:"error"}));
}
function handleAdminBack(){
  const openDialog=document.querySelector("dialog[open]");
  if(openDialog){
    if(openDialog.id==="adminActionDialog")closeAdminDialog(null);
    else openDialog.close();
    return true;
  }
  if($("#sidebar")?.classList.contains("open")){
    $("#sidebar").classList.remove("open");
    return true;
  }
  if(!$("#userDetail")?.classList.contains("hidden")){
    $("#userDetail").classList.add("hidden");
    return true;
  }
  if(adminPageHistory.length){
    const previous=adminPageHistory.pop();
    navigate(previous,{history:false});
    return true;
  }
  if(currentAdminPage!=="dashboard"){
    navigate("dashboard",{history:false});
    return true;
  }
  return false;
}
window.ASHUR_ADMIN_HANDLE_BACK=handleAdminBack;

async function loadDashboard(){
  try{
    const [d,health]=await Promise.all([
      api("/v1/admin/stats"),
      api("/health/details").catch(()=>({services:{}}))
    ]);
    $("#stats").innerHTML=[
      ["المستخدمون",d.users],
      ["نشطون 7 أيام",d.active_7d],
      ["المنشورات",d.posts],
      ["الريلز",d.reels],
      ["التعليقات",d.comments],
      ["البلاغات المفتوحة",d.open_reports],
      ["تذاكر الدعم",d.open_support],
      ["رفع فاشل",d.failed_uploads],
      ["أخطاء جديدة",d.open_errors]
    ].map(([a,b])=>'<div class="stat"><b>'+Number(b||0).toLocaleString("ar-IQ")+'</b><span>'+a+'</span></div>').join("");
    $("#recentReports").innerHTML=(d.recent_reports||[]).map(r=>
      '<div class="row-card"><div class="grow"><b>'+esc(r.reason)+'</b><div class="meta">'+esc(r.target_type)+' · '+new Date(r.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(r.status)+'">'+statusLabel(r.status)+'</span></div>'
    ).join("")||'<div class="meta">لا توجد بلاغات حديثة.</div>';
    $("#serviceStatus").innerHTML=Object.entries(health.services||{}).map(([k,v])=>
      '<div class="row-card"><div class="grow"><b>'+esc(v.label||k)+'</b><div class="meta">'+esc(v.detail||"")+'</div></div><span class="pill '+(v.ok?"ok":"bad")+'">'+(v.ok?"تعمل":"متوقفة")+'</span></div>'
    ).join("")||'<div class="meta">تعذر قراءة حالة الخدمات.</div>';
    if(d.today){
      $("#recentReports").insertAdjacentHTML("beforebegin",
        '<div class="today-strip"><span>اليوم</span><b>'+Number(d.today.new_users||0)+' مستخدم جديد</b><b>'+Number(d.today.posts||0)+' منشور</b><b>'+Number(d.today.reels||0)+' ريلز</b><b>'+Number(d.today.comments||0)+' تعليق</b></div>');
    }
  }catch(e){$("#stats").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

let userTimer;
let userPage=1;
let userPages=1;

function resetUserPage(){userPage=1}
["userStatus","userVerified","userPrivacy"].forEach(id=>{
  $("#"+id)?.addEventListener("change",()=>{resetUserPage();loadUsers()});
});
$("#userSearch").oninput=()=>{
  clearTimeout(userTimer);
  userTimer=setTimeout(()=>{resetUserPage();loadUsers()},260);
};
$("#usersPrevPage")?.addEventListener("click",()=>{if(userPage>1){userPage--;loadUsers()}});
$("#usersNextPage")?.addEventListener("click",()=>{if(userPage<userPages){userPage++;loadUsers()}});

function userStatusMeta(u){
  if(u.deleted_at)return {label:"معطل",cls:"bad"};
  const temporary=Boolean(u.banned_until&&new Date(u.banned_until)>new Date());
  if(u.is_banned||temporary)return {label:temporary?"حظر مؤقت":"محظور",cls:"bad"};
  return {label:"نشط",cls:"ok"};
}

async function sendUserWarning(userId){
  const reason=await adminPrompt("إرسال تحذير",{
    text:"سيُحفظ التحذير في سجل الحساب ويصل للمستخدم كإشعار.",
    label:"نص التحذير",placeholder:"اكتب سبب التحذير بوضوح",acceptLabel:"إرسال"
  });
  if(!reason?.trim())return false;
  await api("/v1/admin/users/"+userId+"/action",{
    method:"POST",body:JSON.stringify({action:"warn",reason:reason.trim()})
  });
  showToast("تم إرسال التحذير وتسجيله.",{type:"success"});
  return true;
}

async function banUserFor(userId,hours){
  const reason=await adminPrompt(hours>0?"حظر مؤقت":"حظر دائم",{
    text:hours>0?"مدة الحظر المحددة: "+(hours===1?"ساعة":hours===24?"يوم":hours===168?"أسبوع":"شهر")+".":"سيستمر الحظر حتى يتم رفعه يدويًا.",
    label:"سبب الحظر",placeholder:"سبب واضح للإجراء",acceptLabel:"تأكيد الحظر"
  });
  if(reason===null)return false;
  await api("/v1/admin/users/"+userId+"/ban",{
    method:"POST",body:JSON.stringify({banned:true,reason:reason.trim(),duration_hours:hours})
  });
  showToast("تم تطبيق الحظر.",{type:"success"});
  return true;
}

async function loadUserDetail(id){
  try{
    const d=await api("/v1/admin/users/"+encodeURIComponent(id));
    const u=d.profile||{}, st=d.stats||{}, auth=d.auth||{}, warnings=d.warnings||[];
    const status=userStatusMeta(u);
    const banned=status.label!=="نشط"&&status.label!=="معطل";
    $("#userDetail").classList.remove("hidden");
    $("#userDetail").innerHTML=
      '<div class="admin-user-hero">'+
        '<div class="admin-user-cover">'+(u.cover_media_id?'<img data-media-id="'+esc(u.cover_media_id)+'" alt="">':"")+'</div>'+
        '<div class="admin-user-identity">'+
          '<div class="admin-user-avatar">'+(u.avatar_media_id?'<img data-media-id="'+esc(u.avatar_media_id)+'" alt="">':'<span>'+esc((u.name||u.username||"م").slice(0,1))+'</span>')+'</div>'+
          '<div class="grow"><span class="eyebrow">تفاصيل الحساب</span><h3>'+esc(u.name||u.username||"مستخدم")+(u.is_verified?' <span class="verified-admin">✓</span>':"")+'</h3>'+
          '<div class="meta">@'+esc(u.username||"")+' · '+(u.is_private?"حساب خاص":"حساب عام")+'</div></div>'+
          '<span class="pill '+status.cls+'">'+status.label+'</span>'+
          '<button id="closeUserDetail" class="small" type="button">إغلاق</button>'+
        '</div>'+
      '</div>'+
      '<div class="admin-user-info-grid">'+
        '<div><span>البريد</span><b>'+esc(auth.email||"غير متوفر")+'</b></div>'+
        '<div><span>آخر تسجيل دخول</span><b>'+(auth.last_sign_in_at?new Date(auth.last_sign_in_at).toLocaleString("ar-IQ"):"—")+'</b></div>'+
        '<div><span>آخر نشاط</span><b>'+(u.last_seen_at?new Date(u.last_seen_at).toLocaleString("ar-IQ"):"—")+'</b></div>'+
        '<div><span>تاريخ الحساب</span><b>'+new Date(u.created_at).toLocaleDateString("ar-IQ")+'</b></div>'+
      '</div>'+
      '<div class="user-stats">'+
        '<div><span>منشورات</span><b>'+Number(st.posts||0)+'</b></div>'+
        '<div><span>ريلز</span><b>'+Number(st.reels||0)+'</b></div>'+
        '<div><span>قصص</span><b>'+Number(st.stories||0)+'</b></div>'+
        '<div><span>تعليقات</span><b>'+Number(st.comments||0)+'</b></div>'+
        '<div><span>متابعون</span><b>'+Number(st.followers||0)+'</b></div>'+
        '<div><span>يتابع</span><b>'+Number(st.following||0)+'</b></div>'+
        '<div><span>بلاغات</span><b>'+Number(st.reports||0)+'</b></div>'+
        '<div><span>تحذيرات</span><b>'+Number(u.warning_count||0)+'</b></div>'+
      '</div>'+
      (u.bio?'<div class="admin-user-bio">'+esc(u.bio)+'</div>':"")+
      (u.ban_reason?'<div class="info-banner"><span></span><p>سبب الإجراء: '+esc(u.ban_reason)+'</p></div>':"")+
      '<div class="admin-action-section"><span class="eyebrow">إجراءات الحساب</span><div class="admin-actions">'+
        '<button id="toggleVerifyUser" class="small" type="button">'+(u.is_verified?"إلغاء التوثيق":"توثيق الحساب")+'</button>'+
        '<button id="warnUserButton" class="small" type="button">تحذير</button>'+
        '<button id="notifyUserButton" class="small" type="button">إشعار مباشر</button>'+
        '<button id="forceLogoutUserButton" class="small" type="button">إنهاء الجلسات</button>'+
        '<button id="viewUserContentButton" class="small" type="button">كل المحتوى</button>'+
        (u.deleted_at?'<button id="reactivateUserButton" class="small" type="button">إعادة تفعيل الحساب</button>':'<button id="deactivateUserButton" class="small danger" type="button">تعطيل الحساب</button>')+
      '</div></div>'+
      '<div class="admin-action-section"><span class="eyebrow">الحظر</span>'+
        (banned
          ?'<button id="unbanUserButton" class="small" type="button">رفع الحظر</button>'
          :'<div class="ban-presets"><button data-ban-hours="1" class="small" type="button">ساعة</button><button data-ban-hours="24" class="small" type="button">يوم</button><button data-ban-hours="168" class="small" type="button">أسبوع</button><button data-ban-hours="720" class="small" type="button">شهر</button><button data-ban-hours="0" class="small danger" type="button">دائم</button></div>')+
      '</div>'+
      '<div class="admin-action-section danger-zone"><span class="eyebrow">منطقة خطرة</span><button id="deleteUserPermanently" class="small danger" type="button">حذف الحساب نهائيًا</button></div>'+
      '<div class="admin-action-section"><div class="panel-head"><div><span class="eyebrow">السجل</span><h3>التحذيرات السابقة</h3></div></div>'+
        '<div class="warning-history">'+(warnings.map(w=>'<div class="warning-item"><b>'+esc(w.reason)+'</b><span>'+new Date(w.created_at).toLocaleString("ar-IQ")+'</span></div>').join("")||'<div class="meta">لا توجد تحذيرات مسجلة.</div>')+'</div>'+
      '</div>';

    await hydrateAdminMedia($("#userDetail"));
    $("#closeUserDetail").onclick=()=>$("#userDetail").classList.add("hidden");

    $("#toggleVerifyUser").onclick=async()=>{
      const reason=await adminPrompt(u.is_verified?"إلغاء توثيق الحساب":"توثيق الحساب",{
        label:"سبب القرار",placeholder:"ملاحظة داخلية لسجل الإدارة",acceptLabel:u.is_verified?"إلغاء التوثيق":"توثيق"
      });
      if(reason===null)return;
      await api("/v1/admin/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:u.is_verified?"unverify":"verify",reason})});
      showToast("تم تحديث حالة التوثيق.",{type:"success"});
      await loadUserDetail(id);await loadUsers();
    };
    $("#warnUserButton").onclick=async()=>{if(await sendUserWarning(id))await loadUserDetail(id)};
    $("#notifyUserButton").onclick=async()=>{
      const title=await adminPrompt("عنوان الإشعار",{label:"العنوان",defaultValue:"رسالة من إدارة آشور",acceptLabel:"التالي"});
      if(title===null)return;
      const message=await adminPrompt("نص الإشعار",{label:"الرسالة",placeholder:"اكتب الرسالة للمستخدم",acceptLabel:"إرسال"});
      if(!message?.trim())return;
      await api("/v1/admin/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:"notify",title,message})});
      showToast("تم إرسال الإشعار.",{type:"success"});
    };
    $("#forceLogoutUserButton").onclick=async()=>{
      if(!await adminConfirm("إنهاء كل جلسات المستخدم؟","سيحتاج المستخدم إلى تسجيل الدخول من جديد على أجهزته عند انتهاء رمز الدخول الحالي.",{acceptLabel:"إنهاء الجلسات"}))return;
      const result=await api("/v1/admin/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:"force_logout"})});
      showToast("تم إلغاء "+Number(result.sessions_revoked||0)+" جلسة.",{type:"success"});
    };
    $("#viewUserContentButton").onclick=()=>{
      currentContentKind="posts";
      contentTargetId="";
      contentPage=1;
      $("#contentSearch").value="";
      $("#contentAuthor").value=id;
      $$("[data-content-kind]").forEach(x=>x.classList.toggle("active",x.dataset.contentKind==="posts"));
      navigate("content");
    };
    $("#unbanUserButton")?.addEventListener("click",async()=>{
      await api("/v1/admin/users/"+id+"/ban",{method:"POST",body:JSON.stringify({banned:false})});
      showToast("تم رفع الحظر.",{type:"success"});await loadUserDetail(id);await loadUsers();
    });
    $("#userDetail").querySelectorAll("[data-ban-hours]").forEach(button=>button.onclick=async()=>{
      if(await banUserFor(id,Number(button.dataset.banHours||0))){await loadUserDetail(id);await loadUsers()}
    });
    $("#deactivateUserButton")?.addEventListener("click",async()=>{
      const reason=await adminPrompt("تعطيل الحساب",{text:"سيتم منع الحساب من استخدام المنصة وإنهاء جلساته.",label:"سبب التعطيل",acceptLabel:"تعطيل"});
      if(reason===null)return;
      await api("/v1/admin/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:"deactivate",reason})});
      showToast("تم تعطيل الحساب.",{type:"success"});await loadUserDetail(id);await loadUsers();
    });
    $("#reactivateUserButton")?.addEventListener("click",async()=>{
      if(!await adminConfirm("إعادة تفعيل الحساب؟","سيتم رفع حالة التعطيل والحظر الإداري.",{acceptLabel:"إعادة التفعيل"}))return;
      await api("/v1/admin/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:"reactivate"})});
      showToast("تم إعادة تفعيل الحساب.",{type:"success"});await loadUserDetail(id);await loadUsers();
    });
    $("#deleteUserPermanently").onclick=async()=>{
      const confirmText=await adminPrompt("حذف الحساب نهائيًا",{
        text:"سيحذف الحساب وبياناته ويبدأ تنظيف وسائطه غير المستخدمة من Telegram. اكتب DELETE للتأكيد.",
        label:"اكتب DELETE",placeholder:"DELETE",acceptLabel:"متابعة الحذف"
      });
      if(confirmText!=="DELETE"){if(confirmText!==null)showToast("لم يتم الحذف لأن كلمة التأكيد غير صحيحة.",{type:"error"});return}
      if(!await adminConfirm("التأكيد الأخير","هذا الإجراء غير قابل للتراجع.",{acceptLabel:"حذف نهائي",danger:true}))return;
      const result=await api("/v1/admin/users/"+id,{method:"DELETE",body:JSON.stringify({confirm:"DELETE"})});
      const pending=(result.cleanup||[]).filter(x=>x.status==="cleanup_pending").length;
      showToast(pending?"حُذف الحساب، وبعض ملفات Telegram دخلت طابور التنظيف.":"تم حذف الحساب وتنظيف وسائطه.",{type:"success",duration:5000});
      $("#userDetail").classList.add("hidden");await loadUsers();
    };
  }catch(e){
    $("#userDetail").classList.remove("hidden");
    $("#userDetail").innerHTML='<div class="panel">'+esc(e.message)+'</div>';
  }
}

async function loadUsers(){
  try{
    const params=new URLSearchParams({
      page:String(userPage),limit:"30"
    });
    const q=$("#userSearch").value.trim();
    if(q)params.set("q",q);
    if($("#userStatus").value)params.set("status",$("#userStatus").value);
    if($("#userVerified").value)params.set("verified",$("#userVerified").value);
    if($("#userPrivacy").value)params.set("privacy",$("#userPrivacy").value);
    const d=await api("/v1/admin/users?"+params.toString());
    const p=d.pagination||{};
    userPages=Math.max(1,Number(p.pages||1));
    if(userPage>userPages){userPage=userPages;return loadUsers()}
    $("#usersList").innerHTML=(d.items||[]).map(u=>{
      const status=userStatusMeta(u);
      return '<div class="row-card admin-user-row">'+
        '<div class="list-avatar">'+(u.avatar_media_id?'<img data-media-id="'+esc(u.avatar_media_id)+'" alt="">':'<span>'+esc((u.name||u.username||"م").slice(0,1))+'</span>')+'</div>'+
        '<button class="row-main-button grow" data-user-detail="'+esc(u.id)+'" type="button"><b>'+esc(u.name||"مستخدم")+(u.is_verified?' <span class="verified-admin">✓</span>':"")+'</b><div class="meta">@'+esc(u.username||"")+' · '+(u.is_private?"خاص":"عام")+'</div><div class="meta">'+(u.last_seen_at?"آخر نشاط "+new Date(u.last_seen_at).toLocaleString("ar-IQ"):"لا يوجد نشاط حديث")+'</div></button>'+
        '<span class="pill '+status.cls+'">'+status.label+'</span>'+
      '</div>';
    }).join("")||'<div class="panel">لا توجد نتائج.</div>';
    await hydrateAdminMedia($("#usersList"));
    $("#usersList").querySelectorAll("[data-user-detail]").forEach(b=>b.onclick=()=>loadUserDetail(b.dataset.userDetail));
    $("#usersPager").classList.toggle("hidden",Number(p.total||0)<=Number(p.limit||30));
    $("#usersPageLabel").textContent=userPage+" / "+userPages+" · "+Number(p.total||0).toLocaleString("ar-IQ");
    $("#usersPrevPage").disabled=userPage<=1;
    $("#usersNextPage").disabled=userPage>=userPages;
  }catch(e){$("#usersList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

let currentContentKind="posts";
let contentTimer;
let contentTargetId="";
let contentPage=1;
let contentPages=1;
let lastContentItems=new Map();

function updateContentFilterVisibility(){
  const story=currentContentKind==="stories";
  const reel=currentContentKind==="reels";
  $("#contentVisibility").disabled=story;
  $("#contentComments").disabled=story;
  $("#contentExplore").disabled=!reel;
}
function resetContentPage(){contentPage=1;contentTargetId=""}
$$("[data-content-kind]").forEach(b=>b.onclick=()=>{
  $$("[data-content-kind]").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  currentContentKind=b.dataset.contentKind;
  resetContentPage();
  updateContentFilterVisibility();
  loadContent(currentContentKind);
});
$("#contentSearch").oninput=()=>{clearTimeout(contentTimer);contentTimer=setTimeout(()=>{resetContentPage();loadContent(currentContentKind)},250)};
["contentAuthor","contentStatus","contentVisibility","contentComments","contentExplore","contentReports","contentFrom","contentTo"].forEach(id=>{
  $("#"+id)?.addEventListener(id==="contentAuthor"?"input":"change",()=>{
    if(id==="contentAuthor"){
      clearTimeout(contentTimer);
      contentTimer=setTimeout(()=>{resetContentPage();loadContent(currentContentKind)},320);
    }else{
      resetContentPage();loadContent(currentContentKind);
    }
  });
});
$("#resetContentFilters")?.addEventListener("click",()=>{
  ["contentSearch","contentAuthor","contentStatus","contentVisibility","contentComments","contentExplore","contentReports","contentFrom","contentTo"].forEach(id=>{
    const el=$("#"+id);if(el)el.value="";
  });
  resetContentPage();loadContent(currentContentKind);
});
$("#contentPrevPage")?.addEventListener("click",()=>{if(contentPage>1){contentPage--;loadContent(currentContentKind)}});
$("#contentNextPage")?.addEventListener("click",()=>{if(contentPage<contentPages){contentPage++;loadContent(currentContentKind)}});

async function openContentPreview(item){
  const dialog=$("#contentPreviewDialog");
  $("#contentPreviewTitle").textContent=({posts:"منشور",reels:"ريلز",stories:"قصة"})[currentContentKind]||"المحتوى";
  const author=item.author||{};
  const media=(item.media_ids||[]).map((id,index)=>
    '<div class="content-preview-media"><img data-media-id="'+esc(id)+'" alt="وسائط '+(index+1)+'"></div>'
  ).join("");
  $("#contentPreviewBody").innerHTML=
    '<div class="content-preview-meta"><div><b>'+esc(author.name||author.username||"مستخدم")+'</b><span>@'+esc(author.username||"")+'</span></div><span class="pill '+pillClass(item.moderation_status)+'">'+statusLabel(item.moderation_status)+'</span></div>'+
    '<div class="content-preview-gallery">'+(media||'<div class="panel">لا توجد وسائط.</div>')+'</div>'+
    '<div class="content-preview-caption">'+esc(item.caption||"بدون وصف")+'</div>'+
    '<div class="content-detail-grid">'+
      '<div><span>التاريخ</span><b>'+new Date(item.created_at).toLocaleString("ar-IQ")+'</b></div>'+
      '<div><span>البلاغات</span><b>'+Number(item.report_count||0)+'</b></div>'+
      (currentContentKind!=="stories"?'<div><span>الخصوصية</span><b>'+(item.visibility==="followers"?"المتابعون":"عام")+'</b></div>':"")+
      (currentContentKind!=="stories"?'<div><span>التعليقات</span><b>'+(item.comments_enabled===false?"مغلقة":"مفتوحة")+'</b></div>':"")+
      (currentContentKind==="reels"?'<div><span>الاستكشاف</span><b>'+(item.explore_enabled===false?"معطل":"مفعل")+'</b></div><div><span>المشاهدات</span><b>'+Number(item.view_count||0)+'</b></div>':"")+
    '</div>';
  dialog.showModal();
  await hydrateAdminMedia($("#contentPreviewBody"));
}
$("#closeContentPreview")?.addEventListener("click",()=>$("#contentPreviewDialog").close());

async function loadContent(kind=currentContentKind,authorId=""){
  currentContentKind=kind;
  if(authorId)$("#contentAuthor").value=authorId;
  updateContentFilterVisibility();
  try{
    const params=new URLSearchParams({kind,page:String(contentPage),limit:"24"});
    if(contentTargetId)params.set("target_id",contentTargetId);
    const values={
      q:$("#contentSearch")?.value.trim(),
      author:$("#contentAuthor")?.value.trim(),
      status:$("#contentStatus")?.value,
      visibility:$("#contentVisibility")?.value,
      comments:$("#contentComments")?.value,
      explore:$("#contentExplore")?.value,
      reports:$("#contentReports")?.value,
      from:$("#contentFrom")?.value,
      to:$("#contentTo")?.value
    };
    Object.entries(values).forEach(([key,value])=>{if(value)params.set(key,value)});
    const d=await api("/v1/admin/content?"+params.toString());
    const p=d.pagination||{};
    contentPages=Math.max(1,Number(p.pages||1));
    if(contentPage>contentPages){contentPage=contentPages;return loadContent(kind)}
    lastContentItems=new Map((d.items||[]).map(item=>[String(item.id),item]));
    const kindLabel={posts:"منشور",reels:"ريلز",stories:"قصة"}[kind]||"محتوى";

    $("#contentList").innerHTML=(d.items||[]).map(x=>{
      const author=x.author||{};
      const status=x.moderation_status||"active";
      const gallery=(x.media_ids||[]).slice(0,4).map((id,index)=>
        '<div class="moderation-media-cell"><img class="moderation-media" data-media-id="'+esc(id)+'" alt="">'+((x.media_ids||[]).length>4&&index===3?'<span class="media-more">+'+((x.media_ids||[]).length-4)+'</span>':"")+'</div>'
      ).join("");
      return '<div class="moderation-card stage4-content-card">'+
        '<div class="moderation-media-grid">'+(gallery||'<div class="moderation-media placeholder">بدون معاينة</div>')+'</div>'+
        '<div class="moderation-body grow">'+
          '<div class="moderation-head"><div><b>'+esc(x.caption||kindLabel)+'</b><div class="meta">@'+esc(author.username||"")+' · '+new Date(x.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(status)+'">'+statusLabel(status)+'</span></div>'+
          '<div class="content-badges">'+
            '<span>'+Number(x.report_count||0)+' بلاغ</span>'+
            (kind!=="stories"?'<span>'+(x.visibility==="followers"?"للمتابعين":"عام")+'</span>':"")+
            (kind!=="stories"?'<span>'+(x.comments_enabled===false?"تعليقات مغلقة":"تعليقات مفتوحة")+'</span>':"")+
            (kind==="reels"?'<span>'+(x.explore_enabled===false?"خارج الاستكشاف":"في الاستكشاف")+'</span>':"")+
          '</div>'+
          '<div class="meta mono">'+esc(x.id)+'</div>'+
          '<div class="admin-actions">'+
            '<button class="small" data-preview-content="'+esc(x.id)+'" type="button">معاينة</button>'+
            '<button class="small" data-open-author="'+esc(x.author_id)+'" type="button">الحساب</button>'+
            '<button class="small" data-warn-author="'+esc(x.author_id)+'" type="button">تحذير</button>'+
            '<button class="small" data-moderate="'+esc(x.id)+'" data-kind="'+kind+'" data-status="'+esc(status)+'" type="button">'+(status==="hidden"?"استعادة":"إخفاء")+'</button>'+
            (kind!=="stories"?'<button class="small" data-comments-toggle="'+esc(x.id)+'" data-kind="'+kind+'" data-enabled="'+String(x.comments_enabled!==false)+'" type="button">'+(x.comments_enabled===false?"فتح التعليقات":"إغلاق التعليقات")+'</button>':"")+
            '<button class="small danger" data-delete-content="'+esc(x.id)+'" data-kind="'+kind+'" data-media-count="'+Number((x.media_ids||[]).length)+'" type="button">حذف نهائي</button>'+
          '</div>'+
        '</div></div>';
    }).join("")||'<div class="panel">لا يوجد محتوى مطابق.</div>';

    await hydrateAdminMedia($("#contentList"));
    $("#contentList").querySelectorAll("[data-preview-content]").forEach(b=>b.onclick=()=>{
      const item=lastContentItems.get(String(b.dataset.previewContent));if(item)openContentPreview(item)
    });
    $("#contentList").querySelectorAll("[data-open-author]").forEach(b=>b.onclick=()=>{navigate("users");loadUserDetail(b.dataset.openAuthor)});
    $("#contentList").querySelectorAll("[data-warn-author]").forEach(b=>b.onclick=()=>sendUserWarning(b.dataset.warnAuthor));
    $("#contentList").querySelectorAll("[data-moderate]").forEach(b=>b.onclick=async()=>{
      const next=b.dataset.status==="hidden"?"active":"hidden";
      const reason=next==="hidden"?((await adminPrompt("إخفاء المحتوى",{label:"سبب الإخفاء",placeholder:"سبب الإجراء",acceptLabel:"إخفاء"}))||""):"";
      await api("/v1/admin/content/"+b.dataset.kind+"/"+b.dataset.moderate+"/moderate",{method:"POST",body:JSON.stringify({status:next,reason})});
      showToast(next==="hidden"?"تم إخفاء المحتوى.":"تمت استعادة المحتوى.",{type:"success"});
      loadContent(currentContentKind);
    });
    $("#contentList").querySelectorAll("[data-comments-toggle]").forEach(b=>b.onclick=async()=>{
      await api("/v1/admin/content/"+b.dataset.kind+"/"+b.dataset.commentsToggle+"/moderate",{
        method:"POST",body:JSON.stringify({status:"active",comments_enabled:b.dataset.enabled!=="true"})
      });
      showToast("تم تحديث إعداد التعليقات.",{type:"success"});
      loadContent(currentContentKind);
    });
    $("#contentList").querySelectorAll("[data-delete-content]").forEach(b=>b.onclick=async()=>{
      const mediaCount=Number(b.dataset.mediaCount||0);
      if(!await adminConfirm("حذف المحتوى نهائيًا؟","سيتم حذف السجل و"+mediaCount+" ملف/ملفات مرتبطة غير مستخدمة من التخزين. أي فشل في Telegram يدخل طابور إعادة المحاولة.",{acceptLabel:"حذف نهائي",danger:true}))return;
      const result=await api("/v1/admin/content/"+b.dataset.kind+"/"+b.dataset.deleteContent,{method:"DELETE"});
      const pending=(result.cleanup||[]).filter(item=>item.status==="cleanup_pending").length;
      showToast(pending?"حُذف المحتوى و"+pending+" ملف دخل طابور التنظيف.":"تم حذف المحتوى وتنظيف وسائطه.",{type:"success",duration:4500});
      loadContent(currentContentKind);
    });

    $("#contentPager").classList.toggle("hidden",Number(p.total||0)<=Number(p.limit||24));
    $("#contentPageLabel").textContent=contentPage+" / "+contentPages+" · "+Number(p.total||0).toLocaleString("ar-IQ");
    $("#contentPrevPage").disabled=contentPage<=1;
    $("#contentNextPage").disabled=contentPage>=contentPages;
  }catch(e){$("#contentList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

let commentTimer;
let commentsPage=1;
let commentsPages=1;
$("#commentSearch").oninput=()=>{
  clearTimeout(commentTimer);
  commentTimer=setTimeout(()=>{commentsPage=1;loadCommentsAdmin()},250);
};
$("#commentStatus").onchange=()=>{commentsPage=1;loadCommentsAdmin()};
$("#commentsPrevPage")?.addEventListener("click",()=>{if(commentsPage>1){commentsPage--;loadCommentsAdmin()}});
$("#commentsNextPage")?.addEventListener("click",()=>{if(commentsPage<commentsPages){commentsPage++;loadCommentsAdmin()}});

async function loadCommentsAdmin(){
  try{
    const params=new URLSearchParams({page:String(commentsPage),limit:"40"});
    const q=$("#commentSearch").value.trim();
    const status=$("#commentStatus").value;
    if(q)params.set("q",q);
    if(status)params.set("status",status);
    const d=await api("/v1/admin/comments?"+params.toString());
    const p=d.pagination||{};
    commentsPages=Math.max(1,Number(p.pages||1));
    if(commentsPage>commentsPages){commentsPage=commentsPages;return loadCommentsAdmin()}
    $("#commentsList").innerHTML=(d.items||[]).map(row=>{
      const a=row.author||{};
      const status=row.moderation_status||"active";
      return '<div class="row-card">'+
        '<div class="list-avatar">'+(a.avatar_media_id?'<img data-media-id="'+esc(a.avatar_media_id)+'" alt="">':'<span>'+esc((a.name||a.username||"م").slice(0,1))+'</span>')+'</div>'+
        '<div class="grow"><b>'+esc(row.body||"")+'</b><div class="meta">@'+esc(a.username||"")+' · '+new Date(row.created_at).toLocaleString("ar-IQ")+'</div><div class="meta mono">'+esc(row.id)+'</div></div>'+
        '<span class="pill '+pillClass(status)+'">'+statusLabel(status)+'</span>'+
        '<button class="small" data-comment-author="'+esc(row.author_id)+'" type="button">الحساب</button>'+
        ((row.post_id||row.reel_id)?'<button class="small" data-comment-target="'+esc(row.post_id||row.reel_id)+'" data-comment-kind="'+(row.post_id?"posts":"reels")+'" type="button">المحتوى الأصلي</button>':"")+
        '<button class="small" data-moderate-comment="'+esc(row.id)+'" data-status="'+esc(status)+'" type="button">'+(status==="hidden"?"استعادة":"إخفاء")+'</button>'+
      '</div>';
    }).join("")||'<div class="panel">لا توجد تعليقات.</div>';
    await hydrateAdminMedia($("#commentsList"));
    $("#commentsList").querySelectorAll("[data-comment-author]").forEach(b=>b.onclick=()=>{navigate("users");loadUserDetail(b.dataset.commentAuthor)});
    $("#commentsList").querySelectorAll("[data-comment-target]").forEach(b=>b.onclick=()=>{
      currentContentKind=b.dataset.commentKind;
      contentTargetId=b.dataset.commentTarget;
      contentPage=1;
      $("#contentSearch").value="";
      $("#contentAuthor").value="";
      $$("[data-content-kind]").forEach(x=>x.classList.toggle("active",x.dataset.contentKind===currentContentKind));
      navigate("content");
    });
    $("#commentsList").querySelectorAll("[data-moderate-comment]").forEach(b=>b.onclick=async()=>{
      const next=b.dataset.status==="hidden"?"active":"hidden";
      await api("/v1/admin/content/comments/"+b.dataset.moderateComment+"/moderate",{
        method:"POST",
        body:JSON.stringify({
          status:next,
          reason:next==="hidden"?((await adminPrompt("إخفاء التعليق",{label:"سبب الإخفاء",acceptLabel:"إخفاء"}))||""):""
        })
      });
      showToast(next==="hidden"?"تم إخفاء التعليق.":"تمت استعادة التعليق.",{type:"success"});
      loadCommentsAdmin();
    });
    $("#commentsPager").classList.toggle("hidden",Number(p.total||0)<=Number(p.limit||40));
    $("#commentsPageLabel").textContent=commentsPage+" / "+commentsPages+" · "+Number(p.total||0).toLocaleString("ar-IQ");
    $("#commentsPrevPage").disabled=commentsPage<=1;
    $("#commentsNextPage").disabled=commentsPage>=commentsPages;
  }catch(e){$("#commentsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

$("#reportStatus").onchange=loadReports;
async function loadReports(){
  try{
    const d=await api("/v1/admin/reports");
    const wanted=$("#reportStatus")?.value||"";
    const rows=(d.items||[]).filter(r=>!wanted||r.status===wanted);
    $("#reportsList").innerHTML=rows.map(r=>{
      const reporter=r.reporter||{};
      return '<div class="report-card">'+
        '<div class="grow"><div class="moderation-head"><div><b>'+esc(r.reason||"بلاغ")+'</b><div class="meta">بواسطة @'+esc(reporter.username||"")+' · '+new Date(r.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(r.status)+'">'+statusLabel(r.status)+'</span></div>'+
        (r.details?'<p>'+esc(r.details)+'</p>':"")+
        '<div class="meta">الهدف: '+esc(r.target_type)+' · <span class="mono">'+esc(r.target_id)+'</span></div>'+
        (r.admin_note?'<div class="admin-note">ملاحظة الإدارة: '+esc(r.admin_note)+'</div>':"")+
        '<div class="admin-actions">'+
          (["open","review"].includes(r.status)?'<button class="small" data-report-review="'+esc(r.id)+'" type="button">قيد المراجعة</button>':"")+
          (["post","reel","story","comment"].includes(r.target_type)?'<button class="small danger" data-report-hide="'+esc(r.id)+'" type="button">إخفاء المحتوى وحل البلاغ</button>':"")+
          '<button class="small" data-report-resolve="'+esc(r.id)+'" type="button">حل بدون حذف</button>'+
          '<button class="small" data-report-reject="'+esc(r.id)+'" type="button">رفض البلاغ</button>'+
        '</div>'+
      '</div>';
    }).join("")||'<div class="panel">لا توجد بلاغات مطابقة.</div>';

    const act=async(id,status,action="")=>{
      const note=(await adminPrompt("ملاحظة المراجعة",{label:"ملاحظة داخلية",defaultValue:"",acceptLabel:"متابعة"}))||"";
      await api("/v1/admin/reports/"+id+"/action",{method:"POST",body:JSON.stringify({status,action,admin_note:note})});
      loadReports();
    };
    $("#reportsList").querySelectorAll("[data-report-review]").forEach(b=>b.onclick=()=>act(b.dataset.reportReview,"review"));
    $("#reportsList").querySelectorAll("[data-report-hide]").forEach(b=>b.onclick=()=>act(b.dataset.reportHide,"resolved","hide_content"));
    $("#reportsList").querySelectorAll("[data-report-resolve]").forEach(b=>b.onclick=()=>act(b.dataset.reportResolve,"resolved","none"));
    $("#reportsList").querySelectorAll("[data-report-reject]").forEach(b=>b.onclick=()=>act(b.dataset.reportReject,"rejected","rejected"));
  }catch(e){$("#reportsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

async function loadStorage(){
  try{
    const d=await api("/v1/admin/channels");
    $("#channelsList").innerHTML=(d.items||[]).map(row=>
      '<div class="channel-card">'+
        '<div class="grow"><b>'+esc(row.title||row.channel_key)+'</b>'+
        '<div class="meta">المعرف: '+esc(row.channel_id)+' · آخر اختبار: '+(row.last_test_at?new Date(row.last_test_at).toLocaleString("ar-IQ"):"لم يُختبر")+'</div>'+
        '<div class="meta">آخر رفع: '+(row.last_upload_at?new Date(row.last_upload_at).toLocaleString("ar-IQ"):"لا يوجد")+'</div></div>'+
        '<span class="pill '+(row.status==="connected"?"ok":"bad")+'">'+(row.status==="connected"?"مربوطة":"تحتاج فحص")+'</span>'+
        '<button class="small" data-test-channel="'+esc(row.channel_key)+'" type="button">اختبار</button>'+
      '</div>'
    ).join("")||'<div class="panel">لم يتم ربط قنوات التخزين بعد.</div>';
    $("#channelsList").querySelectorAll("[data-test-channel]").forEach(b=>b.onclick=async()=>{
      b.disabled=true;b.textContent="جارٍ الفحص...";
      try{
        await api("/v1/admin/channels/"+encodeURIComponent(b.dataset.testChannel)+"/test",{method:"POST"});
        await loadStorage();
      }catch(error){showToast(error.message,{type:"error"});b.disabled=false;b.textContent="إعادة الاختبار"}
    });
  }catch(e){$("#channelsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

$("#uploadStatus").onchange=loadUploads;
async function loadUploads(){
  try{
    const status=$("#uploadStatus")?.value||"";
    const d=await api("/v1/admin/uploads"+(status?"?status="+encodeURIComponent(status):""));
    $("#uploadsList").innerHTML=(d.items||[]).map(row=>{
      const total=Number(row.size_bytes||0),received=Number(row.received_bytes||0);
      const pct=total?Math.min(100,Math.round(received/total*100)):(row.status==="completed"?100:0);
      return '<div class="upload-admin-card">'+
        '<div class="grow"><div class="moderation-head"><div><b>'+esc(row.original_name||"ملف")+'</b><div class="meta">'+esc(row.kind)+' · '+formatBytes(total)+'</div></div><span class="pill '+pillClass(row.status)+'">'+statusLabel(row.status)+'</span></div>'+
        '<div class="admin-progress"><i style="width:'+pct+'%"></i></div><div class="meta">'+pct+'% · '+new Date(row.created_at).toLocaleString("ar-IQ")+'</div>'+
        (row.error?'<div class="error-text">'+esc(row.error)+'</div>':"")+
        (["queued","receiving","storing"].includes(row.status)?'<button class="small danger" data-cancel-upload="'+esc(row.id)+'" type="button">إلغاء العملية</button>':"")+
        '</div></div>';
    }).join("")||'<div class="panel">لا توجد عمليات رفع.</div>';
    $("#uploadsList").querySelectorAll("[data-cancel-upload]").forEach(b=>b.onclick=async()=>{
      if(!await adminConfirm("إلغاء عملية الرفع؟","سيُطلب من الخادم إيقاف العملية الجارية.",{acceptLabel:"إلغاء العملية",danger:true}))return;
      await api("/v1/admin/uploads/"+b.dataset.cancelUpload+"/cancel",{method:"POST"});
      loadUploads();
    });
  }catch(e){$("#uploadsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

$("#errorStatus").onchange=loadErrors;
async function loadErrors(){
  try{
    const status=$("#errorStatus")?.value||"";
    const d=await api("/v1/admin/errors"+(status?"?status="+encodeURIComponent(status):""));
    $("#errorsList").innerHTML=(d.items||[]).map(row=>
      '<div class="report-card"><div class="grow">'+
        '<div class="moderation-head"><div><b>'+esc(row.service||"system")+'</b><div class="meta">'+new Date(row.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(row.status)+'">'+statusLabel(row.status)+'</span></div>'+
        '<p>'+esc(row.message||"")+'</p>'+
        (row.code?'<div class="meta">الكود: '+esc(row.code)+'</div>':"")+
        (row.status!=="resolved"?'<button class="small" data-resolve-error="'+esc(row.id)+'" type="button">تمت المعالجة</button>':"")+
      '</div></div>'
    ).join("")||'<div class="panel">لا توجد أخطاء.</div>';
    $("#errorsList").querySelectorAll("[data-resolve-error]").forEach(b=>b.onclick=async()=>{
      await api("/v1/admin/errors/"+b.dataset.resolveError+"/resolve",{method:"POST"});
      loadErrors();
    });
  }catch(e){$("#errorsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

$("#supportStatus").onchange=loadSupport;
async function loadSupport(){
  try{
    const status=$("#supportStatus")?.value||"";
    const d=await api("/v1/admin/support"+(status?"?status="+encodeURIComponent(status):""));
    $("#supportList").innerHTML=(d.items||[]).map(t=>
      '<div class="report-card"><div class="grow">'+
        '<div class="moderation-head"><div><b>'+esc(t.subject||"تذكرة دعم")+'</b><div class="meta">'+esc(t.category||"general")+' · '+new Date(t.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(t.status)+'">'+statusLabel(t.status)+'</span></div>'+
        '<p>'+esc(t.body||"")+'</p>'+
        '<div class="meta">المستخدم: <span class="mono">'+esc(t.user_id)+'</span> · الإصدار: '+esc(t.app_version||"—")+'</div>'+
        (t.admin_reply?'<div class="admin-note"><b>رد الإدارة:</b> '+esc(t.admin_reply)+'</div>':"")+
        '<div class="admin-actions"><button class="small" data-support-user="'+esc(t.user_id)+'" type="button">الحساب</button>'+
        '<button class="small" data-reply-ticket="'+esc(t.id)+'" type="button">رد / تحديث الحالة</button></div>'+
      '</div></div>'
    ).join("")||'<div class="panel">لا توجد تذاكر دعم.</div>';
    $("#supportList").querySelectorAll("[data-support-user]").forEach(b=>b.onclick=()=>{navigate("users");loadUserDetail(b.dataset.supportUser)});
    $("#supportList").querySelectorAll("[data-reply-ticket]").forEach(b=>b.onclick=async()=>{
      const reply=await adminPrompt("رد الإدارة",{text:"يمكن ترك الرد فارغًا إذا كنت تريد تغيير الحالة فقط.",label:"الرد",defaultValue:"",acceptLabel:"التالي"});
      if(reply===null)return;
      const status=await adminPrompt("حالة التذكرة",{text:"القيم المتاحة: open / in_progress / answered / closed",label:"الحالة",defaultValue:reply.trim()?"answered":"in_progress",acceptLabel:"حفظ"});
      if(!status)return;
      try{
        await api("/v1/admin/support/"+b.dataset.replyTicket+"/reply",{method:"POST",body:JSON.stringify({reply,status})});
        loadSupport();
      }catch(error){showToast(error.message,{type:"error"})}
    });
  }catch(e){$("#supportList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

$("#notificationAudience").onchange=()=>$("#targetUserRow").classList.toggle("hidden",$("#notificationAudience").value!=="user");
$("#notificationForm").onsubmit=async e=>{
  e.preventDefault();
  const scheduled=$("#notificationScheduledAt").value;
  const when=scheduled?new Date(scheduled).toISOString():null;
  const isScheduled=when&&new Date(when)>new Date(Date.now()+15000);
  if(!await adminConfirm(isScheduled?"جدولة الإشعار؟":"إرسال الإشعار؟",isScheduled?"سيتم إرسال الإشعار تلقائيًا في الموعد المحدد.":"سيبدأ الإرسال فور التأكيد.",{acceptLabel:isScheduled?"جدولة":"إرسال"}))return;
  $("#notificationMessage").textContent=isScheduled?"جارٍ الجدولة...":"جارٍ الإرسال...";
  try{
    const entityType=$("#notificationEntityType").value;
    const entityId=$("#notificationEntityId").value.trim();
    await api("/v1/admin/notifications/send",{method:"POST",body:JSON.stringify({
      title:$("#notificationTitle").value.trim(),
      body:$("#notificationBody").value.trim(),
      audience:$("#notificationAudience").value,
      user_id:$("#notificationUser").value.trim()||null,
      scheduled_at:when,
      deep_link:entityType?{entity_type:entityType,entity_id:entityId||null}:{}
    })});
    $("#notificationMessage").textContent=isScheduled?"تمت جدولة الإشعار.":"تم إرسال الإشعار.";
    await loadNotificationHistory();
  }catch(err){$("#notificationMessage").textContent=err.message}
};

async function loadNotificationHistory(){
  try{
    const d=await api("/v1/admin/notifications/history");
    $("#notificationHistory").innerHTML=(d.items||[]).map(n=>
      '<div class="row-card"><div class="grow"><b>'+esc(n.title||"إشعار")+'</b><div class="meta">'+esc(n.audience||"all")+' · '+new Date(n.created_at).toLocaleString("ar-IQ")+'</div><p>'+esc(n.body||"")+'</p></div><span class="pill '+pillClass(n.status)+'">'+statusLabel(n.status)+'</span></div>'
    ).join("")||'<div class="meta">لا توجد إشعارات مرسلة بعد.</div>';
  }catch(e){$("#notificationHistory").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

async function loadAdmins(){
  try{
    const d=await api("/v1/admin/admins");
    $("#adminsList").innerHTML=(d.items||[]).map(a=>{
      const p=Array.isArray(a.profiles)?a.profiles[0]:a.profiles||{};
      const isOwner=a.role==="owner";
      return '<div class="admin-card">'+
        '<div class="grow"><b>'+esc(p.name||p.username||a.user_id)+'</b><div class="meta">@'+esc(p.username||"")+' · '+esc(a.user_id)+'</div>'+
        '<div class="meta">آخر نشاط: '+(a.last_active_at?new Date(a.last_active_at).toLocaleString("ar-IQ"):"غير متوفر")+'</div></div>'+
        '<span class="pill '+(a.active?"ok":"bad")+'">'+(a.active?"نشط":"متوقف")+'</span>'+
        (isOwner?'<span class="pill">المالك</span>':
          '<select class="admin-role-select" data-admin-role="'+esc(a.user_id)+'">'+
            ["secondary_admin","moderator","content_moderator","support","analyst"].map(role=>
              '<option value="'+role+'" '+(a.role===role?"selected":"")+'>'+esc(roleLabel[role]||role)+'</option>'
            ).join("")+
          '</select>'+
          '<button class="small '+(a.active?"danger":"")+'" data-admin-active="'+esc(a.user_id)+'" data-active="'+String(a.active)+'" type="button">'+(a.active?"تعطيل":"تفعيل")+'</button>'
        )+
      '</div>';
    }).join("")||'<div class="panel">لا يوجد مشرفون إضافيون.</div>';
    $("#adminsList").querySelectorAll("[data-admin-role]").forEach(sel=>sel.onchange=async()=>{
      const old=sel.dataset.current||"";
      sel.disabled=true;
      try{
        await api("/v1/admin/admins/"+sel.dataset.adminRole,{method:"PATCH",body:JSON.stringify({role:sel.value})});
        await loadAdmins();
      }catch(error){
        showToast(error.message,{type:"error"});
        if(old)sel.value=old;
        sel.disabled=false;
      }
    });
    $("#adminsList").querySelectorAll("[data-admin-active]").forEach(btn=>btn.onclick=async()=>{
      const active=btn.dataset.active==="true";
      if(active&&!await adminConfirm("تعطيل المشرف؟","سيفقد هذا الحساب صلاحية الدخول إلى لوحة الإدارة.",{acceptLabel:"تعطيل",danger:true}))return;
      btn.disabled=true;
      try{
        await api("/v1/admin/admins/"+btn.dataset.adminActive,{method:"PATCH",body:JSON.stringify({active:!active})});
        await loadAdmins();
      }catch(error){showToast(error.message,{type:"error"});btn.disabled=false}
    });
  }catch(e){$("#adminsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}
$("#addAdminButton").onclick=async()=>{
  const userId=await adminPrompt("إضافة مشرف",{label:"معرف المستخدم UUID",placeholder:"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",acceptLabel:"التالي"});
  if(!userId)return;
  const role=await adminPrompt("دور المشرف",{text:"secondary_admin / moderator / content_moderator / support / analyst",label:"الدور",defaultValue:"moderator",acceptLabel:"إضافة"});
  if(!role)return;
  try{
    await api("/v1/admin/admins",{method:"POST",body:JSON.stringify({user_id:userId.trim(),role:role.trim(),permissions:{}})});
    await loadAdmins();
  }catch(e){showToast(e.message,{type:"error"})}
};

async function loadReleases(){
  try{
    const d=await api("/v1/admin/releases");
    $("#releasesList").innerHTML=(d.items||[]).map(r=>
      '<div class="release-card">'+
        '<div class="grow"><div class="moderation-head"><div><b>v'+esc(r.version)+'</b><div class="meta">Version Code '+Number(r.version_code||0)+' · '+new Date(r.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(r.status)+'">'+statusLabel(r.status)+'</span></div>'+
        (r.notes?'<p>'+esc(r.notes)+'</p>':"")+
        '<div class="meta">أقل إصدار: '+esc(r.minimum_version||"—")+' · '+(r.required?"إجباري":"اختياري")+'</div>'+
        '<div class="admin-actions">'+
          (r.status!=="published"?'<button class="small" data-release-publish="'+esc(r.id)+'" type="button">اعتماد كمنشور</button>':"")+
          (r.status!=="testing"?'<button class="small" data-release-testing="'+esc(r.id)+'" type="button">وضع الاختبار</button>':"")+
          (r.status!=="retired"?'<button class="small" data-release-retire="'+esc(r.id)+'" type="button">إيقاف الإصدار</button>':"")+
        '</div>'+
      '</div>'
    ).join("")||'<div class="panel">لا توجد إصدارات مسجلة.</div>';
    const change=async(id,status)=>{
      await api("/v1/admin/releases/"+id,{method:"PATCH",body:JSON.stringify({status})});
      await loadReleases();
    };
    $("#releasesList").querySelectorAll("[data-release-publish]").forEach(b=>b.onclick=()=>change(b.dataset.releasePublish,"published"));
    $("#releasesList").querySelectorAll("[data-release-testing]").forEach(b=>b.onclick=()=>change(b.dataset.releaseTesting,"testing"));
    $("#releasesList").querySelectorAll("[data-release-retire]").forEach(b=>b.onclick=()=>change(b.dataset.releaseRetire,"retired"));
  }catch(e){$("#releasesList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}
$("#releaseForm").onsubmit=async e=>{
  e.preventDefault();
  $("#releaseMessage").textContent="جارٍ الحفظ...";
  try{
    await api("/v1/admin/releases",{method:"POST",body:JSON.stringify({
      version:$("#releaseVersion").value.trim(),
      version_code:Number($("#releaseCode").value||0),
      download_url:$("#releaseUrl").value.trim(),
      notes:$("#releaseNotes").value.trim(),
      minimum_version:$("#releaseMinimum").value.trim(),
      status:$("#releaseStatus").value,
      required:$("#releaseRequired").checked
    })});
    $("#releaseMessage").textContent="تمت إضافة الإصدار إلى السجل.";
    $("#releaseForm").reset();
    await loadReleases();
  }catch(error){$("#releaseMessage").textContent=error.message}
};

async function loadAudit(){
  try{
    const d=await api("/v1/admin/audit");
    $("#auditList").innerHTML=(d.items||[]).map(row=>`
      <div class="row-card">
        <div class="grow">
          <b>${actionLabel[row.action]||esc(row.action)}</b>
          <div class="meta">${row.target_type?esc(row.target_type)+" · ":""}${row.target_id?esc(row.target_id)+" · ":""}${new Date(row.created_at).toLocaleString("ar-IQ")}</div>
        </div>
      </div>`).join("")||'<div class="panel">السجل فارغ.</div>'
  }catch(e){$("#auditList").innerHTML=`<div class="panel">${esc(e.message)}</div>`}
}

async function loadAppSettings(){
  try{
    const d=await api("/v1/admin/settings/app");
    $("#latestVersion").value=d.version?.latest||"";
    $("#minimumVersion").value=d.version?.minimum||"";
    $("#appDownloadUrl").value=d.version?.download_url||"";
    $("#requiredUpdate").checked=!!d.version?.required;
    $("#maintenanceEnabled").checked=!!d.maintenance?.enabled;
    $("#maintenanceMessage").value=d.maintenance?.message||"";

    const feat=d.features||{};
    $("#featureStories").checked=feat.stories!==false;
    $("#featureReels").checked=feat.reels!==false;
    $("#featureMessages").checked=feat.messages!==false;
    $("#featureGroups").checked=feat.groups!==false;
    $("#featureRegistration").checked=feat.registration!==false;
    $("#featureComments").checked=feat.comments!==false;
    $("#featureExplore").checked=feat.explore!==false;
    $("#featureUploads").checked=feat.uploads!==false;
    $("#featureSearch").checked=feat.search!==false;
    $("#featureSaved").checked=feat.saved!==false;
    $("#featureNotifications").checked=feat.notifications!==false;

    const lim=d.limits||{};
    $("#limitGeneral").value=lim.max_upload_mb||60;
    $("#limitStory").value=lim.story_mb||30;
    $("#limitImage").value=lim.image_mb||10;
    $("#limitChatVideo").value=lim.chat_video_mb||50;
    $("#limitAudio").value=lim.audio_mb||15;
  }catch(e){}
}
$("#appSettingsForm").onsubmit=async e=>{
  e.preventDefault();
  await api("/v1/admin/settings/app",{method:"PUT",body:JSON.stringify({
    version:{
      latest:$("#latestVersion").value,
      minimum:$("#minimumVersion").value,
      download_url:$("#appDownloadUrl").value,
      required:$("#requiredUpdate").checked
    },
    maintenance:{
      enabled:$("#maintenanceEnabled").checked,
      message:$("#maintenanceMessage").value
    },
    features:{
      stories:$("#featureStories").checked,
      reels:$("#featureReels").checked,
      messages:$("#featureMessages").checked,
      groups:$("#featureGroups").checked,
      registration:$("#featureRegistration").checked,
      comments:$("#featureComments").checked,
      explore:$("#featureExplore").checked,
      uploads:$("#featureUploads").checked,
      search:$("#featureSearch").checked,
      saved:$("#featureSaved").checked,
      notifications:$("#featureNotifications").checked
    },
    limits:{
      max_upload_mb:Number($("#limitGeneral").value||60),
      story_mb:Number($("#limitStory").value||30),
      image_mb:Number($("#limitImage").value||10),
      chat_video_mb:Number($("#limitChatVideo").value||50),
      audio_mb:Number($("#limitAudio").value||15)
    }
  })});
  showToast("تم حفظ إعدادات التطبيق",{type:"success"})
};

async function loadSiteSettings(){
  try{
    const d=await api("/v1/admin/settings/site");
    $("#siteTitle").value=d.hero?.title||"آشور";
    $("#siteSubtitle").value=d.hero?.subtitle||"";
    $("#siteAndroidUrl").value=d.download?.android_url||"";
    $("#siteWebUrl").value=d.download?.web_url||"";
    $("#siteVersion").value=d.download?.version||"";
    $("#siteSize").value=d.download?.size||""
  }catch(e){}
}
$("#siteSettingsForm").onsubmit=async e=>{
  e.preventDefault();
  await api("/v1/admin/settings/site",{method:"PUT",body:JSON.stringify({
    hero:{title:$("#siteTitle").value,subtitle:$("#siteSubtitle").value},
    download:{
      android_url:$("#siteAndroidUrl").value,
      web_url:$("#siteWebUrl").value,
      version:$("#siteVersion").value,
      size:$("#siteSize").value,
      updated_at:new Date().toISOString()
    }
  })});
  showToast("تم تحديث الموقع",{type:"success"})
};

async function loadHealth(){
  try{
    const d=await api("/health/details");
    $("#healthCards").innerHTML=Object.entries(d.services||{}).map(([k,v])=>`
      <div class="health-card">
        <div class="grow"><b>${esc(v.label||k)}</b><div class="meta">${esc(v.detail||"")}</div></div>
        <span class="pill ${v.ok?"ok":"bad"}">${v.ok?"يعمل":"متوقف"}</span>
      </div>`).join("")
  }catch(e){$("#healthCards").innerHTML=`<div class="panel">${esc(e.message)}</div>`}
}

document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")setConnectionState(navigator.onLine);
});
verify();
})();