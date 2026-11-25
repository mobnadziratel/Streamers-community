/* Автоскрытие шапки: вниз — прячется, вверх — появляется */
(function(){
  var h;function init(){
    h=document.querySelector('header');if(!h)return;
    var last=window.pageYOffset,acc=0,tick=false,HIDE_AFTER=140;
    function onScroll(){
      if(tick)return;tick=true;
      requestAnimationFrame(function(){
        tick=false;var y=Math.max(0,window.pageYOffset),d=y-last;last=y;
        if(y<=40){h.classList.remove('header-hidden');acc=0;return}
        if(d>0){acc=acc>0?acc+d:d;if(acc>HIDE_AFTER)h.classList.add('header-hidden')}
        else if(d<-3){acc=0;h.classList.remove('header-hidden')}
      });
    }
    addEventListener('scroll',onScroll,{passive:true});
    h.addEventListener('focusin',function(){h.classList.remove('header-hidden')});
    h.addEventListener('mouseenter',function(){if(window.pageYOffset>40&&matchMedia('(hover:hover)').matches&&mouseNearTop)h.classList.remove('header-hidden')});
    var mouseNearTop=false;
    addEventListener('mousemove',function(e){mouseNearTop=e.clientY<8;if(mouseNearTop)h.classList.remove('header-hidden')},{passive:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
