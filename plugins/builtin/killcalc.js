// @name Kill calc
// @id killcalc
// @description Shows next to every animal's name how many bites you need to kill it (⚔) and how many bites it needs to kill you (☠) when you both keep biting. Uses the exact stats the server sends (damage, armor, armor penetration, reflection, life steal, over health) and the damage and health bonus of their skin. Press the keybind to toggle.
// @author akgazii⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠
// @tags visual, gameplay, client-side

plugin.registerKeybind("Toggle kill info", "KeyI"); 

var game;
var on = true;
var held = false;
var baseBite = 20;  
var tagYou = "ky" + Math.random().toString(36).slice(2, 6);  
var tagThem = "kt" + Math.random().toString(36).slice(2, 6);
var youStyle = { fill: "#7dff8a", fontSize: 34, fontWeight: "bold" }; 
var themStyle = { fill: "#ff6b6b", fontSize: 34, fontWeight: "bold" }; 
var skinStats = {}; 
var skinsLoaded = false; 
var stripper = new RegExp("\\s*<(" + tagYou + "|" + tagThem + ")>[^<]*</(" + tagYou + "|" + tagThem + ")>", "g");  

blockyfish.addEventListener("gameInit", function(e) 
{  
  game = e.game;  
  loadSkins();
}); 

function loadSkins()  
{ 
  if (skinsLoaded)
  {  
    return;  
  } 
  skinsLoaded = true;  
  fetch("https://api.deeeep.io/skins").then(function(r)  
  {
    return r.json(); 
  }).then(function(list)
  { 
    for(var i = 0;i<list.length;i++)  
    {  
      if (list[i]!=null && list[i].attributes)  
      { 
        skinStats[list[i].id] = parseAttributes(list[i].attributes);  
      }  
    } 
  }).catch(function()
  {
    skinsLoaded = false; 
  });
} 

function parseAttributes(text) 
{  
  var out = { DM: 0, HM: 0 };
  var parts = String(text).split(";"); 
  for(var i = 0;i<parts.length;i++)  
  {  
    var pair = parts[i].split("=");  
    if (pair.length==2 && (pair[0]=="DM" || pair[0]=="HM"))  
    { 
      var value = parseFloat(pair[1]);  
      if (!isNaN(value) && Math.abs(value)<1000) 
      { 
        out[pair[0]] = value;  
      }  
    } 
  }  
  return out; 
} 

function skinBonus(animal)  
{ 
  if (animal.skin!=null && animal.skin.attributes)  
  {
    return parseAttributes(animal.skin.attributes);  
  } 
  var id = animal.skinId!=null ? animal.skinId : (animal.entityData!=null ? animal.entityData.skinId : null);  
  if (id!=null && skinStats[id]!=null) 
  { 
    return skinStats[id];
  }
  return { DM: 0, HM: 0 };  
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
  var damage = baseBite * (number(level.damageMultiplier, 1) + skinBonus(attacker).DM) * number(data.damageMultiplier, 1);
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
  if (animal.fishLevelData!=null && typeof animal.fishLevelData.healthMultiplier=="number") 
  {  
    max = (animal.fishLevelData.healthMultiplier + skinBonus(animal).HM) * 100;  
  } 
  else if (animal.settings!=null && typeof animal.settings.maxHealth=="number")  
  {  
    max = animal.settings.maxHealth; 
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
  var back = biteDamage(target, attacker);  
  var health = healthOf(target);  
  if (damage==null || health==null)  
  {  
    return null; 
  }
  if (back==null)  
  {
    back = 0;
  }
  var reflect = clamp(number(attacker.entityData.damageReflection, 0) / 100);
  var steal = clamp(number(target.entityData.lifeSteal, 0) / 100);
  var loss = damage + reflect * back - steal * back; 
  if (loss<=0) 
  {  
    return Infinity;  
  }
  return Math.max(1, Math.ceil(health / loss)); 
}  

function label(count) 
{ 
  if (count==null)  
  { 
    return "?";  
  }  
  if (count==Infinity) 
  {  
    return "-"; 
  } 
  if (count>99)  
  { 
    return "99+";
  } 
  return String(count);  
}

function writeName(animal, extra) 
{ 
  var name = animal.nameObject; 
  if (name==null || typeof name.text!="string" || name.textStyles==null)
  { 
    return; 
  } 
  if (extra!="" && name.textStyles[tagYou]==null)
  {  
    name.textStyles[tagYou] = youStyle;  
    name.textStyles[tagThem] = themStyle; 
  } 
  var plain = name.text.replace(stripper, "");
  stripper.lastIndex = 0;
  var found = stripper.exec(name.text); 
  stripper.lastIndex = 0;
  var at = found!=null ? found.index : plain.length; 
  var next = plain.slice(0, at) + extra + plain.slice(at);  
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
  var scene = game.currentScene;  
  var me = scene.myAnimals!=null ? scene.myAnimals[0] : null;  
  var animals = scene.entityManager.animalsList; 
  if (animals==null) 
  {
    return;  
  }  
  for (var i = 0;i<animals.length;i++)
  {
    var a = animals[i];  
    if (a==null || a==me || (scene.myAnimals!=null && scene.myAnimals.includes(a))) 
    {
      continue;
    }  
    try
    {  
      if (!on || me==null || me.entityData==null || a.ally==true) 
      { 
        writeName(a, "");
        continue; 
      }
      var mine = bitesToKill(me, a); 
      var theirs = bitesToKill(a, me);  
      writeName(a, " <" + tagYou + ">⚔" + label(mine) + "</" + tagYou + "> <" + tagThem + ">☠" + label(theirs) + "</" + tagThem + ">"); 
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
}, 250);  

plugin.onKeybindDown("Toggle kill info", function() 
{ 
  if (held)  
  {
    return; 
  }
  held = true;  
  on = !on;  
  try
  { 
    if (on)  
    { 
      game.currentScene.showMessagePopup("Kill info has been enabled", 1000, false); 
    }  
    else
    {
      game.currentScene.showMessagePopup("Kill info has been disabled", 1000, false);
    } 
  }
  catch (e) 
  {  
  }
}); 

plugin.onKeybindUp("Toggle kill info", function() 
{ 
  held = false;
}); 

if (window.__gaziStatus != null) 
{
  window.__gaziStatus.parts.push({ name: "Kill calc", active: function() { return on; } }); 
}  
