// @name Thresher kit
// @id thresherkit
// @description Thresher shark only. Press the toggle key to turn it on, then ctrl + click turns your tail towards the animal closest to your mouse, leading it if it moves, and shoots. Shows a small shot calculator (angle, distance, flight time, lead) at the target and the damage your tail shots do.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags gameplay, visual, server-side

plugin.registerKeybind("Toggle tail aim", "Numpad5"); 

plugin.registerSetting({  
  name: "Range",  
  description: "how far from you a target can be picked", 
  type: "number", 
  defaultValue: 2500, 
}); 
plugin.registerSetting({  
  name: "Tail reach", 
  description: "how far the whirlpools really go, measured about 1550. further targets show red",
  type: "number",  
  defaultValue: 1550,
});  
plugin.registerSetting({ 
  name: "Shot speed",
  description: "speed of the tail whirlpools, measured 1100",  
  type: "number", 
  defaultValue: 1100,
});  
plugin.registerSetting({  
  name: "Max turn time (MS)", 
  description: "shoots anyway if the turn takes longer than this",
  type: "number",  
  defaultValue: 350,  
}); 
plugin.registerSetting({ 
  name: "Aim tolerance",  
  description: "shoots when you face the target within this many degrees",  
  type: "number",  
  defaultValue: 20, 
});  
plugin.registerSetting({  
  name: "Hold after shot (MS)", 
  description: "most time to keep facing the target after shooting. it lets go earlier as soon as the whirlpools stop coming out",
  type: "number", 
  defaultValue: 600, 
}); 
plugin.registerSetting({  
  name: "Ignore NPCs", 
  description: "do not aim at small npc fish",  
  type: "boolean",  
  defaultValue: true,
});  
plugin.registerSetting({
  name: "Show calculator",  
  description: "show angle, distance, flight time and lead under the target", 
  type: "boolean",  
  defaultValue: true, 
});
plugin.registerSetting({ 
  name: "Show hits",
  description: "show damage numbers from your tail shots",
  type: "boolean",  
  defaultValue: true,  
});

var game; 
var held = false;  
var armed = false; 
var aimPoint = null;
var aimUntil = 0; 
var aimTarget = null;  
var busy = false; 
var shooting = false;  
var layer = null;  
var calcText = null; 
var marker = null;  
var tracked = new WeakMap(); 
var lastHp = new WeakMap(); 
var whirlpools = [];
var floating = [];  
var thresher = blockyfish.Animals.ThresherShark; 

var npcs = [
  blockyfish.Animals.Pollock,
  blockyfish.Animals.Remora, 
  blockyfish.Animals.Dragonfly,  
  blockyfish.Animals.Lanternfish, 
  blockyfish.Animals.BabyPenguin, 
  blockyfish.Animals.LionsManeJellyfish, 
  blockyfish.Animals.Firefly, 
  blockyfish.Animals.Sardine, 
  blockyfish.Animals.GiantSinophore, 
];

blockyfish.addEventListener("gameInit", function(e)
{  
  game = e.game;  
  layer = null; 
}); 

function popup(text) 
{
  try
  {
    game.currentScene.showMessagePopup(text, 1200, false); 
  }  
  catch {} 
}

function myAnimal()  
{
  if (game==null || game.currentScene==null || game.currentScene.myAnimals==null)  
  { 
    return null;  
  } 
  return game.currentScene.myAnimals[0];  
}

function isThresher(me)  
{ 
  return me!=null && me.fishLevelData!=null && me.fishLevelData.fishLevel==thresher;  
}  

function aiming() 
{
  return aimPoint!=null && performance.now()<aimUntil; 
}

function realMouse()  
{  
  var saved = aimUntil;
  aimUntil = 0;  
  var m = null; 
  try
  {  
    m = game.inputManager.getMouseWorldPosition();
  }
  catch {}
  aimUntil = saved;
  return m;  
}

// Kept here, not on im: after an off/on the hooks are gone but a mark on im would stay.
var hookedInputs = new WeakSet();

function hookInput() 
{ 
  var im = game.inputManager; 
  if (im==null || hookedInputs.has(im)) 
  {
    return;  
  } 
  hookedInputs.add(im);  

  hook(im, "sendMoveToXY",  
  {
    apply(f, th, args)  
    {  
      if (aiming()) 
      {  
        args = [aimPoint.x, aimPoint.y, args[2]]; 
      }
      return reflect.apply(f, th, args); 
    },  
  });  

  hook(im, "getMouseWorldPosition", 
  {  
    apply(f, th, args) 
    { 
      var real = reflect.apply(f, th, args);  
      if (!aiming()) 
      {
        return real;  
      }
      if (real!=null && typeof real.clone=="function")
      {
        var copy = real.clone();  
        copy.x = aimPoint.x;
        copy.y = aimPoint.y;
        return copy; 
      }
      return { x: aimPoint.x, y: aimPoint.y };
    },  
  }); 
} 

function isTarget(me, a)  
{ 
  if (a==me || a.position==null || a.removed || game.currentScene.myAnimals.includes(a)) 
  {  
    return false; 
  }
  if (a.ally==true || (me.tribeId!=null && a.tribeId==me.tribeId)) 
  { 
    return false; 
  } 
  if (plugin.getSetting("Ignore NPCs") && a.fishLevelData!=null && (npcs.includes(a.fishLevelData.fishLevel) || a.fishLevelData.chooseable==false))
  {
    return false;
  } 
  return true;
}

function trackMovement()  
{  
  var animals = game.currentScene.entityManager.animalsList;
  var now = Date.now();
  for(var i = 0;i<animals.length;i++) 
  {
    var a = animals[i]; 
    if (a.position==null) 
    { 
      continue;  
    } 
    var old = tracked.get(a);  
    if (old==null)
    {  
      tracked.set(a, { x: a.position.x, y: a.position.y, t: now, vx: 0, vy: 0 }); 
      continue;  
    } 
    var dt = (now - old.t) / 1000;  
    if (dt<0.1)
    {  
      continue; 
    }  
    var vx = (a.position.x - old.x) / dt;  
    var vy = (a.position.y - old.y) / dt;
    if (dt>1) 
    { 
      vx = 0;  
      vy = 0;
    }  
    tracked.set(a, { x: a.position.x, y: a.position.y, t: now, vx: old.vx * 0.5 + vx * 0.5, vy: old.vy * 0.5 + vy * 0.5 });
  }  
} 

function predict(me, a)  
{  
  var speed = Math.max(plugin.getSetting("Shot speed"), 100); 
  var move = tracked.get(a) || { vx: 0, vy: 0 };
  var px = a.position.x;
  var py = a.position.y;
  var time = 0; 
  for(var i = 0;i<3;i++)
  {
    time = Math.sqrt((px - me.position.x) * (px - me.position.x) + (py - me.position.y) * (py - me.position.y)) / speed; 
    px = a.position.x + move.vx * time; 
    py = a.position.y + move.vy * time;  
  }
  var dx = px - me.position.x;
  var dy = py - me.position.y;
  return { 
    animal: a,  
    x: px,  
    y: py,
    dist: Math.sqrt(dx*dx + dy*dy),  
    angle: Math.atan2(dy, dx),
    time: time,
    lead: Math.sqrt((px - a.position.x) * (px - a.position.x) + (py - a.position.y) * (py - a.position.y)),  
  };
} 

function targetNearMouse(me)  
{
  var mouse = realMouse(); 
  if (mouse==null)
  { 
    return null;  
  }  
  var range = plugin.getSetting("Range"); 
  var animals = game.currentScene.entityManager.animalsList;  
  var best = null; 
  var bestDist = Infinity; 
  for(var i = 0;i<animals.length;i++)
  {  
    var a = animals[i]; 
    if (!isTarget(me, a))  
    {
      continue;  
    } 
    var fx = a.position.x - me.position.x;  
    var fy = a.position.y - me.position.y;
    if (fx*fx + fy*fy > range*range) 
    { 
      continue;  
    } 
    var mx = a.position.x - mouse.x; 
    var my = a.position.y - mouse.y;  
    var dist = mx*mx + my*my; 
    if (dist<bestDist) 
    { 
      bestDist = dist; 
      best = a; 
    }
  }
  return best; 
}  

function facingError(me, shotAngle)  
{ 
  if (me.entityData==null || typeof me.entityData.angle!="number") 
  { 
    return null; 
  }
  var want = shotAngle * 180 / Math.PI + 180;  
  var diff = ((me.entityData.angle - want) % 360 + 540) % 360 - 180; 
  return Math.abs(diff);  
}  

function sendAction(id)
{ 
  game.socketManager.sendBytePacket(blockyfish.encodeBytePacket(gameState.token._value, id, ""));
}

function aimAt(me, angle)
{  
  aimPoint = { x: me.position.x - Math.cos(angle) * 2000, y: me.position.y - Math.sin(angle) * 2000 }; 
  game.inputManager.sendMoveToXY(aimPoint.x, aimPoint.y, 10000);  
}  

function aimAndShoot()
{
  var me = myAnimal(); 
  if (me==null || game.inputManager==null)  
  {  
    return; 
  } 
  if (!isThresher(me))
  {  
    popup("Thresher kit only works on thresher shark");  
    return;  
  } 
  if (busy)  
  {
    return;  
  }
  hookInput();
  var target = targetNearMouse(me); 
  if (target==null) 
  { 
    popup("Nothing in range"); 
    return;  
  } 
  busy = true;  
  shooting = false;
  aimTarget = target;  
  var started = performance.now();  
  var maxTurn = Math.max(plugin.getSetting("Max turn time (MS)"), 50);  
  var hold = Math.max(plugin.getSetting("Hold after shot (MS)"), 0); 
  var tolerance = Math.max(plugin.getSetting("Aim tolerance"), 1);
  var firedAt = 0;  
  var before = {}; 
  var lastCount = 0; 
  var lastNewAt = 0;  
  aimUntil = started + maxTurn + hold + 100;
  aimAt(me, predict(me, target).angle);  

  var timer = setInterval(function()
  { 
    try
    {
      var now = myAnimal();  
      if (now==null || target.removed || target.position==null) 
      { 
        clearInterval(timer);  
        busy = false;
        aimPoint = null; 
        aimTarget = null;
        return;  
      }
      var shot = predict(now, target);  
      aimAt(now, shot.angle); 
      if (firedAt==0)  
      { 
        var error = facingError(now, shot.angle); 
        if ((error!=null && error<=tolerance) || performance.now() - started>=maxTurn)  
        { 
          var old = findWhirlpools(now);
          for(var i = 0;i<old.length;i++) 
          {  
            before[old[i].entityData.id] = true; 
          }
          sendAction(blockyfish.ActionPacket.StopChargingBoost); 
          sendAction(blockyfish.ActionPacket.SecondaryAbility); 
          firedAt = performance.now();
          shooting = true; 
          aimUntil = firedAt + hold; 
        } 
      }  
      else
      {  
        var count = newWhirlpools(now, before); 
        if (count!=lastCount) 
        { 
          lastCount = count; 
          lastNewAt = performance.now();  
        } 
        var quiet = count>0 && performance.now() - lastNewAt >= 200;  
        if (!(performance.now() - firedAt>=hold || count>=5 || quiet))  
        { 
          return;  
        } 
        clearInterval(timer);  
        busy = false;  
        shooting = false; 
        aimPoint = null;  
        aimTarget = null;
      }  
    }
    catch
    { 
      clearInterval(timer); 
      busy = false;
      shooting = false;  
    }  
  }, 20);  
} 

function getLayer()  
{  
  var me = myAnimal(); 
  if (me==null || me.parent==null) 
  { 
    return null; 
  }  
  if (layer==null || layer.parent!=me.parent || layer.destroyed) 
  {
    layer = new PIXI.Container();  
    me.parent.addChild(layer);  
    marker = new PIXI.Graphics();  
    layer.addChild(marker);  
    calcText = new PIXI.Text("", { fill: "#e5e7eb", fontSize: 18, fontWeight: "bold", stroke: "#000000", strokeThickness: 4, align: "center" });
    calcText.anchor.set(0.5, 0); 
    calcText.alpha = 0.85;  
    layer.addChild(calcText); 
  } 
  return layer;  
}  

function showCalculator(me) 
{  
  if (getLayer()==null) 
  { 
    return;  
  } 
  marker.clear();  
  calcText.text = "";  
  if (!plugin.getSetting("Show calculator")) 
  {  
    return; 
  }
  var target = aimTarget!=null ? aimTarget : targetNearMouse(me); 
  if (target==null)  
  {
    return; 
  } 
  var shot = predict(me, target);  
  var far = shot.dist>plugin.getSetting("Tail reach"); 
  var degrees = Math.round(((shot.angle * 180 / Math.PI) % 360 + 360) % 360); 
  var text = degrees + "°  " + Math.round(shot.dist) + "u  " + shot.time.toFixed(2) + "s"; 
  if (shot.lead>=20) 
  { 
    text = text + "  lead " + Math.round(shot.lead); 
  }
  if (busy)  
  {  
    var error = facingError(me, shot.angle); 
    if (shooting) 
    { 
      text = text + "\nshooting"; 
    }
    else if (error!=null)  
    { 
      text = text + "\nturn " + Math.round(error) + "°";  
    }  
  } 
  var color = far ? 0xff6b6b : 0xffd166;
  marker.lineStyle(3, color, 0.85);  
  marker.moveTo(shot.x - 18, shot.y - 18); 
  marker.lineTo(shot.x + 18, shot.y + 18);
  marker.moveTo(shot.x + 18, shot.y - 18);
  marker.lineTo(shot.x - 18, shot.y + 18);  
  calcText.text = text;
  calcText.style.fill = far ? "#ff6b6b" : (shooting ? "#34d399" : "#e5e7eb");  
  calcText.position.set(shot.x, shot.y + 26); 
}  

function addFloating(x, y, text, color)  
{ 
  if (getLayer()==null)
  { 
    return;
  }  
  var label = new PIXI.Text(text, { fill: color, fontSize: 28, fontWeight: "bold", stroke: "#000000", strokeThickness: 5 });  
  label.anchor.set(0.5);
  label.position.set(x, y);  
  layer.addChild(label);
  floating.push({ label: label, born: Date.now() }); 
}  

function findWhirlpools(me)
{  
  var list = game.currentScene.entityManager.entitiesList; 
  var mine = []; 
  for(var i = 0;i<list.length;i++) 
  {
    var e = list[i];
    if (e==null || e.removed || e.position==null || e.entityData==null || e.entityData.foodType!=21 || e.entityData.ownerId!=me.id) 
    {  
      continue; 
    }  
    mine.push(e);  
  }  
  return mine;  
}

function newWhirlpools(me, before) 
{  
  var list = findWhirlpools(me); 
  var count = 0;
  for(var i = 0;i<list.length;i++) 
  {
    var id = list[i].entityData.id;  
    if (before[id]!=true)  
    { 
      before[id] = "new";  
    } 
  } 
  for (var key in before)
  {
    if (before[key]=="new")  
    {
      count++; 
    }  
  }  
  return count; 
}

function trackHits(me)  
{
  var animals = game.currentScene.entityManager.animalsList; 
  for(var i = 0;i<animals.length;i++) 
  {  
    var a = animals[i]; 
    if (!isTarget(me, a) || a.entityData==null)
    { 
      continue;
    }
    var hp = a.entityData.hpPercentage;  
    var old = lastHp.get(a); 
    lastHp.set(a, hp); 
    if (typeof hp!="number" || typeof old!="number" || hp>=old) 
    { 
      continue; 
    } 
    for(var j = 0;j<whirlpools.length;j++)
    {  
      var dx = whirlpools[j].position.x - a.position.x;  
      var dy = whirlpools[j].position.y - a.position.y; 
      if (dx*dx + dy*dy < 450*450) 
      { 
        addFloating(a.position.x, a.position.y - 80, "-" + Math.round(old - hp) + "%", "#ffd166"); 
        break;  
      } 
    }  
  }  
}

function tick()
{
  try
  { 
    var me = myAnimal();  
    for(var i = floating.length - 1;i>=0;i--) 
    {
      var age = Date.now() - floating[i].born;  
      floating[i].label.y = floating[i].label.y - 1.5;
      floating[i].label.alpha = Math.max(0, 1 - age / 1000);  
      if (age>1000) 
      {  
        floating[i].label.destroy();  
        floating.splice(i, 1);
      } 
    } 
    if (me==null || me.position==null || !isThresher(me))
    {
      if (calcText!=null)  
      {
        calcText.text = "";  
        marker.clear();
      }  
      return; 
    }
    trackMovement();  
    showCalculator(me);
    whirlpools = findWhirlpools(me);  
    if (plugin.getSetting("Show hits")) 
    { 
      trackHits(me);
    } 
  } 
  catch {}  
} 

setInterval(tick, 50);  

window.addEventListener("click", function(e)  
{
  if (!armed || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey)  
  {  
    return; 
  }  
  if (!isThresher(myAnimal())) 
  {
    return; 
  }
  try
  {  
    aimAndShoot();  
  } 
  catch
  {  
    busy = false; 
  } 
}, true);  

plugin.onKeybindDown("Toggle tail aim", function() 
{
  if (held)  
  {  
    return;
  } 
  held = true;  
  if (!armed && !isThresher(myAnimal())) 
  { 
    popup("Thresher kit only works on thresher shark");
    return;
  }
  armed = !armed;  
  if (armed) 
  { 
    popup("Tail aim on, ctrl + click to shoot");
  }  
  else
  { 
    popup("Tail aim off"); 
  }
}); 

plugin.onKeybindUp("Toggle tail aim", function()
{ 
  held = false; 
}); 

if (window.__gaziStatus != null)  
{  
  window.__gaziStatus.parts.push({ name: "Tail aim", active: function() { return armed && isThresher(myAnimal()); } }); 
} 
