(function(){
  if(!window.matchMedia||!window.matchMedia("(min-width: 1024px)").matches)return;
  var mark="sm-karen-launcher",styled=false,saw=false,warned=false;
  var css="#lc_text-widget{bottom:__B__!important;right:24px!important;transform:none!important;padding:0}#lc_text-widget:not(.lc_text-widget--active){width:56px;height:56px;max-height:56px;overflow:hidden}#lc_text-widget:not(.lc_text-widget--active) .lc_text-widget--prompt{display:none!important}#lc_text-widget--btn{position:fixed;bottom:__B__!important;right:24px!important;transform:none!important;width:56px;height:56px;padding:0;border:0;border-radius:50%;background:var(--sm-color-action-primary-bg);color:var(--sm-color-action-primary-text);font-family:var(--sm-font-body)}#lc_text-widget--btn :is(svg,path){stroke:currentColor}#lc_text-widget--btn:hover{background:var(--sm-color-action-primary-bg-hover)}#lc_text-widget--btn:focus-visible{outline:2px solid var(--sm-color-focus);outline-offset:2px}#lc_text-widget.lc_text-widget--active{bottom:__P__!important;width:min(340px,calc(100vw - 48px));height:auto;max-height:max(200px,min(340px,calc(100vh - 600px)));overflow:auto;border-radius:var(--sm-radius-sm)}#lc_text-widget--box{border-radius:var(--sm-radius-sm)}";
  function gap(){try{var b=document.querySelector(".mobile-bottom-bar"),r=b&&b.getBoundingClientRect();if(r&&r.height>20)return 24+Math.round(r.height)}catch(e){}return 24}
  function warn(){if(warned)return;warned=true;console.warn("Karen launcher left unchanged")}
  function paint(root){
    var n=gap(),text=css.split("__B__").join(n+"px").split("__P__").join((n+68)+"px");
    var s=root.getElementById(mark);
    if(s){if(s.textContent!==text)s.textContent=text;return}
    s=document.createElement("style");s.id=mark;s.textContent=text;root.appendChild(s);
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
