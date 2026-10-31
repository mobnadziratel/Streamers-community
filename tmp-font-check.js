
const params=new URLSearchParams(location.search),channel=(params.get("channel")||"").replace(/^@/,"").toLowerCase();
const requestedStyle=params.get("style")||"bubble-outline";
const themeMap={"clean":"minimal","bubble":"soft","soft-outline":"glass","bubble-outline":"glass","outline":"minimal"};
const theme=params.get("theme")||themeMap[requestedStyle]||"terminal",background=params.get("background")||"transparent";
const validColor=v=>/^#[0-9a-fA-F]{6}$/.test(v||"");
if(!/^[a-z0-9_]{1,25}$/.test(channel)){document.getElementById("status").textContent="Укажи Twitch-канал в параметре channel";throw new Error("Invalid Twitch channel")}
document.body.classList.add("template-"+(["terminal","neon","soft","pixel","glass","minimal","aurora","cyber","vhs","sakura","ocean","bloodmoon","gold","comic","matrix","bubblegum","mono","ember"].includes(theme)?theme:"terminal"));
const root=document.documentElement;
const fontMap={"brevis":"CommunityBrevis","st-kidloco":"CommunityKidLoco","architectural":"CommunityArchitectural","cheharda":"CommunityCheharda","ckazka":"CommunityCkazka","oprah":"CommunityOprah","panama":"CommunityPanama","perspective":"CommunityPerspective","lozung-caps":"CommunityLozung","eastern-rhodopes":"CommunityEastern","orientir":"CommunityOrientir","holodilnik":"CommunityHolodilnik","sol-kol":"CommunitySolKol","nevalyashka":"CommunityNevalyashka","kosolapa-script":"CommunityKosolapa","passions-conflict-rus":"CommunityPassions","moscow2024":"CommunityMoscow"};
const selectedFont=fontMap[params.get("font")||""];
if(selectedFont)root.style.setProperty("--chat-font",`"${selectedFont}",Inter,system-ui,sans-serif`);
if(params.get("preview")==="1"){document.documentElement.style.backgroundColor="#777777";document.body.style.backgroundColor="#777777";}
const direction=params.get("direction")||"bottom",layout=params.get("layout")||"vertical",namePosition=params.get("namePosition")||"inline",bgOpacity=params.get("transparent")==="1"?0:Math.max(0,Math.min(100,Number(params.get("bgOpacity")??0)))/100,bubbleOpacity=Math.max(0,Math.min(100,Number(params.get("bubbleOpacity")??100)))/100;const bg=params.get("bg"),textColor=params.get("text"),nameColor=params.get("name"),accent=params.get("accent"),outline=params.get("outline"),bubble=params.get("bubble"),size=params.get("size");
if(validColor(textColor))root.style.setProperty("--text",textColor);
if(validColor(nameColor))root.style.setProperty("--name",nameColor);
if(validColor(accent))root.style.setProperty("--accent",accent);
if(validColor(outline))root.style.setProperty("--line",outline+"99");
if(validColor(bubble))root.style.setProperty("--bubble",bubble);
if(size&&/^\d{1,2}$/.test(size))document.body.style.fontSize=Math.max(10,Math.min(32,Number(size)))+"px";
if(validColor(bg))root.style.setProperty("--chat-bg","rgba("+parseInt(bg.slice(1,3),16)+","+parseInt(bg.slice(3,5),16)+","+parseInt(bg.slice(5,7),16)+","+bgOpacity+")");if(validColor(bubble))root.style.setProperty("--bubble","rgba("+parseInt(bubble.slice(1,3),16)+","+parseInt(bubble.slice(3,5),16)+","+parseInt(bubble.slice(5,7),16)+","+bubbleOpacity+")");if(validColor(outline))root.style.setProperty("--outline","rgba("+parseInt(outline.slice(1,3),16)+","+parseInt(outline.slice(3,5),16)+","+parseInt(outline.slice(5,7),16)+","+bubbleOpacity+")");if(namePosition==="above")document.getElementById("chat").classList.add("name-above");if(layout==="horizontal")document.getElementById("chat").classList.add("horizontal");else if(direction!=="top")document.getElementById("chat").classList.add("bottom-up");
if(background==="dark")document.body.classList.add("dark");
const chat=document.getElementById("chat"),status=document.getElementById("status");let socket=null,retry=1000,closed=false,reconnectTimer=0;
// Global Twitch third-party emotes; each provider loads independently.
const emotesByName=new Map();
function rememberEmote(name,url){if(name&&url&&!emotesByName.has(name))emotesByName.set(name,url)}
async function loadEmotes(){
 const jobs=[
  fetch("https://api.betterttv.net/3/cached/emotes/global").then(r=>r.ok?r.json():[]).then(a=>a.forEach(e=>rememberEmote(e.code,"https://cdn.betterttv.net/emote/"+e.id+"/3x"))),
  fetch("https://api.frankerfacez.com/v1/set/global").then(r=>r.ok?r.json():null).then(d=>Object.values(d&&d.sets||{}).flatMap(s=>s.emoticons||[]).forEach(e=>rememberEmote(e.name,e.urls&& (e.urls["4"]||e.urls["2"]||e.urls["1"])))),
  fetch("https://7tv.io/v3/emote-sets/global").then(r=>r.ok?r.json():null).then(d=>(d&&d.emotes||[]).forEach(e=>rememberEmote(e.name,e.data&&e.data.host&&e.data.host.url?("https:"+e.data.host.url+"/4x.webp"):null)))
 ];
 await Promise.allSettled(jobs);
}
// In preview, wait for extension emotes so sample messages can render them.
let previewEmotesReady=null;
if(params.get("preview")==="1")previewEmotesReady=loadEmotes();
else if("requestIdleCallback" in window)requestIdleCallback(()=>loadEmotes(),{timeout:2500});else setTimeout(loadEmotes,1200);
function appendEmojiAwareText(target,value){
 const emojiPattern=/(\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u{1F3FB}-\u{1F3FF})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u{1F3FB}-\u{1F3FF})?)*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/gu;
 let last=0,match;
 while((match=emojiPattern.exec(value))){if(match.index>last)target.append(document.createTextNode(value.slice(last,match.index)));const span=document.createElement("span");span.className="chat-emoji";span.textContent=match[0];target.append(span);last=match.index+match[0].length;}
 if(last<value.length)target.append(document.createTextNode(value.slice(last)));
}
function appendMessageText(target,text,tagMap){
 const native={};
 for(const entry of (tagMap.emotes||"").split("/")){
  const parts=entry.split(":"),id=parts[0],positions=parts[1];if(!positions)continue;
  for(const p of positions.split(",")){const ab=p.split("-").map(Number);if(Number.isInteger(ab[0])&&Number.isInteger(ab[1]))native[ab[0]+"-"+ab[1]]=id}
 }
 const re=/\s+|\S+/g;let m;
 while((m=re.exec(text))){
  const token=m[0];if(/^\s+$/.test(token)){target.append(document.createTextNode(token));continue}
  const id=native[m.index+"-"+(m.index+token.length-1)];
  const previewFallbackEmotes={peepoHappy:"🐸✨",monkaS:"😳",KEKW:"😂",catJAM:"🐱🎵",Sadge:"😢",PauseChamp:"😮"};
  const staticUrl=id?"https://static-cdn.jtvnw.net/emoticons/v2/"+id+"/default/dark/2.0":emotesByName.get(token);
  if(staticUrl){const img=document.createElement("img");img.alt=token;img.title=token;img.className="chat-emote";img.loading="lazy";img.decoding="async";if(id){img.src="https://static-cdn.jtvnw.net/emoticons/v2/"+id+"/animated/dark/2.0";img.onerror=()=>{img.onerror=()=>img.replaceWith(document.createTextNode(token));img.src=staticUrl;};}else{img.src=staticUrl;img.onerror=()=>img.replaceWith(document.createTextNode(token));}target.append(img)}
  else appendEmojiAwareText(target,previewFallbackEmotes[token]||token);
 }
}
const badgeImages=new Map();
function makeBadge(targetRoles,setId,version,label,cls){const url=badgeImages.get(setId+"/"+version)||badgeImages.get(setId+"/1");if(url){const img=document.createElement("img");img.className="role-badge";img.src=url;img.alt=label;img.title=label;img.loading="lazy";targetRoles.append(img)}else{const b=document.createElement("span");b.className="role-badge fallback "+cls;b.textContent=label;b.dataset.setId=setId;b.dataset.version=version;b.dataset.label=label;b.dataset.badgeClass=cls;targetRoles.append(b)}}
async function loadOfficialBadges(){
  try {
    const response = await fetch("/api/chat-badges?channel="+encodeURIComponent(channel), {cache:"no-store"});
    if(!response.ok) throw new Error("Badge API returned "+response.status);
    const payload = await response.json();
    for(const [setId,set] of Object.entries(payload.badges||{})){
      for(const version of (set.versions||[])){
        if(version.url) badgeImages.set(setId+"/"+String(version.id),version.url);
      }
    }
    document.querySelectorAll(".role-badge.fallback[data-set-id]").forEach(old=>{
      const url=badgeImages.get(old.dataset.setId+"/"+old.dataset.version)||badgeImages.get(old.dataset.setId+"/1");
      if(!url)return;
      const img=document.createElement("img");
      img.className="role-badge";img.src=url;img.alt=old.dataset.label;img.title=old.dataset.label;img.loading="lazy";
      img.onerror=()=>{img.replaceWith(old)};
      old.replaceWith(img);
    });
  } catch(e) {
    console.warn("Could not load Twitch badges from server API",e);
  }
}
loadOfficialBadges();
function renderBadge(targetRoles,setId,version,label,cls){makeBadge(targetRoles,setId,version,label,cls)}
function showStatus(s){status.textContent=s}
const messageRows=new Map();let messageCounter=0;let horizontalDrag=null;let horizontalFollow=true;let horizontalUserScroll=false;let horizontalScrollFrame=0;const horizontalMaxScroll=()=>Math.max(0,chat.scrollWidth-chat.clientWidth);const horizontalAtEnd=()=>horizontalMaxScroll()-chat.scrollLeft<48;const scrollHorizontalToEnd=()=>{if(!chat.classList.contains("horizontal")||!horizontalFollow)return;cancelAnimationFrame(horizontalScrollFrame);horizontalScrollFrame=requestAnimationFrame(()=>{if(!horizontalFollow)return;chat.scrollLeft=horizontalMaxScroll();requestAnimationFrame(()=>{if(horizontalFollow)chat.scrollLeft=horizontalMaxScroll()})})};if(layout==="horizontal"){chat.addEventListener("scroll",()=>{if(horizontalUserScroll){horizontalFollow=horizontalAtEnd()}},{passive:true});if("ResizeObserver" in window){const horizontalResizeObserver=new ResizeObserver(()=>scrollHorizontalToEnd());horizontalResizeObserver.observe(chat);new MutationObserver(()=>scrollHorizontalToEnd()).observe(chat,{childList:true,subtree:true,characterData:true})}chat.style.cursor="grab";chat.addEventListener("wheel",event=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)){event.preventDefault();horizontalUserScroll=true;chat.scrollLeft+=event.deltaY;horizontalFollow=horizontalAtEnd();requestAnimationFrame(()=>{horizontalFollow=horizontalAtEnd();horizontalUserScroll=false;if(horizontalFollow)scrollHorizontalToEnd()})}else if(event.deltaX){horizontalUserScroll=true;requestAnimationFrame(()=>{horizontalFollow=horizontalAtEnd();horizontalUserScroll=false;if(horizontalFollow)scrollHorizontalToEnd()})}},{passive:false});chat.addEventListener("pointerdown",event=>{if(event.button!==0||event.target.closest("a,button,input,textarea,select"))return;horizontalDrag={x:event.clientX,left:chat.scrollLeft};horizontalUserScroll=true;chat.setPointerCapture?.(event.pointerId);chat.style.cursor="grabbing"});chat.addEventListener("pointermove",event=>{if(!horizontalDrag)return;chat.scrollLeft=horizontalDrag.left-(event.clientX-horizontalDrag.x);horizontalFollow=horizontalAtEnd()});const stopHorizontalDrag=()=>{if(horizontalDrag)horizontalFollow=horizontalAtEnd();horizontalDrag=null;horizontalUserScroll=false;chat.style.cursor="grab";if(horizontalFollow)scrollHorizontalToEnd()};chat.addEventListener("pointerup",stopHorizontalDrag);chat.addEventListener("pointercancel",stopHorizontalDrag);chat.addEventListener("pointerleave",event=>{if(event.buttons===0)stopHorizontalDrag()})}const disappearSeconds=Math.max(0,Math.min(600,Number(params.get("disappear")||0)||0));
function removeMessage(id){const row=messageRows.get(id);if(!row||row.dataset.fading==="1")return;row.dataset.fading="1";if(messageRows.get(id)===row)messageRows.delete(id);const horizontal=chat.classList.contains("horizontal");row.style.overflow="hidden";row.style.flexShrink="0";row.style.transition=horizontal?"opacity 300ms ease, transform 300ms ease, width 300ms ease, min-width 300ms ease, max-width 300ms ease, flex-basis 300ms ease, margin 300ms ease, padding 300ms ease":"opacity 420ms ease, transform 420ms ease, max-height 420ms ease, margin 420ms ease, padding 420ms ease";row.style.opacity="0";row.style.transform=horizontal?"translateX(8px) scale(.98)":"translateY(8px) scale(.98)";if(horizontal){const width=row.getBoundingClientRect().width;row.style.width=width+"px";row.style.minWidth="0";row.style.maxWidth=width+"px";row.style.flexBasis=width+"px";requestAnimationFrame(()=>{row.style.width="0px";row.style.maxWidth="0px";row.style.flexBasis="0px";row.style.marginLeft="0";row.style.marginRight="0";row.style.paddingLeft="0";row.style.paddingRight="0"})}else{row.style.maxHeight=row.offsetHeight+"px";requestAnimationFrame(()=>{row.style.maxHeight="0px";row.style.marginTop="0";row.style.marginBottom="0";row.style.paddingTop="0";row.style.paddingBottom="0"})}setTimeout(()=>{row.remove();if(horizontal&&horizontalFollow)scrollHorizontalToEnd()},horizontal?320:440)}
function addMessage(user,text,tags="",messageId=""){if(!text)return;const row=document.createElement("div");row.className="message";const internalId=messageId||("local-"+(++messageCounter));row.dataset.messageId=internalId;messageRows.set(internalId,row);const bubble=document.createElement("div");bubble.className="bubble";const name=document.createElement("span");name.className="name";const roles=document.createElement("span");roles.className="role-badges";const tagMap=Object.fromEntries(tags.split(";").filter(Boolean).map(x=>{const i=x.indexOf("=");return i<0?[x,""]:[x.slice(0,i),x.slice(i+1)]}));const badges=(tagMap.badges||"").split(",").filter(Boolean);const userType=tagMap["user-type"]||"";if(params.get("badges")!=="0")for(const entry of badges){const [setId,version]=entry.split("/");const labels={broadcaster:["Владелец","owner"],moderator:["Модератор","mod"],vip:["VIP","vip"],subscriber:["Подписчик","sub"],founder:["Основатель","sub"],staff:["Twitch Staff","owner"],admin:["Администратор","owner"],global_mod:["Глобальный модератор","mod"],bits:["Bits","sub"]};if(labels[setId])renderBadge(roles,setId,version,labels[setId][0],labels[setId][1]);}if(params.get("badges")!=="0"&&userType==="mod"&&!badges.some(x=>x.startsWith("moderator/")))renderBadge(roles,"moderator","1","Модератор","mod");if(params.get("badges")!=="0"&&roles.childNodes.length)name.append(roles);name.style.fontWeight=params.get("bold")==="0"?"400":"700";appendEmojiAwareText(name,user);const userColor=(tagMap.color||"").trim(),twitchColorsEnabled=params.get("twitchColors")!=="0";const effectiveNameColor=twitchColorsEnabled&&validColor(userColor)?userColor:(validColor(nameColor)?nameColor:"");if(effectiveNameColor){name.style.setProperty("color",effectiveNameColor,"important");row.style.setProperty("--message-color",effectiveNameColor)}if(requestedStyle==="clean"&&effectiveNameColor)bubble.style.setProperty("border-left","3px solid "+effectiveNameColor,"important");const body=document.createElement("span");body.className="text";appendMessageText(body,text,tagMap);const bubbleColor=params.get("bubble"),outlineColor=params.get("outline");if(validColor(bubbleColor)&&["bubble","soft-outline","bubble-outline"].includes(requestedStyle)){bubble.style.setProperty("background","rgba("+parseInt(bubbleColor.slice(1,3),16)+","+parseInt(bubbleColor.slice(3,5),16)+","+parseInt(bubbleColor.slice(5,7),16)+","+bubbleOpacity+")","important")}if(validColor(outlineColor)&&["outline","soft-outline","bubble-outline"].includes(requestedStyle)){bubble.style.setProperty("border","1px solid rgba("+parseInt(outlineColor.slice(1,3),16)+","+parseInt(outlineColor.slice(3,5),16)+","+parseInt(outlineColor.slice(5,7),16)+","+bubbleOpacity+")","important")}if(requestedStyle==="outline"){bubble.style.setProperty("background","transparent","important");bubble.style.setProperty("box-shadow","none","important")}if(requestedStyle==="bubble")bubble.style.setProperty("border","0","important");bubble.append(name,body);row.append(bubble);const horizontal=chat.classList.contains("horizontal");const wasAtHorizontalEnd=horizontal&&(horizontalFollow||horizontalAtEnd());if(horizontal&&wasAtHorizontalEnd)horizontalFollow=true;if(!horizontal&&(chat.classList.contains("bottom-up")||direction==="top"))chat.prepend(row);else chat.append(row);if(horizontal){if(wasAtHorizontalEnd)scrollHorizontalToEnd()}else requestAnimationFrame(()=>{if(chat.classList.contains("bottom-up")||direction==="top")chat.scrollTop=0;else chat.scrollTop=chat.scrollHeight});if(disappearSeconds>0)setTimeout(()=>removeMessage(internalId),disappearSeconds*1000);const maxVisibleMessages=chat.classList.contains("horizontal")?150:35;while(chat.children.length>maxVisibleMessages){const oldest=(chat.classList.contains("bottom-up")||(!chat.classList.contains("horizontal")&&direction==="top"))?chat.lastElementChild:chat.firstElementChild;if(oldest)removeMessage(oldest.dataset.messageId);else break}showStatus("");}
function parseLine(line){if(line.startsWith("PING")){socket?.send("PONG :tmi.twitch.tv");return}const tagPart=line.match(/^@([^ ]+) /)?.[1]||"";const tagMap=Object.fromEntries(tagPart.split(";").filter(Boolean).map(x=>{const i=x.indexOf("=");return i<0?[x,""]:[x.slice(0,i),x.slice(i+1)]}));const clear=line.match(/(?:^| )CLEARMSG #[^ ]+ :(.*)$/);if(clear){const id=tagMap["target-msg-id"];if(id)removeMessage(id);else{const target=clear[1];const row=[...chat.children].find(el=>el.textContent.includes(target));if(row){messageRows.delete(row.dataset.messageId);row.remove()}}return}const clearChat=line.match(/(?:^| )CLEARCHAT #[^ ]+(?: :(\S+))?/);if(clearChat){const target=clearChat[1];if(!target){chat.replaceChildren();messageRows.clear()}else{[...chat.children].forEach(row=>{if((row.querySelector(".name")?.textContent||"").trim().toLowerCase()===target.toLowerCase()){messageRows.delete(row.dataset.messageId);row.remove()}})}return}const m=line.match(/^(?:@([^ ]+) )?(?::([^! ]+)!([^ ]+) )?PRIVMSG #[^ ]+ :(.*)$/);if(!m)return;const tags=m[1]||"",user=m[2]||"Зритель",text=m[4]||"";let display=user;const displayTag=tags.split(";").find(x=>x.startsWith("display-name="))?.slice("display-name=".length);display=displayTag?displayTag.replace(/\\s/g," "):user;addMessage(display,text,tags,tagMap["id"]||"")}function connect(){if(closed)return;if(socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;clearTimeout(reconnectTimer);let ws;try{ws=new WebSocket("wss://irc-ws.chat.twitch.tv:443");socket=ws}catch{showStatus("Не удалось создать соединение");reconnectTimer=setTimeout(connect,retry);retry=Math.min(retry*2,15000);return}ws.onopen=()=>{if(socket!==ws)return;retry=1000;ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");ws.send("PASS SCHMOOPIIE");ws.send("NICK justinfan"+Math.floor(Math.random()*900000+100000));ws.send("JOIN #"+channel);showStatus("")};ws.onmessage=e=>{if(socket!==ws)return;String(e.data).split("\r\n").forEach(line=>{try{parseLine(line)}catch(err){console.error("Ошибка обработки сообщения Twitch:",err);showStatus("Ошибка обработки сообщения; подробности в консоли")}})};ws.onerror=()=>{if(socket===ws)showStatus("Ошибка соединения с Twitch")};ws.onclose=()=>{if(socket===ws)socket=null;if(!closed){showStatus("Соединение потеряно — переподключаемся…");clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,retry);retry=Math.min(retry*2,15000)}}}
if(params.get("preview")==="1"){
  status.style.display="none";
  const samples=[
    {user:"rueumur",text:"Всем привет! Добро пожаловать на стрим ✨ peepoHappy",tags:"badges=broadcaster/1;user-type="},
    {user:"homka20_",text:"Как дела, чат? monkaS KEKW",tags:"badges=moderator/1;mod=1;user-type=mod"},
    {user:"d1unizi",text:"Хорошего стрима всем 💜 catJAM",tags:"badges=vip/1;vip=1"},
    {user:"medverina",text:"LUL вот это момент 😂 Sadge",tags:"badges=subscriber/12;subscriber=1"},
    {user:"Зритель",text:"PogChamp Отличная игра! PauseChamp",tags:"badges="}
  ];
  // Загружаем реальные цвета Twitch после появления демонстрационных сообщений.
  const previewColorNames=samples.map(m=>m.user).filter(user=>/^[a-z0-9_]{1,25}$/i.test(user));
  const refreshPreviewColors=()=>{
    if(params.get("twitchColors")==="0")return;
    fetch("/api/chat-colors?logins="+encodeURIComponent([...new Set(previewColorNames)].join(",")),{cache:"no-store"})
      .then(response=>response.ok?response.json():Promise.reject(new Error("Twitch colors unavailable")))
      .then(payload=>{
        for(const row of chat.querySelectorAll(".message")){
          const nick=row.querySelector(".name");
          const login=(nick?.textContent||"").trim().toLowerCase();
          const color=payload.colors?.[login];
          if(color&&validColor(color)){nick.style.setProperty("color",color,"important");row.style.setProperty("--message-color",color);const bubble=row.querySelector(".bubble");if(bubble&&requestedStyle==="clean")bubble.style.setProperty("border-left","3px solid "+color,"important");}
        }
      }).catch(()=>{});
  };
  (previewEmotesReady||Promise.resolve()).finally(()=>{
    samples.forEach((m,i)=>setTimeout(()=>addMessage(m.user,m.text,m.tags,"preview-"+i), (i+1)*1250));
    refreshPreviewColors();
  });
}else connect();
if(selectedFont){setTimeout(()=>addMessage("mob_nadziratel","Любишь играть шрифтами - люби и автора кормить.","","font-credit-"+Date.now()),params.get("preview")==="1"?7200:1800)}
window.addEventListener("pageshow",()=>{if(!params.get("preview")&&(!socket||socket.readyState===WebSocket.CLOSED||socket.readyState===WebSocket.CLOSING))connect()});document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!params.get("preview")&&(!socket||socket.readyState===WebSocket.CLOSED||socket.readyState===WebSocket.CLOSING))connect()});window.addEventListener("beforeunload",()=>{closed=true;clearTimeout(reconnectTimer);try{socket?.close()}catch{}});
