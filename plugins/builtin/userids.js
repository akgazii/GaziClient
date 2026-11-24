// @name User ids
// @id userids
// @description Shows every player's account username next to their name, so you can tell who is who even when they change their in-game name. Press the keybind to show or hide.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags visual, client-side

plugin.registerKeybind("Toggle user ids", "Numpad0");

var game; 
var on = false;  
var held = false;  
var users = {}; 
var names = {}; 
var sockets = new WeakSet(); 
var tag = "ui" + Math.random().toString(36).slice(2, 6); 
var style = { fill: "#9ad7ff", fontSize: 26 };  
var stripper = new RegExp("\\s*<" + tag + ">[^<]*</" + tag + ">", "g"); 

blockyfish.addEventListener("gameInit", function(e)
{  
  game = e.game;  
  users = {};
});

hook(WebSocket.prototype, "send", 
{  
  apply(f, th, args) 
  {  
    if (!sockets.has(th))  
    { 
      sockets.add(th);  
      th.addEventListener("message", function(ev)
      {  
        if (ev.data instanceof ArrayBuffer)
        { 
          try
          {
            readPacket(ev.data);
          } 
          catch (e)  
          {
          }  
        }  
      });
    } 
    return reflect.apply(f, th, args);  
  },
});

function readPlayer(view, s)  
{ 
  var roomId = view.getUint16(s, true); 
  var userId = view.getUint32(s + 10, true); 
  if (roomId>0 && userId>0) 
  {  
    users[roomId] = userId; 
  }  
}  

function readPacket(data)
{
  var view = new DataView(data);  
  if (view.byteLength<2)
  {  
    return; 
  }  
  var type = view.getUint8(0); 
  if ((type==128 || type==133) && view.byteLength>=15) 
  {  
    readPlayer(view, 1);  
  } 
  else if (type==114 && view.byteLength>=21 && view.getUint8(5)==7 && view.getUint8(6)==128)
  {  
    readPlayer(view, 7); 
  }
} 

function fromRanking()  
{ 
  if (typeof gameState=="undefined" || gameState==null)
  {  
    return;  
  } 
  var ranking = gameState.ranking;  
  if (ranking!=null && ranking.__v_isRef) 
  { 
    ranking = ranking.value;  
  } 
  if (ranking==null || ranking.ranking==null) 
  {  
    return; 
  } 
  for(var i = 0;i<ranking.ranking.length;i++) 
  {
    var data = ranking.ranking[i].playerData; 
    if (data!=null && data.playerRoomId>0 && data.userId>0)
    { 
      users[data.playerRoomId] = data.userId; 
    }
  }
}  

function accountName(userId)  
{
  var known = names[userId]; 
  if (known==null || (known.failed && Date.now()-known.at>30000)) 
  { 
    names[userId] = { at: Date.now() }; 
    fetch("https://api.deeeep.io/users/" + userId).then(function(r) { return r.json(); }).then(function(user)  
    { 
      if (user!=null && typeof user.username=="string" && user.username!="")  
      {  
        names[userId] = { name: user.username.replace(/[<>]/g, "") }; 
      }  
      else
      {
        names[userId] = { failed: true, at: Date.now() }; 
      }  
    }).catch(function()  
    {
      names[userId] = { failed: true, at: Date.now() };
    }); 
    return "#" + userId;
  }
  return known.name!=null ? "@" + known.name : "#" + userId;  
}  

function writeName(animal, extra) 
{ 
  var name = animal.nameObject;  
  if (name==null || typeof name.text!="string" || name.textStyles==null)  
  {  
    return;
  } 
  if (extra!="" && name.textStyles[tag]==null)  
  {  
    name.textStyles[tag] = style; 
  } 
  var next = name.text.replace(stripper, "") + extra; 
  if (name.text!=next)
  { 
    name.text = next;  
  } 
}

function tick()  
{  
  if (game==null || game.currentScene==null || game.currentScene.entityManager==null)  
  {  
    return;
  } 
  var animals = game.currentScene.entityManager.animalsList;
  if (animals==null)  
  { 
    return; 
  }
  if (on)  
  {  
    try
    { 
      fromRanking();  
    } 
    catch (e)
    { 
    }  
  } 
  for(var i = 0;i<animals.length;i++)  
  {  
    var a = animals[i];
    if (a==null) 
    {
      continue;  
    } 
    try
    {
      var userId = users[a.playerRoomId]; 
      if (!on || userId==null)
      {  
        writeName(a, ""); 
      } 
      else
      {
        writeName(a, " <" + tag + ">" + accountName(userId) + "</" + tag + ">");  
      } 
    } 
    catch (e) 
    { 
    }
  } 
}

setInterval(function() 
{  
  try
  {
    tick();  
  } 
  catch (e)
  { 
  } 
}, 300); 

plugin.onKeybindDown("Toggle user ids", function()  
{
  if (held)
  { 
    return;  
  }  
  held = true; 
  on = !on;  
}); 

plugin.onKeybindUp("Toggle user ids", function()  
{  
  held = false;
});

if (window.__gaziStatus != null) 
{  
  window.__gaziStatus.parts.push({ name: "User ids", active: function() { return on; } });
}  
