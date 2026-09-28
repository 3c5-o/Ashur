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
    storyTimer:null,
    activePage:"homePage",
    pageHistory:[],
    publicProfileTab:"posts",
    returnPublicProfileId:null,
    previewUrl:null,
    previewUrls:[],
    chatPreviewUrl:null,
    commentReply:null,
    currentPublicProfile:null,
    activeUpload:null,
    activeUploadId:null,
    feedOffset:0,
    feedLoading:false,
    feedDone:false,
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
      report:'<path d="M5 21V4m0 1h12l-2 4 2 4H5"/>',
      lock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
      play:'<path d="M8 5v14l11-7Z"/>'
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
            const coverMode=node.dataset.profileCover==="1";
            video.className=node.className;
            video.dataset.mediaId=node.dataset.mediaId;
            video.dataset.mediaReady="1";
            if(coverMode)video.dataset.videoCover="1";
            video.src=access.url+(coverMode?"#t=0.12":"");
            video.controls=!coverMode;
            video.muted=coverMode;
            video.playsInline=true;
            video.preload="metadata";
            node.replaceWith(video);
          }else if(access.mime_type?.startsWith("audio/") && node.tagName==="IMG"){
            const audio=document.createElement("audio");
            audio.className=(node.className+" chat-audio").trim();
            audio.dataset.mediaId=node.dataset.mediaId;
            audio.dataset.mediaReady="1";
            audio.src=access.url;
            audio.controls=true;
            audio.preload="metadata";
            node.replaceWith(audio);
          }else if(node.tagName==="IMG" && access.mime_type && !access.mime_type.startsWith("image/")){
            const link=document.createElement("a");
            link.className="chat-file-link";
            link.dataset.mediaReady="1";
            link.href=access.url;
            link.target="_blank";
            link.rel="noopener";
            link.textContent=access.original_name||"فتح الملف";
            node.replaceWith(link);
          }else{
            const coverMode=node.dataset.videoCover==="1";
            node.src=access.url+(coverMode?"#t=0.12":"");
            if(coverMode && node.tagName==="VIDEO"){
              node.muted=true;
              node.controls=false;
              node.playsInline=true;
              node.preload="metadata";
            }
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

  function prepareVideoCovers(root=document){
    root.querySelectorAll('video[data-video-cover="1"]').forEach(video=>{
      const showFrame=()=>{
        try{
          video.pause();
          if(Number.isFinite(video.duration)&&video.duration>0&&video.currentTime<0.08){
            video.currentTime=Math.min(0.12,Math.max(0.01,video.duration/20));
          }
        }catch(_){}
        video.classList.add("frame-ready");
      };
      if(video.readyState>=2)showFrame();
      else{
        video.addEventListener("loadeddata",showFrame,{once:true});
        video.addEventListener("seeked",()=>video.classList.add("frame-ready"),{once:true});
      }
    });
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

  function enterPasswordRecoveryMode(message="اكتب كلمة المرور الجديدة للحساب."){
    showApp(false);
    $("#loginForm").classList.add("hidden");
    $("#registerForm").classList.add("hidden");
    $("#passwordRecoveryForm").classList.remove("hidden");
    $(".auth-tabs").classList.add("hidden");
    showAuthMessage(message,true);
  }

  window.ASHUR_HANDLE_AUTH_LINK=async(link)=>{
    try{
      const url=new URL(String(link||""));
      let authenticated=false;
      const code=url.searchParams.get("code");
      if(code){
        const result=await client.auth.exchangeCodeForSession(code);
        if(result.error)throw result.error;
        authenticated=true;
      }else{
        const hash=new URLSearchParams(String(url.hash||"").replace(/^#/,""));
        const accessToken=hash.get("access_token");
        const refreshToken=hash.get("refresh_token");
        if(accessToken&&refreshToken){
          const result=await client.auth.setSession({access_token:accessToken,refresh_token:refreshToken});
          if(result.error)throw result.error;
          authenticated=true;
        }
      }
      if(!authenticated)throw new Error("رابط الاستعادة غير مكتمل أو منتهي.");
      enterPasswordRecoveryMode();
      return true;
    }catch(error){
      showApp(false);
      showAuthMessage(error?.message||"تعذر فتح رابط استعادة كلمة المرور.");
      return false;
    }
  };

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
    setFeature("searchPage","search");
    $("#publishButton").classList.toggle("hidden",state.features.uploads===false);
    $("#notificationsButton").classList.toggle("hidden",state.features.notifications===false);
    $("#savedContentButton")?.classList.toggle("hidden",state.features.saved===false);
    $("#supportTicketsButton")?.classList.toggle("hidden",state.features.support===false);
    $("#registerTab").classList.toggle("hidden",state.features.registration===false);
    $(".home-intro").classList.toggle("stories-disabled",state.features.stories===false);
    document.body.classList.toggle("comments-disabled",state.features.comments===false);

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
      enterPasswordRecoveryMode();
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

  function updateTopbarContext(page){
    const topbar=$(".topbar");
    if(!topbar)return;
    topbar.classList.toggle("home-context",page==="homePage");
  }

  async function navigateTo(page,{fromBack=false,replace=false}={}){
    if(!document.getElementById(page))page="homePage";
    const previous=state.activePage||$(".page.active")?.id||"homePage";
    if(!fromBack && !replace && previous!==page){
      state.pageHistory.push(previous);
      if(state.pageHistory.length>20)state.pageHistory.shift();
    }
    closeTransientDialogs();
    state.activePage=page;
    updateTopbarContext(page);
    $(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
    $(".page").forEach(x=>x.classList.toggle("active",x.id===page));
    if(page!=="reelsPage"){
      $("#reelsFeed")?.querySelectorAll("video").forEach(video=>video.pause());
      state.reelObserver?.disconnect?.();
      state.reelObserver=null;
    }
    if(page==="searchPage")await loadExplore();
    if(page==="reelsPage")await loadReels();
    if(page==="messagesPage")await loadConversations();
    if(page==="profilePage")await loadProfile();
    window.scrollTo({top:0,behavior:fromBack?"auto":"smooth"});
  }
  $(".nav-item").forEach(btn=>btn.onclick=()=>navigateTo(btn.dataset.page));
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

  function closeStoryViewer(){
    clearTimeout(state.storyTimer);
    state.storyTimer=null;
    const video=$("#storyViewerMedia")?.querySelector("video");
    if(video)video.pause();
    if($("#storyViewerDialog").open)$("#storyViewerDialog").close();
  }

  async function openStoryViewers(storyId){
    closeStoryViewer();
    openInfoDialog("مشاهدو القصة",'<div id="storyViewersList" class="list compact"><div class="empty">جارٍ التحميل...</div></div>');
    try{
      const result=await api("/v1/social/story-viewers/"+encodeURIComponent(storyId));
      $("#storyViewersList").innerHTML=(result.items||[]).map(p=>
        '<button class="list-card" data-story-viewer-profile="'+escapeHtml(p.id)+'" type="button">'+
          avatar(p)+'<span class="grow"><b>'+escapeHtml(p.name||"مستخدم")+'</b><small>@'+escapeHtml(p.username||"")+'</small></span>'+
          '<time>'+new Date(p.viewed_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"})+'</time>'+
        '</button>'
      ).join("")||'<div class="empty">ماكو مشاهدات بعد.</div>';
      await hydrateMedia($("#storyViewersList"));
      $("#storyViewersList").querySelectorAll("[data-story-viewer-profile]").forEach(btn=>btn.onclick=()=>{
        const uid=btn.dataset.storyViewerProfile;
        $("#infoDialog").close();
        openPublicProfile(uid);
      });
    }catch(error){
      $("#storyViewersList").innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
    }
  }

  async function openStoryViewer(id){
    const story=state.stories.get(id);
    if(!story)return;
    clearTimeout(state.storyTimer);
    const dialog=$("#storyViewerDialog");
    const user=$("#storyViewerUser");
    const own=story.author_id===state.user.id;
    user.innerHTML=avatar(story.profile)+'<span>'+escapeHtml(story.profile?.name||story.profile?.username||"مستخدم")+'</span>';
    $("#storyViewerCaption").textContent=story.caption||"";
    $("#storyViewerMedia").innerHTML='<div class="empty">جارٍ تحميل القصة...</div>';
    $("#storyProgressBar").style.transition="none";
    $("#storyProgressBar").style.width="0%";
    $("#storyViewerActions").innerHTML=own
      ?'<button id="storyViewersButton" type="button">المشاهدات</button><button id="manageStoryButton" type="button">إدارة القصة</button>'
      :'<button id="replyStoryButton" type="button">رد برسالة</button><button id="reportStoryButton" type="button">إبلاغ</button>';
    openDialog(dialog);
    await hydrateMedia(user);

    if(!own){
      api("/v1/social/story-view/"+encodeURIComponent(id),{method:"POST"}).catch(()=>{});
      $("#replyStoryButton").onclick=async()=>{
        try{
          const conversation=await api("/v1/conversations",{method:"POST",body:JSON.stringify({kind:"direct",target_user_id:story.author_id})});
          closeStoryViewer();
          await navigateTo("messagesPage");
          await openChat(conversation.id,story.profile?.name||story.profile?.username||"محادثة");
          $("#chatInput").value="رد على قصتك: ";
          $("#chatInput").focus();
        }catch(error){alert(error.message)}
      };
      $("#reportStoryButton").onclick=()=>{
        closeStoryViewer();
        openReportDialog("story",id);
      };
    }else{
      $("#storyViewersButton").onclick=()=>openStoryViewers(id);
      $("#manageStoryButton").onclick=()=>{
        closeStoryViewer();
        openOwnContentActions("stories",id,story.caption||"",true);
      };
    }

    try{
      const access=await mediaAccess(story.media_id);
      if(access.mime_type?.startsWith("video/")){
        const video=document.createElement("video");
        video.src=access.url;
        video.autoplay=true;
        video.playsInline=true;
        video.preload="auto";
        video.muted=false;
        $("#storyViewerMedia").innerHTML="";
        $("#storyViewerMedia").appendChild(video);
        video.addEventListener("timeupdate",()=>{
          if(Number.isFinite(video.duration)&&video.duration>0){
            $("#storyProgressBar").style.transition="none";
            $("#storyProgressBar").style.width=Math.min(100,(video.currentTime/video.duration)*100)+"%";
          }
        });
        video.addEventListener("ended",closeStoryViewer,{once:true});
        video.play().catch(()=>{});
      }else{
        const img=document.createElement("img");
        img.src=access.url;
        img.alt="";
        $("#storyViewerMedia").innerHTML="";
        $("#storyViewerMedia").appendChild(img);
        requestAnimationFrame(()=>{
          $("#storyProgressBar").style.transition="width 6s linear";
          $("#storyProgressBar").style.width="100%";
        });
        state.storyTimer=setTimeout(closeStoryViewer,6000);
      }
    }catch{
      $("#storyViewerMedia").innerHTML='<div class="empty error">تعذر تحميل القصة.</div>';
    }
  }
  $("#closeStoryViewer").onclick=closeStoryViewer;
  $("#storyViewerDialog").addEventListener("cancel",e=>{
    e.preventDefault();
    closeStoryViewer();
  });

  function postMediaMarkup(rows=[],className="post-media"){
    const sorted=[...(rows||[])].sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
    if(!sorted.length)return "";
    if(sorted.length===1){
      return `<img class="${className}" loading="lazy" data-media-id="${escapeHtml(sorted[0].media_id)}" alt="">`;
    }
    return `<div class="post-media-strip" aria-label="${sorted.length} وسائط">${sorted.map((row,index)=>
      `<div class="post-media-slide"><img class="${className}" loading="lazy" data-media-id="${escapeHtml(row.media_id)}" alt=""><span class="media-counter">${index+1}/${sorted.length}</span></div>`
    ).join("")}</div>`;
  }

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

  function openReportDialog(targetType,targetId){
    openInfoDialog("إرسال بلاغ",`
      <div class="form settings-info">
        <label><span>سبب البلاغ</span>
          <select id="reportReason">
            <option value="spam">محتوى مزعج أو متكرر</option>
            <option value="harassment">إساءة أو مضايقة</option>
            <option value="impersonation">انتحال شخصية</option>
            <option value="inappropriate">محتوى غير مناسب</option>
            <option value="other">سبب آخر</option>
          </select>
        </label>
        <label><span>تفاصيل إضافية</span><textarea id="reportDetails" maxlength="1500" placeholder="اكتب التفاصيل التي تساعد الإدارة على المراجعة"></textarea></label>
        <button id="submitReportButton" class="primary" type="button">إرسال البلاغ</button>
        <p id="reportMessage" class="message"></p>
      </div>`);
    $("#submitReportButton").onclick=async()=>{
      $("#submitReportButton").disabled=true;
      try{
        await api("/v1/social/report",{
          method:"POST",
          body:JSON.stringify({
            target_type:targetType,
            target_id:targetId,
            reason:$("#reportReason").value,
            details:$("#reportDetails").value.trim()
          })
        });
        $("#reportMessage").textContent="تم إرسال البلاغ للإدارة.";
        setTimeout(()=>$("#infoDialog").close(),650);
      }catch(error){
        $("#reportMessage").textContent=error.message;
        $("#submitReportButton").disabled=false;
      }
    };
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

  async function loadFeed({append=false}={}){
    if(state.feedLoading)return;
    state.feedLoading=true;
    if(!append){
      state.feedOffset=0;
      state.feedDone=false;
    }
    const start=append?state.feedOffset:0;
    const pageSize=20;
    const {data,error}=await client.from("posts")
      .select("id,author_id,caption,created_at,comments_enabled,post_media(media_id,sort_order)")
      .order("created_at",{ascending:false})
      .range(start,start+pageSize-1);
    if(error){
      if(!append)$("#feed").innerHTML=errorMarkup(error.message,"homePage");
      state.feedLoading=false;
      return;
    }
    if(!data?.length){
      if(!append)$("#feed").innerHTML='<div class="empty">لا توجد منشورات بعد. كن أول من يشارك شيئًا.</div>';
      state.feedDone=true;
      state.feedLoading=false;
      return;
    }
    state.feedOffset=start+data.length;
    state.feedDone=data.length<pageSize;

    const postIds=data.map(x=>x.id);
    const [profiles,{data:liked},{data:saved}] = await Promise.all([
      profilesMap([...new Set(data.map(x=>x.author_id))]),
      client.from("post_likes").select("post_id").eq("user_id",state.user.id).in("post_id",postIds),
      client.from("saved_posts").select("post_id").eq("user_id",state.user.id).in("post_id",postIds)
    ]);
    const likedSet=new Set((liked||[]).map(x=>x.post_id));
    const savedSet=new Set((saved||[]).map(x=>x.post_id));

    const chunk=data.map(post=>{
      const p=profiles[post.author_id]||{};
      const mediaHtml=postMediaMarkup(post.post_media||[]);
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
        ${mediaHtml}
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
    if(append){
      $("#feedLoadMore")?.remove();
      $("#feed").insertAdjacentHTML("beforeend",chunk);
    }else{
      $("#feed").innerHTML=chunk;
    }
    if(!state.feedDone){
      $("#feed").insertAdjacentHTML("beforeend",'<button id="feedLoadMore" class="secondary-wide feed-load-more" type="button">تحميل المزيد</button>');
      $("#feedLoadMore").onclick=()=>loadFeed({append:true});
    }

    await hydrateMedia($("#feed"));
    $("#feed").querySelectorAll("[data-like-post]").forEach(b=>b.onclick=()=>toggleLike("post",b.dataset.likePost,b));
    $("#feed").querySelectorAll("[data-comment-post]").forEach(b=>b.onclick=()=>openComments("post",b.dataset.commentPost));
    $("#feed").querySelectorAll("[data-share-post]").forEach(b=>b.onclick=()=>shareContent("post",b.dataset.sharePost));
    $("#feed").querySelectorAll("[data-save-post]").forEach(b=>b.onclick=()=>toggleSavedContent("post",b.dataset.savePost,b));
    $("#feed").querySelectorAll("[data-own-post]").forEach(b=>b.onclick=()=>openOwnContentActions("posts",b.dataset.ownPost,b.dataset.caption,b.dataset.comments==="true"));
    $("#feed").querySelectorAll("[data-open-profile]").forEach(b=>b.onclick=()=>openPublicProfile(b.dataset.openProfile));
    state.feedLoading=false;
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
      const query=($("#messagesSearchInput")?.value||"").trim().toLowerCase();
      const items=(list.items||[]).filter(row=>{
        if(!query)return true;
        return String(row.title||"").toLowerCase().includes(query) ||
          String(row.last_message||"").toLowerCase().includes(query);
      });
      $("#conversationList").innerHTML=items.map(row=>{
        const p=row.peer_profile||{};
        const avatarHtml=p.avatar_media_id
          ? '<img class="conversation-avatar" data-media-id="'+escapeHtml(p.avatar_media_id)+'" alt="">'
          : '<div class="conversation-avatar" style="display:grid;place-items:center;color:var(--brand);font-weight:900">'+initials(row.title||"م")+'</div>';
        const unread=row.unread_count?'<span class="conversation-unread">'+Number(row.unread_count||0)+'</span>':"";
        const updated=row.updated_at?new Date(row.updated_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"}):"";
        return '<button class="conversation-item" data-conversation="'+escapeHtml(row.id)+'" data-title="'+escapeHtml(row.title||"محادثة")+'" type="button">'+
          avatarHtml+
          '<div class="conversation-main"><div class="conversation-title-row"><b>'+escapeHtml(row.title||"محادثة")+unread+'</b><time>'+updated+'</time></div>'+
          '<div class="conversation-preview">'+escapeHtml(row.last_message||"ابدأ المحادثة")+'</div></div></button>';
      }).join("")||'<div class="empty">لا توجد محادثات مطابقة.</div>';
      await hydrateMedia($("#conversationList"));
      $("#conversationList").querySelectorAll("[data-conversation]").forEach(b=>b.onclick=()=>openChat(b.dataset.conversation,b.dataset.title));
    }catch(e){
      $("#conversationList").innerHTML=errorMarkup(e.message,"messagesPage");
    }
  }

  function closeChatRealtime(){
    clearInterval(state.chatTimer);
    state.chatTimer=null;
    if(state.chatChannel){
      try{client.removeChannel(state.chatChannel)}catch(_){try{state.chatChannel.unsubscribe?.()}catch(__){}}
      state.chatChannel=null;
    }
  }

  function subscribeChatRealtime(){
    closeChatRealtime();
    if(!state.activeConversation)return;
    const conversationId=state.activeConversation;
    state.chatChannel=client.channel("ashur-chat-"+conversationId)
      .on("postgres_changes",{
        event:"*",
        schema:"public",
        table:"messages",
        filter:"conversation_id=eq."+conversationId
      },()=>loadChat({quiet:true}))
      .on("postgres_changes",{
        event:"*",
        schema:"public",
        table:"message_reads"
      },()=>loadChat({quiet:true,markRead:false}))
      .subscribe(status=>{
        if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){
          clearInterval(state.chatTimer);
          state.chatTimer=setInterval(()=>{
            if($("#chatDialog").open&&state.activeConversation)loadChat({quiet:true});
          },8000);
        }
      });
  }

  async function openChat(id,title){
    state.activeConversation=id;
    $("#chatTitle").textContent=title||"المحادثة";
    clearChatAttachment();
    openDialog($("#chatDialog"));
    await loadChat();
    subscribeChatRealtime();
  }

  async function loadChat({quiet=false,markRead=true}={}){
    if(!state.activeConversation)return;
    const conversationId=state.activeConversation;
    const {data,error}=await client.from("messages")
      .select("id,sender_id,body,media_id,reply_to,created_at")
      .eq("conversation_id",conversationId)
      .eq("is_deleted",false)
      .order("created_at")
      .limit(200);
    if(error){
      if(!quiet)$("#chatMessages").innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
      return;
    }
    if(conversationId!==state.activeConversation)return;

    const ownIds=(data||[]).filter(m=>m.sender_id===state.user.id).map(m=>m.id);
    const otherUnread=(data||[]).filter(m=>m.sender_id!==state.user.id).map(m=>m.id);
    let readSet=new Set();
    if(ownIds.length){
      const {data:reads}=await client.from("message_reads")
        .select("message_id,user_id")
        .in("message_id",ownIds);
      readSet=new Set((reads||[]).filter(r=>r.user_id!==state.user.id).map(r=>r.message_id));
    }

    const byId=new Map((data||[]).map(m=>[m.id,m]));
    const html=(data||[]).map(m=>{
      const parent=m.reply_to?byId.get(m.reply_to):null;
      const media=m.media_id?'<img class="chat-media" data-media-id="'+escapeHtml(m.media_id)+'" alt="مرفق">':"";
      const body=m.body?'<div>'+escapeHtml(m.body)+'</div>':"";
      const parentHtml=parent?'<div class="comment-parent">'+escapeHtml(parent.body||"مرفق")+'</div>':"";
      const read=m.sender_id===state.user.id&&readSet.has(m.id)?'<span class="message-read">تمت القراءة</span>':"";
      return '<div class="message-row '+(m.sender_id===state.user.id?"mine":"other")+'"><div class="bubble">'+parentHtml+media+body+
        '</div><time>'+new Date(m.created_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"})+'</time>'+read+'</div>';
    }).join("")||'<div class="empty">ابدأ المحادثة برسالة.</div>';

    const nearBottom=$("#chatMessages").scrollHeight-$("#chatMessages").scrollTop-$("#chatMessages").clientHeight<80;
    if($("#chatMessages").innerHTML!==html){
      $("#chatMessages").innerHTML=html;
      await hydrateMedia($("#chatMessages"));
      if(nearBottom||!quiet)$("#chatMessages").scrollTop=$("#chatMessages").scrollHeight;
    }

    if(markRead&&otherUnread.length){
      api("/v1/social/message-read",{
        method:"POST",
        body:JSON.stringify({message_ids:otherUnread})
      }).catch(()=>{});
    }
  }

  function clearChatAttachment(){
    if(state.chatPreviewUrl){
      URL.revokeObjectURL(state.chatPreviewUrl);
      state.chatPreviewUrl=null;
    }
    if($("#chatFile"))$("#chatFile").value="";
    if($("#chatAttachmentPreview")){
      $("#chatAttachmentPreview").innerHTML="";
      $("#chatAttachmentPreview").classList.add("hidden");
    }
  }

  $("#chatFile").onchange=()=>{
    const file=$("#chatFile").files[0];
    if(state.chatPreviewUrl){
      URL.revokeObjectURL(state.chatPreviewUrl);
      state.chatPreviewUrl=null;
    }
    $("#chatAttachmentPreview").innerHTML="";
    $("#chatAttachmentPreview").classList.add("hidden");
    if(!file)return;
    const max=Number(state.limits.chat_video_mb||50)*1024*1024;
    if(file.size>max){
      $("#chatAttachmentPreview").textContent="الملف أكبر من الحد المسموح.";
      $("#chatAttachmentPreview").classList.remove("hidden");
      $("#chatFile").value="";
      return;
    }
    state.chatPreviewUrl=URL.createObjectURL(file);
    const preview=file.type.startsWith("image/")
      ?'<img src="'+state.chatPreviewUrl+'" alt="">'
      :file.type.startsWith("video/")
        ?'<video src="'+state.chatPreviewUrl+'" muted playsinline></video>'
        :'<span>'+escapeHtml(file.name)+'</span>';
    $("#chatAttachmentPreview").innerHTML=preview+'<div class="grow"><b>'+escapeHtml(file.name)+'</b><small>'+((file.size/1024/1024).toFixed(1))+' MB</small></div><button id="removeChatAttachment" class="small-button" type="button">إزالة</button>';
    $("#chatAttachmentPreview").classList.remove("hidden");
    $("#removeChatAttachment").onclick=clearChatAttachment;
  };

  $("#chatForm").onsubmit=async(e)=>{
    e.preventDefault();
    const body=$("#chatInput").value.trim();
    const file=$("#chatFile").files[0];
    if((!body&&!file)||!state.activeConversation)return;
    const submit=$("#chatForm button[type='submit']");
    submit.disabled=true;
    try{
      let mediaId=null;
      if(file){
        const kind=file.type.startsWith("image/")?"chat_image":
          file.type.startsWith("video/")?"chat_video":
          file.type.startsWith("audio/")?"chat_audio":"chat_file";
        const media=await uploadFile(file,kind,{silent:true});
        mediaId=media.id;
      }
      const {error}=await client.from("messages").insert({
        conversation_id:state.activeConversation,
        sender_id:state.user.id,
        body:body||"",
        media_id:mediaId
      });
      if(error)throw error;
      $("#chatInput").value="";
      clearChatAttachment();
      await loadChat();
      loadConversations();
    }catch(error){
      $("#chatAttachmentPreview").innerHTML='<span class="error">'+escapeHtml(error.message)+'</span>';
      $("#chatAttachmentPreview").classList.remove("hidden");
    }finally{
      submit.disabled=false;
    }
  };

  $("#closeChat").onclick=()=>{
    closeChatRealtime();
    state.activeConversation=null;
    clearChatAttachment();
    $("#chatDialog").close();
  };

  async function openComments(type,id){
    state.commentTarget={type,id};
    state.commentReply=null;
    updateCommentReplyBar();
    if($("#chatDialog")?.open){
      closeChatRealtime();
      state.activeConversation=null;
    }
    openDialog($("#commentsDialog"));
    await loadComments();
  }

  function updateCommentReplyBar(){
    const bar=$("#commentReplyBar");
    if(!bar)return;
    bar.classList.toggle("hidden",!state.commentReply);
    $("#commentReplyText").textContent=state.commentReply
      ?"رد على "+(state.commentReply.name||"التعليق")
      :"";
  }
  $("#cancelCommentReply").onclick=()=>{
    state.commentReply=null;
    updateCommentReplyBar();
  };

  async function loadComments(){
    if(!state.commentTarget)return;
    const field=state.commentTarget.type==="post"?"post_id":"reel_id";
    const {data,error}=await client.from("comments")
      .select("id,author_id,parent_id,body,created_at,updated_at")
      .eq(field,state.commentTarget.id)
      .order("created_at",{ascending:true})
      .limit(200);
    if(error){
      $("#commentsList").innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
      return;
    }
    const profiles=await profilesMap([...new Set((data||[]).map(x=>x.author_id))]);
    const byId=new Map((data||[]).map(row=>[row.id,row]));
    $("#commentsList").innerHTML=(data||[]).map(row=>{
      const p=profiles[row.author_id]||{};
      const parent=row.parent_id?byId.get(row.parent_id):null;
      const parentProfile=parent?profiles[parent.author_id]||{}:null;
      const parentHtml=parent
        ?'<div class="comment-parent">رد على @'+escapeHtml(parentProfile?.username||parentProfile?.name||"مستخدم")+': '+escapeHtml(parent.body||"")+'</div>'
        :"";
      const edited=row.updated_at&&new Date(row.updated_at).getTime()>new Date(row.created_at).getTime()+1000
        ?' · تم التعديل':"";
      const own=row.author_id===state.user.id;
      return '<div class="comment-item '+(row.parent_id?"reply":"")+'" data-comment-id="'+escapeHtml(row.id)+'">'+
        avatar(p)+
        '<div class="comment-bubble"><div class="comment-bubble-head"><b>'+escapeHtml(p.name||p.username||"مستخدم")+'</b>'+
        (p.is_verified?'<span class="verified-inline">✓</span>':"")+'</div>'+
        parentHtml+'<p>'+escapeHtml(row.body)+'</p>'+
        '<div class="comment-meta">'+new Date(row.created_at).toLocaleString("ar-IQ")+edited+'</div>'+
        '<div class="comment-actions">'+
          '<button class="comment-action" data-reply-comment="'+escapeHtml(row.id)+'" data-reply-name="'+escapeHtml(p.username||p.name||"مستخدم")+'" type="button">رد</button>'+
          (own
            ?'<button class="comment-action" data-edit-comment="'+escapeHtml(row.id)+'" data-comment-body="'+escapeHtml(row.body)+'" type="button">تعديل</button>'+
             '<button class="comment-action" data-delete-comment="'+escapeHtml(row.id)+'" type="button">حذف</button>'
            :'<button class="comment-action" data-report-comment="'+escapeHtml(row.id)+'" type="button">إبلاغ</button>')+
        '</div></div></div>';
    }).join("")||'<div class="empty">لا توجد تعليقات بعد. اكتب أول تعليق.</div>';
    await hydrateMedia($("#commentsList"));

    $("#commentsList").querySelectorAll("[data-reply-comment]").forEach(btn=>btn.onclick=()=>{
      state.commentReply={id:btn.dataset.replyComment,name:"@"+btn.dataset.replyName};
      updateCommentReplyBar();
      $("#commentInput").focus();
    });
    $("#commentsList").querySelectorAll("[data-edit-comment]").forEach(btn=>btn.onclick=async()=>{
      const next=prompt("تعديل التعليق",btn.dataset.commentBody||"");
      if(next===null)return;
      const body=next.trim();
      if(!body)return;
      try{
        await api("/v1/social/comments/"+btn.dataset.editComment,{method:"PATCH",body:JSON.stringify({body})});
        await loadComments();
      }catch(error){alert(error.message)}
    });
    $("#commentsList").querySelectorAll("[data-delete-comment]").forEach(btn=>btn.onclick=async()=>{
      if(!confirm("حذف التعليق؟"))return;
      try{
        await api("/v1/social/comments/"+btn.dataset.deleteComment,{method:"DELETE"});
        await loadComments();
      }catch(error){alert(error.message)}
    });
    $("#commentsList").querySelectorAll("[data-report-comment]").forEach(btn=>btn.onclick=()=>{
      $("#commentsDialog").close();
      openReportDialog("comment",btn.dataset.reportComment);
    });
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
      parent_id:state.commentReply?.id||null,
      post_id:state.commentTarget.type==="post"?state.commentTarget.id:null,
      reel_id:state.commentTarget.type==="reel"?state.commentTarget.id:null
    };
    const {error}=await client.from("comments").insert(payload);
    if(!error){
      $("#commentInput").value="";
      state.commentReply=null;
      updateCommentReplyBar();
      await loadComments();
    }
  };
  $("#closeComments").onclick=()=>{
    state.commentReply=null;
    updateCommentReplyBar();
    $("#commentsDialog").close();
  };

  async function openFollowList(profileId,mode,title){
    if($("#publicProfileDialog")?.open)state.returnPublicProfileId=profileId;
    openInfoDialog(title,'<div id="followListDialog" class="list compact"><div class="empty">جارٍ التحميل...</div></div>');
    try{
      let items=[];
      try{
        const result=await api("/v1/social/follows/"+encodeURIComponent(profileId)+"?mode="+encodeURIComponent(mode));
        items=result.items||[];
      }catch(apiError){
        const targetIsOwn=profileId===state.user.id;
        const knownPublic=state.currentPublicProfile?.id===profileId && state.currentPublicProfile?.is_private===false;
        if(!targetIsOwn&&!knownPublic)throw apiError;
        const isFollowing=mode==="following";
        const idField=isFollowing?"following_id":"follower_id";
        const filterField=isFollowing?"follower_id":"following_id";
        const {data:followRows,error:followError}=await client.from("follows")
          .select(idField)
          .eq(filterField,profileId)
          .eq("status","accepted")
          .limit(500);
        if(followError)throw followError;
        const ids=[...new Set((followRows||[]).map(row=>row[idField]).filter(Boolean))];
        if(ids.length){
          const {data:profiles,error:profilesError}=await client.from("profiles")
            .select("id,name,username,avatar_media_id,is_verified,is_private")
            .in("id",ids);
          if(profilesError)throw profilesError;
          const map=new Map((profiles||[]).map(p=>[p.id,p]));
          items=ids.map(id=>map.get(id)).filter(Boolean);
        }
      }
      $("#followListDialog").innerHTML=items.map(p=>`
        <button class="list-card" data-open-follow-profile="${p.id}" type="button">
          ${avatar(p)}
          <span class="grow"><b>${escapeHtml(p.name||"مستخدم")}${p.is_verified?'<span class="verified-inline">✓</span>':""}</b><small>@${escapeHtml(p.username||"")}</small></span>
        </button>`).join("")||'<div class="empty">لا توجد حسابات.</div>';
      await hydrateMedia($("#followListDialog"));
      $("#followListDialog").querySelectorAll("[data-open-follow-profile]").forEach(btn=>btn.onclick=()=>{
        const uid=btn.dataset.openFollowProfile;
        $("#infoDialog").close();
        openPublicProfile(uid);
      });
    }catch(error){
      $("#followListDialog").innerHTML='<div class="empty error">تعذر تحميل القائمة. أعد المحاولة بعد تحديث الخدمة.</div>';
    }
  }

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
        <button id="profileSettingsFab" class="profile-settings-fab" type="button" aria-label="الإعدادات">${icon("settings")}</button>
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
            <button class="profile-stat-button" id="ownFollowersButton" type="button"><b>${followers||0}</b><span>متابع</span></button>
            <button class="profile-stat-button" id="ownFollowingButton" type="button"><b>${following||0}</b><span>يتابع</span></button>
          </div>
          <div class="profile-buttons">
            <button id="editProfileButton" class="small-button" type="button">${icon("edit")}<span>تعديل الملف</span></button>
            <button id="profilePrivacyButton" class="small-button privacy-button" type="button">${icon(p.is_private?"lock":"globe")}<span>${p.is_private?"خاص":"عام"}</span></button>
          </div>
        </div>
      </div>`;
    $("#editProfileButton").onclick=openEditProfile;
    $("#profileSettingsFab").onclick=openSettings;
    $("#profilePrivacyButton").onclick=async()=>{
      const next=!Boolean(state.profile?.is_private);
      const label=next?"خاص":"عام";
      if(!confirm("تغيير الحساب إلى "+label+"؟"))return;
      $("#profilePrivacyButton").disabled=true;
      const {error}=await client.from("profiles").update({
        is_private:next,
        updated_at:new Date().toISOString()
      }).eq("id",state.user.id);
      if(error){
        alert(error.message);
        $("#profilePrivacyButton").disabled=false;
        return;
      }
      await refreshProfile();
      await loadProfile();
    };
    $("#ownFollowersButton").onclick=()=>openFollowList(state.user.id,"followers","المتابعون");
    $("#ownFollowingButton").onclick=()=>openFollowList(state.user.id,"following","الحسابات التي تتابعها");
    await hydrateMedia($("#profileCard"));
    await loadProfileContent(state.profileTab);
    }catch(error){
      $("#profileCard").innerHTML=errorMarkup(error.message||"تعذر تحميل الملف الشخصي","profilePage");
      $("#profileContent").innerHTML="";
    }
  }

  function profileGridTile(item,kind,saved=false){
    const mediaId=kind==="reels"
      ?item.media_id
      :([...(item.post_media||[])].sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0))[0]?.media_id||"");
    const caption=String(item.caption||"");
    const media=mediaId
      ?(kind==="reels"
        ?'<video class="profile-grid-media" muted playsinline preload="metadata" data-video-cover="1" data-media-id="'+escapeHtml(mediaId)+'"></video><span class="profile-grid-play">'+icon("play")+'</span>'
        :'<img class="profile-grid-media" data-profile-cover="1" data-media-id="'+escapeHtml(mediaId)+'" alt="">')
      :'<div class="profile-grid-placeholder">'+icon(kind==="reels"?"play":"comment")+'</div>';
    return '<button class="profile-grid-tile" type="button"'+
      ' data-preview-kind="'+kind+'"'+
      ' data-preview-id="'+escapeHtml(item.id)+'"'+
      ' data-preview-media="'+escapeHtml(mediaId)+'"'+
      ' data-preview-caption="'+escapeHtml(caption)+'"'+
      ' data-preview-comments="'+String(item.comments_enabled!==false)+'">'+
      media+
      (saved?'<span class="profile-grid-saved">'+icon("save")+'</span>':"")+
      '</button>';
  }

  async function openProfileContentPreview(kind,id,mediaId,caption="",commentsEnabled=true){
    const reel=kind==="reels";
    const likeTable=reel?"reel_likes":"post_likes";
    const targetField=reel?"reel_id":"post_id";
    const saveTable=reel?"saved_reels":"saved_posts";
    const saveField=reel?"reel_id":"post_id";
    const commentField=reel?"reel_id":"post_id";
    const results=await Promise.all([
      client.from(likeTable).select(targetField).eq(targetField,id).eq("user_id",state.user.id).maybeSingle(),
      client.from(saveTable).select(saveField).eq(saveField,id).eq("user_id",state.user.id).maybeSingle(),
      client.from(likeTable).select("*",{count:"exact",head:true}).eq(targetField,id),
      client.from("comments").select("*",{count:"exact",head:true}).eq(commentField,id)
    ]);
    const liked=!!results[0].data;
    const saved=!!results[1].data;
    const likeCount=Number(results[2].count||0);
    const commentCount=Number(results[3].count||0);
    const media=mediaId
      ?(reel
        ?'<video class="profile-preview-media" controls playsinline preload="metadata" data-media-id="'+escapeHtml(mediaId)+'"></video>'
        :'<img class="profile-preview-media" data-media-id="'+escapeHtml(mediaId)+'" alt="">')
      :"";
    openInfoDialog(reel?"ريلز":"منشور",
      '<div class="profile-preview">'+media+
      (caption?'<p class="profile-preview-caption">'+escapeHtml(caption)+'</p>':"")+
      '<div class="profile-preview-actions">'+
      '<button id="previewLikeButton" class="'+(liked?"active":"")+'" type="button">'+icon("like")+'<span>'+likeCount+'</span></button>'+
      (commentsEnabled?'<button id="previewCommentButton" type="button">'+icon("comment")+'<span>'+commentCount+'</span></button>':"")+
      '<button id="previewShareButton" type="button">'+icon("share")+'<span>مشاركة</span></button>'+
      '<button id="previewSaveButton" class="'+(saved?"active":"")+'" type="button">'+icon("save")+'<span>'+(saved?"محفوظ":"حفظ")+'</span></button>'+
      '</div></div>');
    await hydrateMedia($("#infoDialogBody"));
    $("#previewLikeButton").onclick=async()=>{
      const active=$("#previewLikeButton").classList.contains("active");
      if(active)await client.from(likeTable).delete().eq(targetField,id).eq("user_id",state.user.id);
      else await client.from(likeTable).insert({[targetField]:id,user_id:state.user.id});
      const next=!active;
      $("#previewLikeButton").classList.toggle("active",next);
      const span=$("#previewLikeButton span");
      if(span)span.textContent=String(Math.max(0,Number(span.textContent||0)+(next?1:-1)));
    };
    const commentButton=$("#previewCommentButton");
    if(commentButton)commentButton.onclick=()=>openComments(reel?"reel":"post",id);
    $("#previewShareButton").onclick=()=>shareContent(reel?"reel":"post",id);
    $("#previewSaveButton").onclick=async()=>{
      const active=$("#previewSaveButton").classList.contains("active");
      if(active)await client.from(saveTable).delete().eq(saveField,id).eq("user_id",state.user.id);
      else await client.from(saveTable).insert({[saveField]:id,user_id:state.user.id});
      $("#previewSaveButton").classList.toggle("active",!active);
      $("#previewSaveButton span").textContent=!active?"محفوظ":"حفظ";
    };
  }

  function bindProfileGrid(root){
    root.querySelectorAll("[data-preview-id]").forEach(btn=>{
      btn.onclick=()=>openProfileContentPreview(
        btn.dataset.previewKind,
        btn.dataset.previewId,
        btn.dataset.previewMedia,
        btn.dataset.previewCaption,
        btn.dataset.previewComments==="true"
      ).catch(error=>openInfoDialog("تعذر الفتح",'<div class="empty error">'+escapeHtml(error.message)+'</div>'));
    });
  }

  async function loadProfileContent(kind="posts"){
    if(!["posts","reels","saved"].includes(kind))kind="posts";
    state.profileTab=kind;
    $$("#ownProfileTabs [data-profile-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.profileTab===kind));
    $("#profileContent").className="profile-media-grid";
    $("#profileContent").innerHTML='<div class="profile-grid-loading">جارٍ التحميل...</div>';
    try{
      if(kind==="reels"){
        const result=await client.from("reels")
          .select("id,caption,media_id,created_at,comments_enabled")
          .eq("author_id",state.user.id)
          .order("created_at",{ascending:false});
        if(result.error)throw result.error;
        $("#profileContent").innerHTML=(result.data||[]).map(row=>profileGridTile(row,"reels")).join("")||
          '<div class="empty profile-grid-empty">لم تنشر ريلز بعد.</div>';
      }else if(kind==="saved"){
        const savedResults=await Promise.all([
          client.from("saved_posts").select("post_id,created_at").eq("user_id",state.user.id).order("created_at",{ascending:false}),
          client.from("saved_reels").select("reel_id,created_at").eq("user_id",state.user.id).order("created_at",{ascending:false})
        ]);
        if(savedResults[0].error)throw savedResults[0].error;
        if(savedResults[1].error)throw savedResults[1].error;
        const savedPosts=savedResults[0].data||[];
        const savedReels=savedResults[1].data||[];
        const postIds=savedPosts.map(x=>x.post_id);
        const reelIds=savedReels.map(x=>x.reel_id);
        const contentResults=await Promise.all([
          postIds.length
            ?client.from("posts").select("id,caption,comments_enabled,post_media(media_id,sort_order)").in("id",postIds)
            :Promise.resolve({data:[],error:null}),
          reelIds.length
            ?client.from("reels").select("id,caption,media_id,comments_enabled").in("id",reelIds)
            :Promise.resolve({data:[],error:null})
        ]);
        if(contentResults[0].error)throw contentResults[0].error;
        if(contentResults[1].error)throw contentResults[1].error;
        const postMap=new Map((contentResults[0].data||[]).map(x=>[x.id,x]));
        const reelMap=new Map((contentResults[1].data||[]).map(x=>[x.id,x]));
        const ordered=[
          ...savedPosts.map(x=>({at:x.created_at,kind:"posts",item:postMap.get(x.post_id)})),
          ...savedReels.map(x=>({at:x.created_at,kind:"reels",item:reelMap.get(x.reel_id)}))
        ].filter(x=>x.item).sort((a,b)=>new Date(b.at)-new Date(a.at));
        $("#profileContent").innerHTML=ordered.map(x=>profileGridTile(x.item,x.kind,true)).join("")||
          '<div class="empty profile-grid-empty">لا توجد محفوظات بعد.</div>';
      }else{
        const result=await client.from("posts")
          .select("id,caption,comments_enabled,post_media(media_id,sort_order)")
          .eq("author_id",state.user.id)
          .order("created_at",{ascending:false});
        if(result.error)throw result.error;
        $("#profileContent").innerHTML=(result.data||[]).map(row=>profileGridTile(row,"posts")).join("")||
          '<div class="empty profile-grid-empty">لم تنشر شيئًا بعد.</div>';
      }
      await hydrateMedia($("#profileContent"));
      prepareVideoCovers($("#profileContent"));
      bindProfileGrid($("#profileContent"));
    }catch(error){
      $("#profileContent").innerHTML='<div class="empty error profile-grid-empty">'+escapeHtml(error.message)+'</div>';
    }
  }

  $("#ownProfileTabs [data-profile-tab]").forEach(btn=>btn.onclick=()=>loadProfileContent(btn.dataset.profileTab));

  async function openPublicProfile(uid){
    if(uid===state.user.id){
      $("#publicProfileDialog").close();
      navigateTo("profilePage");
      return;
    }
    $("#publicProfileContent").innerHTML='<div class="empty">جارٍ التحميل...</div>';
    const {data:p,error}=await client.from("profiles")
      .select("id,name,username,bio,avatar_media_id,cover_media_id,profile_link,is_verified,is_private")
      .eq("id",uid).single();
    if(error||!p){
      openInfoDialog("الحساب غير متاح",'<div class="empty">تعذر فتح هذا الحساب. قد يكون محظورًا أو غير متاح.</div>');
      return;
    }
    state.currentPublicProfile=p;
    const [{count:posts},{count:followers},{count:following},{data:followRow}] = await Promise.all([
      client.from("posts").select("*",{count:"exact",head:true}).eq("author_id",uid),
      client.from("follows").select("*",{count:"exact",head:true}).eq("following_id",uid).eq("status","accepted"),
      client.from("follows").select("*",{count:"exact",head:true}).eq("follower_id",uid).eq("status","accepted"),
      client.from("follows").select("status").eq("follower_id",state.user.id).eq("following_id",uid).maybeSingle()
    ]);
    const link=safeLink(p.profile_link||"");
    const followText=followRow?.status==="accepted"?"تتابعه":followRow?.status==="pending"?"تم إرسال الطلب":"متابعة";
    $("#publicProfileCard").innerHTML=
      '<div class="profile-cover">'+(p.cover_media_id?'<img class="cover-image" data-media-id="'+escapeHtml(p.cover_media_id)+'" alt="">':"")+'</div>'+
      '<div class="profile-main"><div class="profile-avatar-wrap">'+avatar(p)+'</div><div class="profile-info">'+
      '<div class="profile-name-row"><h2>'+escapeHtml(p.name||"مستخدم")+'</h2>'+(p.is_verified?'<span class="verified-badge">✓</span>':"")+'</div>'+
      '<div class="profile-username">@'+escapeHtml(p.username||"")+'</div>'+
      (p.bio?'<p class="profile-bio">'+escapeHtml(p.bio)+'</p>':"")+
      (link?'<a class="profile-link" href="'+escapeHtml(link)+'" target="_blank" rel="noopener">'+icon("link")+'<span>'+escapeHtml(p.profile_link)+'</span></a>':"")+
      '<div class="profile-stats"><div><b>'+Number(posts||0)+'</b><span>منشور</span></div>'+
      '<button id="publicFollowersButton" class="profile-stat-button" type="button"><b>'+Number(followers||0)+'</b><span>متابع</span></button>'+
      '<button id="publicFollowingButton" class="profile-stat-button" type="button"><b>'+Number(following||0)+'</b><span>يتابع</span></button></div>'+
      '<div class="profile-actions-public">'+
      '<button id="publicFollowButton" class="primary" type="button">'+followText+'</button>'+
      '<button id="publicMessageButton" class="small-button" type="button">'+icon("message")+' مراسلة</button>'+
      '<button id="publicMoreButton" class="profile-more-button" type="button" aria-label="المزيد">'+icon("more")+'</button>'+
      '</div></div></div>';
    await hydrateMedia($("#publicProfileCard"));
    openDialog($("#publicProfileDialog"));

    $("#publicFollowersButton").onclick=()=>openFollowList(uid,"followers","المتابعون");
    $("#publicFollowingButton").onclick=()=>openFollowList(uid,"following","الحسابات التي يتابعها");
    $("#publicFollowButton").onclick=()=>followUser(uid,$("#publicFollowButton"));
    $("#publicMessageButton").onclick=async()=>{
      $("#publicMessageButton").disabled=true;
      try{
        const conversation=await api("/v1/conversations",{method:"POST",body:JSON.stringify({kind:"direct",target_user_id:uid})});
        $("#publicProfileDialog").close();
        await navigateTo("messagesPage");
        await openChat(conversation.id,p.name||p.username||"محادثة");
      }catch(error){
        alert(error.message);
      }finally{
        if($("#publicMessageButton"))$("#publicMessageButton").disabled=false;
      }
    };
    $("#publicMoreButton").onclick=()=>{
      $("#publicProfileDialog").close();
      openInfoDialog("خيارات الحساب",
        '<div class="settings-info">'+
          '<button id="reportProfileButton" class="settings-row" type="button"><span><b>إبلاغ عن الحساب</b><small>إرسال الحساب للإدارة للمراجعة</small></span></button>'+
          '<button id="blockProfileButton" class="danger-wide danger-outline" type="button">حظر الحساب</button>'+
        '</div>');
      $("#reportProfileButton").onclick=()=>{
        $("#infoDialog").close();
        openReportDialog("profile",uid);
      };
      $("#blockProfileButton").onclick=async()=>{
        if(!confirm("حظر هذا الحساب؟ لن تتمكنا من رؤية محتوى بعضكما أو بدء محادثة مباشرة."))return;
        $("#blockProfileButton").disabled=true;
        try{
          await api("/v1/social/block/"+uid,{method:"POST",body:JSON.stringify({blocked:true})});
          $("#infoDialog").close();
          state.currentPublicProfile=null;
          await loadConversations().catch(()=>{});
        }catch(error){
          alert(error.message);
          $("#blockProfileButton").disabled=false;
        }
      };
    };

    const mayView=!p.is_private||followRow?.status==="accepted";
    if(!mayView){
      $("#publicProfileContent").innerHTML='<div class="empty">هذا الحساب خاص. تابع الحساب وانتظر الموافقة لعرض المحتوى.</div>';
    }else{
      const {data:content,error:contentError}=await client.from("posts")
        .select("id,caption,created_at,post_media(media_id,sort_order)")
        .eq("author_id",uid)
        .order("created_at",{ascending:false})
        .limit(30);
      if(contentError){
        $("#publicProfileContent").innerHTML='<div class="empty error">'+escapeHtml(contentError.message)+'</div>';
      }else{
        $("#publicProfileContent").innerHTML=(content||[]).map(row=>{
          const media=(row.post_media||[]).sort((a,b)=>a.sort_order-b.sort_order)[0]?.media_id;
          return '<article class="post">'+
            (media?'<img class="post-media" data-media-id="'+escapeHtml(media)+'" alt="">':"")+
            '<div class="post-body">'+escapeHtml(row.caption||"")+
              '<div class="content-owner-actions"><button data-report-public-post="'+escapeHtml(row.id)+'" type="button">إبلاغ</button></div>'+
            '</div></article>';
        }).join("")||'<div class="empty">لا توجد منشورات بعد.</div>';
        await hydrateMedia($("#publicProfileContent"));
        $("#publicProfileContent").querySelectorAll("[data-report-public-post]").forEach(btn=>btn.onclick=()=>{
          $("#publicProfileDialog").close();
          openReportDialog("post",btn.dataset.reportPublicPost);
        });
      }
    }
  }
  $("#closePublicProfile").onclick=()=>{
    state.currentPublicProfile=null;
    $("#publicProfileDialog").close();
  };

  async function loadNotificationsBadge(){
    if(!state.user)return;
    const {count}=await client.from("notifications").select("*",{count:"exact",head:true}).eq("user_id",state.user.id).is("read_at",null);
    const badge=$("#notificationBadge");
    badge.textContent=count||0;
    badge.classList.toggle("hidden",!count);
  }

  async function handleNotificationTarget(notification){
    const type=notification.entity_type||notification.kind||"";
    const id=notification.entity_id||"";
    $("#notificationsDialog").close();
    if(type==="profile"&&id){
      return openPublicProfile(id);
    }
    if(type==="post"&&id){
      await navigateTo("homePage");
      await loadFeed();
      document.querySelector('[data-post-id="'+CSS.escape(id)+'"]')?.scrollIntoView({behavior:"smooth",block:"center"});
      return;
    }
    if(type==="reel"&&id){
      await navigateTo("reelsPage");
      document.querySelector('[data-reel-id="'+CSS.escape(id)+'"]')?.scrollIntoView({behavior:"smooth",block:"center"});
      return;
    }
    if((type==="conversation"||type==="message")&&id){
      await navigateTo("messagesPage");
      return openChat(id,"المحادثة");
    }
    if(type==="support_ticket"||type==="support"){
      return openSupportCenter();
    }
    if(notification.kind==="follow"&&notification.actor_id){
      return openPublicProfile(notification.actor_id);
    }
    return navigateTo("homePage");
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
    $("#notificationsList").innerHTML=(data||[]).map(n=>
      '<button class="notification-item '+(!n.read_at?"unread":"")+'" data-notification-id="'+escapeHtml(n.id)+'" type="button">'+
        '<div class="grow"><b>'+escapeHtml(n.title||"إشعار")+'</b><div>'+escapeHtml(n.body||"")+'</div>'+
        '<time>'+new Date(n.created_at).toLocaleString("ar-IQ")+'</time></div>'+
      '</button>'
    ).join("")||'<div class="empty">لا توجد إشعارات.</div>';
    const map=new Map((data||[]).map(n=>[String(n.id),n]));
    $("#notificationsList").querySelectorAll("[data-notification-id]").forEach(btn=>btn.onclick=()=>{
      const row=map.get(btn.dataset.notificationId);
      if(row)handleNotificationTarget(row).catch(()=>{});
    });
    await client.from("notifications").update({read_at:new Date().toISOString()}).eq("user_id",state.user.id).is("read_at",null);
    loadNotificationsBadge().catch(()=>{});
  };
  $("#closeNotifications").onclick=()=>$("#notificationsDialog").close();

  $("#publishButton").onclick=()=>openDialog($("#publishDialog"));
  $("#closePublish").onclick=()=>$("#publishDialog").close();
  $("#publishDialog").querySelectorAll("[data-publish]").forEach(b=>b.onclick=()=>openComposer(b.dataset.publish));

  function clearComposerPreview(){
    for(const url of state.previewUrls||[]){
      try{URL.revokeObjectURL(url)}catch(_){}
    }
    if(state.previewUrl){
      try{URL.revokeObjectURL(state.previewUrl)}catch(_){}
    }
    state.previewUrl=null;
    state.previewUrls=[];
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
    $("#composerFile").multiple=type==="post";
    $("#composerFile").value="";
    $("#composerCaption").value="";
    $("#composerVisibility").value="public";
    $("#composerCommentsEnabled").checked=true;
    $("#composerOptions").classList.toggle("hidden",type==="story");
    $("#composerMessage").textContent="";
    clearComposerPreview();
    openDialog($("#composerDialog"));
  }

  $("#composerFile").onchange=()=>{
    clearComposerPreview();
    const files=[...$("#composerFile").files];
    if(!files.length)return;
    if(state.composerType!=="post"&&files.length>1){
      $("#composerFile").value="";
      $("#composerMessage").textContent="هذا النوع يقبل ملفًا واحدًا فقط.";
      return;
    }
    if(state.composerType==="post"&&files.length>10){
      $("#composerFile").value="";
      $("#composerMessage").textContent="يمكن إضافة 10 ملفات كحد أقصى للمنشور.";
      return;
    }
    for(const file of files){
      if(state.composerType==="reel"&&!file.type.startsWith("video/")){
        $("#composerFile").value="";
        $("#composerMessage").textContent="الريلز يقبل فيديو فقط.";
        return;
      }
      if(!file.type.startsWith("image/")&&!file.type.startsWith("video/")){
        $("#composerFile").value="";
        $("#composerMessage").textContent="نوع الملف غير مدعوم.";
        return;
      }
    }

    const previews=[];
    let total=0;
    files.forEach(file=>{
      const url=URL.createObjectURL(file);
      state.previewUrls.push(url);
      total+=file.size;
      previews.push(file.type.startsWith("video/")
        ?'<video src="'+url+'" controls playsinline preload="metadata"></video>'
        :'<img src="'+url+'" alt="معاينة">');
    });
    state.previewUrl=state.previewUrls[0]||null;
    $("#composerPreview").innerHTML=previews.join("");
    $("#composerPreview").classList.toggle("composer-preview-grid",files.length>1);
    $("#composerPreview").classList.remove("hidden");
    $("#composerFileMeta").textContent=files.length===1
      ?files[0].name+" · "+(files[0].size/1024/1024).toFixed(1)+" MB"
      :files.length+" ملفات · "+(total/1024/1024).toFixed(1)+" MB";
    $("#composerFileMeta").classList.remove("hidden");
    $("#composerMessage").textContent="";
  };

  $("#cancelComposer").onclick=()=>{
    if(state.activeUpload){
      try{state.activeUpload.abort()}catch(_){}
      if(state.activeUploadId){
        api("/v1/uploads/"+encodeURIComponent(state.activeUploadId)+"/cancel",{method:"POST"}).catch(()=>{});
      }
    }
    state.activeUpload=null;
    state.activeUploadId=null;
    clearComposerPreview();
    $("#composerDialog").close();
  };

  $("#submitComposer").onclick=async()=>{
    const files=[...$("#composerFile").files];
    const caption=$("#composerCaption").value.trim();
    if(!files.length)return $("#composerMessage").textContent="اختر ملفًا أولًا";

    for(const file of files){
      const uploadLimit=state.composerType==="story"
        ?Number(state.limits.story_mb||30)
        :file.type.startsWith("image/")
          ?Number(state.limits.image_mb||10)
          :Number(state.limits.max_upload_mb||cfg.maxUploadMb||60);
      if(file.size>uploadLimit*1024*1024){
        $("#composerMessage").textContent="الملف "+file.name+" أكبر من الحد "+uploadLimit+" ميغابايت.";
        return;
      }
    }

    $("#submitComposer").disabled=true;
    $("#composerMessage").textContent="جارٍ الرفع...";
    try{
      const uploaded=[];
      for(let i=0;i<files.length;i++){
        const file=files[i];
        $("#composerMessage").textContent="جارٍ رفع "+(i+1)+" من "+files.length+"...";
        const kind=state.composerType==="reel"
          ?"reel"
          :state.composerType==="story"
            ?"story"
            :file.type.startsWith("video/")?"post_video":"post_image";
        uploaded.push(await uploadFile(file,kind));
      }

      const visibility=$("#composerVisibility").value==="followers"?"followers":"public";
      const commentsEnabled=$("#composerCommentsEnabled").checked;
      if(state.composerType==="reel"){
        const {error}=await client.from("reels").insert({
          author_id:state.user.id,
          media_id:uploaded[0].id,
          caption,
          visibility,
          comments_enabled:commentsEnabled
        });
        if(error)throw error;
      }else if(state.composerType==="story"){
        const {error}=await client.from("stories").insert({
          author_id:state.user.id,
          media_id:uploaded[0].id,
          caption
        });
        if(error)throw error;
      }else{
        const {data:post,error}=await client.from("posts").insert({
          author_id:state.user.id,
          caption,
          visibility,
          comments_enabled:commentsEnabled
        }).select("id").single();
        if(error)throw error;
        const mediaRows=uploaded.map((media,index)=>({post_id:post.id,media_id:media.id,sort_order:index}));
        const {error:mediaErr}=await client.from("post_media").insert(mediaRows);
        if(mediaErr)throw mediaErr;
      }
      clearComposerPreview();
      $("#composerDialog").close();
      $("#composerFile").value="";
      $("#composerCaption").value="";
      await loadHome();
    }catch(e){
      $("#composerMessage").textContent=e.message+" — يمكنك الضغط على «نشر الآن» لإعادة المحاولة.";
    }finally{
      $("#submitComposer").disabled=false;
    }
  };

  async function uploadFile(file,kind,{silent=false}={}){
    const token=await accessToken();
    if(!token)throw new Error("انتهت جلسة الدخول. سجّل الدخول من جديد.");
    const progress=silent?null:$("#uploadProgress");
    const bar=progress?.querySelector(".progress>div");
    const progressText=silent?null:$("#uploadProgressText");
    const uploadId=(crypto.randomUUID?.()||("upload-"+Date.now()+"-"+Math.random().toString(36).slice(2)));
    if(progress){
      progress.classList.remove("hidden");
      if(bar)bar.style.width="0%";
      if(progressText)progressText.textContent="0%";
    }

    state.activeUploadId=uploadId;
    try{
      return await new Promise((resolve,reject)=>{
        const xhr=new XMLHttpRequest();
        state.activeUpload=xhr;
        xhr.open("POST",apiUrl("/v1/storage/upload?kind="+encodeURIComponent(kind)));
        xhr.setRequestHeader("Authorization","Bearer "+token);
        xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream");
        xhr.setRequestHeader("X-File-Name",encodeURIComponent(file.name||"file"));
        xhr.setRequestHeader("X-Upload-Id",uploadId);

        xhr.upload.onprogress=(event)=>{
          if(event.lengthComputable){
            const percent=Math.min(100,Math.round((event.loaded/event.total)*100));
            if(bar)bar.style.width=percent+"%";
            if(progressText)progressText.textContent=percent+"%";
            if(silent&&$("#chatAttachmentPreview")&&!$("#chatAttachmentPreview").classList.contains("hidden")){
              const small=$("#chatAttachmentPreview").querySelector("small");
              if(small)small.textContent=percent+"% · "+(file.size/1024/1024).toFixed(1)+" MB";
            }
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
      state.activeUpload=null;
      state.activeUploadId=null;
      if(progress){
        if(bar)bar.style.width="100%";
        if(progressText)progressText.textContent="100%";
        setTimeout(()=>progress?.classList.add("hidden"),450);
      }
    }
  }

  let messagesSearchTimer;
  $("#messagesSearchInput").oninput=()=>{
    clearTimeout(messagesSearchTimer);
    messagesSearchTimer=setTimeout(()=>loadConversations(),180);
  };

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
  $("#closeInfoDialog").onclick=()=>{
    $("#infoDialog").close();
    const returnProfile=state.returnPublicProfileId;
    state.returnPublicProfileId=null;
    if(returnProfile)setTimeout(()=>openPublicProfile(returnProfile).catch(()=>{}),0);
  };

  async function openSupportCenter(){
    openInfoDialog("الدعم الفني",`
      <div class="settings-info">
        <div class="settings-group">
          <h4>إرسال مشكلة</h4>
          <label><span>نوع المشكلة</span>
            <select id="supportCategory">
              <option value="technical">مشكلة تقنية</option>
              <option value="account">الحساب</option>
              <option value="content">المحتوى</option>
              <option value="upload">رفع الملفات</option>
              <option value="other">أخرى</option>
            </select>
          </label>
          <label><span>العنوان</span><input id="supportSubject" maxlength="160" placeholder="عنوان مختصر"></label>
          <label><span>التفاصيل</span><textarea id="supportBody" maxlength="4000" placeholder="اشرح المشكلة بالتفصيل"></textarea></label>
          <button id="submitSupportTicket" class="primary" type="button">إرسال للدعم</button>
          <p id="supportMessage" class="message"></p>
        </div>
        <div class="settings-group">
          <h4>طلباتك السابقة</h4>
          <div id="supportTicketsList" class="list compact"><div class="empty">جارٍ التحميل...</div></div>
        </div>
      </div>`);
    const loadTickets=async()=>{
      try{
        const result=await api("/v1/social/support");
        $("#supportTicketsList").innerHTML=(result.items||[]).map(t=>`
          <div class="list-card support-ticket-card">
            <div class="grow">
              <b>${escapeHtml(t.subject||"طلب دعم")}</b>
              <div class="meta">${escapeHtml(t.status||"open")} · ${new Date(t.created_at).toLocaleString("ar-IQ")}</div>
              <p>${escapeHtml(t.body||"")}</p>
              ${t.admin_reply?`<div class="support-reply"><b>رد الإدارة</b><p>${escapeHtml(t.admin_reply)}</p></div>`:""}
            </div>
          </div>`).join("")||'<div class="empty">ما عندك طلبات دعم بعد.</div>';
      }catch(error){
        $("#supportTicketsList").innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
      }
    };
    await loadTickets();
    $("#submitSupportTicket").onclick=async()=>{
      const subject=$("#supportSubject").value.trim();
      const body=$("#supportBody").value.trim();
      if(!subject||!body){
        $("#supportMessage").textContent="اكتب العنوان والتفاصيل.";
        return;
      }
      $("#submitSupportTicket").disabled=true;
      try{
        await api("/v1/social/support",{
          method:"POST",
          body:JSON.stringify({
            category:$("#supportCategory").value,
            subject,
            body,
            app_version:cfg.appVersion||"",
            device_info:navigator.userAgent.slice(0,300)
          })
        });
        $("#supportSubject").value="";
        $("#supportBody").value="";
        $("#supportMessage").textContent="تم إرسال الطلب.";
        await loadTickets();
      }catch(error){
        $("#supportMessage").textContent=error.message;
      }finally{$("#submitSupportTicket").disabled=false}
    };
  }

  async function openSavedContent(){
    openInfoDialog("المحفوظات",`
      <div class="settings-info">
        <div class="chips">
          <button id="savedPostsTab" class="chip active" type="button">المنشورات</button>
          <button id="savedReelsTab" class="chip" type="button">الريلز</button>
        </div>
        <div id="savedContentList" class="feed"><div class="empty">جارٍ التحميل...</div></div>
      </div>`);
    const loadSaved=async(kind)=>{
      const isReels=kind==="reels";
      $("#savedPostsTab").classList.toggle("active",!isReels);
      $("#savedReelsTab").classList.toggle("active",isReels);
      $("#savedContentList").innerHTML='<div class="empty">جارٍ التحميل...</div>';
      try{
        const result=await api("/v1/social/saved?kind="+kind);
        const ids=(result.items||[]).map(x=>x[isReels?"reel_id":"post_id"]).filter(Boolean);
        if(!ids.length){
          $("#savedContentList").innerHTML='<div class="empty">ماكو محتوى محفوظ بهذا القسم.</div>';
          return;
        }
        if(isReels){
          const {data,error}=await client.from("reels").select("id,caption,media_id,author_id").in("id",ids);
          if(error)throw error;
          const order=new Map(ids.map((id,i)=>[id,i]));
          const rows=(data||[]).sort((a,b)=>(order.get(a.id)||0)-(order.get(b.id)||0));
          $("#savedContentList").innerHTML=rows.map(r=>`<article class="post">
            <video class="post-media" playsinline preload="metadata" data-media-id="${r.media_id}"></video>
            <div class="post-body">${escapeHtml(r.caption||"")}
              <div class="content-owner-actions"><button data-unsave-reel="${r.id}" type="button">إزالة من المحفوظات</button></div>
            </div>
          </article>`).join("");
          $("#savedContentList").querySelectorAll("[data-unsave-reel]").forEach(b=>b.onclick=async()=>{
            await api("/v1/social/save",{method:"POST",body:JSON.stringify({kind:"reel",id:b.dataset.unsaveReel,saved:false})});
            loadSaved("reels");
          });
        }else{
          const {data,error}=await client.from("posts").select("id,caption,author_id,post_media(media_id,sort_order)").in("id",ids);
          if(error)throw error;
          const order=new Map(ids.map((id,i)=>[id,i]));
          const rows=(data||[]).sort((a,b)=>(order.get(a.id)||0)-(order.get(b.id)||0));
          $("#savedContentList").innerHTML=rows.map(p=>{
            const media=(p.post_media||[]).sort((a,b)=>a.sort_order-b.sort_order)[0]?.media_id;
            return `<article class="post">${media?`<img class="post-media" data-media-id="${media}" alt="">`:""}
              <div class="post-body">${escapeHtml(p.caption||"")}
                <div class="content-owner-actions"><button data-unsave-post="${p.id}" type="button">إزالة من المحفوظات</button></div>
              </div>
            </article>`;
          }).join("");
          $("#savedContentList").querySelectorAll("[data-unsave-post]").forEach(b=>b.onclick=async()=>{
            await api("/v1/social/save",{method:"POST",body:JSON.stringify({kind:"post",id:b.dataset.unsavePost,saved:false})});
            loadSaved("posts");
          });
        }
        await hydrateMedia($("#savedContentList"));
      }catch(error){
        $("#savedContentList").innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
      }
    };
    $("#savedPostsTab").onclick=()=>loadSaved("posts");
    $("#savedReelsTab").onclick=()=>loadSaved("reels");
    await loadSaved("posts");
  }

  $("#blockedAccountsButton").onclick=async()=>{
    try{
      const result=await api("/v1/social/blocked");
      const html=(result.items||[]).map(p=>
        '<div class="list-card">'+avatar(p)+
        '<div class="grow"><b>'+escapeHtml(p.name||"مستخدم")+'</b><div>@'+escapeHtml(p.username||"")+'</div></div>'+
        '<button class="small-button" data-unblock="'+escapeHtml(p.id)+'" type="button">رفع الحظر</button></div>'
      ).join("")||'<div class="empty">لا توجد حسابات محظورة.</div>';
      openInfoDialog("الحسابات المحظورة",'<div id="blockedList" class="list compact">'+html+'</div>');
      await hydrateMedia($("#infoDialogBody"));
      $("#infoDialogBody").querySelectorAll("[data-unblock]").forEach(btn=>btn.onclick=async()=>{
        try{
          await api("/v1/social/block/"+btn.dataset.unblock,{method:"POST",body:JSON.stringify({blocked:false})});
          btn.closest(".list-card")?.remove();
          if(!$("#blockedList").children.length)$("#blockedList").innerHTML='<div class="empty">لا توجد حسابات محظورة.</div>';
        }catch(error){alert(error.message)}
      });
    }catch(error){
      openInfoDialog("الحسابات المحظورة",'<div class="empty error">'+escapeHtml(error.message)+'</div>');
    }
  };

  $("#securitySessionsButton").onclick=()=>{
    const email=state.user?.email||"غير متوفر";
    openInfoDialog("الأمان والجلسات",
      '<div class="settings-info">'+
        '<div class="info-row"><span>البريد الحالي</span><b>'+escapeHtml(email)+'</b></div>'+
        '<div class="info-row"><span>حالة الجلسة</span><b>نشطة</b></div>'+
        '<div class="settings-group"><h4>تغيير كلمة المرور</h4>'+
          '<label><span>كلمة المرور الجديدة</span><input id="securityPassword1" type="password" minlength="8" autocomplete="new-password"></label>'+
          '<label><span>تأكيد كلمة المرور</span><input id="securityPassword2" type="password" minlength="8" autocomplete="new-password"></label>'+
          '<button id="changePasswordButton" class="primary" type="button">تغيير كلمة المرور</button>'+
        '</div>'+
        '<div class="settings-group"><h4>تغيير البريد</h4>'+
          '<label><span>البريد الجديد</span><input id="securityEmail" type="email" autocomplete="email" placeholder="name@example.com"></label>'+
          '<button id="changeEmailButton" class="secondary-wide" type="button">إرسال طلب تغيير البريد</button>'+
        '</div>'+
        '<button id="globalSignOutButton" class="danger-wide" type="button">تسجيل الخروج من جميع الأجهزة</button>'+
        '<p id="securityMessage" class="message"></p>'+
      '</div>');
    $("#changePasswordButton").onclick=async()=>{
      const p1=$("#securityPassword1").value;
      const p2=$("#securityPassword2").value;
      if(p1.length<8)return $("#securityMessage").textContent="كلمة المرور يجب ألا تقل عن ٨ أحرف.";
      if(p1!==p2)return $("#securityMessage").textContent="كلمتا المرور غير متطابقتين.";
      $("#changePasswordButton").disabled=true;
      const {error}=await client.auth.updateUser({password:p1});
      $("#changePasswordButton").disabled=false;
      $("#securityMessage").textContent=error?error.message:"تم تغيير كلمة المرور.";
    };
    $("#changeEmailButton").onclick=async()=>{
      const next=$("#securityEmail").value.trim();
      if(!next)return $("#securityMessage").textContent="اكتب البريد الجديد.";
      $("#changeEmailButton").disabled=true;
      const {error}=await client.auth.updateUser({email:next});
      $("#changeEmailButton").disabled=false;
      $("#securityMessage").textContent=error?error.message:"تم إرسال طلب تغيير البريد. أكمل التحقق من البريد.";
    };
    $("#globalSignOutButton").onclick=async()=>{
      $("#globalSignOutButton").disabled=true;
      await client.auth.signOut({scope:"global"});
      $("#infoDialog").close();
    };
  };

  $("#supportTicketsButton").onclick=()=>openSupportCenter();
  $("#savedContentButton").onclick=()=>openSavedContent();
  $("#deleteAccountButton").onclick=async()=>{
    const confirmText=prompt("اكتب كلمة حذف لتأكيد حذف الحساب نهائيًا.");
    if(confirmText!=="حذف")return;
    if(!confirm("سيتم حذف الحساب ولن تتمكن من التراجع. هل تريد المتابعة؟"))return;
    $("#deleteAccountButton").disabled=true;
    try{
      await api("/v1/account",{method:"DELETE",body:JSON.stringify({confirm:"DELETE"})});
      await client.auth.signOut().catch(()=>{});
      $("#settingsDialog").close();
      showApp(false);
      showAuthMessage("تم حذف الحساب.");
    }catch(error){
      alert(error.message);
      $("#deleteAccountButton").disabled=false;
    }
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
        closeChatRealtime();
        state.activeConversation=null;
        clearChatAttachment();
      }
      if(dialog.id==="storyViewerDialog")clearTimeout(state.storyTimer);
      const returnProfile=dialog.id==="infoDialog"?state.returnPublicProfileId:null;
      state.returnPublicProfileId=null;
      try{dialog.close()}catch(_){}
      if(returnProfile){
        setTimeout(()=>openPublicProfile(returnProfile).catch(()=>{}),0);
      }
      return true;
    }
    const active=$(".page.active");
    if(active && active.id!=="homePage"){
      const previous=state.pageHistory.pop()||"homePage";
      navigateTo(previous,{fromBack:true,replace:true});
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
