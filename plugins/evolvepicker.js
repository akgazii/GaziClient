// @name Evolve picker
// @id evolvepicker
// @description Press the panel key to see every animal by tier and click one to try evolving into it, even if it is not in your options. Or set a target animal and press the quick key.
// @author akgazii
// @tags gameplay, server-side

plugin.registerKeybind("Toggle panel", "KeyT");
plugin.registerKeybind("Evolve to target", "Numpad3");

plugin.registerSetting({
  name: "Target animal",
  description: "animal name for the quick key, like Orca or ThresherShark",
  type: "string",
  defaultValue: "",
});
plugin.registerSetting({
  name: "Only my tier and next",
  description: "only show animals from your tier and the next tier in the panel",
  type: "boolean",
  defaultValue: false,
});

var game;
var panel = null;
var list = null;
var info = null;
var search = null;
var nearChip = null;
var panelHeld = false;
var quickHeld = false;
var animalNames = {};
var assetNames = {};
var assetsLoading = false;

for (var key in blockyfish.Animals)
{
  animalNames[blockyfish.Animals[key]] = key;
}

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

function myAnimal()
{
  if (game==null || game.currentScene==null || game.currentScene.myAnimals==null)
  {
    return null;
  }
  return game.currentScene.myAnimals[0];
}

function fishData()
{
  try
  {
    var stats = gameState.serverStats._value || gameState.serverStats;
    return stats.fishLevelsData;
  }
  catch {}
  return null;
}

function evolveTo(id)
{
  if (game==null || game.socketManager==null)
  {
    popup("Join a game first");
    return;
  }
  var me = myAnimal();
  var before = me!=null && me.fishLevelData!=null ? me.fishLevelData.fishLevel : null;
  game.socketManager.sendStringPacket(JSON.stringify({ p: blockyfish.GeneralPacket.Evolution, e: id }));
  setTimeout(function()
  {
    var now = myAnimal();
    var after = now!=null && now.fishLevelData!=null ? now.fishLevelData.fishLevel : null;
    var text = "";
    if (after==id)
    {
      text = "Evolved to " + animalNames[id];
    }
    else
    {
      text = "Server said no to " + animalNames[id];
    }
    popup(text);
    if (info!=null)
    {
      info.innerText = text + "  (before: " + (animalNames[before] || "none") + ", now: " + (animalNames[after] || "none") + ")";
    }
  }, 1500);
}

function quickEvolve()
{
  var name = String(plugin.getSetting("Target animal")).replace(/\s+/g, "").toLowerCase();
  if (name=="")
  {
    popup("Set a target animal in the plugin settings");
    return;
  }
  for (var key in blockyfish.Animals)
  {
    if (key.toLowerCase()==name)
    {
      evolveTo(blockyfish.Animals[key]);
      return;
    }
  }
  popup("No animal called " + plugin.getSetting("Target animal"));
}

function loadAssetNames()
{
  if (assetsLoading || Object.keys(assetNames).length>0)
  {
    return;
  }
  assetsLoading = true;
  fetch("https://api.deeeep.io/animals").then(function(response)
  {
    return response.json();
  }).then(function(animals)
  {
    for(var i = 0;i<animals.length;i++)
    {
      assetNames[animals[i].id] = animals[i].name;
    }
    assetsLoading = false;
    if (panel!=null && panel.style.display=="flex")
    {
      fillPanel();
    }
  }, function()
  {
    assetsLoading = false;
  });
}

function prettyName(id)
{
  var name = animalNames[id];
  if (name==null && assetNames[id]!=null)
  {
    name = assetNames[id].charAt(0).toUpperCase() + assetNames[id].slice(1);
  }
  if (name==null)
  {
    name = "#" + id;
  }
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function pictureFor(id)
{
  if (assetNames[id]==null)
  {
    return "";
  }
  return "/assets/characters/" + assetNames[id] + ".png";
}

function addStyle()
{
  if (document.getElementById("gz-evolve-style")!=null)
  {
    return;
  }
  var style = document.createElement("style");
  style.id = "gz-evolve-style";
  style.textContent = ""
    + ".gz-evo{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(760px,92vw);height:min(640px,86vh);z-index:2147483600;display:none;flex-direction:column;padding:14px;color:#F1EAF0;font:13px 'Segoe UI',Tahoma,sans-serif;border-style:solid;border-width:0;border-image:var(--gz-f-plum) 8 fill / 8px stretch;image-rendering:pixelated;background:transparent;}"
    + ".gz-evo-head{display:flex;align-items:center;gap:10px;padding:0 0 10px 0;border-bottom:4px solid #2A152D;}"
    + ".gz-evo-title{font-weight:800;font-size:15px;letter-spacing:1px;text-shadow:1px 1px 0 rgba(3,2,6,.6);flex:none;}"
    + ".gz-evo-search{flex:1;padding:9px 12px;color:#F1EAF0;font:inherit;outline:none;border-style:solid;border-width:0;border-image:var(--gz-f-wine) 8 fill / 8px stretch;background:transparent;}"
    + ".gz-evo-chip{padding:8px 12px;color:#C4B6C2;font:inherit;font-size:12px;font-weight:700;cursor:pointer;border-style:solid;border-width:0;border-image:var(--gz-f-wine) 8 fill / 8px stretch;background:transparent;}"
    + ".gz-evo-chip.on{color:#F1EAF0;border-image-source:var(--gz-f-indigo);}"
    + ".gz-evo-x{width:36px;height:36px;color:#F1EAF0;font:inherit;font-weight:700;cursor:pointer;border-style:solid;border-width:0;border-image:var(--gz-f-red) 8 fill / 8px stretch;background:transparent;}"
    + ".gz-evo-info{padding:8px 2px;color:#C9D6F2;min-height:18px;}"
    + ".gz-evo-list{flex:1;overflow-y:auto;padding:2px;scrollbar-color:#794E6D #2A152D;}"
    + ".gz-evo-tier{margin:10px 0 6px 0;font-weight:800;font-size:12px;letter-spacing:2px;color:#F3C9E6;text-transform:uppercase;text-shadow:1px 1px 0 rgba(3,2,6,.6);}"
    + ".gz-evo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;}"
    + ".gz-evo-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px 8px 6px;cursor:pointer;color:#F1EAF0;font:inherit;border-style:solid;border-width:0;border-image:var(--gz-f-plum2) 8 fill / 8px stretch;background:transparent;}"
    + ".gz-evo-card:hover{border-image-source:var(--gz-f-plum3);}"
    + ".gz-evo-card:active{transform:translateY(2px);}"
    + ".gz-evo-card.offered{border-image-source:var(--gz-f-blue);}"
    + ".gz-evo-card.offered:hover{border-image-source:var(--gz-f-sky);}"
    + ".gz-evo-card.mine{border-image-source:var(--gz-f-red);}"
    + ".gz-evo-card img{width:56px;height:64px;object-fit:contain;filter:drop-shadow(2px 2px 0 rgba(3,2,6,.5));}"
    + ".gz-evo-card span{font-size:11px;font-weight:700;text-align:center;line-height:1.15;text-shadow:1px 1px 0 rgba(3,2,6,.6);}"
    + ".gz-evo-empty{padding:30px;text-align:center;color:#C4B6C2;}";
  document.head.appendChild(style);
}

function makePanel()
{
  addStyle();
  panel = document.createElement("div");
  panel.className = "gz-evo";
  var head = document.createElement("div");
  head.className = "gz-evo-head";
  var title = document.createElement("div");
  title.className = "gz-evo-title";
  title.innerText = "EVOLVE";
  search = document.createElement("input");
  search.className = "gz-evo-search";
  search.placeholder = "Search animals...";
  search.spellcheck = false;
  search.oninput = function()
  {
    fillPanel();
  };
  nearChip = document.createElement("button");
  nearChip.className = "gz-evo-chip";
  nearChip.innerText = "My tier + next";
  nearChip.onclick = function()
  {
    plugin.setSetting("Only my tier and next", !plugin.getSetting("Only my tier and next"));
    fillPanel();
  };
  var close = document.createElement("button");
  close.className = "gz-evo-x";
  close.innerText = "✕";
  close.onclick = function()
  {
    panel.style.display = "none";
  };
  head.appendChild(title);
  head.appendChild(search);
  head.appendChild(nearChip);
  head.appendChild(close);
  info = document.createElement("div");
  info.className = "gz-evo-info";
  info.innerText = "Click an animal to evolve. Blue = in your options, red = you.";
  list = document.createElement("div");
  list.className = "gz-evo-list";
  panel.appendChild(head);
  panel.appendChild(info);
  panel.appendChild(list);
  var stop = ["keydown", "keyup", "mousedown", "mouseup", "pointerdown", "pointerup", "wheel", "click", "contextmenu"];
  for(var i = 0;i<stop.length;i++)
  {
    panel.addEventListener(stop[i], function(event)
    {
      event.stopPropagation();
    });
  }
  document.body.appendChild(panel);
}

function fillPanel()
{
  list.innerHTML = "";
  var onlyNear = plugin.getSetting("Only my tier and next");
  nearChip.className = "gz-evo-chip" + (onlyNear ? " on" : "");
  var data = fishData();
  if (data==null)
  {
    var empty = document.createElement("div");
    empty.className = "gz-evo-empty";
    empty.innerText = "Animal data is not loaded yet, join a game first.";
    list.appendChild(empty);
    return;
  }
  var me = myAnimal();
  var myTier = me!=null && me.fishLevelData!=null ? me.fishLevelData.level : null;
  var myId = me!=null && me.fishLevelData!=null ? me.fishLevelData.fishLevel : null;
  var query = search.value.trim().toLowerCase().replace(/\s+/g, "");
  var options = [];
  try
  {
    options = gameState.choices.value.options || [];
  }
  catch {}
  var tiers = {};
  for (var id in data)
  {
    var fish = data[id];
    if (fish==null || fish.chooseable!=true)
    {
      continue;
    }
    if (onlyNear && myTier!=null && fish.level!=myTier && fish.level!=myTier + 1)
    {
      continue;
    }
    if (query!="" && prettyName(id).toLowerCase().replace(/\s+/g, "").indexOf(query)==-1)
    {
      continue;
    }
    if (tiers[fish.level]==null)
    {
      tiers[fish.level] = [];
    }
    tiers[fish.level].push(Number(id));
  }
  var shown = 0;
  for (var tier = 0;tier<=10;tier++)
  {
    if (tiers[tier]==null)
    {
      continue;
    }
    var head = document.createElement("div");
    head.className = "gz-evo-tier";
    head.innerText = "Tier " + (tier + 1) + (tier==myTier ? "  • you" : "");
    list.appendChild(head);
    var grid = document.createElement("div");
    grid.className = "gz-evo-grid";
    tiers[tier].sort(function(a, b) { return prettyName(a).localeCompare(prettyName(b)); });
    for(var i = 0;i<tiers[tier].length;i++)
    {
      var animal = tiers[tier][i];
      grid.appendChild(makeButton(animal, options.indexOf(animal)!=-1, animal==myId));
      shown++;
    }
    list.appendChild(grid);
  }
  if (shown==0)
  {
    var none = document.createElement("div");
    none.className = "gz-evo-empty";
    none.innerText = "No animal found.";
    list.appendChild(none);
  }
}

function makeButton(id, offered, mine)
{
  var button = document.createElement("button");
  button.className = "gz-evo-card" + (offered ? " offered" : "") + (mine ? " mine" : "");
  button.title = prettyName(id);
  var picture = pictureFor(id);
  if (picture!="")
  {
    var image = document.createElement("img");
    image.src = picture;
    image.loading = "lazy";
    image.draggable = false;
    button.appendChild(image);
  }
  var label = document.createElement("span");
  label.innerText = prettyName(id);
  button.appendChild(label);
  button.onclick = function()
  {
    evolveTo(id);
  };
  return button;
}

function togglePanel()
{
  loadAssetNames();
  if (panel==null)
  {
    makePanel();
  }
  if (panel.style.display!="flex")
  {
    fillPanel();
    panel.style.display = "flex";
  }
  else
  {
    panel.style.display = "none";
  }
}

plugin.onKeybindDown("Toggle panel", function()
{
  if (panelHeld)
  {
    return;
  }
  panelHeld = true;
  togglePanel();
});

plugin.onKeybindUp("Toggle panel", function()
{
  panelHeld = false;
});

plugin.onKeybindDown("Evolve to target", function()
{
  if (quickHeld)
  {
    return;
  }
  quickHeld = true;
  quickEvolve();
});

plugin.onKeybindUp("Evolve to target", function()
{
  quickHeld = false;
});
