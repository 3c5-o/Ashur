(() => {
  const cfg = window.ASHUR_CONFIG;
  const authUtil = window.AshurAuth;
  const profileUtil = window.AshurProfile;
  const AUTH_REDIRECT_BASE = cfg.authRedirectUrl || "ashur://reset-password";
  const PENDING_CONFIRMATION_KEY = "ashur_pending_confirmation_email_v1";
  let recoveryModeActive = false;
  let authHydrationPromise = null;
  let authHydrationKey = "";
  let lastHydratedKey = "";

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const THEME_KEY="ashur_theme_v1";
  function currentTheme(){
    try{return localStorage.getItem(THEME_KEY)==="light"?"light":"dark"}catch{return "dark"}
  }
  function syncThemeControls(theme=currentTheme()){
    $$("[data-theme-choice]").forEach(button=>{
      const active=button.dataset.themeChoice===theme;
      button.classList.toggle("active",active);
      button.setAttribute("aria-checked",active?"true":"false");
    });
  }
  function applyTheme(theme,{persist=false}={}){
    const next=theme==="light"?"light":"dark";
    document.documentElement.dataset.theme=next;
    document.documentElement.style.colorScheme=next;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute("content",next==="light"?"#f6f8f7":"#050706");
    if(persist){
      try{localStorage.setItem(THEME_KEY,next)}catch(_){}
    }
    syncThemeControls(next);
    try{window.AshurNative?.setThemeMode?.(next)}catch(_){}
    return next;
  }
  applyTheme(currentTheme());

  const store = window.AshurCore.createStore({
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
    chatRefreshTimer:null,
    chatReconnectTimer:null,
    chatMessageIds:new Set(),
    chatMessageCache:new Map(),
    chatInitialLoaded:false,
    chatLastSyncAt:0,
    chatLoadSeq:0,
    inboxChannel:null,
    inboxRefreshTimer:null,
    pendingChatSendId:null,
    pendingChatMediaId:null,
    pendingChatFileKey:null,
    messageFilter:"all",
    conversationCache:new Map(),
    conversationCreateMode:"direct",
    selectedGroupMembers:new Map(),
    activeConversationMeta:null,
    viewedReels:new Set(),
    reelViewTimers:new Map(),
    composerPublishing:false,
    composerDraftTimer:null,
    composerDraftRestoring:false,
    cameraStream:null,
    cameraFacing:"environment",
    cameraMode:"photo",
    cameraTimerSeconds:0,
    cameraRecorder:null,
    cameraChunks:[],
    cameraRecordingStarted:0,
    cameraRecordingTimer:null,
    cameraTorch:false,
    mediaViewerZoom:1,
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
    composerFiles:[],
    reelCoverFile:null,
    reelCoverUrl:null,
    recordedVoiceFile:null,
    voiceRecorder:null,
    voiceStream:null,
    voiceChunks:[],
    voiceStartedAt:0,
    voiceTimer:null,
    feedOffset:0,
    feedLoading:false,
    feedDone:false,
    reelOffset:0,
    reelLoading:false,
    reelDone:false,
    interactionLocks:new Set(),
    features:{},
    limits:{}
  });
  const state = store.state;
  const router = window.AshurCore.createRouter({
    initialRoute:"homePage",
    history:state.pageHistory,
    maxHistory:20,
    isValid:(page)=>Boolean(document.getElementById(page))
  });

  const escapeHtml = (v="") => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const initials = (name="آشور") => escapeHtml(name.trim().slice(0,1) || "آ");
  const richText = (value="") => {
    const escaped=escapeHtml(value);
    return escaped
      .replace(/(^|\s)@([A-Za-z0-9_.]{2,10})/g,'$1<button class="inline-tag mention-tag" type="button" data-inline-mention="$2">@$2</button>')
      .replace(/(^|\s)#([\p{L}\p{N}_]{2,50})/gu,'$1<button class="inline-tag hashtag-tag" type="button" data-inline-hashtag="$2">#$2</button>')
      .replace(/\n/g,"<br>");
  };
  const chatTextMarkup = (value="") => {
    const text=String(value||"");
    const pattern=/https?:\/\/[^\s<>"']+/gi;
    let html="";
    let cursor=0;
    for(const match of text.matchAll(pattern)){
      const index=Number(match.index||0);
      html+=richText(text.slice(cursor,index));
      const raw=match[0];
      const href=safeLink(raw);
      html+=href
        ?'<a class="message-link" href="'+escapeHtml(href)+'" target="_blank" rel="noopener">'+escapeHtml(raw)+'</a>'
        :escapeHtml(raw);
      cursor=index+raw.length;
    }
    html+=richText(text.slice(cursor));
    return html;
  };

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
      play:'<path d="M8 5v14l11-7Z"/>',
      eye:'<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>',
      pin:'<path d="m9 3 6 1-1 5 3 3v2H7v-2l3-3Z"/><path d="M12 14v7"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[name]||'')+'</svg>';
  };
  const nativeApiBase = () => {
    try { return window.AshurNative?.getApiBaseUrl?.() || ""; } catch { return ""; }
  };
  const apiUrl = (path) => (cfg.apiBaseUrl || nativeApiBase() || location.origin).replace(/\/$/,"") + path;

  const editableTarget = (target) => Boolean(
    target?.closest?.("input,textarea,[contenteditable='true'],[data-allow-select='true']")
  );
  document.addEventListener("contextmenu",(event)=>{
    if(!editableTarget(event.target))event.preventDefault();
  },{capture:true});
  document.addEventListener("selectstart",(event)=>{
    if(!editableTarget(event.target))event.preventDefault();
  },{capture:true});
  document.addEventListener("dragstart",(event)=>{
    if(!editableTarget(event.target))event.preventDefault();
  },{capture:true});

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

  function formatMediaTime(value){
    const total=Math.max(0,Math.floor(Number(value)||0));
    const minutes=Math.floor(total/60);
    const seconds=String(total%60).padStart(2,"0");
    return minutes+":"+seconds;
  }

  function mediaCanEnhance(node){
    if(!node?.isConnected)return false;
    return !node.closest(".reel,.story-viewer,.camera-studio-dialog,.profile-grid-tile,.story-shared-card");
  }

  function updateVideoPlayIcon(button,playing){
    if(!button)return;
    button.innerHTML=playing
      ?'<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7ZM13 5h4v14h-4Z"/></svg>'
      :'<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg>';
    button.setAttribute("aria-label",playing?"إيقاف":"تشغيل");
  }

  function enhanceVideoPlayer(video){
    if(!video||video.dataset.ashurPlayer==="1"||!mediaCanEnhance(video))return;
    video.dataset.ashurPlayer="1";
    video.controls=false;
    video.playsInline=true;
    video.preload=video.preload||"metadata";

    const wrapper=document.createElement("div");
    wrapper.className="ashur-video-player";
    video.parentNode.insertBefore(wrapper,video);
    wrapper.appendChild(video);

    const controls=document.createElement("div");
    controls.className="ashur-video-controls";
    controls.innerHTML=
      '<button class="ashur-video-toggle" type="button" aria-label="تشغيل"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg></button>'+
      '<span class="ashur-video-time current">0:00</span>'+
      '<input class="ashur-video-range" type="range" min="0" max="1000" value="0" aria-label="موضع الفيديو">'+
      '<span class="ashur-video-time duration">0:00</span>'+
      '<button class="ashur-video-mute" type="button" aria-label="كتم الصوت"><svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6L9 10Z"/><path d="M18 9c1 1 1 5 0 6"/></svg></button>'+
      '<button class="ashur-video-fullscreen" type="button" aria-label="ملء الشاشة"><svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>';
    wrapper.appendChild(controls);

    const center=document.createElement("button");
    center.className="ashur-video-center";
    center.type="button";
    center.setAttribute("aria-label","تشغيل");
    center.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg>';
    wrapper.appendChild(center);

    const toggle=controls.querySelector(".ashur-video-toggle");
    const range=controls.querySelector(".ashur-video-range");
    const current=controls.querySelector(".current");
    const duration=controls.querySelector(".duration");
    const mute=controls.querySelector(".ashur-video-mute");
    const fullscreen=controls.querySelector(".ashur-video-fullscreen");

    const sync=()=>{
      const total=Number(video.duration)||0;
      const now=Number(video.currentTime)||0;
      current.textContent=formatMediaTime(now);
      duration.textContent=formatMediaTime(total);
      range.value=total>0?String(Math.min(1000,Math.round((now/total)*1000))):"0";
      updateVideoPlayIcon(toggle,!video.paused);
      center.classList.toggle("hidden",!video.paused);
      wrapper.classList.toggle("playing",!video.paused);
    };

    const togglePlay=async()=>{
      if(video.paused){
        document.querySelectorAll(".ashur-video-player video").forEach(other=>{if(other!==video)other.pause()});
        await video.play().catch(()=>{});
      }else video.pause();
      sync();
    };

    toggle.onclick=e=>{e.stopPropagation();togglePlay()};
    center.onclick=e=>{e.stopPropagation();togglePlay()};
    video.onclick=e=>{e.stopPropagation();togglePlay()};
    video.addEventListener("play",sync);
    video.addEventListener("pause",sync);
    video.addEventListener("timeupdate",sync);
    video.addEventListener("loadedmetadata",sync);
    video.addEventListener("ended",sync);

    range.oninput=e=>{
      e.stopPropagation();
      const total=Number(video.duration)||0;
      if(total>0)video.currentTime=(Number(range.value)/1000)*total;
    };

    mute.onclick=e=>{
      e.stopPropagation();
      video.muted=!video.muted;
      mute.classList.toggle("active",video.muted);
      mute.innerHTML=video.muted
        ?'<svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6L9 10Z"/><path d="m18 9 3 3-3 3"/></svg>'
        :'<svg viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6L9 10Z"/><path d="M18 9c1 1 1 5 0 6"/></svg>';
    };

    fullscreen.onclick=async e=>{
      e.stopPropagation();
      try{
        if(wrapper.requestFullscreen)await wrapper.requestFullscreen();
        else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();
      }catch(_){}
    };
    sync();
  }

  function enhanceAudioPlayer(audio,access={}){
    if(!audio||audio.dataset.ashurPlayer==="1"||!mediaCanEnhance(audio))return;
    audio.dataset.ashurPlayer="1";
    audio.controls=false;
    audio.preload="metadata";

    const wrapper=document.createElement("div");
    wrapper.className="ashur-audio-player";
    audio.parentNode.insertBefore(wrapper,audio);
    wrapper.appendChild(audio);

    const audioLabel=audio.closest(".message-row,.chat-attachment-preview")
      ?"رسالة صوتية"
      :"مقطع صوتي";

    wrapper.insertAdjacentHTML("beforeend",
      '<button class="ashur-audio-toggle" type="button" aria-label="تشغيل"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg></button>'+
      '<div class="ashur-audio-main"><div class="ashur-audio-wave" aria-hidden="true">'+
        Array.from({length:26},(_,i)=>'<i style="--h:'+((i*17)%13+7)+'px"></i>').join("")+
      '</div><input class="ashur-audio-range" type="range" min="0" max="1000" value="0" aria-label="موضع الصوت">'+
      '<div class="ashur-audio-meta"><span class="current">0:00</span><b>'+escapeHtml(audioLabel)+'</b><span class="duration">0:00</span></div></div>'+
      '<button class="ashur-audio-speed" type="button" aria-label="سرعة التشغيل">1x</button>'
    );

    const toggle=wrapper.querySelector(".ashur-audio-toggle");
    const range=wrapper.querySelector(".ashur-audio-range");
    const current=wrapper.querySelector(".current");
    const duration=wrapper.querySelector(".duration");
    const speed=wrapper.querySelector(".ashur-audio-speed");

    const sync=()=>{
      const total=Number(audio.duration)||0;
      const now=Number(audio.currentTime)||0;
      current.textContent=formatMediaTime(now);
      duration.textContent=formatMediaTime(total);
      range.value=total>0?String(Math.min(1000,Math.round((now/total)*1000))):"0";
      updateVideoPlayIcon(toggle,!audio.paused);
      wrapper.classList.toggle("playing",!audio.paused);
    };

    toggle.onclick=async e=>{
      e.stopPropagation();
      if(audio.paused){
        document.querySelectorAll(".ashur-audio-player audio").forEach(other=>{if(other!==audio)other.pause()});
        await audio.play().catch(()=>{});
      }else audio.pause();
      sync();
    };
    range.oninput=e=>{
      e.stopPropagation();
      const total=Number(audio.duration)||0;
      if(total>0)audio.currentTime=(Number(range.value)/1000)*total;
    };
    speed.onclick=e=>{
      e.stopPropagation();
      const speeds=[1,1.5,2];
      const currentIndex=speeds.indexOf(audio.playbackRate);
      audio.playbackRate=speeds[(currentIndex+1)%speeds.length];
      speed.textContent=audio.playbackRate+"x";
    };
    audio.addEventListener("timeupdate",sync);
    audio.addEventListener("loadedmetadata",sync);
    audio.addEventListener("play",sync);
    audio.addEventListener("pause",sync);
    audio.addEventListener("ended",sync);
    sync();
  }

  async function openMediaViewer(mediaId,knownAccess=null){
    if(!mediaId)return;
    const dialog=$("#mediaViewerDialog");
    const stage=$("#mediaViewerStage");
    const toolbar=$("#mediaViewerToolbar");
    stage.innerHTML='<div class="media-viewer-loading">جارٍ تحميل الوسائط...</div>';
    toolbar.innerHTML="";
    toolbar.classList.add("hidden");
    $("#mediaViewerMeta").textContent="";
    state.mediaViewerZoom=1;
    if(!dialog.open)dialog.showModal();

    try{
      const access=knownAccess||await mediaAccess(mediaId);
      const mime=String(access.mime_type||"");
      $("#mediaViewerMeta").textContent=(
        mime.startsWith("image/")?"صورة":mime.startsWith("video/")?"فيديو":mime.startsWith("audio/")?"صوت":"ملف"
      );

      if(mime.startsWith("image/")){
        stage.innerHTML='<div class="media-viewer-image-wrap"><img id="mediaViewerImage" src="'+escapeHtml(access.url)+'" alt=""></div>';
        toolbar.innerHTML='<button data-viewer-zoom="out" type="button">−</button><button data-viewer-zoom="reset" type="button">100%</button><button data-viewer-zoom="in" type="button">+</button>';
        toolbar.classList.remove("hidden");
        const image=$("#mediaViewerImage");
        const applyZoom=()=>{image.style.transform="scale("+state.mediaViewerZoom+")";toolbar.querySelector('[data-viewer-zoom="reset"]').textContent=Math.round(state.mediaViewerZoom*100)+"%"};
        toolbar.querySelector('[data-viewer-zoom="out"]').onclick=()=>{state.mediaViewerZoom=Math.max(1,state.mediaViewerZoom-.25);applyZoom()};
        toolbar.querySelector('[data-viewer-zoom="in"]').onclick=()=>{state.mediaViewerZoom=Math.min(4,state.mediaViewerZoom+.25);applyZoom()};
        toolbar.querySelector('[data-viewer-zoom="reset"]').onclick=()=>{state.mediaViewerZoom=1;applyZoom()};
        let startDistance=0,startZoom=1;
        stage.ontouchstart=e=>{
          if(e.touches?.length===2){
            startDistance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
            startZoom=state.mediaViewerZoom;
          }
        };
        stage.ontouchmove=e=>{
          if(e.touches?.length===2&&startDistance>0){
            e.preventDefault();
            const distance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
            state.mediaViewerZoom=Math.max(1,Math.min(4,startZoom*(distance/startDistance)));
            applyZoom();
          }
        };
      }else if(mime.startsWith("video/")){
        stage.innerHTML='<video class="media-viewer-video" src="'+escapeHtml(access.url)+'" playsinline preload="metadata"></video>';
        enhanceVideoPlayer(stage.querySelector("video"));
      }else if(mime.startsWith("audio/")){
        stage.innerHTML='<div class="media-viewer-audio-shell"><div class="media-viewer-audio-icon"><svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 9l11-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg></div><audio src="'+escapeHtml(access.url)+'" preload="metadata"></audio></div>';
        enhanceAudioPlayer(stage.querySelector("audio"),access);
      }else{
        stage.innerHTML='<a class="media-viewer-file" href="'+escapeHtml(access.url)+'" target="_blank" rel="noopener">فتح الملف</a>';
      }
    }catch(error){
      stage.innerHTML='<div class="empty error">'+escapeHtml(error.message||"تعذر تحميل الوسائط")+'</div>';
    }
  }

  function enhanceMediaNode(node,access={}){
    if(!node?.isConnected)return;
    if(node.tagName==="VIDEO")enhanceVideoPlayer(node);
    if(node.tagName==="AUDIO")enhanceAudioPlayer(node,access);
    if(node.tagName==="IMG"&&node.matches(".post-media,.chat-media,.profile-preview-media")){
      if(node.dataset.ashurViewer==="1")return;
      node.dataset.ashurViewer="1";
      node.classList.add("ashur-media-clickable");
      node.addEventListener("click",event=>{
        event.preventDefault();
        event.stopPropagation();
        openMediaViewer(node.dataset.mediaId,access);
      });
    }
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
          let finalNode=node;
          if(access.mime_type?.startsWith("video/") && node.tagName==="IMG"){
            const video=document.createElement("video");
            const coverMode=node.dataset.profileCover==="1";
            video.className=node.className;
            video.dataset.mediaId=node.dataset.mediaId;
            video.dataset.mediaReady="1";
            if(coverMode)video.dataset.videoCover="1";
            video.src=access.url+(coverMode?"#t=0.12":"");
            video.controls=false;
            video.muted=coverMode;
            video.playsInline=true;
            video.preload="metadata";
            node.replaceWith(video);
            finalNode=video;
          }else if(access.mime_type?.startsWith("audio/") && node.tagName==="IMG"){
            const audio=document.createElement("audio");
            audio.className=(node.className+" chat-audio").trim();
            audio.dataset.mediaId=node.dataset.mediaId;
            audio.dataset.mediaReady="1";
            audio.src=access.url;
            audio.controls=false;
            audio.preload="metadata";
            node.replaceWith(audio);
            finalNode=audio;
          }else if(node.tagName==="IMG" && access.mime_type && !access.mime_type.startsWith("image/")){
            const link=document.createElement("a");
            link.className="chat-file-link";
            link.dataset.mediaReady="1";
            link.href=access.url;
            link.target="_blank";
            link.rel="noopener";
            link.textContent="فتح الملف";
            node.replaceWith(link);
            finalNode=link;
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
            finalNode=node;
          }
          enhanceMediaNode(finalNode,access);
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

  $("#closeMediaViewer").onclick=()=>{
    $("#mediaViewerStage").querySelectorAll("video,audio").forEach(media=>media.pause?.());
    $("#mediaViewerDialog").close();
    $("#mediaViewerStage").innerHTML="";
  };
  $("#mediaViewerDialog").addEventListener("cancel",event=>{
    event.preventDefault();
    $("#closeMediaViewer").click();
  });

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
    const { data, error } = await client.auth.getSession();
    if(error)throw error;
    return data.session?.access_token || "";
  }

  async function api(path, options={}){
    const {retrySafe=false, gatewayTimeoutMs, ...fetchOptions}=options;
    const method=String(fetchOptions.method||"GET").toUpperCase();
    const canRetry=retrySafe===true||method==="GET"||method==="HEAD";
    const maxAttempts=canRetry?3:1;
    const timeoutMs=Number(gatewayTimeoutMs||12000);

    const request = async(token)=>{
      let lastError=null;
      for(let attempt=0;attempt<maxAttempts;attempt++){
        const headers = new Headers(fetchOptions.headers || {});
        if(token) headers.set("Authorization", "Bearer "+token);
        const controller=canRetry&&typeof AbortController!=="undefined"?new AbortController():null;
        const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
        try{
          const res=await fetch(apiUrl(path), {
            ...fetchOptions,
            headers,
            ...(controller?{signal:controller.signal}:{})
          });
          if(timer)clearTimeout(timer);
          if(canRetry&&[502,503,504].includes(res.status)&&attempt<maxAttempts-1){
            await new Promise(resolve=>setTimeout(resolve,attempt===0?450:1100));
            continue;
          }
          setNetworkState(true);
          return res;
        }catch(error){
          if(timer)clearTimeout(timer);
          lastError=error;
          if(!canRetry||attempt>=maxAttempts-1)break;
          await new Promise(resolve=>setTimeout(resolve,attempt===0?450:1100));
        }
      }
      setNetworkState(false,"تعذر الاتصال ببوابة آشور. جارٍ إعادة الاتصال.");
      const gatewayError=new Error("تعذر الاتصال ببوابة آشور. تحقق من الإنترنت وحاول مجددًا.");
      gatewayError.cause=lastError;
      throw gatewayError;
    };

    let token = await accessToken().catch(()=>"");
    let res = await request(token);
    if(res.status===401 && token){
      const refreshed = await client.auth.refreshSession();
      const nextToken = refreshed.data?.session?.access_token || "";
      if(!refreshed.error && nextToken){
        token = nextToken;
        res = await request(token);
      }
    }

    const type = res.headers.get("content-type") || "";
    const body = type.includes("json") ? await res.json() : await res.text();
    if(!res.ok){
      if(res.status===401)throw new Error("انتهت جلسة الدخول. سجّل الدخول من جديد.");
      if([502,503,504].includes(res.status)){
        setNetworkState(false,"بوابة آشور تعيد الاتصال بالخدمة.");
        throw new Error("الخدمة تعيد الاتصال الآن. حاول مرة أخرى بعد قليل.");
      }
      throw new Error(body?.error || body?.message || body || "تعذر تنفيذ الطلب");
    }
    return body;
  }

  const authRedirect = (flow) => flow==="recovery" ? AUTH_REDIRECT_BASE : authUtil.buildRedirect(AUTH_REDIRECT_BASE, flow);

  function setAuthBusy(form,busy){
    if(!form)return;
    form.setAttribute("aria-busy",busy?"true":"false");
    form.querySelectorAll("button,input").forEach(control=>{
      control.disabled=Boolean(busy);
    });
  }

  function setAuthView(view){
    const login=view==="login";
    const register=view==="register";
    const recovery=view==="recovery";
    showApp(false);
    $("#loginForm").classList.toggle("hidden",!login);
    $("#registerForm").classList.toggle("hidden",!register);
    $("#passwordRecoveryForm").classList.toggle("hidden",!recovery);
    $(".auth-tabs").classList.toggle("hidden",recovery);
    $("#loginTab").classList.toggle("active",login);
    $("#registerTab").classList.toggle("active",register);
  }

  function rememberPendingConfirmation(email=""){
    const normalized=authUtil.normalizeEmail(email);
    try{
      if(normalized)localStorage.setItem(PENDING_CONFIRMATION_KEY,normalized);
      else localStorage.removeItem(PENDING_CONFIRMATION_KEY);
    }catch(_){}
    const button=$("#resendConfirmation");
    if(button)button.classList.toggle("hidden",!normalized);
    return normalized;
  }

  function pendingConfirmationEmail(){
    try{return authUtil.normalizeEmail(localStorage.getItem(PENDING_CONFIRMATION_KEY)||"")}
    catch{return ""}
  }

  const REGISTRATION_MEDIA_DB="ashur_registration_media_v1";
  const REGISTRATION_MEDIA_STORE="pending_avatar";
  let registerAvatarFile=null;
  let registerAvatarObjectUrl="";

  function openRegistrationMediaDb(){
    return new Promise((resolve,reject)=>{
      if(!("indexedDB" in window))return reject(new Error("IndexedDB unavailable"));
      const request=indexedDB.open(REGISTRATION_MEDIA_DB,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(REGISTRATION_MEDIA_STORE)){
          db.createObjectStore(REGISTRATION_MEDIA_STORE,{keyPath:"email"});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error("تعذر فتح التخزين المحلي"));
    });
  }

  async function savePendingRegistrationAvatar(email,file){
    const normalized=authUtil.normalizeEmail(email);
    if(!normalized||!file)return;
    const db=await openRegistrationMediaDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(REGISTRATION_MEDIA_STORE,"readwrite");
      tx.objectStore(REGISTRATION_MEDIA_STORE).put({
        email:normalized,
        file,
        saved_at:Date.now()
      });
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error("تعذر حفظ الصورة مؤقتًا"));
    });
    db.close();
  }

  async function takePendingRegistrationAvatar(email){
    const normalized=authUtil.normalizeEmail(email);
    if(!normalized)return null;
    const db=await openRegistrationMediaDb().catch(()=>null);
    if(!db)return null;
    const value=await new Promise(resolve=>{
      const tx=db.transaction(REGISTRATION_MEDIA_STORE,"readwrite");
      const store=tx.objectStore(REGISTRATION_MEDIA_STORE);
      const request=store.get(normalized);
      request.onsuccess=()=>{
        const row=request.result||null;
        if(row)store.delete(normalized);
        resolve(row?.file||null);
      };
      request.onerror=()=>resolve(null);
    });
    db.close();
    return value;
  }

  async function clearPendingRegistrationAvatar(email){
    const normalized=authUtil.normalizeEmail(email);
    if(!normalized)return;
    const db=await openRegistrationMediaDb().catch(()=>null);
    if(!db)return;
    await new Promise(resolve=>{
      const tx=db.transaction(REGISTRATION_MEDIA_STORE,"readwrite");
      tx.objectStore(REGISTRATION_MEDIA_STORE).delete(normalized);
      tx.oncomplete=resolve;
      tx.onerror=resolve;
    });
    db.close();
  }

  function resetRegisterAvatar(){
    registerAvatarFile=null;
    if(registerAvatarObjectUrl){
      try{URL.revokeObjectURL(registerAvatarObjectUrl)}catch(_){}
      registerAvatarObjectUrl="";
    }
    const input=$("#registerAvatar");
    if(input)input.value="";
    const wrap=$("#registerAvatarPreview");
    const img=wrap?.querySelector("img");
    const plus=wrap?.querySelector("b");
    if(img){
      img.classList.add("hidden");
      img.removeAttribute("src");
    }
    if(plus)plus.classList.remove("hidden");
    $("#removeRegisterAvatar")?.classList.add("hidden");
  }

  async function applyPendingRegistrationAvatar(email){
    if(!state.user)return;
    const file=await takePendingRegistrationAvatar(email);
    if(!file)return;
    const check=profileUtil.validateImageFile(file);
    if(!check.ok)return;
    try{
      const media=await uploadFile(file,"profile",{silent:true});
      await updateOwnProfile({avatar_media_id:media.id});
    }catch(error){
      console.warn("ASHUR_REGISTER_AVATAR_APPLY_FAILED",error);
    }
  }

  function enterPasswordRecoveryMode(message="اكتب كلمة المرور الجديدة للحساب."){
    recoveryModeActive=true;
    setAuthView("recovery");
    showAuthMessage(message,true);
  }

  function clearAuthSession(){
    recoveryModeActive=false;
    closeChatRealtime();
    closeInboxRealtime();
    authHydrationKey="";
    authHydrationPromise=null;
    lastHydratedKey="";
    state.user=null;
    state.profile=null;
    try{localStorage.removeItem(PROFILE_CACHE_KEY)}catch(_){}
    nativeLogout();
    showApp(false);
    store.emit("auth:signed-out",{});
  }

  function sessionKey(session){
    if(!session?.user?.id)return "";
    return session.user.id+":"+String(session.access_token||"").slice(-24);
  }

  async function hydrateAuthenticatedSession(session,{reason="auth"}={}){
    if(!session?.user){
      clearAuthSession();
      return;
    }
    const key=sessionKey(session);
    state.user=session.user;

    if(lastHydratedKey===key && !$("#app").classList.contains("hidden")){
      return;
    }
    if(authHydrationPromise && authHydrationKey===key){
      return authHydrationPromise;
    }

    authHydrationKey=key;
    authHydrationPromise=(async()=>{
      state.profile=readCachedProfile(state.user.id);
      showApp(true);
      await nativeLogin(state.user.id);
      try{
        await refreshProfile();
        await ensureProfileIdentity();
        await applyPendingRegistrationAvatar(session.user.email||"").catch(()=>{});
        await refreshProfile();
        setNetworkState(true);
      }catch(error){
        console.warn("ASHUR_PROFILE_OFFLINE",error);
        setNetworkState(false,"تعذر الاتصال بالخدمة. سيتم عرض آخر بيانات متاحة.");
      }
      await checkRuntimeSettings().catch(()=>{});
      await Promise.allSettled([loadHome(),loadNotificationsBadge()]);
      lastHydratedKey=key;
      rememberPendingConfirmation("");
      store.emit("auth:ready",{userId:state.user.id,reason});
    })();

    try{
      await authHydrationPromise;
    }finally{
      if(authHydrationKey===key){
        authHydrationPromise=null;
        authHydrationKey="";
      }
    }
  }

  window.ASHUR_HANDLE_AUTH_LINK=async(link)=>{
    let parsed;
    try{
      parsed=authUtil.parseAuthLink(link);
      if(parsed.error || parsed.errorDescription){
        const error=new Error(parsed.errorDescription||parsed.error);
        error.code=parsed.errorCode||parsed.error;
        throw error;
      }

      recoveryModeActive=parsed.flow==="recovery";
      let session=null;

      if(parsed.code){
        const options=parsed.flowId?{flowId:parsed.flowId}:undefined;
        const result=await client.auth.exchangeCodeForSession(parsed.code,options);
        if(result.error)throw result.error;
        session=result.data?.session||null;
      }else if(parsed.accessToken&&parsed.refreshToken){
        const result=await client.auth.setSession({
          access_token:parsed.accessToken,
          refresh_token:parsed.refreshToken
        });
        if(result.error)throw result.error;
        session=result.data?.session||null;
      }else{
        throw new Error("رابط التحقق غير مكتمل أو منتهي.");
      }

      if(!session?.user)throw new Error("تعذر إنشاء جلسة للحساب.");

      state.user=session.user;
      if(parsed.flow==="recovery"){
        enterPasswordRecoveryMode();
      }else{
        recoveryModeActive=false;
        rememberPendingConfirmation("");
        await hydrateAuthenticatedSession(session,{reason:"email-confirmation"});
      }
      return true;
    }catch(error){
      recoveryModeActive=false;
      setAuthView("login");
      showAuthMessage(authUtil.errorMessage(error,"تعذر فتح رابط التحقق. اطلب رابطًا جديدًا."));
      return false;
    }
  };

  if(window.location.hostname!=="appassets.androidplatform.net"){
    const currentAuthLink=window.location.href;
    if(/[?#&](code|access_token|refresh_token|error|error_code|type)=/i.test(currentAuthLink)){
      setTimeout(()=>window.ASHUR_HANDLE_AUTH_LINK(currentAuthLink),0);
    }
  }

  function showAuthMessage(text, good=false){
    const el=$("#authMessage");
    if(!el)return;
    el.textContent=text||"";
    el.className="message "+(text?(good?"success":"error"):"");
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
      router.reset("homePage");
      state.activePage="homePage";
      store.emit("session:reset",{activePage:"homePage"});
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
        closeChatRealtime();
        state.activeConversation=null;
        state.activeConversationMeta=null;
        clearChatAttachment();
      }
      if(dialog.id==="cameraStudioDialog"){
        closeCameraStudio({returnToComposer:false});
        return;
      }
      if(dialog.id==="mediaViewerDialog"){
        $("#mediaViewerStage")?.querySelectorAll("video,audio").forEach(media=>media.pause?.());
        $("#mediaViewerStage").innerHTML="";
      }
      try{dialog.close()}catch(_){}
    });
  }

  function openDialog(dialog){
    if(!dialog)return;
    closeTransientDialogs(dialog);
    if(!dialog.open)dialog.showModal();
  }

  function confirmAction({
    title="تأكيد الإجراء",
    text="هل تريد المتابعة؟",
    acceptLabel="تأكيد",
    danger=false
  }={}){
    return new Promise(resolve=>{
      const dialog=$("#confirmDialog");
      const accept=$("#confirmAccept");
      const cancel=$("#confirmCancel");
      const finish=value=>{
        if(dialog.open)dialog.close();
        accept.onclick=null;
        cancel.onclick=null;
        dialog.oncancel=null;
        resolve(value);
      };
      $("#confirmTitle").textContent=title;
      $("#confirmText").textContent=text;
      $("#confirmIcon").innerHTML=danger
        ?'<svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v4M12 17h.01"/></svg>'
        :'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5 10.7 15 16 9"/></svg>';
      dialog.classList.toggle("danger",danger);
      accept.className=danger?"danger-wide":"primary";
      accept.textContent=acceptLabel;
      cancel.textContent="إلغاء";
      accept.onclick=()=>finish(true);
      cancel.onclick=()=>finish(false);
      dialog.oncancel=e=>{e.preventDefault();finish(false)};
      if(!dialog.open)dialog.showModal();
    });
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

  const runtimeFeatureLabels={
    stories:"القصص",reels:"الريلز",messages:"الرسائل",groups:"المجموعات",
    registration:"إنشاء الحساب",comments:"التعليقات",search:"البحث",explore:"الاكتشاف",
    saved:"المحفوظات",notifications:"الإشعارات",uploads:"رفع الملفات"
  };
  function runtimeFeatureEnabled(key){
    return state.features?.[key]!==false;
  }
  function runtimeFeatureError(key){
    return (runtimeFeatureLabels[key]||"هذه الميزة")+" متوقفة مؤقتًا من إدارة آشور.";
  }
  function maintenanceIsActive(maintenance={}){
    if(!maintenance.enabled)return false;
    const now=Date.now();
    const start=maintenance.start_at?new Date(maintenance.start_at).getTime():null;
    const end=maintenance.end_at?new Date(maintenance.end_at).getTime():null;
    if(start&&Number.isFinite(start)&&now<start)return false;
    if(end&&Number.isFinite(end)&&now>=end)return false;
    return true;
  }
  function runtimeUploadLimitMb(kind,file){
    const limits=state.limits||{};
    if(kind==="story")return Number(limits.story_mb||30);
    if(kind==="reel")return Number(limits.reel_mb||limits.max_upload_mb||cfg.maxUploadMb||60);
    if(kind==="profile"||kind==="profile_cover"||kind==="post_image"||kind==="reel_cover"||kind==="chat_image"){
      return Number(limits.image_mb||10);
    }
    if(kind==="chat_video"||kind==="chat_file")return Number(limits.chat_video_mb||50);
    if(kind==="chat_audio")return Number(limits.audio_mb||15);
    if(file?.type?.startsWith("image/"))return Number(limits.image_mb||10);
    return Number(limits.max_upload_mb||cfg.maxUploadMb||60);
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
    $$('[data-create-mode="group"]').forEach(node=>node.classList.toggle("hidden",state.features.groups===false));
    $("#createGroupButton")?.classList.toggle("hidden",state.features.groups===false);

    const current=cfg.appVersion||"1.0.0";
    const required=Boolean(version.required) ||
      (version.minimum && compareVersions(current,version.minimum)<0);

    if(maintenanceIsActive(maintenance)){
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
    if(!/^[a-z0-9_.]{2,10}$/.test(username))return;
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
    rememberPendingConfirmation(pendingConfirmationEmail());

    try{
      await checkRuntimeSettings().catch(()=>{});
      const {data:{session},error:sessionError}=await client.auth.getSession();
      if(sessionError)throw sessionError;
      if(!session){
        clearAuthSession();
        return;
      }
      await hydrateAuthenticatedSession(session,{reason:"boot"});
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

  async function handleAuthEvent(event,session){
    if(event==="INITIAL_SESSION")return;
    if(event==="SIGNED_OUT"){
      clearAuthSession();
      return;
    }

    state.user=session?.user||null;

    if(event==="PASSWORD_RECOVERY"){
      if(state.user)enterPasswordRecoveryMode();
      return;
    }
    if(!state.user)return;

    if(event==="TOKEN_REFRESHED"){
      store.emit("auth:token-refreshed",{userId:state.user.id});
      return;
    }
    if(recoveryModeActive)return;

    if(event==="USER_UPDATED"){
      await refreshProfile().catch(()=>{});
      await ensureProfileIdentity().catch(()=>{});
      store.emit("auth:user-updated",{userId:state.user.id});
      return;
    }
    if(event==="SIGNED_IN"){
      await hydrateAuthenticatedSession(session,{reason:"signed-in"});
    }
  }

  client.auth.onAuthStateChange((event,session)=>{
    queueMicrotask(()=>{
      handleAuthEvent(event,session).catch(error=>console.error("ASHUR_AUTH_EVENT_ERROR",event,error));
    });
  });

  $("#loginTab").onclick=()=>setAuthView("login");
  $("#registerTab").onclick=()=>setAuthView("register");

  $("#loginForm").onsubmit=async(e)=>{
    e.preventDefault();
    const form=e.currentTarget;
    const email=authUtil.normalizeEmail($("#loginEmail").value);
    const password=$("#loginPassword").value;
    if(!authUtil.validEmail(email))return showAuthMessage("اكتب بريدًا إلكترونيًا صحيحًا.");
    if(!password)return showAuthMessage("اكتب كلمة المرور.");

    setAuthBusy(form,true);
    showAuthMessage("جارٍ تسجيل الدخول...",true);
    try{
      const {data,error}=await client.auth.signInWithPassword({email,password});
      if(error)throw error;
      rememberPendingConfirmation("");
      showAuthMessage("");
      if(data?.session)await hydrateAuthenticatedSession(data.session,{reason:"password-login"});
    }catch(error){
      if(String(error?.code||"").toLowerCase()==="email_not_confirmed"){
        rememberPendingConfirmation(email);
      }
      showAuthMessage(authUtil.errorMessage(error,"تعذر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى."));
    }finally{
      setAuthBusy(form,false);
    }
  };

  $("#registerAvatar").onchange=()=>{
    const file=$("#registerAvatar").files[0]||null;
    if(!file)return resetRegisterAvatar();
    const check=profileUtil.validateImageFile(file);
    if(!check.ok){
      resetRegisterAvatar();
      showAuthMessage(check.error);
      return;
    }
    registerAvatarFile=file;
    if(registerAvatarObjectUrl){
      try{URL.revokeObjectURL(registerAvatarObjectUrl)}catch(_){}
    }
    registerAvatarObjectUrl=URL.createObjectURL(file);
    const wrap=$("#registerAvatarPreview");
    const img=wrap.querySelector("img");
    const plus=wrap.querySelector("b");
    img.src=registerAvatarObjectUrl;
    img.classList.remove("hidden");
    plus.classList.add("hidden");
    $("#removeRegisterAvatar").classList.remove("hidden");
    showAuthMessage("");
  };
  $("#removeRegisterAvatar").onclick=resetRegisterAvatar;

  $("#registerForm").onsubmit=async(e)=>{
    e.preventDefault();
    const form=e.currentTarget;
    if(!runtimeFeatureEnabled("registration"))return showAuthMessage(runtimeFeatureError("registration"));
    const name=profileUtil.normalizeName($("#registerName").value);
    const username=profileUtil.normalizeUsername($("#registerUsername").value);
    const email=authUtil.normalizeEmail($("#registerEmail").value);
    const p1=$("#registerPassword").value;
    const p2=$("#registerPassword2").value;
    const avatar=registerAvatarFile;

    if(name.length<1||name.length>30)return showAuthMessage("الاسم يجب ألا يتجاوز ٣٠ حرفًا.");
    if(!authUtil.validUsername(username))return showAuthMessage("اسم المستخدم من ٢ إلى ١٠ خانات ويقبل الحروف الإنجليزية والأرقام والنقطة والشرطة السفلية.");
    if(!authUtil.validEmail(email))return showAuthMessage("اكتب بريدًا إلكترونيًا صحيحًا.");
    if(!authUtil.validPassword(p1))return showAuthMessage("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
    if(p1!==p2)return showAuthMessage("كلمتا المرور غير متطابقتين.");
    if(avatar){
      const avatarCheck=profileUtil.validateImageFile(avatar);
      if(!avatarCheck.ok)return showAuthMessage(avatarCheck.error);
    }

    setAuthBusy(form,true);
    try{
      showAuthMessage("جارٍ التحقق من اسم المستخدم...",true);
      const {data:existingUsername,error:checkError}=await client.from("profiles")
        .select("id").eq("username",username).maybeSingle();
      if(checkError)throw checkError;
      if(existingUsername)throw new Error("اسم المستخدم مستخدم بالفعل.");

      if(avatar)await savePendingRegistrationAvatar(email,avatar);
      else await clearPendingRegistrationAvatar(email);

      showAuthMessage("جارٍ إنشاء الحساب...",true);
      const {data,error}=await client.auth.signUp({
        email,
        password:p1,
        options:{
          data:{name,username},
          emailRedirectTo:authRedirect("signup")
        }
      });
      if(error)throw error;

      $("#loginEmail").value=email;
      $("#registerPassword").value="";
      $("#registerPassword2").value="";
      resetRegisterAvatar();

      if(data?.session){
        state.user=data.session.user;
        await hydrateAuthenticatedSession(data.session,{reason:"signup"});
        showAuthMessage("");
      }else{
        rememberPendingConfirmation(email);
        showAuthMessage("تم إنشاء الحساب. افتح رسالة التأكيد من نفس الهاتف لإكمال الدخول وإضافة صورة الحساب.",true);
      }
    }catch(error){
      await clearPendingRegistrationAvatar(email).catch(()=>{});
      const text=String(error?.message||"");
      if(text==="اسم المستخدم مستخدم بالفعل.")showAuthMessage(text);
      else showAuthMessage(authUtil.errorMessage(error,"تعذر إنشاء الحساب. حاول مرة أخرى."));
    }finally{
      setAuthBusy(form,false);
    }
  };

  $("#forgotPassword").onclick=async()=>{
    const button=$("#forgotPassword");
    const email=authUtil.normalizeEmail($("#loginEmail").value);
    if(!authUtil.validEmail(email))return showAuthMessage("اكتب بريدك الإلكتروني الصحيح أولًا.");
    button.disabled=true;
    showAuthMessage("جارٍ إرسال رابط الاستعادة...",true);
    try{
      const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:authRedirect("recovery")});
      if(error)throw error;
      showAuthMessage("إذا كان البريد مرتبطًا بحساب فستصلك رسالة استعادة. افتح الرابط من نفس الهاتف.",true);
    }catch(error){
      showAuthMessage(authUtil.errorMessage(error,"تعذر إرسال رابط الاستعادة."));
    }finally{
      button.disabled=false;
    }
  };

  $("#resendConfirmation").onclick=async()=>{
    const button=$("#resendConfirmation");
    const email=authUtil.normalizeEmail($("#loginEmail").value)||pendingConfirmationEmail();
    if(!authUtil.validEmail(email))return showAuthMessage("اكتب البريد الإلكتروني المستخدم عند إنشاء الحساب.");
    button.disabled=true;
    showAuthMessage("جارٍ إعادة إرسال رسالة التحقق...",true);
    try{
      const {error}=await client.auth.resend({
        type:"signup",
        email,
        options:{emailRedirectTo:authRedirect("signup")}
      });
      if(error)throw error;
      rememberPendingConfirmation(email);
      showAuthMessage("تم طلب رسالة تحقق جديدة. افحص البريد ثم افتح الرابط من نفس الهاتف.",true);
    }catch(error){
      showAuthMessage(authUtil.errorMessage(error,"تعذر إعادة إرسال رسالة التحقق."));
    }finally{
      button.disabled=false;
    }
  };

  $("#passwordRecoveryForm").onsubmit=async(e)=>{
    e.preventDefault();
    const form=e.currentTarget;
    const p1=$("#recoveryPassword").value;
    const p2=$("#recoveryPassword2").value;
    if(!authUtil.validPassword(p1))return showAuthMessage("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
    if(p1!==p2)return showAuthMessage("كلمتا المرور غير متطابقتين.");

    setAuthBusy(form,true);
    try{
      const {error}=await client.auth.updateUser({password:p1});
      if(error)throw error;
      recoveryModeActive=false;
      $("#recoveryPassword").value="";
      $("#recoveryPassword2").value="";
      await client.auth.signOut({scope:"local"});
      setAuthView("login");
      showAuthMessage("تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.",true);
    }catch(error){
      showAuthMessage(authUtil.errorMessage(error,"تعذر تغيير كلمة المرور."));
    }finally{
      setAuthBusy(form,false);
    }
  };

  $("#cancelPasswordRecovery").onclick=async()=>{
    recoveryModeActive=false;
    await client.auth.signOut({scope:"local"}).catch(()=>{});
    setAuthView("login");
    showAuthMessage("");
  };

  function updateTopbarContext(page){
    if(window.AshurPages?.updateShell){
      window.AshurPages.updateShell(page);
      return;
    }
    const topbar=$(".topbar");
    if(!topbar)return;
    const home=page==="homePage";
    topbar.classList.toggle("home-context",home);
    topbar.dataset.page=page||"homePage";
  }

  async function navigateTo(page,{fromBack=false,replace=false}={}){
    const previous=state.activePage||$(".page.active")?.id||"homePage";
    const pageFeature={searchPage:"search",reelsPage:"reels",messagesPage:"messages"}[page];
    if(pageFeature&&!runtimeFeatureEnabled(pageFeature)){
      openInfoDialog("الميزة غير متاحة",'<div class="empty">'+escapeHtml(runtimeFeatureError(pageFeature))+'</div>');
      page="homePage";
      replace=true;
    }
    page=router.navigate(page,{current:previous,fromBack,replace});
    closeTransientDialogs();
    state.activePage=page;
    store.emit("route:change",{page,previous,fromBack,replace});
    updateTopbarContext(page);
    $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
    $$(".page").forEach(x=>x.classList.toggle("active",x.id===page));
    if(page!=="reelsPage"){
      $("#reelsFeed")?.querySelectorAll("video").forEach(video=>video.pause());
      state.reelObserver?.disconnect?.();
      state.reelObserver=null;
      for(const timer of state.reelViewTimers.values())clearTimeout(timer);
      state.reelViewTimers.clear();
    }
    const pageApi={loadExplore,loadReels,loadConversations,subscribeInboxRealtime,closeInboxRealtime,loadProfile};
    if(window.AshurPages?.enter){
      await window.AshurPages.enter(page,{previous,fromBack,replace,state,api:pageApi});
    }else{
      if(page!=="messagesPage")closeInboxRealtime();
      if(page==="searchPage")await loadExplore();
      if(page==="reelsPage")await loadReels();
      if(page==="messagesPage"){
        await loadConversations();
        subscribeInboxRealtime();
      }
      if(page==="profilePage")await loadProfile();
    }
    window.scrollTo({top:0,behavior:fromBack?"auto":"smooth"});
  }
  $$(".nav-item").forEach(btn=>btn.onclick=()=>navigateTo(btn.dataset.page));
  $("#brandButton").onclick=()=>navigateTo("homePage");

  async function loadHome(){
    const status=$("#homeStatus");
    if(status)status.textContent="جارٍ تحميل أحدث المحتوى...";
    try{
      const tasks=[loadFeed()];
      if(state.features.stories!==false)tasks.push(loadStories());
      else $("#stories").innerHTML="";
      const results=await Promise.allSettled(tasks);
      const failed=results.find(result=>result.status==="rejected");
      if(failed)console.warn("ASHUR_HOME_PARTIAL_LOAD",failed.reason);
    }finally{
      if(status)status.textContent="";
    }
  }

  async function loadStories(){
    const since=new Date().toISOString();
    const {data,error}=await client.from("stories")
      .select("id,author_id,media_id,caption,created_at,expires_at,overlay_text,overlay_color,overlay_y,overlay_bg,shared_type,shared_id,reshared_from_story_id")
      .gt("expires_at",since).order("created_at",{ascending:true}).limit(120);
    if(error){$("#stories").innerHTML="";return}
    const rows=data||[];
    const ids=[...new Set(rows.map(x=>x.author_id))];
    const profiles=await profilesMap(ids);
    state.stories=new Map();
    state.storyGroups=new Map();
    for(const row of rows){
      const story={...row,profile:profiles[row.author_id]||{}};
      state.stories.set(story.id,story);
      if(!state.storyGroups.has(story.author_id))state.storyGroups.set(story.author_id,[]);
      state.storyGroups.get(story.author_id).push(story);
    }
    const ordered=[...state.storyGroups.entries()].sort((a,b)=>{
      const at=new Date(a[1][a[1].length-1]?.created_at||0).getTime();
      const bt=new Date(b[1][b[1].length-1]?.created_at||0).getTime();
      return bt-at;
    });
    let html=`<button class="story" data-own-story="1"><div class="story-ring"><div class="fallback">+</div></div><span>إضافة قصة</span></button>`;
    html+=ordered.map(([authorId,group])=>{
      const p=profiles[authorId]||{};
      const label=authorId===state.user.id?"قصتك":(p.username||p.name||"مستخدم");
      return `<button class="story" data-story-author="${authorId}"><div class="story-ring">${avatar(p,"avatar")}</div><span>${escapeHtml(label)}</span><small>${group.length>1?group.length+" قصص":""}</small></button>`;
    }).join("");
    $("#stories").innerHTML=html;
    await hydrateMedia($("#stories"));
    $("#stories").querySelector("[data-own-story]")?.addEventListener("click",()=>openComposer("story"));
    $("#stories").querySelectorAll("[data-story-author]").forEach(b=>b.onclick=()=>openStoryGroup(b.dataset.storyAuthor,0));
  }

  function storyGroup(authorId){
    return state.storyGroups?.get(authorId)||[];
  }

  function openStoryGroup(authorId,index=0){
    const group=storyGroup(authorId);
    if(!group.length)return;
    const next=Math.max(0,Math.min(group.length-1,Number(index)||0));
    state.currentStoryAuthor=authorId;
    state.currentStoryIndex=next;
    return openStoryViewer(group[next].id,{preserveGroup:true});
  }

  function moveStory(direction){
    const group=storyGroup(state.currentStoryAuthor);
    if(!group.length)return closeStoryViewer();
    const next=Number(state.currentStoryIndex||0)+direction;
    if(next<0||next>=group.length)return closeStoryViewer();
    state.currentStoryIndex=next;
    return openStoryViewer(group[next].id,{preserveGroup:true});
  }

  async function storySharedDetails(story){
    if(!story?.shared_type||!story?.shared_id)return null;
    try{
      if(story.shared_type==="post"){
        const {data,error}=await client.from("posts").select("id,author_id,caption,post_media(media_id,sort_order)").eq("id",story.shared_id).maybeSingle();
        if(error||!data)return null;
        const p=(await profilesMap([data.author_id]))[data.author_id]||{};
        const media=[...(data.post_media||[])].sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0))[0]?.media_id||null;
        return {type:"post",id:data.id,author_id:data.author_id,caption:data.caption||"",profile:p,media_id:media};
      }
      if(story.shared_type==="reel"){
        const {data,error}=await client.from("reels").select("id,author_id,caption,media_id,cover_media_id").eq("id",story.shared_id).maybeSingle();
        if(error||!data)return null;
        const p=(await profilesMap([data.author_id]))[data.author_id]||{};
        return {type:"reel",id:data.id,author_id:data.author_id,caption:data.caption||"",profile:p,media_id:data.cover_media_id||data.media_id};
      }
      if(story.shared_type==="story"){
        const {data,error}=await client.from("stories").select("id,author_id,caption,media_id").eq("id",story.shared_id).maybeSingle();
        if(error||!data)return null;
        const p=(await profilesMap([data.author_id]))[data.author_id]||{};
        return {type:"story",id:data.id,author_id:data.author_id,caption:data.caption||"",profile:p,media_id:data.media_id};
      }
    }catch(_){ }
    return null;
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
      const items=result.items||[];
      $("#storyViewersList").innerHTML=items.map(p=>
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

  async function openStoryViewer(id,{preserveGroup=false}={}){
    const story=state.stories.get(id);
    if(!story)return;
    if(!preserveGroup){
      const group=storyGroup(story.author_id);
      state.currentStoryAuthor=story.author_id;
      state.currentStoryIndex=Math.max(0,group.findIndex(x=>x.id===id));
    }
    clearTimeout(state.storyTimer);
    const dialog=$("#storyViewerDialog");
    const user=$("#storyViewerUser");
    const own=story.author_id===state.user.id;
    const group=storyGroup(story.author_id);
    const index=Math.max(0,Number(state.currentStoryIndex||0));
    user.innerHTML=avatar(story.profile)+"<span>"+escapeHtml(story.profile?.name||story.profile?.username||"مستخدم")+"</span>"+(group.length>1?`<small class="story-seq">${index+1}/${group.length}</small>`:"");
    $("#storyViewerCaption").innerHTML=richText(story.caption||"");
    const storyOverlay=$("#storyViewerOverlay");
    const overlayText=String(story.overlay_text||"").trim();
    storyOverlay.innerHTML=overlayText?`<span>${richText(overlayText)}</span>`:"";
    storyOverlay.classList.toggle("hidden",!overlayText);
    storyOverlay.classList.toggle("with-bg",Boolean(story.overlay_bg));
    storyOverlay.style.color=story.overlay_color||"#ffffff";
    storyOverlay.style.top=(Math.max(.12,Math.min(.86,Number(story.overlay_y||.5)))*100)+"%";
    $("#storyViewerMedia").classList.remove("has-shared-card");
    $("#storyViewerMedia").innerHTML='<div class="empty">جارٍ تحميل القصة...</div>';
    $("#storyProgressBar").style.transition="none";
    $("#storyProgressBar").style.width="0%";

    let canReshare=false;
    if(!own){
      const mention=await client.from("story_mentions").select("story_id").eq("story_id",id).eq("user_id",state.user.id).maybeSingle().catch(()=>({data:null}));
      canReshare=Boolean(mention?.data);
    }
    const sharedAction=story.shared_type&&story.shared_id
      ?`<button id="openSharedStoryContent" type="button">${story.shared_type==="reel"?"فتح الريلز":story.shared_type==="story"?"القصة الأصلية":"فتح المنشور"}</button>`
      :"";
    const reshareAction=canReshare?'<button id="reshareMentionedStoryButton" class="story-reshare-button" type="button">إعادة مشاركة القصة</button>':"";
    $("#storyViewerActions").innerHTML=own
      ?sharedAction+'<button id="storyViewersButton" type="button">المشاهدات</button><button id="manageStoryButton" type="button">إدارة القصة</button>'
      :sharedAction+reshareAction+'<button id="replyStoryButton" type="button">رد برسالة</button><button id="reportStoryButton" type="button">إبلاغ</button>';

    if($("#openSharedStoryContent")){
      $("#openSharedStoryContent").onclick=async()=>{
        const type=story.shared_type,id=story.shared_id;
        closeStoryViewer();
        if(type==="story"){
          const original=state.stories.get(id);
          if(original)return openStoryViewer(id);
          const details=await storySharedDetails(story);
          if(details?.author_id)return openPublicProfile(details.author_id);
          return;
        }
        return openSharedContent(type,id).catch(error=>openInfoDialog("تعذر الفتح",`<div class="empty error">${escapeHtml(error.message)}</div>`));
      };
    }

    openDialog(dialog);
    await hydrateMedia(user);

    if(!own){
      api("/v1/social/story-view/"+encodeURIComponent(id),{method:"POST"}).catch(()=>{});
      if($("#reshareMentionedStoryButton"))$("#reshareMentionedStoryButton").onclick=async()=>{
        const btn=$("#reshareMentionedStoryButton");
        btn.disabled=true;
        try{
          await api("/v1/social/reshare-mentioned-story",{method:"POST",body:JSON.stringify({story_id:id})});
          btn.textContent="تمت إعادة المشاركة";
          await loadStories().catch(()=>{});
        }catch(error){btn.textContent=error.message||"تعذر إعادة المشاركة";btn.disabled=false}
      };
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
      $("#reportStoryButton").onclick=()=>{closeStoryViewer();openReportDialog("story",id)};
    }else{
      $("#storyViewersButton").onclick=()=>openStoryViewers(id);
      $("#manageStoryButton").onclick=()=>{closeStoryViewer();openOwnContentActions("stories",id,story.caption||"",true)};
    }

    const mediaRoot=$("#storyViewerMedia");
    const shared=await storySharedDetails(story);
    try{
      const access=await mediaAccess(story.media_id);
      if(shared){
        mediaRoot.classList.add("has-shared-card");
        const backdrop=access.mime_type?.startsWith("video/")
          ?`<video class="story-share-backdrop" src="${escapeHtml(access.url)}" muted autoplay loop playsinline></video>`
          :`<img class="story-share-backdrop" src="${escapeHtml(access.url)}" alt="">`;
        mediaRoot.innerHTML=backdrop+`<button class="story-shared-card" id="storySharedCard" type="button"><div class="story-shared-owner">${avatar(shared.profile)}<span><b>${escapeHtml(shared.profile?.name||shared.profile?.username||"مستخدم")}</b><small>@${escapeHtml(shared.profile?.username||"")}</small></span></div><img class="story-shared-media" data-media-id="${escapeHtml(shared.media_id||story.media_id)}" alt=""><p class="story-shared-caption">${richText(shared.caption||"")}</p></button>`;
        await hydrateMedia(mediaRoot);
        $("#storySharedCard").onclick=e=>{e.stopPropagation();$("#openSharedStoryContent")?.click()};
        requestAnimationFrame(()=>{$("#storyProgressBar").style.transition="width 8s linear";$("#storyProgressBar").style.width="100%"});
        state.storyTimer=setTimeout(()=>moveStory(1),8000);
      }else if(access.mime_type?.startsWith("video/")){
        const video=document.createElement("video");
        video.src=access.url;video.autoplay=true;video.playsInline=true;video.preload="auto";video.muted=false;
        mediaRoot.innerHTML="";mediaRoot.appendChild(video);
        video.addEventListener("timeupdate",()=>{if(Number.isFinite(video.duration)&&video.duration>0){$("#storyProgressBar").style.transition="none";$("#storyProgressBar").style.width=Math.min(100,(video.currentTime/video.duration)*100)+"%"}});
        video.addEventListener("ended",()=>moveStory(1),{once:true});
        video.play().catch(()=>{});
      }else{
        const img=document.createElement("img");img.src=access.url;img.alt="";mediaRoot.innerHTML="";mediaRoot.appendChild(img);
        requestAnimationFrame(()=>{$("#storyProgressBar").style.transition="width 6s linear";$("#storyProgressBar").style.width="100%"});
        state.storyTimer=setTimeout(()=>moveStory(1),6000);
      }
    }catch{mediaRoot.innerHTML='<div class="empty error">تعذر تحميل القصة.</div>'}

    dialog.querySelectorAll(".story-nav-zone").forEach(x=>x.remove());
    const prev=document.createElement("button");prev.type="button";prev.className="story-nav-zone prev";prev.setAttribute("aria-label","القصة السابقة");prev.onclick=e=>{e.stopPropagation();moveStory(-1)};
    const next=document.createElement("button");next.type="button";next.className="story-nav-zone next";next.setAttribute("aria-label","القصة التالية");next.onclick=e=>{e.stopPropagation();moveStory(1)};
    dialog.append(prev,next);
    let touchX=0;
    mediaRoot.ontouchstart=e=>{touchX=e.changedTouches?.[0]?.clientX||0};
    mediaRoot.ontouchend=e=>{const x=e.changedTouches?.[0]?.clientX||0;const dx=x-touchX;if(Math.abs(dx)>55)moveStory(dx>0?-1:1)};
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

  function openOwnContentActions(kind,id,caption="",commentsEnabled=true,pinned=false,visibility="public"){
    const label=kind==="reels"?"الريلز":kind==="stories"?"القصة":"المنشور";
    const commentsField=kind==="stories"?"":`
      <label class="switch-row">
        <span><b>السماح بالتعليقات</b><small>يمكن تغييرها بأي وقت</small></span>
        <input id="ownContentComments" type="checkbox" ${commentsEnabled!==false?"checked":""}>
      </label>`;
    const audienceField=kind==="stories"?"":`
      <label><span>من يشاهد المحتوى؟</span>
        <select id="ownContentVisibility">
          <option value="public" ${visibility!=="followers"?"selected":""} ${state.profile?.is_private?"disabled":""}>الجميع</option>
          <option value="followers" ${visibility==="followers"?"selected":""}>المتابعون فقط</option>
        </select>
      </label>`;
    const pinAction=kind==="posts"
      ?`<button id="pinOwnContent" class="secondary-wide content-pin-action ${pinned?"active":""}" type="button">${icon("pin")}<span>${pinned?"إلغاء تثبيت المنشور":"تثبيت في الملف الشخصي"}</span></button>`
      :"";
    if(kind!=="stories" && state.profile?.is_private) visibility="followers";
    openInfoDialog("إدارة "+label,`
      <div class="form settings-info content-manage-sheet">
        <label><span>الوصف</span><textarea id="ownContentCaption" maxlength="2200">${escapeHtml(caption||"")}</textarea></label>
        ${commentsField}
        ${audienceField}
        ${pinAction}
        <button id="saveOwnContent" class="primary" type="button">حفظ التعديلات</button>
        <button id="deleteOwnContent" class="danger-wide danger-outline" type="button">حذف ${label}</button>
        <p id="ownContentMessage" class="message"></p>
      </div>`);

    if($("#pinOwnContent"))$("#pinOwnContent").onclick=async()=>{
      const button=$("#pinOwnContent");
      button.disabled=true;
      try{
        const next=!button.classList.contains("active");
        await api("/v1/social/content/posts/"+id,{
          method:"PATCH",
          body:JSON.stringify({pinned:next})
        });
        button.classList.toggle("active",next);
        button.innerHTML=icon("pin")+"<span>"+(next?"إلغاء تثبيت المنشور":"تثبيت في الملف الشخصي")+"</span>";
        $("#ownContentMessage").textContent=next?"تم تثبيت المنشور في أعلى حسابك.":"تم إلغاء تثبيت المنشور.";
        pinned=next;
        if(state.activePage==="profilePage")await loadProfileContent("posts");
      }catch(error){
        $("#ownContentMessage").textContent=error.message;
      }finally{button.disabled=false}
    };

    $("#saveOwnContent").onclick=async()=>{
      $("#saveOwnContent").disabled=true;
      try{
        const body={caption:$("#ownContentCaption").value.trim()};
        if(kind!=="stories"){
          body.comments_enabled=$("#ownContentComments").checked;
          body.visibility=$("#ownContentVisibility").value==="followers"?"followers":"public";
        }
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
        if(state.activePage==="profilePage")await loadProfile();
        else if(kind==="reels")await loadReels();
        else await loadFeed();
      }catch(error){
        $("#ownContentMessage").textContent=error.message;
        $("#deleteOwnContent").disabled=false;
      }
    };
  }

  function renderSaveButton(kind,button,active){
    if(!button)return;
    button.classList.toggle("active",active);
    button.classList.remove("save-error");
    if(kind==="reel"){
      button.innerHTML='<span class="reel-action-icon">'+icon("save")+'</span><span>'+(active?"محفوظ":"حفظ")+'</span>';
    }else{
      button.innerHTML=icon("save")+'<span>'+(active?"محفوظ":"حفظ")+'</span>';
    }
  }

  async function toggleSavedContent(kind,id,button,forceState=null){
    const key="save:"+kind+":"+id;
    if(state.interactionLocks.has(key))return button?.classList.contains("active")||false;
    state.interactionLocks.add(key);

    const table=kind==="reel"?"saved_reels":"saved_posts";
    const field=kind==="reel"?"reel_id":"post_id";
    const current=button?.classList.contains("active")||false;
    const next=forceState===null?!current:Boolean(forceState);
    if(button){
      button.disabled=true;
      renderSaveButton(kind,button,next);
    }

    try{
      const result=next
        ?await client.from(table).upsert({user_id:state.user.id,[field]:id},{onConflict:"user_id,"+field})
        :await client.from(table).delete().eq("user_id",state.user.id).eq(field,id);
      if(result.error)throw result.error;
      return next;
    }catch(error){
      if(button){
        renderSaveButton(kind,button,current);
        button.classList.add("save-error");
      }
      console.warn("ASHUR_SAVE_TOGGLE_FAILED",kind,id,error);
      throw error;
    }finally{
      state.interactionLocks.delete(key);
      if(button)button.disabled=false;
    }
  }

  async function interactionCounts(kind,ids){
    if(!ids?.length)return {};
    const {data,error}=await client.rpc("content_interaction_counts",{p_kind:kind,p_ids:ids});
    if(error)return {};
    return Object.fromEntries((data||[]).map(row=>[row.content_id,{
      likes:Number(row.likes||0),
      comments:Number(row.comments||0)
    }]));
  }

  function bindFeedArticle(article){
    if(!article)return;
    article.querySelectorAll("[data-like-post]").forEach(b=>b.onclick=()=>toggleLike("post",b.dataset.likePost,b));
    article.querySelectorAll("[data-comment-post]").forEach(b=>b.onclick=()=>openComments("post",b.dataset.commentPost));
    article.querySelectorAll("[data-share-post]").forEach(b=>b.onclick=()=>shareContent("post",b.dataset.sharePost));
    article.querySelectorAll("[data-save-post]").forEach(b=>b.onclick=()=>toggleSavedContent("post",b.dataset.savePost,b).catch(()=>{}));
    article.querySelectorAll("[data-own-post]").forEach(b=>b.onclick=()=>openOwnContentActions("posts",b.dataset.ownPost,b.dataset.caption,b.dataset.comments==="true",b.dataset.pinned==="true",b.dataset.visibility||"public"));
    article.querySelectorAll("[data-open-profile]").forEach(b=>b.onclick=()=>openPublicProfile(b.dataset.openProfile));
  }

  async function loadFeed({append=false}={}){
    if(state.feedLoading || (append&&state.feedDone))return;
    state.feedLoading=true;
    if(!append){
      state.feedOffset=0;
      state.feedDone=false;
    }

    const start=append?state.feedOffset:0;
    const pageSize=20;
    try{
      const {data,error}=await client.from("posts")
        .select("id,author_id,caption,created_at,comments_enabled,visibility,pinned_at,post_media(media_id,sort_order)")
        .order("created_at",{ascending:false})
        .range(start,start+pageSize-1);

      if(error)throw error;

      if(!data?.length){
        if(!append)$("#feed").innerHTML='<div class="empty">لا توجد منشورات بعد. كن أول من يشارك شيئًا.</div>';
        state.feedDone=true;
        return;
      }

      state.feedOffset=start+data.length;
      state.feedDone=data.length<pageSize;
      const postIds=data.map(x=>x.id);

      const side=await Promise.allSettled([
        profilesMap([...new Set(data.map(x=>x.author_id))]),
        client.from("post_likes").select("post_id").eq("user_id",state.user.id).in("post_id",postIds),
        client.from("saved_posts").select("post_id").eq("user_id",state.user.id).in("post_id",postIds),
        interactionCounts("post",postIds)
      ]);

      const profiles=side[0].status==="fulfilled"?side[0].value:{};
      const likedRows=side[1].status==="fulfilled"&&!side[1].value.error?(side[1].value.data||[]):[];
      const savedRows=side[2].status==="fulfilled"&&!side[2].value.error?(side[2].value.data||[]):[];
      const counts=side[3].status==="fulfilled"?side[3].value:{};
      const likedSet=new Set(likedRows.map(x=>x.post_id));
      const savedSet=new Set(savedRows.map(x=>x.post_id));

      const chunk=data.map(post=>{
        const p=profiles[post.author_id]||{};
        const mediaHtml=postMediaMarkup(post.post_media||[]);
        const verified=p.is_verified?'<span class="verified-inline">✓</span>':"";
        const likedNow=likedSet.has(post.id);
        const savedNow=savedSet.has(post.id);
        const metric=counts[post.id]||{likes:0,comments:0};
        return `<article class="post" data-post-id="${post.id}">
          <div class="post-head">
            ${avatar(p)}
            <button class="post-user" data-open-profile="${post.author_id}" type="button">
              <b>${escapeHtml(p.name||"مستخدم")}${verified}</b>
              <small>@${escapeHtml(p.username||"")} · ${new Date(post.created_at).toLocaleDateString("ar-IQ")}</small>
            </button>
            ${post.author_id===state.user.id?`<button class="profile-more-button" data-own-post="${post.id}" data-caption="${escapeHtml(post.caption||"")}" data-comments="${post.comments_enabled!==false}" data-pinned="${Boolean(post.pinned_at)}" data-visibility="${escapeHtml(post.visibility||"public")}" type="button" aria-label="إدارة المنشور">${icon("more")}</button>`:""}
          </div>
          ${mediaHtml}
          <div class="post-body">
            <div class="post-actions">
              <button class="action icon-action ${likedNow?"active":""}" data-like-post="${post.id}" type="button">${icon("like")}<span data-like-count>${metric.likes}</span></button>
              ${post.comments_enabled===false
                ? `<button class="action icon-action" type="button" disabled>${icon("comment")}<span>—</span></button>`
                : `<button class="action icon-action" data-comment-post="${post.id}" type="button">${icon("comment")}<span>${metric.comments}</span></button>`}
              <button class="action icon-action" data-share-post="${post.id}" type="button">${icon("share")}<span>مشاركة</span></button>
              <button class="action icon-action ${savedNow?"active":""}" data-save-post="${post.id}" type="button">${icon("save")}<span>${savedNow?"محفوظ":"حفظ"}</span></button>
            </div>
            ${post.caption?`<p class="caption">${richText(post.caption)}</p>`:""}
          </div>
        </article>`;
      }).join("");

      $("#feedLoadMore")?.remove();
      if(append)$("#feed").insertAdjacentHTML("beforeend",chunk);
      else $("#feed").innerHTML=chunk;

      const articles=postIds.map(id=>$("#feed").querySelector('[data-post-id="'+CSS.escape(id)+'"]')).filter(Boolean);
      await Promise.allSettled(articles.map(article=>hydrateMedia(article)));
      articles.forEach(bindFeedArticle);

      if(!state.feedDone){
        $("#feed").insertAdjacentHTML("beforeend",'<button id="feedLoadMore" class="secondary-wide feed-load-more" type="button">تحميل المزيد</button>');
        $("#feedLoadMore").onclick=()=>loadFeed({append:true});
      }
    }catch(error){
      console.error("ASHUR_FEED_LOAD_FAILED",error);
      if(!append)$("#feed").innerHTML=errorMarkup(error.message||"تعذر تحميل المنشورات.","homePage");
      else{
        $("#feedLoadMore")?.remove();
        $("#feed").insertAdjacentHTML("beforeend",'<button id="feedLoadMore" class="secondary-wide feed-load-more" type="button">تعذر التحميل — إعادة المحاولة</button>');
        $("#feedLoadMore").onclick=()=>loadFeed({append:true});
      }
    }finally{
      state.feedLoading=false;
    }
  }

  async function toggleLike(type,id,button){
    if(!state.user||!button)return;
    const key="like:"+type+":"+id;
    if(state.interactionLocks.has(key))return;
    state.interactionLocks.add(key);

    const table=type==="post"?"post_likes":"reel_likes";
    const target=type==="post"?"post_id":"reel_id";
    const previous=button.classList.contains("active");
    const next=!previous;
    const count=button.querySelector("[data-like-count]");
    const previousCount=Number(count?.textContent||0);

    button.disabled=true;
    button.classList.toggle("active",next);
    if(count)count.textContent=String(Math.max(0,previousCount+(next?1:-1)));

    try{
      const result=next
        ?await client.from(table).upsert({[target]:id,user_id:state.user.id},{onConflict:target+",user_id"})
        :await client.from(table).delete().eq(target,id).eq("user_id",state.user.id);
      if(result.error)throw result.error;
    }catch(error){
      button.classList.toggle("active",previous);
      if(count)count.textContent=String(previousCount);
      console.warn("ASHUR_LIKE_TOGGLE_FAILED",type,id,error);
    }finally{
      state.interactionLocks.delete(key);
      button.disabled=false;
    }
  }


  async function openSharedContent(type,id){
    if(type==="reel"){
      const result=await client.from("reels")
        .select("id,caption,media_id,cover_media_id,comments_enabled")
        .eq("id",id).maybeSingle();
      if(result.error)throw result.error;
      if(!result.data)throw new Error("الريلز غير متاح");
      return openProfileContentPreview("reels",result.data.id,result.data.media_id,result.data.caption,result.data.comments_enabled!==false);
    }
    const result=await client.from("posts")
      .select("id,caption,comments_enabled,post_media(media_id,sort_order)")
      .eq("id",id).maybeSingle();
    if(result.error)throw result.error;
    if(!result.data)throw new Error("المنشور غير متاح");
    const media=[...(result.data.post_media||[])].sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0))[0]?.media_id||"";
    return openProfileContentPreview("posts",result.data.id,media,result.data.caption,result.data.comments_enabled!==false);
  }

  async function shareContent(type,id){
    const label=type==="reel"?"ريلز":"منشور";
    state.returnPublicProfileId=$("#publicProfileDialog")?.open&&state.currentPublicProfile?.id
      ?state.currentPublicProfile.id
      :state.returnPublicProfileId;
    openInfoDialog("مشاركة "+label,
      '<div class="share-sheet">'+
        '<div class="share-quick-actions">'+
          '<button id="shareToStoryButton" type="button"><span class="share-round">'+icon("play")+'</span><b>إضافة للقصة</b></button>'+
          '<button id="shareExternalButton" type="button"><span class="share-round">'+icon("share")+'</span><b>مشاركة خارجية</b></button>'+
        '</div>'+
        '<label class="creator-caption-wrap share-story-caption"><span>اكتب على القصة</span><textarea id="shareStoryCaption" maxlength="300" placeholder="اكتب نصًا أو استخدم @ لذكر صديق"></textarea></label>'+
        '<div class="settings-group"><div class="settings-group-title"><div><span class="eyebrow">الخاص</span><h4>إرسال لصديق</h4></div></div>'+
          '<div id="shareConversationsList" class="list compact"><div class="empty">جارٍ تحميل المحادثات...</div></div>'+
        '</div>'+
        '<p id="shareMessage" class="message"></p>'+
      '</div>');

    bindMentionAutocomplete($("#shareStoryCaption"));
    $("#shareToStoryButton").onclick=async()=>{
      $("#shareToStoryButton").disabled=true;
      try{
        const caption=$("#shareStoryCaption")?.value.trim()||"";
        const created=await api("/v1/social/share-story",{
          method:"POST",
          body:JSON.stringify({type,id,caption})
        });
        if(created?.id)await notifyMentions(caption,"story",created.id);
        $("#shareMessage").textContent="تمت إضافة "+label+" إلى قصتك.";
        await loadStories().catch(()=>{});
      }catch(error){
        $("#shareMessage").textContent=error.message;
      }finally{$("#shareToStoryButton").disabled=false}
    };

    $("#shareExternalButton").onclick=async()=>{
      const text=label+" على آشور";
      const base=(cfg.shareBaseUrl||"").replace(/\/$/,"");
      const url=base?base+"/#"+type+"-"+id:"";
      try{
        if(navigator.share){
          await navigator.share({title:"آشور",text,...(url?{url}:{})});
        }else if(url){
          await navigator.clipboard.writeText(url);
          $("#shareMessage").textContent="تم نسخ الرابط.";
        }
      }catch(_){}
    };

    try{
      const result=await api("/v1/conversations");
      const direct=(result.items||[]).filter(row=>row.kind==="direct").slice(0,60);
      $("#shareConversationsList").innerHTML=direct.map(row=>{
        const p=row.peer_profile||{};
        return '<button class="list-card" data-share-conversation="'+escapeHtml(row.id)+'" type="button">'+
          avatar(p)+'<span class="grow"><b>'+escapeHtml(row.title||p.name||"محادثة")+'</b><small>@'+escapeHtml(p.username||"")+'</small></span>'+
          '<span class="share-send-label">إرسال</span></button>';
      }).join("")||'<div class="empty">ابدأ محادثة مع صديق أولًا حتى يظهر هنا.</div>';
      await hydrateMedia($("#shareConversationsList"));
      $("#shareConversationsList").querySelectorAll("[data-share-conversation]").forEach(btn=>btn.onclick=async()=>{
        btn.disabled=true;
        try{
          await api("/v1/conversations/"+encodeURIComponent(btn.dataset.shareConversation)+"/messages",{
            method:"POST",
            body:JSON.stringify({
              body:"",
              shared_type:type,
              shared_id:id,
              client_message_id:crypto.randomUUID?.()||undefined
            })
          });
          btn.querySelector(".share-send-label").textContent="تم";
        }catch(error){
          $("#shareMessage").textContent=error.message;
          btn.disabled=false;
        }
      });
    }catch(error){
      $("#shareConversationsList").innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
    }
  }

  function setSearchType(type){
    state.searchType=["all","accounts","posts","reels"].includes(type)?type:"all";
    $$(".chip[data-search-type]").forEach(btn=>btn.classList.toggle("active",btn.dataset.searchType===state.searchType));
    runSearch();
  }
  $$(".chip[data-search-type]").forEach(btn=>btn.onclick=()=>setSearchType(btn.dataset.searchType));

  async function renderAccountResults(query=""){
    const clean=String(query||"").trim().replace(/^@/,"").replace(/[,%()]/g,"");
    let request=client.from("profiles")
      .select("id,name,username,bio,avatar_media_id,is_verified,is_private,created_at")
      .neq("id",state.user.id)
      .order("created_at",{ascending:false})
      .limit(clean?24:8);
    if(clean)request=request.or(`name.ilike.%${clean}%,username.ilike.%${clean}%`);
    const {data,error}=await request;
    if(error)throw error;
    const rows=data||[];
    const statuses=await followStatusMap(rows.map(x=>x.id));
    return rows.map(p=>`<article class="search-account-card">
      <button class="search-account-main" data-open-profile="${p.id}" type="button">
        ${avatar(p,"search-account-avatar")}
        <span class="search-account-copy">
          <b>${escapeHtml(p.name||"مستخدم")}${p.is_verified?'<span class="verified-inline">✓</span>':""}</b>
          <small>@${escapeHtml(p.username||"")}${p.is_private?" · حساب خاص":""}</small>
          ${p.bio?`<em>${escapeHtml(p.bio)}</em>`:""}
        </span>
      </button>
      <button class="search-follow-button ${statuses[p.id]?"active":""}" data-follow="${p.id}" type="button">${followLabel(statuses[p.id])}</button>
    </article>`).join("");
  }

  async function renderPostResults(query=""){
    const clean=String(query||"").trim().replace(/[,%()]/g,"");
    let request=client.from("posts")
      .select("id,author_id,caption,comments_enabled,created_at,post_media(media_id,sort_order)")
      .order("created_at",{ascending:false})
      .limit(clean?24:10);
    if(clean)request=request.ilike("caption",`%${clean}%`);
    const {data,error}=await request;
    if(error)throw error;
    const rows=data||[];
    const profiles=await profilesMap([...new Set(rows.map(x=>x.author_id))]);
    return rows.map(row=>{
      const p=profiles[row.author_id]||{};
      const media=[...(row.post_media||[])].sort((a,b)=>a.sort_order-b.sort_order)[0]?.media_id||"";
      return `<article class="search-post-card stage4-search-post">
        <button class="search-post-owner" data-open-profile="${row.author_id}" type="button">${avatar(p)}<span><b>${escapeHtml(p.name||p.username||"مستخدم")}</b><small>@${escapeHtml(p.username||"")} · ${new Date(row.created_at).toLocaleDateString("ar-IQ")}</small></span></button>
        <div class="search-post-open" data-search-open-post="${row.id}" data-media="${escapeHtml(media)}" data-caption="${escapeHtml(row.caption||"")}" data-owner="${escapeHtml(row.author_id)}" data-comments="${row.comments_enabled!==false}" role="button" tabindex="0">
          ${media?`<img class="search-post-media" data-media-id="${media}" alt="">`:'<span class="search-post-text-placeholder">'+icon("comment")+'</span>'}
          ${row.caption?`<p>${richText(row.caption)}</p>`:""}
          <span class="search-open-label">عرض المنشور</span>
        </div>
      </article>`;
    }).join("");
  }

  async function renderReelResults(query=""){
    const clean=String(query||"").trim().replace(/[,%()]/g,"");
    let request=client.from("reels")
      .select("id,media_id,cover_media_id,caption,author_id,created_at,view_count")
      .eq("explore_enabled",true)
      .order("created_at",{ascending:false})
      .limit(clean?18:12);
    if(clean)request=request.ilike("caption",`%${clean}%`);
    const {data,error}=await request;
    if(error)throw error;
    return (data||[]).map(r=>`
      <button class="explore-tile stage4-reel-tile" data-open-reel="${r.id}" type="button">
        ${r.cover_media_id
          ?`<img class="explore-cover" data-media-id="${r.cover_media_id}" alt="">`
          :`<video muted playsinline preload="metadata" data-video-cover="1" data-media-id="${r.media_id}"></video>`}
        <span class="explore-play">${icon("play")}</span>
        <span class="explore-views">${icon("eye")}<b>${Number(r.view_count||0)}</b></span>
      </button>`).join("");
  }

  async function loadExplore(){
    return runSearch();
  }

  let searchTimer;
  $("#searchInput").oninput=()=>{
    const has=Boolean($("#searchInput").value.trim());
    $("#clearSearchButton").classList.toggle("hidden",!has);
    $("#searchContextHint").textContent=has?"نتائج مطابقة لما تكتبه":"اكتشف حسابات ومحتوى جديدًا";
    clearTimeout(searchTimer);
    searchTimer=setTimeout(runSearch,220);
  };
  $("#clearSearchButton").onclick=()=>{
    $("#searchInput").value="";
    $("#clearSearchButton").classList.add("hidden");
    $("#searchContextHint").textContent="اكتشف حسابات ومحتوى جديدًا";
    $("#searchInput").focus();
    runSearch();
  };

  async function runSearch(){
    const q=$("#searchInput").value.trim();
    const root=$("#searchResults");
    root.innerHTML='<div class="search-loading"><i></i><span>جارٍ البحث...</span></div>';
    root.classList.remove("explore-media-grid");
    try{
      let html="";
      if(state.searchType==="accounts"){
        const accounts=await renderAccountResults(q);
        html='<div class="search-section-head"><b>الحسابات</b><span>'+((q&&"نتائج البحث")||"حسابات مقترحة")+'</span></div><div class="search-account-list">'+accounts+'</div>';
      }else if(state.searchType==="posts"){
        const posts=await renderPostResults(q);
        html='<div class="search-section-head"><b>المنشورات</b><span>'+(q?"مطابقة للبحث":"أحدث المنشورات")+'</span></div><div class="search-post-list">'+posts+'</div>';
      }else if(state.searchType==="reels"){
        const reels=await renderReelResults(q);
        html='<div class="search-section-head"><b>الريلز</b><span>'+(q?"مطابقة للبحث":"اكتشف الآن")+'</span></div><div class="explore-media-grid stage4-explore-grid">'+reels+'</div>';
      }else if(q){
        const [accounts,posts,reels]=await Promise.all([
          renderAccountResults(q),
          renderPostResults(q),
          renderReelResults(q)
        ]);
        html=
          (accounts?'<section class="search-result-section"><div class="search-section-head"><b>الحسابات</b><span>الأقرب لبحثك</span></div><div class="search-account-list">'+accounts+'</div></section>':"")+
          (reels?'<section class="search-result-section"><div class="search-section-head"><b>الريلز</b><span>محتوى مطابق</span></div><div class="explore-media-grid stage4-explore-grid">'+reels+'</div></section>':"")+
          (posts?'<section class="search-result-section"><div class="search-section-head"><b>المنشورات</b><span>محتوى مطابق</span></div><div class="search-post-list">'+posts+'</div></section>':"");
      }else{
        const [accounts,reels]=await Promise.all([renderAccountResults(""),renderReelResults("")]);
        html=
          '<section class="search-result-section"><div class="search-section-head"><b>حسابات مقترحة</b><span>اكتشف أشخاصًا جدد</span></div><div class="search-account-list">'+accounts+'</div></section>'+
          '<section class="search-result-section"><div class="search-section-head"><b>ريلز للاستكشاف</b><span>محتوى حديث</span></div><div class="explore-media-grid stage4-explore-grid">'+reels+'</div></section>';
      }

      root.innerHTML=html||'<div class="empty search-empty"><b>لا توجد نتائج</b><span>جرّب اسمًا أو يوزر مختلفًا.</span></div>';
      await hydrateMedia(root);
      prepareVideoCovers(root);

      root.querySelectorAll("[data-follow]").forEach(b=>b.onclick=async e=>{
        e.stopPropagation();
        b.disabled=true;
        await followUser(b.dataset.follow,b);
        b.disabled=false;
      });
      root.querySelectorAll("[data-open-profile]").forEach(b=>b.onclick=()=>openPublicProfile(b.dataset.openProfile));
      root.querySelectorAll("[data-search-open-post]").forEach(b=>b.onclick=()=>openProfileContentPreview(
        "posts",
        b.dataset.searchOpenPost,
        b.dataset.media||"",
        b.dataset.caption||"",
        b.dataset.comments==="true",
        b.dataset.owner||""
      ).catch(error=>openInfoDialog("تعذر فتح المنشور",'<div class="empty error">'+escapeHtml(error.message)+'</div>')));
      root.querySelectorAll("[data-open-reel]").forEach(b=>b.onclick=async()=>{
        await navigateTo("reelsPage");
        requestAnimationFrame(()=>{
          const target=$(`.reel[data-reel-id="${b.dataset.openReel}"]`);
          target?.scrollIntoView({block:"start"});
        });
      });
    }catch(error){
      root.innerHTML=errorMarkup(error.message||"تعذر تحميل البحث","searchPage");
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

  function bindReelActions(root=$("#reelsFeed")){
    root.querySelectorAll("[data-like-reel]").forEach(b=>b.onclick=()=>toggleLike("reel",b.dataset.likeReel,b));
    root.querySelectorAll("[data-comment-reel]").forEach(b=>b.onclick=()=>openComments("reel",b.dataset.commentReel));
    root.querySelectorAll("[data-share-reel]").forEach(b=>b.onclick=()=>shareContent("reel",b.dataset.shareReel));
    root.querySelectorAll("[data-save-reel]").forEach(b=>b.onclick=()=>toggleSavedContent("reel",b.dataset.saveReel,b).catch(()=>{}));
    root.querySelectorAll("[data-own-reel]").forEach(b=>b.onclick=()=>openOwnContentActions("reels",b.dataset.ownReel,b.dataset.caption,b.dataset.comments==="true",false,b.dataset.visibility||"public"));
    root.querySelectorAll("[data-open-profile]").forEach(b=>b.onclick=()=>openPublicProfile(b.dataset.openProfile));
    root.querySelectorAll("[data-follow-reel]").forEach(b=>b.onclick=()=>followUser(b.dataset.followReel,b));
  }

  async function loadReels({append=false}={}){
    if(state.reelLoading || (append&&state.reelDone))return;
    state.reelLoading=true;
    if(!append){
      state.reelOffset=0;
      state.reelDone=false;
      state.reelObserver?.disconnect?.();
      state.reelObserver=null;
    }

    const start=append?state.reelOffset:0;
    const pageSize=8;

    try{
      const {data,error}=await client.from("reels")
        .select("id,author_id,media_id,cover_media_id,caption,created_at,comments_enabled,visibility,view_count")
        .order("created_at",{ascending:false})
        .range(start,start+pageSize-1);
      if(error)throw error;

      if(!data?.length){
        if(!append)$("#reelsFeed").innerHTML='<div class="empty">لا توجد ريلز بعد.</div>';
        state.reelDone=true;
        return;
      }

      state.reelOffset=start+data.length;
      state.reelDone=data.length<pageSize;
      const reelIds=data.map(x=>x.id);

      const side=await Promise.allSettled([
        profilesMap([...new Set(data.map(x=>x.author_id))]),
        followStatusMap(data.map(x=>x.author_id)),
        client.from("reel_likes").select("reel_id").eq("user_id",state.user.id).in("reel_id",reelIds),
        client.from("saved_reels").select("reel_id").eq("user_id",state.user.id).in("reel_id",reelIds),
        interactionCounts("reel",reelIds)
      ]);

      const ps=side[0].status==="fulfilled"?side[0].value:{};
      const statuses=side[1].status==="fulfilled"?side[1].value:{};
      const likedRows=side[2].status==="fulfilled"&&!side[2].value.error?(side[2].value.data||[]):[];
      const savedRows=side[3].status==="fulfilled"&&!side[3].value.error?(side[3].value.data||[]):[];
      const counts=side[4].status==="fulfilled"?side[4].value:{};
      const likedSet=new Set(likedRows.map(x=>x.reel_id));
      const savedSet=new Set(savedRows.map(x=>x.reel_id));

      const chunk=data.map(r=>{
        const p=ps[r.author_id]||{};
        const likedNow=likedSet.has(r.id);
        const savedNow=savedSet.has(r.id);
        const metric=counts[r.id]||{likes:0,comments:0};
        return `<article class="reel is-loading" data-reel-id="${r.id}" data-cover-id="${r.cover_media_id||""}" data-view-count="${Number(r.view_count||0)}">
          ${r.cover_media_id?`<img class="reel-poster" data-media-id="${r.cover_media_id}" alt="">`:""}
          <video playsinline muted loop preload="none" data-media-id="${r.media_id}"></video>
          <div class="reel-loader" aria-hidden="true"></div>
          <div class="reel-shade"></div>
          <div class="reel-like-burst" aria-hidden="true">${icon("like")}</div>
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
            <p>${richText(r.caption||"")}</p>
          </div>
          <div class="reel-actions">
            <button class="reel-action ${likedNow?"active":""}" data-like-reel="${r.id}" type="button">
              <span class="reel-action-icon">${icon("like")}</span><span data-like-count>${metric.likes}</span>
            </button>
            ${r.comments_enabled===false
              ? `<button class="reel-action" type="button" disabled><span class="reel-action-icon">${icon("comment")}</span><span>—</span></button>`
              : `<button class="reel-action" data-comment-reel="${r.id}" type="button"><span class="reel-action-icon">${icon("comment")}</span><span>${metric.comments}</span></button>`}
            <div class="reel-action reel-view-stat" aria-label="المشاهدات">
              <span class="reel-action-icon">${icon("eye")}</span><span data-reel-view-count>${Number(r.view_count||0)}</span>
            </div>
            <button class="reel-action" data-share-reel="${r.id}" type="button">
              <span class="reel-action-icon">${icon("share")}</span><span>مشاركة</span>
            </button>
            <button class="reel-action ${savedNow?"active":""}" data-save-reel="${r.id}" type="button">
              <span class="reel-action-icon">${icon("save")}</span><span>${savedNow?"محفوظ":"حفظ"}</span>
            </button>
            ${r.author_id===state.user.id?`<button class="reel-action" data-own-reel="${r.id}" data-caption="${escapeHtml(r.caption||"")}" data-comments="${r.comments_enabled!==false}" data-visibility="${escapeHtml(r.visibility||"public")}" type="button"><span class="reel-action-icon">${icon("more")}</span><span>إدارة</span></button>`:""}
          </div>
          <div class="reel-progress"><span></span></div>
        </article>`;
      }).join("");

      if(append)$("#reelsFeed").insertAdjacentHTML("beforeend",chunk);
      else $("#reelsFeed").innerHTML=chunk;

      const newReels=reelIds.map(id=>$("#reelsFeed").querySelector('[data-reel-id="'+CSS.escape(id)+'"]')).filter(Boolean);
      await Promise.allSettled(newReels.map(reel=>hydrateMedia(reel)));
      bindReelActions($("#reelsFeed"));
      initReelPlayers();
    }catch(error){
      console.error("ASHUR_REELS_LOAD_FAILED",error);
      if(!append)$("#reelsFeed").innerHTML=errorMarkup(error.message||"تعذر تحميل الريلز.","reelsPage");
    }finally{
      state.reelLoading=false;
    }
  }

  async function recordReelView(reel){
    const id=reel?.dataset?.reelId;
    if(!id||state.viewedReels.has(id)||!state.user)return;
    state.viewedReels.add(id);
    try{
      const result=await api("/v1/social/reel-view/"+encodeURIComponent(id),{method:"POST"});
      const count=Number(result?.view_count||0);
      reel.dataset.viewCount=String(count);
      const label=reel.querySelector("[data-reel-view-count]");
      if(label)label.textContent=String(count);
      document.querySelectorAll('[data-profile-reel-views="'+CSS.escape(id)+'"]').forEach(el=>el.textContent=String(count));
    }catch(error){
      state.viewedReels.delete(id);
      console.warn("ASHUR_REEL_VIEW_FAILED",id,error);
    }
  }

  function scheduleReelView(reel){
    const id=reel?.dataset?.reelId;
    if(!id||state.viewedReels.has(id)||state.reelViewTimers.has(id))return;
    const timer=setTimeout(()=>{
      state.reelViewTimers.delete(id);
      if(reel.dataset.visibleHigh==="1")recordReelView(reel);
    },1500);
    state.reelViewTimers.set(id,timer);
  }

  function cancelReelViewTimer(reel){
    const id=reel?.dataset?.reelId;
    if(!id)return;
    const timer=state.reelViewTimers.get(id);
    if(timer)clearTimeout(timer);
    state.reelViewTimers.delete(id);
  }

  function showReelLikeBurst(reel){
    const burst=reel?.querySelector(".reel-like-burst");
    if(!burst)return;
    burst.classList.remove("show");
    void burst.offsetWidth;
    burst.classList.add("show");
    setTimeout(()=>burst.classList.remove("show"),650);
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
        if(entry.isIntersecting && entry.intersectionRatio>.2){
          video.preload="auto";
          const last=reels[reels.length-1];
          if(reel===last && !state.reelDone && !state.reelLoading){
            loadReels({append:true}).catch(()=>{});
          }
        }
        if(entry.isIntersecting && entry.intersectionRatio>.72){
          reel.dataset.visibleHigh="1";
          scheduleReelView(reel);
          reels.forEach(other=>{
            const ov=other.querySelector("video");
            if(other!==reel && ov && !ov.paused)ov.pause();
          });
          video.play().catch(()=>{});
        }else{
          reel.dataset.visibleHigh="0";
          cancelReelViewTimer(reel);
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
      if(reel.dataset.playerBound==="1")return;
      reel.dataset.playerBound="1";

      const markReady=()=>{
        reel.classList.remove("is-loading","load-error");
        reel.classList.add("video-ready");
      };
      if(video.readyState>=2)markReady();
      else{
        video.addEventListener("loadeddata",markReady,{once:true});
        video.addEventListener("canplay",markReady,{once:true});
      }
      video.addEventListener("error",()=>{
        reel.classList.remove("is-loading");
        reel.classList.add("load-error");
      },{once:true});

      const togglePlay=()=>{
        if(video.paused){
          video.play().catch(()=>{});
          play?.classList.remove("show");
        }else{
          video.pause();
          play?.classList.add("show");
        }
      };
      play?.addEventListener("click",e=>{e.stopPropagation();togglePlay()});

      let lastTap=0;
      let singleTapTimer=null;
      video.addEventListener("pointerup",()=>{
        const now=Date.now();
        if(now-lastTap<280){
          clearTimeout(singleTapTimer);
          lastTap=0;
          showReelLikeBurst(reel);
          const like=reel.querySelector("[data-like-reel]");
          if(like&&!like.classList.contains("active"))like.click();
          return;
        }
        lastTap=now;
        clearTimeout(singleTapTimer);
        singleTapTimer=setTimeout(()=>{
          if(lastTap===now){
            togglePlay();
            lastTap=0;
          }
        },290);
      });

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


    });
  }

  async function loadConversations(){
    try{
      const list=await api("/v1/conversations");
      state.conversationCache=new Map((list.items||[]).map(row=>[row.id,row]));
      const query=($("#messagesSearchInput")?.value||"").trim().toLowerCase();
      const filter=state.messageFilter||"all";
      const items=(list.items||[]).filter(row=>{
        const profile=row.peer_profile||{};
        if(filter==="unread"&&Number(row.unread_count||0)<=0)return false;
        if(filter==="groups"&&row.kind!=="group")return false;
        if(!query)return true;
        return [
          row.title,
          row.last_message,
          profile.name,
          profile.username
        ].some(value=>String(value||"").toLowerCase().includes(query));
      });

      $("#conversationList").innerHTML=items.map(row=>{
        const p=row.peer_profile||{};
        const isGroup=row.kind==="group";
        const avatarHtml=isGroup
          ?(row.image_media_id
            ?'<img class="conversation-avatar group-avatar" data-media-id="'+escapeHtml(row.image_media_id)+'" alt="">'
            :'<div class="conversation-avatar group-avatar" style="display:grid;place-items:center;color:var(--brand);font-weight:900">'+initials(row.title||"م")+'</div>')
          :(p.avatar_media_id
            ?'<img class="conversation-avatar" data-media-id="'+escapeHtml(p.avatar_media_id)+'" alt="">'
            :'<div class="conversation-avatar" style="display:grid;place-items:center;color:var(--brand);font-weight:900">'+initials(row.title||p.name||"م")+'</div>');
        const unread=row.unread_count?'<span class="conversation-unread">'+Number(row.unread_count||0)+'</span>':"";
        const badge=isGroup?'<span class="conversation-kind-badge">مجموعة</span>':"";
        const updated=row.updated_at?new Date(row.updated_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"}):"";
        const preview=escapeHtml(row.last_message|| (isGroup?"ابدأ الحديث في المجموعة":"ابدأ المحادثة"));
        return '<button class="conversation-item" data-conversation="'+escapeHtml(row.id)+'" type="button">'+
          avatarHtml+
          '<div class="conversation-main"><div class="conversation-title-row"><b>'+escapeHtml(row.title||p.name||"محادثة")+'</b>'+badge+unread+'<time>'+updated+'</time></div>'+
          '<div class="conversation-preview">'+preview+'</div></div></button>';
      }).join("")||'<div class="empty">لا توجد محادثات مطابقة.</div>';

      await hydrateMedia($("#conversationList"));
      $("#conversationList").querySelectorAll("[data-conversation]").forEach(button=>button.onclick=()=>{
        const row=state.conversationCache.get(button.dataset.conversation);
        if(row)openChat(row.id,row.title,row);
      });
    }catch(error){
      $("#conversationList").innerHTML=errorMarkup(error.message,"messagesPage");
    }
  }

  function scheduleInboxRefresh(){
    clearTimeout(state.inboxRefreshTimer);
    state.inboxRefreshTimer=setTimeout(()=>{
      if(state.activePage!=="messagesPage")return;
      if($("#chatDialog")?.open)return;
      loadConversations().catch(()=>{});
    },280);
  }

  function closeInboxRealtime(){
    clearTimeout(state.inboxRefreshTimer);
    state.inboxRefreshTimer=null;
    if(state.inboxChannel){
      try{client.removeChannel(state.inboxChannel)}catch(_){try{state.inboxChannel.unsubscribe?.()}catch(__){}}
      state.inboxChannel=null;
    }
  }

  function subscribeInboxRealtime(){
    closeInboxRealtime();
    if(!state.user||state.activePage!=="messagesPage")return;
    state.inboxChannel=client.channel("ashur-inbox-"+state.user.id)
      .on("postgres_changes",{
        event:"INSERT",
        schema:"public",
        table:"messages"
      },scheduleInboxRefresh)
      .on("postgres_changes",{
        event:"INSERT",
        schema:"public",
        table:"message_reads"
      },scheduleInboxRefresh)
      .subscribe();
  }

  function setChatConnectionStatus(text="",kind=""){
    const el=$("#chatConnectionStatus");
    if(!el)return;
    el.textContent=text;
    el.className="chat-connection-status"+(kind?" "+kind:"");
  }

  function scheduleChatRefresh({markRead=true}={}){
    clearTimeout(state.chatRefreshTimer);
    state.chatRefreshTimer=setTimeout(()=>{
      if($("#chatDialog")?.open&&state.activeConversation){
        loadChat({quiet:true,markRead}).catch(()=>{});
      }
    },180);
  }

  function closeChatRealtime({resetMessages=true}={}){
    clearInterval(state.chatTimer);
    clearTimeout(state.chatRefreshTimer);
    clearTimeout(state.chatReconnectTimer);
    state.chatTimer=null;
    state.chatRefreshTimer=null;
    state.chatReconnectTimer=null;
    if(resetMessages){
      state.chatMessageIds=new Set();
      state.chatMessageCache=new Map();
      state.chatInitialLoaded=false;
      state.chatLastSyncAt=0;
    }
    if(state.chatChannel){
      try{client.removeChannel(state.chatChannel)}catch(_){try{state.chatChannel.unsubscribe?.()}catch(__){}}
      state.chatChannel=null;
    }
    setChatConnectionStatus("");
  }

  function applyChatReadReceipt(messageId){
    if(!messageId)return;
    const row=$("#chatMessages")?.querySelector('[data-message-id="'+CSS.escape(String(messageId))+'"]');
    if(!row)return;
    const receipt=row.querySelector(".message-read");
    if(receipt)receipt.textContent="تمت القراءة";
    const cached=state.chatMessageCache.get(String(messageId));
    if(cached)state.chatMessageCache.set(String(messageId),{...cached,read_by_other:true});
  }

  async function appendRealtimeMessage(message){
    if(!message?.id||message.conversation_id!==state.activeConversation)return;
    const member=(state.activeConversationMeta?.members||[]).find(item=>item.user_id===message.sender_id)||null;
    const enriched={
      ...message,
      sender_profile:message.sender_profile||member?.profile||null,
      sender_role:message.sender_role||member?.role||null,
      sender_nickname:message.sender_nickname||member?.nickname||null
    };
    const existing=state.chatMessageCache.get(String(message.id));
    if(existing){
      state.chatMessageCache.set(String(message.id),{...existing,...enriched});
      await reconcileChatMessages([...state.chatMessageCache.values()],{quiet:true});
      return;
    }
    const next={...enriched,read_by_other:false};
    state.chatMessageCache.set(String(message.id),next);
    await reconcileChatMessages([...state.chatMessageCache.values()],{quiet:true,fromRealtime:true});
    if(message.sender_id!==state.user.id){
      api("/v1/social/message-read",{
        method:"POST",
        body:JSON.stringify({message_ids:[message.id]})
      }).then(scheduleInboxRefresh).catch(()=>{});
    }
  }

  function subscribeChatRealtime(){
    closeChatRealtime({resetMessages:false});
    if(!state.activeConversation)return;
    const conversationId=state.activeConversation;
    setChatConnectionStatus("جارٍ الاتصال...","connecting");

    state.chatChannel=client.channel("ashur-chat-"+conversationId)
      .on("postgres_changes",{
        event:"INSERT",
        schema:"public",
        table:"messages",
        filter:"conversation_id=eq."+conversationId
      },payload=>{
        const message=payload?.new||null;
        appendRealtimeMessage(message).catch(()=>scheduleChatRefresh({markRead:true}));
      })
      .on("postgres_changes",{
        event:"UPDATE",
        schema:"public",
        table:"messages",
        filter:"conversation_id=eq."+conversationId
      },()=>scheduleChatRefresh({markRead:true}))
      .on("postgres_changes",{
        event:"DELETE",
        schema:"public",
        table:"messages",
        filter:"conversation_id=eq."+conversationId
      },()=>scheduleChatRefresh({markRead:false}))
      .on("postgres_changes",{
        event:"INSERT",
        schema:"public",
        table:"message_reads"
      },payload=>{
        const messageId=payload?.new?.message_id||"";
        if(messageId&&state.chatMessageIds.has(messageId))applyChatReadReceipt(messageId);
      })
      .subscribe(status=>{
        if(conversationId!==state.activeConversation)return;
        if(status==="SUBSCRIBED"){
          setChatConnectionStatus("متصل","online");
          clearTimeout(state.chatReconnectTimer);
          state.chatReconnectTimer=null;
        }else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){
          setChatConnectionStatus("إعادة الاتصال...","offline");
          clearTimeout(state.chatReconnectTimer);
          state.chatReconnectTimer=setTimeout(()=>{
            if($("#chatDialog")?.open&&state.activeConversation===conversationId)subscribeChatRealtime();
          },2500);
        }else if(status==="CLOSED"){
          setChatConnectionStatus("غير متصل","offline");
        }
      });

    state.chatTimer=setInterval(()=>{
      if($("#chatDialog").open&&state.activeConversation===conversationId){
        loadChat({quiet:true,markRead:false}).catch(()=>{});
      }
    },45000);
  }

  function renderChatHeader(meta={}){
    const isGroup=meta.kind==="group";
    const profile=meta.peer_profile||{};
    const title=meta.title||profile.name||profile.username||"المحادثة";
    $("#chatTitle").textContent=title;
    $("#chatHeaderSubtitle").textContent=isGroup
      ?(meta.member_count?meta.member_count+" أعضاء":"مجموعة")
      :(profile.username?"@"+profile.username:"محادثة خاصة");

    const avatarRoot=$("#chatHeaderAvatar");
    if(isGroup){
      avatarRoot.classList.add("group-avatar");
      avatarRoot.innerHTML=meta.image_media_id
        ?'<img data-media-id="'+escapeHtml(meta.image_media_id)+'" alt="">'
        :initials(title);
    }else{
      avatarRoot.classList.remove("group-avatar");
      avatarRoot.innerHTML=profile.avatar_media_id
        ?'<img data-media-id="'+escapeHtml(profile.avatar_media_id)+'" alt="">'
        :initials(title);
    }
    hydrateMedia(avatarRoot).catch(()=>{});
  }

  async function fetchConversationDetails(id,{refresh=false}={}){
    if(!refresh&&state.activeConversationMeta?.id===id&&state.activeConversationMeta?.members)return state.activeConversationMeta;
    const details=await api("/v1/conversations/"+encodeURIComponent(id));
    state.activeConversationMeta=details;
    const cached=state.conversationCache.get(id)||{};
    state.conversationCache.set(id,{...cached,...details});
    return details;
  }

  async function openChat(id,title,meta=null){
    closeChatRealtime();
    state.activeConversation=id;
    state.activeConversationMeta=meta?{...meta}:null;
    state.chatLoadSeq++;
    renderChatHeader(meta||{id,title});
    $("#chatMessage").textContent="";
    clearChatAttachment();
    openDialog($("#chatDialog"));

    try{
      const details=await fetchConversationDetails(id,{refresh:true});
      if(state.activeConversation===id)renderChatHeader(details);
    }catch(_){ }

    await loadChat();
    if(state.activeConversation===id)subscribeChatRealtime();
  }

  async function openConversationInfo(){
    if(!state.activeConversation)return;
    const body=$("#conversationInfoBody");
    $("#conversationInfoTitle").textContent="معلومات المحادثة";
    body.innerHTML='<div class="empty">جارٍ تحميل المعلومات...</div>';
    if(!$("#conversationInfoDialog").open)$("#conversationInfoDialog").showModal();

    try{
      const details=await fetchConversationDetails(state.activeConversation,{refresh:true});
      const isGroup=details.kind==="group";
      const myRole=String(details.my_role||"member");
      const canManage=isGroup&&["owner","admin"].includes(myRole);
      const isOwner=myRole==="owner";
      const peer=details.peer_profile||{};
      const title=isGroup?(details.title||"مجموعة"):(peer.name||peer.username||details.title||"مستخدم");
      const avatarHtml=isGroup
        ?(details.image_media_id
          ?'<div class="conversation-info-avatar group"><img data-media-id="'+escapeHtml(details.image_media_id)+'" alt=""></div>'
          :'<div class="conversation-info-avatar group">'+initials(title)+'</div>')
        :(peer.avatar_media_id
          ?'<div class="conversation-info-avatar"><img data-media-id="'+escapeHtml(peer.avatar_media_id)+'" alt=""></div>'
          :'<div class="conversation-info-avatar">'+initials(title)+'</div>');

      const members=isGroup?(details.members||[]):[];
      const memberCards=members.map(member=>{
        const profile=member.profile||{};
        const roleLabel=member.role==="owner"?"المالك":member.role==="admin"?"مشرف":"عضو";
        const searchText=(profile.name+" "+profile.username+" "+(member.nickname||"")).toLowerCase();
        const canRole=isOwner&&member.role!=="owner"&&member.user_id!==state.user.id;
        const canRemove=canManage&&member.role!=="owner"&&member.user_id!==state.user.id&&(isOwner||member.role==="member");
        const manageTools=canManage
          ?'<div class="group-member-menu hidden" data-member-menu-panel="'+escapeHtml(member.user_id)+'">'+
            '<label class="group-nickname-field"><span>الكنية داخل المجموعة</span><input data-member-nickname="'+escapeHtml(member.user_id)+'" maxlength="32" value="'+escapeHtml(member.nickname||"")+'" placeholder="بدون كنية"></label>'+
            '<button class="member-tool save" data-save-member-nickname="'+escapeHtml(member.user_id)+'" type="button">حفظ الكنية</button>'+
            (canRole?'<button class="member-tool role" data-toggle-member-role="'+escapeHtml(member.user_id)+'" type="button">'+(member.role==="admin"?"إلغاء الإشراف":"تعيين مشرف")+'</button>':"")+
            (canRemove?'<button class="member-tool danger" data-remove-member="'+escapeHtml(member.user_id)+'" type="button">إزالة العضو</button>':"")+
          '</div>'
          :"";
        return '<article class="conversation-member-card" data-group-member-card data-member-search="'+escapeHtml(searchText)+'">'+
          '<div class="conversation-member-mainline">'+
            '<button class="conversation-member-row" data-info-profile="'+escapeHtml(member.user_id)+'" type="button">'+
              avatar(profile)+'<span class="grow"><b>'+escapeHtml(profile.name||profile.username||"مستخدم")+
              (profile.is_verified?'<span class="verified-inline">✓</span>':"")+'</b>'+
              '<small>@'+escapeHtml(profile.username||"")+(member.nickname?' · '+escapeHtml(member.nickname):"")+'</small></span>'+
              '<span class="group-role-badge '+escapeHtml(member.role||"member")+'">'+roleLabel+'</span>'+
            '</button>'+
            (canManage?'<button class="group-member-more" data-member-menu="'+escapeHtml(member.user_id)+'" type="button" aria-label="خيارات العضو">•••</button>':"")+
          '</div>'+manageTools+
        '</article>';
      }).join("");

      const groupSettings=canManage
        ?'<section class="group-settings-card">'+
          '<div class="group-settings-title"><div><span class="eyebrow">إدارة المجموعة</span><h4>الصورة والاسم</h4></div></div>'+
          '<div class="group-image-actions">'+
            '<label class="group-image-picker"><input id="groupImageFile" type="file" accept="image/jpeg,image/png,image/webp,image/avif"><span>تغيير صورة المجموعة</span></label>'+
            (details.image_media_id?'<button id="removeGroupImage" type="button">إزالة الصورة</button>':"")+
          '</div>'+
          '<div class="conversation-title-editor"><input id="conversationTitleInput" maxlength="80" value="'+escapeHtml(details.title||"")+'"><button id="saveConversationTitle" class="small-button" type="button">حفظ الاسم</button></div>'+
        '</section>'
        :"";

      const addMemberSection=canManage
        ?'<section class="group-settings-card group-add-members">'+
          '<div class="group-settings-title"><div><span class="eyebrow">الأعضاء</span><h4>إضافة عضو</h4></div></div>'+
          '<div class="search-box standalone group-add-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="groupAddMemberSearch" autocomplete="off" placeholder="ابحث بالاسم أو اليوزر"></div>'+
          '<div id="groupAddMemberResults" class="list compact group-add-results"><div class="empty">اكتب اسمًا للبحث.</div></div>'+
        '</section>'
        :"";

      const memberSection=isGroup
        ?'<section class="group-settings-card group-members-card">'+
          '<div class="group-members-heading"><div><span class="eyebrow">أعضاء المجموعة</span><h4>'+Number(details.member_count||members.length)+' أعضاء</h4></div>'+
          '<div class="search-box compact member-filter-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="groupMemberFilter" autocomplete="off" placeholder="بحث بالأعضاء"></div></div>'+
          '<div class="conversation-info-members">'+memberCards+'</div>'+
        '</section>'
        :"";

      body.innerHTML=
        '<div class="conversation-info-hero group-info-v8">'+avatarHtml+'<h4>'+escapeHtml(title)+'</h4>'+
          '<p>'+(isGroup?(Number(details.member_count||members.length)+' أعضاء'):("@"+escapeHtml(peer.username||"")))+'</p>'+
          (isGroup?'<span class="my-group-role">صلاحيتك: '+(myRole==="owner"?"المالك":myRole==="admin"?"مشرف":"عضو")+'</span>':"")+
        '</div>'+
        '<div class="conversation-info-actions">'+
          (!isGroup?'<button id="conversationViewProfile" type="button">عرض الملف الشخصي</button>':"")+
          '<button id="conversationMuteButton" type="button">'+(details.muted?"إلغاء كتم الإشعارات":"كتم الإشعارات")+'</button>'+
        '</div>'+
        groupSettings+addMemberSection+memberSection+
        '<p id="conversationInfoMessage" class="message" aria-live="polite"></p>';

      await hydrateMedia(body);

      const setMessage=(text,good=false)=>{
        const el=$("#conversationInfoMessage");
        if(!el)return;
        el.textContent=text||"";
        el.className="message "+(text?(good?"success":"error"):"");
      };

      if($("#conversationViewProfile"))$("#conversationViewProfile").onclick=()=>{
        const userId=peer.id;
        $("#conversationInfoDialog").close();
        $("#chatDialog").close();
        closeChatRealtime();
        state.activeConversation=null;
        state.activeConversationMeta=null;
        if(userId)openPublicProfile(userId);
      };

      $("#conversationMuteButton").onclick=async()=>{
        const button=$("#conversationMuteButton");
        button.disabled=true;
        try{
          const next=!Boolean(details.muted);
          await api("/v1/conversations/"+encodeURIComponent(details.id),{
            method:"PATCH",
            body:JSON.stringify({muted:next})
          });
          details.muted=next;
          button.textContent=next?"إلغاء كتم الإشعارات":"كتم الإشعارات";
          setMessage(next?"تم كتم إشعارات المحادثة.":"تم تفعيل إشعارات المحادثة.",true);
        }catch(error){setMessage(error.message)}
        finally{button.disabled=false}
      };

      if($("#saveConversationTitle"))$("#saveConversationTitle").onclick=async()=>{
        const button=$("#saveConversationTitle");
        const next=$("#conversationTitleInput").value.trim();
        if(next.length<2)return setMessage("اكتب اسمًا أوضح للمجموعة.");
        button.disabled=true;
        try{
          await api("/v1/conversations/"+encodeURIComponent(details.id),{
            method:"PATCH",
            body:JSON.stringify({title:next})
          });
          details.title=next;
          state.activeConversationMeta=details;
          renderChatHeader(details);
          await loadConversations();
          setMessage("تم تحديث اسم المجموعة.",true);
        }catch(error){setMessage(error.message)}
        finally{button.disabled=false}
      };

      if($("#groupImageFile"))$("#groupImageFile").onchange=async()=>{
        const input=$("#groupImageFile");
        const file=input.files?.[0]||null;
        if(!file)return;
        const check=profileUtil.validateImageFile(file);
        if(!check.ok){input.value="";return setMessage(check.error)}
        input.disabled=true;
        setMessage("جارٍ رفع صورة المجموعة...",true);
        try{
          const media=await uploadFile(file,"group_media",{silent:true});
          await api("/v1/conversations/"+encodeURIComponent(details.id),{
            method:"PATCH",
            body:JSON.stringify({image_media_id:media.id})
          });
          details.image_media_id=media.id;
          state.activeConversationMeta=details;
          renderChatHeader(details);
          await loadConversations();
          await openConversationInfo();
        }catch(error){setMessage(error.message)}
        finally{if(input.isConnected)input.disabled=false}
      };

      if($("#removeGroupImage"))$("#removeGroupImage").onclick=async()=>{
        const ok=await confirmAction({title:"إزالة صورة المجموعة؟",text:"سيتم الرجوع إلى الحرف الأول من اسم المجموعة.",acceptLabel:"إزالة",danger:true});
        if(!ok)return;
        try{
          await api("/v1/conversations/"+encodeURIComponent(details.id),{method:"PATCH",body:JSON.stringify({image_media_id:null})});
          details.image_media_id=null;
          state.activeConversationMeta=details;
          renderChatHeader(details);
          await loadConversations();
          await openConversationInfo();
        }catch(error){setMessage(error.message)}
      };

      const memberFilter=$("#groupMemberFilter");
      if(memberFilter)memberFilter.oninput=()=>{
        const q=memberFilter.value.trim().toLowerCase();
        body.querySelectorAll("[data-group-member-card]").forEach(card=>{
          card.classList.toggle("hidden",Boolean(q)&&!String(card.dataset.memberSearch||"").includes(q));
        });
      };

      body.querySelectorAll("[data-member-menu]").forEach(button=>button.onclick=event=>{
        event.stopPropagation();
        const userId=button.dataset.memberMenu;
        const panel=body.querySelector('[data-member-menu-panel="'+CSS.escape(userId)+'"]');
        const open=panel&&!panel.classList.contains("hidden");
        body.querySelectorAll("[data-member-menu-panel]").forEach(item=>item.classList.add("hidden"));
        body.querySelectorAll("[data-member-menu]").forEach(item=>item.classList.remove("active"));
        if(panel&&!open){
          panel.classList.remove("hidden");
          button.classList.add("active");
        }
      });

      body.querySelectorAll("[data-save-member-nickname]").forEach(button=>button.onclick=async()=>{
        const userId=button.dataset.saveMemberNickname;
        const input=body.querySelector('[data-member-nickname="'+CSS.escape(userId)+'"]');
        button.disabled=true;
        try{
          await api("/v1/conversations/"+encodeURIComponent(details.id)+"/members/"+encodeURIComponent(userId),{
            method:"PATCH",
            body:JSON.stringify({nickname:input?.value||""})
          });
          const member=details.members.find(item=>item.user_id===userId);
          if(member)member.nickname=(input?.value||"").trim()||null;
          setMessage("تم حفظ الكنية.",true);
          await loadChat({quiet:true,markRead:false});
        }catch(error){setMessage(error.message)}
        finally{button.disabled=false}
      });

      body.querySelectorAll("[data-toggle-member-role]").forEach(button=>button.onclick=async()=>{
        const userId=button.dataset.toggleMemberRole;
        const member=details.members.find(item=>item.user_id===userId);
        if(!member)return;
        const nextRole=member.role==="admin"?"member":"admin";
        const ok=await confirmAction({
          title:nextRole==="admin"?"تعيين مشرف؟":"إلغاء الإشراف؟",
          text:nextRole==="admin"?"سيتمكن هذا العضو من تعديل المجموعة وإضافة وإزالة الأعضاء العاديين.":"ستعود صلاحية العضو إلى عضو عادي.",
          acceptLabel:nextRole==="admin"?"تعيين":"إلغاء الإشراف"
        });
        if(!ok)return;
        button.disabled=true;
        try{
          await api("/v1/conversations/"+encodeURIComponent(details.id)+"/members/"+encodeURIComponent(userId),{
            method:"PATCH",
            body:JSON.stringify({role:nextRole})
          });
          member.role=nextRole;
          await openConversationInfo();
        }catch(error){setMessage(error.message);button.disabled=false}
      });

      body.querySelectorAll("[data-remove-member]").forEach(button=>button.onclick=async()=>{
        const userId=button.dataset.removeMember;
        const member=details.members.find(item=>item.user_id===userId);
        const label=member?.profile?.name||member?.profile?.username||"هذا العضو";
        const ok=await confirmAction({title:"إزالة عضو؟",text:"سيتم إزالة "+label+" من المجموعة.",acceptLabel:"إزالة",danger:true});
        if(!ok)return;
        button.disabled=true;
        try{
          await api("/v1/conversations/"+encodeURIComponent(details.id)+"/members/"+encodeURIComponent(userId),{method:"DELETE"});
          details.members=details.members.filter(item=>item.user_id!==userId);
          details.member_count=details.members.length;
          await openConversationInfo();
          await loadConversations();
        }catch(error){setMessage(error.message);button.disabled=false}
      });

      body.querySelectorAll("[data-info-profile]").forEach(button=>button.onclick=()=>{
        const userId=button.dataset.infoProfile;
        if(userId===state.user.id)return;
        $("#conversationInfoDialog").close();
        $("#chatDialog").close();
        closeChatRealtime();
        state.activeConversation=null;
        state.activeConversationMeta=null;
        openPublicProfile(userId);
      });

      const addSearch=$("#groupAddMemberSearch");
      const addRoot=$("#groupAddMemberResults");
      if(addSearch&&addRoot){
        let addTimer=null;
        const existingIds=new Set(details.members.map(item=>item.user_id));
        const searchCandidates=async()=>{
          const raw=addSearch.value.trim();
          if(!raw){
            addRoot.innerHTML='<div class="empty">اكتب اسمًا للبحث.</div>';
            return;
          }
          const safe=raw.replace(/[,%()]/g,"").slice(0,40);
          const {data,error}=await client.from("profiles")
            .select("id,name,username,avatar_media_id,is_verified")
            .neq("id",state.user.id)
            .eq("is_banned",false)
            .or("name.ilike.%"+safe+"%,username.ilike.%"+safe+"%")
            .limit(20);
          if(error){addRoot.innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';return}
          const rows=(data||[]).filter(profile=>!existingIds.has(profile.id));
          addRoot.innerHTML=rows.map(profile=>
            '<div class="group-add-result">'+avatar(profile)+'<span class="grow"><b>'+escapeHtml(profile.name||"مستخدم")+(profile.is_verified?'<span class="verified-inline">✓</span>':"")+'</b><small>@'+escapeHtml(profile.username||"")+'</small></span>'+
            '<button data-add-group-member="'+escapeHtml(profile.id)+'" type="button">إضافة</button></div>'
          ).join("")||'<div class="empty">لا توجد حسابات متاحة للإضافة.</div>';
          await hydrateMedia(addRoot);
          addRoot.querySelectorAll("[data-add-group-member]").forEach(button=>button.onclick=async()=>{
            button.disabled=true;
            try{
              await api("/v1/conversations/"+encodeURIComponent(details.id)+"/members",{
                method:"POST",
                body:JSON.stringify({user_id:button.dataset.addGroupMember})
              });
              await openConversationInfo();
              await loadConversations();
            }catch(error){setMessage(error.message);button.disabled=false}
          });
        };
        addSearch.oninput=()=>{
          clearTimeout(addTimer);
          addTimer=setTimeout(()=>searchCandidates().catch(error=>setMessage(error.message)),170);
        };
      }
    }catch(error){
      body.innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
    }
  }

  $("#chatContactButton").onclick=openConversationInfo;
  $("#chatHeaderAction").onclick=openConversationInfo;
  $("#closeConversationInfo").onclick=()=>$("#conversationInfoDialog").close();

  function sharedMessageMarkup(message){
    if(!message.shared_type||!message.shared_id)return "";
    const label=message.shared_type==="post"?"منشور":message.shared_type==="reel"?"ريلز":message.shared_type==="story"?"قصة":"حساب";
    return '<button class="message-shared-card" data-open-message-share="'+escapeHtml(message.shared_type)+':'+escapeHtml(message.shared_id)+'" type="button">'+
      icon(message.shared_type==="reel"?"play":"share")+
      '<span><b>محتوى مشارك</b><small>فتح '+label+'</small></span>'+
    '</button>';
  }
  function chatMessageSignature(message,parent=null){
    const sender=message.sender_profile||{};
    return JSON.stringify([
      message.id,message.sender_id,message.body||"",message.media_id||"",message.reply_to||"",
      message.shared_type||"",message.shared_id||"",message.created_at||"",
      Boolean(message.read_by_other),
      message.sender_nickname||"",message.sender_role||"",
      sender.name||"",sender.username||"",sender.avatar_media_id||"",
      parent?.id||"",parent?.body||"",parent?.media_id||"",parent?.shared_type||"",parent?.shared_id||""
    ]);
  }

  function chatMessageRowMarkup(message,byId){
    const parent=message.reply_to?byId.get(message.reply_to):null;
    const media=message.media_id
      ?'<img class="chat-media chat-media-pending" data-media-id="'+escapeHtml(message.media_id)+'" alt="مرفق">'
      :"";
    const body=message.body
      ?'<div class="message-text">'+chatTextMarkup(message.body)+'</div>'
      :"";
    const parentHtml=parent
      ?'<div class="message-reply-preview"><span>رد على رسالة</span><b>'+escapeHtml(parent.body||"مرفق")+'</b></div>'
      :"";
    const mine=message.sender_id===state.user.id;
    const delivery=mine
      ?'<span class="message-read">'+(message.read_by_other?"تمت القراءة":"تم الإرسال")+'</span>'
      :"";
    const signature=chatMessageSignature(message,parent);
    const bubble='<div class="bubble">'+parentHtml+sharedMessageMarkup(message)+media+body+'</div>';
    const meta='<div class="message-meta-line"><time>'+new Date(message.created_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"})+'</time>'+delivery+'</div>';
    const isGroup=state.activeConversationMeta?.kind==="group";

    if(isGroup&&!mine){
      const sender=message.sender_profile||{};
      const display=message.sender_nickname||sender.name||sender.username||"عضو";
      const roleLabel=message.sender_role==="owner"?"المالك":message.sender_role==="admin"?"مشرف":"";
      const senderHead='<div class="message-sender-label"><b>'+escapeHtml(display)+'</b>'+
        (roleLabel?'<span>'+roleLabel+'</span>':"")+'</div>';
      return '<div class="message-row other group-message" data-message-id="'+escapeHtml(message.id)+'" data-message-signature="'+escapeHtml(signature)+'">'+
        '<div class="group-message-avatar">'+avatar(sender,"message-sender-avatar")+'</div>'+
        '<div class="message-stack">'+senderHead+bubble+meta+'</div></div>';
    }

    return '<div class="message-row '+(mine?"mine":"other")+'" data-message-id="'+escapeHtml(message.id)+'" data-message-signature="'+escapeHtml(signature)+'">'+
      bubble+meta+
    '</div>';
  }

  function createChatMessageNode(message,byId){
    const template=document.createElement("template");
    template.innerHTML=chatMessageRowMarkup(message,byId).trim();
    return template.content.firstElementChild;
  }

  async function reconcileChatMessages(messages,{quiet=false,fromRealtime=false}={}){
    const root=$("#chatMessages");
    if(!root)return;
    const sorted=[...(messages||[])].sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0));
    const byId=new Map(sorted.map(message=>[String(message.id),message]));
    const incomingIds=new Set(byId.keys());
    const wasNearBottom=root.scrollHeight-root.scrollTop-root.clientHeight<110;
    const changed=[];

    root.querySelector(".chat-empty-state")?.remove();

    root.querySelectorAll("[data-message-id]").forEach(node=>{
      if(!incomingIds.has(String(node.dataset.messageId||"")))node.remove();
    });

    let previous=null;
    for(const message of sorted){
      const id=String(message.id);
      const signature=chatMessageSignature(message,message.reply_to?byId.get(String(message.reply_to)):null);
      let node=root.querySelector('[data-message-id="'+CSS.escape(id)+'"]');

      if(!node){
        node=createChatMessageNode(message,byId);
        if(previous?.nextSibling)root.insertBefore(node,previous.nextSibling);
        else if(previous)root.appendChild(node);
        else root.insertBefore(node,root.firstChild);
        changed.push(node);
      }else if(node.dataset.messageSignature!==signature){
        const replacement=createChatMessageNode(message,byId);
        node.replaceWith(replacement);
        node=replacement;
        changed.push(node);
      }

      if(previous&&node.previousElementSibling!==previous){
        root.insertBefore(node,previous.nextSibling);
      }
      previous=node;
    }

    if(!sorted.length){
      root.innerHTML='<div class="empty chat-empty-state">ابدأ المحادثة برسالة.</div>';
    }

    state.chatMessageCache=new Map(sorted.map(message=>[String(message.id),message]));
    state.chatMessageIds=new Set(state.chatMessageCache.keys());
    state.chatLastSyncAt=Date.now();

    for(const node of changed){
      await hydrateMedia(node).catch(()=>{});
    }

    if(!state.chatInitialLoaded||!quiet||(fromRealtime&&wasNearBottom)){
      root.scrollTop=root.scrollHeight;
    }
    state.chatInitialLoaded=true;
  }

  $("#chatMessages").addEventListener("click",event=>{
    const btn=event.target.closest?.("[data-open-message-share]");
    if(!btn)return;
    const raw=btn.dataset.openMessageShare||"";
    const cut=raw.indexOf(":");
    if(cut<0)return;
    const type=raw.slice(0,cut),id=raw.slice(cut+1);
    $("#chatDialog").close();
    closeChatRealtime();
    state.activeConversation=null;
    state.activeConversationMeta=null;
    openSharedContent(type,id).catch(error=>openInfoDialog("تعذر الفتح",'<div class="empty error">'+escapeHtml(error.message)+'</div>'));
  });



  async function loadChat({quiet=false,markRead=true}={}){
    if(!state.activeConversation)return;
    const conversationId=state.activeConversation;
    const seq=++state.chatLoadSeq;

    let data=[];
    try{
      const result=await api("/v1/conversations/"+encodeURIComponent(conversationId)+"/messages");
      data=result.items||[];
    }catch(apiError){
      // Compatibility fallback for an older Ashur API deployment.
      const direct=await client.from("messages")
        .select("id,sender_id,body,media_id,reply_to,shared_type,shared_id,created_at")
        .eq("conversation_id",conversationId)
        .eq("is_deleted",false)
        .order("created_at")
        .limit(220);

      if(direct.error){
        if(!quiet&&conversationId===state.activeConversation){
          $("#chatMessages").innerHTML='<div class="empty error">'+escapeHtml(apiError.message||direct.error.message)+'</div>';
        }
        return;
      }

      data=direct.data||[];
      const ownIds=data.filter(m=>m.sender_id===state.user.id).map(m=>m.id);
      if(ownIds.length){
        const reads=await client.from("message_reads")
          .select("message_id,user_id")
          .in("message_id",ownIds);
        const readSet=new Set((reads.data||[]).filter(r=>r.user_id!==state.user.id).map(r=>r.message_id));
        data=data.map(m=>({...m,read_by_other:m.sender_id===state.user.id&&readSet.has(m.id)}));
      }
      console.warn("ASHUR_CHAT_API_FALLBACK",apiError);
    }

    if(conversationId!==state.activeConversation||seq!==state.chatLoadSeq)return;

    const otherUnread=data.filter(m=>m.sender_id!==state.user.id).map(m=>m.id);
    await reconcileChatMessages(data,{quiet});

    if(markRead&&otherUnread.length){
      api("/v1/social/message-read",{
        method:"POST",
        body:JSON.stringify({message_ids:otherUnread})
      }).then(scheduleInboxRefresh).catch(()=>{});
    }
  }

  function stopVoiceTracks(){
    if(state.voiceStream){
      state.voiceStream.getTracks().forEach(track=>track.stop());
      state.voiceStream=null;
    }
  }

  function clearVoiceTimer(){
    clearInterval(state.voiceTimer);
    state.voiceTimer=null;
    state.voiceStartedAt=0;
    $("#voiceRecordTimer").textContent="0:00";
    $("#voiceRecordTimer").classList.add("hidden");
    $("#voiceRecordButton").classList.remove("recording");
  }

  async function stopVoiceRecording(discard=false){
    if(state.voiceRecorder&&state.voiceRecorder.state!=="inactive"){
      await new Promise(resolve=>{
        const done=state.voiceRecorder.onstop;
        state.voiceRecorder.addEventListener("stop",()=>resolve(),{once:true});
        try{state.voiceRecorder.stop()}catch(_){resolve()}
      }).catch(()=>{});
    }
    clearVoiceTimer();
    stopVoiceTracks();
    if(discard){
      state.voiceChunks=[];
      state.recordedVoiceFile=null;
    }
    state.voiceRecorder=null;
  }

  function resetPendingChatDelivery({keepMedia=false}={}){
    state.pendingChatSendId=null;
    if(!keepMedia){
      state.pendingChatMediaId=null;
      state.pendingChatFileKey=null;
    }
  }

  function clearChatAttachment(){
    resetPendingChatDelivery();
    if(state.chatPreviewUrl){
      URL.revokeObjectURL(state.chatPreviewUrl);
      state.chatPreviewUrl=null;
    }
    if(state.voiceRecorder?.state==="recording"){
      try{state.voiceRecorder.stop()}catch(_){}
    }
    clearVoiceTimer();
    stopVoiceTracks();
    state.voiceRecorder=null;
    state.voiceChunks=[];
    state.recordedVoiceFile=null;
    if($("#chatFile"))$("#chatFile").value="";
    if($("#chatAttachmentPreview")){
      $("#chatAttachmentPreview").innerHTML="";
      $("#chatAttachmentPreview").classList.add("hidden");
    }
  }

  function showVoicePreview(file){
    resetPendingChatDelivery();
    if(state.chatPreviewUrl)URL.revokeObjectURL(state.chatPreviewUrl);
    state.chatPreviewUrl=URL.createObjectURL(file);
    $("#chatAttachmentPreview").innerHTML=
      '<div class="voice-preview stage6-voice-preview"><audio src="'+state.chatPreviewUrl+'" preload="metadata"></audio>'+
      '<div class="chat-preview-copy"><b>رسالة صوتية جاهزة</b><small>راجع التسجيل ثم أرسله</small></div>'+
      '<button id="removeChatAttachment" class="chat-preview-remove" type="button" aria-label="إزالة">×</button></div>';
    $("#chatAttachmentPreview").classList.remove("hidden");
    const audio=$("#chatAttachmentPreview").querySelector("audio");
    if(audio)enhanceAudioPlayer(audio,{original_name:"رسالة صوتية"});
    $("#removeChatAttachment").onclick=clearChatAttachment;
  }

  $("#chatFile").onchange=()=>{
    const file=$("#chatFile").files[0];
    if(!file)return;
    resetPendingChatDelivery();
    if(state.recordedVoiceFile){
      state.recordedVoiceFile=null;
      state.voiceChunks=[];
    }
    if(state.chatPreviewUrl){
      URL.revokeObjectURL(state.chatPreviewUrl);
      state.chatPreviewUrl=null;
    }
    $("#chatAttachmentPreview").innerHTML="";
    $("#chatAttachmentPreview").classList.add("hidden");

    const max=Number(state.limits.chat_video_mb||50)*1024*1024;
    if(file.size>max){
      $("#chatAttachmentPreview").innerHTML='<div class="chat-preview-error">حجم المرفق يتجاوز الحد المسموح.</div>';
      $("#chatAttachmentPreview").classList.remove("hidden");
      $("#chatFile").value="";
      return;
    }

    state.chatPreviewUrl=URL.createObjectURL(file);
    const kind=file.type.startsWith("image/")
      ?"صورة"
      :file.type.startsWith("video/")
        ?"فيديو"
        :file.type.startsWith("audio/")
          ?"ملف صوتي"
          :"ملف";

    const preview=file.type.startsWith("image/")
      ?'<img class="chat-preview-image" src="'+state.chatPreviewUrl+'" alt="">'
      :file.type.startsWith("video/")
        ?'<video class="chat-preview-video" src="'+state.chatPreviewUrl+'" playsinline preload="metadata"></video>'
        :file.type.startsWith("audio/")
          ?'<audio class="chat-preview-audio" src="'+state.chatPreviewUrl+'" preload="metadata"></audio>'
          :'<span class="chat-preview-file-icon">'+icon("link")+'</span>';

    $("#chatAttachmentPreview").innerHTML=
      '<div class="chat-preview-card">'+preview+
      '<div class="chat-preview-copy"><b>'+kind+' جاهز للإرسال</b><small>يمكنك إضافة وصف من حقل الرسالة</small></div>'+
      '<button id="removeChatAttachment" class="chat-preview-remove" type="button" aria-label="إزالة">×</button></div>';
    $("#chatAttachmentPreview").classList.remove("hidden");

    const video=$("#chatAttachmentPreview").querySelector("video");
    const audio=$("#chatAttachmentPreview").querySelector("audio");
    if(video)enhanceVideoPlayer(video);
    if(audio)enhanceAudioPlayer(audio,{original_name:"ملف صوتي"});
    $("#removeChatAttachment").onclick=clearChatAttachment;
  };

  async function ensureNativeAudioPermission(){
    try{
      if(window.AshurNative?.hasAudioPermission?.())return true;
      window.AshurNative?.requestAudioPermission?.();
      for(let i=0;i<24;i++){
        await new Promise(resolve=>setTimeout(resolve,125));
        if(window.AshurNative?.hasAudioPermission?.())return true;
      }
      return !window.AshurNative?.hasAudioPermission;
    }catch{return true}
  }

  async function openVoiceStream(){
    stopVoiceTracks();
    const constraints=[
      {audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}},
      {audio:true}
    ];
    let lastError=null;
    for(const config of constraints){
      try{
        const stream=await navigator.mediaDevices.getUserMedia(config);
        const track=stream.getAudioTracks?.()[0];
        if(track&&track.readyState==="live")return stream;
        stream.getTracks().forEach(t=>t.stop());
      }catch(error){
        lastError=error;
        await new Promise(resolve=>setTimeout(resolve,260));
      }
    }
    throw lastError||new Error("تعذر تشغيل الميكروفون");
  }

  function voiceErrorMessage(error){
    const name=String(error?.name||"");
    const message=String(error?.message||"");
    if(name==="NotAllowedError"||name==="SecurityError")return "يلزم السماح لآشور باستخدام الميكروفون من أذونات التطبيق.";
    if(name==="NotFoundError")return "لم يتم العثور على ميكروفون متاح على الجهاز.";
    if(name==="NotReadableError"||/audio source/i.test(message))return "تعذر تشغيل الميكروفون. أغلق أي تطبيق يستخدم التسجيل أو المكالمة ثم أعد المحاولة.";
    return message&&message!=="Could not start audio source"?message:"تعذر بدء التسجيل الصوتي.";
  }

  $("#voiceRecordButton").onclick=async()=>{
    if(state.voiceRecorder?.state==="recording"){
      try{state.voiceRecorder.stop()}catch(_){ }
      return;
    }
    const btn=$("#voiceRecordButton");
    btn.disabled=true;
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
        throw new Error("التسجيل الصوتي غير مدعوم على هذا الجهاز.");
      }
      clearChatAttachment();
      const permitted=await ensureNativeAudioPermission();
      if(!permitted)throw Object.assign(new Error("Microphone permission denied"),{name:"NotAllowedError"});
      const stream=await openVoiceStream();
      state.voiceStream=stream;
      const types=["audio/webm;codecs=opus","audio/webm","audio/mp4"];
      const mime=types.find(t=>MediaRecorder.isTypeSupported?.(t))||"";
      const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
      state.voiceRecorder=recorder;
      state.voiceChunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size)state.voiceChunks.push(e.data)};
      recorder.onerror=e=>{
        console.warn("ASHUR_VOICE_RECORDER_ERROR",e?.error||e);
        stopVoiceTracks();
        clearVoiceTimer();
      };
      recorder.onstop=()=>{
        const type=recorder.mimeType||"audio/webm";
        const blob=new Blob(state.voiceChunks,{type});
        stopVoiceTracks();
        clearVoiceTimer();
        state.voiceRecorder=null;
        if(blob.size<800){
          state.voiceChunks=[];
          $("#chatMessage").textContent="التسجيل قصير جدًا أو لم يلتقط صوتًا.";
          return;
        }
        const ext=type.includes("mp4")?"m4a":"webm";
        state.recordedVoiceFile=new File([blob],"voice-"+Date.now()+"."+ext,{type});
        showVoicePreview(state.recordedVoiceFile);
        $("#chatMessage").textContent="";
      };
      recorder.start(250);
      state.voiceStartedAt=Date.now();
      btn.classList.add("recording");
      $("#voiceRecordTimer").classList.remove("hidden");
      state.voiceTimer=setInterval(()=>{
        const sec=Math.floor((Date.now()-state.voiceStartedAt)/1000);
        $("#voiceRecordTimer").textContent=Math.floor(sec/60)+":"+String(sec%60).padStart(2,"0");
        if(sec>=180){try{recorder.stop()}catch(_){ }}
      },250);
    }catch(error){
      clearVoiceTimer();
      stopVoiceTracks();
      state.voiceRecorder=null;
      openInfoDialog("التسجيل الصوتي",`<div class="empty error">${escapeHtml(voiceErrorMessage(error))}</div>`);
    }finally{
      btn.disabled=false;
    }
  };

  function chatFileKey(file){
    if(!file)return "";
    return [file.name||"",file.size||0,file.type||"",file.lastModified||0].join(":");
  }

  function setChatSendBusy(busy){
    const form=$("#chatForm");
    if(!form)return;
    form.setAttribute("aria-busy",busy?"true":"false");
    const submit=form.querySelector("button[type='submit']");
    if(submit)submit.disabled=Boolean(busy);
    $("#chatInput").disabled=Boolean(busy);
    $("#voiceRecordButton").disabled=Boolean(busy);
    $("#chatFile").disabled=Boolean(busy);
  }

  $("#chatInput").oninput=()=>{
    state.pendingChatSendId=null;
  };

  $("#chatForm").onsubmit=async(e)=>{
    e.preventDefault();
    if(!state.activeConversation)return;

    if(state.voiceRecorder?.state==="recording"){
      await stopVoiceRecording(false);
    }

    const body=$("#chatInput").value.trim().slice(0,4000);
    const file=state.recordedVoiceFile||$("#chatFile").files[0]||null;
    if(!body&&!file)return;

    const message=$("#chatMessage");
    setChatSendBusy(true);
    message.textContent=file?"جارٍ تجهيز المرفق...":"جارٍ إرسال الرسالة...";

    try{
      let mediaId=null;
      if(file){
        const key=chatFileKey(file);
        if(state.pendingChatFileKey!==key){
          state.pendingChatFileKey=key;
          state.pendingChatMediaId=null;
          state.pendingChatSendId=null;
        }

        if(state.pendingChatMediaId){
          mediaId=state.pendingChatMediaId;
        }else{
          const kind=file.type.startsWith("image/")?"chat_image":
            file.type.startsWith("video/")?"chat_video":
            file.type.startsWith("audio/")?"chat_audio":"chat_file";
          message.textContent="جارٍ رفع المرفق...";
          const media=await uploadFile(file,kind,{silent:true});
          mediaId=media.id;
          state.pendingChatMediaId=mediaId;
        }
      }

      if(!state.pendingChatSendId){
        state.pendingChatSendId=crypto.randomUUID?.()||(
          "00000000-0000-4000-8000-"+Math.random().toString(16).slice(2).padEnd(12,"0").slice(0,12)
        );
      }

      message.textContent="جارٍ إرسال الرسالة...";
      const conversationId=state.activeConversation;
      const sent=await api("/v1/conversations/"+encodeURIComponent(conversationId)+"/messages",{
        method:"POST",
        body:JSON.stringify({
          body,
          media_id:mediaId,
          client_message_id:state.pendingChatSendId
        })
      });

      $("#chatInput").value="";
      clearChatAttachment();
      message.textContent="";
      if(sent?.id&&conversationId===state.activeConversation){
        await appendRealtimeMessage({...sent,conversation_id:sent.conversation_id||conversationId});
      }
      scheduleInboxRefresh();
    }catch(error){
      message.textContent=(error?.message||"تعذر إرسال الرسالة.")+" يمكنك إعادة المحاولة دون تكرار الرسالة.";
    }finally{
      setChatSendBusy(false);
    }
  };

  $("#closeChat").onclick=()=>{
    closeChatRealtime();
    state.activeConversation=null;
    state.activeConversationMeta=null;
    state.chatLoadSeq++;
    clearChatAttachment();
    $("#chatMessage").textContent="";
    $("#chatDialog").close();
    scheduleInboxRefresh();
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
    const targetTable=state.commentTarget.type==="post"?"posts":"reels";

    const [commentsResult,targetResult]=await Promise.all([
      client.from("comments")
        .select("id,author_id,parent_id,body,created_at,updated_at,pinned_at")
        .eq(field,state.commentTarget.id)
        .order("created_at",{ascending:true})
        .limit(200),
      client.from(targetTable)
        .select("author_id,comments_enabled")
        .eq("id",state.commentTarget.id)
        .maybeSingle()
    ]);

    if(commentsResult.error){
      $("#commentsList").innerHTML='<div class="empty error">'+escapeHtml(commentsResult.error.message)+'</div>';
      return;
    }

    const data=[...(commentsResult.data||[])].sort((a,b)=>{
      const pin=Number(Boolean(b.pinned_at))-Number(Boolean(a.pinned_at));
      if(pin)return pin;
      return new Date(a.created_at)-new Date(b.created_at);
    });
    const commentsAllowed=targetResult.data?.comments_enabled!==false;
    const canPinComments=targetResult.data?.author_id===state.user.id;
    const commentInput=$("#commentInput");
    const commentSubmit=$("#commentForm button[type='submit']");
    if(commentInput){
      commentInput.disabled=!commentsAllowed;
      commentInput.placeholder=commentsAllowed?"اكتب تعليقًا...":"التعليقات مغلقة لهذا المحتوى";
    }
    if(commentSubmit)commentSubmit.disabled=!commentsAllowed;
    if($("#commentMessage"))$("#commentMessage").textContent=commentsAllowed?"":"صاحب المحتوى أوقف التعليقات.";
    const profiles=await profilesMap([...new Set(data.map(x=>x.author_id))]);
    const byId=new Map(data.map(row=>[row.id,row]));

    $("#commentsList").innerHTML=data.map(row=>{
      const p=profiles[row.author_id]||{};
      const parent=row.parent_id?byId.get(row.parent_id):null;
      const parentProfile=parent?profiles[parent.author_id]||{}:null;
      const parentHtml=parent
        ?'<div class="comment-parent">رد على @'+escapeHtml(parentProfile?.username||parentProfile?.name||"مستخدم")+': '+escapeHtml(parent.body||"")+'</div>'
        :"";
      const edited=row.updated_at&&new Date(row.updated_at).getTime()>new Date(row.created_at).getTime()+1000
        ?' · تم التعديل':"";
      const own=row.author_id===state.user.id;
      const pinned=Boolean(row.pinned_at);
      const pinButton=canPinComments&&!row.parent_id
        ?'<button class="comment-action '+(pinned?"active":"")+'" data-pin-comment="'+escapeHtml(row.id)+'" data-pinned="'+String(pinned)+'" type="button">'+(pinned?"إلغاء التثبيت":"تثبيت")+'</button>'
        :"";
      return '<div class="comment-item '+(row.parent_id?"reply ":"")+(pinned?"pinned-comment":"")+'" data-comment-id="'+escapeHtml(row.id)+'">'+
        avatar(p)+
        '<div class="comment-bubble"><div class="comment-bubble-head"><b>'+escapeHtml(p.name||p.username||"مستخدم")+'</b>'+
        (p.is_verified?'<span class="verified-inline">✓</span>':"")+
        (pinned?'<span class="comment-pinned-badge">'+icon("pin")+'مثبت</span>':"")+
        '</div>'+
        parentHtml+'<p class="comment-body-text">'+richText(row.body)+'</p>'+
        '<div class="comment-meta">'+new Date(row.created_at).toLocaleString("ar-IQ")+edited+'</div>'+
        '<div class="comment-actions">'+
          '<button class="comment-action" data-reply-comment="'+escapeHtml(row.id)+'" data-reply-name="'+escapeHtml(p.username||p.name||"مستخدم")+'" type="button">رد</button>'+
          pinButton+
          (own
            ?'<button class="comment-action" data-edit-comment="'+escapeHtml(row.id)+'" data-comment-body="'+escapeHtml(row.body)+'" type="button">تعديل</button>'+
             '<button class="comment-action danger" data-delete-comment="'+escapeHtml(row.id)+'" type="button">حذف</button>'
            :'<button class="comment-action" data-report-comment="'+escapeHtml(row.id)+'" type="button">إبلاغ</button>')+
        '</div></div></div>';
    }).join("")||'<div class="empty">لا توجد تعليقات بعد. اكتب أول تعليق.</div>';

    await hydrateMedia($("#commentsList"));

    $("#commentsList").querySelectorAll("[data-reply-comment]").forEach(btn=>btn.onclick=()=>{
      state.commentReply={id:btn.dataset.replyComment,name:"@"+btn.dataset.replyName};
      updateCommentReplyBar();
      $("#commentInput").focus();
    });

    $("#commentsList").querySelectorAll("[data-pin-comment]").forEach(btn=>btn.onclick=async()=>{
      btn.disabled=true;
      try{
        const next=btn.dataset.pinned!=="true";
        await api("/v1/social/comments/"+btn.dataset.pinComment+"/pin",{
          method:"PATCH",
          body:JSON.stringify({pinned:next})
        });
        await loadComments();
      }catch(error){
        $("#commentMessage").textContent=error.message;
        btn.disabled=false;
      }
    });

    $("#commentsList").querySelectorAll("[data-edit-comment]").forEach(btn=>btn.onclick=()=>{
      const item=btn.closest(".comment-item");
      const bubble=item?.querySelector(".comment-bubble");
      const text=item?.querySelector(".comment-body-text");
      const actions=item?.querySelector(".comment-actions");
      if(!bubble||!text||!actions||bubble.querySelector(".comment-inline-editor"))return;

      text.classList.add("hidden");
      actions.classList.add("hidden");
      const editor=document.createElement("div");
      editor.className="comment-inline-editor";
      editor.innerHTML='<textarea maxlength="2000"></textarea><div><button class="small-button" data-save-edit type="button">حفظ</button><button class="comment-action" data-cancel-edit type="button">إلغاء</button></div><p class="message"></p>';
      const textarea=editor.querySelector("textarea");
      textarea.value=btn.dataset.commentBody||"";
      bubble.insertBefore(editor,actions);
      bindMentionAutocomplete(textarea);
      textarea.focus();
      textarea.setSelectionRange?.(textarea.value.length,textarea.value.length);

      editor.querySelector("[data-cancel-edit]").onclick=()=>{
        editor.remove();
        text.classList.remove("hidden");
        actions.classList.remove("hidden");
      };
      editor.querySelector("[data-save-edit]").onclick=async()=>{
        const save=editor.querySelector("[data-save-edit]");
        const body=textarea.value.trim().slice(0,2000);
        if(!body)return editor.querySelector(".message").textContent="التعليق فارغ.";
        save.disabled=true;
        try{
          await api("/v1/social/comments/"+btn.dataset.editComment,{
            method:"PATCH",
            body:JSON.stringify({body})
          });
          await notifyMentions(body,"comment",btn.dataset.editComment);
          await loadComments();
        }catch(error){
          editor.querySelector(".message").textContent=error.message;
          save.disabled=false;
        }
      };
    });

    $("#commentsList").querySelectorAll("[data-delete-comment]").forEach(btn=>btn.onclick=async()=>{
      if(!confirm("حذف التعليق؟"))return;
      btn.disabled=true;
      try{
        await api("/v1/social/comments/"+btn.dataset.deleteComment,{method:"DELETE"});
        await loadComments();
      }catch(error){
        $("#commentMessage").textContent=error.message;
        btn.disabled=false;
      }
    });

    $("#commentsList").querySelectorAll("[data-report-comment]").forEach(btn=>btn.onclick=()=>{
      $("#commentsDialog").close();
      openReportDialog("comment",btn.dataset.reportComment);
    });

    $("#commentsList").scrollTop=0;
  }

  $("#commentForm").onsubmit=async(e)=>{
    e.preventDefault();
    if(!state.commentTarget)return;
    const targetTable=state.commentTarget.type==="post"?"posts":"reels";
    const {data:target}=await client.from(targetTable).select("comments_enabled").eq("id",state.commentTarget.id).maybeSingle();
    if(target?.comments_enabled===false){
      $("#commentMessage").textContent="التعليقات مغلقة لهذا المحتوى.";
      return;
    }
    const input=$("#commentInput");
    const submit=$("#commentForm button[type='submit']");
    const message=$("#commentMessage");
    const body=input.value.trim().slice(0,2000);
    if(!body){
      if(message)message.textContent="اكتب تعليقًا أولًا.";
      return;
    }

    submit.disabled=true;
    if(message)message.textContent="جارٍ الإرسال...";
    try{
      const payload={
        author_id:state.user.id,
        body,
        parent_id:state.commentReply?.id||null,
        post_id:state.commentTarget.type==="post"?state.commentTarget.id:null,
        reel_id:state.commentTarget.type==="reel"?state.commentTarget.id:null
      };
      const {data:created,error}=await client.from("comments").insert(payload).select("id").single();
      if(error)throw error;
      if(created?.id)await notifyMentions(body,"comment",created.id);
      input.value="";
      input.style.height="";
      state.commentReply=null;
      updateCommentReplyBar();
      if(message)message.textContent="";
      await loadComments();
    }catch(error){
      if(message)message.textContent=error.message||"تعذر إرسال التعليق.";
    }finally{
      submit.disabled=false;
    }
  };
  $("#closeComments").onclick=()=>{
    state.commentReply=null;
    updateCommentReplyBar();
    $("#commentsDialog").close();
    const returnProfile=state.returnPublicProfileId;
    state.returnPublicProfileId=null;
    if(returnProfile)setTimeout(()=>openPublicProfile(returnProfile).catch(()=>{}),0);
  };


  function followListActionLabel(item){
    if(item.id===state.user.id)return "";
    if(item.viewer_status==="accepted")return "إلغاء المتابعة";
    if(item.viewer_status==="pending")return "إلغاء الطلب";
    if(item.follows_viewer)return "رد المتابعة";
    return "متابعة";
  }

  async function openFollowList(profileId,mode,title){
    const isOwn=profileId===state.user.id;
    openInfoDialog(title,
      '<div class="follow-list-shell">'+
        '<div class="follow-list-head"><div><b>'+escapeHtml(title)+'</b><small>'+(mode==="followers"?"الأشخاص الذين يتابعون الحساب":"الحسابات التي تتم متابعتها")+'</small></div></div>'+
        '<div id="followListDialog" class="follow-list"><div class="empty">جارٍ التحميل...</div></div>'+
      '</div>');
    try{
      const result=await api("/v1/social/follows/"+encodeURIComponent(profileId)+"?mode="+encodeURIComponent(mode));
      const items=result.items||[];
      $("#followListDialog").innerHTML=items.map(p=>{
        const action=followListActionLabel(p);
        const actionClass=p.viewer_status?"active":"";
        return '<div class="follow-list-card">'+
          '<button class="follow-person" data-open-follow-profile="'+escapeHtml(p.id)+'" type="button">'+
            avatar(p,"follow-avatar")+
            '<span class="follow-person-copy"><b>'+escapeHtml(p.name||"مستخدم")+(p.is_verified?'<span class="verified-inline">✓</span>':"")+'</b>'+
            '<small>@'+escapeHtml(p.username||"")+(p.is_private?' · خاص':'')+'</small>'+
            (p.bio?'<em>'+escapeHtml(p.bio)+'</em>':"")+
            '</span>'+
          '</button>'+
          (action?'<button class="follow-list-action '+actionClass+'" data-follow-list-action="'+escapeHtml(p.id)+'" type="button">'+escapeHtml(action)+'</button>':"")+
        '</div>';
      }).join("")||'<div class="empty">لا توجد حسابات.</div>';

      await hydrateMedia($("#followListDialog"));

      $("#followListDialog").querySelectorAll("[data-open-follow-profile]").forEach(btn=>btn.onclick=()=>{
        const uid=btn.dataset.openFollowProfile;
        $("#infoDialog").close();
        openPublicProfile(uid);
      });

      $("#followListDialog").querySelectorAll("[data-follow-list-action]").forEach(btn=>btn.onclick=async()=>{
        const uid=btn.dataset.followListAction;
        btn.disabled=true;
        const original=btn.textContent;
        btn.textContent="...";
        try{
          await followUser(uid,btn);
          await openFollowList(profileId,mode,title);
        }catch(error){
          btn.disabled=false;
          btn.textContent=original;
        }
      });

      if(isOwn&&mode==="followers"&&items.some(item=>item.follows_viewer&&!item.viewer_status)){
        const head=$("#followListDialog")?.previousElementSibling;
        head?.insertAdjacentHTML("beforeend",'<span class="follow-back-hint">يمكنك رد المتابعة مباشرة من القائمة</span>');
      }
    }catch(error){
      $("#followListDialog").innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
    }
  }

  async function loadProfile(){
    try{
      await refreshProfile();
    const [{count:posts},{count:reels},{count:followers},{count:following}] = await Promise.all([
      client.from("posts").select("*",{count:"exact",head:true}).eq("author_id",state.user.id),
      client.from("reels").select("*",{count:"exact",head:true}).eq("author_id",state.user.id),
      client.from("follows").select("*",{count:"exact",head:true}).eq("following_id",state.user.id).eq("status","accepted"),
      client.from("follows").select("*",{count:"exact",head:true}).eq("follower_id",state.user.id).eq("status","accepted")
    ]);
    const totalContent=Number(posts||0)+Number(reels||0);
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
            <div><b>${totalContent}</b><span>منشور + ريلز</span></div>
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
      const ok=await confirmAction({
        title:next?"تحويل الحساب إلى خاص":"تحويل الحساب إلى عام",
        text:next
          ?"لن يرى منشوراتك وقصصك إلا المتابعون الذين وافقت عليهم، والطلبات الجديدة ستحتاج موافقتك."
          :"سيصبح محتواك العام قابلًا للاكتشاف والمشاهدة حسب إعدادات كل منشور أو ريلز.",
        acceptLabel:next?"جعله خاصًا":"جعله عامًا"
      });
      if(!ok)return;
      $("#profilePrivacyButton").disabled=true;
      const {error}=await client.from("profiles").update({
        is_private:next,
        updated_at:new Date().toISOString()
      }).eq("id",state.user.id);
      if(error){
        openInfoDialog("تعذر تغيير الخصوصية",'<div class="empty error">'+escapeHtml(profileUtil.errorMessage(error,error.message))+'</div>');
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
    const coverId=kind==="reels"?String(item.cover_media_id||""):"";
    const caption=String(item.caption||"");
    const ownerId=String(item.author_id||"");
    const pinned=Boolean(item.pinned_at);
    const visibility=String(item.visibility||"public");
    const viewCount=Number(item.view_count||0);
    let media="";
    if(kind==="reels"){
      if(coverId){
        media='<img class="profile-grid-media" data-media-id="'+escapeHtml(coverId)+'" alt="غلاف الريلز"><span class="profile-grid-play">'+icon("play")+'</span>';
      }else if(mediaId){
        media='<video class="profile-grid-media" muted playsinline preload="metadata" data-video-cover="1" data-media-id="'+escapeHtml(mediaId)+'"></video><span class="profile-grid-play">'+icon("play")+'</span>';
      }else{
        media='<div class="profile-grid-placeholder">'+icon("play")+'</div>';
      }
      media+='<span class="profile-grid-views">'+icon("eye")+'<b data-profile-reel-views="'+escapeHtml(item.id)+'">'+viewCount+'</b></span>';
    }else{
      media=mediaId
        ?'<img class="profile-grid-media" data-profile-cover="1" data-media-id="'+escapeHtml(mediaId)+'" alt="">'
        :'<div class="profile-grid-placeholder">'+icon("comment")+'</div>';
      if(pinned)media+='<span class="profile-grid-pinned">'+icon("pin")+'</span>';
    }
    return '<button class="profile-grid-tile" type="button"'+
      ' data-preview-kind="'+kind+'"'+
      ' data-preview-id="'+escapeHtml(item.id)+'"'+
      ' data-preview-media="'+escapeHtml(mediaId)+'"'+
      ' data-preview-caption="'+escapeHtml(caption)+'"'+
      ' data-preview-comments="'+String(item.comments_enabled!==false)+'"'+
      ' data-preview-owner="'+escapeHtml(ownerId)+'"'+
      ' data-preview-pinned="'+String(pinned)+'"'+
      ' data-preview-visibility="'+escapeHtml(visibility)+'"'+
      ' data-preview-views="'+String(viewCount)+'">'+
      media+
      (saved?'<span class="profile-grid-saved">'+icon("save")+'</span>':"")+
      '</button>';
  }

  async function openProfileContentPreview(kind,id,mediaId,caption="",commentsEnabled=true,ownerId="",pinned=false,viewCount=0,visibility="public"){
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
      (caption?'<p class="profile-preview-caption">'+richText(caption)+'</p>':"")+
      '<div class="profile-preview-actions">'+
      '<button id="previewLikeButton" class="'+(liked?"active":"")+'" type="button">'+icon("like")+'<span>'+likeCount+'</span></button>'+
      (commentsEnabled?'<button id="previewCommentButton" type="button">'+icon("comment")+'<span>'+commentCount+'</span></button>':"")+
      (reel?'<div class="profile-preview-stat">'+icon("eye")+'<span>'+Number(viewCount||0)+'</span></div>':"")+
      '<button id="previewShareButton" type="button">'+icon("share")+'<span>مشاركة</span></button>'+
      '<button id="previewSaveButton" class="'+(saved?"active":"")+'" type="button">'+icon("save")+'<span>'+(saved?"محفوظ":"حفظ")+'</span></button>'+
      (ownerId===state.user.id?'<button id="previewManageButton" type="button">'+icon("more")+'<span>إدارة</span></button>':"")+
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
    if($("#previewManageButton"))$("#previewManageButton").onclick=()=>{
      $("#infoDialog").close();
      openOwnContentActions(kind,id,caption,commentsEnabled,pinned,visibility);
    };
  }

  function bindProfileGrid(root){
    root.querySelectorAll("[data-preview-id]").forEach(btn=>{
      btn.onclick=()=>{
        if($("#publicProfileDialog")?.open && state.currentPublicProfile?.id){
          state.returnPublicProfileId=state.currentPublicProfile.id;
        }
        return openProfileContentPreview(
        btn.dataset.previewKind,
        btn.dataset.previewId,
        btn.dataset.previewMedia,
        btn.dataset.previewCaption,
        btn.dataset.previewComments==="true",
        btn.dataset.previewOwner||"",
        btn.dataset.previewPinned==="true",
        Number(btn.dataset.previewViews||0),
        btn.dataset.previewVisibility||"public"
      ).catch(error=>openInfoDialog("تعذر الفتح",'<div class="empty error">'+escapeHtml(error.message)+'</div>'));
      };
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
          .select("id,author_id,caption,media_id,cover_media_id,created_at,comments_enabled,visibility,view_count")
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
            ?client.from("posts").select("id,author_id,caption,comments_enabled,visibility,pinned_at,post_media(media_id,sort_order)").in("id",postIds)
            :Promise.resolve({data:[],error:null}),
          reelIds.length
            ?client.from("reels").select("id,author_id,caption,media_id,cover_media_id,comments_enabled,visibility,view_count").in("id",reelIds)
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
          .select("id,author_id,caption,comments_enabled,visibility,pinned_at,created_at,post_media(media_id,sort_order)")
          .eq("author_id",state.user.id)
          .order("created_at",{ascending:false});
        if(result.error)throw result.error;
        const orderedPosts=[...(result.data||[])].sort((a,b)=>
          Number(Boolean(b.pinned_at))-Number(Boolean(a.pinned_at)) ||
          new Date(b.pinned_at||b.created_at)-new Date(a.pinned_at||a.created_at)
        );
        $("#profileContent").innerHTML=orderedPosts.map(row=>profileGridTile(row,"posts")).join("")||
          '<div class="empty profile-grid-empty">لم تنشر شيئًا بعد.</div>';
      }
      await hydrateMedia($("#profileContent"));
      prepareVideoCovers($("#profileContent"));
      bindProfileGrid($("#profileContent"));
    }catch(error){
      $("#profileContent").innerHTML='<div class="empty error profile-grid-empty">'+escapeHtml(error.message)+'</div>';
    }
  }

  $$("#ownProfileTabs [data-profile-tab]").forEach(btn=>btn.onclick=()=>loadProfileContent(btn.dataset.profileTab));


  async function loadPublicProfileContent(uid,kind="posts",mayView=true){
    if(!["posts","reels","saved"].includes(kind))kind="posts";
    if(kind==="saved"&&state.currentPublicProfile?.saved_visibility!=="public")kind="posts";
    state.publicProfileTab=kind;
    $$("#publicProfileTabs [data-public-profile-tab]").forEach(btn=>{
      btn.classList.toggle("active",btn.dataset.publicProfileTab===kind);
    });
    $("#publicProfileContent").className="profile-media-grid";
    if(!mayView){
      $("#publicProfileContent").innerHTML='<div class="empty profile-grid-empty">هذا الحساب خاص. تابع الحساب وانتظر الموافقة لعرض المحتوى.</div>';
      return;
    }
    $("#publicProfileContent").innerHTML='<div class="profile-grid-loading">جارٍ التحميل...</div>';
    try{
      if(kind==="reels"){
        const result=await client.from("reels")
          .select("id,author_id,caption,media_id,cover_media_id,comments_enabled,visibility,created_at,view_count")
          .eq("author_id",uid)
          .order("created_at",{ascending:false})
          .limit(90);
        if(result.error)throw result.error;
        $("#publicProfileContent").innerHTML=(result.data||[]).map(row=>profileGridTile(row,"reels")).join("")||
          '<div class="empty profile-grid-empty">لا توجد ريلز بعد.</div>';
      }else if(kind==="saved"){
        const [postSaved,reelSaved]=await Promise.all([
          api("/v1/social/saved/"+encodeURIComponent(uid)+"?kind=posts"),
          api("/v1/social/saved/"+encodeURIComponent(uid)+"?kind=reels")
        ]);
        const postIds=(postSaved.items||[]).map(x=>x.post_id).filter(Boolean);
        const reelIds=(reelSaved.items||[]).map(x=>x.reel_id).filter(Boolean);
        const [postsResult,reelsResult]=await Promise.all([
          postIds.length?client.from("posts").select("id,author_id,caption,comments_enabled,visibility,pinned_at,post_media(media_id,sort_order)").in("id",postIds):Promise.resolve({data:[],error:null}),
          reelIds.length?client.from("reels").select("id,author_id,caption,media_id,cover_media_id,comments_enabled,visibility,view_count").in("id",reelIds):Promise.resolve({data:[],error:null})
        ]);
        if(postsResult.error)throw postsResult.error;
        if(reelsResult.error)throw reelsResult.error;
        const postMap=new Map((postsResult.data||[]).map(x=>[x.id,x]));
        const reelMap=new Map((reelsResult.data||[]).map(x=>[x.id,x]));
        const ordered=[
          ...(postSaved.items||[]).map(x=>({at:x.created_at,kind:"posts",item:postMap.get(x.post_id)})),
          ...(reelSaved.items||[]).map(x=>({at:x.created_at,kind:"reels",item:reelMap.get(x.reel_id)}))
        ].filter(x=>x.item).sort((a,b)=>new Date(b.at)-new Date(a.at));
        $("#publicProfileContent").innerHTML=ordered.map(x=>profileGridTile(x.item,x.kind,true)).join("")||
          '<div class="empty profile-grid-empty">لا توجد محفوظات عامة.</div>';
      }else{
        const result=await client.from("posts")
          .select("id,author_id,caption,comments_enabled,created_at,pinned_at,post_media(media_id,sort_order)")
          .eq("author_id",uid)
          .order("created_at",{ascending:false})
          .limit(90);
        if(result.error)throw result.error;
        const orderedPosts=[...(result.data||[])].sort((a,b)=>
          Number(Boolean(b.pinned_at))-Number(Boolean(a.pinned_at)) ||
          new Date(b.pinned_at||b.created_at)-new Date(a.pinned_at||a.created_at)
        );
        $("#publicProfileContent").innerHTML=orderedPosts.map(row=>profileGridTile(row,"posts")).join("")||
          '<div class="empty profile-grid-empty">لا توجد منشورات بعد.</div>';
      }
      await hydrateMedia($("#publicProfileContent"));
      prepareVideoCovers($("#publicProfileContent"));
      bindProfileGrid($("#publicProfileContent"));
    }catch(error){
      $("#publicProfileContent").innerHTML='<div class="empty error profile-grid-empty">'+escapeHtml(error.message)+'</div>';
    }
  }

  async function openPublicProfile(uid){
    if(uid===state.user.id){
      $("#publicProfileDialog").close();
      navigateTo("profilePage");
      return;
    }
    $("#publicProfileContent").innerHTML='<div class="empty">جارٍ التحميل...</div>';
    const {data:p,error}=await client.from("profiles")
      .select("id,name,username,bio,avatar_media_id,cover_media_id,profile_link,is_verified,is_private,saved_visibility")
      .eq("id",uid).single();
    if(error||!p){
      openInfoDialog("الحساب غير متاح",'<div class="empty">تعذر فتح هذا الحساب. قد يكون محظورًا أو غير متاح.</div>');
      return;
    }
    state.currentPublicProfile=p;
    const [{count:posts},{count:reels},{count:followers},{count:following},{data:followRow}] = await Promise.all([
      client.from("posts").select("*",{count:"exact",head:true}).eq("author_id",uid),
      client.from("reels").select("*",{count:"exact",head:true}).eq("author_id",uid),
      client.from("follows").select("*",{count:"exact",head:true}).eq("following_id",uid).eq("status","accepted"),
      client.from("follows").select("*",{count:"exact",head:true}).eq("follower_id",uid).eq("status","accepted"),
      client.from("follows").select("status").eq("follower_id",state.user.id).eq("following_id",uid).maybeSingle()
    ]);
    const totalContent=Number(posts||0)+Number(reels||0);
    const link=safeLink(p.profile_link||"");
    const followText=followRow?.status==="accepted"?"تتابعه":followRow?.status==="pending"?"تم إرسال الطلب":"متابعة";
    $("#publicProfileCard").innerHTML=
      '<div class="profile-cover">'+(p.cover_media_id?'<img class="cover-image" data-media-id="'+escapeHtml(p.cover_media_id)+'" alt="">':"")+'</div>'+
      '<div class="profile-main"><div class="profile-avatar-wrap">'+avatar(p)+'</div><div class="profile-info">'+
      '<div class="profile-name-row"><h2>'+escapeHtml(p.name||"مستخدم")+'</h2>'+(p.is_verified?'<span class="verified-badge">✓</span>':"")+'</div>'+
      '<div class="profile-username">@'+escapeHtml(p.username||"")+'</div>'+
      (p.bio?'<p class="profile-bio">'+escapeHtml(p.bio)+'</p>':"")+
      (link?'<a class="profile-link" href="'+escapeHtml(link)+'" target="_blank" rel="noopener">'+icon("link")+'<span>'+escapeHtml(p.profile_link)+'</span></a>':"")+
      '<div class="profile-stats"><div><b>'+totalContent+'</b><span>منشور + ريلز</span></div>'+
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
    state.currentPublicProfile={...p,mayView};
    const savedPublic=p.saved_visibility==="public";
    $("#publicSavedTab").classList.toggle("hidden",!savedPublic);
    $("#publicProfileTabs").classList.toggle("show-saved",savedPublic);
    state.publicProfileTab="posts";
    await loadPublicProfileContent(uid,"posts",mayView);
    $$("#publicProfileTabs [data-public-profile-tab]").forEach(btn=>{
      btn.onclick=()=>loadPublicProfileContent(uid,btn.dataset.publicProfileTab,mayView);
    });
  }
  $("#closePublicProfile").onclick=()=>{
    state.currentPublicProfile=null;
    state.returnPublicProfileId=null;
    $("#publicProfileDialog").close();
  };

  async function loadNotificationsBadge(){
    if(!state.user)return;
    const {count}=await client.from("notifications").select("*",{count:"exact",head:true}).eq("user_id",state.user.id).is("read_at",null);
    const badge=$("#notificationBadge");
    badge.textContent=count||0;
    badge.classList.toggle("hidden",!count);
  }

  let mentionLookupTimer=null;
  let mentionActiveInput=null;

  function closeMentionSuggestions(){
    const panel=$("#mentionSuggestions");
    if(!panel)return;
    panel.classList.add("hidden");
    panel.innerHTML="";
    mentionActiveInput=null;
  }

  function currentMentionToken(input){
    const value=input?.value||"";
    const caret=input?.selectionStart??value.length;
    const before=value.slice(0,caret);
    const match=before.match(/(^|\s)@([A-Za-z0-9_.]{0,10})$/);
    if(!match)return null;
    const query=match[2]||"";
    const start=caret-query.length-1;
    return {query,start,end:caret};
  }

  function placeMentionPanel(input){
    const panel=$("#mentionSuggestions");
    if(!panel||!input)return;
    const rect=input.getBoundingClientRect();
    const width=Math.min(340,Math.max(220,rect.width));
    panel.style.width=width+"px";
    panel.style.left=Math.max(12,Math.min(window.innerWidth-width-12,rect.left))+"px";
    const preferred=rect.top-270;
    panel.style.top=(preferred>12?preferred:Math.min(window.innerHeight-280,rect.bottom+8))+"px";
  }

  async function updateMentionSuggestions(input){
    const token=currentMentionToken(input);
    if(!token)return closeMentionSuggestions();
    mentionActiveInput=input;
    clearTimeout(mentionLookupTimer);
    mentionLookupTimer=setTimeout(async()=>{
      const panel=$("#mentionSuggestions");
      if(!panel||mentionActiveInput!==input)return;
      let request=client.from("profiles").select("id,name,username,avatar_media_id,is_verified").neq("id",state.user.id).eq("is_banned",false).order("username").limit(8);
      if(token.query)request=request.ilike("username",token.query+"%");
      const {data,error}=await request;
      if(error||mentionActiveInput!==input)return closeMentionSuggestions();
      const rows=data||[];
      panel.innerHTML=rows.map(p=>`<button type="button" class="mention-suggestion" data-mention-username="${escapeHtml(p.username||"")}">${avatar(p)}<span><b>${escapeHtml(p.name||p.username||"مستخدم")}${p.is_verified?'<span class="verified-inline">✓</span>':""}</b><small>@${escapeHtml(p.username||"")}</small></span></button>`).join("");
      if(!rows.length)return closeMentionSuggestions();
      placeMentionPanel(input);
      panel.classList.remove("hidden");
      await hydrateMedia(panel).catch(()=>{});
      panel.querySelectorAll("[data-mention-username]").forEach(btn=>btn.onclick=()=>{
        const latest=currentMentionToken(input);
        if(!latest)return closeMentionSuggestions();
        const username=btn.dataset.mentionUsername;
        input.value=input.value.slice(0,latest.start)+"@"+username+" "+input.value.slice(latest.end);
        const caret=latest.start+username.length+2;
        input.focus();
        input.setSelectionRange?.(caret,caret);
        input.dispatchEvent(new Event("input",{bubbles:true}));
        closeMentionSuggestions();
      });
    },120);
  }

  function bindMentionAutocomplete(input){
    if(!input||input.dataset.mentionBound==="1")return;
    input.dataset.mentionBound="1";
    input.addEventListener("input",()=>updateMentionSuggestions(input));
    input.addEventListener("focus",()=>updateMentionSuggestions(input));
    input.addEventListener("blur",()=>setTimeout(()=>{if(mentionActiveInput===input)closeMentionSuggestions()},180));
  }

  [$("#composerCaption"),$("#storyOverlayInput"),$("#commentInput")].forEach(bindMentionAutocomplete);
  $("#commentInput")?.addEventListener("input",e=>{
    const el=e.currentTarget;
    el.style.height="auto";
    el.style.height=Math.min(132,Math.max(44,el.scrollHeight))+"px";
  });
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
    if(type==="story"&&id){
      await navigateTo("homePage");
      await loadStories();
      if(state.stories?.has(id))return openStoryViewer(id);
      return;
    }
    if(type==="comment"&&id){
      const {data}=await client.from("comments").select("post_id,reel_id").eq("id",id).maybeSingle();
      if(data?.post_id)return openComments("post",data.post_id);
      if(data?.reel_id)return openComments("reel",data.reel_id);
      return;
    }
    if((type==="conversation"||type==="message")&&id){
      await navigateTo("messagesPage");
      return openChat(id,"المحادثة");
    }
    if(type==="support_ticket"||type==="support"){
      return openSupportCenter(id||"");
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

  async function openQuickPublish(type="post"){
    await openComposer(type);
    await openCameraStudio();
  }

  $("#publishButton").onclick=async()=>{
    await updateDraftEntryBadge().catch(()=>{});
    if(window.AshurPublishPage?.openChooser)window.AshurPublishPage.openChooser();
    else openDialog($("#publishDialog"));
  };
  $("#closePublish").onclick=()=>$("#publishDialog").close();
  $("#publishDialog").querySelectorAll("[data-publish]").forEach(b=>b.onclick=()=>openComposer(b.dataset.publish));


  const COMPOSER_DRAFT_DB="ashur_composer_drafts_v1";
  const COMPOSER_DRAFT_STORE="drafts";

  function composerDraftKey(type=state.composerType){
    return state.user?.id ? state.user.id+":"+type : "";
  }

  function openComposerDraftDb(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(COMPOSER_DRAFT_DB,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(COMPOSER_DRAFT_STORE)){
          db.createObjectStore(COMPOSER_DRAFT_STORE,{keyPath:"key"});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error("تعذر فتح المسودات"));
    });
  }

  function composerHasDraftContent(){
    return Boolean(
      (state.composerFiles||[]).length ||
      $("#composerCaption")?.value.trim() ||
      $("#storyOverlayInput")?.value.trim()
    );
  }

  function composerDraftSnapshot(){
    const key=composerDraftKey();
    if(!key)return null;
    return {
      key,
      type:state.composerType,
      files:[...(state.composerFiles||[])],
      caption:$("#composerCaption")?.value||"",
      visibility:$("#composerVisibility")?.value||"public",
      comments_enabled:Boolean($("#composerCommentsEnabled")?.checked),
      explore_enabled:Boolean($("#composerExploreEnabled")?.checked),
      overlay_text:$("#storyOverlayInput")?.value||"",
      overlay_color:$("#storyOverlayColor")?.value||"#ffffff",
      overlay_y:$("#storyOverlayY")?.value||"50",
      overlay_bg:Boolean($("#storyOverlayBg")?.checked),
      saved_at:Date.now()
    };
  }

  async function deleteComposerDraft(type=state.composerType){
    const key=composerDraftKey(type);
    if(!key)return;
    const db=await openComposerDraftDb().catch(()=>null);
    if(!db)return;
    await new Promise(resolve=>{
      const tx=db.transaction(COMPOSER_DRAFT_STORE,"readwrite");
      tx.objectStore(COMPOSER_DRAFT_STORE).delete(key);
      tx.oncomplete=resolve;
      tx.onerror=resolve;
    });
    db.close();
    updateDraftEntryBadge().catch(()=>{});
  }

  async function saveComposerDraft({silent=true}={}){
    if(state.composerDraftRestoring||!state.user)return;
    const snapshot=composerDraftSnapshot();
    if(!snapshot)return;
    if(!composerHasDraftContent()){
      await deleteComposerDraft(state.composerType).catch(()=>{});
      updateDraftEntryBadge().catch(()=>{});
      return;
    }
    const db=await openComposerDraftDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(COMPOSER_DRAFT_STORE,"readwrite");
      tx.objectStore(COMPOSER_DRAFT_STORE).put(snapshot);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error("تعذر حفظ المسودة"));
    });
    db.close();
    updateDraftEntryBadge().catch(()=>{});
    if(!silent&&$("#composerMessage"))$("#composerMessage").textContent="تم حفظ المسودة على هذا الجهاز.";
  }

  async function readComposerDraft(type){
    const key=composerDraftKey(type);
    if(!key)return null;
    const db=await openComposerDraftDb().catch(()=>null);
    if(!db)return null;
    const value=await new Promise(resolve=>{
      const tx=db.transaction(COMPOSER_DRAFT_STORE,"readonly");
      const request=tx.objectStore(COMPOSER_DRAFT_STORE).get(key);
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>resolve(null);
    });
    db.close();
    return value;
  }

  async function listComposerDrafts(){
    if(!state.user?.id)return [];
    const db=await openComposerDraftDb().catch(()=>null);
    if(!db)return [];
    const prefix=state.user.id+":";
    const rows=await new Promise(resolve=>{
      const tx=db.transaction(COMPOSER_DRAFT_STORE,"readonly");
      const request=tx.objectStore(COMPOSER_DRAFT_STORE).getAll();
      request.onsuccess=()=>resolve((request.result||[]).filter(row=>String(row?.key||"").startsWith(prefix)));
      request.onerror=()=>resolve([]);
    });
    db.close();
    return rows.sort((a,b)=>Number(b.saved_at||0)-Number(a.saved_at||0));
  }

  function composerDraftTypeLabel(type){
    return type==="story"?"قصة":type==="reel"?"ريلز":"منشور";
  }

  function composerDraftIcon(type){
    if(type==="story")return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>';
    if(type==="reel")return '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 9 6 3-6 3Z"/></svg>';
    return '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m7 16 4-4 3 3 3-4 3 5"/></svg>';
  }

  function formatDraftTime(value){
    const ts=Number(value||0);
    if(!ts)return "بدون وقت";
    try{return new Date(ts).toLocaleString("ar-IQ",{dateStyle:"medium",timeStyle:"short"})}catch{return new Date(ts).toLocaleString("ar-IQ")}
  }

  async function updateDraftEntryBadge(){
    const rows=await listComposerDrafts();
    const badge=$("#draftsEntryBadge");
    const hint=$("#draftsEntryHint");
    if(badge){
      badge.textContent=String(rows.length);
      badge.classList.toggle("hidden",!rows.length);
    }
    if(hint)hint.textContent=rows.length?("لديك "+rows.length+" مسودة محفوظة"):"لا توجد مسودات محفوظة";
    return rows;
  }

  async function renderDraftsDialog(){
    const list=$("#draftsList");
    if(!list)return;
    list.innerHTML='<div class="empty">جارٍ تحميل المسودات...</div>';
    const rows=await updateDraftEntryBadge();
    if(!rows.length){
      list.innerHTML='<div class="empty"><b>لا توجد مسودات</b><div>ابدأ منشورًا أو قصة أو ريلز، وسيُحفظ تلقائيًا عند الخروج.</div></div>';
      return;
    }
    list.innerHTML=rows.map(row=>{
      const type=row.type==="story"||row.type==="reel"?row.type:"post";
      const caption=String(row.caption||row.overlay_text||"").trim();
      const mediaCount=Array.isArray(row.files)?row.files.length:0;
      const summary=caption||((mediaCount?mediaCount+" ملف وسائط":"مسودة محفوظة"));
      return '<article class="draft-card" data-draft-card="'+escapeHtml(type)+'">'+
        '<span class="draft-card-icon">'+composerDraftIcon(type)+'</span>'+
        '<div class="draft-card-copy"><b>'+composerDraftTypeLabel(type)+'</b><p>'+escapeHtml(summary)+'</p><small>'+escapeHtml(formatDraftTime(row.saved_at))+'</small></div>'+
        '<div class="draft-card-actions">'+
          '<button class="draft-open" type="button" data-open-draft="'+escapeHtml(type)+'">فتح</button>'+
          '<button class="draft-delete" type="button" data-delete-draft="'+escapeHtml(type)+'">حذف</button>'+
        '</div>'+
      '</article>';
    }).join("");

    list.querySelectorAll("[data-open-draft]").forEach(button=>button.onclick=async()=>{
      const type=button.dataset.openDraft||"post";
      $("#draftsDialog").close();
      await openComposer(type);
    });

    list.querySelectorAll("[data-delete-draft]").forEach(button=>button.onclick=async()=>{
      const type=button.dataset.deleteDraft||"post";
      const ok=await confirmAction({
        title:"حذف المسودة؟",
        text:"سيتم حذف هذه المسودة من هذا الجهاز.",
        acceptLabel:"حذف",
        danger:true
      });
      if(!ok)return;
      await deleteComposerDraft(type).catch(()=>{});
      await renderDraftsDialog();
    });
  }

  $("#openDraftsButton")?.addEventListener("click",async()=>{
    $("#publishDialog").close();
    openDialog($("#draftsDialog"));
    await renderDraftsDialog();
  });
  $("#closeDrafts")?.addEventListener("click",()=>$("#draftsDialog").close());

  function scheduleComposerDraftSave(){
    if(state.composerDraftRestoring||!$("#composerDialog")?.open)return;
    clearTimeout(state.composerDraftTimer);
    state.composerDraftTimer=setTimeout(()=>saveComposerDraft({silent:true}).catch(()=>{}),450);
  }

  async function restoreComposerDraft(type){
    const draft=await readComposerDraft(type);
    if(!draft)return false;
    state.composerDraftRestoring=true;
    try{
      state.composerFiles=Array.isArray(draft.files)?draft.files.filter(Boolean):[];
      $("#composerCaption").value=draft.caption||"";
      const privateAccount=Boolean(state.profile?.is_private);
      $("#composerVisibility").value=privateAccount?"followers":(draft.visibility==="followers"?"followers":"public");
      $("#composerCommentsEnabled").checked=draft.comments_enabled!==false;
      $("#composerExploreEnabled").checked=draft.explore_enabled!==false;
      $("#storyOverlayInput").value=draft.overlay_text||"";
      $("#storyOverlayColor").value=draft.overlay_color||"#ffffff";
      $("#storyOverlayY").value=String(draft.overlay_y||"50");
      $("#storyOverlayBg").checked=draft.overlay_bg!==false;
      renderComposerPreview();
      updateStoryOverlayPreview();
      if($("#composerMessage"))$("#composerMessage").textContent="تم استعادة آخر مسودة محفوظة.";
      return true;
    }finally{
      state.composerDraftRestoring=false;
    }
  }

  function clearComposerPreview(){
    for(const url of state.previewUrls||[]){
      try{URL.revokeObjectURL(url)}catch(_){}
    }
    if(state.reelCoverUrl){
      try{URL.revokeObjectURL(state.reelCoverUrl)}catch(_){}
    }
    state.previewUrl=null;
    state.previewUrls=[];
    state.reelCoverUrl=null;
    state.reelCoverFile=null;
    state.composerFiles=[];
    state.mediaEdit={rotation:0,scale:1,filter:"none"};
    $("#composerDialog").classList.remove("has-media");
    $("#mediaEditToolbar").classList.add("hidden");
    $("#composerPreview").innerHTML="";
    $("#composerPreview").classList.remove("composer-preview-grid");
    $("#composerStage").classList.add("hidden");
    $("#composerFileMeta").textContent="";
    $("#composerFileMeta").classList.add("hidden");
    $("#storyTextOverlay").innerHTML="";
    $("#storyTextOverlay").classList.add("hidden");
    $("#storyEditorControls")?.classList.add("hidden");
    $("#storyEditorDock")?.querySelectorAll("[data-story-tool]").forEach(button=>button.classList.remove("active"));
    $("#composerCameraFile").value="";
    $("#composerFile").value="";
    const upload=$("#uploadProgress");
    if(upload){
      upload.classList.add("hidden");
      const bar=upload.querySelector(".progress>div");
      if(bar)bar.style.width="0%";
    }
    if($("#uploadProgressText"))$("#uploadProgressText").textContent="0%";
  }

  function updateStoryOverlayPreview(){
    const overlay=$("#storyTextOverlay");
    if(!overlay)return;
    const text=$("#storyOverlayInput").value.trim();
    overlay.classList.toggle("hidden",!text||state.composerType!=="story");
    overlay.classList.toggle("with-bg",$("#storyOverlayBg").checked);
    overlay.style.color=$("#storyOverlayColor").value||"#ffffff";
    overlay.style.top=String(Number($("#storyOverlayY").value||50))+"%";
    overlay.innerHTML=text?'<span>'+escapeHtml(text)+'</span>':"";
  }

  $("#storyOverlayInput").oninput=updateStoryOverlayPreview;
  $("#storyOverlayColor").oninput=updateStoryOverlayPreview;
  $("#storyOverlayY").oninput=updateStoryOverlayPreview;
  $("#storyOverlayBg").onchange=updateStoryOverlayPreview;

  function setStoryToolPanel(tool){
    const panel=$("#storyEditorControls");
    if(!panel)return;
    const title=$("#storyToolPanelTitle");
    const label=tool==="style"?"اللون والخلفية":tool==="position"?"موضع النص":"النص";
    if(title)title.textContent=label;
    panel.classList.remove("hidden");
    $$("#storyEditorDock [data-story-tool]").forEach(button=>button.classList.toggle("active",button.dataset.storyTool===tool));
    if(tool==="text")setTimeout(()=>$("#storyOverlayInput")?.focus(),60);
    if(tool==="style")setTimeout(()=>$("#storyOverlayColor")?.focus(),60);
    if(tool==="position")setTimeout(()=>$("#storyOverlayY")?.focus(),60);
  }

  function updateStoryEffectLabel(){
    const label=$("#storyEffectLabel");
    if(!label)return;
    const filter=state.mediaEdit?.filter||"none";
    label.textContent="التأثير الحالي: "+(filter==="vivid"?"حيوي":filter==="warm"?"دافئ":filter==="mono"?"أبيض وأسود":"بدون فلتر");
  }

  $("#closeStoryToolPanel")?.addEventListener("click",()=>{
    $("#storyEditorControls")?.classList.add("hidden");
    $$("#storyEditorDock [data-story-tool]").forEach(button=>button.classList.remove("active"));
  });

  $$("#storyEditorDock [data-story-tool]").forEach(button=>button.onclick=()=>{
    const tool=button.dataset.storyTool;
    if(tool==="text"||tool==="style"||tool==="position"){
      setStoryToolPanel(tool);
      return;
    }
    if(tool==="mention"){
      setStoryToolPanel("text");
      const input=$("#storyOverlayInput");
      if(input){
        const base=input.value||"";
        input.value=base+(base&&!/\s$/.test(base)?" ":"")+"@";
        updateStoryOverlayPreview();
        input.focus();
        try{input.setSelectionRange(input.value.length,input.value.length)}catch(_){}
      }
      scheduleComposerDraftSave();
      return;
    }
    if(tool==="effect"){
      const file=(state.composerFiles||[])[0];
      if(!file?.type?.startsWith("image/")){
        $("#composerMessage").textContent="تأثيرات هذه النسخة متاحة للصور داخل القصة.";
        return;
      }
      const filters=["none","vivid","warm","mono"];
      const edit=state.mediaEdit||(state.mediaEdit={rotation:0,scale:1,filter:"none"});
      const index=filters.indexOf(edit.filter||"none");
      edit.filter=filters[(index+1)%filters.length];
      if($("#mediaEditFilter"))$("#mediaEditFilter").value=edit.filter;
      applyMediaEditPreview();
      updateStoryEffectLabel();
      button.classList.toggle("active",edit.filter!=="none");
      scheduleComposerDraftSave();
      return;
    }
    if(tool==="reset"){
      $("#storyOverlayInput").value="";
      $("#storyOverlayColor").value="#ffffff";
      $("#storyOverlayY").value="50";
      $("#storyOverlayBg").checked=true;
      updateStoryOverlayPreview();
      resetMediaEdit();
      updateStoryEffectLabel();
      $("#storyEditorControls")?.classList.add("hidden");
      $$("#storyEditorDock [data-story-tool]").forEach(item=>item.classList.remove("active"));
      scheduleComposerDraftSave();
    }
  });

  function mediaFilterCss(filter){
    return filter==="vivid"?"saturate(1.35) contrast(1.08)":filter==="warm"?"sepia(.16) saturate(1.22) brightness(1.04)":filter==="mono"?"grayscale(1) contrast(1.08)":"none";
  }

  function applyMediaEditPreview(){
    const el=$("#composerPreview")?.querySelector(".editable-media");
    if(!el)return;
    const edit=state.mediaEdit||{rotation:0,scale:1,filter:"none"};
    el.style.transform=`rotate(${Number(edit.rotation||0)}deg) scale(${Number(edit.scale||1)})`;
    el.style.filter=mediaFilterCss(edit.filter);
  }

  function resetMediaEdit(){
    state.mediaEdit={rotation:0,scale:1,filter:"none"};
    if($("#mediaEditFilter"))$("#mediaEditFilter").value="none";
    applyMediaEditPreview();
  }

  $("#mediaEditToolbar")?.querySelectorAll("[data-media-edit]").forEach(btn=>btn.onclick=()=>{
    const action=btn.dataset.mediaEdit;
    const edit=state.mediaEdit||(state.mediaEdit={rotation:0,scale:1,filter:"none"});
    if(action==="rotate-left")edit.rotation=(Number(edit.rotation||0)-90)%360;
    if(action==="rotate-right")edit.rotation=(Number(edit.rotation||0)+90)%360;
    if(action==="zoom-out")edit.scale=Math.max(1,Number(edit.scale||1)-.1);
    if(action==="zoom-in")edit.scale=Math.min(2,Number(edit.scale||1)+.1);
    if(action==="reset")resetMediaEdit();
    applyMediaEditPreview();
  });
  $("#mediaEditFilter")?.addEventListener("change",e=>{
    const edit=state.mediaEdit||(state.mediaEdit={rotation:0,scale:1,filter:"none"});
    edit.filter=e.currentTarget.value||"none";
    applyMediaEditPreview();
    updateStoryEffectLabel();
  });

  async function editedImageFile(file){
    const edit=state.mediaEdit||{rotation:0,scale:1,filter:"none"};
    if(!file?.type?.startsWith("image/"))return file;
    if((Number(edit.rotation||0)%360)===0&&Number(edit.scale||1)===1&&(edit.filter||"none")==="none")return file;
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();
      img.decoding="async";
      img.src=url;
      await img.decode();
      const rotation=((Number(edit.rotation||0)%360)+360)%360;
      const swap=rotation===90||rotation===270;
      const outW=swap?img.naturalHeight:img.naturalWidth;
      const outH=swap?img.naturalWidth:img.naturalHeight;
      const canvas=document.createElement("canvas");
      canvas.width=Math.min(2400,outW);
      canvas.height=Math.max(1,Math.round(canvas.width*(outH/outW)));
      const ctx=canvas.getContext("2d");
      ctx.save();
      ctx.translate(canvas.width/2,canvas.height/2);
      ctx.rotate(rotation*Math.PI/180);
      const scale=Number(edit.scale||1);
      ctx.scale(scale,scale);
      ctx.filter=mediaFilterCss(edit.filter);
      const dw=swap?canvas.height:canvas.width;
      const dh=swap?canvas.width:canvas.height;
      ctx.drawImage(img,-dw/2,-dh/2,dw,dh);
      ctx.restore();
      const type=file.type==="image/png"?"image/png":"image/jpeg";
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,type==="image/png"?undefined:.9));
      if(!blob)return file;
      const ext=type==="image/png"?"png":"jpg";
      return new File([blob],"ashur-edited-"+Date.now()+"."+ext,{type,lastModified:Date.now()});
    }catch{return file}
    finally{URL.revokeObjectURL(url)}
  }
  function renderComposerPreview(){
    for(const url of state.previewUrls||[]){
      try{URL.revokeObjectURL(url)}catch(_){}
    }
    state.previewUrls=[];
    const files=state.composerFiles||[];
    const meta=$("#composerFileMeta");
    if(meta){
      meta.textContent="";
      meta.classList.add("hidden");
    }
    if(!files.length){
      $("#composerStage").classList.add("hidden");
      return;
    }

    const html=files.map((file,index)=>{
      const url=URL.createObjectURL(file);
      state.previewUrls.push(url);
      if(file.type.startsWith("video/")){
        return '<div class="composer-media-frame composer-video-frame" data-composer-index="'+index+'">'+
          '<video class="composer-video-preview" src="'+url+'" playsinline preload="metadata"></video>'+
        '</div>';
      }
      return '<div class="composer-media-frame composer-image-frame" data-composer-index="'+index+'">'+
        '<img class="'+(files.length===1?"editable-media ":"")+'composer-image-preview" src="'+url+'" alt="معاينة المحتوى">'+
      '</div>';
    }).join("");

    state.previewUrl=state.previewUrls[0]||null;
    const preview=$("#composerPreview");
    preview.innerHTML=html;
    preview.classList.toggle("composer-preview-grid",files.length>1);
    $("#composerStage").classList.remove("hidden");
    $("#composerDialog").classList.add("has-media");

    preview.querySelectorAll("video").forEach(video=>{
      enhanceVideoPlayer(video);
      const index=Number(video.closest("[data-composer-index]")?.dataset.composerIndex||0);
      const file=files[index];
      if(file?.type?.startsWith("video/")){
        generateVideoCover(file).then(cover=>{
          if(!cover||!video.isConnected)return;
          const posterUrl=URL.createObjectURL(cover);
          state.previewUrls.push(posterUrl);
          video.poster=posterUrl;
        }).catch(()=>{});
      }
    });

    const editable=files.length===1&&files[0].type.startsWith("image/");
    $("#mediaEditToolbar").classList.toggle("hidden",!editable);
    if(editable){
      if(!state.mediaEdit)state.mediaEdit={rotation:0,scale:1,filter:"none"};
      $("#mediaEditFilter").value=state.mediaEdit.filter||"none";
      requestAnimationFrame(applyMediaEditPreview);
    }
    updateStoryOverlayPreview();
  }

  function acceptComposerFiles(files,source="library"){
    const list=[...files].filter(Boolean);
    if(!list.length)return;
    if(state.composerType!=="post"&&list.length>1){
      $("#composerMessage").textContent="هذا النوع يقبل ملفًا واحدًا فقط.";
      return;
    }
    if(state.composerType==="post"&&list.length>10){
      $("#composerMessage").textContent="يمكن إضافة 10 ملفات كحد أقصى للمنشور.";
      return;
    }
    for(const file of list){
      if(state.composerType==="reel"&&!file.type.startsWith("video/")){
        $("#composerMessage").textContent="الريلز يقبل فيديو فقط.";
        return;
      }
      if(!file.type.startsWith("image/")&&!file.type.startsWith("video/")){
        $("#composerMessage").textContent="نوع الملف غير مدعوم.";
        return;
      }
    }
    state.composerFiles=list;
    state.mediaEdit={rotation:0,scale:1,filter:"none"};
    $("#composerMessage").textContent=source==="camera"
      ?"المحتوى جاهز. راجعه ثم أضف الوصف واضغط نشر."
      :(list.length>1?list.length+" وسائط جاهزة للنشر.":"المحتوى جاهز للنشر.");
    renderComposerPreview();
  }

  function stopCameraTracks(){
    if(state.cameraStream){
      state.cameraStream.getTracks().forEach(track=>track.stop());
      state.cameraStream=null;
    }
    const preview=$("#cameraPreview");
    if(preview)preview.srcObject=null;
  }

  function clearCameraRecordingTimer(){
    clearInterval(state.cameraRecordingTimer);
    state.cameraRecordingTimer=null;
    state.cameraRecordingStarted=0;
    $("#cameraRecordingBadge")?.classList.add("hidden");
    if($("#cameraRecordTime"))$("#cameraRecordTime").textContent="0:00";
    $("#cameraCapture")?.classList.remove("recording");
  }

  async function ensureCameraPermission(){
    try{
      if(window.AshurNative?.hasCameraPermission?.())return true;
      window.AshurNative?.requestCameraPermission?.();
      for(let i=0;i<24;i++){
        await new Promise(resolve=>setTimeout(resolve,125));
        if(window.AshurNative?.hasCameraPermission?.())return true;
      }
      return !window.AshurNative?.hasCameraPermission;
    }catch{return true}
  }

  function cameraVideoConstraints(){
    return {
      facingMode:{ideal:state.cameraFacing||"environment"},
      width:{ideal:1080},
      height:{ideal:1920},
      aspectRatio:{ideal:9/16}
    };
  }

  async function startCameraStream(){
    const errorBox=$("#cameraError");
    errorBox.classList.add("hidden");
    errorBox.textContent="";
    stopCameraTracks();

    if(!navigator.mediaDevices?.getUserMedia){
      throw new Error("الكاميرا الداخلية غير مدعومة على هذا الجهاز.");
    }

    const permitted=await ensureCameraPermission();
    if(!permitted)throw new Error("يلزم السماح لآشور باستخدام الكاميرا.");

    let stream=null;
    const attempts=[
      {video:cameraVideoConstraints(),audio:state.cameraMode==="video"},
      {video:{facingMode:state.cameraFacing||"environment"},audio:state.cameraMode==="video"},
      {video:true,audio:state.cameraMode==="video"}
    ];
    let lastError=null;
    for(const constraints of attempts){
      try{
        stream=await navigator.mediaDevices.getUserMedia(constraints);
        if(stream?.getVideoTracks?.().length)break;
      }catch(error){
        lastError=error;
        stream=null;
      }
    }
    if(!stream)throw lastError||new Error("تعذر تشغيل الكاميرا.");

    state.cameraStream=stream;
    state.cameraTorch=false;
    const preview=$("#cameraPreview");
    preview.srcObject=stream;
    preview.classList.toggle("mirror",state.cameraFacing==="user");
    await preview.play().catch(()=>{});
    updateCameraCapabilities();
  }

  function updateCameraCapabilities(){
    const track=state.cameraStream?.getVideoTracks?.()[0];
    const flash=$("#cameraFlash");
    if(!track||!flash)return;
    let supportsTorch=false;
    try{
      const caps=track.getCapabilities?.()||{};
      supportsTorch=Boolean(caps.torch);
    }catch{}
    flash.disabled=!supportsTorch;
    flash.classList.toggle("unsupported",!supportsTorch);
    flash.classList.toggle("active",Boolean(state.cameraTorch));
    flash.querySelector("span").textContent=supportsTorch?(state.cameraTorch?"فلاش يعمل":"فلاش"):"بدون فلاش";
  }

  function setCameraMode(mode,{restart=true}={}){
    const target=state.composerType==="reel"?"video":(mode==="video"?"video":"photo");
    const changed=state.cameraMode!==target;
    state.cameraMode=target;
    $$("#cameraStudioDialog [data-camera-mode]").forEach(button=>{
      button.classList.toggle("active",button.dataset.cameraMode===target);
      button.disabled=state.composerType==="reel"&&button.dataset.cameraMode==="photo";
    });
    $("#cameraHint").textContent=target==="video"?"اضغط لبدء تسجيل الفيديو":"اضغط لالتقاط صورة";
    $("#cameraCapture").classList.toggle("video-mode",target==="video");
    if(changed&&restart&&$("#cameraStudioDialog")?.open){
      startCameraStream().catch(showCameraError);
    }
  }

  function showCameraError(error){
    const box=$("#cameraError");
    box.innerHTML='<b>تعذر تشغيل الكاميرا</b><span>'+escapeHtml(error?.message||"تحقق من صلاحية الكاميرا ثم حاول مرة أخرى.")+'</span><button id="cameraFallbackButton" type="button">فتح كاميرا الجهاز</button>';
    box.classList.remove("hidden");
    $("#cameraFallbackButton").onclick=()=>{
      closeCameraStudio({returnToComposer:true});
      setTimeout(()=>$("#composerCameraFile")?.click(),120);
    };
  }

  async function openCameraStudio(){
    if(state.cameraRecorder?.state==="recording")return;
    syncComposerTypeUi(state.composerType||"post");
    state.cameraFacing="environment";
    state.cameraTimerSeconds=0;
    state.cameraTorch=false;
    $("#cameraTimerLabel").textContent="0ث";
    $("#cameraGrid").classList.add("hidden");
    $("#cameraError").classList.add("hidden");
    setCameraMode(state.composerType==="reel"?"video":"photo",{restart:false});
    if($("#composerDialog").open)$("#composerDialog").close();
    const dialog=$("#cameraStudioDialog");
    if(!dialog.open)dialog.showModal();
    try{
      await startCameraStream();
    }catch(error){
      showCameraError(error);
    }
  }

  function closeCameraStudio({returnToComposer=true}={}){
    if(state.cameraRecorder?.state==="recording"){
      try{
        state.cameraRecorder.ondataavailable=null;
        state.cameraRecorder.onstop=null;
        state.cameraRecorder.onerror=null;
        state.cameraRecorder.stop();
      }catch(_){}
    }
    state.cameraRecorder=null;
    state.cameraChunks=[];
    clearCameraRecordingTimer();
    stopCameraTracks();
    if($("#cameraStudioDialog").open)$("#cameraStudioDialog").close();
    if(returnToComposer&&!$("#composerDialog").open){
      setTimeout(()=>{try{$("#composerDialog").showModal()}catch(_){}},60);
    }
  }

  async function cameraCountdown(){
    const seconds=Number(state.cameraTimerSeconds||0);
    if(!seconds)return true;
    const root=$("#cameraCountdown");
    root.classList.remove("hidden");
    for(let remaining=seconds;remaining>0;remaining--){
      root.textContent=String(remaining);
      await new Promise(resolve=>setTimeout(resolve,1000));
      if(!$("#cameraStudioDialog").open){root.classList.add("hidden");return false}
    }
    root.classList.add("hidden");
    return true;
  }

  async function captureCameraPhoto(){
    const video=$("#cameraPreview");
    if(!video?.videoWidth||!video?.videoHeight)throw new Error("الكاميرا لم تصبح جاهزة بعد.");
    const canvas=document.createElement("canvas");
    const maxWidth=2160;
    const ratio=Math.min(1,maxWidth/video.videoWidth);
    canvas.width=Math.round(video.videoWidth*ratio);
    canvas.height=Math.round(video.videoHeight*ratio);
    const ctx=canvas.getContext("2d");
    if(state.cameraFacing==="user"){
      ctx.translate(canvas.width,0);
      ctx.scale(-1,1);
    }
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.92));
    if(!blob)throw new Error("تعذر حفظ الصورة.");
    return new File([blob],"ashur-camera-"+Date.now()+".jpg",{type:"image/jpeg",lastModified:Date.now()});
  }

  function preferredCameraVideoMime(){
    const types=[
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4"
    ];
    return types.find(type=>window.MediaRecorder?.isTypeSupported?.(type))||"";
  }

  async function startCameraRecording(){
    if(!state.cameraStream)throw new Error("الكاميرا غير جاهزة.");
    if(!window.MediaRecorder)throw new Error("تسجيل الفيديو غير مدعوم على هذا الجهاز.");

    const mime=preferredCameraVideoMime();
    const recorder=new MediaRecorder(state.cameraStream,mime?{mimeType:mime}:undefined);
    state.cameraRecorder=recorder;
    state.cameraChunks=[];
    recorder.ondataavailable=event=>{if(event.data?.size)state.cameraChunks.push(event.data)};
    recorder.onerror=event=>showCameraError(event.error||new Error("حدث خطأ أثناء تسجيل الفيديو."));
    recorder.onstop=()=>{
      const type=recorder.mimeType||mime||"video/webm";
      const blob=new Blob(state.cameraChunks,{type});
      const ext=type.includes("mp4")?"mp4":"webm";
      clearCameraRecordingTimer();
      state.cameraRecorder=null;
      state.cameraChunks=[];
      if(blob.size<1500){
        showCameraError(new Error("لم يتم تسجيل فيديو صالح."));
        return;
      }
      const file=new File([blob],"ashur-video-"+Date.now()+"."+ext,{type,lastModified:Date.now()});
      acceptComposerFiles([file],"camera");
      closeCameraStudio({returnToComposer:true});
    };
    recorder.start(300);
    state.cameraRecordingStarted=Date.now();
    $("#cameraRecordingBadge").classList.remove("hidden");
    $("#cameraCapture").classList.add("recording");
    $("#cameraHint").textContent="اضغط مرة ثانية لإيقاف التسجيل";
    state.cameraRecordingTimer=setInterval(()=>{
      const sec=Math.floor((Date.now()-state.cameraRecordingStarted)/1000);
      $("#cameraRecordTime").textContent=formatMediaTime(sec);
      if(sec>=180&&recorder.state==="recording")recorder.stop();
    },250);
  }

  $("#openCameraStudio").onclick=openCameraStudio;
  $("#closeCameraStudio").onclick=()=>closeCameraStudio({returnToComposer:true});
  $("#cameraStudioDialog").addEventListener("cancel",event=>{
    event.preventDefault();
    closeCameraStudio({returnToComposer:true});
  });

  $$("#cameraStudioDialog [data-camera-mode]").forEach(button=>button.onclick=()=>{
    if(state.cameraRecorder?.state==="recording")return;
    setCameraMode(button.dataset.cameraMode);
  });

  $$("#cameraStudioDialog [data-camera-publish]").forEach(button=>button.onclick=()=>{
    switchQuickPublishType(button.dataset.cameraPublish).catch(showCameraError);
  });

  async function switchCameraFacing(){
    if(state.cameraRecorder?.state==="recording")return;
    state.cameraFacing=state.cameraFacing==="environment"?"user":"environment";
    try{await startCameraStream()}catch(error){showCameraError(error)}
  }
  $("#cameraSwitch").onclick=switchCameraFacing;
  $("#cameraFacingQuick").onclick=switchCameraFacing;

  $("#cameraGridToggle").onclick=()=>{
    const grid=$("#cameraGrid");
    grid.classList.toggle("hidden");
    $("#cameraGridToggle").classList.toggle("active",!grid.classList.contains("hidden"));
  };

  $("#cameraTimer").onclick=()=>{
    const values=[0,3,10];
    const index=values.indexOf(Number(state.cameraTimerSeconds||0));
    state.cameraTimerSeconds=values[(index+1)%values.length];
    $("#cameraTimerLabel").textContent=state.cameraTimerSeconds+"ث";
    $("#cameraTimer").classList.toggle("active",state.cameraTimerSeconds>0);
  };

  $("#cameraFlash").onclick=async()=>{
    const track=state.cameraStream?.getVideoTracks?.()[0];
    if(!track)return;
    try{
      const caps=track.getCapabilities?.()||{};
      if(!caps.torch)return;
      state.cameraTorch=!state.cameraTorch;
      await track.applyConstraints({advanced:[{torch:state.cameraTorch}]});
      updateCameraCapabilities();
    }catch{
      state.cameraTorch=false;
      updateCameraCapabilities();
    }
  };

  $("#cameraGallery").onclick=()=>{
    closeCameraStudio({returnToComposer:true});
    setTimeout(()=>$("#composerFile")?.click(),150);
  };

  $("#cameraCapture").onclick=async()=>{
    const button=$("#cameraCapture");
    if(state.cameraMode==="video"&&state.cameraRecorder?.state==="recording"){
      button.disabled=true;
      try{state.cameraRecorder.stop()}catch(_){}
      setTimeout(()=>button.disabled=false,500);
      return;
    }

    button.disabled=true;
    try{
      const proceed=await cameraCountdown();
      if(!proceed)return;
      if(state.cameraMode==="video"){
        await startCameraRecording();
      }else{
        const file=await captureCameraPhoto();
        acceptComposerFiles([file],"camera");
        closeCameraStudio({returnToComposer:true});
      }
    }catch(error){
      showCameraError(error);
    }finally{
      button.disabled=false;
    }
  };

  function syncComposerTypeUi(type){
    state.composerType=["story","reel"].includes(type)?type:"post";
    const current=state.composerType;
    $("#composerTitle").textContent=current==="story"?"إنشاء قصة":current==="reel"?"إنشاء ريلز":"إنشاء منشور";
    $("#composerFile").accept=current==="reel"?"video/*":"image/*,video/*";
    $("#composerFile").multiple=current==="post";
    $("#composerCameraFile").accept=current==="reel"?"video/*":"image/*";
    $("#composerCaptionLabel").textContent=current==="story"?"نص القصة":"الوصف";
    $("#composerCaption").placeholder=current==="story"?"اكتب نص القصة أو استخدم @ لذكر صديق":"اكتب وصفًا... استخدم @ للإشارة إلى حساب و # للهاشتاغ";
    const privateAccount=Boolean(state.profile?.is_private);
    const publicOption=$("#composerVisibility").querySelector('option[value="public"]');
    if(publicOption)publicOption.disabled=privateAccount;
    if(privateAccount)$("#composerVisibility").value="followers";
    $("#composerExploreRow").classList.toggle("hidden",current!=="reel");
    $("#composerOptions").classList.toggle("hidden",current==="story");
    $("#composerDialog").classList.toggle("story-mode",current==="story");
    $("#storyEditorDock")?.classList.toggle("hidden",current!=="story");
    $("#storyEditorControls")?.classList.add("hidden");
    $$("#cameraStudioDialog [data-camera-publish]").forEach(button=>{
      button.classList.toggle("active",button.dataset.cameraPublish===current);
      button.setAttribute("aria-selected",button.dataset.cameraPublish===current?"true":"false");
    });
  }

  async function switchQuickPublishType(type){
    if(state.cameraRecorder?.state==="recording")return;
    syncComposerTypeUi(type);
    if(state.composerType==="reel"){
      setCameraMode("video");
    }else if(state.cameraMode==="video"){
      setCameraMode("photo");
    }else{
      setCameraMode(state.cameraMode,{restart:false});
    }
    $("#cameraHint").textContent=state.cameraMode==="video"?"اضغط لبدء تسجيل الفيديو":"اضغط لالتقاط صورة";
  }

  async function openComposer(type){
    if(!runtimeFeatureEnabled("uploads"))throw new Error(runtimeFeatureError("uploads"));
    if(type==="reel"&&!runtimeFeatureEnabled("reels"))throw new Error(runtimeFeatureError("reels"));
    if(type==="story"&&!runtimeFeatureEnabled("stories"))throw new Error(runtimeFeatureError("stories"));
    $("#publishDialog").close();
    clearComposerPreview();
    syncComposerTypeUi(type);
    $("#composerCaption").value="";
    const privateAccount=Boolean(state.profile?.is_private);
    $("#composerVisibility").value=privateAccount?"followers":"public";
    $("#composerCommentsEnabled").checked=true;
    $("#composerExploreEnabled").checked=true;
    $("#storyOverlayInput").value="";
    $("#storyOverlayColor").value="#ffffff";
    $("#storyOverlayY").value="50";
    $("#storyOverlayBg").checked=true;
    $("#composerMessage").textContent="";
    openDialog($("#composerDialog"));
    await restoreComposerDraft(state.composerType).catch(()=>false);
  }

  ["composerCaption","composerVisibility","composerCommentsEnabled","composerExploreEnabled","storyOverlayInput","storyOverlayColor","storyOverlayY","storyOverlayBg"].forEach(id=>{
    const el=$("#"+id);
    if(!el)return;
    el.addEventListener(id==="composerCaption"||id==="storyOverlayInput"||id==="storyOverlayY"?"input":"change",scheduleComposerDraftSave);
  });

  $("#composerFile").onchange=()=>{
    acceptComposerFiles($("#composerFile").files,"library");
    setTimeout(scheduleComposerDraftSave,0);
  };
  $("#composerCameraFile").onchange=()=>{
    acceptComposerFiles($("#composerCameraFile").files,"camera");
    setTimeout(scheduleComposerDraftSave,0);
  };

  async function generateVideoCover(file){
    if(!file?.type?.startsWith("video/"))return null;
    const url=URL.createObjectURL(file);
    try{
      const video=document.createElement("video");
      video.muted=true;
      video.playsInline=true;
      video.preload="auto";
      video.src=url;
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error("تعذر تجهيز غلاف الريلز")),8000);
        video.onloadedmetadata=()=>{
          const target=Math.min(0.35,Math.max(0.05,(video.duration||1)*0.04));
          try{video.currentTime=target}catch(_){}
        };
        video.onseeked=()=>{clearTimeout(timeout);resolve()};
        video.onerror=()=>{clearTimeout(timeout);reject(new Error("تعذر قراءة الفيديو"))};
      });
      const canvas=document.createElement("canvas");
      canvas.width=540;
      canvas.height=960;
      const ctx=canvas.getContext("2d");
      const vw=video.videoWidth||540,vh=video.videoHeight||960;
      const scale=Math.max(canvas.width/vw,canvas.height/vh);
      const dw=vw*scale,dh=vh*scale;
      ctx.drawImage(video,(canvas.width-dw)/2,(canvas.height-dh)/2,dw,dh);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.84));
      if(!blob)return null;
      return new File([blob],"reel-cover-"+Date.now()+".jpg",{type:"image/jpeg"});
    }catch{
      return null;
    }finally{
      URL.revokeObjectURL(url);
    }
  }

  async function notifyMentions(caption,type,id){
    if(!caption||(!caption.includes("@")&&!caption.includes("#")))return;
    await api("/v1/social/mentions",{
      method:"POST",
      body:JSON.stringify({caption,type,id})
    }).catch(()=>{});
  }

  $("#cancelComposer").onclick=async()=>{
    if(state.composerPublishing)return;
    if(composerHasDraftContent()){
      await saveComposerDraft({silent:true}).catch(()=>{});
      const ok=await confirmAction({
        title:"الخروج من استوديو آشور؟",
        text:"تم حفظ عملك كمسودة على هذا الجهاز. يمكنك الرجوع إليه لاحقًا من نفس نوع النشر.",
        acceptLabel:"خروج",
        danger:false
      });
      if(!ok)return;
    }
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

  function setComposerPublishState(active,label="نشر"){
    state.composerPublishing=Boolean(active);
    const button=$("#submitComposer");
    button.disabled=Boolean(active);
    button.classList.toggle("is-publishing",Boolean(active));
    button.textContent=active?(label||"جارٍ النشر"):"نشر";
    $("#cancelComposer").disabled=Boolean(active);
  }

  function setComposerOverallProgress(percent,text=""){
    const progress=$("#uploadProgress");
    const bar=progress?.querySelector(".progress>div");
    const progressText=$("#uploadProgressText");
    if(!progress)return;
    progress.classList.remove("hidden");
    const safe=Math.max(0,Math.min(100,Math.round(Number(percent)||0)));
    if(bar)bar.style.width=safe+"%";
    if(progressText)progressText.textContent=text||(safe+"%");
  }

  $("#submitComposer").onclick=async()=>{
    if(state.composerPublishing)return;
    let files=[...(state.composerFiles||[])];
    const caption=$("#composerCaption").value.trim();
    if(!files.length)return $("#composerMessage").textContent="اختر صورة أو فيديو قبل النشر.";

    for(const file of files){
      const uploadLimit=state.composerType==="story"
        ?runtimeUploadLimitMb("story",file)
        :state.composerType==="reel"
          ?runtimeUploadLimitMb("reel",file)
          :file.type.startsWith("image/")
            ?runtimeUploadLimitMb("post_image",file)
            :runtimeUploadLimitMb("post_video",file);
      if(file.size>uploadLimit*1024*1024){
        $("#composerMessage").textContent="حجم أحد ملفات المحتوى يتجاوز الحد المسموح ("+uploadLimit+" ميغابايت).";
        return;
      }
    }

    setComposerPublishState(true,"تجهيز...");
    $("#composerMessage").textContent="جارٍ تجهيز المحتوى للنشر...";
    setComposerOverallProgress(2,"تجهيز");
    try{
      if(files.length===1&&files[0].type.startsWith("image/")){
        files[0]=await editedImageFile(files[0]);
      }

      let reelCoverFile=null;
      if(state.composerType==="reel"){
        setComposerPublishState(true,"تجهيز الغلاف");
        reelCoverFile=await generateVideoCover(files[0]);
      }

      const totalBytes=Math.max(1,files.reduce((sum,file)=>sum+Number(file.size||0),0));
      let completedBytes=0;
      const uploaded=[];

      for(let i=0;i<files.length;i++){
        const file=files[i];
        const kind=state.composerType==="reel"
          ?"reel"
          :state.composerType==="story"
            ?"story"
            :file.type.startsWith("video/")?"post_video":"post_image";

        setComposerPublishState(true,files.length>1?("رفع "+(i+1)+"/"+files.length):"جارٍ الرفع");
        $("#composerMessage").textContent=files.length>1
          ?"جارٍ رفع الوسائط "+(i+1)+" من "+files.length+"..."
          :"جارٍ رفع المحتوى بأمان...";

        const media=await uploadFile(file,kind,{
          silent:true,
          onProgress:({loaded})=>{
            const ratio=(completedBytes+Math.min(Number(loaded||0),Number(file.size||0)))/totalBytes;
            const percent=5+(ratio*83);
            setComposerOverallProgress(percent,Math.round(percent)+"%");
          }
        });
        uploaded.push(media);
        completedBytes+=Number(file.size||0);
        setComposerOverallProgress(5+(completedBytes/totalBytes)*83,Math.round(5+(completedBytes/totalBytes)*83)+"%");
      }

      let reelCover=null;
      if(reelCoverFile){
        setComposerPublishState(true,"تجهيز الريلز");
        $("#composerMessage").textContent="جارٍ إنهاء تجهيز الريلز...";
        setComposerOverallProgress(90,"90%");
        reelCover=await uploadFile(reelCoverFile,"reel_cover",{silent:true}).catch(()=>null);
      }

      const visibility=state.profile?.is_private?"followers":($("#composerVisibility").value==="followers"?"followers":"public");
      const commentsEnabled=$("#composerCommentsEnabled").checked;
      setComposerPublishState(true,"حفظ...");
      $("#composerMessage").textContent="جارٍ حفظ المحتوى ونشره...";
      setComposerOverallProgress(94,"94%");

      if(state.composerType==="reel"){
        const result=await client.from("reels").insert({
          author_id:state.user.id,
          media_id:uploaded[0].id,
          cover_media_id:reelCover?.id||null,
          caption,
          visibility,
          comments_enabled:commentsEnabled,
          explore_enabled:$("#composerExploreEnabled").checked
        }).select("id").single();
        if(result.error)throw result.error;
        await notifyMentions(caption,"reel",result.data.id);
      }else if(state.composerType==="story"){
        const result=await client.from("stories").insert({
          author_id:state.user.id,
          media_id:uploaded[0].id,
          caption,
          overlay_text:$("#storyOverlayInput").value.trim(),
          overlay_color:$("#storyOverlayColor").value||"#ffffff",
          overlay_y:Number($("#storyOverlayY").value||50)/100,
          overlay_bg:$("#storyOverlayBg").checked
        }).select("id").single();
        if(result.error)throw result.error;
        await notifyMentions(caption+" "+$("#storyOverlayInput").value.trim(),"story",result.data.id);
      }else{
        const result=await client.from("posts").insert({
          author_id:state.user.id,
          caption,
          visibility,
          comments_enabled:commentsEnabled
        }).select("id").single();
        if(result.error)throw result.error;
        const mediaRows=uploaded.map((media,index)=>({post_id:result.data.id,media_id:media.id,sort_order:index}));
        const mediaResult=await client.from("post_media").insert(mediaRows);
        if(mediaResult.error)throw mediaResult.error;
        await notifyMentions(caption,"post",result.data.id);
      }

      setComposerOverallProgress(100,"تم النشر");
      await deleteComposerDraft(state.composerType).catch(()=>{});
      $("#composerMessage").textContent="تم نشر المحتوى بنجاح.";
      setComposerPublishState(true,"تم");
      await new Promise(resolve=>setTimeout(resolve,280));
      clearComposerPreview();
      $("#composerDialog").close();
      await loadHome();
      if(state.activePage==="profilePage")await loadProfile();
    }catch(error){
      $("#composerMessage").textContent=(error.message||"فشل النشر")+" — بقي المحتوى داخل الاستوديو لتعيد المحاولة.";
      $("#uploadProgress").classList.add("hidden");
    }finally{
      setComposerPublishState(false);
    }
  };

  async function uploadFile(file,kind,{silent=false,onProgress=null}={}){
    if(!runtimeFeatureEnabled("uploads"))throw new Error(runtimeFeatureError("uploads"));
    if(kind==="reel"&&!runtimeFeatureEnabled("reels"))throw new Error(runtimeFeatureError("reels"));
    if(kind==="story"&&!runtimeFeatureEnabled("stories"))throw new Error(runtimeFeatureError("stories"));
    if(kind.startsWith("chat_")&&!runtimeFeatureEnabled("messages"))throw new Error(runtimeFeatureError("messages"));
    if(kind==="group_media"&&!runtimeFeatureEnabled("groups"))throw new Error(runtimeFeatureError("groups"));
    const maxMb=runtimeUploadLimitMb(kind,file);
    if(file?.size>maxMb*1024*1024)throw new Error("حجم الملف يتجاوز الحد المسموح ("+maxMb+" ميغابايت).");
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
            if(typeof onProgress==="function"){
              try{onProgress({loaded:event.loaded,total:event.total,percent})}catch(_){}
            }
            if(silent&&$("#chatAttachmentPreview")&&!$("#chatAttachmentPreview").classList.contains("hidden")){
              const small=$("#chatAttachmentPreview").querySelector("small");
              if(small)small.textContent="جارٍ الرفع "+percent+"%";
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
  let conversationUserSearchTimer;

  $("#messagesSearchInput").oninput=()=>{
    clearTimeout(messagesSearchTimer);
    messagesSearchTimer=setTimeout(()=>loadConversations(),160);
  };

  $$(".messages-filter-tabs [data-message-filter]").forEach(button=>button.onclick=()=>{
    state.messageFilter=button.dataset.messageFilter||"all";
    $$(".messages-filter-tabs [data-message-filter]").forEach(item=>item.classList.toggle("active",item===button));
    loadConversations();
  });

  function setConversationCreateMode(mode){
    if(mode==="group"&&!runtimeFeatureEnabled("groups")){
      openInfoDialog("المجموعات",'<div class="empty">'+escapeHtml(runtimeFeatureError("groups"))+'</div>');
      mode="direct";
    }
    state.conversationCreateMode=mode==="group"?"group":"direct";
    state.selectedGroupMembers=new Map();
    $$(".conversation-create-tabs [data-create-mode]").forEach(button=>button.classList.toggle("active",button.dataset.createMode===state.conversationCreateMode));
    $("#groupTitleField").classList.toggle("hidden",state.conversationCreateMode!=="group");
    $("#selectedGroupMembers").classList.toggle("hidden",state.conversationCreateMode!=="group");
    $("#createGroupButton").classList.toggle("hidden",state.conversationCreateMode!=="group");
    $("#newConversationUsername").value="";
    $("#newConversationResult").innerHTML='<div class="empty">'+(state.conversationCreateMode==="group"?"ابحث واختر شخصين على الأقل.":"ابحث عن الشخص الذي تريد مراسلته.")+'</div>';
    $("#newConversationMessage").textContent="";
    renderSelectedGroupMembers();
  }

  function renderSelectedGroupMembers(){
    const root=$("#selectedGroupMembers");
    if(!root)return;
    const members=[...state.selectedGroupMembers.values()];
    root.innerHTML=members.map(profile=>
      '<span class="selected-member-chip">'+avatar(profile)+'<b>@'+escapeHtml(profile.username||"")+'</b><button type="button" data-remove-group-member="'+escapeHtml(profile.id)+'" aria-label="إزالة">×</button></span>'
    ).join("");
    root.classList.toggle("hidden",state.conversationCreateMode!=="group"||!members.length);
    hydrateMedia(root).catch(()=>{});
    root.querySelectorAll("[data-remove-group-member]").forEach(button=>button.onclick=()=>{
      state.selectedGroupMembers.delete(button.dataset.removeGroupMember);
      renderSelectedGroupMembers();
      searchConversationUsers();
    });
  }

  async function searchConversationUsers(){
    const root=$("#newConversationResult");
    const raw=$("#newConversationUsername").value.trim();
    if(!raw){
      root.innerHTML='<div class="empty">'+(state.conversationCreateMode==="group"?"ابحث بالاسم أو اليوزر ثم اختر الأعضاء.":"اكتب اسم الحساب أو اليوزر.")+'</div>';
      return;
    }
    const safe=raw.replace(/[,%()]/g,"").slice(0,40);
    const {data,error}=await client.from("profiles")
      .select("id,name,username,avatar_media_id,is_verified")
      .neq("id",state.user.id)
      .eq("is_banned",false)
      .or("name.ilike.%"+safe+"%,username.ilike.%"+safe+"%")
      .limit(20);
    if(error){
      root.innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
      return;
    }
    const rows=data||[];
    root.innerHTML=rows.map(profile=>{
      const selected=state.selectedGroupMembers.has(profile.id);
      return '<button class="list-card '+(selected?"selected":"")+'" data-conversation-user="'+escapeHtml(profile.id)+'" type="button">'+
        avatar(profile)+'<span class="grow"><b>'+escapeHtml(profile.name||"مستخدم")+(profile.is_verified?'<span class="verified-inline">✓</span>':"")+'</b><small>@'+escapeHtml(profile.username||"")+'</small></span>'+
        (state.conversationCreateMode==="group"?'<span class="conversation-user-check">✓</span>':'<span class="share-send-label">مراسلة</span>')+
      '</button>';
    }).join("")||'<div class="empty">لم يتم العثور على حسابات.</div>';
    await hydrateMedia(root);
    root.querySelectorAll("[data-conversation-user]").forEach(button=>button.onclick=async()=>{
      const profile=rows.find(row=>row.id===button.dataset.conversationUser);
      if(!profile)return;
      if(state.conversationCreateMode==="group"){
        if(state.selectedGroupMembers.has(profile.id))state.selectedGroupMembers.delete(profile.id);
        else state.selectedGroupMembers.set(profile.id,profile);
        renderSelectedGroupMembers();
        searchConversationUsers();
        return;
      }
      button.disabled=true;
      try{
        const conversation=await api("/v1/conversations",{
          method:"POST",
          body:JSON.stringify({kind:"direct",target_user_id:profile.id})
        });
        $("#newConversationDialog").close();
        await loadConversations();
        await openChat(conversation.id,profile.name||profile.username||"محادثة",{
          ...conversation,
          kind:"direct",
          title:profile.name||profile.username||"محادثة",
          peer_profile:profile
        });
      }catch(error){
        $("#newConversationMessage").textContent=error.message;
        button.disabled=false;
      }
    });
  }

  $("#newMessageButton").onclick=()=>{
    $("#newGroupTitle").value="";
    openDialog($("#newConversationDialog"));
    setConversationCreateMode("direct");
    setTimeout(()=>$("#newConversationUsername").focus(),120);
  };

  $("#closeNewConversation").onclick=()=>$("#newConversationDialog").close();

  $$(".conversation-create-tabs [data-create-mode]").forEach(button=>button.onclick=()=>setConversationCreateMode(button.dataset.createMode));

  $("#newConversationUsername").oninput=()=>{
    clearTimeout(conversationUserSearchTimer);
    conversationUserSearchTimer=setTimeout(()=>searchConversationUsers(),170);
  };

  $("#createGroupButton").onclick=async()=>{
    const button=$("#createGroupButton");
    const title=$("#newGroupTitle").value.trim();
    const memberIds=[...state.selectedGroupMembers.keys()];
    if(title.length<2)return $("#newConversationMessage").textContent="اكتب اسمًا للمجموعة.";
    if(memberIds.length<2)return $("#newConversationMessage").textContent="اختر شخصين على الأقل لإنشاء المجموعة.";
    button.disabled=true;
    $("#newConversationMessage").textContent="جارٍ إنشاء المجموعة...";
    try{
      const conversation=await api("/v1/conversations",{
        method:"POST",
        body:JSON.stringify({kind:"group",title,member_ids:memberIds})
      });
      $("#newConversationDialog").close();
      state.selectedGroupMembers=new Map();
      await loadConversations();
      await openChat(conversation.id,title,{...conversation,kind:"group",title,member_count:memberIds.length+1});
    }catch(error){
      $("#newConversationMessage").textContent=error.message;
    }finally{button.disabled=false}
  };

  let editAvatarObjectUrl="";
  let editCoverObjectUrl="";
  let usernameCheckTimer=null;
  let usernameCheckVersion=0;

  async function updateOwnProfile(patch){
    const payload={...patch,updated_at:new Date().toISOString()};
    const {data,error}=await client.from("profiles")
      .update(payload)
      .eq("id",state.user.id)
      .select("*")
      .single();
    if(error)throw error;
    state.profile=data;
    cacheProfile(data);
    return data;
  }

  function revokeEditObjectUrl(kind){
    const current=kind==="avatar"?editAvatarObjectUrl:editCoverObjectUrl;
    if(current){
      try{URL.revokeObjectURL(current)}catch(_){}
      if(kind==="avatar")editAvatarObjectUrl="";
      else editCoverObjectUrl="";
    }
  }

  async function renderEditMedia(kind,{file=null,mediaId=null,removed=false}={}){
    const isAvatar=kind==="avatar";
    const image=$(isAvatar?"#editAvatarPreview":"#editCoverPreview");
    const fallback=$(isAvatar?"#editAvatarFallback":"#editCoverFallback");
    const remove=$(isAvatar?"#removeAvatarImage":"#removeCoverImage");
    revokeEditObjectUrl(kind);
    image.classList.add("hidden");
    image.removeAttribute("src");
    delete image.dataset.mediaId;
    image.dataset.mediaReady="0";

    if(file){
      const check=profileUtil.validateImageFile(file);
      if(!check.ok)throw new Error(check.error);
      const url=URL.createObjectURL(file);
      if(isAvatar)editAvatarObjectUrl=url; else editCoverObjectUrl=url;
      image.src=url;
      image.classList.remove("hidden");
      fallback.classList.add("hidden");
      remove.disabled=false;
      return;
    }

    if(mediaId&&!removed){
      image.dataset.mediaId=mediaId;
      image.classList.remove("hidden");
      fallback.classList.add("hidden");
      remove.disabled=false;
      await hydrateMedia(image.parentElement).catch(()=>{});
      return;
    }

    fallback.classList.remove("hidden");
    remove.disabled=true;
  }

  function resetEditProfileMedia(){
    revokeEditObjectUrl("avatar");
    revokeEditObjectUrl("cover");
    $("#editProfileDialog").dataset.removeAvatar="0";
    $("#editProfileDialog").dataset.removeCover="0";
  }

  async function openEditProfile(){
    resetEditProfileMedia();
    $("#editName").value=state.profile?.name||"";
    $("#editUsername").value=state.profile?.username||"";
    $("#editBio").value=state.profile?.bio||"";
    $("#editProfileLink").value=state.profile?.profile_link||"";
    $("#editPrivate").checked=!!state.profile?.is_private;
    $("#editAvatarFile").value="";
    $("#editCoverFile").value="";
    $("#editProfileMessage").textContent="";
    $("#editUsernameStatus").textContent="اسم المستخدم الحالي";
    $("#editUsernameStatus").className="field-hint good";
    $("#editNameCount").textContent=String(($("#editName").value||"").length);
    $("#editBioCount").textContent=String(($("#editBio").value||"").length);
    await Promise.all([
      renderEditMedia("avatar",{mediaId:state.profile?.avatar_media_id||null}),
      renderEditMedia("cover",{mediaId:state.profile?.cover_media_id||null})
    ]);
    openDialog($("#editProfileDialog"));
  }

  $("#closeEditProfile").onclick=()=>{
    resetEditProfileMedia();
    $("#editProfileDialog").close();
  };

  $("#editName").oninput=()=>{
    const input=$("#editName");
    if(input.value.length>30)input.value=input.value.slice(0,30);
    $("#editNameCount").textContent=String(input.value.length);
  };

  $("#editBio").oninput=()=>{
    const input=$("#editBio");
    if(input.value.length>150)input.value=input.value.slice(0,150);
    $("#editBioCount").textContent=String(input.value.length);
  };

  $("#editUsername").oninput=()=>{
    const input=$("#editUsername");
    const normalized=profileUtil.normalizeUsername(input.value);
    if(input.value!==normalized)input.value=normalized;
    const status=$("#editUsernameStatus");
    clearTimeout(usernameCheckTimer);
    const version=++usernameCheckVersion;
    if(!/^[a-z0-9_.]{2,10}$/.test(normalized)){
      status.textContent="استخدم ٢–١٠ خانات: حروف، أرقام، نقطة أو _";
      status.className="field-hint bad";
      return;
    }
    if(normalized===(state.profile?.username||"")){
      status.textContent="اسم المستخدم الحالي";
      status.className="field-hint good";
      return;
    }
    status.textContent="جارٍ التحقق من التوفر...";
    status.className="field-hint";
    usernameCheckTimer=setTimeout(async()=>{
      const {data,error}=await client.from("profiles")
        .select("id")
        .eq("username",normalized)
        .neq("id",state.user.id)
        .maybeSingle();
      if(version!==usernameCheckVersion)return;
      if(error){
        status.textContent="تعذر التحقق الآن؛ سيتم التحقق عند الحفظ.";
        status.className="field-hint";
      }else if(data){
        status.textContent="اسم المستخدم مستخدم بالفعل";
        status.className="field-hint bad";
      }else{
        status.textContent="اسم المستخدم متاح";
        status.className="field-hint good";
      }
    },350);
  };

  $("#editAvatarFile").onchange=async()=>{
    const file=$("#editAvatarFile").files[0]||null;
    if(!file)return;
    try{
      $("#editProfileDialog").dataset.removeAvatar="0";
      await renderEditMedia("avatar",{file});
      $("#editProfileMessage").textContent="";
    }catch(error){
      $("#editAvatarFile").value="";
      $("#editProfileMessage").textContent=error.message;
      await renderEditMedia("avatar",{mediaId:state.profile?.avatar_media_id||null});
    }
  };

  $("#editCoverFile").onchange=async()=>{
    const file=$("#editCoverFile").files[0]||null;
    if(!file)return;
    try{
      $("#editProfileDialog").dataset.removeCover="0";
      await renderEditMedia("cover",{file});
      $("#editProfileMessage").textContent="";
    }catch(error){
      $("#editCoverFile").value="";
      $("#editProfileMessage").textContent=error.message;
      await renderEditMedia("cover",{mediaId:state.profile?.cover_media_id||null});
    }
  };

  $("#removeAvatarImage").onclick=async()=>{
    $("#editAvatarFile").value="";
    $("#editProfileDialog").dataset.removeAvatar="1";
    await renderEditMedia("avatar",{removed:true});
    $("#editProfileMessage").textContent="سيتم حذف صورة الحساب عند الحفظ.";
  };

  $("#removeCoverImage").onclick=async()=>{
    $("#editCoverFile").value="";
    $("#editProfileDialog").dataset.removeCover="1";
    await renderEditMedia("cover",{removed:true});
    $("#editProfileMessage").textContent="سيتم حذف الغلاف عند الحفظ.";
  };

  $("#editProfileForm").onsubmit=async(e)=>{
    e.preventDefault();
    const form=e.currentTarget;
    const validation=profileUtil.validateProfile({
      name:$("#editName").value,
      username:$("#editUsername").value,
      bio:$("#editBio").value,
      profile_link:$("#editProfileLink").value,
      is_private:$("#editPrivate").checked
    });
    if(!validation.ok){
      $("#editProfileMessage").textContent=validation.error;
      return;
    }

    const privacyChanged=validation.value.is_private!==Boolean(state.profile?.is_private);
    if(privacyChanged){
      const next=validation.value.is_private;
      const ok=await confirmAction({
        title:next?"تحويل الحساب إلى خاص":"تحويل الحساب إلى عام",
        text:next
          ?"سيحتاج المتابعون الجدد إلى موافقتك قبل رؤية المحتوى المخصص للمتابعين."
          :"سيصبح حسابك قابلًا للاكتشاف، وسيظهر المحتوى العام للآخرين حسب إعدادات النشر.",
        acceptLabel:next?"جعله خاصًا":"جعله عامًا"
      });
      if(!ok){
        $("#editPrivate").checked=!!state.profile?.is_private;
        return;
      }
      if(!$("#editProfileDialog").open)openDialog($("#editProfileDialog"));
    }

    const avatarFile=$("#editAvatarFile").files[0]||null;
    const coverFile=$("#editCoverFile").files[0]||null;
    const avatarCheck=profileUtil.validateImageFile(avatarFile);
    const coverCheck=profileUtil.validateImageFile(coverFile);
    if(!avatarCheck.ok)return $("#editProfileMessage").textContent=avatarCheck.error;
    if(!coverCheck.ok)return $("#editProfileMessage").textContent=coverCheck.error;

    const saveButton=$("#saveProfileButton");
    saveButton.disabled=true;
    form.setAttribute("aria-busy","true");
    $("#editProfileMessage").textContent="جارٍ حفظ الملف الشخصي...";

    try{
      let avatarMediaId=$("#editProfileDialog").dataset.removeAvatar==="1"?null:(state.profile?.avatar_media_id||null);
      let coverMediaId=$("#editProfileDialog").dataset.removeCover==="1"?null:(state.profile?.cover_media_id||null);

      if(avatarFile){
        $("#editProfileMessage").textContent="جارٍ رفع صورة الحساب...";
        const media=await uploadFile(avatarFile,"profile");
        avatarMediaId=media.id;
      }
      if(coverFile){
        $("#editProfileMessage").textContent="جارٍ رفع الغلاف...";
        const media=await uploadFile(coverFile,"profile_cover");
        coverMediaId=media.id;
      }

      const previousUsername=state.profile?.username||"";
      const previousName=state.profile?.name||"";
      const value=validation.value;
      await updateOwnProfile({
        name:value.name,
        username:value.username,
        bio:value.bio,
        profile_link:value.profile_link,
        is_private:value.is_private,
        avatar_media_id:avatarMediaId,
        cover_media_id:coverMediaId
      });

      if(previousUsername!==value.username||previousName!==value.name){
        const metadata={...(state.user?.user_metadata||{}),name:value.name,username:value.username};
        await client.auth.updateUser({data:metadata}).catch(()=>{});
      }

      $("#settingsPrivateToggle").checked=!!state.profile?.is_private;
      resetEditProfileMedia();
      $("#editProfileDialog").close();
      await loadProfile();
    }catch(error){
      $("#editProfileMessage").textContent=profileUtil.errorMessage(error,error?.message||"تعذر حفظ الملف الشخصي.");
    }finally{
      saveButton.disabled=false;
      form.removeAttribute("aria-busy");
    }
  };

  async function openSettings(){
    openDialog($("#settingsDialog"));
    window.AshurSettingsPage?.normalize?.();
    syncThemeControls(currentTheme());
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
      $("#settingsPrivateToggle").checked=!!state.profile?.is_private;
      $("#savedVisibilityToggle").checked=state.profile?.saved_visibility==="public";
      await loadFollowRequests();
    }catch(error){
      $("#followRequestsList").innerHTML='<div class="empty error">تعذر تحميل بعض الإعدادات.</div>';
    }
  }
  $("#closeSettings").onclick=()=>$("#settingsDialog").close();
  $$("[data-theme-choice]").forEach(button=>button.onclick=()=>{
    applyTheme(button.dataset.themeChoice,{persist:true});
  });
  $("#settingsLogoutButton").onclick=async()=>{
    const button=$("#settingsLogoutButton");
    button.disabled=true;
    try{
      const {error}=await client.auth.signOut({scope:"local"});
      if(error)throw error;
      $("#settingsDialog").close();
    }catch(error){
      alert(authUtil.errorMessage(error,"تعذر تسجيل الخروج."));
    }finally{
      button.disabled=false;
    }
  };
  $("#settingsEditProfile").onclick=()=>{
    $("#settingsDialog").close();
    openEditProfile();
  };
  $("#settingsPrivateToggle").onchange=async()=>{
    const toggle=$("#settingsPrivateToggle");
    const next=toggle.checked;
    const ok=await confirmAction({
      title:next?"تحويل الحساب إلى خاص":"تحويل الحساب إلى عام",
      text:next
        ?"طلبات المتابعة الجديدة ستحتاج موافقتك، ولن يظهر المحتوى المخصص للمتابعين لغير المقبولين."
        :"سيتمكن الآخرون من اكتشاف حسابك ومشاهدة المحتوى العام الذي تسمح به.",
      acceptLabel:next?"جعله خاصًا":"جعله عامًا"
    });
    if(!ok){
      toggle.checked=!next;
      return;
    }
    toggle.disabled=true;
    try{
      await updateOwnProfile({is_private:next});
      $("#editPrivate").checked=next;
    }catch(error){
      toggle.checked=!next;
      openInfoDialog("تعذر تغيير الخصوصية",'<div class="empty error">'+escapeHtml(profileUtil.errorMessage(error,error?.message||"تعذر تغيير خصوصية الحساب."))+'</div>');
    }finally{
      toggle.disabled=false;
    }
  };

  $("#savedVisibilityToggle").onchange=async()=>{
    const toggle=$("#savedVisibilityToggle");
    const next=toggle.checked;
    toggle.disabled=true;
    try{
      await updateOwnProfile({saved_visibility:next?"public":"private"});
    }catch(error){
      toggle.checked=!next;
      alert(profileUtil.errorMessage(error,error?.message||"تعذر تغيير إعداد المحفوظات."));
    }finally{
      toggle.disabled=false;
    }
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

  async function openSupportCenter(initialTicketId=""){
    const statusText={open:"جديد",in_progress:"قيد المتابعة",answered:"تم الرد",closed:"مغلق"};
    const priorityText={urgent:"عاجل",high:"عالية",normal:"عادية",low:"منخفضة"};
    const categoryText={technical:"مشكلة تقنية",account:"الحساب",content:"المحتوى",upload:"رفع الملفات",other:"أخرى",general:"عام"};

    const mount=(title,html)=>{
      $("#infoDialogTitle").textContent=title;
      $("#infoDialogBody").innerHTML=html;
      $("#settingsDialog").close();
      if(!$("#infoDialog").open)openDialog($("#infoDialog"));
    };

    const openTicket=async(ticketId)=>{
      mount("الدعم الفني",'<div class="support-thread-loading"><div class="empty">جارٍ تحميل التذكرة...</div></div>');
      try{
        const result=await api("/v1/social/support/"+encodeURIComponent(ticketId));
        const t=result.ticket||{};
        const messages=(result.messages||[]).map(m=>
          '<div class="user-support-message '+(m.sender_kind==="admin"?"from-admin":"from-user")+'">'+
            '<div class="user-support-message-meta"><b>'+(m.sender_kind==="admin"?"دعم آشور":"أنت")+'</b><span>'+new Date(m.created_at).toLocaleString("ar-IQ")+'</span></div>'+
            '<p>'+escapeHtml(m.body||"")+'</p>'+
          '</div>'
        ).join("")||'<div class="empty">لا توجد رسائل.</div>';

        mount("الدعم الفني",
          '<div class="support-ticket-detail">'+
            '<div class="support-ticket-detail-head">'+
              '<button id="supportBackToList" class="small-button" type="button">رجوع</button>'+
              '<div class="grow"><span class="eyebrow">'+escapeHtml(categoryText[t.category]||t.category||"الدعم")+'</span>'+
                '<h3>'+escapeHtml(t.subject||"طلب دعم")+'</h3>'+
                '<div class="support-ticket-tags"><span>'+escapeHtml(statusText[t.status]||t.status||"جديد")+'</span><span>'+escapeHtml(priorityText[t.priority]||t.priority||"عادية")+'</span><span>'+new Date(t.created_at).toLocaleString("ar-IQ")+'</span></div>'+
              '</div>'+
            '</div>'+
            '<div id="userSupportThread" class="user-support-thread">'+messages+'</div>'+
            (t.status==="closed"
              ?'<div class="support-closed-note">تم إغلاق هذه التذكرة. إذا عندك مشكلة جديدة أنشئ طلب دعم جديد.</div>'
              :'<div class="support-reply-composer"><textarea id="supportThreadReply" maxlength="4000" placeholder="اكتب ردك للدعم"></textarea><button id="sendSupportThreadReply" class="primary" type="button">إرسال الرد</button><p id="supportThreadMessage" class="message"></p></div>')+
          '</div>'
        );

        const thread=$("#userSupportThread");if(thread)thread.scrollTop=thread.scrollHeight;
        $("#supportBackToList").onclick=()=>renderHome();
        $("#sendSupportThreadReply")?.addEventListener("click",async()=>{
          const body=$("#supportThreadReply").value.trim();
          if(!body){
            $("#supportThreadMessage").textContent="اكتب الرد أولًا.";
            return;
          }
          $("#sendSupportThreadReply").disabled=true;
          $("#supportThreadMessage").textContent="جارٍ الإرسال...";
          try{
            await api("/v1/social/support/"+encodeURIComponent(ticketId),{
              method:"POST",body:JSON.stringify({body})
            });
            await openTicket(ticketId);
          }catch(error){
            $("#supportThreadMessage").textContent=error.message;
            $("#sendSupportThreadReply").disabled=false;
          }
        });
      }catch(error){
        mount("الدعم الفني",
          '<div class="settings-info"><button id="supportBackAfterError" class="small-button" type="button">رجوع</button><div class="empty error">'+escapeHtml(error.message)+'</div></div>'
        );
        $("#supportBackAfterError").onclick=()=>renderHome();
      }
    };

    const loadTickets=async()=>{
      try{
        const result=await api("/v1/social/support");
        $("#supportTicketsList").innerHTML=(result.items||[]).map(t=>
          '<button class="list-card support-ticket-card '+(t.unread_by_user?"unread":"")+'" data-support-ticket-open="'+escapeHtml(t.id)+'" type="button">'+
            '<div class="grow">'+
              '<div class="support-ticket-title-row"><b>'+escapeHtml(t.subject||"طلب دعم")+(t.unread_by_user?'<span class="support-unread-dot"></span>':"")+'</b><span>'+escapeHtml(statusText[t.status]||t.status||"جديد")+'</span></div>'+
              '<div class="meta">'+escapeHtml(categoryText[t.category]||t.category||"عام")+' · '+escapeHtml(priorityText[t.priority]||t.priority||"عادية")+' · '+new Date(t.last_message_at||t.created_at).toLocaleString("ar-IQ")+'</div>'+
              '<p>'+escapeHtml(t.admin_reply||t.body||"")+'</p>'+
            '</div>'+
          '</button>'
        ).join("")||'<div class="empty">ما عندك طلبات دعم بعد.</div>';
        $("#supportTicketsList").querySelectorAll("[data-support-ticket-open]").forEach(btn=>btn.onclick=()=>openTicket(btn.dataset.supportTicketOpen));
      }catch(error){
        $("#supportTicketsList").innerHTML='<div class="empty error">'+escapeHtml(error.message)+'</div>';
      }
    };

    const renderHome=async()=>{
      mount("الدعم الفني",
        '<div class="settings-info">'+
          '<div class="settings-group">'+
            '<h4>إرسال مشكلة</h4>'+
            '<label><span>نوع المشكلة</span><select id="supportCategory"><option value="technical">مشكلة تقنية</option><option value="account">الحساب</option><option value="content">المحتوى</option><option value="upload">رفع الملفات</option><option value="other">أخرى</option></select></label>'+
            '<label><span>العنوان</span><input id="supportSubject" maxlength="160" placeholder="عنوان مختصر"></label>'+
            '<label><span>التفاصيل</span><textarea id="supportBody" maxlength="4000" placeholder="اشرح المشكلة بالتفصيل"></textarea></label>'+
            '<button id="submitSupportTicket" class="primary" type="button">إرسال للدعم</button><p id="supportMessage" class="message"></p>'+
          '</div>'+
          '<div class="settings-group"><h4>طلباتك السابقة</h4><div id="supportTicketsList" class="list compact"><div class="empty">جارٍ التحميل...</div></div></div>'+
        '</div>'
      );
      await loadTickets();
      $("#submitSupportTicket").onclick=async()=>{
        const subject=$("#supportSubject").value.trim();
        const body=$("#supportBody").value.trim();
        if(!subject||!body){
          $("#supportMessage").textContent="اكتب العنوان والتفاصيل.";
          return;
        }
        $("#submitSupportTicket").disabled=true;
        $("#supportMessage").textContent="جارٍ إرسال الطلب...";
        try{
          const created=await api("/v1/social/support",{
            method:"POST",
            body:JSON.stringify({
              category:$("#supportCategory").value,
              subject,
              body,
              app_version:cfg.appVersion||"",
              device_info:navigator.userAgent.slice(0,300)
            })
          });
          if(created?.id)return openTicket(created.id);
          $("#supportSubject").value="";
          $("#supportBody").value="";
          $("#supportMessage").textContent="تم إرسال الطلب.";
          await loadTickets();
        }catch(error){
          $("#supportMessage").textContent=error.message;
          $("#submitSupportTicket").disabled=false;
        }
      };
    };

    if(initialTicketId)return openTicket(initialTicketId);
    return renderHome();
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
        '<div class="info-row"><span>حالة الجلسة</span><b>نشطة على هذا الجهاز</b></div>'+
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
        '<p id="securityMessage" class="message" aria-live="polite"></p>'+
      '</div>');

    const setSecurityMessage=(text,good=false)=>{
      const el=$("#securityMessage");
      el.textContent=text||"";
      el.className="message "+(text?(good?"success":"error"):"");
    };

    $("#changePasswordButton").onclick=async()=>{
      const p1=$("#securityPassword1").value;
      const p2=$("#securityPassword2").value;
      if(!authUtil.validPassword(p1))return setSecurityMessage("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
      if(p1!==p2)return setSecurityMessage("كلمتا المرور غير متطابقتين.");
      const button=$("#changePasswordButton");
      button.disabled=true;
      setSecurityMessage("جارٍ تغيير كلمة المرور...",true);
      try{
        const {error}=await client.auth.updateUser({password:p1});
        if(error)throw error;
        $("#securityPassword1").value="";
        $("#securityPassword2").value="";
        setSecurityMessage("تم تغيير كلمة المرور.",true);
      }catch(error){
        setSecurityMessage(authUtil.errorMessage(error,"تعذر تغيير كلمة المرور."));
      }finally{
        button.disabled=false;
      }
    };

    $("#changeEmailButton").onclick=async()=>{
      const next=authUtil.normalizeEmail($("#securityEmail").value);
      if(!authUtil.validEmail(next))return setSecurityMessage("اكتب بريدًا إلكترونيًا صحيحًا.");
      if(next===authUtil.normalizeEmail(state.user?.email||""))return setSecurityMessage("هذا هو البريد الحالي للحساب.");
      const button=$("#changeEmailButton");
      button.disabled=true;
      setSecurityMessage("جارٍ إرسال طلب تغيير البريد...",true);
      try{
        const {error}=await client.auth.updateUser({email:next});
        if(error)throw error;
        $("#securityEmail").value="";
        setSecurityMessage("تم إرسال طلب تغيير البريد. أكمل التحقق من الرسالة التي ستصلك.",true);
      }catch(error){
        setSecurityMessage(authUtil.errorMessage(error,"تعذر إرسال طلب تغيير البريد."));
      }finally{
        button.disabled=false;
      }
    };

    $("#globalSignOutButton").onclick=async()=>{
      const button=$("#globalSignOutButton");
      button.disabled=true;
      setSecurityMessage("جارٍ إنهاء الجلسات...",true);
      try{
        const {error}=await client.auth.signOut({scope:"global"});
        if(error)throw error;
        $("#infoDialog").close();
      }catch(error){
        setSecurityMessage(authUtil.errorMessage(error,"تعذر تسجيل الخروج من جميع الأجهزة."));
        button.disabled=false;
      }
    };
  };

  $("#supportTicketsButton").onclick=()=>openSupportCenter();
  $("#savedContentButton").onclick=async()=>{
    $("#settingsDialog").close();
    await navigateTo("profilePage");
    await loadProfileContent("saved");
  };
  $("#deleteAccountButton").onclick=async()=>{
    const ok=await confirmAction({
      title:"حذف حساب آشور؟",
      text:"سيتم حذف حسابك نهائيًا مع بيانات الحساب المرتبطة به، ولا يمكن التراجع عن العملية بعد تنفيذها.",
      acceptLabel:"متابعة الحذف",
      danger:true
    });
    if(!ok)return;

    openInfoDialog("التأكيد النهائي",
      '<div class="settings-info danger-confirmation stage4-danger-confirmation">'+
        '<div class="danger-confirm-icon"><svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v4M12 17h.01"/></svg></div>'+
        '<h4>اكتب كلمة حذف لإكمال العملية</h4>'+
        '<p>هذه آخر خطوة قبل حذف الحساب نهائيًا.</p>'+
        '<label><span>كلمة التأكيد</span><input id="deleteAccountPhrase" autocomplete="off" placeholder="حذف"></label>'+
        '<button id="confirmDeleteAccount" class="danger-wide" type="button" disabled>حذف الحساب نهائيًا</button>'+
        '<p id="deleteAccountMessage" class="message" aria-live="polite"></p>'+
      '</div>');
    const phrase=$("#deleteAccountPhrase");
    const button=$("#confirmDeleteAccount");
    phrase.oninput=()=>{button.disabled=phrase.value.trim()!=="حذف"};

    button.onclick=async()=>{
      if(phrase.value.trim()!=="حذف")return;
      button.disabled=true;
      phrase.disabled=true;
      $("#deleteAccountMessage").textContent="جارٍ حذف الحساب...";
      try{
        await api("/v1/account",{method:"DELETE",body:JSON.stringify({confirm:"DELETE"})});
        await client.auth.signOut({scope:"local"}).catch(()=>{});
        $("#infoDialog").close();
        clearAuthSession();
        setAuthView("login");
        showAuthMessage("تم حذف الحساب.",true);
      }catch(error){
        $("#deleteAccountMessage").textContent=error?.message||"تعذر حذف الحساب.";
        phrase.disabled=false;
        button.disabled=false;
      }
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


  document.addEventListener("click",async e=>{
    const mention=e.target.closest?.("[data-inline-mention]");
    if(mention){
      e.preventDefault();e.stopPropagation();
      const username=String(mention.dataset.inlineMention||"").toLowerCase();
      const result=await client.from("profiles").select("id").eq("username",username).maybeSingle();
      if(result.data?.id)openPublicProfile(result.data.id);
      return;
    }
    const hashtag=e.target.closest?.("[data-inline-hashtag]");
    if(hashtag){
      e.preventDefault();e.stopPropagation();
      await navigateTo("searchPage");
      $("#searchInput").value="#"+hashtag.dataset.inlineHashtag;
      setSearchType("posts");
      await runSearch();
    }
  });

  document.addEventListener("click",e=>{
    const link=e.target.closest?.("a[href]");
    if(!link)return;
    const href=link.href||"";
    if(/^https?:\/\//i.test(href) && window.AshurNative?.openExternal){
      e.preventDefault();
      try{window.AshurNative.openExternal(href)}catch(_){}
    }
  });

  try{window.AshurNative?.authReady?.()}catch(_){}

  window.ASHUR_HANDLE_BACK=()=>{
    const openDialogs=[...document.querySelectorAll("dialog[open]")];
    if(openDialogs.length){
      const dialog=openDialogs[openDialogs.length-1];
      if(dialog.id==="systemDialog" && dialog.dataset.blocking==="1")return true;
      if(dialog.id==="chatDialog"){
        closeChatRealtime();
        state.activeConversation=null;
        state.activeConversationMeta=null;
        clearChatAttachment();
      }
      if(dialog.id==="cameraStudioDialog"){
        closeCameraStudio({returnToComposer:true});
        return true;
      }
      if(dialog.id==="mediaViewerDialog"){
        $("#closeMediaViewer")?.click();
        return true;
      }
      if(dialog.id==="storyViewerDialog")clearTimeout(state.storyTimer);
      const returnProfile=["infoDialog","commentsDialog"].includes(dialog.id)?state.returnPublicProfileId:null;
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
