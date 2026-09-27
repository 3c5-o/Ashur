(() => {
  const cfg = window.ASHUR_CONFIG;
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const state = { user:null, profile:null, composerType:"post", activeConversation:null };

  const escapeHtml = (v="") => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const initials = (name="آشور") => escapeHtml(name.trim().slice(0,1) || "آ");
  const nativeApiBase = () => {
    try { return window.AshurNative?.getApiBaseUrl?.() || ""; } catch { return ""; }
  };
  const apiUrl = (path) => (cfg.apiBaseUrl || nativeApiBase() || location.origin).replace(/\/$/,"") + path;

  function avatar(profile, cls="avatar"){
    if (profile?.avatar_media_id) return `<img class="${cls}" data-media-id="${profile.avatar_media_id}" alt="">`;
    return `<div class="${cls}" style="display:grid;place-items:center;background:#2a231e;color:#d7b16f;font-weight:800">${initials(profile?.name)}</div>`;
  }

  async function mediaUrl(mediaId){
    const result = await api("/v1/media-ticket/" + encodeURIComponent(mediaId));
    return apiUrl(result.path);
  }

  async function hydrateMedia(root=document){
    const nodes=[...root.querySelectorAll("[data-media-id]")];
    await Promise.all(nodes.map(async node=>{
      if(node.dataset.mediaReady==="1") return;
      try{
        node.src=await mediaUrl(node.dataset.mediaId);
        node.dataset.mediaReady="1";
      }catch(_){
        node.removeAttribute("src");
      }
    }));
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

  function showApp(loggedIn){
    $("#auth").classList.toggle("hidden", loggedIn);
    $("#app").classList.toggle("hidden", !loggedIn);
  }

  async function refreshProfile(){
    if(!state.user) return;
    const { data, error } = await client.from("profiles").select("*").eq("id",state.user.id).single();
    if(error) throw error;
    state.profile=data;
  }

  async function boot(){
    setTimeout(()=>$("#splash").style.opacity="0",900);
    setTimeout(()=>$("#splash").remove(),1400);
    const { data:{session} } = await client.auth.getSession();
    state.user=session?.user || null;
    if(state.user){
      await refreshProfile();
      await nativeLogin(state.user.id);
      showApp(true);
      await Promise.allSettled([loadHome(),loadNotificationsBadge()]);
    }else{
      showApp(false);
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
    if(state.user){
      await refreshProfile().catch(()=>{});
      await nativeLogin(state.user.id);
      showApp(true);
      loadHome(); loadNotificationsBadge();
    }else{
      state.profile=null; nativeLogout(); showApp(false);
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
    showAuthMessage("جارٍ إنشاء الحساب...",true);
    const {data,error}=await client.auth.signUp({email,password:p1,options:{data:{name}}});
    if(error) return showAuthMessage(error.message);
    if(data.session){
      const {error:claimError}=await client.rpc("claim_username",{p_username:username,p_name:name});
      if(claimError) return showAuthMessage(claimError.message);
      showAuthMessage("تم إنشاء الحساب",true);
    }else{
      showAuthMessage("تم إنشاء الحساب. افتح رسالة التحقق في بريدك ثم سجّل الدخول.",true);
    }
  };

  $("#forgotPassword").onclick=async()=>{
    const email=$("#loginEmail").value.trim();
    if(!email) return showAuthMessage("اكتب البريد الإلكتروني أولًا");
    const {error}=await client.auth.resetPasswordForEmail(email);
    showAuthMessage(error?error.message:"تم إرسال رابط استعادة كلمة المرور",!error);
  };

  $$(".nav-item").forEach(btn=>btn.onclick=()=>{
    $$(".nav-item").forEach(x=>x.classList.remove("active")); btn.classList.add("active");
    $$(".page").forEach(x=>x.classList.remove("active")); $("#"+btn.dataset.page).classList.add("active");
    if(btn.dataset.page==="searchPage") loadExplore();
    if(btn.dataset.page==="reelsPage") loadReels();
    if(btn.dataset.page==="messagesPage") loadConversations();
    if(btn.dataset.page==="profilePage") loadProfile();
  });

  async function loadHome(){
    $("#homeStatus").textContent="جارٍ تحميل أحدث المحتوى...";
    await Promise.all([loadStories(),loadFeed()]);
    $("#homeStatus").textContent="";
  }

  async function loadStories(){
    const since=new Date().toISOString();
    const {data,error}=await client.from("stories").select("id,author_id,media_id,caption,expires_at").gt("expires_at",since).order("created_at",{ascending:false}).limit(30);
    if(error){$("#stories").innerHTML="";return}
    const ids=[...new Set((data||[]).map(x=>x.author_id))];
    const profiles=await profilesMap(ids);
    let html=`<button class="story" data-own-story="1"><div class="story-ring"><div class="fallback">+</div></div><span>قصتك</span></button>`;
    html+=(data||[]).map(s=>{
      const p=profiles[s.author_id]||{};
      return `<button class="story" data-story="${s.id}" data-media="${s.media_id}"><div class="story-ring">${avatar(p,"avatar")}</div><span>${escapeHtml(p.username||p.name||"مستخدم")}</span></button>`
    }).join("");
    $("#stories").innerHTML=html;
    await hydrateMedia($("#stories"));
    $("#stories").querySelector("[data-own-story]")?.addEventListener("click",()=>openComposer("story"));
    $("#stories").querySelectorAll("[data-story]").forEach(b=>b.onclick=async()=>{
      try{ window.open(await mediaUrl(b.dataset.media),"_blank"); }catch(_){}
    });
  }

  async function profilesMap(ids){
    if(!ids.length) return {};
    const {data}=await client.from("profiles").select("id,name,username,avatar_media_id,is_verified,is_private").in("id",ids);
    return Object.fromEntries((data||[]).map(x=>[x.id,x]));
  }

  async function loadFeed(){
    const {data,error}=await client.from("posts").select("id,author_id,caption,created_at,comments_enabled,post_media(media_id,sort_order)").order("created_at",{ascending:false}).limit(30);
    if(error){$("#feed").innerHTML=`<div class="empty error">${escapeHtml(error.message)}</div>`;return}
    const profiles=await profilesMap([...new Set((data||[]).map(x=>x.author_id))]);
    if(!data?.length){$("#feed").innerHTML='<div class="empty">لا توجد منشورات بعد.</div>';return}
    $("#feed").innerHTML=data.map(post=>{
      const p=profiles[post.author_id]||{}, media=(post.post_media||[]).sort((a,b)=>a.sort_order-b.sort_order)[0]?.media_id;
      return `<article class="post">
        <div class="post-head">${avatar(p)}<div class="post-user"><b>${escapeHtml(p.name||"مستخدم")}${p.is_verified?" ✓":""}</b><small>@${escapeHtml(p.username||"")}</small></div></div>
        ${media?`<img class="post-media" loading="lazy" data-media-id="${media}" alt="">`:""}
        <div class="post-body"><div class="post-actions"><button class="action" data-like-post="${post.id}">إعجاب</button><button class="action">تعليق</button><button class="action">حفظ</button></div>
        ${post.caption?`<p class="caption">${escapeHtml(post.caption)}</p>`:""}</div>
      </article>`
    }).join("");
    await hydrateMedia($("#feed"));
    $("#feed").querySelectorAll("[data-like-post]").forEach(b=>b.onclick=()=>toggleLike("post",b.dataset.likePost,b));
  }

  async function toggleLike(type,id,button){
    if(!state.user)return;
    const table=type==="post"?"post_likes":"reel_likes";
    const target=type==="post"?"post_id":"reel_id";
    const {data}=await client.from(table).select("*").eq(target,id).eq("user_id",state.user.id).maybeSingle();
    if(data){await client.from(table).delete().eq(target,id).eq("user_id",state.user.id);button.textContent="إعجاب"}
    else{await client.from(table).insert({[target]:id,user_id:state.user.id});button.textContent="تم الإعجاب"}
  }

  async function loadExplore(){
    if($("#searchInput").value.trim()) return runSearch();
    const {data}=await client.from("reels").select("id,media_id,caption,author_id").eq("explore_enabled",true).order("created_at",{ascending:false}).limit(24);
    $("#searchResults").innerHTML=(data||[]).map(r=>`<div class="list-card"><div class="grow"><b>ريلز</b><div>${escapeHtml(r.caption||"")}</div></div><button class="small-button" data-open-media="${r.media_id}">فتح</button></div>`).join("")||'<div class="empty">سيظهر المحتوى المقترح هنا.</div>';
    $("#searchResults").querySelectorAll("[data-open-media]").forEach(b=>b.onclick=async()=>{
      try{ window.open(await mediaUrl(b.dataset.openMedia),"_blank"); }catch(_){}
    });
  }

  let searchTimer;
  $("#searchInput").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,300)};
  async function runSearch(){
    const q=$("#searchInput").value.trim();
    if(!q)return loadExplore();
    const {data,error}=await client.from("profiles").select("id,name,username,avatar_media_id,is_verified").or(`name.ilike.%${q.replace(/[,%]/g,"")}%,username.ilike.%${q.replace(/[,%]/g,"")}%`).limit(30);
    if(error){$("#searchResults").innerHTML=`<div class="empty error">${escapeHtml(error.message)}</div>`;return}
    $("#searchResults").innerHTML=(data||[]).map(p=>`<div class="list-card">${avatar(p)}<div class="grow"><b>${escapeHtml(p.name)}${p.is_verified?" ✓":""}</b><div>@${escapeHtml(p.username||"")}</div></div><button class="small-button" data-follow="${p.id}">متابعة</button></div>`).join("")||'<div class="empty">لا توجد نتائج.</div>';
    await hydrateMedia($("#searchResults"));
    $("#searchResults").querySelectorAll("[data-follow]").forEach(b=>b.onclick=()=>followUser(b.dataset.follow,b));
  }

  async function followUser(uid,btn){
    const {data:p}=await client.from("profiles").select("is_private").eq("id",uid).single();
    const status=p?.is_private?"pending":"accepted";
    const {error}=await client.from("follows").upsert({follower_id:state.user.id,following_id:uid,status});
    if(!error) btn.textContent=status==="pending"?"تم إرسال الطلب":"تتابعه";
  }

  async function loadReels(){
    const {data,error}=await client.from("reels").select("id,author_id,media_id,caption").order("created_at",{ascending:false}).limit(20);
    if(error){$("#reelsFeed").innerHTML='<div class="empty error">تعذر تحميل الريلز.</div>';return}
    const ps=await profilesMap([...new Set((data||[]).map(x=>x.author_id))]);
    $("#reelsFeed").innerHTML=(data||[]).map(r=>{
      const p=ps[r.author_id]||{};
      return `<article class="reel"><video playsinline controls preload="metadata" data-media-id="${r.media_id}"></video>
      <div class="reel-overlay"><b>${escapeHtml(p.name||p.username||"مستخدم")}</b><p>${escapeHtml(r.caption||"")}</p></div>
      <div class="reel-actions"><button class="action" data-like-reel="${r.id}">إعجاب</button></div></article>`
    }).join("")||'<div class="empty">لا توجد ريلز بعد.</div>';
    await hydrateMedia($("#reelsFeed"));
    $("#reelsFeed").querySelectorAll("[data-like-reel]").forEach(b=>b.onclick=()=>toggleLike("reel",b.dataset.likeReel,b));
  }

  async function loadConversations(){
    try{
      const list=await api("/v1/conversations");
      $("#conversationList").innerHTML=(list.items||[]).map(c=>`<button class="list-card" data-conversation="${c.id}" data-title="${escapeHtml(c.title||"محادثة")}"><div class="grow"><b>${escapeHtml(c.title||"محادثة")}</b><div>${escapeHtml(c.last_message||"")}</div></div></button>`).join("")||'<div class="empty">لا توجد محادثات بعد.</div>';
      $("#conversationList").querySelectorAll("[data-conversation]").forEach(b=>b.onclick=()=>openChat(b.dataset.conversation,b.dataset.title));
    }catch(e){$("#conversationList").innerHTML=`<div class="empty error">${escapeHtml(e.message)}</div>`}
  }

  async function openChat(id,title){
    state.activeConversation=id; $("#chatTitle").textContent=title||"المحادثة"; $("#chatDialog").showModal(); await loadChat();
  }
  async function loadChat(){
    if(!state.activeConversation)return;
    const {data}=await client.from("messages").select("id,sender_id,body,created_at").eq("conversation_id",state.activeConversation).order("created_at").limit(100);
    $("#chatMessages").innerHTML=(data||[]).map(m=>`<div class="bubble ${m.sender_id===state.user.id?"mine":"other"}">${escapeHtml(m.body)}</div>`).join("");
    $("#chatMessages").scrollTop=$("#chatMessages").scrollHeight;
  }
  $("#chatForm").onsubmit=async(e)=>{
    e.preventDefault(); const body=$("#chatInput").value.trim(); if(!body||!state.activeConversation)return;
    const {error}=await client.from("messages").insert({conversation_id:state.activeConversation,sender_id:state.user.id,body});
    if(!error){$("#chatInput").value="";await loadChat()}
  };
  $("#closeChat").onclick=()=>$("#chatDialog").close();

  async function loadProfile(){
    await refreshProfile();
    const [{count:posts},{count:followers},{count:following}] = await Promise.all([
      client.from("posts").select("*",{count:"exact",head:true}).eq("author_id",state.user.id),
      client.from("follows").select("*",{count:"exact",head:true}).eq("following_id",state.user.id).eq("status","accepted"),
      client.from("follows").select("*",{count:"exact",head:true}).eq("follower_id",state.user.id).eq("status","accepted")
    ]);
    $("#profileCard").innerHTML=`<div class="profile-top">${avatar(state.profile)}<div><h2>${escapeHtml(state.profile.name||"مستخدم")}</h2><div>@${escapeHtml(state.profile.username||"")}</div><p>${escapeHtml(state.profile.bio||"")}</p></div></div>
    <div class="profile-stats"><div><b>${posts||0}</b><span>منشور</span></div><div><b>${followers||0}</b><span>متابع</span></div><div><b>${following||0}</b><span>يتابع</span></div></div>
    <button id="logoutButton" class="small-button" style="margin-top:14px">تسجيل الخروج</button>`;
    $("#logoutButton").onclick=()=>client.auth.signOut();
    const {data}=await client.from("posts").select("id,caption,post_media(media_id,sort_order)").eq("author_id",state.user.id).order("created_at",{ascending:false});
    $("#profileContent").innerHTML=(data||[]).map(p=>`<article class="post">${p.post_media?.[0]?.media_id?`<img class="post-media" data-media-id="${p.post_media[0].media_id}">`:""}<div class="post-body">${escapeHtml(p.caption||"")}</div></article>`).join("")||'<div class="empty">لم تنشر شيئًا بعد.</div>';
    await hydrateMedia($("#profileCard"));
    await hydrateMedia($("#profileContent"));
  }

  async function loadNotificationsBadge(){
    if(!state.user)return;
    const {count}=await client.from("notifications").select("*",{count:"exact",head:true}).is("read_at",null);
    const badge=$("#notificationBadge"); badge.textContent=count||0; badge.classList.toggle("hidden",!count);
  }
  $("#notificationsButton").onclick=async()=>{
    $("#notificationsDialog").showModal();
    const {data}=await client.from("notifications").select("*").order("created_at",{ascending:false}).limit(100);
    $("#notificationsList").innerHTML=(data||[]).map(n=>`<div class="list-card"><div class="grow"><b>${escapeHtml(n.title)}</b><div>${escapeHtml(n.body)}</div></div></div>`).join("")||'<div class="empty">لا توجد إشعارات.</div>';
    await client.from("notifications").update({read_at:new Date().toISOString()}).eq("user_id",state.user.id).is("read_at",null);
    loadNotificationsBadge();
  };
  $("#closeNotifications").onclick=()=>$("#notificationsDialog").close();

  $("#publishButton").onclick=()=>$("#publishDialog").showModal();
  $("#closePublish").onclick=()=>$("#publishDialog").close();
  $("#publishDialog").querySelectorAll("[data-publish]").forEach(b=>b.onclick=()=>openComposer(b.dataset.publish));
  function openComposer(type){
    state.composerType=type; $("#publishDialog").close();
    $("#composerTitle").textContent=type==="story"?"إنشاء قصة":type==="reel"?"إنشاء ريلز":"إنشاء منشور";
    $("#composerFile").accept=type==="reel"?"video/*":"image/*,video/*";
    $("#composerMessage").textContent=""; $("#composerDialog").showModal();
  }
  $("#cancelComposer").onclick=()=>$("#composerDialog").close();

  $("#submitComposer").onclick=async()=>{
    const file=$("#composerFile").files[0], caption=$("#composerCaption").value.trim();
    if(!file)return $("#composerMessage").textContent="اختر ملفًا أولًا";
    if(file.size>cfg.maxUploadMb*1024*1024)return $("#composerMessage").textContent=`الحد الأقصى ${cfg.maxUploadMb} ميغابايت`;
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
      $("#composerDialog").close(); $("#composerFile").value=""; $("#composerCaption").value=""; await loadHome();
    }catch(e){$("#composerMessage").textContent=e.message}
    finally{$("#submitComposer").disabled=false}
  };

  async function uploadFile(file,kind){
    const token=await accessToken();
    const res=await fetch(apiUrl("/v1/storage/upload?kind="+encodeURIComponent(kind)),{
      method:"POST",
      headers:{"Authorization":"Bearer "+token,"Content-Type":file.type||"application/octet-stream","X-File-Name":encodeURIComponent(file.name),"Content-Length":String(file.size)},
      body:file
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||"فشل رفع الملف");
    return body;
  }

  $("#newMessageButton").onclick=()=>alert("إنشاء المحادثات الجديدة سيظهر هنا بعد ربط البحث بالمحادثات.");
  boot().catch(e=>{console.error(e);showAuthMessage("حدث خطأ أثناء بدء التطبيق")});
})();
