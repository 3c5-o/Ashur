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
const permissionLabel={
  analytics:"الرئيسية والتحليلات",
  users:"المستخدمون",
  content:"المحتوى والتعليقات",
  reports:"البلاغات",
  support:"الدعم الفني",
  storage:"التخزين والرفع والأخطاء",
  notifications:"الإشعارات",
  admins:"المشرفون وسجل الإدارة",
  settings:"الإصدارات والإعدادات"
};
const pagePermission={
  dashboard:"analytics",
  users:"users",
  content:"content",
  comments:"content",
  reports:"reports",
  support:"support",
  storage:"storage",
  uploads:"storage",
  errors:"storage",
  notifications:"notifications",
  admins:"admins",
  audit:"admins",
  releases:"settings",
  appSettings:"settings",
  siteSettings:"settings",
  health:"analytics"
};
let adminAccess=null;
let adminRoleDefaults={};
let uploadsLiveTimer=null;
let storageLiveTimer=null;

function adminCan(permission){
  if(!permission)return true;
  return adminAccess?.effective_permissions?.[permission]===true;
}
function adminCanPage(page){
  return adminCan(pagePermission[page]);
}
function applyAdminAccess(me){
  adminAccess=me||null;
  $$("[data-page]").forEach(node=>{
    const page=node.dataset.page;
    if(!page)return;
    node.classList.toggle("permission-hidden",!adminCanPage(page));
  });
  document.body.dataset.adminRole=me?.role||"";
}
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
    const me=await api("/v1/admin/me");
    applyAdminAccess(me);
    showApp(true);
    const start=adminCanPage("dashboard")?"dashboard":Object.keys(titles).find(adminCanPage)||"dashboard";
    navigate(start,{history:false,loading:true});
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
  if(!adminCanPage(page)){
    const fallback=adminCanPage("dashboard")?"dashboard":Object.keys(titles).find(adminCanPage);
    if(!fallback){showToast("لا توجد أقسام إدارية متاحة لهذا الحساب.",{type:"error"});return}
    page=fallback;
  }
  if(page!=="uploads"&&uploadsLiveTimer){clearInterval(uploadsLiveTimer);uploadsLiveTimer=null}
  if(page!=="storage"&&storageLiveTimer){clearInterval(storageLiveTimer);storageLiveTimer=null}
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

const priorityLabels={urgent:"عاجل",high:"عالية",normal:"عادية",low:"منخفضة"};
const reportTypeLabels={profile:"حساب",post:"منشور",reel:"ريلز",story:"قصة",comment:"تعليق",message:"رسالة"};
const reportEventLabels={
  review:"بدء المراجعة",update:"تحديث البلاغ",hide_content:"إخفاء المحتوى",
  restore_content:"استعادة المحتوى",delete_content:"حذف الهدف",warn_user:"تحذير المستخدم",
  ban_user:"حظر المستخدم",resolve:"حل البلاغ",reject:"رفض البلاغ"
};
let reportPage=1;
let reportPages=1;
let reportTimer;

function reportPriorityClass(priority){
  return priority==="urgent"||priority==="high"?"bad":priority==="low"?"":"ok";
}
function resetReportPage(){reportPage=1}
$("#reportSearch").oninput=()=>{
  clearTimeout(reportTimer);
  reportTimer=setTimeout(()=>{resetReportPage();loadReports()},280);
};
["reportStatus","reportType","reportPriority","reportAssigned","reportFrom","reportTo"].forEach(id=>{
  $("#"+id)?.addEventListener("change",()=>{resetReportPage();loadReports()});
});
$("#resetReportFilters")?.addEventListener("click",()=>{
  ["reportSearch","reportStatus","reportType","reportPriority","reportAssigned","reportFrom","reportTo"].forEach(id=>{
    const el=$("#"+id);if(el)el.value="";
  });
  resetReportPage();loadReports();
});
$("#reportsPrevPage")?.addEventListener("click",()=>{if(reportPage>1){reportPage--;loadReports()}});
$("#reportsNextPage")?.addEventListener("click",()=>{if(reportPage<reportPages){reportPage++;loadReports()}});

async function runReportAction(reportId,payload,{success="تم تحديث البلاغ.",reloadDetail=true}={}){
  const result=await api("/v1/admin/reports/"+reportId+"/action",{
    method:"POST",body:JSON.stringify(payload)
  });
  showToast(success,{type:"success"});
  await loadReports();
  if(reloadDetail&&!$("#reportDetail").classList.contains("hidden"))await openReportDetail(reportId);
  return result;
}

async function openReportDetail(reportId){
  try{
    const d=await api("/v1/admin/reports/"+encodeURIComponent(reportId));
    const r=d.report||{}, reporter=d.reporter||{}, target=d.target||{}, targetUser=d.target_user||{}, assignee=d.assignee||{};
    const targetData=target.data||{};
    const canModerate=["post","reel","story","comment"].includes(r.target_type);
    const canDelete=["post","reel","story","comment","message"].includes(r.target_type);
    const hidden=targetData.moderation_status==="hidden";
    const media=(target.media_ids||[]).map(id=>'<div class="report-target-media"><img data-media-id="'+esc(id)+'" alt=""></div>').join("");
    const events=(d.events||[]).map(ev=>
      '<div class="stage56-event"><i></i><div><b>'+esc(reportEventLabels[ev.event_type]||ev.event_type||"إجراء")+'</b>'+
      (ev.note?'<p>'+esc(ev.note)+'</p>':"")+
      '<span>'+new Date(ev.created_at).toLocaleString("ar-IQ")+'</span></div></div>'
    ).join("")||'<div class="meta">لا توجد إجراءات سابقة على هذا البلاغ.</div>';

    $("#reportDetail").classList.remove("hidden");
    $("#reportDetail").innerHTML=
      '<div class="panel-head"><div><span class="eyebrow">تفاصيل البلاغ</span><h3>'+esc(r.reason||"بلاغ")+'</h3></div><button id="closeReportDetail" class="small" type="button">إغلاق</button></div>'+
      '<div class="stage56-summary">'+
        '<div><span>الحالة</span><b>'+statusLabel(r.status)+'</b></div>'+
        '<div><span>الأولوية</span><b>'+esc(priorityLabels[r.priority]||r.priority||"عادية")+'</b></div>'+
        '<div><span>النوع</span><b>'+esc(reportTypeLabels[r.target_type]||r.target_type)+'</b></div>'+
        '<div><span>بلاغات نفس الهدف</span><b>'+Number(d.duplicate_count||0)+'</b></div>'+
      '</div>'+
      '<div class="stage56-two-col">'+
        '<div class="stage56-card"><span class="eyebrow">مقدم البلاغ</span><div class="stage56-person">'+
          (reporter.avatar_media_id?'<div class="list-avatar"><img data-media-id="'+esc(reporter.avatar_media_id)+'" alt=""></div>':'<div class="list-avatar"><span>'+esc((reporter.name||reporter.username||"م").slice(0,1))+'</span></div>')+
          '<div class="grow"><b>'+esc(reporter.name||"مستخدم")+'</b><div class="meta">@'+esc(reporter.username||"")+'</div></div>'+
          '<button id="openReporterAccount" class="small" type="button">الحساب</button>'+
        '</div></div>'+
        '<div class="stage56-card"><span class="eyebrow">صاحب الهدف</span>'+
          (targetUser.id?'<div class="stage56-person">'+
            (targetUser.avatar_media_id?'<div class="list-avatar"><img data-media-id="'+esc(targetUser.avatar_media_id)+'" alt=""></div>':'<div class="list-avatar"><span>'+esc((targetUser.name||targetUser.username||"م").slice(0,1))+'</span></div>')+
            '<div class="grow"><b>'+esc(targetUser.name||"مستخدم")+'</b><div class="meta">@'+esc(targetUser.username||"")+'</div></div>'+
            '<button id="openTargetAccount" class="small" type="button">الحساب</button></div>':'<div class="meta">الهدف غير مرتبط بحساب متاح.</div>')+
        '</div>'+
      '</div>'+
      '<div class="stage56-card"><div class="moderation-head"><div><span class="eyebrow">الهدف المبلغ عنه</span><h3>'+esc(target.title||reportTypeLabels[r.target_type]||"الهدف")+'</h3></div>'+
        (target.missing?'<span class="pill bad">غير موجود</span>':(targetData.moderation_status?'<span class="pill '+pillClass(targetData.moderation_status)+'">'+statusLabel(targetData.moderation_status)+'</span>':""))+
      '</div>'+
      (media?'<div class="report-target-gallery">'+media+'</div>':"")+
      (target.text?'<p class="stage56-target-text">'+esc(target.text)+'</p>':"")+
      '<div class="meta mono">'+esc(r.target_id||"")+'</div></div>'+
      (r.details?'<div class="stage56-card"><span class="eyebrow">تفاصيل المبلغ</span><p>'+esc(r.details)+'</p></div>':"")+
      '<div class="stage56-card"><span class="eyebrow">إدارة البلاغ</span>'+
        '<div class="stage56-control-grid">'+
          '<label><span>الأولوية</span><select id="reportDetailPriority">'+
            ["urgent","high","normal","low"].map(x=>'<option value="'+x+'" '+(r.priority===x?"selected":"")+'>'+priorityLabels[x]+'</option>').join("")+
          '</select></label>'+
          '<div><span>المسند إلى</span><b>'+(assignee.id?esc(assignee.name||assignee.username||"مشرف"):"غير مسند")+'</b></div>'+
        '</div>'+
        '<label><span>ملاحظة داخلية</span><textarea id="reportDetailNote" maxlength="1500" placeholder="سبب القرار أو ملاحظة للمشرفين">'+esc(r.admin_note||"")+'</textarea></label>'+
        '<div class="admin-actions">'+
          '<button id="reportAssignMe" class="small" type="button">إسناد لي</button>'+
          '<button id="reportUnassign" class="small" type="button">إلغاء الإسناد</button>'+
          '<button id="reportReview" class="small" type="button">قيد المراجعة</button>'+
          (canModerate?'<button id="reportToggleHidden" class="small" type="button">'+(hidden?"استعادة الهدف":"إخفاء الهدف")+'</button>':"")+
          (targetUser.id?'<button id="reportWarnUser" class="small" type="button">تحذير المستخدم</button>':"")+
          (targetUser.id?'<button class="small danger" data-report-ban-hours="24" type="button">حظر يوم</button><button class="small danger" data-report-ban-hours="168" type="button">حظر أسبوع</button><button class="small danger" data-report-ban-hours="0" type="button">حظر دائم</button>':"")+
          (canDelete?'<button id="reportDeleteTarget" class="small danger" type="button">حذف الهدف</button>':"")+
          '<button id="reportResolve" class="small" type="button">حل البلاغ</button>'+
          '<button id="reportReject" class="small" type="button">رفض البلاغ</button>'+
        '</div>'+
      '</div>'+
      '<div class="stage56-card"><div class="panel-head"><div><span class="eyebrow">سجل المراجعة</span><h3>كل الإجراءات</h3></div></div><div class="stage56-timeline">'+events+'</div></div>';

    await hydrateAdminMedia($("#reportDetail"));
    $("#closeReportDetail").onclick=()=>$("#reportDetail").classList.add("hidden");
    $("#openReporterAccount")?.addEventListener("click",()=>{navigate("users");loadUserDetail(reporter.id)});
    $("#openTargetAccount")?.addEventListener("click",()=>{navigate("users");loadUserDetail(targetUser.id)});
    const note=()=>$("#reportDetailNote").value.trim();
    $("#reportDetailPriority").onchange=()=>runReportAction(reportId,{action:"update",priority:$("#reportDetailPriority").value,admin_note:note()},{success:"تم تحديث أولوية البلاغ."});
    $("#reportAssignMe").onclick=()=>runReportAction(reportId,{action:"update",assigned_to:"me",admin_note:note()},{success:"تم إسناد البلاغ لك."});
    $("#reportUnassign").onclick=()=>runReportAction(reportId,{action:"update",assigned_to:null,admin_note:note()},{success:"تم إلغاء إسناد البلاغ."});
    $("#reportReview").onclick=()=>runReportAction(reportId,{action:"review",status:"review",assigned_to:"me",admin_note:note()},{success:"البلاغ الآن قيد المراجعة."});
    $("#reportToggleHidden")?.addEventListener("click",()=>runReportAction(reportId,{
      action:hidden?"restore_content":"hide_content",
      status:hidden?"review":"resolved",
      admin_note:note()
    },{success:hidden?"تمت استعادة الهدف.":"تم إخفاء الهدف وحل البلاغ."}));
    $("#reportWarnUser")?.addEventListener("click",async()=>{
      const warning=await adminPrompt("تحذير صاحب المحتوى",{label:"نص التحذير",defaultValue:note()||"تم تسجيل مخالفة على محتوى في حسابك.",acceptLabel:"إرسال التحذير"});
      if(!warning?.trim())return;
      await runReportAction(reportId,{action:"warn_user",status:"resolved",admin_note:warning.trim()},{success:"تم تحذير المستخدم وحل البلاغ."});
    });
    $("#reportDetail").querySelectorAll("[data-report-ban-hours]").forEach(btn=>btn.onclick=async()=>{
      const hours=Number(btn.dataset.reportBanHours||0);
      const label=hours===0?"حظر دائم":hours===24?"حظر يوم":"حظر أسبوع";
      if(!await adminConfirm(label+"؟","سيتم إنهاء جلسات المستخدم وتسجيل القرار في سجل البلاغ.",{acceptLabel:"تأكيد الحظر",danger:true}))return;
      await runReportAction(reportId,{action:"ban_user",status:"resolved",duration_hours:hours,admin_note:note()||"إجراء إداري بسبب بلاغ"},{success:"تم حظر المستخدم وحل البلاغ."});
    });
    $("#reportDeleteTarget")?.addEventListener("click",async()=>{
      if(!await adminConfirm("حذف الهدف نهائيًا؟","سيتم حذف المحتوى وتنظيف وسائطه غير المستخدمة من التخزين. هذا الإجراء غير قابل للتراجع.",{acceptLabel:"حذف نهائي",danger:true}))return;
      await runReportAction(reportId,{action:"delete_content",status:"resolved",admin_note:note()},{success:"تم حذف الهدف وحل البلاغ."});
    });
    $("#reportResolve").onclick=()=>runReportAction(reportId,{action:"resolve",status:"resolved",admin_note:note()},{success:"تم حل البلاغ."});
    $("#reportReject").onclick=async()=>{
      const rejectNote=note()||await adminPrompt("سبب رفض البلاغ",{label:"ملاحظة المراجعة",acceptLabel:"رفض البلاغ"});
      if(rejectNote===null)return;
      await runReportAction(reportId,{action:"reject",status:"rejected",admin_note:String(rejectNote||"").trim()},{success:"تم رفض البلاغ."});
    };
  }catch(e){
    $("#reportDetail").classList.remove("hidden");
    $("#reportDetail").innerHTML='<div class="error-text">'+esc(e.message)+'</div>';
  }
}

async function loadReports(){
  try{
    const params=new URLSearchParams({page:String(reportPage),limit:"30"});
    const values={
      q:$("#reportSearch")?.value.trim(),
      status:$("#reportStatus")?.value,
      target_type:$("#reportType")?.value,
      priority:$("#reportPriority")?.value,
      assigned:$("#reportAssigned")?.value,
      from:$("#reportFrom")?.value,
      to:$("#reportTo")?.value
    };
    Object.entries(values).forEach(([k,v])=>{if(v)params.set(k,v)});
    const d=await api("/v1/admin/reports?"+params.toString());
    const p=d.pagination||{};
    reportPages=Math.max(1,Number(p.pages||1));
    if(reportPage>reportPages){reportPage=reportPages;return loadReports()}
    $("#reportsList").innerHTML=(d.items||[]).map(r=>{
      const reporter=r.reporter||{}, target=r.target||{}, targetUser=r.target_user||{};
      const media=(target.media_ids||[])[0];
      return '<div class="report-card stage56-list-card">'+
        (media?'<div class="stage56-thumb"><img data-media-id="'+esc(media)+'" alt=""></div>':"")+
        '<div class="grow">'+
          '<div class="moderation-head"><div><b>'+esc(r.reason||"بلاغ")+'</b><div class="meta">بواسطة @'+esc(reporter.username||"")+' · '+new Date(r.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(r.status)+'">'+statusLabel(r.status)+'</span></div>'+
          '<div class="stage56-chips"><span class="pill '+reportPriorityClass(r.priority)+'">'+esc(priorityLabels[r.priority]||r.priority||"عادية")+'</span><span>'+esc(reportTypeLabels[r.target_type]||r.target_type)+'</span><span>'+Number(r.duplicate_count||0)+' بلاغ على الهدف</span>'+(r.assignee?'<span>مسند: '+esc(r.assignee.name||r.assignee.username||"مشرف")+'</span>':'<span>غير مسند</span>')+'</div>'+
          (r.details?'<p>'+esc(r.details)+'</p>':(target.text?'<p>'+esc(target.text).slice(0,220)+'</p>':""))+
          '<div class="meta">صاحب الهدف: '+(targetUser.username?"@"+esc(targetUser.username):"—")+' · <span class="mono">'+esc(r.target_id)+'</span></div>'+
          '<div class="admin-actions"><button class="small" data-open-report="'+esc(r.id)+'" type="button">فتح المراجعة</button>'+(targetUser.id?'<button class="small" data-report-target-user="'+esc(targetUser.id)+'" type="button">حساب الهدف</button>':"")+'</div>'+
        '</div></div>';
    }).join("")||'<div class="panel">لا توجد بلاغات مطابقة.</div>';
    await hydrateAdminMedia($("#reportsList"));
    $("#reportsList").querySelectorAll("[data-open-report]").forEach(b=>b.onclick=()=>openReportDetail(b.dataset.openReport));
    $("#reportsList").querySelectorAll("[data-report-target-user]").forEach(b=>b.onclick=()=>{navigate("users");loadUserDetail(b.dataset.reportTargetUser)});
    $("#reportsPager").classList.toggle("hidden",Number(p.total||0)<=Number(p.limit||30));
    $("#reportsPageLabel").textContent=reportPage+" / "+reportPages+" · "+Number(p.total||0).toLocaleString("ar-IQ");
    $("#reportsPrevPage").disabled=reportPage<=1;
    $("#reportsNextPage").disabled=reportPage>=reportPages;
  }catch(e){$("#reportsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

const uploadKindLabel={
  profile:"صورة حساب",profile_cover:"غلاف حساب",post_image:"صورة منشور",post_video:"فيديو منشور",
  reel:"ريلز",reel_cover:"غلاف ريلز",story:"قصة",chat_image:"صورة محادثة",chat_video:"فيديو محادثة",
  chat_audio:"صوتية",chat_file:"ملف محادثة",group_media:"وسائط مجموعة",file:"ملف عام",backup:"نسخة احتياطية"
};

async function storageChannelAction(channelKey,action){
  const labels={test:"اختبار القناة",reconnect:"إعادة الاتصال",enable:"تفعيل القناة",disable:"تعطيل القناة"};
  if(action==="disable"&&!await adminConfirm("تعطيل قناة التخزين؟","لن يستقبل هذا المسار ملفات جديدة حتى تعيد تفعيله. معرف القناة لن يتغير.",{acceptLabel:"تعطيل",danger:true}))return;
  try{
    await api("/v1/admin/channels/"+encodeURIComponent(channelKey)+"/action",{
      method:"POST",body:JSON.stringify({action})
    });
    showToast((labels[action]||"الإجراء")+" تم بنجاح.",{type:"success"});
  }catch(error){
    showToast(error.message,{type:"error"});
  }
  await loadStorage();
}

async function loadStorage({quiet=false}={}){
  try{
    const d=await api("/v1/admin/channels");
    const sum=d.summary||{};
    $("#storageSummary").innerHTML=[
      ["القنوات",sum.channels||0],
      ["المفعلة",sum.enabled||0],
      ["المتصلة",sum.connected||0],
      ["تحتاج متابعة",sum.errors||0],
      ["الملفات",sum.files||0],
      ["الحجم الكلي",formatBytes(sum.bytes||0)]
    ].map(([label,value])=>'<div><span>'+label+'</span><b>'+esc(String(value))+'</b></div>').join("");

    $("#channelsList").innerHTML=(d.items||[]).map(row=>{
      const status=row.status==="connected"?"متصلة":row.status==="checking"?"جارٍ الفحص":"تحتاج فحص";
      const statusCls=row.status==="connected"?"ok":row.status==="checking"?"":"bad";
      return '<div class="channel-card stage8-channel-card">'+
        '<div class="stage8-channel-head"><div class="grow"><b>'+esc(row.title||row.channel_key)+'</b><div class="meta mono">'+esc(row.channel_key)+'</div></div>'+
          '<span class="pill '+(row.enabled?"ok":"bad")+'">'+(row.enabled?"مفعلة":"معطلة")+'</span>'+
          '<span class="pill '+statusCls+'">'+status+'</span></div>'+
        '<div class="stage8-channel-stats"><div><span>الملفات</span><b>'+Number(row.files_count||0).toLocaleString("ar-IQ")+'</b></div><div><span>الحجم</span><b>'+formatBytes(row.bytes_total||0)+'</b></div></div>'+
        '<div class="meta">Channel ID: <span class="mono">'+esc(row.channel_id)+'</span></div>'+
        '<div class="meta">آخر اختبار: '+(row.last_test_at?new Date(row.last_test_at).toLocaleString("ar-IQ"):"لم يُختبر")+'</div>'+
        '<div class="meta">آخر رفع: '+(row.last_upload_at?new Date(row.last_upload_at).toLocaleString("ar-IQ"):"لا يوجد")+'</div>'+
        (row.last_error?'<div class="error-text">'+esc(row.last_error)+'</div>':"")+
        '<div class="admin-actions">'+
          '<button class="small" data-channel-action="test" data-channel-key="'+esc(row.channel_key)+'" type="button">اختبار</button>'+
          '<button class="small" data-channel-action="reconnect" data-channel-key="'+esc(row.channel_key)+'" type="button">إعادة اتصال</button>'+
          '<button class="small '+(row.enabled?"danger":"")+'" data-channel-action="'+(row.enabled?"disable":"enable")+'" data-channel-key="'+esc(row.channel_key)+'" type="button">'+(row.enabled?"تعطيل":"تفعيل")+'</button>'+
        '</div>'+
      '</div>';
    }).join("")||'<div class="panel">لم يتم ربط قنوات التخزين بعد.</div>';

    $("#channelsList").querySelectorAll("[data-channel-action]").forEach(btn=>btn.onclick=async()=>{
      btn.disabled=true;
      await storageChannelAction(btn.dataset.channelKey,btn.dataset.channelAction);
    });

    if(currentAdminPage==="storage"&&!storageLiveTimer){
      storageLiveTimer=setInterval(()=>{
        if(document.visibilityState==="visible"&&currentAdminPage==="storage")loadStorage({quiet:true}).catch(()=>{});
      },10000);
    }
  }catch(e){
    if(!quiet)$("#channelsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>';
  }
}
$("#testAllChannels")?.addEventListener("click",async()=>{
  const btn=$("#testAllChannels");
  btn.disabled=true;btn.textContent="جارٍ فحص القنوات...";
  try{
    const result=await api("/v1/admin/channels/test-all",{method:"POST"});
    const items=result.items||[];
    const failed=items.filter(x=>!x.ok).length;
    showToast(failed?("اكتمل الفحص، "+failed+" قناة تحتاج متابعة."):"جميع القنوات تعمل.",{type:failed?"error":"success"});
  }catch(error){showToast(error.message,{type:"error"})}
  finally{btn.disabled=false;btn.textContent="فحص جميع القنوات";await loadStorage()}
});

let uploadPage=1;
let uploadPages=1;
let uploadLoading=false;
let uploadFilterTimer;

function resetUploadPage(){uploadPage=1}
["uploadStatus","uploadKind"].forEach(id=>$("#"+id)?.addEventListener("change",()=>{resetUploadPage();loadUploads()}));
["uploadSearch","uploadUser"].forEach(id=>$("#"+id)?.addEventListener("input",()=>{
  clearTimeout(uploadFilterTimer);
  uploadFilterTimer=setTimeout(()=>{resetUploadPage();loadUploads()},280);
}));
$("#resetUploadFilters")?.addEventListener("click",()=>{
  ["uploadSearch","uploadUser","uploadStatus","uploadKind"].forEach(id=>{const el=$("#"+id);if(el)el.value=""});
  resetUploadPage();loadUploads();
});
$("#uploadsPrevPage")?.addEventListener("click",()=>{if(uploadPage>1){uploadPage--;loadUploads()}});
$("#uploadsNextPage")?.addEventListener("click",()=>{if(uploadPage<uploadPages){uploadPage++;loadUploads()}});

async function loadUploads({quiet=false}={}){
  if(uploadLoading)return;
  uploadLoading=true;
  try{
    const params=new URLSearchParams({page:String(uploadPage),limit:"30"});
    const values={
      q:$("#uploadSearch")?.value.trim(),
      user:$("#uploadUser")?.value.trim(),
      status:$("#uploadStatus")?.value,
      kind:$("#uploadKind")?.value
    };
    Object.entries(values).forEach(([k,v])=>{if(v)params.set(k,v)});
    const d=await api("/v1/admin/uploads?"+params.toString());
    const p=d.pagination||{},sum=d.summary||{};
    uploadPages=Math.max(1,Number(p.pages||1));
    if(uploadPage>uploadPages){uploadPage=uploadPages;uploadLoading=false;return loadUploads({quiet})}

    $("#uploadSummary").innerHTML=[
      ["بالانتظار",sum.queued||0],["جارية الآن",sum.active||0],["فاشلة",sum.failed||0],["النتائج",p.total||0]
    ].map(([label,value])=>'<div><span>'+label+'</span><b>'+Number(value||0).toLocaleString("ar-IQ")+'</b></div>').join("");

    $("#uploadsList").innerHTML=(d.items||[]).map(row=>{
      const total=Number(row.size_bytes||0),received=Number(row.received_bytes||0);
      const pct=total?Math.min(100,Math.round(received/total*100)):(row.status==="completed"?100:0);
      const u=row.user||{};
      const retryExpired=row.status==="failed"&&!row.retry_available;
      return '<div class="upload-admin-card stage8-upload-card">'+
        '<div class="stage8-upload-user">'+
          '<div class="list-avatar">'+(u.avatar_media_id?'<img data-media-id="'+esc(u.avatar_media_id)+'" alt="">':'<span>'+esc((u.name||u.username||"م").slice(0,1))+'</span>')+'</div>'+
          '<div class="grow"><b>'+esc(u.name||u.username||"مستخدم")+'</b><div class="meta">'+(u.username?"@"+esc(u.username):esc(row.user_id||""))+'</div></div>'+
          (u.id?'<button class="small" data-upload-user="'+esc(u.id)+'" type="button">الحساب</button>':"")+
        '</div>'+
        '<div class="moderation-head"><div class="grow"><b>'+esc(row.original_name||"ملف")+'</b><div class="meta">'+esc(uploadKindLabel[row.kind]||row.kind)+' · '+formatBytes(total)+' · المحاولة '+Number(row.attempt_count||1)+'</div></div><span class="pill '+pillClass(row.status)+'">'+statusLabel(row.status)+'</span></div>'+
        '<div class="admin-progress"><i style="width:'+pct+'%"></i></div>'+
        '<div class="stage8-progress-meta"><span>'+pct+'%</span><span>'+formatBytes(received)+' / '+formatBytes(total)+'</span><span>'+new Date(row.updated_at||row.created_at).toLocaleString("ar-IQ")+'</span></div>'+
        (row.failure_stage?'<div class="meta">مرحلة الخطأ: '+esc(row.failure_stage)+'</div>':"")+
        (row.error?'<div class="error-text">'+esc(row.error)+'</div>':"")+
        (retryExpired?'<div class="admin-note">الملف المؤقت غير متوفر؛ إعادة المحاولة تحتاج رفع الملف من التطبيق.</div>':"")+
        '<div class="admin-actions">'+
          (["queued","receiving","storing"].includes(row.status)?'<button class="small danger" data-cancel-upload="'+esc(row.id)+'" type="button">'+(row.cancel_requested?"تم طلب الإلغاء":"إلغاء العملية")+'</button>':"")+
          (row.status==="failed"&&row.retry_available?'<button class="small" data-retry-upload="'+esc(row.id)+'" type="button">إعادة محاولة التخزين</button>':"")+
        '</div>'+
      '</div>';
    }).join("")||'<div class="panel">لا توجد عمليات رفع مطابقة.</div>';

    await hydrateAdminMedia($("#uploadsList"));
    $("#uploadsList").querySelectorAll("[data-upload-user]").forEach(b=>b.onclick=()=>{navigate("users");loadUserDetail(b.dataset.uploadUser)});
    $("#uploadsList").querySelectorAll("[data-cancel-upload]").forEach(b=>b.onclick=async()=>{
      if(!await adminConfirm("إلغاء عملية الرفع؟","سيتم طلب إيقاف الاستلام أو التخزين الجاري.",{acceptLabel:"إلغاء العملية",danger:true}))return;
      b.disabled=true;
      try{
        await api("/v1/admin/uploads/"+b.dataset.cancelUpload+"/cancel",{method:"POST"});
        showToast("تم إرسال طلب الإلغاء.",{type:"success"});
        await loadUploads();
      }catch(error){showToast(error.message,{type:"error"});b.disabled=false}
    });
    $("#uploadsList").querySelectorAll("[data-retry-upload]").forEach(b=>b.onclick=async()=>{
      if(!await adminConfirm("إعادة محاولة التخزين؟","سيتم استخدام النسخة المؤقتة الموجودة على الخادم وإرسالها إلى قناة Telegram من جديد.",{acceptLabel:"إعادة المحاولة"}))return;
      b.disabled=true;b.textContent="جارٍ إعادة المحاولة...";
      try{
        await api("/v1/admin/uploads/"+b.dataset.retryUpload+"/retry",{method:"POST"});
        showToast("اكتملت إعادة محاولة التخزين.",{type:"success"});
        await loadUploads();
      }catch(error){showToast(error.message,{type:"error"});b.disabled=false;b.textContent="إعادة محاولة التخزين"}
    });

    $("#uploadsPager").classList.toggle("hidden",Number(p.total||0)<=Number(p.limit||30));
    $("#uploadsPageLabel").textContent=uploadPage+" / "+uploadPages+" · "+Number(p.total||0).toLocaleString("ar-IQ");
    $("#uploadsPrevPage").disabled=uploadPage<=1;
    $("#uploadsNextPage").disabled=uploadPage>=uploadPages;

    if(currentAdminPage==="uploads"&&!uploadsLiveTimer){
      uploadsLiveTimer=setInterval(()=>{
        if(document.visibilityState==="visible"&&currentAdminPage==="uploads")loadUploads({quiet:true}).catch(()=>{});
      },2500);
    }
  }catch(e){
    if(!quiet)$("#uploadsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>';
  }finally{uploadLoading=false}
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

const supportCategoryLabels={technical:"تقنية",account:"الحساب",content:"المحتوى",upload:"الرفع",other:"أخرى",general:"عام"};
const supportEventLabels={ticket_created:"إنشاء التذكرة",user_reply:"رد المستخدم",admin_reply:"رد الإدارة",admin_update:"تحديث الإدارة"};
let supportPage=1;
let supportPages=1;
let supportTimer;

$("#supportSearch").oninput=()=>{
  clearTimeout(supportTimer);
  supportTimer=setTimeout(()=>{supportPage=1;loadSupport()},280);
};
["supportStatus","supportPriority","supportCategory","supportAssigned","supportUnread"].forEach(id=>{
  $("#"+id)?.addEventListener("change",()=>{supportPage=1;loadSupport()});
});
$("#resetSupportFilters")?.addEventListener("click",()=>{
  ["supportSearch","supportStatus","supportPriority","supportCategory","supportAssigned","supportUnread"].forEach(id=>{
    const el=$("#"+id);if(el)el.value="";
  });
  supportPage=1;loadSupport();
});
$("#supportPrevPage")?.addEventListener("click",()=>{if(supportPage>1){supportPage--;loadSupport()}});
$("#supportNextPage")?.addEventListener("click",()=>{if(supportPage<supportPages){supportPage++;loadSupport()}});

async function updateSupportTicket(ticketId,payload,{success="تم تحديث التذكرة."}={}){
  await api("/v1/admin/support/"+ticketId+"/reply",{method:"POST",body:JSON.stringify(payload)});
  showToast(success,{type:"success"});
  await loadSupport();
  if(!$("#supportDetail").classList.contains("hidden"))await openSupportDetail(ticketId);
}

async function openSupportDetail(ticketId){
  try{
    const d=await api("/v1/admin/support/"+encodeURIComponent(ticketId));
    const t=d.ticket||{}, user=d.user||{}, assignee=d.assignee||{};
    const messages=(d.messages||[]).map(m=>
      '<div class="support-thread-message '+(m.sender_kind==="admin"?"from-admin":"from-user")+'">'+
        '<div class="support-thread-meta"><b>'+(m.sender_kind==="admin"?"الإدارة":"المستخدم")+'</b><span>'+new Date(m.created_at).toLocaleString("ar-IQ")+'</span></div>'+
        '<p>'+esc(m.body||"")+'</p></div>'
    ).join("")||'<div class="meta">لا توجد رسائل.</div>';
    const events=(d.events||[]).map(ev=>
      '<div class="stage56-event"><i></i><div><b>'+esc(supportEventLabels[ev.event_type]||ev.event_type||"تحديث")+'</b>'+
        (ev.note?'<p>'+esc(ev.note)+'</p>':"")+'<span>'+new Date(ev.created_at).toLocaleString("ar-IQ")+'</span></div></div>'
    ).join("")||'<div class="meta">لا يوجد سجل إضافي.</div>';

    $("#supportDetail").classList.remove("hidden");
    $("#supportDetail").innerHTML=
      '<div class="panel-head"><div><span class="eyebrow">تذكرة الدعم</span><h3>'+esc(t.subject||"طلب دعم")+'</h3></div><button id="closeSupportDetail" class="small" type="button">إغلاق</button></div>'+
      '<div class="stage56-summary">'+
        '<div><span>الحالة</span><b>'+statusLabel(t.status)+'</b></div>'+
        '<div><span>الأولوية</span><b>'+esc(priorityLabels[t.priority]||t.priority||"عادية")+'</b></div>'+
        '<div><span>النوع</span><b>'+esc(supportCategoryLabels[t.category]||t.category||"عام")+'</b></div>'+
        '<div><span>المسند إلى</span><b>'+(assignee.id?esc(assignee.name||assignee.username||"مشرف"):"غير مسند")+'</b></div>'+
      '</div>'+
      '<div class="stage56-two-col">'+
        '<div class="stage56-card"><span class="eyebrow">المستخدم</span><div class="stage56-person">'+
          (user.avatar_media_id?'<div class="list-avatar"><img data-media-id="'+esc(user.avatar_media_id)+'" alt=""></div>':'<div class="list-avatar"><span>'+esc((user.name||user.username||"م").slice(0,1))+'</span></div>')+
          '<div class="grow"><b>'+esc(user.name||"مستخدم")+'</b><div class="meta">@'+esc(user.username||"")+'</div><div class="meta">آخر نشاط: '+(user.last_seen_at?new Date(user.last_seen_at).toLocaleString("ar-IQ"):"—")+'</div></div>'+
          '<button id="supportOpenUser" class="small" type="button">الحساب</button></div></div>'+
        '<div class="stage56-card"><span class="eyebrow">معلومات الجهاز</span><div class="meta">إصدار التطبيق: '+esc(t.app_version||"—")+'</div><p class="device-info">'+esc(t.device_info||"غير متوفر")+'</p></div>'+
      '</div>'+
      '<div class="stage56-card support-thread-card"><div class="panel-head"><div><span class="eyebrow">المحادثة</span><h3>سجل الرسائل</h3></div></div><div id="supportThread" class="support-thread">'+messages+'</div></div>'+
      '<div class="stage56-card"><span class="eyebrow">إدارة التذكرة</span>'+
        '<div class="stage56-control-grid">'+
          '<label><span>الحالة</span><select id="supportDetailStatus">'+
            ["open","in_progress","answered","closed"].map(x=>'<option value="'+x+'" '+(t.status===x?"selected":"")+'>'+statusLabel(x)+'</option>').join("")+
          '</select></label>'+
          '<label><span>الأولوية</span><select id="supportDetailPriority">'+
            ["urgent","high","normal","low"].map(x=>'<option value="'+x+'" '+(t.priority===x?"selected":"")+'>'+priorityLabels[x]+'</option>').join("")+
          '</select></label>'+
        '</div>'+
        '<label><span>ملاحظة الحل</span><textarea id="supportResolutionNote" maxlength="1500" placeholder="ملاحظة داخلية عن الحل">'+esc(t.resolution_note||"")+'</textarea></label>'+
        '<div class="admin-actions"><button id="supportAssignMe" class="small" type="button">إسناد لي</button><button id="supportUnassign" class="small" type="button">إلغاء الإسناد</button><button id="supportSaveMeta" class="small" type="button">حفظ الحالة</button></div>'+
        '<label><span>الرد على المستخدم</span><textarea id="supportReplyBody" maxlength="4000" placeholder="اكتب رد الدعم هنا"></textarea></label>'+
        '<button id="supportSendReply" class="primary" type="button">إرسال الرد</button>'+
      '</div>'+
      '<div class="stage56-card"><div class="panel-head"><div><span class="eyebrow">سجل المعالجة</span><h3>الإجراءات</h3></div></div><div class="stage56-timeline">'+events+'</div></div>';

    await hydrateAdminMedia($("#supportDetail"));
    const thread=$("#supportThread");if(thread)thread.scrollTop=thread.scrollHeight;
    $("#closeSupportDetail").onclick=()=>$("#supportDetail").classList.add("hidden");
    $("#supportOpenUser").onclick=()=>{navigate("users");loadUserDetail(user.id)};
    const meta=()=>({
      status:$("#supportDetailStatus").value,
      priority:$("#supportDetailPriority").value,
      resolution_note:$("#supportResolutionNote").value.trim()
    });
    $("#supportAssignMe").onclick=()=>updateSupportTicket(ticketId,{...meta(),assigned_to:"me"},{success:"تم إسناد التذكرة لك."});
    $("#supportUnassign").onclick=()=>updateSupportTicket(ticketId,{...meta(),assigned_to:null},{success:"تم إلغاء إسناد التذكرة."});
    $("#supportSaveMeta").onclick=()=>updateSupportTicket(ticketId,meta(),{success:"تم حفظ حالة التذكرة."});
    $("#supportSendReply").onclick=async()=>{
      const reply=$("#supportReplyBody").value.trim();
      if(!reply){showToast("اكتب الرد أولًا.",{type:"error"});return}
      $("#supportSendReply").disabled=true;
      try{
        await updateSupportTicket(ticketId,{...meta(),reply,status:$("#supportDetailStatus").value==="closed"?"closed":"answered",assigned_to:"me"},{success:"تم إرسال رد الدعم للمستخدم."});
      }finally{
        const btn=$("#supportSendReply");if(btn)btn.disabled=false;
      }
    };
  }catch(e){
    $("#supportDetail").classList.remove("hidden");
    $("#supportDetail").innerHTML='<div class="error-text">'+esc(e.message)+'</div>';
  }
}

async function loadSupport(){
  try{
    const params=new URLSearchParams({page:String(supportPage),limit:"30"});
    const values={
      q:$("#supportSearch")?.value.trim(),
      status:$("#supportStatus")?.value,
      priority:$("#supportPriority")?.value,
      category:$("#supportCategory")?.value,
      assigned:$("#supportAssigned")?.value,
      unread:$("#supportUnread")?.value
    };
    Object.entries(values).forEach(([k,v])=>{if(v)params.set(k,v)});
    const d=await api("/v1/admin/support?"+params.toString());
    const p=d.pagination||{};
    supportPages=Math.max(1,Number(p.pages||1));
    if(supportPage>supportPages){supportPage=supportPages;return loadSupport()}
    $("#supportList").innerHTML=(d.items||[]).map(t=>{
      const u=t.user||{}, a=t.assignee||{};
      return '<div class="report-card stage56-list-card '+(t.unread_by_admin?"needs-attention":"")+'">'+
        '<div class="list-avatar">'+(u.avatar_media_id?'<img data-media-id="'+esc(u.avatar_media_id)+'" alt="">':'<span>'+esc((u.name||u.username||"م").slice(0,1))+'</span>')+'</div>'+
        '<div class="grow">'+
          '<div class="moderation-head"><div><b>'+esc(t.subject||"تذكرة دعم")+(t.unread_by_admin?' <span class="unread-dot"></span>':"")+'</b><div class="meta">@'+esc(u.username||"")+' · '+new Date(t.last_message_at||t.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(t.status)+'">'+statusLabel(t.status)+'</span></div>'+
          '<div class="stage56-chips"><span class="pill '+reportPriorityClass(t.priority)+'">'+esc(priorityLabels[t.priority]||t.priority||"عادية")+'</span><span>'+esc(supportCategoryLabels[t.category]||t.category||"عام")+'</span>'+(a.id?'<span>مسند: '+esc(a.name||a.username||"مشرف")+'</span>':'<span>غير مسند</span>')+'</div>'+
          '<p>'+esc(t.body||"")+'</p>'+
          '<div class="meta">الإصدار: '+esc(t.app_version||"—")+' · <span class="mono">'+esc(t.id)+'</span></div>'+
          '<div class="admin-actions"><button class="small" data-open-ticket="'+esc(t.id)+'" type="button">فتح التذكرة</button><button class="small" data-support-user="'+esc(t.user_id)+'" type="button">الحساب</button></div>'+
        '</div></div>';
    }).join("")||'<div class="panel">لا توجد تذاكر دعم مطابقة.</div>';
    await hydrateAdminMedia($("#supportList"));
    $("#supportList").querySelectorAll("[data-open-ticket]").forEach(b=>b.onclick=()=>openSupportDetail(b.dataset.openTicket));
    $("#supportList").querySelectorAll("[data-support-user]").forEach(b=>b.onclick=()=>{navigate("users");loadUserDetail(b.dataset.supportUser)});
    $("#supportPager").classList.toggle("hidden",Number(p.total||0)<=Number(p.limit||30));
    $("#supportPageLabel").textContent=supportPage+" / "+supportPages+" · "+Number(p.total||0).toLocaleString("ar-IQ");
    $("#supportPrevPage").disabled=supportPage<=1;
    $("#supportNextPage").disabled=supportPage>=supportPages;
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

let adminCandidateTimer;
let selectedAdminCandidate=null;
let adminsById=new Map();

function editablePermissionKeys(){
  return ["users","content","reports","support","storage","notifications","settings"];
}
function roleDefaultAllows(role,key){
  return (adminRoleDefaults?.[role]||[]).includes(key);
}
function permissionSelectMarkup(key,explicit,role){
  const value=explicit?.[key]===true?"allow":explicit?.[key]===false?"deny":"inherit";
  return '<label class="stage7-permission-row"><span><b>'+esc(permissionLabel[key]||key)+'</b><small>افتراضي الدور: '+(roleDefaultAllows(role,key)?"مسموح":"غير مسموح")+'</small></span>'+
    '<select data-admin-permission="'+esc(key)+'"><option value="inherit" '+(value==="inherit"?"selected":"")+'>حسب الدور</option><option value="allow" '+(value==="allow"?"selected":"")+'>سماح</option><option value="deny" '+(value==="deny"?"selected":"")+'>منع</option></select></label>';
}
function collectPermissionOverrides(root){
  const result={};
  root.querySelectorAll("[data-admin-permission]").forEach(sel=>{
    if(sel.value==="allow")result[sel.dataset.adminPermission]=true;
    if(sel.value==="deny")result[sel.dataset.adminPermission]=false;
  });
  return result;
}
function renderNewAdminPermissions(){
  const root=$("#newAdminPermissions");
  if(!root)return;
  const role=$("#newAdminRole").value;
  if(role==="secondary_admin"){
    root.innerHTML='<div class="info-banner compact"><span></span><p>المدير الثانوي يحصل على كامل صلاحيات الإدارة تلقائيًا.</p></div>';
    return;
  }
  root.innerHTML='<div class="stage7-permission-title"><b>تخصيص الصلاحيات</b><span>اتركها «حسب الدور» لاستخدام الصلاحيات الافتراضية.</span></div>'+
    editablePermissionKeys().map(key=>permissionSelectMarkup(key,{},role)).join("");
}
$("#newAdminRole")?.addEventListener("change",renderNewAdminPermissions);

$("#addAdminButton")?.addEventListener("click",()=>{
  selectedAdminCandidate=null;
  $("#adminAddPanel").classList.remove("hidden");
  $("#adminPermissionPanel").classList.add("hidden");
  $("#adminCandidateSearch").value="";
  $("#adminCandidateResults").innerHTML='<div class="meta">اكتب حرفين على الأقل للبحث.</div>';
  $("#newAdminSelected").classList.add("hidden");
  $("#confirmAddAdmin").classList.add("hidden");
  $("#addAdminMessage").textContent="";
  renderNewAdminPermissions();
  $("#adminCandidateSearch").focus();
});
$("#closeAdminAddPanel")?.addEventListener("click",()=>$("#adminAddPanel").classList.add("hidden"));

$("#adminCandidateSearch")?.addEventListener("input",()=>{
  clearTimeout(adminCandidateTimer);
  const q=$("#adminCandidateSearch").value.trim();
  if(q.length<2){
    $("#adminCandidateResults").innerHTML='<div class="meta">اكتب حرفين على الأقل للبحث.</div>';
    return;
  }
  adminCandidateTimer=setTimeout(async()=>{
    $("#adminCandidateResults").innerHTML='<div class="meta">جارٍ البحث...</div>';
    try{
      const d=await api("/v1/admin/admin-candidates?q="+encodeURIComponent(q));
      $("#adminCandidateResults").innerHTML=(d.items||[]).map(p=>
        '<button class="stage7-candidate" data-admin-candidate="'+esc(p.id)+'" type="button">'+
          '<div class="list-avatar">'+(p.avatar_media_id?'<img data-media-id="'+esc(p.avatar_media_id)+'" alt="">':'<span>'+esc((p.name||p.username||"م").slice(0,1))+'</span>')+'</div>'+
          '<div class="grow"><b>'+esc(p.name||p.username||"مستخدم")+'</b><div class="meta">@'+esc(p.username||"")+'</div></div>'+
          (p.is_verified?'<span class="pill ok">موثق</span>':"")+
        '</button>'
      ).join("")||'<div class="meta">لم يتم العثور على حساب متاح للإضافة.</div>';
      await hydrateAdminMedia($("#adminCandidateResults"));
      const map=new Map((d.items||[]).map(x=>[String(x.id),x]));
      $("#adminCandidateResults").querySelectorAll("[data-admin-candidate]").forEach(btn=>btn.onclick=()=>{
        selectedAdminCandidate=map.get(btn.dataset.adminCandidate)||null;
        if(!selectedAdminCandidate)return;
        $("#newAdminSelected").classList.remove("hidden");
        $("#newAdminSelected").innerHTML='<span>الحساب المحدد</span><b>'+esc(selectedAdminCandidate.name||selectedAdminCandidate.username||"مستخدم")+'</b><small>@'+esc(selectedAdminCandidate.username||"")+'</small>';
        $("#confirmAddAdmin").classList.remove("hidden");
      });
    }catch(error){$("#adminCandidateResults").innerHTML='<div class="error-text">'+esc(error.message)+'</div>'}
  },280);
});

$("#confirmAddAdmin")?.addEventListener("click",async()=>{
  if(!selectedAdminCandidate){showToast("اختر الحساب أولًا.",{type:"error"});return}
  const role=$("#newAdminRole").value;
  const permissions=role==="secondary_admin"?{}:collectPermissionOverrides($("#newAdminPermissions"));
  $("#confirmAddAdmin").disabled=true;
  $("#addAdminMessage").textContent="جارٍ إضافة المشرف...";
  try{
    await api("/v1/admin/admins",{method:"POST",body:JSON.stringify({
      user_id:selectedAdminCandidate.id,role,permissions
    })});
    showToast("تمت إضافة المشرف.",{type:"success"});
    $("#adminAddPanel").classList.add("hidden");
    selectedAdminCandidate=null;
    await loadAdmins();
  }catch(error){$("#addAdminMessage").textContent=error.message}
  finally{$("#confirmAddAdmin").disabled=false}
});

function openAdminPermissionEditor(admin){
  const p=admin.profiles||{};
  const root=$("#adminPermissionPanel");
  $("#adminAddPanel").classList.add("hidden");
  root.classList.remove("hidden");
  const full=admin.role==="owner"||admin.role==="secondary_admin";
  const effective=admin.effective_permissions||{};
  root.innerHTML=
    '<div class="panel-head"><div><span class="eyebrow">صلاحيات المشرف</span><h3>'+esc(p.name||p.username||admin.user_id)+'</h3><div class="meta">@'+esc(p.username||"")+' · '+esc(roleLabel[admin.role]||admin.role)+'</div></div><button id="closeAdminPermissionPanel" class="small" type="button">إغلاق</button></div>'+
    (full
      ?'<div class="info-banner"><span></span><p>هذا الدور يملك كامل الصلاحيات تلقائيًا ولا يحتاج تخصيصًا.</p></div>'
      :'<div class="stage7-effective-permissions">'+Object.entries(effective).filter(([,v])=>v).map(([k])=>'<span>'+esc(permissionLabel[k]||k)+'</span>').join("")+'</div>'+
       '<div id="adminPermissionControls" class="stage7-permissions">'+editablePermissionKeys().map(key=>permissionSelectMarkup(key,admin.permissions||{},admin.role)).join("")+'</div>'+
       '<div class="admin-actions"><button id="saveAdminPermissions" class="primary" type="button">حفظ الصلاحيات</button><button id="resetAdminPermissions" class="small" type="button">العودة لافتراضي الدور</button></div>');

  $("#closeAdminPermissionPanel").onclick=()=>root.classList.add("hidden");
  $("#saveAdminPermissions")?.addEventListener("click",async()=>{
    const permissions=collectPermissionOverrides($("#adminPermissionControls"));
    $("#saveAdminPermissions").disabled=true;
    try{
      await api("/v1/admin/admins/"+admin.user_id,{method:"PATCH",body:JSON.stringify({permissions})});
      showToast("تم حفظ صلاحيات المشرف.",{type:"success"});
      root.classList.add("hidden");
      await loadAdmins();
    }catch(error){showToast(error.message,{type:"error"});$("#saveAdminPermissions").disabled=false}
  });
  $("#resetAdminPermissions")?.addEventListener("click",async()=>{
    if(!await adminConfirm("إعادة الصلاحيات لافتراضي الدور؟","سيتم حذف كل السماحات والمنع المخصص لهذا المشرف.",{acceptLabel:"إعادة الافتراضي"}))return;
    try{
      await api("/v1/admin/admins/"+admin.user_id,{method:"PATCH",body:JSON.stringify({permissions:{}})});
      showToast("تمت إعادة صلاحيات الدور الافتراضية.",{type:"success"});
      root.classList.add("hidden");
      await loadAdmins();
    }catch(error){showToast(error.message,{type:"error"})}
  });
}

async function loadAdmins(){
  try{
    const d=await api("/v1/admin/admins");
    adminRoleDefaults=d.role_defaults||{};
    adminsById=new Map((d.items||[]).map(x=>[String(x.user_id),x]));
    $("#adminsList").innerHTML=(d.items||[]).map(a=>{
      const p=a.profiles||{};
      const isOwner=a.role==="owner";
      const full=isOwner||a.role==="secondary_admin";
      const allowedCount=Object.values(a.effective_permissions||{}).filter(Boolean).length;
      return '<div class="admin-card stage7-admin-card">'+
        '<div class="list-avatar">'+(p.avatar_media_id?'<img data-media-id="'+esc(p.avatar_media_id)+'" alt="">':'<span>'+esc((p.name||p.username||"م").slice(0,1))+'</span>')+'</div>'+
        '<div class="grow"><div class="moderation-head"><div><b>'+esc(p.name||p.username||a.user_id)+'</b><div class="meta">@'+esc(p.username||"")+'</div></div><span class="pill '+(a.active?"ok":"bad")+'">'+(a.active?"نشط":"متوقف")+'</span></div>'+
          '<div class="stage7-admin-meta"><span>'+esc(roleLabel[a.role]||a.role)+'</span><span>'+(full?"كامل الصلاحيات":allowedCount+" صلاحيات فعالة")+'</span><span>آخر نشاط: '+(a.last_active_at?new Date(a.last_active_at).toLocaleString("ar-IQ"):"غير متوفر")+'</span></div></div>'+
        (isOwner?'<span class="pill ok">المالك</span>':
          '<div class="stage7-admin-controls">'+
            '<select class="admin-role-select" data-admin-role="'+esc(a.user_id)+'" data-current="'+esc(a.role)+'">'+
              ["secondary_admin","moderator","content_moderator","support","analyst"].map(role=>'<option value="'+role+'" '+(a.role===role?"selected":"")+'>'+esc(roleLabel[role]||role)+'</option>').join("")+
            '</select>'+
            '<button class="small" data-admin-perms="'+esc(a.user_id)+'" type="button">الصلاحيات</button>'+
            '<button class="small '+(a.active?"danger":"")+'" data-admin-active="'+esc(a.user_id)+'" data-active="'+String(a.active)+'" type="button">'+(a.active?"تعطيل":"تفعيل")+'</button>'+
            '<button class="small danger" data-admin-remove="'+esc(a.user_id)+'" type="button">حذف</button>'+
          '</div>'
        )+
      '</div>';
    }).join("")||'<div class="panel">لا يوجد مشرفون إضافيون.</div>';

    await hydrateAdminMedia($("#adminsList"));
    $("#adminsList").querySelectorAll("[data-admin-perms]").forEach(btn=>btn.onclick=()=>{
      const admin=adminsById.get(btn.dataset.adminPerms);if(admin)openAdminPermissionEditor(admin);
    });
    $("#adminsList").querySelectorAll("[data-admin-role]").forEach(sel=>sel.onchange=async()=>{
      const old=sel.dataset.current||"";
      if(!await adminConfirm("تغيير دور المشرف؟","سيتم تطبيق صلاحيات الدور الجديد فورًا.",{acceptLabel:"تغيير الدور"})){sel.value=old;return}
      sel.disabled=true;
      try{
        await api("/v1/admin/admins/"+sel.dataset.adminRole,{method:"PATCH",body:JSON.stringify({role:sel.value})});
        showToast("تم تغيير دور المشرف.",{type:"success"});
        await loadAdmins();
      }catch(error){showToast(error.message,{type:"error"});sel.value=old;sel.disabled=false}
    });
    $("#adminsList").querySelectorAll("[data-admin-active]").forEach(btn=>btn.onclick=async()=>{
      const active=btn.dataset.active==="true";
      if(active&&!await adminConfirm("تعطيل المشرف؟","سيفقد هذا الحساب صلاحية الدخول إلى لوحة الإدارة.",{acceptLabel:"تعطيل",danger:true}))return;
      btn.disabled=true;
      try{
        await api("/v1/admin/admins/"+btn.dataset.adminActive,{method:"PATCH",body:JSON.stringify({active:!active})});
        showToast(active?"تم تعطيل المشرف.":"تم تفعيل المشرف.",{type:"success"});
        await loadAdmins();
      }catch(error){showToast(error.message,{type:"error"});btn.disabled=false}
    });
    $("#adminsList").querySelectorAll("[data-admin-remove]").forEach(btn=>btn.onclick=async()=>{
      if(!await adminConfirm("حذف المشرف؟","سيتم إزالة صلاحية الإدارة بالكامل من هذا الحساب. حساب المستخدم نفسه لن يُحذف.",{acceptLabel:"حذف المشرف",danger:true}))return;
      btn.disabled=true;
      try{
        await api("/v1/admin/admins/"+btn.dataset.adminRemove,{method:"DELETE"});
        showToast("تم حذف المشرف من الإدارة.",{type:"success"});
        await loadAdmins();
      }catch(error){showToast(error.message,{type:"error"});btn.disabled=false}
    });
  }catch(e){$("#adminsList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

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