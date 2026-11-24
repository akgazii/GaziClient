// @name Emote picker
// @id emotepicker
// @description Press the panel key to see every emote in the game, even the ones you do not own, and click one to send it.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags visual, server-side

plugin.registerKeybind("Toggle emote panel", "Numpad1"); 

var game;  
var panel = null;  
var grid = null; 
var search = null; 
var count = null;
var held = false;
var emotes = null; 

blockyfish.addEventListener("gameInit", function(e) 
{
  game = e.game;  
}); 

function popup(text)  
{  
  try
  { 
    game.currentScene.showMessagePopup(text, 1500, false);
  }  
  catch {} 
}  

function loadEmotes(done)
{  
  fetch("https://api.deeeep.io/emotes").then(function(r) { return r.json(); }).then(function(list) 
  {  
    emotes = list;
    done();  
  }).catch(function()
  { 
    if (count!=null) 
    {
      count.innerText = "Could not load";
    }  
  });  
}  

function sendEmote(emote) 
{  
  if (game==null || game.socketManager==null || game.currentScene==null || game.currentScene.myAnimals==null || game.currentScene.myAnimals[0]==null)  
  { 
    popup("Spawn in a game first");
    return; 
  }
  game.socketManager.sendBytePacket(blockyfish.encodeBytePacket(gameState.token._value, blockyfish.ActionPacket.Emote, String(emote.id))); 
} 

function addStyle()  
{ 
  var style = document.createElement("style");
  style.textContent = ""
    + ".ep-window{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:430px;max-width:92vw;height:380px;max-height:70vh;z-index:2147483647;background:rgba(37,47,61,0.6);border:1px solid rgba(58,69,86,0.7);backdrop-filter:blur(2px);border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,0.3);color:#e5e7eb;font-family:inherit;display:none;flex-direction:column;}"
    + ".ep-title{position:relative;text-align:center;font-size:16px;padding:10px 36px 8px 36px;color:#e5e7eb;}"
    + ".ep-close{position:absolute;right:10px;top:6px;background:none;border:none;color:#9ca3af;font-size:20px;cursor:pointer;line-height:1;padding:4px;}"
    + ".ep-close:hover{color:#fff;}"
    + ".ep-top{display:flex;gap:8px;align-items:center;padding:0 14px 8px 14px;}"
    + ".ep-search{flex:1;background:rgba(28,36,48,0.6);border:1px solid rgba(58,69,86,0.8);border-radius:8px;color:#e5e7eb;padding:5px 10px;font-family:inherit;font-size:13px;outline:none;}"
    + ".ep-search:focus{border-color:#60a5fa;}"
    + ".ep-count{background:rgba(107,114,128,0.8);color:#fff;border-radius:8px;padding:5px 10px;font-size:12px;white-space:nowrap;}"
    + ".ep-heading{font-size:14px;font-weight:600;padding:0 14px 6px 14px;color:#f3f4f6;}"
    + ".ep-grid{flex:1;overflow:auto;padding:0 10px 12px 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:6px;align-content:start;}"
    + ".ep-grid::-webkit-scrollbar{width:8px;}"
    + ".ep-grid::-webkit-scrollbar-thumb{background:#4b5563;border-radius:4px;}"
    + ".ep-card{background:rgba(46,56,70,0.55);border:1px solid transparent;border-radius:8px;padding:5px 4px 4px 4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;color:#e5e7eb;font-family:inherit;}"
    + ".ep-card:hover{background:rgba(54,66,83,0.85);border-color:#4b5a70;}"
    + ".ep-card img{width:36px;height:36px;object-fit:contain;}"
    + ".ep-name{font-size:10px;color:#cbd5e1;text-align:center;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"
    + ".ep-chip{font-size:10px;background:#3a4556;color:#cbd5e1;border-radius:6px;padding:1px 6px;}"
    + "";
  document.head.appendChild(style);  
}  

function makePanel()  
{  
  addStyle(); 
  panel = document.createElement("div");  
  panel.className = "ep-window"; 

  var title = document.createElement("div"); 
  title.className = "ep-title";  
  title.innerText = "Emotes";
  var close = document.createElement("button");  
  close.className = "ep-close"; 
  close.innerText = "✕";  
  close.onclick = function() 
  { 
    panel.style.display = "none";  
  }; 
  title.appendChild(close);

  var top = document.createElement("div");  
  top.className = "ep-top";  
  search = document.createElement("input"); 
  search.className = "ep-search";  
  search.placeholder = "Search emotes"; 
  search.oninput = function() 
  {
    fillPanel();  
  }; 
  search.onkeydown = function(e) 
  {  
    e.stopPropagation(); 
  };
  search.onkeyup = function(e)
  {
    e.stopPropagation();
  }; 
  count = document.createElement("div"); 
  count.className = "ep-count"; 
  count.innerText = "Loading..."; 
  top.appendChild(search); 
  top.appendChild(count);  

  var heading = document.createElement("div");  
  heading.className = "ep-heading"; 
  heading.innerText = "All emotes"; 

  grid = document.createElement("div"); 
  grid.className = "ep-grid";

  panel.appendChild(title); 
  panel.appendChild(top);  
  panel.appendChild(heading); 
  panel.appendChild(grid);
  document.body.appendChild(panel);

  window.addEventListener("keydown", function(e)  
  {
    if (e.code=="Escape" && panel.style.display!="none")  
    { 
      panel.style.display = "none";
    }
  });  
} 

function fillPanel()  
{  
  grid.innerHTML = ""; 
  var text = search.value.trim().toLowerCase();  
  var shown = 0;  
  for(var i = 0;i<emotes.length;i++) 
  { 
    if (text!="" && String(emotes[i].name).toLowerCase().indexOf(text)==-1)  
    {  
      continue;
    }  
    grid.appendChild(makeButton(emotes[i]));
    shown++;
  }
  count.innerText = shown + " / " + emotes.length; 
}  

function makeButton(emote)
{
  var card = document.createElement("button");  
  card.className = "ep-card"; 
  card.title = emote.name; 
  var img = document.createElement("img");
  img.src = "https://cdn.deeeep.io/custom/emotes/" + emote.asset; 
  img.onerror = function() 
  {
    img.style.display = "none";
  };  
  var name = document.createElement("div"); 
  name.className = "ep-name";
  name.innerText = emote.name;  
  card.appendChild(img);  
  card.appendChild(name);  
  if (emote.on_sale==false)  
  { 
    var chip = document.createElement("div");  
    chip.className = "ep-chip"; 
    chip.innerText = "not on sale"; 
    card.appendChild(chip);  
  }  
  card.onclick = function() 
  {
    sendEmote(emote);  
  };
  return card; 
} 

function togglePanel()
{  
  if (panel==null) 
  {  
    makePanel();  
  } 
  if (panel.style.display=="flex")
  {  
    panel.style.display = "none"; 
    return; 
  }
  panel.style.display = "flex";  
  if (emotes==null) 
  { 
    loadEmotes(function()  
    { 
      fillPanel(); 
    }); 
  } 
} 

plugin.onKeybindDown("Toggle emote panel", function()
{ 
  if (held)  
  {
    return;  
  } 
  held = true; 
  togglePanel();
});

plugin.onKeybindUp("Toggle emote panel", function() 
{ 
  held = false;  
});
