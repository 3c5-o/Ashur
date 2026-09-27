(()=>{
const cfg=window.ASHUR_ADMIN_CONFIG;
const sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const nativeApiBase=()=>{try{return window.AshurNative?.getApiBaseUrl?.()||""}catch{return ""}};
const apiBase=()=> (cfg.apiBaseUrl||nativeApiBase()||location.origin).replace(/\/$/,"");
const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

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
  const r=await fetch(apiBase()+path,{...opt,headers:h});
  const b=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(b.error||"تعذر تنفيذ الطلب");
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
      node.dataset.mediaReady="1";
      if(access.mime_type?.startsWith("video/")){
        const v=document.createElement("video");
        v.className=node.className;
        v.src=access.url;
        v.controls=true;
        v.playsInline=true;
        v.preload="metadata";
        node.replaceWith(v);
      }else{
        node.src=access.url;
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

function showApp(ok){
  $("#loginView").classList.toggle("hidden",ok);
  $("#adminApp").classList.toggle("hidden",!ok)
}
async function verify(){
  try{
    await api("/v1/admin/me");
    showApp(true);
    await loadDashboard()
  }catch(e){
    showApp(false);
    if((await sb.auth.getSession()).data.session)$("#loginMessage").textContent="هذا الحساب لا يملك صلاحية الإدارة."
  }
}

$("#loginForm").onsubmit=async e=>{
  e.preventDefault();
  $("#loginMessage").textContent="جارٍ الدخول...";
  const {error}=await sb.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
  if(error){$("#loginMessage").textContent=error.message;return}
  verify()
};
$("#logoutButton").onclick=async()=>{await sb.auth.signOut();showApp(false)};
$("#menuButton").onclick=()=>$("#sidebar").classList.toggle("open");
$("#moreAdminButton")?.addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
$("#refreshButton").onclick=()=>navigate(document.querySelector(".page.active")?.id||"dashboard");
document.addEventListener("click",e=>{
  if(window.innerWidth>920)return;
  const side=$("#sidebar");
  if(!side.classList.contains("open"))return;
  if(side.contains(e.target)||$("#menuButton").contains(e.target)||$("#moreAdminButton")?.contains(e.target))return;
  side.classList.remove("open");
});
[...$$(".nav"),...$$(".mobile-nav")].filter(x=>x.dataset.page).forEach(b=>b.onclick=()=>navigate(b.dataset.page));

function navigate(page){
  $$(".page").forEach(x=>x.classList.toggle("active",x.id===page));
  $$("[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
  $("#headerSectionName").textContent=titles[page]||"إدارة آشور";
  $("#sidebar").classList.remove("open");
  $("#moreAdminButton")?.classList.remove("active");
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
  if(loader)loader()
}

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
$("#userSearch").oninput=()=>{clearTimeout(userTimer);userTimer=setTimeout(loadUsers,260)};

async function loadUserDetail(id){
  try{
    const d=await api("/v1/admin/users/"+encodeURIComponent(id));
    const u=d.profile||{};
    const s=d.stats||{};
    $("#userDetail").classList.remove("hidden");
    $("#userDetail").innerHTML=
      '<div class="panel-head"><div><span class="eyebrow">تفاصيل الحساب</span><h3>'+esc(u.name||u.username||"مستخدم")+'</h3></div><button id="closeUserDetail" class="small" type="button">إغلاق</button></div>'+
      '<div class="user-detail-grid">'+
        '<div><span>اسم المستخدم</span><b>@'+esc(u.username||"")+'</b></div>'+
        '<div><span>المعرف</span><b>'+esc(u.id||"")+'</b></div>'+
        '<div><span>الحالة</span><b>'+((u.is_banned||u.banned_until)?"محظور":"نشط")+'</b></div>'+
        '<div><span>التوثيق</span><b>'+(u.is_verified?"موثق":"غير موثق")+'</b></div>'+
        '<div><span>المنشورات</span><b>'+Number(s.posts||0)+'</b></div>'+
        '<div><span>الريلز</span><b>'+Number(s.reels||0)+'</b></div>'+
        '<div><span>المتابعون</span><b>'+Number(s.followers||0)+'</b></div>'+
        '<div><span>يتابع</span><b>'+Number(s.following||0)+'</b></div>'+
        '<div><span>البلاغات</span><b>'+Number(s.reports||0)+'</b></div>'+
        '<div><span>التحذيرات</span><b>'+Number(u.warning_count||0)+'</b></div>'+
      '</div>'+
      (u.ban_reason?'<div class="info-banner"><span></span><p>سبب الحظر: '+esc(u.ban_reason)+'</p></div>':"")+
      '<div class="admin-actions">'+
        '<button id="toggleVerifyUser" class="small" type="button">'+(u.is_verified?"إلغاء التوثيق":"توثيق الحساب")+'</button>'+
        '<button id="warnUserButton" class="small" type="button">إرسال تحذير</button>'+
        '<button id="banUserDetailButton" class="small '+((u.is_banned||u.banned_until)?"":"danger")+'" type="button">'+((u.is_banned||u.banned_until)?"رفع الحظر":"حظر الحساب")+'</button>'+
        '<button id="viewUserContentButton" class="small" type="button">عرض محتوى الحساب</button>'+
      '</div>';
    $("#closeUserDetail").onclick=()=>$("#userDetail").classList.add("hidden");
    $("#toggleVerifyUser").onclick=async()=>{
      await api("/v1/admin/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:u.is_verified?"unverify":"verify"})});
      await loadUserDetail(id); await loadUsers();
    };
    $("#warnUserButton").onclick=async()=>{
      const reason=prompt("اكتب نص التحذير");
      if(!reason)return;
      await api("/v1/admin/users/"+id+"/action",{method:"POST",body:JSON.stringify({action:"warn",reason})});
      await loadUserDetail(id);
    };
    $("#banUserDetailButton").onclick=async()=>{
      if(u.is_banned||u.banned_until){
        await api("/v1/admin/users/"+id+"/ban",{method:"POST",body:JSON.stringify({banned:false})});
      }else{
        const reason=prompt("سبب الحظر")||"";
        const choice=prompt("مدة الحظر بالساعات. اتركها 0 للحظر الدائم","24");
        if(choice===null)return;
        await api("/v1/admin/users/"+id+"/ban",{method:"POST",body:JSON.stringify({banned:true,reason,duration_hours:Number(choice||0)})});
      }
      await loadUserDetail(id); await loadUsers();
    };
    $("#viewUserContentButton").onclick=()=>{
      navigate("content");
      $("#contentSearch").value="";
      loadContent("posts",id);
    };
  }catch(e){
    $("#userDetail").classList.remove("hidden");
    $("#userDetail").innerHTML='<div class="panel">'+esc(e.message)+'</div>';
  }
}

async function loadUsers(){
  try{
    const q=$("#userSearch").value.trim();
    const d=await api("/v1/admin/users?q="+encodeURIComponent(q));
    $("#usersList").innerHTML=(d.items||[]).map(u=>{
      const banned=u.is_banned||(u.banned_until&&new Date(u.banned_until)>new Date());
      return '<div class="row-card">'+
        '<button class="row-main-button grow" data-user-detail="'+esc(u.id)+'" type="button"><b>'+esc(u.name||"مستخدم")+(u.is_verified?' <span class="verified-admin">✓</span>':"")+'</b><div class="meta">@'+esc(u.username||"")+' · '+esc(u.id)+' · '+(u.is_private?"خاص":"عام")+'</div></button>'+
        '<span class="pill '+(banned?"bad":"ok")+'">'+(banned?"محظور":"نشط")+'</span>'+
        '<button class="small" data-ban="'+esc(u.id)+'" data-state="'+String(banned)+'">'+(banned?"رفع الحظر":"حظر")+'</button>'+
      '</div>';
    }).join("")||'<div class="panel">لا توجد نتائج.</div>';
    $("#usersList").querySelectorAll("[data-user-detail]").forEach(b=>b.onclick=()=>loadUserDetail(b.dataset.userDetail));
    $("#usersList").querySelectorAll("[data-ban]").forEach(b=>b.onclick=async()=>{
      if(b.dataset.state==="true"){
        await api("/v1/admin/users/"+b.dataset.ban+"/ban",{method:"POST",body:JSON.stringify({banned:false})});
      }else{
        const reason=prompt("سبب الحظر")||"";
        const hours=prompt("مدة الحظر بالساعات، 0 = دائم","24");
        if(hours===null)return;
        await api("/v1/admin/users/"+b.dataset.ban+"/ban",{method:"POST",body:JSON.stringify({banned:true,reason,duration_hours:Number(hours||0)})});
      }
      loadUsers();
    });
  }catch(e){$("#usersList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

let currentContentKind="posts";
let contentTimer;
$$("[data-content-kind]").forEach(b=>b.onclick=()=>{
  $$("[data-content-kind]").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  currentContentKind=b.dataset.contentKind;
  loadContent(currentContentKind);
});
$("#contentSearch").oninput=()=>{clearTimeout(contentTimer);contentTimer=setTimeout(()=>loadContent(currentContentKind),250)};
$("#contentStatus").onchange=()=>loadContent(currentContentKind);

async function loadContent(kind=currentContentKind,authorId=""){
  currentContentKind=kind;
  try{
    const params=new URLSearchParams({kind});
    const q=$("#contentSearch")?.value.trim();
    const status=$("#contentStatus")?.value;
    if(q)params.set("q",q);
    if(status)params.set("status",status);
    if(authorId)params.set("author_id",authorId);
    const d=await api("/v1/admin/content?"+params.toString());
    const kindLabel={posts:"منشور",reels:"ريلز",stories:"قصة"}[kind]||"محتوى";
    $("#contentList").innerHTML=(d.items||[]).map(x=>{
      const author=x.author||{};
      const media=(x.media_ids||[])[0];
      const status=x.moderation_status||"active";
      return '<div class="moderation-card">'+
        (media?'<img class="moderation-media" data-media-id="'+esc(media)+'" alt="">':'<div class="moderation-media placeholder">بدون معاينة</div>')+
        '<div class="moderation-body grow">'+
          '<div class="moderation-head"><div><b>'+esc(x.caption||kindLabel)+'</b><div class="meta">@'+esc(author.username||"")+' · '+new Date(x.created_at).toLocaleString("ar-IQ")+'</div></div><span class="pill '+pillClass(status)+'">'+statusLabel(status)+'</span></div>'+
          '<div class="meta mono">'+esc(x.id)+'</div>'+
          '<div class="admin-actions">'+
            '<button class="small" data-open-author="'+esc(x.author_id)+'" type="button">الحساب</button>'+
            '<button class="small" data-moderate="'+esc(x.id)+'" data-kind="'+kind+'" data-status="'+esc(status)+'" type="button">'+(status==="hidden"?"استعادة":"إخفاء")+'</button>'+
            (kind!=="stories"?'<button class="small" data-comments-toggle="'+esc(x.id)+'" data-kind="'+kind+'" data-enabled="'+String(x.comments_enabled!==false)+'" type="button">'+(x.comments_enabled===false?"فتح التعليقات":"إغلاق التعليقات")+'</button>':"")+
            '<button class="small danger" data-delete-content="'+esc(x.id)+'" data-kind="'+kind+'" type="button">حذف نهائي</button>'+
          '</div>'+
        '</div></div>';
    }).join("")||'<div class="panel">لا يوجد محتوى مطابق.</div>';
    await hydrateAdminMedia($("#contentList"));
    $("#contentList").querySelectorAll("[data-open-author]").forEach(b=>b.onclick=()=>{navigate("users");loadUserDetail(b.dataset.openAuthor)});
    $("#contentList").querySelectorAll("[data-moderate]").forEach(b=>b.onclick=async()=>{
      const next=b.dataset.status==="hidden"?"active":"hidden";
      const reason=next==="hidden"?(prompt("سبب إخفاء المحتوى")||""):"";
      await api("/v1/admin/content/"+b.dataset.kind+"/"+b.dataset.moderate+"/moderate",{method:"POST",body:JSON.stringify({status:next,reason})});
      loadContent(currentContentKind);
    });
    $("#contentList").querySelectorAll("[data-comments-toggle]").forEach(b=>b.onclick=async()=>{
      await api("/v1/admin/content/"+b.dataset.kind+"/"+b.dataset.commentsToggle+"/moderate",{
        method:"POST",body:JSON.stringify({status:"active",comments_enabled:b.dataset.enabled!=="true"})
      });
      loadContent(currentContentKind);
    });
    $("#contentList").querySelectorAll("[data-delete-content]").forEach(b=>b.onclick=async()=>{
      if(!confirm("هذا حذف نهائي للمحتوى. تأكيد؟"))return;
      await api("/v1/admin/content/"+b.dataset.kind+"/"+b.dataset.deleteContent,{method:"DELETE"});
      loadContent(currentContentKind);
    });
  }catch(e){$("#contentList").innerHTML='<div class="panel">'+esc(e.message)+'</div>'}
}

let commentTimer;
$("#commentSearch").oninput=()=>{clearTimeout(commentTimer);commentTimer=setTimeout(loadCommentsAdmin,250)};
$("#commentStatus").onchange=loadCommentsAdmin;
async function loadCommentsAdmin(){
  try{
    const params=new URLSearchParams();
    const q=$("#commentSearch").value.trim();
    const status=$("#commentStatus").value;
    if(q)params.set("q",q);
    if(status)params.set("status",status);
    const d=await api("/v1/admin/comments?"+params.toString());
    $("#commentsList").innerHTML=(d.items||[]).map(row=>{
      const a=row.author||{};
      const status=row.moderation_status||"active";
      return '<div class="row-card">'+
        '<div class="grow"><b>'+esc(row.body||"")+'</b><div class="meta">@'+esc(a.username||"")+' · '+new Date(row.created_at).toLocaleString("ar-IQ")+'</div><div class="meta mono">'+esc(row.id)+'</div></div>'+
        '<span class="pill '+pillClass(status)+'">'+statusLabel(status)+'</span>'+
        '<button class="small" data-comment-author="'+esc(row.author_id)+'" type="button">الحساب</button>'+
        '<button class="small" data-moderate-comment="'+esc(row.id)+'" data-status="'+esc(status)+'" type="button">'+(status==="hidden"?"استعادة":"إخفاء")+'</button>'+
      '</div>';
    }).join("")||'<div class="panel">لا توجد تعليقات.</div>';
    $("#commentsList").querySelectorAll("[data-comment-author]").forEach(b=>b.onclick=()=>{navigate("users");loadUserDetail(b.dataset.commentAuthor)});
    $("#commentsList").querySelectorAll("[data-moderate-comment]").forEach(b=>b.onclick=async()=>{
      const next=b.dataset.status==="hidden"?"active":"hidden";
      await api("/v1/admin/content/comments/"+b.dataset.moderateComment+"/moderate",{method:"POST",body:JSON.stringify({status:next,reason:next==="hidden"?(prompt("سبب الإخفاء")||""):""})});
      loadCommentsAdmin();
    });
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
      const note=prompt("ملاحظة داخلية للمشرف (اختياري)","")||"";
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
    $("#channelsList").innerHTML=(d.items||[]).map(c=>`
      <div class="channel-card">
        <div class="grow">
          <b>${esc(c.title||c.channel_key)}</b>
          <div class="meta">المعرف: ${esc(c.channel_id)} · آخر اختبار: ${c.last_test_at?new Date(c.last_test_at).toLocaleString("ar-IQ"):"لم يُختبر"}</div>
        </div>
        <span class="pill ${c.status==="connected"?"ok":"bad"}">${c.status==="connected"?"مربوطة":"تحتاج فحص"}</span>
      </div>`).join("")||'<div class="panel">لم يتم ربط قنوات التخزين بعد.</div>'
  }catch(e){$("#channelsList").innerHTML=`<div class="panel">${esc(e.message)}</div>`}
}

$("#notificationAudience").onchange=()=>$("#targetUserRow").classList.toggle("hidden",$("#notificationAudience").value!=="user");
$("#notificationForm").onsubmit=async e=>{
  e.preventDefault();
  if(!confirm("تأكيد إرسال الإشعار؟"))return;
  try{
    await api("/v1/admin/notifications/send",{method:"POST",body:JSON.stringify({
      title:$("#notificationTitle").value,
      body:$("#notificationBody").value,
      audience:$("#notificationAudience").value,
      user_id:$("#notificationUser").value.trim()||null
    })});
    $("#notificationMessage").textContent="تم إرسال الطلب بنجاح"
  }catch(err){$("#notificationMessage").textContent=err.message}
};

async function loadAdmins(){
  try{
    const d=await api("/v1/admin/admins");
    $("#adminsList").innerHTML=(d.items||[]).map(a=>{
      const p=Array.isArray(a.profiles)?a.profiles[0]:a.profiles||{};
      return `<div class="row-card">
        <div class="grow"><b>${esc(p.name||p.username||a.user_id)}</b><div class="meta">@${esc(p.username||"")} · ${roleLabel[a.role]||a.role}</div></div>
        <span class="pill ${a.active?"ok":"bad"}">${a.active?"نشط":"متوقف"}</span>
      </div>`
    }).join("")||'<div class="panel">لا يوجد مشرفون إضافيون.</div>'
  }catch(e){$("#adminsList").innerHTML=`<div class="panel">${esc(e.message)}</div>`}
}
$("#addAdminButton").onclick=async()=>{
  const userId=prompt("أدخل معرف المستخدم داخل آشور");
  if(!userId)return;
  const role=prompt("اكتب الدور: secondary_admin أو moderator أو content_moderator أو support أو analyst","moderator");
  if(!role)return;
  try{
    await api("/v1/admin/admins",{method:"POST",body:JSON.stringify({user_id:userId.trim(),role:role.trim(),permissions:{}})});
    await loadAdmins()
  }catch(e){alert(e.message)}
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
      uploads:$("#featureUploads").checked
    },
    limits:{
      max_upload_mb:Number($("#limitGeneral").value||60),
      story_mb:Number($("#limitStory").value||30),
      image_mb:Number($("#limitImage").value||10),
      chat_video_mb:Number($("#limitChatVideo").value||50),
      audio_mb:Number($("#limitAudio").value||15)
    }
  })});
  alert("تم حفظ إعدادات التطبيق")
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
  alert("تم تحديث الموقع")
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

verify();
})();