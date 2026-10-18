(()=>{
  const controllers=new Map();
  let activePage="";
  const labels={
    homePage:"آشور",
    searchPage:"البحث",
    reelsPage:"الريلز",
    messagesPage:"الرسائل",
    profilePage:"حسابي"
  };

  function register(id,controller={}){
    if(!id)throw new Error("ASHUR_PAGE_ID_REQUIRED");
    controllers.set(id,Object.freeze({...controller,id}));
  }

  function updateShell(id){
    const topbar=document.querySelector(".topbar");
    const brand=document.querySelector("#brandButton");
    const logo=brand?.querySelector("img");
    const label=brand?.querySelector("span");
    const home=id==="homePage";
    if(topbar){
      topbar.classList.toggle("home-context",home);
      topbar.dataset.page=id||"homePage";
    }
    if(label)label.textContent=labels[id]||"آشور";
    if(logo)logo.classList.toggle("hidden",!home);
    if(brand)brand.setAttribute("aria-label",home?"الرئيسية":(labels[id]||"آشور"));
    document.body.dataset.ashurPage=id||"homePage";
  }

  async function enter(id,context={}){
    const next=controllers.get(id);
    if(activePage&&activePage!==id){
      const current=controllers.get(activePage);
      if(current?.leave)await current.leave({...context,page:activePage,nextPage:id});
    }
    activePage=id;
    updateShell(id);
    if(next?.enter)await next.enter({...context,page:id});
  }

  async function leave(id,context={}){
    const current=controllers.get(id);
    if(current?.leave)await current.leave({...context,page:id});
    if(activePage===id)activePage="";
  }

  window.AshurPages={
    register,
    enter,
    leave,
    get:id=>controllers.get(id)||null,
    list:()=>[...controllers.keys()],
    updateShell,
    active:()=>activePage
  };
})();