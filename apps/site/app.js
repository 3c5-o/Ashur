(()=>{
  const c=window.ASHUR_SITE_CONFIG||{};
  const $=x=>document.querySelector(x);
  const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
  const staleHost=/\.vercel\.app(?:\/|$)/i;
  const safeUrl=(candidate,fallback)=>{
    const value=String(candidate||"").trim();
    if(!value||staleHost.test(value))return fallback||"";
    return value;
  };
  function setHref(el,url){
    if(!el)return;
    if(url){
      el.href=url;
      el.classList.remove("disabled","disabled-link");
    }else{
      el.removeAttribute("href");
      el.classList.add("disabled","disabled-link");
    }
  }
  function applyDefaults(){
    for(const id of ["downloadButton","downloadButton2"])setHref($("#"+id),c.downloadUrl||"./download/ASHUR-User-latest.apk");
    for(const id of ["webButton","webButton2"])setHref($("#"+id),c.webUrl||"./app/");
  }
  async function load(){
    applyDefaults();
    if(!window.supabase?.createClient||!c.supabaseUrl||!c.supabaseKey)return;
    const s=window.supabase.createClient(c.supabaseUrl,c.supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await s.from("site_settings").select("key,value").in("key",["hero","download","features","update","support","legal"]);
    if(error)return;
    const m=Object.fromEntries((data||[]).map(x=>[x.key,x.value]));
    const h=m.hero||{},d=m.download||{},f=m.features||{},u=m.update||{},sp=m.support||{},l=m.legal||{};
    $("#heroTitle").textContent=h.title||"آشور";
    $("#heroSubtitle").textContent=h.subtitle||"تواصل، شارك، واكتشف.";
    document.title=(h.title||"آشور")+" — منصة تواصل عربية";
    const androidUrl=safeUrl(d.android_url||d.download_url,c.downloadUrl||"./download/ASHUR-User-latest.apk");
    const webUrl=safeUrl(d.web_url,c.webUrl||"./app/");
    for(const id of ["downloadButton","downloadButton2"])setHref($("#"+id),androidUrl);
    for(const id of ["webButton","webButton2"])setHref($("#"+id),webUrl);
    $("#versionInfo").textContent=[d.version&&("الإصدار "+d.version),d.size,d.sha256&&("SHA-256 "+String(d.sha256).slice(0,12)+"…")].filter(Boolean).join(" · ");
    const update=$("#siteUpdateNote");
    if(update){
      if(u.text){
        update.innerHTML="<b>"+esc(u.label||"آخر تحديث")+"</b><span>"+esc(u.text)+"</span>";
        update.classList.remove("hidden");
      }else update.classList.add("hidden");
    }
    const grid=$("#siteFeaturesGrid");
    const items=Array.isArray(f.items)?f.items.filter(x=>x&&x.enabled!==false&&x.title):[];
    if(grid&&items.length){
      grid.innerHTML=items.map((item,i)=>'<article><div class="feature-icon">'+String(i+1).padStart(2,"0")+'</div><b>'+esc(item.title)+'</b><p>'+esc(item.description||"")+'</p></article>').join("");
    }
    const support=$("#siteSupportLink");
    if(support){
      support.textContent=sp.label||"المساعدة";
      setHref(support,safeUrl(sp.url,"#faq"));
      if(!sp.url){support.href="#faq";support.classList.remove("disabled-link")}
    }
    setHref($("#sitePrivacyLink"),safeUrl(l.privacy_url,""));
    setHref($("#siteTermsLink"),safeUrl(l.terms_url,""));
    if(sp.email&&!sp.url&&support){
      support.href="mailto:"+encodeURIComponent(sp.email);
      support.classList.remove("disabled-link");
    }
  }
  load().catch(()=>applyDefaults());
})();
