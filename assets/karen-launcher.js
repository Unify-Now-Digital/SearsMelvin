(function(){
  if(!window.matchMedia||!window.matchMedia("(min-width: 1024px)").matches)return;
  var mark="sm-karen-launcher",styled=false,saw=false,warned=false;
  var css="#lc_text-widget{bottom:__B__!important;right:24px!important;transform:none!important;padding:0}#lc_text-widget:not(.lc_text-widget--active){width:56px;height:56px;max-height:56px;overflow:hidden}#lc_text-widget:not(.lc_text-widget--active) .lc_text-widget--prompt{display:none!important}#lc_text-widget--btn{position:fixed;bottom:__B__!important;right:24px!important;transform:none!important;width:56px;height:56px;padding:0;border:0;border-radius:50%;background:var(--sm-color-action-primary-bg);color:var(--sm-color-action-primary-text);font-family:var(--sm-font-body)}#lc_text-widget--btn :is(svg,path){stroke:currentColor}#lc_text-widget--btn:hover{background:var(--sm-color-action-primary-bg-hover)}#lc_text-widget--btn:focus-visible{outline:2px solid var(--sm-color-focus);outline-offset:2px}#lc_text-widget.lc_text-widget--active{bottom:__P__!important;right:24px!important;width:min(340px,calc(100vw - 48px))!important;max-width:100%!important;height:__H__!important;max-height:__H__!important;overflow-x:hidden!important;overflow-y:auto!important;border-radius:var(--sm-radius-sm)!important}#lc_text-widget.lc_text-widget--active #lc_text-widget--box,#lc_text-widget.lc_text-widget--active .lc_text-widget--formContainer,#lc_text-widget.lc_text-widget--active .switchview-container,#lc_text-widget.lc_text-widget--active .lc_text-widget--form{width:100%!important;max-width:100%!important;height:auto!important;max-height:none!important;min-width:0!important;margin:0!important;overflow:visible!important;box-sizing:border-box!important}#lc_text-widget.lc_text-widget--active .lc_text-widget--text-input,#lc_text-widget.lc_text-widget--active textarea{max-width:100%!important;box-sizing:border-box!important}#lc_text-widget.lc_text-widget--active #lc_text-widget--btn{visibility:hidden!important;pointer-events:none!important}#lc_text-widget--box{border-radius:var(--sm-radius-sm)!important}";
  function gap(){try{var n=24,list=document.querySelectorAll(".mobile-bottom-bar,.price-summary"),i,r,lift;for(i=0;i<list.length;i++){r=list[i].getBoundingClientRect();if(r.height<20||r.top>innerHeight-4||r.bottom<innerHeight-140)continue;lift=Math.round(innerHeight-r.top)+16;if(lift>n&&lift<420)n=lift}return n}catch(e){return 24}}
  function room(){
    try{
      var width=Math.min(340,innerWidth-48),left=innerWidth-24-width,top=88,bottom=innerHeight-16,nodes=document.querySelectorAll("button,a,#productName"),i,el,r,text;
      for(i=0;i<nodes.length;i++){
        el=nodes[i];text=(el.innerText||"").replace(/\s+/g," ").trim();
        if(el.id!=="productName"&&!/request your quote|get a quote/i.test(text))continue;
        r=el.getBoundingClientRect();
        if(r.height<8||r.bottom<0||r.top>innerHeight)continue;
        if(r.right<left+8||r.left>left+width-8)continue;
        if(r.bottom<innerHeight*0.72){if(r.bottom+12>top)top=Math.round(r.bottom+12);}
        else if(r.top-12<bottom)bottom=Math.round(r.top-12);
      }
      var h=bottom-top;if(h>680)h=680;if(h<280)h=Math.min(520,innerHeight-top-16);
      return {h:h,b:Math.max(16,innerHeight-bottom)};
    }catch(e){return {h:520,b:92};}
  }
  function warn(){if(warned)return;warned=true;console.warn("Karen launcher left unchanged")}
  function reveal(root){
    try{
      var box=root.querySelector("#lc_text-widget"),send=root.querySelector("#lc_text-widget--send-btn");
      if(!box||!send||!box.classList.contains("lc_text-widget--active"))return;
      var extra=send.getBoundingClientRect().bottom-box.getBoundingClientRect().bottom;
      if(extra>4)box.scrollTop+=extra+12;
    }catch(e){}
  }
  function paint(root){
    var lim=room(),text=css.split("__B__").join(gap()+"px").split("__P__").join(lim.b+"px").split("__H__").join(lim.h+"px");
    var s=root.getElementById(mark);
    if(!s){s=document.createElement("style");s.id=mark;root.appendChild(s);}
    if(s.textContent!==text)s.textContent=text;
    var btn=root.querySelector("#lc_text-widget--btn");
    if(btn&&!btn.__smFit&&btn.addEventListener){btn.__smFit=1;btn.addEventListener("click",function(){setTimeout(function(){reveal(root);},400);});}
    reveal(root);
  }
  function scan(){
    var hosts=document.querySelectorAll("chat-widget, lc-chat-widget");
    if(hosts.length)saw=true;
    for(var i=0;i<hosts.length;i++){
      var root=hosts[i].shadowRoot;
      if(!root||!root.querySelector("#lc_text-widget")||!root.querySelector("#lc_text-widget--btn"))continue;
      paint(root);styled=true;
    }
  }
  var obs=new MutationObserver(scan);
  obs.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener("LC_chatWidgetLoaded",scan);
  setTimeout(function(){obs.disconnect();window.removeEventListener("LC_chatWidgetLoaded",scan);if(!styled&&saw)warn()},12000);
  scan();
})();
