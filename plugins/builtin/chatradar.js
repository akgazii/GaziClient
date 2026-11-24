// @name Chat radar
// @id chatradar
// @description Shows where players are when they type in chat, even if they are far away. Their spot shows up on the minimap with their name and fades out after a while. Press the keybind to toggle.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags visual, client-side

plugin.registerKeybind("Toggle chat radar", "NumpadDecimal");

plugin.registerSetting({ 
  name: "Show for (SEC)",
  description: "how long a chat spot stays on the minimap",
  type: "number",  
  defaultValue: 30,  
}); 
plugin.registerSetting({ 
  name: "Show names",
  description: "write the name next to the dot", 
  type: "boolean", 
  defaultValue: true,
});  

var game; 
var on = true;  
var held = false;  
var spots = {}; 
var sockets = new WeakSet();  
var layer = null; 
var dotGraphic = null;  
var labels = {};  
var labelStyle = null; 

blockyfish.addEventListener("gameInit", function(e)  
{  
  game = e.game; 
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

function readText(view, s)
{
  var text = ""; 
  var c;  
  while ((c = view.getUint16(s, true))!=0)
  {
    text = text + String.fromCharCode(c);  
    s = s + 2; 
  }
  return { text: text, next: s + 2 };  
}

function readPacket(data)
{ 
  var view = new DataView(data); 
  if (view.byteLength<2 || view.getUint8(0)!=105)  
  { 
    return;  
  }
  var count = view.getUint8(1);  
  var s = 2; 
  var mode = game!=null ? game.gameMode : 1;  
  for(var i = 0;i<count;i++) 
  { 
    var senderId = view.getUint32(s, true);  
    var x = view.getInt32(s + 4, true);
    var y = view.getInt32(s + 8, true); 
    s = s + 12; 
    if (mode==2)  
    { 
      s = s + 2; 
    } 
    else if (mode==6) 
    { 
      s = s + 5;
    } 
    s = s + 1;  
    var name = readText(view, s);  
    s = name.next + 2; 
    var message = readText(view, s); 
    s = message.next; 
    spots[senderId] = { x: x, y: y, name: name.text, message: message.text, t: Date.now() };
  }
} 

function mine(id)
{  
  var list = game.currentScene.myAnimals; 
  if (list==null)  
  {  
    return false;
  } 
  for(var i = 0;i<list.length;i++)  
  {
    if (list[i]!=null && list[i].id==id) 
    {
      return true;  
    }
  }
  return false;  
} 

function removeLayer()  
{
  if (layer!=null && layer.parent!=null)  
  { 
    layer.parent.removeChild(layer); 
  }  
  layer = null;
  dotGraphic = null;  
  labels = {};  
}

function makeLayer(minimap) 
{
  removeLayer();
  layer = new PIXI.Container();  
  dotGraphic = new PIXI.Graphics();  
  layer.addChild(dotGraphic); 
  minimap.addChild(layer); 
  if (labelStyle==null) 
  { 
    labelStyle = new PIXI.TextStyle({ fill: "#ffe14d", fontSize: 11, fontWeight: "bold", stroke: "#000000", strokeThickness: 3 });
  }  
} 

function draw()  
{  
  if (game==null || game.currentScene==null || game.currentScene.minimap==null)
  {
    removeLayer();  
    return;  
  }
  var minimap = game.currentScene.minimap; 
  if (layer==null || layer.parent!=minimap || layer.destroyed)  
  { 
    makeLayer(minimap); 
  }  
  dotGraphic.clear();
  layer.visible = on;  
  if (!on) 
  {  
    return; 
  } 
  var now = Date.now();  
  var life = Math.max(plugin.getSetting("Show for (SEC)"), 1) * 1000; 
  var showNames = plugin.getSetting("Show names");
  var halfW = minimap.viewSize.x / 2;
  var halfH = minimap.viewSize.y / 2;
  var grow = minimap.scale.x>0 ? 1 / minimap.scale.x : 1;
  var used = {};  
  for(var id in spots)  
  { 
    var spot = spots[id];  
    var age = now - spot.t; 
    if (age>life) 
    {
      delete spots[id];  
      continue; 
    } 
    if (mine(id))  
    { 
      continue; 
    } 
    var inner = new PIXI.Point(minimap.getRelativeX(spot.x), minimap.getRelativeY(spot.y)); 
    var p = minimap.toLocal(minimap.content.toGlobal(inner)); 
    if (p.x<-halfW || p.x>halfW || p.y<-halfH || p.y>halfH) 
    {  
      continue;  
    } 
    var fade = 1 - age / life * 0.7; 
    dotGraphic.lineStyle(grow, 0x000000, fade);
    dotGraphic.beginFill(0xffe14d, fade); 
    dotGraphic.drawCircle(p.x, p.y, 2.5 * grow); 
    dotGraphic.endFill();  
    if (age<1500) 
    {
      dotGraphic.lineStyle(grow, 0xffe14d, 1 - age / 1500);  
      dotGraphic.drawCircle(p.x, p.y, (2.5 + age / 150) * grow);  
    } 
    if (showNames)  
    {
      var label = labels[id]; 
      if (label==null)  
      {
        label = new PIXI.Text(spot.name, labelStyle);  
        label.anchor.set(0.5, 1); 
        layer.addChild(label);  
        labels[id] = label;  
      } 
      if (label.text!=spot.name) 
      {  
        label.text = spot.name;  
      }  
      label.scale.set(grow * 0.8);
      label.position.set(p.x, p.y - 3 * grow);
      label.alpha = fade;
      label.visible = true; 
      used[id] = true;
    }  
  }  
  for(var key in labels) 
  {
    if (!used[key]) 
    { 
      if (spots[key]==null) 
      {  
        labels[key].destroy(); 
        delete labels[key];  
      }  
      else
      {  
        labels[key].visible = false;  
      } 
    }
  }
}  

setInterval(function() 
{ 
  try
  {  
    draw();  
  } 
  catch (e)
  {  
  } 
}, 100); 

plugin.onKeybindDown("Toggle chat radar", function()
{
  if (held)
  {  
    return; 
  }  
  held = true;  
  on = !on;
  try
  { 
    game.currentScene.showMessagePopup(on ? "Chat radar has been enabled" : "Chat radar has been disabled", 1000, false);
  }  
  catch (e) 
  { 
  }
});  

plugin.onKeybindUp("Toggle chat radar", function()
{ 
  held = false;
}); 

if (window.__gaziStatus != null)  
{ 
  window.__gaziStatus.parts.push({ name: "Chat radar", active: function() { return on; } }); 
}
