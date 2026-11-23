/* Новогодняя тема: снег + отсчёт до Нового года. Подключается на всех страницах. */
(function(){
  if(window.__nyInit)return;window.__nyInit=true;
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* снегопад */
  if(!reduce){
    var c=document.createElement('canvas');c.id='ny-snow';c.setAttribute('aria-hidden','true');
    document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(c)});
    var x=c.getContext('2d'),W,H,fl=[],N=innerWidth<700?45:90;
    function rs(){W=c.width=innerWidth;H=c.height=innerHeight}
    rs();addEventListener('resize',rs);
    for(var i=0;i<N;i++)fl.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*2.6+.8,s:Math.random()*.9+.35,d:Math.random()*Math.PI*2});
    (function tick(){
      x.clearRect(0,0,W,H);x.fillStyle='rgba(255,255,255,.88)';x.beginPath();
      for(var i=0;i<fl.length;i++){var f=fl[i];f.y+=f.s;f.d+=.008;f.x+=Math.sin(f.d)*.5;
        if(f.y>H+5){f.y=-5;f.x=Math.random()*W}
        x.moveTo(f.x,f.y);x.arc(f.x,f.y,f.r,0,6.283)}
      x.fill();requestAnimationFrame(tick)})();
  }
  /* отсчёт */
  function build(){
    var host=document.querySelector('.hero')||document.querySelector('main');
    if(!host||document.querySelector('.ny-countdown'))return;
    var el=document.createElement('div');el.className='ny-countdown';el.setAttribute('role','timer');
    if(host.classList.contains('hero'))host.appendChild(el);else{var h=host.querySelector('h1');if(h)h.insertAdjacentElement('afterend',el);else host.insertBefore(el,host.firstChild);el.style.marginBottom='18px'}
    function upd(){
      var now=new Date(),y=now.getFullYear(),t=new Date(y+1,0,1)-now;
      if(now.getMonth()===0&&now.getDate()<=7){el.innerHTML='<span class="ny-ico">🎆</span><span>С Новым годом, <b>'+y+'</b>!</span>';return}
      if(now.getMonth()<11&&!(now.getMonth()===10)){el.innerHTML='<span class="ny-ico">🎄</span><span>Новый год уже скоро</span>';return}
      var d=Math.floor(t/864e5),h=Math.floor(t%864e5/36e5),m=Math.floor(t%36e5/6e4);
      el.innerHTML='<span class="ny-ico">🎄</span><span>До Нового года:</span><b>'+d+' д '+h+' ч '+m+' мин</b>';
    }
    upd();setInterval(upd,30000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
})();
