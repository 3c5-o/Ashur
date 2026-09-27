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
  reports:"البلاغات",
  storage:"التخزين",
  notifications:"الإشعارات",
  admins:"المشرفون",
  audit:"سجل الإدارة",
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
  add_admin:"إضافة مشرف"
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
    content:()=>loadContent("posts"),
    reports:loadReports,
    storage:loadStorage,
    admins:loadAdmins,
    audit:loadAudit,
    appSettings:loadAppSettings,
    siteSettings:loadSiteSettings,
    health:loadHealth
  }[page];
  if(loader)loader()
}

async function loadDashboard(){
  try{
    const d=await api("/v1/admin/stats");
    $("#stats").innerHTML=[
      ["المستخدمون",d.users],
      ["المنشورات",d.posts],
      ["الريلز",d.reels],
      ["البلاغات المفتوحة",d.open_reports]
    ].map(([a,b])=>`<div class="stat"><b>${Number(b||0).toLocaleString("ar-IQ")}</b><span>${a}</span></div>`).join("");
    $("#recentReports").innerHTML=(d.recent_reports||[]).map(r=>`
      <div class="row-card">
        <div class="grow"><b>${esc(r.reason)}</b><div class="meta">${esc(r.target_type)} · ${new Date(r.created_at).toLocaleString("ar-IQ")}</div></div>
        <span class="pill">قيد المراجعة</span>
      </div>`).join("")||'<div class="meta">لا توجد بلاغات حديثة.</div>';
    $("#serviceStatus").innerHTML=`
      <div class="row-card"><div class="grow"><b>قاعدة البيانات</b><div class="meta">متصلة</div></div><span class="pill ok">تعمل</span></div>
      <div class="row-card"><div class="grow"><b>بوابة آشور</b><div class="meta">الخدمة الرئيسية</div></div><span class="pill ok">تعمل</span></div>`;
  }catch(e){$("#stats").innerHTML=`<div class="panel">${esc(e.message)}</div>`}
}

let userTimer;
$("#userSearch").oninput=()=>{clearTimeout(userTimer);userTimer=setTimeout(loadUsers,300)};
async function loadUsers(){
  try{
    const q=$("#userSearch").value.trim();
    const d=await api("/v1/admin/users?q="+encodeURIComponent(q));
    $("#usersList").innerHTML=(d.items||[]).map(u=>`
      <div class="row-card">
        <div class="grow">
          <b>${esc(u.name||"مستخدم")}${u.is_verified?' <span style="color:var(--brand)">✓</span>':""}</b>
          <div class="meta">@${esc(u.username||"")} · ${esc(u.id)} · ${u.is_private?"خاص":"عام"}</div>
        </div>
        <span class="pill ${u.is_banned?"bad":"ok"}">${u.is_banned?"محظور":"نشط"}</span>
        <button class="small" data-ban="${u.id}" data-state="${u.is_banned}">${u.is_banned?"رفع الحظر":"حظر"}</button>
      </div>`).join("")||'<div class="panel">لا توجد نتائج.</div>';
    $("#usersList").querySelectorAll("[data-ban]").forEach(b=>b.onclick=async()=>{
      await api("/v1/admin/users/"+b.dataset.ban+"/ban",{method:"POST",body:JSON.stringify({banned:b.dataset.state!=="true"})});
      loadUsers()
    })
  }catch(e){$("#usersList").innerHTML=`<div class="panel">${esc(e.message)}</div>`}
}

$$("[data-content-kind]").forEach(b=>b.onclick=()=>{
  $$("[data-content-kind]").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  loadContent(b.dataset.contentKind)
});
async function loadContent(kind){
  try{
    const d=await api("/v1/admin/content?kind="+encodeURIComponent(kind));
    const kindLabel={posts:"منشور",reels:"ريلز",stories:"قصة"}[kind]||"محتوى";
    $("#contentList").innerHTML=(d.items||[]).map(x=>`
      <div class="row-card">
        <div class="grow">
          <b>${esc(x.caption||kindLabel)}</b>
          <div class="meta">${kindLabel} · ${new Date(x.created_at).toLocaleString("ar-IQ")} · ${esc(x.id)}</div>
        </div>
        <button class="small" data-delete-content="${x.id}" data-kind="${kind}">حذف</button>
      </div>`).join("")||'<div class="panel">لا يوجد محتوى.</div>';
    $("#contentList").querySelectorAll("[data-delete-content]").forEach(b=>b.onclick=async()=>{
      if(!confirm("تأكيد حذف المحتوى؟"))return;
      await api("/v1/admin/content/"+b.dataset.kind+"/"+b.dataset.deleteContent,{method:"DELETE"});
      loadContent(kind)
    })
  }catch(e){$("#contentList").innerHTML=`<div class="panel">${esc(e.message)}</div>`}
}

async function loadReports(){
  try{
    const d=await api("/v1/admin/reports");
    $("#reportsList").innerHTML=(d.items||[]).map(r=>`
      <div class="row-card">
        <div class="grow">
          <b>${esc(r.reason)}</b>
          <div class="meta">${esc(r.target_type)} · ${esc(r.status)} · ${new Date(r.created_at).toLocaleString("ar-IQ")}</div>
        </div>
        ${r.status==="resolved"?'<span class="pill ok">تم الحل</span>':`<button class="small" data-resolve="${r.id}">حل البلاغ</button>`}
      </div>`).join("")||'<div class="panel">لا توجد بلاغات.</div>';
    $("#reportsList").querySelectorAll("[data-resolve]").forEach(b=>b.onclick=async()=>{
      await api("/v1/admin/reports/"+b.dataset.resolve+"/resolve",{method:"POST"});
      loadReports()
    })
  }catch(e){$("#reportsList").innerHTML=`<div class="panel">${esc(e.message)}</div>`}
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