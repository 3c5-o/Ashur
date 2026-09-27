(() => {
  const cfg = window.ASHUR_CONFIG;
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const state = {
    user:null,
    profile:null,
    composerType:"post",
    activeConversation:null,
    commentTarget:null,
    stories:new Map(),
    profileTab:"posts",
    searchType:"all",
    chatTimer:null,
    chatChannel:null,
    reelObserver:null,
    activePage:"homePage",
    previewUrl:null,
    chatPreviewUrl:null,
    commentReply:null,
    currentPublicProfile:null,
    activeUpload:null,
    activeUploadId:null,
    features:{},
    limits:{}
  };

  const escapeHtml = (v="") => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const initials = (name="آشور") => escapeHtml(name.trim().slice(0,1) || "آ");
  const safeLink = (value="") => {
    const raw=String(value||"").trim();
    if(!raw)return "";
    const normalized=/^https?:\/\//i.test(raw)?raw:"https://"+raw;
    try{
      const u=new URL(normalized);
      return ["http:","https:"].includes(u.protocol)?u.href:"";
    }catch{return ""}
  };
  const icon = (name) => {
    const paths={
      like:'<path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.5 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
      comment:'<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
      share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
      save:'<path d="M6 4h12v17l-6-4-6 4Z"/>',
      settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
      link:'<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
      edit:'<path d="m4 16-1 5 5-1L19 9l-4-4Z"/><path d="m13 7 4 4"/>',
      logout:'<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 4h6v16h-6"/>',
      message:'<path d="M4 5h16v12H8l-4 4Z"/>',
      more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
      trash:'<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
      reply:'<path d="M10 8 5 12l5 4"/><path d="M6 12h7a5 5 0 0 1 5 5v1"/>',
      report:'<path d="M5 21V4m0 1h12l-2 4 2 4H5"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||'')+'</svg>';
  };
  const nativeApiBase = () => {
    try { return window.AshurNative?.getApiBaseUrl?.() || ""; } catch { return ""; }
  };
  const apiUrl = (path) => (cfg.apiBaseUrl || nativeApiBase() || location.origin).replace(/\/$/,"") + path;

  function avatar(profile, cls="avatar"){
    if (profile?.avatar_media_id) return `<img class="${cls}" data-media-id="${profile.avatar_media_id}" alt="">`;
    return `<div class="${cls}" style="display:grid;place-items:center;background:#2a231e;color:#d7b16f;font-weight:800">${initials(profile?.name)}</div>`;
  }

  async function mediaAccess(mediaId){
    const result=await api("/v1/media-ticket/"+encodeURIComponent(mediaId));
    return {...result,url:apiUrl(result.path)};
  }

  async function mediaUrl(mediaId){
    return (await mediaAccess(mediaId)).url;
  }

  async function hydrateMedia(root=document){
    const nodes=[...root.querySelectorAll("[data-media-id]")].filter(node=>node.dataset.mediaReady!=="1");
    if(!nodes.length)return;
    let cursor=0;
    const worker=async()=>{
      while(cursor<nodes.length){
        const node=nodes[cursor++];
        if(!node?.isConnected)continue;
        try{
          const access=await mediaAccess(node.dataset.mediaId);
          if(!node.isConnected)continue;
          if(access.mime_type?.startsWith("video/") && node.tagName==="IMG"){
            const video=document.createElement("video");
            video.className=node.className;
            video.dataset.mediaId=node.dataset.mediaId;
            video.dataset.mediaReady="1";
            video.src=access.url;
            video.controls=true;
            video.playsInline=true;
            video.preload="metadata";
            node.replaceWith(video);
          }else{
            node.src=access.url;
            node.dataset.mediaReady="1";
          }
        }catch(_){
          if(node?.isConnected){
            node.removeAttribute("src");
            node.dataset.mediaError="1";
          }
        }
      }
    };
    const workers=Array.from({length:Math.min(4,nodes.length)},()=>worker());
    await Promise.all(workers);
  }

  async function accessToken(){
    const { data } = await client.auth.getSession();
    return data.session?.access_token || "";
  }

  async function api(path, options={}){
    const token = await accessToken();
    const headers = new Headers(options.headers || {});
    if(token) headers.set("Authorization", "Bearer "+token);
    const res = await fetch(apiUrl(path), {...options, headers});
    const type = res.headers.get("content-type") || "";
    const body = type.includes("json") ? await res.json() : await res.text();
    if(!res.ok) throw new Error(body?.error || body?.message || body || "تعذر تنفيذ الطلب");
    return body;
  }

  function showAuthMessage(text, good=false){
    const el=$("#authMessage"); el.textContent=text; el.className="message "+(good?"success":"error");
  }

  function errorMarkup(message,view){
    return `<div class="empty error-state"><div><b>تعذر التحميل</b><p>${escapeHtml(message||"تحقق من اتصال الإنترنت وحاول مرة أخرى.")}</p><button type="button" data-retry-view="${escapeHtml(view||"homePage")}">إعادة المحاولة</button></div></div>`;
  }

  document.addEventListener("click",e=>{
    const retry=e.target.closest?.("[data-retry-view]");
    if(!retry)return;
    const view=retry.dataset.retryView||"homePage";
    retry.disabled=true;
    const job=view==="homePage"?loadHome():navigateTo(view);
    Promise.resolve(job).finally(()=>{if(retry.isConnected)retry.disabled=false});
  });

  function showApp(loggedIn){
    $("#auth").classList.toggle("hidden",loggedIn);
    $("#app").classList.toggle("hidden",!loggedIn);
    if(!loggedIn){
      closeTransientDialogs();
      state.activePage="homePage";
      $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page==="homePage"));
      $$(".page").forEach(x=>x.classList.toggle("active",x.id==="homePage"));
    }
  }

  const PROFILE_CACHE_KEY="ashur_profile_cache_v1";

  function cacheProfile(profile){
    try{
      if(profile?.id)localStorage.setItem(PROFILE_CACHE_KEY,JSON.stringify(profile));
    }catch(_){}
  }

  function readCachedProfile(userId){
    try{
      const cached=JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY)||"null");
      return cached?.id===userId?cached:null;
    }catch{return null}
  }

  function setNetworkState(online,message=""){
    const banner=$("#networkBanner");
    if(!banner)return;
    banner.classList.toggle("hidden",online);
    const text=banner.querySelector("span");
    if(text)text.textContent=message||"لا يوجد اتصال بالإنترنت";
  }

  async function retryCurrentView(){
    if(!navigator.onLine){
      setNetworkState(false,"لا يوجد اتصال بالإنترنت");
      return;
    }
    setNetworkState(true);
    const active=$(".page.active")?.id||"homePage";
    if(active==="homePage")await loadHome();
    else await navigateTo(active);
    await loadNotificationsBadge().catch(()=>{});
  }

  $("#retryNetworkButton").onclick=()=>retryCurrentView();
  window.addEventListener("offline",()=>setNetworkState(false));
  window.addEventListener("online",()=>{setNetworkState(true);retryCurrentView().catch(()=>{})});

  function closeTransientDialogs(except=null){
    document.querySelectorAll("dialog[open]").forEach(dialog=>{
      if(dialog===except)return;
      if(dialog.id==="systemDialog" && dialog.dataset.blocking==="1")return;
      if(dialog.id==="chatDialog"){
        clearInterval(state.chatTimer);
        state.chatTimer=null;
        state.chatChannel?.unsubscribe?.();
        state.chatChannel=null;
        state.activeConversation=null;
        clearChatAttachment();
      }
      try{dialog.close()}catch(_){}
    });
  }

  function openDialog(dialog){
    if(!dialog)return;
    closeTransientDialogs(dialog);
    if(!dialog.open)dialog.showModal();
  }


  function compareVersions(a,b){
    const pa=String(a||"0").split(".").map(n=>Number(n)||0);
    const pb=String(b||"0").split(".").map(n=>Number(n)||0);
    const len=Math.max(pa.length,pb.length);
    for(let i=0;i<len;i++){
      const x=pa[i]||0,y=pb[i]||0;
      if(x>y)return 1;
      if(x<y)return -1;
    }
    return 0;
  }

  async function checkRuntimeSettings(){
    const {data,error}=await client.from("app_settings")
      .select("key,value")
      .in("key",["maintenance","version","features","limits"]);
    if(error)return;
    const settings=Object.fromEntries((data||[]).map(x=>[x.key,x.value]));
    const maintenance=settings.maintenance||{};
    const version=settings.version||{};
    state.features=settings.features||{};
    state.limits=settings.limits||{};
    cfg.maxUploadMb=Math.min(Number(state.limits.max_upload_mb||60),60);

    const setFeature=(page,key)=>{
      const nav=$(`.nav-item[data-page="${page}"]`);
      if(nav)nav.classList.toggle("hidden",state.features[key]===false);
    };
    setFeature("reelsPage","reels");
    setFeature("messagesPage","messages");
    $("#publishButton").classList.toggle("hidden",state.features.uploads===false);
    $("#registerTab").classList.toggle("hidden",state.features.registration===false);
    $(".home-intro").classList.toggle("stories-disabled",state.features.stories===false);

    const current=cfg.appVersion||"1.0.0";
    const required=Boolean(version.required) ||
      (version.minimum && compareVersions(current,version.minimum)<0);

    if(maintenance.enabled){
      $("#systemTitle").textContent=maintenance.title||"آشور";
      $("#systemMessage").textContent=maintenance.message||"نعمل على تحسين الخدمة، يرجى المحاولة لاحقًا.";
      $("#systemPrimary").classList.add("hidden");
      $("#systemLater").classList.add("hidden");
      $("#systemDialog").dataset.blocking="1";
      if(!$("#systemDialog").open)openDialog($("#systemDialog"));
      return;
    }

    if(version.latest && compareVersions(current,version.latest)<0){
      $("#systemTitle").textContent="يتوفر تحديث جديد";
      $("#systemMessage").textContent=version.message||`يتوفر الإصدار ${version.latest} من آشور.`;
      const link=$("#systemPrimary");
      if(version.download_url){
        link.href=version.download_url;
        link.classList.remove("hidden");
      }else{
        link.classList.add("hidden");
      }
      $("#systemLater").classList.toggle("hidden",required);
      $("#systemDialog").dataset.blocking=required?"1":"0";
      if(!$("#systemDialog").open)openDialog($("#systemDialog"));
      return;
    }

    $("#systemDialog").dataset.blocking="0";
    if($("#systemDialog").open)$("#systemDialog").close();
  }

  $("#systemDialog").addEventListener("cancel",e=>{
    if($("#systemDialog").dataset.blocking==="1")e.preventDefault();
  });
  $("#systemLater").onclick=()=>$("#systemDialog").close();

  async function refreshProfile(){
    if(!state.user)return;
    const {data,error}=await client.from("profiles").select("*").eq("id",state.user.id).single();
    if(error)throw error;
    state.profile=data;
    cacheProfile(data);
  }

  async function ensureProfileIdentity(){
    if(!state.user||state.profile?.username)return;
    const username=String(state.user.user_metadata?.username||"").trim().toLowerCase();
    const name=String(state.user.user_metadata?.name||state.profile?.name||"مستخدم").trim();
    if(!/^[a-z0-9_]{3,24}$/.test(username))return;
    const {error}=await client.rpc("claim_username",{p_username:username,p_name:name});
    if(!error)await refreshProfile();
  }

  async function boot(){
    const splash=$("#splash");
    const closeSplash=()=>{
      if(!splash?.isConnected)return;
      splash.style.opacity="0";
      setTimeout(()=>splash.remove(),240);
    };
    const fallbackTimer=setTimeout(closeSplash,5000);
    setNetworkState(navigator.onLine);

    try{
      await checkRuntimeSettings().catch(()=>{});
      const {data:{session},error:sessionError}=await client.auth.getSession();
      if(sessionError)throw sessionError;
      state.user=session?.user||null;

      if(!state.user){
        showApp(false);
        return;
      }

      state.profile=readCachedProfile(state.user.id);
      showApp(true);
      await nativeLogin(state.user.id);

      try{
        await refreshProfile();
        await ensureProfileIdentity();
        setNetworkState(true);
      }catch(error){
        console.warn("ASHUR_PROFILE_OFFLINE",error);
        setNetworkState(false,"تعذر الاتصال بالخدمة. سيتم عرض آخر بيانات متاحة.");
      }

      await Promise.allSettled([
        loadHome(),
        loadNotificationsBadge()
      ]);
    }finally{
      clearTimeout(fallbackTimer);
      setTimeout(closeSplash,350);
    }
  }

  async function nativeLogin(uid){
    try{
      if(window.AshurNative?.loginOneSignal) window.AshurNative.loginOneSignal(uid);
    }catch(_){}
  }
  function nativeLogout(){
    try{ if(window.AshurNative?.logoutOneSignal) window.AshurNative.logoutOneSignal(); }catch(_){}
  }

  client.auth.onAuthStateChange(async (event, session)=>{
    state.user=session?.user || null;
    if(event==="PASSWORD_RECOVERY"){
      showApp(false);
      $("#loginForm").classList.add("hidden");
      $("#registerForm").classList.add("hidden");
      $("#passwordRecoveryForm").classList.remove("hidden");
      $(".auth-tabs").classList.add("hidden");
      showAuthMessage("اكتب كلمة المرور الجديدة للحساب.",true);
      return;
    }
    if(state.user){
      await refreshProfile().catch(()=>{});
      await ensureProfileIdentity().catch(()=>{});
      await nativeLogin(state.user.id);
      showApp(true);
      checkRuntimeSettings(); loadHome(); loadNotificationsBadge();
    }else{
      state.profile=null;
      try{localStorage.removeItem(PROFILE_CACHE_KEY)}catch(_){}
      nativeLogout();
      showApp(false);
    }
  });

  $("#loginTab").onclick=()=>{
    $("#loginTab").classList.add("active"); $("#registerTab").classList.remove("active");
    $("#loginForm").classList.remove("hidden"); $("#registerForm").classList.add("hidden");
  };
  $("#registerTab").onclick=()=>{
    $("#registerTab").classList.add("active"); $("#loginTab").classList.remove("active");
    $("#registerForm").classList.remove("hidden"); $("#loginForm").classList.add("hidden");
  };

  $("#loginForm").onsubmit=async(e)=>{
    e.preventDefault(); showAuthMessage("جارٍ تسجيل الدخول...",true);
    const {error}=await client.auth.signInWithPassword({email:$("#loginEmail").value.trim(),password:$("#loginPassword").value});
    if(error) return showAuthMessage("تعذر تسجيل الدخول: "+error.message);
    showAuthMessage("");
  };

  $("#registerForm").onsubmit=async(e)=>{
    e.preventDefault();
    const name=$("#registerName").value.trim(), username=$("#registerUsername").value.trim().toLowerCase();
    const email=$("#registerEmail").value.trim(), p1=$("#registerPassword").value, p2=$("#registerPassword2").value;
    if(p1!==p2) return showAuthMessage("كلمتا المرور غير متطابقتين");
    if(!/^[a-z0-9_]{3,24}$/.test(username)) return showAuthMessage("اسم المستخدم يقبل الحروف الإنجليزية والأرقام والشرطة السفلية فقط");
    showAuthMessage("جارٍ التحقق من اسم المستخدم...",true);
    const {data:existingUsername,error:checkError}=await client.from("profiles")
      .select("id")
      .eq("username",username)
      .maybeSingle();
    if(checkError)return showAuthMessage("تعذر التحقق من اسم المستخدم");
    if(existingUsername)return showAuthMessage("اسم المستخدم مستخدم بالفعل");

    showAuthMessage("جارٍ إنشاء الحساب...",true);
    const {data,error}=await client.auth.signUp({
      email,
      password:p1,
      options:{data:{name,username}}
    });
    if(error) return showAuthMessage(error.message);
    if(data.session){
      const {error:claimError}=await client.rpc("claim_username",{p_username:username,p_name:name});
      if(claimError) return showAuthMessage(claimError.message);
      await refreshProfile().catch(()=>{});
      showAuthMessage("تم إنشاء الحساب",true);
    }else{
      showAuthMessage("تم إنشاء الحساب. افتح رسالة التحقق في بريدك ثم سجّل الدخول.",true);
    }
  };

  $("#forgotPassword").onclick=async()=>{
    const email=$("#loginEmail").value.trim();
    if(!email) return showAuthMessage("اكتب البريد الإلكتروني أولًا");
    const redirectTo="ashur://reset-password";
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo});
    showAuthMessage(error?error.message:"تم إرسال رابط استعادة كلمة المرور إلى بريدك.",!error);
  };

  $("#passwordRecoveryForm").onsubmit=async(e)=>{
    e.preventDefault();
    const p1=$("#recoveryPassword").value;
    const p2=$("#recoveryPassword2").value;
    if(p1.length<8)return showAuthMessage("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
    if(p1!==p2)return showAuthMessage("كلمتا المرور غير متطابقتين.");
    const {error}=await client.auth.updateUser({password:p1});
    if(error)return showAuthMessage(error.message);
    $("#passwordRecoveryForm").classList.add("hidden");
    $(".auth-tabs").classList.remove("hidden");
    $("#loginForm").classList.remove("hidden");
    $("#loginTab").classList.add("active");
    $("#registerTab").classList.remove("active");
    showAuthMessage("تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.",true);
    await client.auth.signOut();
  };
  $("#cancelPasswordRecovery").onclick=()=>{
    $("#passwordRecoveryForm").classList.add("hidden");
    $(".auth-tabs").classList.remove("hidden");
    $("#loginForm").classList.remove("hidden");
    $("#registerForm").classList.add("hidden");
    $("#loginTab").classList.add("active");
    $("#registerTab").classList.remove("active");
  };

  async function navigateTo(page){
    if(!document.getElementById(page))page="homePage";
    closeTransientDialogs();
    state.activePage=page;
    $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
    $$(".page").forEach(x=>x.classList.toggle("active",x.id===page));
    if(page!=="reelsPage"){
      $("#reelsFeed")?.querySelectorAll("video").forEach(video=>video.pause());
      state.reelObserver?.disconnect?.();
      state.reelObserver=null;
    }
    if(page==="searchPage")await loadExplore();
    if(page==="reelsPage")await loadReels();
    if(page==="messagesPage")await loadConversations();
    if(page==="profilePage")await loadProfile();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  $$(".nav-item").forEach(btn=>btn.onclick=()=>navigateTo(btn.dataset.page));
  $("#brandButton").onclick=()=>navigateTo("homePage");

  async function loadHome(){
    $("#homeStatus").textContent="جارٍ تحميل أحدث المحتوى...";
    const tasks=[loadFeed()];
    if(state.features.stories!==false)tasks.push(loadStories());
    else $("#stories").innerHTML="";
    await Promise.all(tasks);
    $("#homeStatus").textContent="";
  }

  async function loadStories(){
    const since=new Date().toISOString();
    const {data,error}=await client.from("stories").select("id,author_id,media_id,caption,expires_at").gt("expires_at",since).order("created_at",{ascending:false}).limit(20);
    if(error){$("#stories").innerHTML="";return}
    const ids=[...new Set((data||[]).map(x=>x.author_id))];
    const profiles=await profilesMap(ids);
    state.stories=new Map();
    let html=`<button class="story" data-own-story="1"><div class="story-ring"><div class="fallback">+</div></div><span>قصتك</span></button>`;
    html+=(data||[]).map(s=>{
      const p=profiles[s.author_id]||{};
      state.stories.set(s.id,{...s,profile:p});
      return `<button class="story" data-story="${s.id}"><div class="story-ring">${avatar(p,"avatar")}</div><span>${escapeHtml(p.username||p.name||"مستخدم")}</span></button>`
    }).join("");
    $("#stories").innerHTML=html;
    await hydrateMedia($("#stories"));
    $("#stories").querySelector("[data-own-story]")?.addEventListener("click",()=>openComposer("story"));
    $("#stories").querySelectorAll("[data-story]").forEach(b=>b.onclick=()=>openStoryViewer(b.dataset.story));
  }

  async function openStoryViewer(id){
    const story=state.stories.get(id);
    if(!story)return;
    const dialog=$("#storyViewerDialog");
    const user=$("#storyViewerUser");
    user.innerHTML=`${avatar(story.profile)}<span>${escapeHtml(story.profile?.name||story.profile?.username||"مستخدم")}</span>`;
    $("#storyViewerCaption").textContent=story.caption||"";
    $("#storyViewerMedia").innerHTML='<div class="empty">جارٍ تحميل القصة...</div>';
    $("#storyProgressBar").style.width="0%";
    openDialog(dialog);
    await hydrateMedia(user);
    try{
      const access=await mediaAccess(story.media_id);
      const media=access.mime_type?.startsWith("video/")
        ? `<video src="${access.url}" autoplay playsinline controls></video>`
        : `<img src="${access.url}" alt="">`;
      $("#storyViewerMedia").innerHTML=media;
      requestAnimationFrame(()=>$("#storyProgressBar").style.width="100%");
    }catch{
      $("#storyViewerMedia").innerHTML='<div class="empty error">تعذر تحميل القصة.</div>';
    }
  }
  $("#closeStoryViewer").onclick=()=>$("#storyViewerDialog").close();
  $("#storyViewerDialog").addEventListener("click",e=>{
    if(e.target===$("#storyViewerDialog"))$("#storyViewerDialog").close();
  });

  async function profilesMap(ids){
    if(!ids.length) return {};
    const {data}=await client.from("profiles").select("id,name,username,avatar_media_id,is_verified,is_private").in("id",ids);
    return Object.fromEntries((data||[]).map(x=>[x.id,x]));
  }

  async function followStatusMap(ids){
    const targets=[...new Set((ids||[]).filter(id=>id && id!==state.user?.id))];
    if(!targets.length)return {};
    const {data}=await client.from("follows")
      .select("following_id,status")
      .eq("follower_id",state.user.id)
      .in("following_id",targets);
    return Object.fromEntries((data||[]).map(row=>[row.following_id,row.status]));
  }

  function followLabel(status){
    return status==="accepted"?"تتابعه":status==="pending"?"تم إرسال الطلب":"متابعة";
  }

  function openOwnContentActions(kind,id,caption="",commentsEnabled=true){
    const label=kind==="reels"?"الريلز":kind==="stories"?"القصة":"المنشور";
    const commentsField=kind==="stories"?"":`
      <label class="switch-row">
        <span><b>السماح بالتعليقات</b><small>يمكن تغييرها بأي وقت</small></span>
        <input id="ownContentComments" type="checkbox" ${commentsEnabled!==false?"checked":""}>
      </label>`;
    openInfoDialog("إدارة "+label,`
      <div class="form settings-info">
        <label><span>الوصف</span><textarea id="ownContentCaption" maxlength="2200">${escapeHtml(caption||"")}</textarea></label>
        ${commentsField}
        <button id="saveOwnContent" class="primary" type="button">حفظ التعديلات</button>
        <button id="deleteOwnContent" class="danger-wide danger-outline" type="button">حذف ${label}</button>
        <p id="ownContentMessage" class="message"></p>
      </div>`);
    $("#saveOwnContent").onclick=async()=>{
      $("#saveOwnContent").disabled=true;
      try{
        const body={caption:$("#ownContentCaption").value.trim()};
        if(kind!=="stories")body.comments_enabled=$("#ownContentComments").checked;
        await api("/v1/social/content/"+kind+"/"+id,{method:"PATCH",body:JSON.stringify(body)});
        $("#infoDialog").close();
        if(state.activePage==="profilePage")await loadProfileContent(state.profileTab);
        else if(kind==="reels")await loadReels();
        else await loadFeed();
      }catch(error){
        $("#ownContentMessage").textContent=error.message;
      }finally{$("#saveOwnContent").disabled=false}
    };
    $("#deleteOwnContent").onclick=async()=>{
      if(!confirm("تأكيد حذف "+label+"؟ لا يمكن التراجع عن العملية."))return;
      $("#deleteOwnContent").disabled=true;
      try{
        await api("/v1/social/content/"+kind+"/"+id,{method:"DELETE"});
        $("#infoDialog").close();
        if(state.activePage==="profilePage")await loadProfileContent(state.profileTab);
        else if(kind==="reels")await loadReels();
        else await loadFeed();
      }catch(error){
        $("#ownContentMessage").textContent=error.message;
        $("#deleteOwnContent").disabled=false;
      }
    };
  }

  async function toggleSavedContent(kind,id,button){
    const isSaved=button?.classList.contains("active");
    const result=await api("/v1/social/save",{
      method:"POST",
      body:JSON.stringify({kind,id,saved:!isSaved})
    });
    button?.classList.toggle("active",result.saved);
    if(button){
      const label=kind==="reel"?(result.saved?"محفوظ":"حفظ"):(result.saved?"محفوظ":"حفظ");
      if(kind==="reel")button.innerHTML=`<span class="reel-action-icon">${icon("save")}</span><span>${label}</span>`;
      else button.innerHTML=icon("save")+`<span>${label}</span>`;
    }
  }

  async function loadFeed(){
    const {data,error}=await client.from("posts")
      .select("id,author_id,caption,created_at,comments_enabled,post_media(media_id,sort_order)")
      .order("created_at",{ascending:false})
      .limit(20);
    if(error){
      $("#feed").innerHTML=errorMarkup(error.message,"homePage");
      return;
    }
    if(!data?.length){
      $("#feed").innerHTML='<div class="empty">لا توجد منشورات بعد. كن أول من يشارك شيئًا.</div>';
      return;
    }

    const postIds=data.map(x=>x.id);
    const [profiles,{data:liked},{data:saved}] = await Promise.all([
      profilesMap([...new Set(data.map(x=>x.author_id))]),
      client.from("post_likes").select("post_id").eq("user_id",state.user.id).in("post_id",postIds),
      client.from("saved_posts").select("post_id").eq("user_id",state.user.id).in("post_id",postIds)
    ]);
    const likedSet=new Set((liked||[]).map(x=>x.post_id));
    const savedSet=new Set((saved||[]).map(x=>x.post_id));

    $("#feed").innerHTML=data.map(post=>{
      const p=profiles[post.author_id]||{};
      const media=(post.post_media||[]).sort((a,b)=>a.sort_order-b.sort_order)[0]?.media_id;
      const verified=p.is_verified?'<span class="verified-inline">✓</span>':"";
      const likedNow=likedSet.has(post.id);
      const savedNow=savedSet.has(post.id);
      return `<article class="post" data-post-id="${post.id}">
        <div class="post-head">
          ${avatar(p)}
          <button class="post-user" data-open-profile="${post.author_id}" type="button">
            <b>${escapeHtml(p.name||"مستخدم")}${verified}</b>
            <small>@${escapeHtml(p.username||"")} · ${new Date(post.created_at).toLocaleDateString("ar-IQ")}</small>
          </button>
          ${post.author_id===state.user.id?`<button class="profile-more-button" data-own-post="${post.id}" data-caption="${escapeHtml(post.caption||"")}" data-comments="${post.comments_enabled!==false}" type="button" aria-label="إدارة المنشور">${icon("more")}</button>`:""}
        </div>
        ${media?`<img class="post-media" loading="lazy" data-media-id="${media}" alt="">`:""}
        <div class="post-body">
          <div class="post-actions">
            <button class="action icon-action ${likedNow?"active":""}" data-like-post="${post.id}" type="button">${icon("like")}<span>${likedNow?"معجب":"إعجاب"}</span></button>
            ${post.comments_enabled===false
              ? `<button class="action icon-action" type="button" disabled>${icon("comment")}<span>التعليقات مغلقة</span></button>`
              : `<button class="action icon-action" data-comment-post="${post.id}" type="button">${icon("comment")}<span>تعليق</span></button>`}
            <button class="action icon-action" data-share-post="${post.id}" type="button">${icon("share")}<span>مشاركة</span></button>
            <button class="action icon-action ${savedNow?"active":""}" data-save-post="${post.id}" type="button">${icon("save")}<span>${savedNow?"محفوظ":"حفظ"}</span></button>
          </div>
          ${post.caption?`<p class="caption">${escapeHtml(post.caption)}</p>`:""}
        </div>
      </article>`;
    }).join("");

    await hydrateMedia($("#feed"));
    $("#feed").querySelectorAll("[data-like-post]").forEach(b=>b.onclick=()=>toggleLike("post",b.dataset.likePost,b));
    $("#feed").querySelectorAll("[data-comment-post]").forEach(b=>b.onclick=()=>openComments("post",b.dataset.commentPost));
    $("#feed").querySelectorAll("[data-share-post]").forEach(b=>b.onclick=()=>shareContent("post",b.dataset.sharePost));
    $("#feed").querySelectorAll("[data-save-post]").forEach(b=>b.onclick=()=>toggleSavedContent("post",b.dataset.savePost,b));
    $("#feed").querySelectorAll("[data-own-post]").forEach(b=>b.onclick=()=>openOwnContentActions("posts",b.dataset.ownPost,b.dataset.caption,b.dataset.comments==="true"));
    $("#feed").querySelectorAll("[data-open-profile]").forEach(b=>b.onclick=()=>openPublicProfile(b.dataset.openProfile));
  }

  async function toggleLike(type,id,button){
    if(!state.user)return;
    const table=type==="post"?"post_likes":"reel_likes";
    const target=type==="post"?"post_id":"reel_id";
    const {data}=await client.from(table).select("*").eq(target,id).eq("user_id",state.user.id).maybeSingle();
    const active=!data;
    if(data) await client.from(table).delete().eq(target,id).eq("user_id",state.user.id);
    else await client.from(table).insert({[target]:id,user_id:state.user.id});
    button.classList.toggle("active",active);
    if(type==="reel"){
      button.innerHTML=`<span class="reel-action-icon">${icon("like")}</span><span>${active?"معجب":"إعجاب"}</span>`;
    }else{
      button.innerHTML=icon("like")+`<span>${active?"معجب":"إعجاب"}</span>`;
    }
  }


  async function shareContent(type,id){
    const text=type==="reel"?"ريلز على آشور":"منشور على آشور";
    const base=(cfg.shareBaseUrl||"").replace(/\/$/,"");
    const url=base?base+"/#"+type+"-"+id:"";
    try{
      if(navigator.share){
        await navigator.share({title:"آشور",text,...(url?{url}:{})});
      }else if(url){
        await navigator.clipboard.writeText(url);
      }
    }catch(_){}
  }

  function setSearchType(type){
    state.searchType=["all","accounts","posts","reels"].includes(type)?type:"all";
    $$(".chip[data-search-type]").forEach(btn=>btn.classList.toggle("active",btn.dataset.searchType===state.searchType));
    runSearch();
  }
  $$(".chip[data-search-type]").forEach(btn=>btn.onclick=()=>setSearchType(btn.dataset.searchType));

  async function renderAccountResults(query=""){
    let request=client.from("profiles")
      .select("id,name,username,avatar_media_id,is_verified,is_private,created_at")
      .neq("id",state.user.id)
      .order("created_at",{ascending:false})
      .limit(30);
    if(query){
      const safe=query.replace(/[,%()]/g,"");
      request=request.or(`name.ilike.%${safe}%,username.ilike.%${safe}%`);
    }
    const {data,error}=await request;
    if(error)throw error;
    const statuses=await followStatusMap((data||[]).map(x=>x.id));
    return (data||[]).map(p=>`<div class="list-card">
      ${avatar(p)}
      <button class="grow profile-result" data-open-profile="${p.id}" type="button">
        <b>${escapeHtml(p.name||"مستخدم")}${p.is_verified?'<span class="verified-inline">✓</span>':""}</b>
        <div>@${escapeHtml(p.username||"")}${p.is_private?" · حساب خاص":""}</div>
      </button>
      <button class="small-button ${statuses[p.id]?"active":""}" data-follow="${p.id}" type="button">${followLabel(statuses[p.id])}</button>
    </div>`).join("");
  }

  async function renderPostResults(query=""){
    let request=client.from("posts")
      .select("id,author_id,caption,created_at,post_media(media_id,sort_order)")
      .order("created_at",{ascending:false})
      .limit(30);
    if(query)request=request.ilike("caption",`%${query.replace(/[,%()]/g,"")}%`);
    const {data,error}=await request;
    if(error)throw error;
    const profiles=await profilesMap([...new Set((data||[]).map(x=>x.author_id))]);
    return (data||[]).map(row=>{
      const p=profiles[row.author_id]||{};
      const media=(row.post_media||[]).sort((a,b)=>a.sort_order-b.sort_order)[0]?.media_id;
      return `<article class="search-post-card">
        <button class="search-post-owner" data-open-profile="${row.author_id}" type="button">${avatar(p)}<span><b>${escapeHtml(p.name||p.username||"مستخدم")}</b><small>@${escapeHtml(p.username||"")}</small></span></button>
        ${media?`<img class="search-post-media" data-media-id="${media}" alt="">`:""}
        ${row.caption?`<p>${escapeHtml(row.caption)}</p>`:""}
      </article>`;
    }).join("");
  }

  async function renderReelResults(query=""){
    let request=client.from("reels")
      .select("id,media_id,caption,author_id,created_at")
      .eq("explore_enabled",true)
      .order("created_at",{ascending:false})
      .limit(18);
    if(query)request=request.ilike("caption",`%${query.replace(/[,%()]/g,"")}%`);
    const {data,error}=await request;
    if(error)throw error;
    return (data||[]).map(r=>`
      <button class="explore-tile" data-open-reel="${r.id}" type="button">
        <video muted playsinline preload="metadata" data-media-id="${r.media_id}"></video>
        <span class="explore-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z"/></svg></span>
      </button>`).join("");
  }

  async function loadExplore(){
    return runSearch();
  }

  let searchTimer;
  $("#searchInput").oninput=()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(runSearch,250);
  };

  async function runSearch(){
    const q=$("#searchInput").value.trim();
    $("#searchResults").innerHTML='<div class="empty">جارٍ التحميل...</div>';
    $("#searchResults").classList.remove("explore-media-grid");
    try{
      let html="";
      if(state.searchType==="accounts"){
        html=await renderAccountResults(q);
      }else if(state.searchType==="posts"){
        html=await renderPostResults(q);
      }else if(state.searchType==="reels"){
        $("#searchResults").classList.add("explore-media-grid");
        html=await renderReelResults(q);
      }else if(q){
        const [accounts,posts,reels]=await Promise.all([
          renderAccountResults(q),
          renderPostResults(q),
          renderReelResults(q)
        ]);
        html=`${accounts?`<div class="search-group-title">الحسابات</div>${accounts}`:""}${posts?`<div class="search-group-title">المنشورات</div>${posts}`:""}${reels?`<div class="search-group-title">الريلز</div><div class="explore-media-grid inline-grid">${reels}</div>`:""}`;
      }else{
        $("#searchResults").classList.add("explore-media-grid");
        html=await renderReelResults("");
      }

      $("#searchResults").innerHTML=html||'<div class="empty">لا توجد نتائج.</div>';
      await hydrateMedia($("#searchResults"));

      $("#searchResults").querySelectorAll("[data-follow]").forEach(b=>b.onclick=e=>{
        e.stopPropagation();
        followUser(b.dataset.follow,b);
      });
      $("#searchResults").querySelectorAll("[data-open-profile]").forEach(b=>b.onclick=()=>openPublicProfile(b.dataset.openProfile));
      $("#searchResults").querySelectorAll("[data-open-reel]").forEach(b=>b.onclick=async()=>{
        await navigateTo("reelsPage");
        requestAnimationFrame(()=>{
          const target=$(`.reel[data-reel-id="${b.dataset.openReel}"]`);
          target?.scrollIntoView({block:"start"});
        });
      });
    }catch(error){
      $("#searchResults").classList.remove("explore-media-grid");
      $("#searchResults").innerHTML=errorMarkup(error.message||"تعذر تحميل البحث","searchPage");
    }
  }

  async function followUser(uid,btn){
    if(!uid||uid===state.user.id)return;
    const {data:existing,error:existingError}=await client.from("follows")
      .select("status")
      .eq("follower_id",state.user.id)
      .eq("following_id",uid)
      .maybeSingle();
    if(existingError)return;

    if(existing){
      const {error}=await client.from("follows")
        .delete()
        .eq("follower_id",state.user.id)
        .eq("following_id",uid);
      if(!error && btn){
        btn.textContent="متابعة";
        btn.classList.remove("active");
      }
      return;
    }

    const {data:p,error:profileError}=await client.from("profiles").select("is_private").eq("id",uid).single();
    if(profileError)return;
    const status=p?.is_private?"pending":"accepted";
    const {error}=await client.from("follows").insert({follower_id:state.user.id,following_id:uid,status});
    if(!error && btn){
      btn.textContent=followLabel(status);
      btn.classList.add("active");
    }
  }

  async function loadReels(){
    const {data,error}=await client.from("reels")
      .select("id,author_id,media_id,caption,created_at,comments_enabled")
      .order("created_at",{ascending:false})
      .limit(12);
    if(error){
      $("#reelsFeed").innerHTML=errorMarkup("تعذر تحميل الريلز.","reelsPage");
      return;
    }
    if(!data?.length){
      $("#reelsFeed").innerHTML='<div class="empty">لا توجد ريلز بعد.</div>';
      return;
    }

    const reelIds=data.map(x=>x.id);
    const [ps,statuses,{data:liked},{data:saved}] = await Promise.all([
      profilesMap([...new Set(data.map(x=>x.author_id))]),
      followStatusMap(data.map(x=>x.author_id)),
      client.from("reel_likes").select("reel_id").eq("user_id",state.user.id).in("reel_id",reelIds),
      client.from("saved_reels").select("reel_id").eq("user_id",state.user.id).in("reel_id",reelIds)
    ]);
    const likedSet=new Set((liked||[]).map(x=>x.reel_id));
    const savedSet=new Set((saved||[]).map(x=>x.reel_id));

    $("#reelsFeed").innerHTML=data.map(r=>{
      const p=ps[r.author_id]||{};
      const likedNow=likedSet.has(r.id);
      const savedNow=savedSet.has(r.id);
      return `<article class="reel" data-reel-id="${r.id}">
        <video playsinline muted loop preload="metadata" data-media-id="${r.media_id}"></video>
        <div class="reel-shade"></div>
        <button class="reel-center-play" type="button" aria-label="تشغيل">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg>
        </button>
        <button class="reel-mute" type="button" aria-label="الصوت">
          <svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6L9 10Z"/><path d="m18 9 3 3-3 3"/></svg>
        </button>
        <div class="reel-overlay">
          <div class="reel-owner">
            ${avatar(p,"reel-owner-avatar")}
            <button class="reel-user" data-open-profile="${r.author_id}" type="button">
              ${escapeHtml(p.name||p.username||"مستخدم")}${p.is_verified?'<span class="verified-inline">✓</span>':""}
            </button>
            ${r.author_id!==state.user.id?`<button class="reel-follow ${statuses[r.author_id]?"active":""}" data-follow-reel="${r.author_id}" type="button">${followLabel(statuses[r.author_id])}</button>`:""}
          </div>
          <p>${escapeHtml(r.caption||"")}</p>
        </div>
        <div class="reel-actions">
          <button class="reel-action ${likedNow?"active":""}" data-like-reel="${r.id}" type="button">
            <span class="reel-action-icon">${icon("like")}</span><span>${likedNow?"معجب":"إعجاب"}</span>
          </button>
          ${r.comments_enabled===false
            ? `<button class="reel-action" type="button" disabled><span class="reel-action-icon">${icon("comment")}</span><span>مغلقة</span></button>`
            : `<button class="reel-action" data-comment-reel="${r.id}" type="button"><span class="reel-action-icon">${icon("comment")}</span><span>تعليق</span></button>`}
          <button class="reel-action" data-share-reel="${r.id}" type="button">
            <span class="reel-action-icon">${icon("share")}</span><span>مشاركة</span>
          </button>
          <button class="reel-action ${savedNow?"active":""}" data-save-reel="${r.id}" type="button">
            <span class="reel-action-icon">${icon("save")}</span><span>${savedNow?"محفوظ":"حفظ"}</span>
          </button>
          ${r.author_id===state.user.id?`<button class="reel-action" data-own-reel="${r.id}" data-caption="${escapeHtml(r.caption||"")}" data-comments="${r.comments_enabled!==false}" type="button"><span class="reel-action-icon">${icon("more")}</span><span>إدارة</span></button>`:""}
        </div>
        <div class="reel-progress"><span></span></div>
      </article>`;
    }).join("");

    await hydrateMedia($("#reelsFeed"));
    initReelPlayers();

    $("#reelsFeed").querySelectorAll("[data-like-reel]").forEach(b=>b.onclick=()=>toggleLike("reel",b.dataset.likeReel,b));
    $("#reelsFeed").querySelectorAll("[data-comment-reel]").forEach(b=>b.onclick=()=>openComments("reel",b.dataset.commentReel));
    $("#reelsFeed").querySelectorAll("[data-share-reel]").forEach(b=>b.onclick=()=>shareContent("reel",b.dataset.shareReel));
    $("#reelsFeed").querySelectorAll("[data-save-reel]").forEach(b=>b.onclick=()=>toggleSavedContent("reel",b.dataset.saveReel,b));
    $("#reelsFeed").querySelectorAll("[data-own-reel]").forEach(b=>b.onclick=()=>openOwnContentActions("reels",b.dataset.ownReel,b.dataset.caption,b.dataset.comments==="true"));
    $("#reelsFeed").querySelectorAll("[data-open-profile]").forEach(b=>b.onclick=()=>openPublicProfile(b.dataset.openProfile));
    $("#reelsFeed").querySelectorAll("[data-follow-reel]").forEach(b=>b.onclick=()=>followUser(b.dataset.followReel,b));
  }

  function initReelPlayers(){
    state.reelObserver?.disconnect?.();
    state.reelObserver=null;
    const reels=[...$("#reelsFeed").querySelectorAll(".reel")];
    if(!reels.length)return;

    const observer=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{
        const reel=entry.target;
        const video=reel.querySelector("video");
        if(!video)return;
        if(entry.isIntersecting && entry.intersectionRatio>.72){
          reels.forEach(other=>{
            const ov=other.querySelector("video");
            if(other!==reel && ov && !ov.paused)ov.pause();
          });
          video.play().catch(()=>{});
        }else{
          video.pause();
        }
      });
    },{root:$("#reelsFeed"),threshold:[.2,.72,.95]});
    state.reelObserver=observer;

    reels.forEach(reel=>{
      const video=reel.querySelector("video");
      const play=reel.querySelector(".reel-center-play");
      const mute=reel.querySelector(".reel-mute");
      const progress=reel.querySelector(".reel-progress span");
      if(!video)return;

      observer.observe(reel);

      const togglePlay=()=>{
        if(video.paused){
          video.play().catch(()=>{});
          play?.classList.remove("show");
        }else{
          video.pause();
          play?.classList.add("show");
        }
      };
      video.addEventListener("click",togglePlay);
      play?.addEventListener("click",togglePlay);

      mute?.addEventListener("click",e=>{
        e.stopPropagation();
        video.muted=!video.muted;
        mute.innerHTML=video.muted
          ? '<svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6L9 10Z"/><path d="m18 9 3 3-3 3"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6L9 10Z"/><path d="M18 9c1 1 1 5 0 6M20 7c3 3 3 7 0 10"/></svg>';
      });

      video.addEventListener("timeupdate",()=>{
        if(progress && Number.isFinite(video.duration) && video.duration>0){
          progress.style.width=((video.currentTime/video.duration)*100)+"%";
        }
      });

      let lastTap=0;
      video.addEventListener("pointerup",()=>{
        const now=Date.now();
        if(now-lastTap<280){
          const like=reel.querySelector("[data-like-reel]");
          like?.click();
        }
        lastTap=now;
      });
    });
  }

  async function loadConversations(){
    try{
      const list=await api("/v1/conversations");
      $("#conversationList").innerHTML=(list.items||[]).map(row=>{
        const p=row.peer_profile||{};
        return `<button class="conversation-item" data-conversation="${row.id}" data-title="${escapeHtml(row.title||"محادثة")}" type="button">
          ${p.avatar_media_id
            ? `<img class="conversation-avatar" data-media-id="${p.avatar_media_id}" alt="">`
            : `<div class="conversation-avatar" style="display:grid;place-items:center;color:var(--brand);font-weight:900">${initials(row.title||"م")}</div>`}
          <div class="conversation-main">
            <div class="conversation-title-row">
              <b>${escapeHtml(row.title||"محادثة")}</b>
              <time>${row.updated_at?new Date(row.updated_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"}):""}</time>
            </div>
            <div class="conversation-preview">${escapeHtml(row.last_message||"ابدأ المحادثة")}</div>
          </div>
        </button>`;
      }).join("")||'<div class="empty">لا توجد محادثات بعد.</div>';
      await hydrateMedia($("#conversationList"));
      $("#conversationList").querySelectorAll("[data-conversation]").forEach(b=>b.onclick=()=>openChat(b.dataset.conversation,b.dataset.title));
    }catch(e){
      $("#conversationList").innerHTML=errorMarkup(e.message,"messagesPage");
    }
  }

  async function openChat(id,title){
    state.activeConversation=id;
    $("#chatTitle").textContent=title||"المحادثة";
    openDialog($("#chatDialog"));
    await loadChat();
    clearInterval(state.chatTimer);
    state.chatTimer=setInterval(()=>{
      if($("#chatDialog").open && state.activeConversation)loadChat({quiet:true});
    },3000);
  }

  async function loadChat({quiet=false}={}){
    if(!state.activeConversation)return;
    const {data,error}=await client.from("messages")
      .select("id,sender_id,body,created_at")
      .eq("conversation_id",state.activeConversation)
      .eq("is_deleted",false)
      .order("created_at")
      .limit(150);
    if(error){
      if(!quiet)$("#chatMessages").innerHTML=`<div class="empty error">${escapeHtml(error.message)}</div>`;
      return;
    }
    const html=(data||[]).map(m=>`<div class="message-row ${m.sender_id===state.user.id?"mine":"other"}">
      <div class="bubble">${escapeHtml(m.body)}</div>
      <time>${new Date(m.created_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"})}</time>
    </div>`).join("")||'<div class="empty">ابدأ المحادثة برسالة.</div>';
    if($("#chatMessages").innerHTML!==html){
      const nearBottom=$("#chatMessages").scrollHeight-$("#chatMessages").scrollTop-$("#chatMessages").clientHeight<80;
      $("#chatMessages").innerHTML=html;
      if(nearBottom||!quiet)$("#chatMessages").scrollTop=$("#chatMessages").scrollHeight;
    }
  }

  $("#chatForm").onsubmit=async(e)=>{
    e.preventDefault();
    const body=$("#chatInput").value.trim();
    if(!body||!state.activeConversation)return;
    const submit=$("#chatForm button[type='submit']");
    submit.disabled=true;
    const {error}=await client.from("messages").insert({
      conversation_id:state.activeConversation,
      sender_id:state.user.id,
      body
    });
    submit.disabled=false;
    if(!error){
      $("#chatInput").value="";
      await loadChat();
      loadConversations();
    }
  };

  $("#closeChat").onclick=()=>{
    clearInterval(state.chatTimer);
    state.chatTimer=null;
    state.activeConversation=null;
    $("#chatDialog").close();
  };

  async function openComments(type,id){
    state.commentTarget={type,id};
    if($("#chatDialog")?.open){
      clearInterval(state.chatTimer);
      state.chatTimer=null;
      state.activeConversation=null;
    }
    openDialog($("#commentsDialog"));
    await loadComments();
  }

  async function loadComments(){
    if(!state.commentTarget)return;
    const field=state.commentTarget.type==="post"?"post_id":"reel_id";
    const {data,error}=await client.from("comments")
      .select("id,author_id,body,created_at")
      .eq(field,state.commentTarget.id)
      .order("created_at",{ascending:true})
      .limit(150);
    if(error){
      $("#commentsList").innerHTML=`<div class="empty error">${escapeHtml(error.message)}</div>`;
      return;
    }
    const profiles=await profilesMap([...new Set((data||[]).map(x=>x.author_id))]);
    $("#commentsList").innerHTML=(data||[]).map(row=>{
      const p=profiles[row.author_id]||{};
      return `<div class="comment-item">
        ${avatar(p)}
        <div class="comment-bubble">
          <div class="comment-bubble-head">
            <b>${escapeHtml(p.name||p.username||"مستخدم")}</b>
            ${p.is_verified?'<span class="verified-inline">✓</span>':""}
          </div>
          <p>${escapeHtml(row.body)}</p>
          <div class="comment-meta">${new Date(row.created_at).toLocaleString("ar-IQ")}</div>
        </div>
      </div>`;
    }).join("")||'<div class="empty">لا توجد تعليقات بعد. اكتب أول تعليق.</div>';
    await hydrateMedia($("#commentsList"));
    $("#commentsList").scrollTop=$("#commentsList").scrollHeight;
  }

  $("#commentForm").onsubmit=async(e)=>{
    e.preventDefault();
    if(!state.commentTarget)return;
    const body=$("#commentInput").value.trim();
    if(!body)return;
    const payload={
      author_id:state.user.id,
      body,
      post_id:state.commentTarget.type==="post"?state.commentTarget.id:null,
      reel_id:state.commentTarget.type==="reel"?state.commentTarget.id:null
    };
    const {error}=await client.from("comments").insert(payload);
    if(!error){
      $("#commentInput").value="";
      await loadComments();
    }
  };
  $("#closeComments").onclick=()=>$("#commentsDialog").close();

  async function loadProfile(){
    try{
      await refreshProfile();
    const [{count:posts},{count:followers},{count:following}] = await Promise.all([
      client.from("posts").select("*",{count:"exact",head:true}).eq("author_id",state.user.id),
      client.from("follows").select("*",{count:"exact",head:true}).eq("following_id",state.user.id).eq("status","accepted"),
      client.from("follows").select("*",{count:"exact",head:true}).eq("follower_id",state.user.id).eq("status","accepted")
    ]);
    const p=state.profile||{};
    const link=safeLink(p.profile_link||"");
    $("#profileCard").innerHTML=`
      <div class="profile-cover">
        ${p.cover_media_id?`<img class="cover-image" data-media-id="${p.cover_media_id}" alt="">`:""}
        <button id="profileSettingsFab" class="profile-settings-fab" aria-label="الإعدادات">${icon("settings")}</button>
      </div>
      <div class="profile-main">
        <div class="profile-avatar-wrap">${avatar(p)}</div>
        <div class="profile-info">
          <div class="profile-name-row"><h2>${escapeHtml(p.name||"مستخدم")}</h2>${p.is_verified?'<span class="verified-badge">✓</span>':""}</div>
          <div class="profile-username">@${escapeHtml(p.username||"")}</div>
          ${p.bio?`<p class="profile-bio">${escapeHtml(p.bio)}</p>`:""}
          ${link?`<a class="profile-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">${icon("link")}<span>${escapeHtml(p.profile_link)}</span></a>`:""}
          <div class="profile-stats">
            <div><b>${posts||0}</b><span>منشور</span></div>
            <div><b>${followers||0}</b><span>متابع</span></div>
            <div><b>${following||0}</b><span>يتابع</span></div>
          </div>
          <div class="profile-buttons">
            <button id="editProfileButton" class="small-button">${icon("edit")} تعديل الحساب</button>
            <button id="settingsButton" class="small-button">${icon("settings")} الإعدادات</button>
            <button id="logoutButton" class="small-button">${icon("logout")} تسجيل الخروج</button>
          </div>
        </div>
      </div>`;
    $("#logoutButton").onclick=()=>client.auth.signOut();
    $("#editProfileButton").onclick=openEditProfile;
    $("#settingsButton").onclick=openSettings;
    $("#profileSettingsFab").onclick=openSettings;
    await hydrateMedia($("#profileCard"));
    await loadProfileContent(state.profileTab);
    }catch(error){
      $("#profileCard").innerHTML=errorMarkup(error.message||"تعذر تحميل الملف الشخصي","profilePage");
      $("#profileContent").innerHTML="";
    }
  }

  async function loadProfileContent(kind="posts"){
    state.profileTab=kind;
    $$(".profile-tabs button").forEach((b,i)=>b.classList.toggle("active",(kind==="posts"&&i===0)||(kind==="reels"&&i===1)));
    if(kind==="reels"){
      const {data}=await client.from("reels").select("id,caption,media_id,created_at").eq("author_id",state.user.id).order("created_at",{ascending:false});
      $("#profileContent").innerHTML=(data||[]).map(r=>`<article class="post"><video class="post-media" controls playsinline preload="metadata" data-media-id="${r.media_id}"></video><div class="post-body">${escapeHtml(r.caption||"")}</div></article>`).join("")||'<div class="empty">لم تنشر ريلز بعد.</div>';
    }else{
      const {data}=await client.from("posts").select("id,caption,post_media(media_id,sort_order)").eq("author_id",state.user.id).order("created_at",{ascending:false});
      $("#profileContent").innerHTML=(data||[]).map(p=>`<article class="post">${p.post_media?.[0]?.media_id?`<img class="post-media" data-media-id="${p.post_media[0].media_id}">`:""}<div class="post-body">${escapeHtml(p.caption||"")}</div></article>`).join("")||'<div class="empty">لم تنشر شيئًا بعد.</div>';
    }
    await hydrateMedia($("#profileContent"));
  }

  $$(".profile-tabs button").forEach((b,i)=>b.onclick=()=>loadProfileContent(i===0?"posts":"reels"));

  async function openPublicProfile(uid){
    if(uid===state.user.id){
      $("#publicProfileDialog").close();
      navigateTo("profilePage");
      return;
    }
    const {data:p,error}=await client.from("profiles").select("id,name,username,bio,avatar_media_id,cover_media_id,profile_link,is_verified,is_private").eq("id",uid).single();
    if(error||!p)return;
    const [{count:posts},{count:followers},{count:following},{data:followRow}] = await Promise.all([
      client.from("posts").select("*",{count:"exact",head:true}).eq("author_id",uid),
      client.from("follows").select("*",{count:"exact",head:true}).eq("following_id",uid).eq("status","accepted"),
      client.from("follows").select("*",{count:"exact",head:true}).eq("follower_id",uid).eq("status","accepted"),
      client.from("follows").select("status").eq("follower_id",state.user.id).eq("following_id",uid).maybeSingle()
    ]);
    const link=safeLink(p.profile_link||"");
    const followLabel=followRow?.status==="accepted"?"تتابعه":followRow?.status==="pending"?"تم إرسال الطلب":"متابعة";
    $("#publicProfileCard").innerHTML=`
      <div class="profile-cover">${p.cover_media_id?`<img class="cover-image" data-media-id="${p.cover_media_id}" alt="">`:""}</div>
      <div class="profile-main">
        <div class="profile-avatar-wrap">${avatar(p)}</div>
        <div class="profile-info">
          <div class="profile-name-row"><h2>${escapeHtml(p.name||"مستخدم")}</h2>${p.is_verified?'<span class="verified-badge">✓</span>':""}</div>
          <div class="profile-username">@${escapeHtml(p.username||"")}</div>
          ${p.bio?`<p class="profile-bio">${escapeHtml(p.bio)}</p>`:""}
          ${link?`<a class="profile-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">${icon("link")}<span>${escapeHtml(p.profile_link)}</span></a>`:""}
          <div class="profile-stats"><div><b>${posts||0}</b><span>منشور</span></div><div><b>${followers||0}</b><span>متابع</span></div><div><b>${following||0}</b><span>يتابع</span></div></div>
          <div class="profile-actions-public">
            <button id="publicFollowButton" class="primary">${followLabel}</button>
            <button id="publicMessageButton" class="small-button">${icon("message")} مراسلة</button>
          </div>
        </div>
      </div>`;
    await hydrateMedia($("#publicProfileCard"));
    openDialog($("#publicProfileDialog"));
    $("#publicFollowButton").onclick=()=>followUser(uid,$("#publicFollowButton"));
    $("#publicMessageButton").onclick=async()=>{
      try{
        const conversation=await api("/v1/conversations",{method:"POST",body:JSON.stringify({kind:"direct",target_user_id:uid})});
        $("#publicProfileDialog").close();
        navigateTo("messagesPage");
        await openChat(conversation.id,p.name||p.username||"محادثة");
      }catch(_){}
    };
    const mayView=!p.is_private||followRow?.status==="accepted";
    if(!mayView){
      $("#publicProfileContent").innerHTML='<div class="empty">هذا الحساب خاص. تابع الحساب وانتظر الموافقة لعرض المحتوى.</div>';
    }else{
      const {data:content,error:contentError}=await client.from("posts")
        .select("id,caption,post_media(media_id,sort_order)")
        .eq("author_id",uid)
        .order("created_at",{ascending:false})
        .limit(30);
      if(contentError){
        $("#publicProfileContent").innerHTML=errorMarkup(contentError.message,"searchPage");
      }else{
        $("#publicProfileContent").innerHTML=(content||[]).map(row=>`<article class="post">${row.post_media?.[0]?.media_id?`<img class="post-media" data-media-id="${row.post_media[0].media_id}">`:""}<div class="post-body">${escapeHtml(row.caption||"")}</div></article>`).join("")||'<div class="empty">لا توجد منشورات بعد.</div>';
        await hydrateMedia($("#publicProfileContent"));
      }
    }
  }
  $("#closePublicProfile").onclick=()=>$("#publicProfileDialog").close();

  async function loadNotificationsBadge(){
    if(!state.user)return;
    const {count}=await client.from("notifications").select("*",{count:"exact",head:true}).eq("user_id",state.user.id).is("read_at",null);
    const badge=$("#notificationBadge"); badge.textContent=count||0; badge.classList.toggle("hidden",!count);
  }
  $("#notificationsButton").onclick=async()=>{
    openDialog($("#notificationsDialog"));
    $("#notificationsList").innerHTML='<div class="empty">جارٍ تحميل الإشعارات...</div>';
    const {data,error}=await client.from("notifications")
      .select("*")
      .eq("user_id",state.user.id)
      .order("created_at",{ascending:false})
      .limit(100);
    if(error){
      $("#notificationsList").innerHTML=errorMarkup(error.message,"homePage");
      return;
    }
    $("#notificationsList").innerHTML=(data||[]).map(n=>`<div class="list-card"><div class="grow"><b>${escapeHtml(n.title)}</b><div>${escapeHtml(n.body)}</div></div></div>`).join("")||'<div class="empty">لا توجد إشعارات.</div>';
    await client.from("notifications").update({read_at:new Date().toISOString()}).eq("user_id",state.user.id).is("read_at",null);
    loadNotificationsBadge().catch(()=>{});
  };
  $("#closeNotifications").onclick=()=>$("#notificationsDialog").close();

  $("#publishButton").onclick=()=>openDialog($("#publishDialog"));
  $("#closePublish").onclick=()=>$("#publishDialog").close();
  $("#publishDialog").querySelectorAll("[data-publish]").forEach(b=>b.onclick=()=>openComposer(b.dataset.publish));
  function clearComposerPreview(){
    if(state.previewUrl){
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl=null;
    }
    $("#composerPreview").innerHTML="";
    $("#composerPreview").classList.add("hidden");
    $("#composerFileMeta").textContent="";
    $("#composerFileMeta").classList.add("hidden");
  }

  function openComposer(type){
    state.composerType=type;
    $("#publishDialog").close();
    $("#composerTitle").textContent=type==="story"?"إنشاء قصة":type==="reel"?"إنشاء ريلز":"إنشاء منشور";
    $("#composerFile").accept=type==="reel"?"video/*":"image/*,video/*";
    $("#composerFile").value="";
    $("#composerCaption").value="";
    $("#composerMessage").textContent="";
    clearComposerPreview();
    openDialog($("#composerDialog"));
  }

  $("#composerFile").onchange=()=>{
    clearComposerPreview();
    const file=$("#composerFile").files[0];
    if(!file)return;
    if(state.composerType==="reel" && !file.type.startsWith("video/")){
      $("#composerFile").value="";
      $("#composerMessage").textContent="الريلز يقبل فيديو فقط";
      return;
    }
    if(!file.type.startsWith("image/") && !file.type.startsWith("video/")){
      $("#composerFile").value="";
      $("#composerMessage").textContent="نوع الملف غير مدعوم";
      return;
    }
    state.previewUrl=URL.createObjectURL(file);
    $("#composerPreview").innerHTML=file.type.startsWith("video/")
      ? `<video src="${state.previewUrl}" controls playsinline preload="metadata"></video>`
      : `<img src="${state.previewUrl}" alt="معاينة">`;
    $("#composerPreview").classList.remove("hidden");
    $("#composerFileMeta").textContent=`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`;
    $("#composerFileMeta").classList.remove("hidden");
    $("#composerMessage").textContent="";
  };

  $("#cancelComposer").onclick=()=>{
    clearComposerPreview();
    $("#composerDialog").close();
  };

  $("#submitComposer").onclick=async()=>{
    const file=$("#composerFile").files[0], caption=$("#composerCaption").value.trim();
    if(!file)return $("#composerMessage").textContent="اختر ملفًا أولًا";
    const uploadLimit=state.composerType==="story"
      ?Number(state.limits.story_mb||30)
      :file.type.startsWith("image/")
        ?Number(state.limits.image_mb||10)
        :Number(state.limits.max_upload_mb||cfg.maxUploadMb||60);
    if(file.size>uploadLimit*1024*1024)return $("#composerMessage").textContent=`الحد الأقصى ${uploadLimit} ميغابايت`;
    $("#submitComposer").disabled=true; $("#composerMessage").textContent="جارٍ الرفع...";
    try{
      const kind=state.composerType==="reel"?"reel":state.composerType==="story"?"story":file.type.startsWith("video/")?"post_video":"post_image";
      const media=await uploadFile(file,kind);
      if(state.composerType==="reel"){
        const {error}=await client.from("reels").insert({author_id:state.user.id,media_id:media.id,caption}); if(error)throw error;
      }else if(state.composerType==="story"){
        const {error}=await client.from("stories").insert({author_id:state.user.id,media_id:media.id,caption}); if(error)throw error;
      }else{
        const {data:post,error}=await client.from("posts").insert({author_id:state.user.id,caption}).select("id").single(); if(error)throw error;
        const {error:mediaErr}=await client.from("post_media").insert({post_id:post.id,media_id:media.id,sort_order:0}); if(mediaErr)throw mediaErr;
      }
      clearComposerPreview();
      $("#composerDialog").close();
      $("#composerFile").value="";
      $("#composerCaption").value="";
      await loadHome();
    }catch(e){$("#composerMessage").textContent=e.message}
    finally{$("#submitComposer").disabled=false}
  };

  async function uploadFile(file,kind){
    const token=await accessToken();
    if(!token)throw new Error("انتهت جلسة الدخول. سجّل الدخول من جديد.");
    const progress=$("#uploadProgress");
    const bar=progress?.querySelector(".progress>div");
    const progressText=$("#uploadProgressText");
    if(progress){
      progress.classList.remove("hidden");
      if(bar)bar.style.width="0%";
      if(progressText)progressText.textContent="0%";
    }

    try{
      return await new Promise((resolve,reject)=>{
        const xhr=new XMLHttpRequest();
        xhr.open("POST",apiUrl("/v1/storage/upload?kind="+encodeURIComponent(kind)));
        xhr.setRequestHeader("Authorization","Bearer "+token);
        xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream");
        xhr.setRequestHeader("X-File-Name",encodeURIComponent(file.name||"file"));

        xhr.upload.onprogress=(event)=>{
          if(event.lengthComputable && bar){
            const percent=Math.min(100,Math.round((event.loaded/event.total)*100));
            bar.style.width=percent+"%";
            if(progressText)progressText.textContent=percent+"%";
          }
        };
        xhr.onerror=()=>reject(new Error("تعذر الاتصال بخادم الرفع"));
        xhr.onabort=()=>reject(new Error("تم إلغاء الرفع"));
        xhr.onload=()=>{
          let body={};
          try{body=JSON.parse(xhr.responseText||"{}")}catch{}
          if(xhr.status>=200&&xhr.status<300)resolve(body);
          else reject(new Error(body.error||"فشل رفع الملف"));
        };
        xhr.send(file);
      });
    }finally{
      if(bar)bar.style.width="100%";
      if(progressText)progressText.textContent="100%";
      setTimeout(()=>progress?.classList.add("hidden"),450);
    }
  }

  $("#newMessageButton").onclick=()=>{
    $("#newConversationUsername").value="";
    $("#newConversationResult").innerHTML="";
    openDialog($("#newConversationDialog"));
  };
  $("#closeNewConversation").onclick=()=>$("#newConversationDialog").close();

  $("#findConversationUser").onclick=async()=>{
    const username=$("#newConversationUsername").value.trim().toLowerCase();
    if(!username){
      $("#newConversationResult").innerHTML='<div class="empty">اكتب اسم المستخدم.</div>';
      return;
    }
    const {data,error}=await client.from("profiles")
      .select("id,name,username,avatar_media_id,is_verified")
      .eq("username",username)
      .neq("id",state.user.id)
      .limit(1);
    if(error||!data?.length){
      $("#newConversationResult").innerHTML='<div class="empty">لم يتم العثور على الحساب.</div>';
      return;
    }
    const p=data[0];
    $("#newConversationResult").innerHTML=`<div class="list-card">${avatar(p)}<div class="grow"><b>${escapeHtml(p.name||"مستخدم")}</b><div>@${escapeHtml(p.username||"")}</div></div><button class="small-button" data-start-chat="${p.id}">بدء المحادثة</button></div>`;
    await hydrateMedia($("#newConversationResult"));
    $("#newConversationResult").querySelector("[data-start-chat]").onclick=async()=>{
      try{
        const conversation=await api("/v1/conversations",{
          method:"POST",
          body:JSON.stringify({kind:"direct",target_user_id:p.id})
        });
        $("#newConversationDialog").close();
        await loadConversations();
        await openChat(conversation.id,p.name||p.username||"محادثة");
      }catch(error){
        $("#newConversationResult").innerHTML=`<div class="empty error">${escapeHtml(error.message)}</div>`;
      }
    };
  };

  function openEditProfile(){
    $("#editName").value=state.profile?.name||"";
    $("#editUsername").value=state.profile?.username||"";
    $("#editBio").value=state.profile?.bio||"";
    $("#editProfileLink").value=state.profile?.profile_link||"";
    $("#editPrivate").checked=!!state.profile?.is_private;
    $("#editAvatarFile").value="";
    $("#editCoverFile").value="";
    $("#editProfileMessage").textContent="";
    openDialog($("#editProfileDialog"));
  }
  $("#closeEditProfile").onclick=()=>$("#editProfileDialog").close();
  $("#editProfileForm").onsubmit=async(e)=>{
    e.preventDefault();
    const name=$("#editName").value.trim();
    const username=$("#editUsername").value.trim().toLowerCase();
    const bio=$("#editBio").value.trim();
    const profileLink=$("#editProfileLink").value.trim();
    if(!name)return;
    if(!/^[a-z0-9_]{3,24}$/.test(username)){
      $("#editProfileMessage").textContent="اسم المستخدم غير صالح";
      return;
    }
    $("#editProfileMessage").textContent="جارٍ الحفظ...";
    try{
      let avatarMediaId=state.profile?.avatar_media_id||null;
      let coverMediaId=state.profile?.cover_media_id||null;
      const file=$("#editAvatarFile").files[0];
      const coverFile=$("#editCoverFile").files[0];
      if(file){
        if(file.size>10*1024*1024)throw new Error("صورة الحساب يجب ألا تتجاوز 10 ميغابايت");
        const media=await uploadFile(file,"profile");
        avatarMediaId=media.id;
      }
      if(coverFile){
        if(coverFile.size>10*1024*1024)throw new Error("صورة الغلاف يجب ألا تتجاوز 10 ميغابايت");
        const media=await uploadFile(coverFile,"profile_cover");
        coverMediaId=media.id;
      }
      const {error}=await client.from("profiles").update({
        name,
        username,
        bio,
        profile_link:profileLink,
        is_private:$("#editPrivate").checked,
        avatar_media_id:avatarMediaId,
        cover_media_id:coverMediaId,
        updated_at:new Date().toISOString()
      }).eq("id",state.user.id);
      if(error)throw error;
      await refreshProfile();
      $("#editProfileDialog").close();
      await loadProfile();
    }catch(error){
      $("#editProfileMessage").textContent=error.message;
    }
  };

  async function openSettings(){
    openDialog($("#settingsDialog"));
    try{
      const {data,error}=await client.from("notification_preferences")
        .select("*").eq("user_id",state.user.id).maybeSingle();
      if(error)throw error;
      const p=data||{};
      $("#notifyMessages").checked=p.messages!==false;
      $("#notifyGroups").checked=p.groups!==false;
      $("#notifyLikes").checked=p.likes!==false;
      $("#notifyComments").checked=p.comments!==false;
      $("#notifyFollows").checked=p.follows!==false;
      $("#notifyStories").checked=p.stories!==false;
      $("#notifySystem").checked=p.system!==false;
      $("#notifyPreview").checked=p.preview_message!==false;
      await loadFollowRequests();
    }catch(error){
      $("#followRequestsList").innerHTML='<div class="empty error">تعذر تحميل بعض الإعدادات.</div>';
    }
  }
  $("#closeSettings").onclick=()=>$("#settingsDialog").close();
  $("#settingsLogoutButton").onclick=async()=>{
    $("#settingsLogoutButton").disabled=true;
    await client.auth.signOut();
    $("#settingsLogoutButton").disabled=false;
    $("#settingsDialog").close();
  };
  $("#settingsEditProfile").onclick=()=>{
    $("#settingsDialog").close();
    openEditProfile();
  };

  function openInfoDialog(title,html){
    $("#infoDialogTitle").textContent=title;
    $("#infoDialogBody").innerHTML=html;
    $("#settingsDialog").close();
    openDialog($("#infoDialog"));
  }
  $("#closeInfoDialog").onclick=()=>$("#infoDialog").close();

  $("#blockedAccountsButton").onclick=async()=>{
    const {data,error}=await client.from("blocks")
      .select("blocked_id,created_at")
      .eq("blocker_id",state.user.id)
      .order("created_at",{ascending:false});
    if(error){
      return openInfoDialog("الحسابات المحظورة",'<div class="empty error">تعذر تحميل القائمة.</div>');
    }
    const profiles=await profilesMap((data||[]).map(x=>x.blocked_id));
    const html=(data||[]).map(row=>{
      const p=profiles[row.blocked_id]||{};
      return `<div class="list-card">
        ${avatar(p)}
        <div class="grow"><b>${escapeHtml(p.name||"مستخدم")}</b><div>@${escapeHtml(p.username||"")}</div></div>
        <button class="small-button" data-unblock="${row.blocked_id}" type="button">رفع الحظر</button>
      </div>`;
    }).join("")||'<div class="empty">لا توجد حسابات محظورة.</div>';
    openInfoDialog("الحسابات المحظورة",`<div id="blockedList" class="list compact">${html}</div>`);
    await hydrateMedia($("#infoDialogBody"));
    $("#infoDialogBody").querySelectorAll("[data-unblock]").forEach(btn=>btn.onclick=async()=>{
      const {error:removeError}=await client.from("blocks")
        .delete()
        .eq("blocker_id",state.user.id)
        .eq("blocked_id",btn.dataset.unblock);
      if(!removeError)btn.closest(".list-card")?.remove();
    });
  };

  $("#securitySessionsButton").onclick=()=>{
    const email=state.user?.email||"غير متوفر";
    openInfoDialog("الأمان والجلسات",`
      <div class="settings-info">
        <div class="info-row"><span>البريد الحالي</span><b>${escapeHtml(email)}</b></div>
        <div class="info-row"><span>حالة الجلسة</span><b>نشطة</b></div>
        <button id="globalSignOutButton" class="danger-wide" type="button">تسجيل الخروج من جميع الأجهزة</button>
      </div>`);
    $("#globalSignOutButton").onclick=async()=>{
      $("#globalSignOutButton").disabled=true;
      await client.auth.signOut({scope:"global"});
      $("#infoDialog").close();
    };
  };

  $("#helpButton").onclick=()=>{
    openInfoDialog("المساعدة",`
      <div class="settings-info help-copy">
        <h4>استخدام آشور</h4>
        <p>من زر الإضافة بالأعلى تقدر تنشر منشور أو قصة أو ريلز. من البحث تقدر تختار الحسابات أو المنشورات أو الريلز. ومن الرسائل تقدر تبدأ محادثة باسم المستخدم.</p>
        <h4>إذا ما ظهر المحتوى</h4>
        <p>تأكد من اتصال الإنترنت، ثم ارجع للرئيسية وأعد فتح القسم. التطبيق يعرض رسالة واضحة إذا تعذر الاتصال بالخدمة.</p>
      </div>`);
  };

  $("#aboutButton").onclick=()=>{
    openInfoDialog("حول آشور",`
      <div class="settings-info about-card">
        <img src="./assets/logo.svg" class="about-logo" alt="آشور">
        <h3>آشور</h3>
        <p>منصة اجتماعية عربية.</p>
        <div class="info-row"><span>الإصدار</span><b>${escapeHtml(cfg.appVersion||"")}</b></div>
      </div>`);
  };

  $("#notificationSettingsForm").onsubmit=async(e)=>{
    e.preventDefault();
    const {error}=await client.from("notification_preferences").upsert({
      user_id:state.user.id,
      messages:$("#notifyMessages").checked,
      groups:$("#notifyGroups").checked,
      likes:$("#notifyLikes").checked,
      comments:$("#notifyComments").checked,
      follows:$("#notifyFollows").checked,
      stories:$("#notifyStories").checked,
      system:$("#notifySystem").checked,
      preview_message:$("#notifyPreview").checked,
      updated_at:new Date().toISOString()
    },{onConflict:"user_id"});
    if(!error) $("#settingsDialog").close();
  };

  async function loadFollowRequests(){
    const {data,error}=await client.from("follows")
      .select("follower_id,created_at")
      .eq("following_id",state.user.id)
      .eq("status","pending")
      .order("created_at",{ascending:false});
    if(error){
      $("#followRequestsList").innerHTML='<div class="empty">تعذر تحميل الطلبات.</div>';
      return;
    }
    const ps=await profilesMap((data||[]).map(x=>x.follower_id));
    $("#followRequestsList").innerHTML=(data||[]).map(row=>{
      const p=ps[row.follower_id]||{};
      return `<div class="list-card">${avatar(p)}<div class="grow"><b>${escapeHtml(p.name||"مستخدم")}</b><div>@${escapeHtml(p.username||"")}</div></div><button class="small-button" data-accept-follow="${row.follower_id}">قبول</button><button class="small-button" data-reject-follow="${row.follower_id}">رفض</button></div>`;
    }).join("")||'<div class="empty">لا توجد طلبات متابعة.</div>';
    await hydrateMedia($("#followRequestsList"));
    $("#followRequestsList").querySelectorAll("[data-accept-follow]").forEach(b=>b.onclick=async()=>{
      await client.from("follows").update({status:"accepted"}).eq("follower_id",b.dataset.acceptFollow).eq("following_id",state.user.id);
      loadFollowRequests();
    });
    $("#followRequestsList").querySelectorAll("[data-reject-follow]").forEach(b=>b.onclick=async()=>{
      await client.from("follows").delete().eq("follower_id",b.dataset.rejectFollow).eq("following_id",state.user.id);
      loadFollowRequests();
    });
  }


  document.addEventListener("click",e=>{
    const link=e.target.closest?.("a[href]");
    if(!link)return;
    const href=link.href||"";
    if(/^https?:\/\//i.test(href) && window.AshurNative?.openExternal){
      e.preventDefault();
      try{window.AshurNative.openExternal(href)}catch(_){}
    }
  });

  window.ASHUR_HANDLE_BACK=()=>{
    const openDialogs=[...document.querySelectorAll("dialog[open]")];
    if(openDialogs.length){
      const dialog=openDialogs[openDialogs.length-1];
      if(dialog.id==="systemDialog" && dialog.dataset.blocking==="1")return true;
      if(dialog.id==="chatDialog"){
        clearInterval(state.chatTimer);
        state.chatTimer=null;
        state.activeConversation=null;
      }
      dialog.close();
      return true;
    }
    const active=$(".page.active");
    if(active && active.id!=="homePage"){
      navigateTo("homePage");
      return true;
    }
    return false;
  };

  boot().catch(e=>{
    console.error("ASHUR_BOOT_ERROR",e);
    $("#splash")?.remove();
    showApp(false);
    showAuthMessage("تعذر بدء التطبيق. تحقق من الإنترنت ثم حاول مرة أخرى.");
  });
})();
