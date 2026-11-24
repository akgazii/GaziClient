// @name Auto dodge
// @id autododge
// @description Automatically dodges enemies that can actually hurt you. Dodges when they boost at you and also early, when they are close and aiming straight at you (most bites come from boosts too close to react to). Checks every wall, ceiling and solid platform of the map with your body width and the real boost length, and never dodges out of the water. Press the dodge keybind to toggle. Change the values if you want.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags gameplay, server-side

plugin.registerKeybind("Toggle dodge", "KeyX"); 

plugin.registerSetting({  
  name: "Direction",  
  description: "where to dodge: side (out of their way), mouse (towards your mouse) or away (same direction as their boost)", 
  type: "list", 
  defaultValue: "side", 
  choices: ["side", "mouse", "away"], 
});  
plugin.registerSetting({ 
  name: "Radius",  
  description: "how close an enemy has to be before dodging",  
  type: "number", 
  defaultValue: 900,  
}); 
plugin.registerSetting({  
  name: "Turn delay (MS)",  
  description: "time between turning and boosting. raise if its buggy", 
  type: "number",
  defaultValue: 30,  
});  
plugin.registerSetting({ 
  name: "Cooldown (MS)", 
  description: "min time between dodges",
  type: "number",  
  defaultValue: 600,  
});
plugin.registerSetting({
  name: "Wall check",  
  description: "don't dodge into walls", 
  type: "boolean",  
  defaultValue: true,  
});
plugin.registerSetting({ 
  name: "Stay in water", 
  description: "counts the sky as a wall so a dodge never throws you out of the water", 
  type: "boolean", 
  defaultValue: true,  
}); 
plugin.registerSetting({  
  name: "Ability dodge",  
  description: "if your animal has a secondary ability (like catfish) use it to dodge instead of a normal boost",  
  type: "boolean",  
  defaultValue: false, 
});
plugin.registerSetting({
  name: "Danger bites",
  description: "only dodge animals that can kill you in this many bites or less, 0 to dodge everything",  
  type: "number", 
  defaultValue: 8, 
});
plugin.registerSetting({  
  name: "Escape grabs",  
  description: "boost to break free when an animal grabs you", 
  type: "boolean",  
  defaultValue: true, 
}); 
plugin.registerSetting({  
  name: "Skip if you win", 
  description: "don't dodge animals you can kill in fewer bites than they need to kill you",
  type: "boolean",  
  defaultValue: false,
});  
plugin.registerSetting({ 
  name: "Use aim",  
  description: "use where enemies are aiming (their mouse) to see who is coming at you, dodges earlier and ignores boosts aimed at someone else", 
  type: "boolean",
  defaultValue: true,
}); 
plugin.registerSetting({  
  name: "Boost only",
  description: "only dodge when an enemy actually boosts at you, never before (turns off early dodge)", 
  type: "boolean", 
  defaultValue: true,  
}); 
plugin.registerSetting({ 
  name: "Early dodge", 
  description: "also dodge before they boost when a dangerous enemy is close and aiming straight at you", 
  type: "boolean", 
  defaultValue: true, 
});  
plugin.registerSetting({  
  name: "Early distance", 
  description: "how close an aiming enemy has to be for an early dodge",
  type: "number",
  defaultValue: 450, 
}); 
plugin.registerSetting({ 
  name: "Aim dots",  
  description: "show a small red dot where every enemy is aiming", 
  type: "boolean",  
  defaultValue: true,  
}); 
plugin.registerSetting({  
  name: "Aim lines", 
  description: "also draw a faint line from every enemy to where it is aiming",
  type: "boolean",
  defaultValue: false,  
});  

if (plugin.storage.get("defaultsReset")!=2) 
{  
  plugin.setSetting("Direction", "side");  
  plugin.setSetting("Radius", 900); 
  plugin.setSetting("Turn delay (MS)", 30); 
  plugin.setSetting("Cooldown (MS)", 600);  
  plugin.setSetting("Early dodge", true);  
  plugin.setSetting("Early distance", 450);  
  plugin.storage.set("defaultsReset", 2); 
}  

var aimTolerance = 35;  
var earlyAim = 15; 
var earlyHeading = 0.9; 
var earlySpeed = 200; 
var freshRatio = 1.6; 
var freshSpeed = 900;  
var sideAngle = 30; 
var boostReach = 350;  
var abilityReach = 680;  
var wallStep = 40;  
var floorType = 1;  
var islandType = 2; 
var underwaterIslandType = 3;
var waterType = 4;  
var skyType = 7; 
var ceilingType = 8; 
var baseBite = 20;  
var energyPerBoost = 50;  
var willGrab = 1073741824;
var game;
var on = true; 
var held = false;  
var lastDodge = 0; 
var lastEscape = 0; 
var tracked = new WeakMap();  
var walls = null; 
var skies = null;  
var waters = null;  
var wallsFrom = null;
var wallsCount = 0; 
var wallsScene = null;
var wallsFirst = null;  
var solidLayers = ["terrains", "islands", "ceilings", "platforms"]; 
var trailHooked = false; 
var trailWorks = false;  
var dodgeUntil = 0; 
var dodgePoint = null; 
var wallHits = [];  
var wallCheckedAt = 0; 
var panel = null; 
var panelCtx = null; 
var fishImage = null; 
var fishShotAt = 0;
var menu = null;
var menuCheckedAt = 0; 
var menuShift = 0; 
var aimGraphic = null;  
var aimList = [];  
var aimTicker = null; 
var dotSize = 4; 

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
  walls = null;
  tracked = new WeakMap();
});  

function hookTrail(me) 
{  
  if (trailHooked || me.fadingTrail==null)  
  { 
    return; 
  }  
  hook(Object.getPrototypeOf(me.fadingTrail), "enable",  
  {
    apply(f, th, args)  
    { 
      th.boostedAt = performance.now();  
      trailWorks = true;  
      return reflect.apply(f, th, args); 
    }, 
  });
  trailHooked = true; 
} 

function dodging()  
{ 
  return dodgePoint!=null && performance.now()<dodgeUntil;  
}  

function hookInput()  
{
  var im = game.inputManager;  
  if (im==null || im.dodgeHooked)
  {
    return; 
  }  
  im.dodgeHooked = true; 

  hook(im, "sendMoveToXY", 
  {  
    apply(f, th, args)
    {  
      if (dodging()) 
      {  
        args = [dodgePoint.x, dodgePoint.y, args[2]]; 
      } 
      return reflect.apply(f, th, args);  
    }, 
  });

  hook(im, "getMouseWorldPosition",  
  {  
    apply(f, th, args)
    {
      var real = reflect.apply(f, th, args); 
      if (!dodging())  
      { 
        return real;
      } 
      if (real!=null && typeof real.clone=="function")  
      { 
        var copy = real.clone();
        copy.x = dodgePoint.x;
        copy.y = dodgePoint.y; 
        return copy;  
      } 
      return { x: dodgePoint.x, y: dodgePoint.y };
    },
  }); 
} 

function number(value, fallback) 
{ 
  if (typeof value=="number" && !isNaN(value))
  { 
    return value;  
  }  
  return fallback;
} 

function clamp(value) 
{ 
  return Math.min(Math.max(value, 0), 1); 
}  

function biteDamage(attacker, target) 
{  
  var level = attacker.fishLevelData;  
  var data = attacker.entityData; 
  var other = target.entityData;  
  if (level==null || data==null || other==null) 
  {  
    return null;  
  } 
  var damage = baseBite * number(level.damageMultiplier, 1) * number(data.damageMultiplier, 1);  
  var baseArmor = target.fishLevelData!=null ? number(target.fishLevelData.damageBlock, 0) : 0;  
  var armor = clamp(number(other.damageBlock, baseArmor * 100) / 100);
  var pierce = clamp(number(data.armorPenetration, number(level.armorPenetration, 0) * 100) / 100); 
  return damage * (1 - armor * (1 - pierce));
}

function healthOf(animal) 
{  
  var data = animal.entityData;  
  if (data==null)  
  { 
    return null;
  }
  var max = null;  
  if (animal.settings!=null && typeof animal.settings.maxHealth=="number")  
  { 
    max = animal.settings.maxHealth; 
  } 
  else if (animal.fishLevelData!=null && typeof animal.fishLevelData.healthMultiplier=="number") 
  {  
    max = animal.fishLevelData.healthMultiplier * 100; 
  }  
  if (max==null)  
  {  
    return null;
  }  
  return max * number(data.hpPercentage, 100) / 100 + number(data.overHealth, 0);
} 

function bitesToKill(attacker, target)  
{ 
  if (target.entityData!=null && (target.entityData.spawnProtected || target.entityData.evolutionProtected))
  { 
    return Infinity;  
  }  
  var damage = biteDamage(attacker, target); 
  var health = healthOf(target);
  if (damage==null || health==null)  
  {
    return null;
  }
  if (damage<=0) 
  { 
    return Infinity;  
  } 
  return Math.max(1, Math.ceil(health / damage));  
}  

function dangerous(me, a) 
{  
  var limit = plugin.getSetting("Danger bites");
  var skipWin = plugin.getSetting("Skip if you win"); 
  if (!(limit>0) && !skipWin)
  { 
    return true;  
  } 
  var theirs = bitesToKill(a, me); 
  if (theirs==null)  
  {
    return true;
  } 
  if (limit>0 && theirs>limit) 
  {
    return false; 
  } 
  if (skipWin) 
  {
    var mine = bitesToKill(me, a); 
    if (mine!=null && mine<theirs)
    {  
      return false;  
    } 
  } 
  return true; 
} 

function aimOf(a)  
{ 
  var data = a.entityData;
  if (data==null || data.moveTarget==null || typeof data.moveTarget.x!="number" || typeof data.moveTarget.y!="number")  
  {  
    return null;
  } 
  var x = data.moveTarget.x - serverPos(a).x;  
  var y = data.moveTarget.y - serverPos(a).y; 
  var len = Math.sqrt(x*x + y*y);  
  if (len<1)  
  { 
    return null;  
  }  
  return { x: x / len, y: y / len, tx: data.moveTarget.x, ty: data.moveTarget.y }; 
} 

function aimingAt(aim, a, mp, minAim)  
{  
  var dx = mp.x - serverPos(a).x;  
  var dy = mp.y - serverPos(a).y;
  var dist = Math.sqrt(dx*dx + dy*dy); 
  if (dist==0)  
  {  
    return false; 
  } 
  return (aim.x * dx + aim.y * dy) / dist >= minAim; 
} 

function serverPos(a)  
{
  if (a.targetPosition!=null && typeof a.targetPosition.x=="number" && typeof a.targetPosition.y=="number")
  {
    return a.targetPosition; 
  }  
  return a.position;  
}  

function velocityOf(a, old, now, p)  
{ 
  var data = a.entityData;  
  if (data!=null && data.velocity!=null && typeof data.velocity[0]=="number" && typeof data.velocity[1]=="number")
  { 
    return { x: data.velocity[0], y: data.velocity[1] }; 
  }  
  if (old==null)
  {
    return null;
  }  
  var dt = (now - old.t) / 1000;
  if (dt<=0 || dt>0.25 || (old.x==p.x && old.y==p.y))
  {
    return old.v; 
  }  
  return { x: (p.x - old.x) / dt, y: (p.y - old.y) / dt }; 
} 

function isBoosting(a, now, speed, base)
{  
  if (a.entityData!=null && (a.entityData.isBoosting==true || a.entityData.justBoost==true)) 
  {  
    return true;  
  }
  if (a.entityData!=null && typeof a.entityData.effects=="number" && (a.entityData.effects & willGrab)!=0)
  { 
    return true;  
  } 
  if (trailWorks) 
  {  
    return a.fadingTrail!=null && a.fadingTrail.boostedAt!=null && now - a.fadingTrail.boostedAt < 400; 
  } 
  return base!=null && speed > base * 2;  
} 

function popup(text) 
{
  try
  { 
    game.currentScene.showMessagePopup(text, 1000, false); 
  } 
  catch {}
} 

var escPause = window.__gaziEscPause;  
if (escPause == null)  
{ 
  escPause = window.__gaziEscPause = { paused: false, parts: [], show: null }; 
  window.addEventListener("keydown", function(event)
  { 
    if (event.code != "Escape" || event.repeat)
    {
      return; 
    }  
    var target = event.target;
    if (target != null && (target.tagName == "INPUT" || target.tagName == "TEXTAREA" || target.isContentEditable)) 
    {  
      return;
    }  
    escPause.paused = !escPause.paused;
    var names = escPause.parts.filter(function(part) { return part.active(); }).map(function(part) { return part.name; }); 
    if (names.length > 0 && escPause.show != null)  
    { 
      escPause.show(names.join(" and ") + (escPause.paused ? " paused (Esc to resume)" : " resumed"));  
    }  
  }, true); 
}  
escPause.parts.push({ name: "Auto dodge", active: function() { return on; } });  
escPause.show = popup;

function terrainKind(t) 
{ 
  var type = t.terrainData.type;
  var collidable = t.settings==null || t.settings.collidable!==false;  
  if (type==skyType)  
  {  
    return "sky";
  } 
  if (type==waterType)  
  {  
    return "water"; 
  } 
  if ((type==floorType || type==islandType || type==underwaterIslandType || type==ceilingType) && collidable) 
  { 
    return "wall";  
  } 
  if (type==null && t.settings!=null && solidLayers.indexOf(t.settings.layerId)!=-1 && collidable)
  {
    return "wall";  
  }  
  return "";
}  

function solidTerrains()  
{ 
  var tm = game.currentScene.terrainManager;  
  if (tm==null || tm.terrains==null) 
  { 
    return [];  
  }  
  if (walls!=null && wallsFrom==tm.terrains && wallsCount==tm.terrains.length && wallsScene==game.currentScene && wallsFirst==tm.terrains[0])
  { 
    return walls;  
  } 
  wallsScene = game.currentScene; 
  wallsFirst = tm.terrains[0];  
  walls = []; 
  skies = [];  
  waters = [];  
  wallsFrom = tm.terrains; 
  wallsCount = tm.terrains.length;  
  for(var i = 0;i<tm.terrains.length;i++)
  { 
    var t = tm.terrains[i]; 
    if (t==null || t.terrainData==null || t.bounds==null || t.terrainData.points==null)  
    {
      continue; 
    } 
    var kind = terrainKind(t);  
    var item = { b: t.bounds, p: t.terrainData.points };
    if (kind=="wall") 
    { 
      walls.push(item); 
    }
    if (kind=="sky") 
    { 
      skies.push(item); 
    }  
    if (kind=="water")
    {  
      waters.push(item);
    } 
  } 
  return walls;
}

function insidePolygon(points, x, y) 
{ 
  var inside = false;  
  for(var i = 0, j = points.length - 1;i<points.length;j = i++)
  { 
    var xi = points[i][0];  
    var yi = points[i][1];
    var xj = points[j][0];  
    var yj = points[j][1]; 
    if (yi==null)  
    { 
      xi = points[i].x;  
      yi = points[i].y;  
      xj = points[j].x;
      yj = points[j].y; 
    }  
    if ((yi>y)!=(yj>y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi)  
    { 
      inside = !inside; 
    }  
  }
  return inside;  
}  

function insideAny(list, x, y) 
{  
  for(var i = 0;i<list.length;i++)  
  { 
    var b = list[i].b; 
    if (x<b.minX || x>b.maxX || y<b.minY || y>b.maxY) 
    { 
      continue;  
    } 
    if (insidePolygon(list[i].p, x, y))  
    {
      return true;
    }  
  }  
  return false;  
} 

function breathesAir(me)
{  
  return me.fishLevelData!=null && me.fishLevelData.breathesInAir==true && me.fishLevelData.breathesInWater!=true; 
} 

function isWall(me, x, y)  
{
  var list = solidTerrains();  
  if (insideAny(list, x, y)) 
  {
    return true;  
  }
  if (plugin.getSetting("Stay in water") && !breathesAir(me) && insideAny(skies, x, y) && !insideAny(waters, x, y)) 
  {
    return true; 
  }  
  return false;
} 

function bodyWidth(me)  
{
  var level = me.fishLevelData;  
  if (level==null) 
  {  
    return 60; 
  } 
  var scale = level.sizeScale!=null ? number(level.sizeScale.x, 1) : 1;  
  return 48 * number(level.sizeMultiplier, 1) * scale; 
} 

function bodyLength(me)  
{ 
  var level = me.fishLevelData; 
  if (level==null) 
  { 
    return 80; 
  } 
  var scale = level.sizeScale!=null ? number(level.sizeScale.y, 1) : 1;
  return 68 * number(level.sizeMultiplier, 1) * scale;  
}

function wallDistance()
{  
  if (!plugin.getSetting("Wall check"))
  { 
    return 0; 
  } 
  if (plugin.getSetting("Ability dodge")) 
  {  
    return abilityReach; 
  }  
  return boostReach;
}

function clearance(me, dirX, dirY, check)  
{
  var half = bodyWidth(me) / 2; 
  var front = bodyLength(me) / 2;  
  var sideX = -dirY * half; 
  var sideY = dirX * half;  
  for(var d = wallStep;d<=check + front;d = d + wallStep)  
  { 
    var x = me.position.x + dirX * d;
    var y = me.position.y + dirY * d;
    if (isWall(me, x, y) || isWall(me, x + sideX, y + sideY) || isWall(me, x - sideX, y - sideY))  
    {  
      return Math.max(0, d - front); 
    } 
  }  
  return check;
}  

function pathClear(me, dirX, dirY)  
{ 
  var check = wallDistance();  
  if (check<=0)
  {  
    return true;
  } 
  try
  {
    return clearance(me, dirX, dirY, check)>=check;
  }
  catch
  {
    return true; 
  } 
}

function pickDirection(me, dirX, dirY) 
{  
  var check = wallDistance(); 
  if (check<=0)  
  {  
    return { x: dirX, y: dirY };
  }  
  var best = null;  
  var bestRoom = 0;
  for(var i = 0;i<=18;i++)
  { 
    var deg = Math.ceil(i / 2) * 15;
    if (i % 2==0)  
    {
      deg = -deg; 
    }
    var r = deg * Math.PI / 180; 
    var x = dirX * Math.cos(r) - dirY * Math.sin(r);  
    var y = dirX * Math.sin(r) + dirY * Math.cos(r);
    var room = check;
    try
    {  
      room = clearance(me, x, y, check); 
    }  
    catch {} 
    if (room>=check)
    {
      return { x: x, y: y };
    }
    if (room>bestRoom)
    { 
      bestRoom = room;
      best = { x: x, y: y };  
    } 
  }
  if (best!=null && bestRoom>=bodyLength(me))  
  {
    return best;  
  }
  return null; 
}

function useAbility(me)  
{ 
  return plugin.getSetting("Ability dodge") && me.fishLevelData!=null && me.fishLevelData.hasSecondaryAbility==true; 
}  

function hasEnergy(me) 
{ 
  if (me.entityData==null || typeof me.entityData.energy!="number")
  {  
    return true; 
  } 
  return me.entityData.energy >= energyPerBoost;
}

function inDash(me)
{ 
  var data = me.entityData; 
  if (data==null || data.velocity==null || typeof data.velocity[0]!="number") 
  { 
    return data!=null && data.justBoost==true;  
  }  
  return Math.sqrt(data.velocity[0]*data.velocity[0] + data.velocity[1]*data.velocity[1]) > freshSpeed; 
} 

function isHeld(me) 
{ 
  return me.holded==true || (me.entityData!=null && me.entityData.holded==true);
}  

function sendBoost(me) 
{  
  try
  {
    if (me._standing || blockyfish.ActionPacket==null)  
    {
      blockyfish.boost(); 
    }
    else
    {  
      game.socketManager.sendBytePacket(blockyfish.encodeBytePacket(gameState.token._value, blockyfish.ActionPacket.Boost, "")); 
    }
  }  
  catch {}
}  

function dodge(me, vx, vy) 
{  
  var mx = serverPos(me).x;  
  var my = serverPos(me).y;
  var len = Math.sqrt(vx*vx + vy*vy); 
  var mode = String(plugin.getSetting("Direction")).toLowerCase().trim(); 
  var mouse = game.inputManager.getMouseWorldPosition();  
  var dirX;
  var dirY;

  if (mode=="mouse")
  {  
    dirX = mouse.x - mx;  
    dirY = mouse.y - my;
    var mlen = Math.sqrt(dirX*dirX + dirY*dirY);
    if (mlen==0) 
    {
      return false;  
    }  
    dirX = dirX / mlen; 
    dirY = dirY / mlen; 
  } 
  else if (mode=="away")
  { 
    dirX = vx / len;  
    dirY = vy / len; 
  }
  else
  {
    dirX = -vy / len;
    dirY = vx / len;  
    if ((mouse.x - mx) * dirX + (mouse.y - my) * dirY < 0)  
    {  
      dirX = -dirX;  
      dirY = -dirY;
    } 
    var tilt = sideAngle * Math.PI / 180;
    dirX = dirX * Math.cos(tilt) + vx / len * Math.sin(tilt);  
    dirY = dirY * Math.cos(tilt) + vy / len * Math.sin(tilt); 
  } 

  var ability = useAbility(me);  
  if (!ability && !hasEnergy(me))  
  { 
    return false;  
  } 

  var dir = pickDirection(me, dirX, dirY); 
  if (dir==null)  
  { 
    return false;  
  }  

  var delay = plugin.getSetting("Turn delay (MS)"); 
  dodgePoint = { x: mx + dir.x * 2000, y: my + dir.y * 2000 };  
  dodgeUntil = performance.now() + delay + 120; 
  game.inputManager.sendMoveToXY(dodgePoint.x, dodgePoint.y, 10000);

  var boost = function() 
  {  
    try
    { 
      if (ability) 
      {  
        blockyfish.chargedBoost(); 
      }
      else
      { 
        sendBoost(me);
      } 
    }
    catch {}
  };

  if (delay>0) 
  {
    setTimeout(boost, delay); 
  } 
  else
  {  
    boost();  
  } 
  return true; 
}

function hidePanel() 
{ 
  if (panel!=null)
  {  
    panel.style.display = "none"; 
  }
  if (menu!=null)  
  {  
    menu.style.translate = "";
  }
  menuShift = 0; 
}

function findMenu()  
{ 
  var names = ["Turn delay (MS)", "Wall check", "Ability dodge"];  
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);  
  var node = walker.nextNode(); 
  while (node!=null)  
  {  
    var el = node.parentElement;
    if (el!=null && names.indexOf(node.nodeValue.trim())!=-1 && el.getBoundingClientRect().width>0) 
    { 
      var box = el;  
      while (box.parentElement!=null && box.parentElement!=document.body && box.parentElement.getBoundingClientRect().width <= window.innerWidth * 0.85)  
      {
        box = box.parentElement;  
      }
      var rect = box.getBoundingClientRect(); 
      if (rect.width<250 || rect.height<150)  
      {
        return null;  
      } 
      return box; 
    }
    node = walker.nextNode();
  } 
  return null;
} 

function watchMenu()
{  
  var now = performance.now(); 
  if (now - menuCheckedAt < 300)  
  {
    return;  
  }  
  menuCheckedAt = now;
  var box = null;
  try
  {  
    box = findMenu();
  }
  catch {} 
  if (box!=menu)  
  { 
    hidePanel(); 
    menu = box;
  }  
}  

function placePanel()
{ 
  var rect = menu.getBoundingClientRect();  
  var left = rect.left - menuShift;
  var shift = Math.max(window.innerWidth - 24 - (rect.right - menuShift), 0);
  var size = Math.floor(Math.min(left + shift - 40, window.innerHeight - 48)); 
  if (size<200)
  { 
    hidePanel();  
    return false; 
  }
  if (shift!=menuShift)
  {  
    menu.style.translate = shift + "px 0px";  
    menuShift = shift; 
  }  
  var top = Math.floor(rect.top + (rect.height - size) / 2); 
  top = Math.max(24, Math.min(top, window.innerHeight - 24 - size)); 

  if (panel==null)  
  { 
    panel = document.createElement("canvas"); 
    panel.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid rgba(255,255,255,0.25);";  
    panelCtx = panel.getContext("2d"); 
  } 
  if (panel.parentNode==null) 
  { 
    document.body.appendChild(panel); 
  } 
  panel.style.display = "block";  
  panel.style.left = Math.floor(left + shift - 16 - size) + "px";  
  panel.style.top = top + "px"; 
  panel.style.width = size + "px";
  panel.style.height = size + "px";
  var pixels = Math.floor(size * (window.devicePixelRatio || 1)); 
  if (panel.width!=pixels) 
  { 
    panel.width = pixels;  
    panel.height = pixels; 
  }
  panelCtx.setTransform(pixels / 300, 0, 0, pixels / 300, 0, 0);  
  return true;
}

function menuOpen()  
{
  return menu!=null && menu.isConnected && menu.getBoundingClientRect().width>0;
} 

function showPanel(me, seen)  
{
  try
  { 
    drawPanel(me, seen);  
  }  
  catch
  { 
    hidePanel();  
  }  
}

function shootFish(me) 
{ 
  if (performance.now() - fishShotAt < 1000)  
  {  
    return;  
  }
  fishShotAt = performance.now(); 
  try
  {  
    var renderer = game.renderer || game.app.renderer;  
    fishImage = renderer.extract.canvas(me); 
  }
  catch
  { 
    fishImage = null; 
  } 
}  

function panelText(g, text, x, y) 
{  
  g.font = "bold 12px sans-serif";
  g.textAlign = "center";  
  g.textBaseline = "middle";
  g.lineWidth = 4;  
  g.strokeStyle = "#000000";  
  g.strokeText(text, x, y); 
  g.fillStyle = "#ffffff";  
  g.fillText(text, x, y); 
} 

function drawPanel(me, seen)
{  
  if (!menuOpen() || !placePanel())  
  {
    hidePanel(); 
    return;  
  }

  var g = panelCtx; 
  var cx = 150;
  var cy = 160; 
  var radius = plugin.getSetting("Radius");  
  var check = wallDistance();
  var s = 110 / Math.max(radius, check, 1); 
  var dx = 1;  
  var dy = 0;

  if (me!=null)  
  { 
    var mouse = game.inputManager.getMouseWorldPosition();  
    var len = Math.sqrt((mouse.x - me.position.x) * (mouse.x - me.position.x) + (mouse.y - me.position.y) * (mouse.y - me.position.y)); 
    if (len>0) 
    {
      dx = (mouse.x - me.position.x) / len;  
      dy = (mouse.y - me.position.y) / len;
    } 
    if (check>0 && performance.now() - wallCheckedAt > 100) 
    {
      wallCheckedAt = performance.now();  
      wallHits = []; 
      for(var step = 1;step<=6;step++) 
      { 
        var hit = false;
        try
        { 
          hit = isWall(me, me.position.x + dx * check * step / 6, me.position.y + dy * check * step / 6); 
        } 
        catch {}  
        wallHits.push(hit);
      }
    }  
    shootFish(me);
  } 

  g.fillStyle = "#0a1423";
  g.fillRect(0, 0, 300, 300); 
  panelText(g, "Auto dodge preview", 150, 16); 

  var cell = 100; 
  while (cell * s < 12)  
  { 
    cell = cell * 2;  
  }  
  g.strokeStyle = "rgba(255,255,255,0.08)"; 
  g.lineWidth = 1;  
  g.beginPath(); 
  for(var gx = cx % (cell * s);gx<300;gx = gx + cell * s)
  {  
    g.moveTo(gx, 30);
    g.lineTo(gx, 300);
  }  
  for(var gy = cy % (cell * s);gy<300;gy = gy + cell * s) 
  {  
    if (gy>30)  
    {
      g.moveTo(0, gy); 
      g.lineTo(300, gy);
    } 
  }
  g.stroke();

  var color = "#999999";  
  if (on)  
  {  
    color = escPause.paused ? "#ffaa33" : "#44ff88";
  } 
  g.strokeStyle = color;  
  g.lineWidth = 3;  
  g.beginPath(); 
  g.arc(cx, cy, radius * s, 0, Math.PI * 2); 
  g.stroke(); 
  panelText(g, "Dodge radius", cx, cy - radius * s - 10); 

  if (plugin.getSetting("Early dodge") && !plugin.getSetting("Boost only"))
  {  
    var earlyDist = plugin.getSetting("Early distance");
    g.strokeStyle = "#ffaa33"; 
    g.lineWidth = 2;
    g.setLineDash([6, 5]);  
    g.beginPath();  
    g.arc(cx, cy, earlyDist * s, 0, Math.PI * 2);  
    g.stroke();  
    g.setLineDash([]); 
    panelText(g, "Early dodge", cx, cy + earlyDist * s + 12);  
  } 

  if (check>0)
  { 
    for(var i = 0;i<6;i++)  
    {
      g.fillStyle = "#44ff88";  
      if (me!=null && wallHits[i])
      {
        g.fillStyle = "#ff4444"; 
      }  
      g.beginPath();
      g.arc(cx + dx * check * s * (i + 1) / 6, cy + dy * check * s * (i + 1) / 6, 3, 0, Math.PI * 2); 
      g.fill();
    } 
    panelText(g, "Wall check", cx + dx * (check * s + 30), cy + dy * (check * s + 14));
  }  

  for(var j = 0;j<seen.length;j++)
  { 
    g.fillStyle = "#ffaa33";
    if (seen[j].hot)  
    {  
      g.fillStyle = "#ff3333";
    } 
    g.beginPath();  
    g.arc(cx + (seen[j].x - serverPos(me).x) * s, cy + (seen[j].y - serverPos(me).y) * s, 5, 0, Math.PI * 2); 
    g.fill();
  } 

  var fw = 30;  
  var fh = 20; 
  if (me!=null && me.width>0 && me.height>0) 
  {  
    fw = Math.max(me.width * s, 24); 
    fh = Math.max(me.height * s, 24); 
  } 
  if (me!=null && fishImage!=null && fishImage.width>0 && fishImage.height>0) 
  {
    var fit = Math.min(fw / fishImage.width, fh / fishImage.height); 
    g.drawImage(fishImage, cx - fishImage.width * fit / 2, cy - fishImage.height * fit / 2, fishImage.width * fit, fishImage.height * fit); 
  }
  else
  {  
    g.fillStyle = "#4fc3ff";  
    g.beginPath(); 
    g.ellipse(cx, cy, fw / 2, fh / 2, 0, 0, Math.PI * 2); 
    g.fill();
  } 
} 

function clearDots()  
{
  aimList = []; 
  if (aimGraphic!=null)  
  {  
    aimGraphic.clear();
  } 
}

function aimLayer()  
{ 
  var scene = game.currentScene;  
  if (scene==null)  
  { 
    return null;
  }  
  if (scene.justAboveAnimalsContainer!=null)  
  { 
    return scene.justAboveAnimalsContainer;
  } 
  return scene;  
}  

function renderAims()  
{ 
  if (aimGraphic==null || aimGraphic.destroyed)
  {  
    return;  
  } 
  aimGraphic.clear(); 
  if (aimList.length==0 || game==null || game.viewport==null) 
  { 
    return;  
  } 
  var zoom = game.viewport.scale!=null && game.viewport.scale.x>0 ? game.viewport.scale.x : 1;  
  var radius = dotSize / zoom;  
  var lines = plugin.getSetting("Aim lines");
  for(var i = 0;i<aimList.length;i++)  
  {  
    var a = aimList[i]; 
    var data = a.entityData;  
    if (a.destroyed || a.position==null || data==null || data.moveTarget==null) 
    { 
      continue;
    }
    var tx = data.moveTarget.x;  
    var ty = data.moveTarget.y;
    if (lines)
    {  
      aimGraphic.lineStyle(1.5 / zoom, 0xff2020, 0.35); 
      aimGraphic.moveTo(a.position.x, a.position.y);  
      aimGraphic.lineTo(tx, ty); 
    } 
    aimGraphic.lineStyle(1 / zoom, 0x000000, 1);
    aimGraphic.beginFill(0xff2020, 1);  
    aimGraphic.drawCircle(tx, ty, radius);
    aimGraphic.endFill(); 
  }  
}  

function drawDots(list)
{ 
  if (!plugin.getSetting("Aim dots") || list.length==0)  
  { 
    clearDots(); 
    return;  
  } 
  var layer = aimLayer(); 
  if (layer==null)  
  {
    clearDots();
    return;
  } 
  if (aimGraphic==null || aimGraphic.destroyed) 
  { 
    aimGraphic = new PIXI.Graphics(); 
  } 
  if (aimGraphic.parent!=layer) 
  {  
    layer.addChild(aimGraphic);  
  } 
  var ticker = game.app!=null ? game.app.ticker : null; 
  if (ticker!=null && aimTicker!=ticker)
  {
    if (aimTicker!=null) 
    { 
      aimTicker.remove(renderAims);
    }  
    ticker.add(renderAims); 
    aimTicker = ticker;  
  }
  aimList = list;  
  if (ticker==null)
  { 
    renderAims();  
  }
} 

function tick()  
{  
  try
  { 
    watchMenu();  
    if (game==null || game.currentScene==null || game.currentScene.myAnimals==null)  
    { 
      showPanel(null, []); 
      clearDots();  
      return;  
    }
    var me = game.currentScene.myAnimals[0];  
    if (me==null || me.position==null || game.inputManager==null) 
    {  
      tracked = new WeakMap();  
      showPanel(null, []); 
      clearDots();
      return;
    } 
    try
    { 
      hookTrail(me);
    } 
    catch {}  
    try
    { 
      hookInput();  
    }  
    catch {}  

    var now = performance.now();
    var animals = game.currentScene.entityManager.animalsList;  
    var radius = plugin.getSetting("Radius"); 
    var minAim = Math.cos(aimTolerance * Math.PI / 180);  
    var earlyMin = Math.cos(earlyAim * Math.PI / 180); 
    var early = plugin.getSetting("Early dodge") && !plugin.getSetting("Boost only"); 
    var earlyDist = plugin.getSetting("Early distance");  
    var threat = null;  
    var threatKind = 0; 
    var threatDist = Infinity;  
    var seen = []; 
    var aims = []; 
    var useAim = plugin.getSetting("Use aim");  
    var mp = serverPos(me); 

    for(var i = 0;i<animals.length;i++)  
    {  
      var a = animals[i];
      if (a==me || a.position==null || (a.id!=null && a.id==me.id) || game.currentScene.myAnimals.includes(a))
      { 
        continue;
      }
      if (Math.abs(serverPos(a).x - serverPos(me).x) < 30 && Math.abs(serverPos(a).y - serverPos(me).y) < 30)  
      { 
        continue; 
      }  
      if (a.fishLevelData!=null && (npcs.includes(a.fishLevelData.fishLevel) || a.fishLevelData.chooseable==false)) 
      {
        continue; 
      }  
      if (a.ally==true || (me.tribeId!=null && a.tribeId==me.tribeId)) 
      { 
        continue; 
      } 

      var p = serverPos(a); 
      var x = p.x;
      var y = p.y;
      var aim = aimOf(a);
      if (aim!=null) 
      {
        aims.push(a);
      }
      var old = tracked.get(a);  
      var v = velocityOf(a, old, now, p);  
      var entry = { x: x, y: y, t: now, v: v, base: old!=null ? old.base : null, hotAt: old!=null ? old.hotAt : 0 }; 
      if (old==null || old.x!=x || old.y!=y || v==null || old.v==null || v.x!=old.v.x || v.y!=old.v.y) 
      { 
        tracked.set(a, entry); 
      }
      else
      {
        entry = old;  
      } 

      var dx = mp.x - x;  
      var dy = mp.y - y;  
      var dist = Math.sqrt(dx*dx + dy*dy); 
      if (dist<=radius)  
      {
        seen.push({ x: x, y: y, hot: now - entry.hotAt < 300 }); 
      }  
      if (v==null || dist==0)  
      { 
        continue;  
      }  

      var total = Math.sqrt(v.x*v.x + v.y*v.y); 
      var boosting = isBoosting(a, now, total, entry.base); 
      var fresh = boosting && total > Math.max(freshSpeed, entry.base!=null ? entry.base * freshRatio : 0);  
      if (!boosting && entry==tracked.get(a) && entry!=old)  
      {  
        if (entry.base==null) 
        {  
          entry.base = total;  
        }
        else
        { 
          entry.base = entry.base * 0.9 + total * 0.1; 
        } 
      } 
      if (total==0)  
      {
        continue; 
      }  

      var heading = (v.x*dx + v.y*dy) / total / dist;  
      var kind = 0;  
      var vx = v.x;  
      var vy = v.y; 
      if (fresh && dist<=radius)  
      {
        if (useAim && aim!=null) 
        { 
          if (aimingAt(aim, a, mp, minAim))
          {
            kind = 2;  
            vx = aim.x * total;
            vy = aim.y * total;  
          } 
        }  
        else if (heading>=minAim) 
        { 
          kind = 2;
        }
      }  
      if (kind==0 && early && aim!=null && total>earlySpeed && heading>=earlyHeading && aimingAt(aim, a, mp, earlyMin))
      {
        if (dist <= earlyDist + Math.max(0, bodyLength(a) / 2 - 50)) 
        {  
          kind = 1;  
          vx = aim.x * total; 
          vy = aim.y * total;  
        } 
      } 
      if (kind==0 || !dangerous(me, a))
      {
        continue;
      }  
      entry.hotAt = now; 
      if (kind>threatKind || (kind==threatKind && dist<threatDist))
      { 
        threatKind = kind;  
        threatDist = dist; 
        threat = { vx: vx, vy: vy }; 
      } 
    }

    showPanel(me, seen); 
    try
    { 
      drawDots(aims);
    } 
    catch
    {  
      clearDots();
    }  

    if (on && !escPause.paused && plugin.getSetting("Escape grabs") && isHeld(me)) 
    {
      if (Date.now() - lastEscape > 800 && hasEnergy(me)) 
      { 
        lastEscape = Date.now();
        sendBoost(me); 
      }  
      return; 
    }  

    if (!on || escPause.paused || threat==null)  
    { 
      return;  
    } 
    if (me.fishLevelData!=null && me.fishLevelData.fishLevel==70)  
    {
      return;  
    }
    if (inDash(me))
    { 
      return;
    }
    if (Date.now() - lastDodge < plugin.getSetting("Cooldown (MS)"))
    {  
      return;  
    } 
    if (dodge(me, threat.vx, threat.vy)) 
    {
      lastDodge = Date.now();  
    }  
  }  
  catch {} 
}

setInterval(tick, 10);  

plugin.onKeybindDown("Toggle dodge", function()  
{ 
  if (game==null || game.currentScene==null || held) 
  { 
    return; 
  }
  held = true;
  on = !on;  
  if (on) 
  {
    popup("Auto dodge has been enabled");  
  }  
  else
  {
    popup("Auto dodge has been disabled");  
  }  
}); 

plugin.onKeybindUp("Toggle dodge", function()  
{ 
  held = false;
});

if (window.__gaziStatus != null) 
{  
  window.__gaziStatus.parts.push({ name: "Auto dodge", active: function() { return on; } });  
} 
