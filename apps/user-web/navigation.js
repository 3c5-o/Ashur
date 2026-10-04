(()=>{
  "use strict";

  const allowedPages=new Set(["homePage","searchPage","reelsPage","messagesPage","profilePage"]);
  let handler=null;
  let pending=null;

  function normalize(page){
    const value=String(page||"");
    return allowedPages.has(value)?value:"homePage";
  }

  function activate(page){
    const target=normalize(page);
    document.querySelectorAll(".page").forEach(view=>{
      const active=view.id===target;
      view.classList.toggle("active",active);
      view.setAttribute("aria-hidden",active?"false":"true");
    });
    document.querySelectorAll(".bottom-nav .nav-item[data-page]").forEach(button=>{
      const active=button.dataset.page===target;
      button.classList.toggle("active",active);
      button.setAttribute("aria-current",active?"page":"false");
      button.tabIndex=active?0:-1;
    });
    document.body.dataset.ashurPage=target;
    return target;
  }

  async function request(page,meta={}){
    const target=activate(page);
    if(typeof handler==="function"){
      try{return await handler(target,meta)}
      catch(error){
        console.error("ASHUR_NAV_CONTROLLER_FAILED",target,error);
        activate(target);
        throw error;
      }
    }
    pending={page:target,meta};
    window.dispatchEvent(new CustomEvent("ashur:navigation-request",{detail:{page:target,meta}}));
    return target;
  }

  function setHandler(next){
    handler=typeof next==="function"?next:null;
    if(handler&&pending){
      const item=pending;
      pending=null;
      Promise.resolve(handler(item.page,item.meta)).catch(error=>console.error("ASHUR_PENDING_NAV_FAILED",error));
    }
  }

  function navButtonFromEvent(event){
    const target=event.target;
    return target?.closest?.(".bottom-nav .nav-item[data-page]")||null;
  }

  document.addEventListener("click",event=>{
    const button=navButtonFromEvent(event);
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    request(button.dataset.page,{source:"bottom-nav",originalEvent:event})
      .catch(error=>console.error("ASHUR_BOTTOM_NAV_FAILED",error));
  },true);

  document.addEventListener("keydown",event=>{
    if(event.key!=="Enter"&&event.key!==" ")return;
    const button=navButtonFromEvent(event);
    if(!button)return;
    event.preventDefault();
    request(button.dataset.page,{source:"bottom-nav-keyboard",originalEvent:event})
      .catch(error=>console.error("ASHUR_BOTTOM_NAV_FAILED",error));
  },true);

  window.AshurNavigation=Object.freeze({
    activate,
    request,
    setHandler,
    normalize,
    pages:()=>[...allowedPages]
  });
})();