var nativeReflect = {};
var reflectNames = Object.getOwnPropertyNames(Reflect);
for(var i = 0;i<reflectNames.length;i++) 
{  
	nativeReflect[reflectNames[i]] = Reflect[reflectNames[i]];  
} 
var nativeSetTimeout = window.setTimeout.bind(window);
var nativeClearTimeout = window.clearTimeout.bind(window); 
var nativePost = window.ipc ? window.ipc.postMessage.bind(window.ipc) : null; 
// set by the Android app before this script runs
var gaziMobile = window.__gaziMobile === true;

var ipcSeq = 1;
var ipcWaiting = {}; 
var eventHandlers = {};  

function ipcCall(cmd, args) 
{  
	return new Promise(function(resolve, reject)  
	{ 
		if (nativePost == null)  
		{ 
			reject("ipc unavailable");  
			return;
		}
		var id = ipcSeq++;  
		ipcWaiting[id] = { resolve: resolve, reject: reject }; 
		nativePost(JSON.stringify({ id: id, cmd: cmd, args: args || {} }));  
	});  
}

window.__gaziReply = function(id, ok, data) 
{ 
	var waiting = ipcWaiting[id];  
	if (waiting == null)  
	{
		return;  
	} 
	delete ipcWaiting[id];  
	if (ok)  
	{ 
		waiting.resolve(data);
	} 
	else
	{ 
		waiting.reject(data); 
	}  
}; 

window.__gaziEvent = function(name, data)  
{  
	var list = eventHandlers[name] || [];  
	for(var i = 0;i<list.length;i++)
	{
		try
		{  
			list[i](data); 
		}  
		catch (error) 
		{ 
			console.error("[GaziClient]", error);  
		}  
	} 
};

function onEvent(name, handler)
{
	if (eventHandlers[name] == null)  
	{ 
		eventHandlers[name] = [];
	}
	eventHandlers[name].push(handler); 
}  

var hookOriginals = new WeakMap(); 

function hook(target, name, handler)  
{  
	var original = target[name]; 
	if (typeof original != "function")  
	{
		console.warn("[GaziClient] hook target is not a function:", name); 
		return null;
	}
	var proxy = new Proxy(original, handler); 
	hookOriginals.set(proxy, original);  
	try
	{ 
		target[name] = proxy; 
	}
	catch (error)  
	{ 
	} 
	if (target[name] != proxy)
	{ 
		Object.defineProperty(target, name, { value: proxy, writable: true, configurable: true }); 
	}
	return proxy;
} 

function ishooked(fn) 
{
	return hookOriginals.has(fn);
}  

function getnative(fn)
{  
	while (hookOriginals.has(fn)) 
	{ 
		fn = hookOriginals.get(fn); 
	}
	return fn; 
}  

function restore(target, name) 
{
	var fn = target[name];  
	if (!hookOriginals.has(fn))  
	{ 
		return false;  
	} 
	target[name] = getnative(fn);  
	return true;
}

// ---- Live plugin on/off ----
// Every plugin runs inside a scope. While its code runs (its first run, its timers, its event
// listeners, its keybinds, its hooks) the timers, listeners, hooks, DOM nodes and game drawings it
// creates are written down, so turning it off can undo them without reloading the page.
var currentScope = null;  
var pluginScopes = {}; 
var listenerWrappers = new WeakMap();  

function newScope(key)  
{
	return { key: key, timeouts: new Set(), intervals: new Set(), frames: new Set(), listeners: [], hooks: [], nodes: [], drawings: [], disposed: false };
}

function inScope(scope, fn)
{ 
	return function() 
	{  
		if (scope.disposed)  
		{  
			return;
		} 
		var previous = currentScope;
		currentScope = scope;  
		try
		{  
			return fn.apply(this, arguments);
		} 
		finally
		{ 
			currentScope = previous; 
		} 
	};
}  

function runInScope(scope, fn)
{ 
	var previous = currentScope;  
	currentScope = scope;
	try
	{
		return fn();  
	}  
	finally
	{  
		currentScope = previous; 
	}  
} 

function scopedTimer(name, store)
{ 
	hook(window, name,  
	{  
		apply: function(target, self, args) 
		{  
			var scope = currentScope; 
			if (scope == null || typeof args[0] != "function")
			{ 
				return nativeReflect.apply(target, window, args);  
			} 
			var callback = args[0];
			var id = null;  
			args = Array.prototype.slice.call(args);  
			args[0] = inScope(scope, function()
			{ 
				if (store != "intervals")  
				{ 
					scope[store].delete(id); 
				}  
				return callback.apply(this, arguments); 
			}); 
			id = nativeReflect.apply(target, window, args);  
			scope[store].add(id);
			return id; 
		} 
	}); 
} 

scopedTimer("setTimeout", "timeouts");
scopedTimer("setInterval", "intervals"); 
scopedTimer("requestAnimationFrame", "frames"); 

hook(EventTarget.prototype, "addEventListener",  
{
	apply: function(target, self, args)
	{  
		var scope = currentScope; 
		var listener = args[1]; 
		if (scope == null || listener == null || (typeof listener != "function" && typeof listener.handleEvent != "function"))
		{ 
			return nativeReflect.apply(target, self, args);
		}
		var known = listenerWrappers.get(listener); 
		var wrapper = known != null && known.scope == scope ? known.wrapper : null;  
		if (wrapper == null)
		{ 
			wrapper = inScope(scope, function(event)  
			{  
				return typeof listener == "function" ? listener.call(this, event) : listener.handleEvent(event); 
			});  
			listenerWrappers.set(listener, { scope: scope, wrapper: wrapper }); 
		}  
		scope.listeners.push({ target: self, type: args[0], listener: wrapper, options: args[2] });  
		return nativeReflect.apply(target, self, [args[0], wrapper, args[2]]); 
	}  
});  

hook(EventTarget.prototype, "removeEventListener",
{ 
	apply: function(target, self, args) 
	{  
		var known = args[1] != null ? listenerWrappers.get(args[1]) : null;
		if (known != null)  
		{  
			nativeReflect.apply(target, self, [args[0], known.wrapper, args[2]]); 
		}  
		return nativeReflect.apply(target, self, args);  
	}
});

function detachedElements(nodes) 
{
	var list = []; 
	for(var i = 0;i<nodes.length;i++) 
	{ 
		if (nodes[i] instanceof Node && nodes[i].nodeType == 1 && !nodes[i].isConnected)  
		{ 
			list.push(nodes[i]);  
		}  
	}  
	return list;
}

function trackNodes(scope, nodes)  
{ 
	for(var i = 0;i<nodes.length;i++)  
	{ 
		if (nodes[i].isConnected) 
		{  
			scope.nodes.push(nodes[i]);  
		} 
	}  
	if (scope.nodes.length>300) 
	{ 
		scope.nodes = scope.nodes.filter(function(node)  
		{ 
			return node.isConnected;  
		});  
	} 
}  

function scopedInsert(proto, name, firstOnly) 
{
	if (proto == null || typeof proto[name] != "function") 
	{
		return;  
	}
	hook(proto, name, 
	{
		apply: function(target, self, args)
		{ 
			var scope = currentScope;  
			if (scope == null) 
			{ 
				return nativeReflect.apply(target, self, args);
			} 
			var fresh = detachedElements(firstOnly ? [args[0]] : args); 
			var result = nativeReflect.apply(target, self, args);
			trackNodes(scope, fresh); 
			return result;
		} 
	});  
}

scopedInsert(Node.prototype, "appendChild", true);  
scopedInsert(Node.prototype, "insertBefore", true); 
scopedInsert(Element.prototype, "append", false); 
scopedInsert(Element.prototype, "prepend", false); 
scopedInsert(Element.prototype, "before", false); 
scopedInsert(Element.prototype, "after", false);  
scopedInsert(Element.prototype, "insertAdjacentElement", false); 

// The game's PIXI classes are only reachable once the game exists.
var drawingsHooked = false;  

function hookDrawings(game)  
{
	if (drawingsHooked || game == null || game.app == null || game.app.stage == null)
	{ 
		return;  
	} 
	var proto = Object.getPrototypeOf(game.app.stage);
	while (proto != null && !Object.prototype.hasOwnProperty.call(proto, "addChild"))  
	{  
		proto = Object.getPrototypeOf(proto); 
	}  
	if (proto == null)  
	{
		return; 
	} 
	drawingsHooked = true;  
	["addChild", "addChildAt"].forEach(function(name)
	{  
		if (typeof proto[name] != "function")
		{  
			return; 
		}
		hook(proto, name,
		{  
			apply: function(target, self, args)  
			{
				var scope = currentScope; 
				if (scope == null) 
				{ 
					return nativeReflect.apply(target, self, args); 
				}  
				var count = name == "addChildAt" ? 1 : args.length;
				var fresh = []; 
				for(var i = 0;i<count;i++)  
				{
					if (args[i] != null && args[i].parent == null)  
					{  
						fresh.push(args[i]);  
					} 
				}  
				var result = nativeReflect.apply(target, self, args); 
				{ 
					for(var i = 0;i<fresh.length;i++)
					{
						scope.drawings.push(fresh[i]);  
					}
					if (scope.drawings.length>300)  
					{ 
						scope.drawings = scope.drawings.filter(function(child)  
						{ 
							return child.parent != null && !child.destroyed;
						}); 
					}
				}  
				return result; 
			}  
		});  
	});
} 

// tools.hook for one plugin: the hook goes transparent once the plugin is off, and is taken out
// completely when nothing was hooked on top of it.
function scopedHook(scope)  
{ 
	return function(target, name, handler)
	{
		var traps = {}; 
		var guard = new Proxy(handler, {  
			get: function(handlerTarget, trap) 
			{ 
				if (scope.disposed)  
				{
					return undefined; 
				} 
				var fn = handlerTarget[trap]; 
				if (typeof fn != "function") 
				{ 
					return fn; 
				}
				if (traps[trap] == null || traps[trap].fn != fn)  
				{  
					traps[trap] = { fn: fn, run: inScope(scope, function() { return fn.apply(handlerTarget, arguments); }) };
				} 
				return traps[trap].run; 
			} 
		}); 
		var proxy = hook(target, name, guard);  
		if (proxy != null) 
		{  
			scope.hooks.push({ target: target, name: name, proxy: proxy });  
		} 
		return proxy;
	};  
}

function disposeScope(scope)
{ 
	if (scope == null || scope.disposed)  
	{  
		return; 
	}  
	scope.disposed = true;
	scope.timeouts.forEach(function(id) { nativeClearTimeout(id); });
	scope.intervals.forEach(function(id) { window.clearInterval(id); });  
	scope.frames.forEach(function(id) { window.cancelAnimationFrame(id); });
	for(var i = 0;i<scope.listeners.length;i++)
	{
		var item = scope.listeners[i]; 
		try
		{
			item.target.removeEventListener(item.type, item.listener, item.options); 
		}
		catch (error)  
		{  
		}  
	}
	for(var i = scope.hooks.length - 1;i>=0;i--) 
	{  
		var item = scope.hooks[i];
		try
		{  
			if (item.target[item.name] === item.proxy) 
			{ 
				item.target[item.name] = hookOriginals.get(item.proxy); 
			} 
		}
		catch (error)  
		{ 
		}  
	}
	for(var i = 0;i<scope.nodes.length;i++)  
	{  
		var node = scope.nodes[i];  
		if (node.isConnected && node != document.body && node != document.head && node != document.documentElement) 
		{  
			node.remove();
		}
	}
	for(var i = 0;i<scope.drawings.length;i++) 
	{ 
		var child = scope.drawings[i];
		try
		{  
			if (child.parent != null && !child.destroyed)
			{  
				child.parent.removeChild(child);
			} 
		}  
		catch (error) 
		{ 
		}
	}  
	scope.timeouts.clear(); 
	scope.intervals.clear();
	scope.frames.clear();  
	scope.listeners = [];  
	scope.hooks = [];
	scope.nodes = []; 
	scope.drawings = [];
}  

// Shared by GaziClient's own plugins: Esc pauses their automatic actions, and when a match starts
// one message says which of their features are on. Plugins push { name, active } into `parts`.
function ownedList() 
{ 
	var list = [];  
	list.push = function(item) 
	{ 
		if (item != null && currentScope != null)  
		{ 
			item.owner = currentScope.key; 
		}
		return Array.prototype.push.call(this, item); 
	};
	return list; 
} 

function gamePopup(text, ms) 
{  
	try
	{  
		currentGame().currentScene.showMessagePopup(text, ms || 1500, false); 
	} 
	catch (error) 
	{ 
	}
}  

var escPause = window.__gaziEscPause = { paused: false, parts: ownedList(), show: null };
var featureStatus = window.__gaziStatus = { parts: ownedList(), missing: 999, present: 0, pending: false }; 

nativeWindowListener("keydown", function(event)  
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
	// Esc on the menu, the death screen or while rejoining is not a pause
	var game = currentGame();  
	var scene = game != null ? game.currentScene : null; 
	if (scene == null || scene.myAnimals == null || scene.myAnimals[0] == null) 
	{  
		return;
	}  
	var names = activeParts(escPause.parts);  
	if (names.length == 0) 
	{
		escPause.paused = false;  
		return;  
	} 
	escPause.paused = !escPause.paused;
	gamePopup(t(escPause.paused ? "{0} paused (Esc to resume)" : "{0} resumed", names.join(t(" and "))));
}); 

function nativeWindowListener(type, listener) 
{ 
	var previous = currentScope;  
	currentScope = null; 
	window.addEventListener(type, listener, true);  
	currentScope = previous;  
}

function activeParts(parts)
{  
	var names = [];  
	for(var i = 0;i<parts.length;i++)
	{
		var part = parts[i]; 
		var entry = pluginData[part.owner];  
		if (part.owner != null && (pluginScopes[part.owner] == null || entry == null || !entry.enabled)) 
		{ 
			continue;  
		}  
		try
		{ 
			if (part.active())  
			{
				names.push(part.name);
			} 
		} 
		catch (error)  
		{ 
		}  
	}  
	return names; 
}  

function forgetParts(key) 
{
	[escPause.parts, featureStatus.parts].forEach(function(parts) 
	{  
		for(var i = parts.length - 1;i>=0;i--) 
		{ 
			if (parts[i].owner == key)  
			{ 
				parts.splice(i, 1);
			} 
		} 
	}); 
} 

// Called every half second: when a new match starts, say which features are on.
function announceFeatures()
{
	// A new life is your animal showing up after being gone for at least a second (game start, rejoin, 
	// respawn). Evolving swaps the animal faster than that, so it does not count.
	var game = currentGame();  
	var scene = game != null ? game.currentScene : null;
	var alive = scene != null && scene.myAnimals != null && scene.myAnimals[0] != null;  
	if (!alive) 
	{
		featureStatus.missing++; 
		featureStatus.present = 0; 
		return; 
	}  
	if (featureStatus.missing >= 2) 
	{  
		featureStatus.pending = true;  
		// a new match always starts unpaused
		escPause.paused = false;
	} 
	featureStatus.missing = 0;
	featureStatus.present++;  
	// wait one more tick so the game's popup is ready
	if (!featureStatus.pending || featureStatus.present < 2) 
	{  
		return;
	}  
	featureStatus.pending = false;
	var names = activeParts(featureStatus.parts);
	if (names.length>0) 
	{  
		gamePopup(t(names.length == 1 ? "{0} is enabled" : "{0} are enabled", names.join(", ")), 3000);  
	} 
} 

var vueApp = null;  
var gameStore = null;  
var currentGameObject = null;  
var stateRefs = {}; 
var stateAliases = { token: "guToken" };  

function findVueApp()
{
	var nodes = document.querySelectorAll("#app, body > div");  
	for(var i = 0;i<nodes.length;i++) 
	{ 
		if (nodes[i].__vue_app__ != null) 
		{
			return nodes[i].__vue_app__; 
		}  
	} 
	return null;  
}

function findStores()  
{  
	if (gameStore != null)  
	{ 
		return true;
	}  
	vueApp = findVueApp(); 
	if (vueApp == null) 
	{  
		return false;  
	} 
	var props = vueApp.config.globalProperties;  
	var simple = props.$simpleState; 
	if (simple != null && simple.states != null) 
	{  
		for(var i = 0;i<simple.states.length;i++) 
		{  
			var state = simple.states[i];
			if (state != null && state.$state != null && "gameManager" in state.$state)  
			{ 
				gameStore = state;
			}  
		} 
	} 
	var pinia = props.$pinia;  
	if (gameStore == null && pinia != null && pinia._s != null) 
	{ 
		pinia._s.forEach(function(store)  
		{
			if (store.$state != null && "gameManager" in store.$state) 
			{ 
				gameStore = store; 
			} 
		}); 
	}
	return gameStore != null; 
}  

function makeRef(name)
{  
	if (stateRefs[name] != null) 
	{ 
		return stateRefs[name]; 
	} 
	var ref = {};
	Object.defineProperty(ref, "value",  
	{ 
		get: function()  
		{  
			return gameStore ? gameStore[name] : undefined; 
		},  
		set: function(value) 
		{  
			if (gameStore)  
			{ 
				gameStore[name] = value;  
			}  
		} 
	}); 
	Object.defineProperty(ref, "_value", { get: function() { return ref.value; } });  
	Object.defineProperty(ref, "_rawValue", { get: function() { return ref.value; } });  
	stateRefs[name] = ref;  
	return ref; 
}  

var gameState = new Proxy({},  
{ 
	get: function(target, key) 
	{
		if (typeof key != "string") 
		{ 
			return undefined;  
		} 
		if (key == "$store")  
		{  
			return gameStore;  
		}
		return makeRef(stateAliases[key] || key);
	}
});  

function currentGame() 
{  
	return gameStore ? gameStore.gameManager : null;
} 

var pixiCache = {};

function walkStage(root, visit)
{ 
	var stack = [root];  
	var seen = 0;  
	while (stack.length>0 && seen<6000) 
	{
		var node = stack.pop();  
		seen++;
		if (node == null)
		{
			continue;
		} 
		visit(node); 
		if (node.children != null)  
		{
			for(var i = 0;i<node.children.length;i++) 
			{  
				stack.push(node.children[i]);  
			} 
		}  
	} 
} 

function harvestPixi()  
{ 
	var game = currentGame(); 
	if (game == null || game.app == null)
	{  
		return; 
	} 
	var app = game.app; 
	walkStage(app.stage, function(node) 
	{ 
		if (pixiCache.Graphics == null && node.geometry != null && typeof node.beginFill == "function") 
		{
			pixiCache.Graphics = node.constructor;  
		}  
		if (pixiCache.Text == null && typeof node.updateText == "function" && node.style != null)
		{ 
			pixiCache.Text = node.constructor; 
			pixiCache.TextStyle = node.style.constructor;
		} 
		if (pixiCache.Sprite == null && node.texture != null && node.anchor != null && typeof node.updateText != "function" && node.shader == null) 
		{
			pixiCache.Sprite = node.constructor;  
			pixiCache.Texture = node.texture.constructor; 
		}
		if (pixiCache.Mesh == null && node.shader != null && node.geometry != null && "drawMode" in node)  
		{  
			pixiCache.Mesh = node.constructor;
		}
	});
	if (pixiCache.Graphics != null && pixiCache.Container == null) 
	{  
		pixiCache.Container = Object.getPrototypeOf(pixiCache.Graphics.prototype).constructor; 
	}  
	if (pixiCache.Sprite != null && pixiCache.Mesh == null)  
	{ 
		var spriteParent = Object.getPrototypeOf(pixiCache.Sprite.prototype).constructor;  
		if (pixiCache.Container == null)  
		{
			pixiCache.Container = spriteParent;
		} 
	} 
	var batch = app.renderer && app.renderer.plugins ? app.renderer.plugins.batch : null;  
	if (batch != null)  
	{  
		if (pixiCache.Shader == null && batch._shader != null) 
		{  
			pixiCache.Shader = batch._shader.constructor;  
			if (batch._shader.program != null) 
			{
				pixiCache.Program = batch._shader.program.constructor; 
			} 
		}
		if (pixiCache.Geometry == null && batch.geometryClass != null) 
		{  
			pixiCache.Geometry = Object.getPrototypeOf(batch.geometryClass.prototype).constructor;
		}
	} 
	if (pixiCache.Point == null && game.viewport != null && typeof game.viewport.toScreen == "function")  
	{  
		pixiCache.Point = game.viewport.toScreen(0, 0).constructor;  
	}  
	if (pixiCache.ObservablePoint == null && app.stage.position != null) 
	{  
		pixiCache.ObservablePoint = app.stage.position.constructor; 
	} 
	if (pixiCache.Rectangle == null && app.screen != null)  
	{  
		pixiCache.Rectangle = app.screen.constructor; 
	}  
	if (pixiCache.Matrix == null && app.stage.worldTransform != null)
	{ 
		pixiCache.Matrix = app.stage.worldTransform.constructor; 
	}  
	if (pixiCache.Ticker == null && app.ticker != null)
	{
		pixiCache.Ticker = app.ticker.constructor; 
	}
}  

var PIXI = {};  
var pixiNames = ["Graphics", "Text", "TextStyle", "Sprite", "Texture", "Mesh", "Container", "Shader", "Program", "Geometry", "Point", "ObservablePoint", "Rectangle", "Matrix", "Ticker"]; 
for(var i = 0;i<pixiNames.length;i++)
{
	(function(name)  
	{ 
		Object.defineProperty(PIXI, name, 
		{  
			enumerable: true, 
			get: function() 
			{  
				if (pixiCache[name] == null) 
				{ 
					harvestPixi(); 
				}
				return pixiCache[name];
			}
		}); 
	})(pixiNames[i]);
} 

function encodeBytePacket(token, packet, data) 
{
	if (!token)
	{  
		return null;  
	} 
	var head = String.fromCharCode(packet); 
	var encoder = new TextEncoder(); 
	var plain = encoder.encode(head + head + head + (data == null ? "" : String(data))); 
	var key = encoder.encode(token);  
	var binary = ""; 
	for(var i = 0;i<plain.length;i++)
	{  
		binary += String.fromCharCode(plain[i] ^ key[i % key.length]);
	}  
	var body = encoder.encode(btoa(binary));
	var buffer = new ArrayBuffer(body.length + 2); 
	var view = new DataView(buffer);  
	view.setUint8(0, gaziConstants.GeneralPacket.VerifiedAction);
	new Uint8Array(buffer).set(body, 1); 
	view.setUint8(body.length + 1, packet);  
	return buffer;  
}

function sendAction(packet, data) 
{  
	var game = currentGame();  
	var token = gameStore ? gameStore.guToken : null; 
	if (game == null || game.socketManager == null || !token) 
	{  
		return false;  
	}  
	var buffer = encodeBytePacket(token, packet, data); 
	if (buffer == null)  
	{
		return false;  
	} 
	game.socketManager.sendBytePacket(buffer); 
	return true;
} 

function myAnimal() 
{  
	var game = currentGame(); 
	if (game == null || game.currentScene == null || game.currentScene.myAnimals == null)  
	{  
		return null;  
	}  
	return game.currentScene.myAnimals[0] || null; 
}  

function boostFor(ms) 
{ 
	var actions = gaziConstants.ActionPacket;  
	var me = myAnimal();
	var level = me ? me.fishLevelData : null;  
	if (me != null && (me._standing || (level != null && level.hasScalingBoost && ms>30)))
	{ 
		return sendAction(actions.ScalingBoost, ms);  
	} 
	if (level != null && level.hasSecondaryAbility && ms>=100) 
	{
		return sendAction(actions.SecondaryAbility, ms);  
	} 
	return sendAction(actions.Boost, "");  
}  

var blockyfishEvents = new EventTarget(); 
var blockyfish =
{  
	ActionPacket: gaziConstants.ActionPacket, 
	GeneralPacket: gaziConstants.GeneralPacket, 
	RequestPacket: gaziConstants.RequestPacket,  
	Animals: gaziConstants.Animals, 
	Emotes: gaziConstants.Emotes, 
	addEventListener: function(type, listener, options)  
	{
		blockyfishEvents.addEventListener(type, listener, options);
		if (type == "gameInit" && currentGameObject != null) 
		{ 
			var event = new Event("gameInit"); 
			event.game = currentGameObject;
			var scope = currentScope; 
			nativeSetTimeout(function() 
			{ 
				if (scope == null)
				{  
					listener(event);  
				} 
				else
				{ 
					inScope(scope, listener)(event); 
				} 
			}, 0);  
		} 
	},  
	removeEventListener: function(type, listener, options)  
	{
		blockyfishEvents.removeEventListener(type, listener, options); 
	},
	reloadEvolutionOptions: function()  
	{
	},
	boost: function() 
	{
		return boostFor(30);  
	},  
	halfChargedBoost: function() 
	{  
		return boostFor(50);  
	},
	chargedBoost: function() 
	{
		return boostFor(101); 
	},  
	superJump: function()  
	{  
		return sendAction(gaziConstants.ActionPacket.ScalingBoost, 1931897300);
	}, 
	scalingBoost: function(amount)  
	{  
		return sendAction(gaziConstants.ActionPacket.ScalingBoost, amount); 
	},
	sendBoostPacket: function(packetType, amount) 
	{ 
		if (packetType == null) 
		{
			packetType = gaziConstants.ActionPacket.Boost;  
		} 
		if (amount == null)  
		{  
			amount = 0;
		}  
		if (packetType == gaziConstants.ActionPacket.Boost && amount == 0)  
		{ 
			return sendAction(packetType, "");  
		} 
		return sendAction(packetType, amount); 
	},  
	encodeBytePacket: encodeBytePacket
};  

var reactLoaded = false; 
var React = null;  
var ReactDOM = null; 

function loadReact() 
{  
	if (reactLoaded)
	{ 
		return;  
	}  
	reactLoaded = true; 
	var hadReact = window.React;
	var hadReactDom = window.ReactDOM;  
	try
	{
		new Function(gaziVendor.react)();
		React = window.React;
		new Function(gaziVendor.reactDom)(); 
		ReactDOM = window.ReactDOM;
		if (React != null && ReactDOM != null && React.createRoot == null) 
		{
			React.createRoot = ReactDOM.createRoot;
		}  
	}
	catch (error)
	{ 
		console.error("[GaziClient] React failed to load", error); 
	}  
	window.React = hadReact; 
	window.ReactDOM = hadReactDom; 
} 

function reactComponents() 
{
	if (React == null)
	{ 
		return {}; 
	}  
	var h = React.createElement;  
	function DeeeepioButton(props) 
	{ 
		return h("button", Object.assign({}, props, { className: "gz-btn " + (props.className || "") }), props.children); 
	}
	function DeeeepioCustomButton(props)
	{ 
		return DeeeepioButton(props);
	}  
	function DeeeepioTextInput(props)
	{ 
		var copy = Object.assign({}, props, { className: "gz-input " + (props.className || "") });  
		if (typeof props.onChange == "function")  
		{
			copy.onChange = function(event)
			{
				props.onChange(event.target.value, event);
			}; 
		}  
		return h("input", copy);
	} 
	function DeeeepioCheckbox(props)  
	{  
		return h("input", 
		{  
			type: "checkbox",  
			className: "gz-check", 
			checked: !!(props.checked != null ? props.checked : props.value), 
			onChange: function(event)  
			{  
				if (typeof props.onChange == "function")
				{
					props.onChange(event.target.checked, event);  
				} 
			}
		});  
	}  
	function DeeeepioDropdown(props) 
	{ 
		var options = props.options || props.choices || []; 
		return h("select", 
		{  
			className: "gz-input", 
			value: props.value,  
			onChange: function(event)  
			{  
				if (typeof props.onChange == "function")
				{
					props.onChange(event.target.value, event);
				}  
			} 
		}, options.map(function(option)  
		{ 
			var value = option != null && typeof option == "object" ? option.value : option; 
			var label = option != null && typeof option == "object" ? (option.label || option.value) : option;
			return h("option", { key: String(value), value: value }, String(label));  
		}));
	}  
	function DeeeepioLoadingSpinner() 
	{  
		return h("div", { className: "gz-spinner" }); 
	}
	function Modal(props) 
	{  
		var open = props.isOpen != null ? props.isOpen : (props.open != null ? props.open : true);
		if (!open) 
		{  
			return null;  
		} 
		return h("div", { className: "gz-modal-back", onMouseDown: function(event) { if (event.target == event.currentTarget && props.onClose) { props.onClose(); } } },  
			h("div", { className: "gz-modal" },
				props.title ? h("div", { className: "gz-modal-title" }, props.title) : null,
				props.children)); 
	} 
	return {  
		DeeeepioCustomButton: DeeeepioCustomButton, 
		DeeeepioButton: DeeeepioButton, 
		DeeeepioCheckbox: DeeeepioCheckbox,  
		DeeeepioTextInput: DeeeepioTextInput, 
		DeeeepioDropdown: DeeeepioDropdown, 
		DeeeepioLoadingSpinner: DeeeepioLoadingSpinner, 
		Modal: Modal
	}; 
} 

var router =
{
	getCurrent: function() 
	{  
		var r = vueApp ? vueApp.config.globalProperties.$router : null;
		return r ? r.currentRoute.value : null;  
	}, 
	push: function(path) 
	{
		var r = vueApp ? vueApp.config.globalProperties.$router : null; 
		if (r)
		{
			return r.push(path); 
		}  
	}, 
	get router()  
	{  
		return vueApp ? vueApp.config.globalProperties.$router : null; 
	}  
}; 

var capturer =
{  
	screenshot: function()
	{  
		var game = currentGame(); 
		if (game == null || game.app == null)  
		{
			return null;  
		}
		try
		{
			return game.app.renderer.extract.base64(game.app.stage);
		} 
		catch (error) 
		{  
			return null;  
		}
	}  
};

var boot = null; 
var pluginData = {};  
var pluginRuntimes = {};  
var saveTimers = {};
var pressedKeys = {};
var pluginErrors = {}; 

function dataFor(info) 
{
	var entry = pluginData[info.key];
	if (entry == null)
	{ 
		entry = { keybinds: {}, settings: {}, enabled: false, storage: {}, version: info.version, official: info.source != "custom" }; 
		pluginData[info.key] = entry;  
	} 
	if (entry.keybinds == null)  
	{  
		entry.keybinds = {};
	}  
	if (entry.settings == null)
	{  
		entry.settings = {}; 
	}  
	if (entry.storage == null) 
	{ 
		entry.storage = {};  
	}  
	return entry; 
}  

function saveData(key) 
{ 
	if (saveTimers[key] != null)  
	{ 
		nativeClearTimeout(saveTimers[key]);  
	}  
	saveTimers[key] = nativeSetTimeout(function()
	{ 
		delete saveTimers[key];  
		ipcCall("setData", { key: key, value: pluginData[key] || null }).catch(function() 
		{ 
		});
	}, 400);
}  

function makePlugin(info) 
{
	var entry = dataFor(info); 
	var runtime = { info: info, keyDown: {}, keyUp: {}, saveFolder: null };  
	pluginRuntimes[info.key] = runtime; 
	var plugin =
	{ 
		name: info.name,
		registerKeybind: function(name, defaultKey) 
		{
			if (entry.keybinds[name] == null) 
			{
				var recommended = recommendedKeys[info.key];
				entry.keybinds[name] = recommended != null && recommended[name] != null ? recommended[name] : defaultKey;
				saveData(info.key);
			} 
			if (runtime.keyDown[name] == null) 
			{  
				runtime.keyDown[name] = [];  
				runtime.keyUp[name] = []; 
			} 
		}, 
		getKeybind: function(name) 
		{
			return entry.keybinds[name];
		},  
		isKeybindDown: function(name) 
		{  
			var code = entry.keybinds[name];  
			return code != null && pressedKeys[code] == true;
		}, 
		onKeybindDown: function(name, callback)  
		{ 
			if (runtime.keyDown[name] == null)
			{  
				runtime.keyDown[name] = [];  
				runtime.keyUp[name] = []; 
			}  
			runtime.keyDown[name].push(callback);
		},  
		onKeybindUp: function(name, callback)
		{
			if (runtime.keyUp[name] == null)
			{
				runtime.keyDown[name] = [];
				runtime.keyUp[name] = []; 
			} 
			runtime.keyUp[name].push(callback);
		},  
		registerSetting: function(options)
		{
			var old = entry.settings[options.name];
			var value = old != null && old.value !== undefined ? old.value : options.defaultValue;  
			if (options.type == "list" && options.choices != null && options.choices.indexOf(value) == -1)
			{  
				value = options.defaultValue; 
			}  
			entry.settings[options.name] =
			{  
				name: options.name, 
				description: options.description || "", 
				type: options.type,
				value: value, 
				choices: options.choices || []
			}; 
			saveData(info.key);
		},  
		getSetting: function(name) 
		{  
			var setting = entry.settings[name];
			return setting ? setting.value : undefined;  
		},  
		setSetting: function(name, value)  
		{ 
			var setting = entry.settings[name];  
			if (setting == null) 
			{ 
				return;  
			}  
			setting.value = value; 
			saveData(info.key);  
			refreshMenuIfOpen(); 
		}, 
		storage:
		{  
			get: function(key)
			{ 
				return entry.storage[key];
			},  
			set: function(key, value)  
			{ 
				entry.storage[key] = value;  
				saveData(info.key);
			}
		}, 
		getSaveFolder: function()
		{ 
			return runtime.saveFolder;  
		}, 
		setSaveFolder: function(name)
		{ 
			runtime.saveFolder = name;  
		},
		saveFile: function(fileName, content) 
		{
			var folder = runtime.saveFolder != null ? runtime.saveFolder : info.id; 
			return ipcCall("saveFile", { folder: folder, name: fileName, content: String(content) }).then(function()
			{ 
				return true; 
			}, function()
			{ 
				return false; 
			});  
		}  
	};
	Object.freeze(plugin.storage); 
	Object.freeze(plugin); 
	return plugin; 
} 

var pluginParams = ["blockyfish", "plugin", "{hook, getnative, ishooked, restore, reflect, Reflect, Object}", "React", "ReactDOM", "{PIXI, gameState}", "{DeeeepioCustomButton, DeeeepioButton, DeeeepioCheckbox, DeeeepioTextInput, DeeeepioDropdown, DeeeepioLoadingSpinner, Modal}", "Buffer", "ui", "router", "capturer"];  

var deferredPlugins = []; 

// Blockyfish plugins may be written in JSX; Blockyfish compiles them first, so we do too.
var jsxCompiler = null;
var compiledPlugins = {};  

function pluginSource(info)  
{ 
	if (compiledPlugins[info.key] != null && compiledPlugins[info.key].from == info.code)
	{  
		return compiledPlugins[info.key].code; 
	}  
	var code = info.code;  
	try
	{ 
		Function.apply(null, pluginParams.concat([code]));  
	}  
	catch (error)
	{ 
		if (!(error instanceof SyntaxError)) 
		{  
			throw error;  
		}  
		if (jsxCompiler == null)
		{ 
			var holder = {};  
			new Function("window", gaziVendor.jsx)(holder);  
			jsxCompiler = holder.__gaziJsx; 
		}
		code = jsxCompiler(code); 
	} 
	compiledPlugins[info.key] = { from: info.code, code: code }; 
	return code;  
} 

var pluginsLive = false;  
var failedCode = {};  

function stopPlugin(key)
{
	deferredPlugins = deferredPlugins.filter(function(info)  
	{  
		return info.key != key; 
	});  
	disposeScope(pluginScopes[key]); 
	delete pluginScopes[key];
	delete pluginRuntimes[key]; 
	forgetParts(key);  
}  

// Makes the running plugins match what is turned on: starts new ones, stops turned-off ones and
// restarts ones whose code changed. No page reload needed.
function syncPlugins() 
{  
	if (!pluginsLive) 
	{ 
		return;  
	} 
	var known = {};  
	for(var i = 0;i<boot.plugins.length;i++)  
	{ 
		var info = boot.plugins[i];
		known[info.key] = true;  
		var entry = pluginData[info.key];
		var on = entry != null && entry.enabled; 
		var scope = pluginScopes[info.key]; 
		var deferred = deferredPlugins.filter(function(other) { return other.key == info.key; })[0];  
		if (!on) 
		{ 
			if (scope != null || deferred != null)  
			{ 
				stopPlugin(info.key);
			} 
			delete pluginErrors[info.key];
			delete failedCode[info.key]; 
			continue; 
		} 
		if ((scope != null && scope.code === info.code) || (deferred != null && deferred.code === info.code) || failedCode[info.key] === info.code)
		{ 
			continue;
		}  
		runPlugin(info, currentGame() == null);  
	}
	for(var key in pluginScopes) 
	{ 
		if (!known[key]) 
		{ 
			stopPlugin(key);  
		} 
	}
}  

function runPlugin(info, canDefer)  
{ 
	stopPlugin(info.key);
	var scope = newScope(info.key);  
	scope.code = info.code;
	pluginScopes[info.key] = scope; 
	var plugin = makePlugin(info);  
	pluginRuntimes[info.key].scope = scope;  
	if (/\bReact(DOM)?\b|\bDeeeepio|\bModal\b/.test(info.code))
	{
		loadReact(); 
	}  
	var tools = { hook: scopedHook(scope), getnative: getnative, ishooked: ishooked, restore: restore, reflect: nativeReflect, Reflect: Reflect, Object: Object };
	var game = { PIXI: PIXI, gameState: gameState };  
	try
	{ 
		var fn = Function.apply(null, pluginParams.concat([pluginSource(info) + "\n//# sourceURL=gaziclient/" + info.key])); 
		runInScope(scope, function()
		{  
			fn(blockyfish, plugin, tools, React, ReactDOM, game, reactComponents(), undefined, ui, router, capturer);  
		});
		delete pluginErrors[info.key];  
		delete failedCode[info.key]; 
	}
	catch (error)  
	{  
		stopPlugin(info.key);
		if (canDefer && currentGame() == null)
		{ 
			deferredPlugins.push(info);
			console.warn("[GaziClient] plugin " + info.name + " deferred until the game starts:", error);
			return;
		} 
		pluginErrors[info.key] = String(error && error.message ? error.message : error); 
		failedCode[info.key] = info.code; 
		console.error("[GaziClient] plugin " + info.name + " failed:", error);  
		ui.toast.error(info.name + ": " + pluginErrors[info.key]); 
	}
}  

function isTyping(target)
{  
	if (target == null)  
	{  
		return false; 
	}  
	var tag = target.tagName; 
	return tag == "INPUT" || tag == "TEXTAREA" || tag == "SELECT" || target.isContentEditable; 
}  

function fireKeybinds(code, down, event)
{
	for(var key in pluginRuntimes)  
	{
		var runtime = pluginRuntimes[key]; 
		var entry = pluginData[key];  
		if (entry == null) 
		{ 
			continue;  
		} 
		for(var name in entry.keybinds)
		{  
			if (entry.keybinds[name] != code)  
			{ 
				continue;
			}
			var list = down ? runtime.keyDown[name] : runtime.keyUp[name];  
			if (list == null) 
			{ 
				continue;  
			}
			for(var i = 0;i<list.length;i++) 
			{ 
				var previous = currentScope;
				currentScope = runtime.scope || null;  
				try
				{ 
					list[i](event); 
				}
				catch (error) 
				{ 
					console.error("[GaziClient] keybind " + runtime.info.name + "/" + name, error); 
				} 
				finally
				{  
					currentScope = previous;  
				} 
			}
		} 
	}
} 

function keyCodeOf(event)
{ 
	return event.code || event.key;
}

window.addEventListener("keydown", function(event)  
{ 
	var code = keyCodeOf(event);  
	if (capturingKey != null)
	{  
		return; 
	}  
	if (boot != null && code == boot.config.menuKey)
	{ 
		event.preventDefault();  
		event.stopImmediatePropagation();  
		toggleMenu();
		return; 
	}  
	if (code == "F11")  
	{ 
		event.preventDefault(); 
		ipcCall("fullscreen");  
		return;  
	}  
	if (menuOpen || isTyping(event.target))
	{ 
		return;  
	}
	if (event.repeat || pressedKeys[code])  
	{
		return; 
	} 
	pressedKeys[code] = true; 
	fireKeybinds(code, true, event);
}, true);

window.addEventListener("keyup", function(event) 
{  
	var code = keyCodeOf(event); 
	if (!pressedKeys[code])
	{  
		return;
	}  
	delete pressedKeys[code];
	fireKeybinds(code, false, event);  
}, true);

window.addEventListener("blur", function()  
{ 
	for(var code in pressedKeys)  
	{ 
		delete pressedKeys[code]; 
		fireKeybinds(code, false, null);  
	}  
}); 

var toastBox = null;  

function showToast(text, kind, action) 
{ 
	if (document.body == null)
	{
		console.log("[GaziClient]", text);  
		return; 
	}  
	if (toastBox == null || !toastBox.isConnected)  
	{ 
		toastBox = el("div", "gz-toasts");  
		document.body.appendChild(toastBox); 
	} 
	var toast = el("div", "gz-toast gz-toast-" + (kind || "info"));
	toast.appendChild(el("span", "", text));  
	if (action != null)
	{ 
		var button = el("button", "gz-btn gz-btn-small", action.label); 
		button.onclick = function()  
		{ 
			action.run(); 
			toast.remove(); 
		};
		toast.appendChild(button); 
	} 
	toastBox.appendChild(toast);
	nativeSetTimeout(function()
	{ 
		toast.classList.add("gz-toast-out");  
		nativeSetTimeout(function()  
		{ 
			toast.remove(); 
		}, 300); 
	}, action != null ? 9000 : 4000);
}

var ui =
{ 
	toast:
	{
		success: function(text)  
		{
			showToast(String(text), "success");
		}, 
		error: function(text)  
		{  
			showToast(String(text), "error");
		}, 
		info: function(text)  
		{ 
			showToast(String(text), "info");
		}  
	}
};  

// ---- Language ----
// English is the source text; Turkish comes from this table. el() translates every text it is
// given, and t() does it by hand for text with values in it ({0}, {1} ...).
var gaziLang = "en"; 

var trText =
{  
	"Done": "Tamam",  
	"Mobile buttons": "Mobil butonlar", 
	"Edit button layout": "Buton düzenini değiştir", 
	"Button layout": "Buton düzeni",  
	"Move the on-screen buttons where you want them and hide the ones you do not use. Every key of the plugins you have on gets a button.": "Ekrandaki butonları istediğin yere taşı, kullanmadıklarını gizle. Açık pluginlerin her tuşu için bir buton var.",
	"Button size": "Buton boyutu",  
	"How big the on-screen buttons are": "Ekrandaki butonların büyüklüğü",  
	"Drag a button to move it, tap it to hide or show it": "Taşımak için butonu sürükle, gizlemek veya göstermek için dokun",
	"Button layout saved": "Buton düzeni kaydedildi", 
	"Plugin changes apply after a reload.": "Plugin değişiklikleri yenilemeden sonra uygulanır.",
	"Reload now": "Şimdi yenile",  
	"★ Akgazi's Recommended Settings": "★ Akgazi'nin Önerdiği Ayarlar",  
	"Save layout": "Düzeni kaydet", 
	"Reset": "Sıfırla", 
	"Layouts:": "Düzenler:",
	"Your keys": "Tuşların", 
	"What every key does with the plugins you have on. Click one to change it.": "Açık pluginlerle her tuşun ne yaptığı. Değiştirmek için birine tıkla.", 
	"No plugin keys yet. Turn plugins on to see their keys here.": "Henüz plugin tuşu yok. Tuşlarını burada görmek için plugin aç.",  
	"This key is used by more than one action": "Bu tuş birden fazla işte kullanılıyor", 
	"No plugins found.": "Plugin bulunamadı.",  
	"custom": "özel",
	"error": "hata",  
	"Open editor": "Editörü aç",
	"Add from file": "Dosyadan ekle",  
	"Open folder": "Klasörü aç",
	"Import from Blockyfish": "Blockyfish'ten içe aktar",  
	"Paste plugin code": "Plugin kodunu yapıştır", 
	"Save plugin": "Plugini kaydet",  
	"Delete": "Sil", 
	"No custom plugins yet.": "Henüz özel plugin yok.", 
	"General": "Genel",  
	"Folder": "Klasör",  
	"Files": "Dosyalar", 
	"Where plugin.saveFile writes files": "plugin.saveFile dosyaları buraya yazar",  
	"Open saves": "Kayıtları aç", 
	"Open data folder": "Veri klasörünü aç", 
	"Advanced": "Gelişmiş",  
	"Restart": "Yeniden başlat",
	"Clear site data": "Site verilerini temizle",
	"GaziClient is an optimized Deeeep.io client with more plugins than any other client. Turn plugins on and off with no reload needed, edit them in a detailed plugin editor, save your own plugin layouts, see every key you use at a glance, and run every Blockyfish plugin too.": "GaziClient, diğer clientlardan daha fazla plugini olan, optimize edilmiş bir Deeeep.io clientıdır. Pluginleri yenilemeye gerek kalmadan aç ve kapat, detaylı plugin editöründe düzenle, kendi plugin düzenlerini kaydet, kullandığın her tuşu tek bakışta gör ve bütün Blockyfish pluginlerini de çalıştır.", 
	"Light and fast: Rust + WebView2": "Hafif ve hızlı: Rust + WebView2",  
	"Plugins turn on and off live, no reload": "Pluginler anında açılıp kapanır, yenileme yok",  
	"Detailed plugin editor with autocomplete": "Otomatik tamamlamalı detaylı plugin editörü", 
	"Saved plugin layouts and Akgazi's recommended setup": "Kayıtlı plugin düzenleri ve Akgazi'nin önerdiği ayarlar",
	"Key list that shows what every key does": "Her tuşun ne yaptığını gösteren tuş listesi",  
	"Works with every Blockyfish plugin": "Bütün Blockyfish pluginleriyle çalışır", 
	"Made by Akgazi": "Akgazi tarafından yapıldı", 
	"Contact: Discord akgazii": "İletişim: Discord akgazii",  
	"Changelog": "Güncelleme notları",
	"Fresh start!": "Temiz bir başlangıç!", 
	"ⓘ About GaziClient": "ⓘ GaziClient Hakkında", 
	"Press a key...": "Bir tuşa bas...",  
	"Search plugins...": "Plugin ara...",
	"file name, e.g. myplugin.js": "dosya adı, örn. myplugin.js", 
	"Turns on exactly the plugins Akgazi plays with and sets his keys": "Akgazi'nin oynadığı pluginleri açar ve onun tuşlarını atar", 
	"Saves which plugins are on and their keys": "Açık pluginleri ve tuşlarını kaydeder", 
	"Turn every plugin off": "Bütün pluginleri kapat", 
	"Turn on only these plugins": "Sadece bu pluginleri aç", 
	"Delete layout": "Düzeni sil", 
	"Settings": "Ayarlar",  
	"Drag": "Sürükle",  
	"Minimize": "Küçült", 
	"Maximize": "Büyüt", 
	"Close": "Kapat", 
	"Give the layout a name first": "Önce düzene bir isim ver", 
	"Every plugin is already off": "Bütün pluginler zaten kapalı",
	"All plugins turned off": "Bütün pluginler kapatıldı",  
	"Restart GaziClient to apply": "Uygulamak için GaziClient'ı yeniden başlat", 
	"Plugin saved": "Plugin kaydedildi",
	"This logs you out of Deeeep.io and clears its cache. Continue?": "Bu, Deeeep.io hesabından çıkış yapar ve önbelleği temizler. Devam edilsin mi?",
	"Name for this layout:": "Bu düzenin adı:",  
	"Menu key": "Menü tuşu",  
	"Opens this menu": "Bu menüyü açar", 
	"Unlock FPS": "FPS sınırını kaldır",  
	"Removes the frame rate cap (needs restart)": "Kare hızı sınırını kaldırır (yeniden başlatma gerekir)", 
	"Ad blocker": "Reklam engelleyici",  
	"Blocks ads and trackers (needs restart)": "Reklamları ve izleyicileri engeller (yeniden başlatma gerekir)",  
	"GaziClient theme": "GaziClient teması", 
	"Pixel style for the whole site": "Bütün site için piksel stil",  
	"GaziClient logo": "GaziClient logosu",  
	"Shows the GaziClient logo on the home page": "Ana sayfada GaziClient logosunu gösterir", 
	"Background photos": "Arka plan fotoğrafları", 
	"Shows the photos from the backgrounds folder on the home page and changes them every few seconds. Can bug together with the Custom background plugin, so keep only one of them on.": "Ana sayfada backgrounds klasöründeki fotoğrafları gösterir ve birkaç saniyede bir değiştirir. Custom background pluginiyle birlikte hata çıkarabilir, ikisinden sadece birini açık tut.",  
	"Background": "Arka plan",
	"Home page photo from the backgrounds folder": "backgrounds klasöründen ana sayfa fotoğrafı",  
	"Menu opacity": "Menü saydamlığı",  
	"Lower it to see the game through this menu": "Oyunu menünün arkasından görmek için düşür",
	"Zoom": "Yakınlaştırma", 
	"Page zoom level": "Sayfa yakınlaştırma seviyesi",  
	"Language": "Dil",  
	"Language of the GaziClient menus": "GaziClient menülerinin dili", 
	"Plugins": "Pluginler", 
	"Custom": "Özel", 
	"Editor": "Editör", 
	"About": "Hakkında",  
	"All": "Tümü", 
	"Enabled": "Açık",
	"Off": "Kapalı",  
	"Random": "Rastgele",  
	"GaziClient's own plugins": "GaziClient'ın kendi pluginleri",  
	"Plugins from the Blockyfish registry": "Blockyfish pluginleri",  
	"Open this menu": "Bu menüyü aç", 
	"Opens or closes the GaziClient menu": "GaziClient menüsünü açar veya kapatır",  
	"Show or hide how many bites you need to kill each animal, and how many they need to kill you": "Her hayvanı kaç ısırıkta öldüreceğini ve seni kaç ısırıkta öldüreceğini gösterir veya gizler",
	"Turn auto dodge on or off": "Otomatik kaçmayı açar veya kapatır",
	"Let the client play for you, or stop it": "Client senin yerine oynasın veya dursun", 
	"Show or hide where people who type in chat are on the minimap": "Chat'e yazanların minimapte nerede olduğunu gösterir veya gizler", 
	"Open or close the panel with every emote": "Bütün emojilerin olduğu paneli açar veya kapatır",
	"Open or close the panel with every animal to evolve into": "Evrimleşebileceğin bütün hayvanların panelini açar veya kapatır",  
	"Evolve straight into the target animal set in its settings": "Ayarlarda seçili hedef hayvana direkt evrimleşir",  
	"Show or hide how much XP each animal needs to evolve": "Her hayvanın evrimleşmesine ne kadar XP kaldığını gösterir veya gizler", 
	"Hold to aim where the enemy near your mouse will be, release to boost into them": "Basılı tut, faresine yakın düşmanın gideceği yere nişan al; bırakınca üstüne boost at",
	"Turn auto boosting into enemies you can finish in one bite on or off": "Tek ısırıkta bitirebileceğin düşmanlara otomatik boost atmayı açar veya kapatır",
	"Thresher only: arm tail aim, then ctrl + click shoots your tail at the animal near your mouse": "Sadece Thresher: kuyruk nişanını hazırla, sonra ctrl + tık fareye yakın hayvana kuyruğunu fırlatır",  
	"Show or hide every player's account username next to their name": "Her oyuncunun hesap kullanıcı adını isminin yanında gösterir veya gizler",
	"Turn auto shake on or off (shakes off cookiecutters, snakes and wolfeels)": "Otomatik silkelenmeyi açar veya kapatır (cookiecutter, yılan ve wolfeel'den kurtarır)",
	"Hold to spin really fast": "Çok hızlı dönmek için basılı tut", 
	"Hold to see the evolution tree for tiers 8 - 10": "8 - 10. seviye evrim ağacını görmek için basılı tut", 
	"Humpback: sing the speed song": "Humpback: hız şarkısını söyle",  
	"Humpback: sing the slow song": "Humpback: yavaşlatma şarkısını söyle",
	"Humpback: sing the heal song": "Humpback: iyileştirme şarkısını söyle", 
	"Humpback: sing the war song": "Humpback: savaş şarkısını söyle",
	"Humpback: sing the ruin song": "Humpback: yıkım şarkısını söyle",  
	"Humpback: sing the blast song": "Humpback: patlama şarkısını söyle",  
	"Open or close the skin swapper": "Skin değiştiriciyi açar veya kapatır", 
	"Akgazi's settings applied ({0} plugin(s) changed)": "Akgazi'nin ayarları uygulandı ({0} plugin değişti)",
	"Layout \"{0}\" saved ({1} plugin(s) on)": "\"{0}\" düzeni kaydedildi ({1} plugin açık)",
	"Layout \"{0}\" loaded ({1} plugin(s) changed)": "\"{0}\" düzeni yüklendi ({1} plugin değişti)",  
	"Delete the layout \"{0}\"?": "\"{0}\" düzeni silinsin mi?",
	"This turns off all {0} plugin(s) that are on right now.\nSave a layout first if you want to come back to them.\n\nTurn everything off?": "Şu an açık olan {0} pluginin hepsi kapanacak.\nSonra geri dönmek istersen önce bir düzen kaydet.\n\nHepsi kapatılsın mı?",
	"{0} / {1} on": "{0} / {1} açık", 
	"by {0}": "yapan: {0}", 
	"{0} plugin(s) added": "{0} plugin eklendi",  
	"Imported {0} plugin(s) and {1} plugin data entries": "{0} plugin ve {1} plugin verisi içe aktarıldı", 
	"Delete {0}?": "{0} silinsin mi?", 
	"{0} plugins installed, {1} enabled. Menu key: {2}": "{0} plugin yüklü, {1} açık. Menü tuşu: {2}",
	"{0} paused (Esc to resume)": "{0} durduruldu (devam için Esc)",  
	"{0} resumed": "{0} devam ediyor", 
	" and ": " ve ", 
	"{0} is enabled": "{0} açık", 
	"{0} are enabled": "{0} açık"
}; 

function t(text) 
{ 
	var out = gaziLang == "tr" && trText[text] != null ? trText[text] : text;  
	for(var i = 1;i<arguments.length;i++)  
	{ 
		out = out.split("{" + (i - 1) + "}").join(String(arguments[i])); 
	} 
	return out; 
}  

// Turkish plugin descriptions for the plugin cards. The plugin files themselves are never changed.
var pluginDescriptionsTr =
{ 
	"gaziclient-plugins/aimlineplus.js": "Beaked'e nişan çizgisi eklendi. Thresher ve GPO'nun artık kendine özel çizgisi var: Thresher'ınki arkadan çıkar, GPO'nunkinde nereye ineceğini gösteren bir daire var. Her zaman görünür.",  
	"gaziclient-plugins/autododge.js": "Sana gerçekten zarar verebilecek düşmanlardan otomatik kaçar. Sana boost attıklarında ve daha erken, yakındayken sana doğru nişan aldıklarında kaçar (ısırıkların çoğu tepki veremeyeceğin kadar yakından atılan boostlardan gelir). Haritadaki her duvarı, tavanı ve katı zemini vücut genişliğin ve gerçek boost mesafesiyle kontrol eder, asla sudan dışarı kaçmaz. Açıp kapatmak için kaçma tuşuna bas. İstersen değerleri değiştir.",  
	"gaziclient-plugins/autoplay.js": "Senin yerine oynar. Seni öldürebilecek hayvanlardan kaçar, yenebileceğin hayvanları avlar, yem yer ve yakında kimse yokken etrafta dolaşır. Açıp kapatmak için tuşa bas.", 
	"gaziclient-plugins/chatradar.js": "Oyuncular chat'e yazdığında, uzakta olsalar bile nerede olduklarını gösterir. Yerleri isimleriyle minimapte belirir ve bir süre sonra kaybolur. Açıp kapatmak için tuşa bas.",
	"gaziclient-plugins/emotepicker.js": "Panel tuşuna basınca oyundaki bütün emojileri, sahip olmadıkların dahil görürsün. Göndermek için birine tıkla.",  
	"gaziclient-plugins/evolvepicker.js": "Panel tuşuna basınca bütün hayvanları seviyelerine göre görürsün. Seçeneklerinde olmasa bile evrimleşmeyi denemek için birine tıkla. Ya da bir hedef hayvan seç ve hızlı tuşa bas.",
	"gaziclient-plugins/evolvewatch.js": "Her hayvanın isminin önünde evrimleşmesine ne kadar XP kaldığını gösterir (⬆). Evrimleşmek üzereyken kırmızıya döner ve uyarı verir. Açıp kapatmak için tuşa bas.", 
	"gaziclient-plugins/killcalc.js": "İkiniz de ısırmaya devam ederseniz, her hayvanın isminin yanında onu kaç ısırıkta öldüreceğini (⚔) ve onun seni kaç ısırıkta öldüreceğini (☠) gösterir. Sunucunun gönderdiği gerçek değerleri (hasar, zırh, zırh delme, yansıtma, can çalma, fazla can) ve skinlerinin hasar ve can bonusunu kullanır. Açıp kapatmak için tuşa bas.",  
	"gaziclient-plugins/predictstrike.js": "Kilit tuşunu basılı tutunca farene en yakın düşmanın gideceği yere nişan alır (hızını ve nereye nişan aldığını kullanır), bırakınca üstüne boost atar. Execute modu, tek ısırıkta bitirebileceğin her düşmana kendi kendine boost atar. Hedefinin gideceği yere sarı bir halka koyar.",
	"gaziclient-plugins/thresherkit.js": "Sadece Thresher köpekbalığı için. Açmak için tuşa bas, sonra ctrl + tık kuyruğunu farene en yakın hayvana çevirir, hareket ediyorsa önünü keserek atış yapar. Hedefin üstünde küçük bir atış hesaplayıcısı (açı, mesafe, uçuş süresi, öndelik) ve kuyruk atışlarının verdiği hasarı gösterir.",  
	"gaziclient-plugins/userids.js": "Her oyuncunun hesap kullanıcı adını isminin yanında gösterir. Böylece oyundaki ismini değiştirse bile kim olduğunu anlarsın. Göstermek veya gizlemek için tuşa bas.", 
	"official-plugins/aimline.js": "Bazı hayvanlarda kırmızı nişan çizgisi göstermek için ctrl/cmd'yi basılı tut. WebGL'in açık olması gerekir.",  
	"official-plugins/animatedmeters.js": "XP, boost ve stat çubuklarını akıcı yapar",  
	"official-plugins/assetswapper.js": "Oyunda özel skinler kullan (diğer oyuncular görmez), mağazadan skin id'lerini kopyala",
	"official-plugins/autofill.js": "İsmini otomatik doldurur", 
	"official-plugins/autoshake.js": "Açıp kapatmak için silkelenme tuşuna bas", 
	"official-plugins/autosongs.js": "Kambur balina şarkılarını çalmak için sayı tuşlarına bas",  
	"official-plugins/autospin.js": "Kollarını yormadan çok hızlı dön",
	"official-plugins/bettervision.js": "Mürekkep parlaması ve derin karanlık efekti yok",  
	"official-plugins/boosthack.js": "Tam boost için ctrl/cmd + tık, yarım boost için alt + tık, süper zıplama / coco kombo / thresher süper boost için ctrl/cmd + shift + tık",  
	"official-plugins/bypasschatfilter.js": "Chat filtresini otomatik aşar", 
	"official-plugins/custombackground.js": "Özel bir arka plan resmi veya gif kullanmanı sağlar",  
	"official-plugins/evowheel.js": "8 - 10. seviyeler için evrim ağacını gösterir",  
	"official-plugins/fiddlergodmodeop.js": "Fiddler crab yeteneğini kullanırken sınırsız can boostu almak için godmode tuşuna bas", 
	"official-plugins/gpotpdot.js": "GPO'nun ışınlanacağı yeri gösteren bir nokta ekler",
	"official-plugins/hideboosttrail.js": "Boost izini ve baloncukları kaldırır",
	"official-plugins/iseedeadfish.js": "Hayaletleri görmeni sağlar", 
	"official-plugins/loginautofill.js": "Kullanıcı adını ve şifreni otomatik doldurur", 
	"official-plugins/nocameraclamp.js": "Kamera sınırı kaldırılır; hayvanın her zaman ekranın ortasında olur", 
	"official-plugins/nograbberanchor.js": "Kamerayı seni tutan hayvana değil, senin hayvanına ortalar",  
	"official-plugins/noinvisibleanimals.js": "Görünmez hayvanları görünür yapar",
	"official-plugins/nozoomlimit.js": "Yakınlaştırma sınırı kaldırılır; istediğin kadar yakınlaşıp uzaklaşabilirsin", 
	"official-plugins/pddoubleanimal.js": "Pearl defense'te bütün evrim seçeneklerini almak için seçenek tuşuna bas",
	"official-plugins/quickdisconnect.js": "Herhangi bir sunucudan çıkmak için ctrl/cmd + shift + Q'ya bas",  
	"official-plugins/reverseaim.js": "Bazı hayvanlarda hareketi otomatik ters çevirir",  
	"official-plugins/showroomid.js": "Herkesin oda id'sini isminin yanında gösterir",
	"official-plugins/smallminimap.js": "Oyundaki minimapin boyutunu yarıya indirir",  
	"official-plugins/spoofkiller.js": "Ölüm ekranında seni öldüren hesabı değiştirir, değiştirilen profile de link verir",  
	"official-plugins/v3ui.js": "Deeeep.io'nun v3 arayüzünü geri getirir: altta yatay XP çubuğu, solda dikey boost çubukları",
	"official-plugins/xray.js": "Yeraltı mağarasını ve zeminin arkasındaki hayvanları gösterir"
};

function pluginDescription(info) 
{  
	if (gaziLang == "tr" && pluginDescriptionsTr[info.key] != null) 
	{
		return pluginDescriptionsTr[info.key]; 
	}  
	return info.description;  
} 

function buildLangSwitch()  
{ 
	var box = el("div", "gz-lang");
	[["en", "English", boot.flagEn], ["tr", "Türkçe", boot.flagTr]].forEach(function(lang) 
	{  
		var button = el("button", "gz-lang-btn" + (gaziLang == lang[0] ? " gz-lang-on" : ""));
		button.title = lang[1]; 
		var image = el("img");  
		image.src = lang[2];  
		image.alt = lang[1];
		button.appendChild(image); 
		button.onclick = function(event)
		{  
			event.stopPropagation();
			setLanguage(lang[0]); 
		}; 
		box.appendChild(button);  
	}); 
	return box; 
}

function setLanguage(code)  
{ 
	if (code == gaziLang) 
	{ 
		return; 
	} 
	gaziLang = code; 
	setConfig({ language: code });  
	if (rail != null)  
	{ 
		rail.remove(); 
		rail = null; 
	} 
	var home = document.querySelectorAll(".gz-home-about, .gz-home-changelog");  
	for(var i = 0;i<home.length;i++)
	{ 
		home[i].remove();  
	}  
	if (launcher != null)
	{ 
		launcher.remove();  
		launcher = null; 
	}
	if (menuOpen)  
	{  
		renderMenu(); 
	}  
	queueBranding();  
}

function el(tag, className, text) 
{ 
	var node = document.createElement(tag);  
	if (className)  
	{  
		node.className = className;
	} 
	if (text != null)  
	{  
		if (text instanceof Node) 
		{ 
			node.appendChild(text); 
		} 
		else
		{  
			node.textContent = typeof text == "string" ? t(text) : text; 
		}
	}  
	return node;  
}  

var menuOpen = false;  
var menuRoot = null; 
var menuTab = "plugins";
var menuSearch = "";  
var menuFilter = "all";
var expandedPlugin = null;
var pendingReload = false; 
var capturingKey = null; 
var launcher = null;

function keyLabel(code)  
{
	if (code == null || code == "")  
	{ 
		return "None";  
	} 
	if (code.indexOf("Key") == 0) 
	{  
		return code.substr(3); 
	}
	if (code.indexOf("Digit") == 0)  
	{
		return code.substr(5);  
	} 
	return code;
}  

function captureKey(button, done) 
{
	capturingKey = button; 
	button.textContent = t("Press a key...");
	button.classList.add("gz-capturing");  
	function listener(event) 
	{ 
		event.preventDefault();  
		event.stopImmediatePropagation(); 
		window.removeEventListener("keydown", listener, true); 
		capturingKey = null; 
		button.classList.remove("gz-capturing");
		var code = keyCodeOf(event); 
		if (code == "Escape") 
		{ 
			done(null);  
			return;
		}  
		if (code == "Backspace" || code == "Delete")
		{
			done(""); 
			return; 
		}
		done(code); 
	}
	window.addEventListener("keydown", listener, true);
} 

function ensureStyle()  
{ 
	if (document.getElementById("gz-style") != null)  
	{  
		return; 
	}  
	var style = el("style"); 
	style.id = "gz-style";  
	style.textContent = gaziMenuCss;  
	(document.head || document.documentElement).appendChild(style); 
}  

function ensureLauncher()  
{
	if (launcher != null && launcher.isConnected) 
	{ 
		return;  
	}  
	launcher = el("button", "gz-launcher");  
	launcher.title = t("GaziClient (") + keyLabel(boot.config.menuKey) + ")";
	var image = el("img"); 
	image.src = boot.logoDark;
	launcher.appendChild(image);
	launcher.onclick = function()
	{  
		toggleMenu();  
	}; 
	document.body.appendChild(launcher);
} 

function toggleMenu() 
{ 
	if (menuOpen)  
	{ 
		closeMenu();  
	}  
	else
	{  
		openMenu();  
	}
} 

function stopEvents(node)  
{ 
	var names = ["keydown", "keyup", "keypress", "mousedown", "mouseup", "pointerdown", "pointerup", "wheel", "contextmenu", "click", "mousemove", "pointermove"]; 
	for(var i = 0;i<names.length;i++)  
	{  
		node.addEventListener(names[i], function(event) 
		{
			event.stopPropagation();  
		}); 
	} 
}

function openMenu()  
{ 
	if (boot == null || document.body == null)  
	{  
		return; 
	}  
	ensureStyle(); 
	menuOpen = true; 
	for(var code in pressedKeys)  
	{ 
		delete pressedKeys[code]; 
		fireKeybinds(code, false, null);  
	} 
	if (menuRoot == null)
	{
		menuRoot = el("div", "gz-back");
		stopEvents(menuRoot); 
		menuRoot.addEventListener("mousedown", function(event)
		{ 
			if (event.target == menuRoot)
			{ 
				closeMenu();
			} 
		});
	} 
	document.body.appendChild(menuRoot);  
	applyMenuOpacity();  
	renderMenu(); 
} 

function menuOpacity()
{ 
	var value = Number(boot && boot.config.menuOpacity); 
	if (!(value > 0))  
	{
		return 1;
	} 
	return Math.min(1, Math.max(0.3, value));  
}  

function applyMenuOpacity(value) 
{  
	if (menuRoot != null) 
	{  
		menuRoot.style.setProperty("--gz-menu-opacity", String(value == null ? menuOpacity() : value));  
	}
} 

function closeMenu()  
{  
	menuOpen = false;
	if (menuRoot != null) 
	{ 
		menuRoot.remove();  
	}
	updateRail();  
}  

var rail = null; 
var railTabs = [["plugins", "Plugins"], ["custom", "Custom"], ["editor", "Editor"], ["client", "Client"]].filter(function(tab)  
{  
	return !gaziMobile || tab[0] != "editor"; 
}); 

function ensureRail() 
{ 
	if (rail != null && rail.isConnected)  
	{
		return; 
	}
	rail = el("div", "gz-rail");
	for(var i = 0;i<railTabs.length;i++)  
	{
		(function(tab)
		{
			var button = el("button", "gz-rail-btn", tab[1]);  
			button.dataset.tab = tab[0];  
			button.onclick = function()  
			{ 
				if (tab[0] == "editor")  
				{ 
					ipcCall("openEditor"); 
					return;  
				}  
				if (menuOpen && menuTab == tab[0])
				{ 
					closeMenu();  
					return; 
				}
				menuTab = tab[0];
				if (menuOpen)
				{
					renderMenu(); 
				}  
				else
				{ 
					openMenu();  
				}  
				updateRail(); 
			};  
			rail.appendChild(button); 
		})(railTabs[i]); 
	}  
	rail.appendChild(buildLangSwitch()); 
	stopEvents(rail);
	document.body.appendChild(rail);
	updateRail(); 
}

function updateRail()
{  
	if (rail == null)
	{
		return; 
	} 
	var buttons = rail.querySelectorAll(".gz-rail-btn"); 
	for(var i = 0;i<buttons.length;i++) 
	{ 
		buttons[i].classList.toggle("gz-rail-on", menuOpen && buttons[i].dataset.tab == menuTab); 
	}
}  

function refreshMenuIfOpen()  
{
	if (menuOpen && capturingKey == null) 
	{ 
		var focused = document.activeElement; 
		if (focused != null && menuRoot != null && menuRoot.contains(focused) && isTyping(focused)) 
		{
			return;  
		}
		renderMenu(); 
	}
}  

function renderMenu()
{  
	var scroll = 0; 
	var keysScroll = 0;  
	var oldBody = menuRoot.querySelector(".gz-plugins-main") || menuRoot.querySelector(".gz-body");
	if (oldBody != null) 
	{
		scroll = oldBody.scrollTop;  
	}  
	var oldKeys = menuRoot.querySelector(".gz-keys");
	if (oldKeys != null)
	{ 
		keysScroll = oldKeys.scrollTop;  
	}  
	menuRoot.textContent = "";
	var panel = el("div", "gz-panel" + (menuTab == "plugins" ? " gz-panel-wide" : "")); 
	var head = el("div", "gz-head"); 
	var mark = el("img", "gz-wordmark");  
	mark.src = boot.wordmarkDark;
	head.appendChild(mark);  
	var tabs = el("div", "gz-tabs");  
	var tabNames = [["plugins", "Plugins"], ["custom", "Custom"], ["client", "Client"], ["about", "About"]];
	for(var i = 0;i<tabNames.length;i++) 
	{  
		(function(tab)  
		{
			var button = el("button", "gz-tab" + (menuTab == tab[0] ? " gz-tab-on" : ""), tab[1]);
			button.dataset.tab = tab[0]; 
			button.onclick = function() 
			{ 
				menuTab = tab[0]; 
				renderMenu();  
			}; 
			tabs.appendChild(button);  
		})(tabNames[i]);
	}  
	head.appendChild(tabs);  
	var close = el("button", "gz-close", "\u2715");  
	close.onclick = closeMenu;
	head.appendChild(close); 
	panel.appendChild(head);  
	if (pendingReload) 
	{ 
		var bar = el("div", "gz-reload-bar");  
		bar.appendChild(el("span", "", "Plugin changes apply after a reload."));
		var reload = el("button", "gz-btn gz-btn-small gz-btn-accent", "Reload now");  
		reload.onclick = function() 
		{
			location.reload();  
		}; 
		bar.appendChild(reload); 
		panel.appendChild(bar);  
	} 
	var body = el("div", "gz-body");
	if (menuTab == "plugins")
	{  
		renderPluginsTab(body);
	}
	else if (menuTab == "custom")  
	{ 
		renderCustomTab(body);  
	} 
	else if (menuTab == "client") 
	{  
		renderClientTab(body); 
	} 
	else
	{  
		renderAboutTab(body);
	} 
	panel.appendChild(body); 
	menuRoot.appendChild(panel);
	(body.querySelector(".gz-plugins-main") || body).scrollTop = scroll; 
	var newKeys = body.querySelector(".gz-keys"); 
	if (newKeys != null)
	{ 
		newKeys.scrollTop = keysScroll; 
	}  
	updateRail();  
} 

// Akgazi's own setup: these plugins get turned on by the "Recommended" button, and these keys
// replace a plugin's built-in default the first time it registers a keybind. Fresh installs start
// with every plugin off.
var recommendedPlugins =
[
	"gaziclient-plugins/aimlineplus.js", "gaziclient-plugins/autododge.js", "gaziclient-plugins/autoplay.js", "gaziclient-plugins/chatradar.js",
	"gaziclient-plugins/emotepicker.js", "gaziclient-plugins/evolvepicker.js", "gaziclient-plugins/evolvewatch.js", "gaziclient-plugins/killcalc.js",
	"gaziclient-plugins/predictstrike.js", "gaziclient-plugins/thresherkit.js", "gaziclient-plugins/userids.js", "official-plugins/aimline.js", 
	"official-plugins/animatedmeters.js", "official-plugins/autofill.js", "official-plugins/autoshake.js", "official-plugins/autosongs.js",
	"official-plugins/autospin.js", "official-plugins/bettervision.js", "official-plugins/boosthack.js", "official-plugins/bypasschatfilter.js", 
	"official-plugins/evowheel.js", "official-plugins/gpotpdot.js", "official-plugins/loginautofill.js", "official-plugins/nocameraclamp.js", 
	"official-plugins/nograbberanchor.js", "official-plugins/noinvisibleanimals.js", "official-plugins/nozoomlimit.js", "official-plugins/reverseaim.js",  
	"official-plugins/showroomid.js", "official-plugins/v3ui.js", "official-plugins/xray.js"
];

var recommendedKeys =
{ 
	"gaziclient-plugins/autododge.js": { "Toggle dodge": "KeyW" },  
	"gaziclient-plugins/autoplay.js": { "Toggle auto play": "KeyP" },  
	"gaziclient-plugins/chatradar.js": { "Toggle chat radar": "KeyR" }, 
	"gaziclient-plugins/emotepicker.js": { "Toggle emote panel": "KeyB" },  
	"gaziclient-plugins/evolvepicker.js": { "Evolve to target": "KeyK", "Toggle panel": "KeyT" }, 
	"gaziclient-plugins/evolvewatch.js": { "Toggle evolve watch": "KeyF" },
	"gaziclient-plugins/killcalc.js": { "Toggle kill info": "KeyY" },  
	"gaziclient-plugins/predictstrike.js": { "Lock on": "KeyA", "Toggle execute": "KeyD" },  
	"gaziclient-plugins/thresherkit.js": { "Toggle tail aim": "KeyQ" }, 
	"gaziclient-plugins/userids.js": { "Toggle user ids": "KeyL" },
	"official-plugins/autoshake.js": { "Shake": "KeyV" },
	"official-plugins/autosongs.js": { "Blast": "Digit6", "Heal": "Digit3", "Ruin": "Digit5", "Slow": "Digit2", "Speed": "Digit1", "War": "Digit4" },  
	"official-plugins/autospin.js": { "Spin": "KeyZ" },  
	"official-plugins/evowheel.js": { "Show evo wheel": "KeyO" } 
}; 

// One line per keybind for the key list next to the plugins.
var keyHelp =
{  
	"gaziclient-plugins/killcalc.js": { "Toggle kill info": "Show or hide how many bites you need to kill each animal, and how many they need to kill you" },
	"gaziclient-plugins/autododge.js": { "Toggle dodge": "Turn auto dodge on or off" },  
	"gaziclient-plugins/autoplay.js": { "Toggle auto play": "Let the client play for you, or stop it" },  
	"gaziclient-plugins/chatradar.js": { "Toggle chat radar": "Show or hide where people who type in chat are on the minimap" }, 
	"gaziclient-plugins/emotepicker.js": { "Toggle emote panel": "Open or close the panel with every emote" },  
	"gaziclient-plugins/evolvepicker.js": { "Toggle panel": "Open or close the panel with every animal to evolve into", "Evolve to target": "Evolve straight into the target animal set in its settings" },  
	"gaziclient-plugins/evolvewatch.js": { "Toggle evolve watch": "Show or hide how much XP each animal needs to evolve" },
	"gaziclient-plugins/predictstrike.js": { "Lock on": "Hold to aim where the enemy near your mouse will be, release to boost into them", "Toggle execute": "Turn auto boosting into enemies you can finish in one bite on or off" }, 
	"gaziclient-plugins/thresherkit.js": { "Toggle tail aim": "Thresher only: arm tail aim, then ctrl + click shoots your tail at the animal near your mouse" },
	"gaziclient-plugins/userids.js": { "Toggle user ids": "Show or hide every player's account username next to their name" },
	"official-plugins/autoshake.js": { "Shake": "Turn auto shake on or off (shakes off cookiecutters, snakes and wolfeels)" }, 
	"official-plugins/autospin.js": { "Spin": "Hold to spin really fast" }, 
	"official-plugins/evowheel.js": { "Show evo wheel": "Hold to see the evolution tree for tiers 8 - 10" }, 
	"official-plugins/autosongs.js": { "Speed": "Humpback: sing the speed song", "Slow": "Humpback: sing the slow song", "Heal": "Humpback: sing the heal song", "War": "Humpback: sing the war song", "Ruin": "Humpback: sing the ruin song", "Blast": "Humpback: sing the blast song" },
	"official-plugins/assetswapper.js": { "Toggle skin swapper modal": "Open or close the skin swapper" }  
};

// Turns on exactly the plugins in `enabledKeys` (all others off) and applies the given keybinds.
function applyPluginSet(enabledKeys, keybinds) 
{
	var changed = 0;  
	for(var i = 0;i<boot.plugins.length;i++)  
	{
		var info = boot.plugins[i];
		var on = enabledKeys.indexOf(info.key) != -1;  
		var entry = pluginData[info.key];  
		if (entry == null && !on) 
		{
			continue;
		}  
		var data = dataFor(info); 
		if (data.enabled != on)
		{ 
			changed++;  
		}  
		data.enabled = on; 
		data.version = info.version;  
		data.official = info.source != "custom"; 
		var keys = keybinds[info.key] || {}; 
		for(var name in keys)
		{
			data.keybinds[name] = keys[name];  
		} 
		saveData(info.key);
	}
	syncPlugins();  
	renderMenu();  
	return changed;
} 

function enabledPluginKeys()  
{ 
	return boot.plugins.filter(function(info) 
	{  
		return pluginData[info.key] != null && pluginData[info.key].enabled; 
	}).map(function(info) 
	{
		return info.key;  
	});
} 

function applyRecommended() 
{ 
	var changed = applyPluginSet(recommendedPlugins, recommendedKeys);
	showToast(t("Akgazi's settings applied ({0} plugin(s) changed)", changed), "info");
}

function pluginLayouts() 
{
	return Array.isArray(boot.config.pluginLayouts) ? boot.config.pluginLayouts : [];
} 

function saveLayout(name) 
{
	name = name.trim();  
	if (name == "")  
	{ 
		showToast(t("Give the layout a name first"), "error"); 
		return; 
	} 
	var enabled = enabledPluginKeys();  
	var keybinds = {}; 
	for(var i = 0;i<enabled.length;i++)  
	{
		keybinds[enabled[i]] = JSON.parse(JSON.stringify(pluginData[enabled[i]].keybinds || {}));
	}  
	var layouts = pluginLayouts().filter(function(layout) 
	{  
		return layout.name != name; 
	});  
	layouts.push({ name: name, plugins: enabled, keybinds: keybinds });  
	setConfig({ pluginLayouts: layouts }); 
	renderMenu();  
	showToast(t("Layout \"{0}\" saved ({1} plugin(s) on)", name, enabled.length), "info");
}  

function loadLayout(layout)
{
	var changed = applyPluginSet(layout.plugins || [], layout.keybinds || {}); 
	showToast(t("Layout \"{0}\" loaded ({1} plugin(s) changed)", layout.name, changed), "info");
}

function deleteLayout(layout) 
{  
	if (!confirm(t("Delete the layout \"{0}\"?", layout.name)))  
	{  
		return; 
	}  
	setConfig({ pluginLayouts: pluginLayouts().filter(function(other) { return other.name != layout.name; }) });  
	renderMenu(); 
} 

function resetPlugins() 
{ 
	var count = enabledPluginKeys().length;
	if (count == 0)  
	{ 
		showToast(t("Every plugin is already off"), "info");  
		return;
	}
	if (!confirm(t("This turns off all {0} plugin(s) that are on right now.\nSave a layout first if you want to come back to them.\n\nTurn everything off?", count)))  
	{  
		return;  
	} 
	applyPluginSet([], {});  
	showToast(t("All plugins turned off"), "info"); 
} 

// Buttons that sit next to the filter chips: Akgazi's setup, save layout, reset.
function buildPresetButtons(tools)  
{  
	var recommend = el("button", "gz-btn gz-btn-small gz-btn-accent", "\u2605 Akgazi's Recommended Settings");
	recommend.title = t("Turns on exactly the plugins Akgazi plays with and sets his keys");
	recommend.onclick = applyRecommended; 
	tools.appendChild(recommend);
	var save = el("button", "gz-btn gz-btn-small", "Save layout");  
	save.title = t("Saves which plugins are on and their keys"); 
	save.onclick = function() 
	{
		var name = prompt(t("Name for this layout:"), "");  
		if (name != null)
		{ 
			saveLayout(name);
		}  
	};  
	tools.appendChild(save); 
	var reset = el("button", "gz-btn gz-btn-small gz-btn-danger", "Reset");
	reset.title = t("Turn every plugin off");  
	reset.onclick = resetPlugins;
	tools.appendChild(reset); 
} 

function buildLayoutChips()  
{ 
	var chips = el("div", "gz-row gz-layouts");
	var layouts = pluginLayouts();
	if (layouts.length == 0) 
	{
		return chips;
	}
	chips.appendChild(el("span", "gz-layouts-label", "Layouts:"));  
	for(var i = 0;i<layouts.length;i++) 
	{ 
		(function(layout) 
		{ 
			var chip = el("span", "gz-layout"); 
			var load = el("button", "gz-chip gz-layout-load", layout.name + " (" + (layout.plugins || []).length + ")"); 
			load.title = t("Turn on only these plugins");
			load.onclick = function()  
			{  
				loadLayout(layout); 
			};
			var remove = el("button", "gz-chip gz-layout-del", "\u2715");
			remove.title = t("Delete layout"); 
			remove.onclick = function() 
			{ 
				deleteLayout(layout);  
			};
			chip.appendChild(load); 
			chip.appendChild(remove);  
			chips.appendChild(chip);  
		})(layouts[i]); 
	}
	return chips;
}  

// The keybinds a plugin really uses: the ones it registered while running, otherwise what is saved or recommended.
function activeKeybinds(info)
{ 
	var entry = pluginData[info.key];
	var saved = entry != null ? entry.keybinds || {} : {};  
	var runtime = pluginRuntimes[info.key];  
	var result = {};
	if (runtime != null) 
	{  
		for(var name in runtime.keyDown)  
		{
			result[name] = saved[name]; 
		}
		return result; 
	}  
	var recommended = recommendedKeys[info.key];  
	if (recommended != null)  
	{ 
		for(var name in recommended)  
		{  
			result[name] = saved[name] != null ? saved[name] : recommended[name];
		} 
		return result; 
	}
	for(var name in saved)
	{ 
		result[name] = saved[name]; 
	}
	return result;
}

function buildKeyList()
{  
	var aside = el("div", "gz-keys");
	aside.appendChild(el("div", "gz-keys-title", "Your keys")); 
	aside.appendChild(el("div", "gz-keys-sub", "What every key does with the plugins you have on. Click one to change it."));
	var rows = [{ code: boot.config.menuKey, action: "Open this menu", plugin: "GaziClient", help: "Opens or closes the GaziClient menu", key: null }];  
	for(var i = 0;i<boot.plugins.length;i++)  
	{  
		var info = boot.plugins[i];  
		var entry = pluginData[info.key]; 
		if (entry == null || !entry.enabled)  
		{ 
			continue; 
		}  
		var binds = activeKeybinds(info);
		for(var name in binds)  
		{
			var help = keyHelp[info.key] != null ? keyHelp[info.key][name] : null; 
			rows.push({ code: binds[name], action: name, plugin: info.name, help: help || "", key: info.key });  
		} 
	} 
	var used = {};  
	for(var i = 0;i<rows.length;i++) 
	{  
		if (rows[i].code)  
		{
			used[rows[i].code] = (used[rows[i].code] || 0) + 1; 
		}  
	}
	rows.sort(function(a, b) 
	{ 
		return keyLabel(a.code).localeCompare(keyLabel(b.code), undefined, { numeric: true });  
	}); 
	if (rows.length == 1) 
	{  
		aside.appendChild(el("div", "gz-keys-empty", "No plugin keys yet. Turn plugins on to see their keys here.")); 
	} 
	for(var i = 0;i<rows.length;i++) 
	{ 
		(function(row)
		{
			var clash = row.code && used[row.code]>1; 
			var item = el("button", "gz-keyrow" + (clash ? " gz-keyrow-clash" : "")); 
			item.appendChild(el("span", "gz-keycap", keyLabel(row.code)));  
			var text = el("span", "gz-keyrow-text");  
			text.appendChild(el("span", "gz-keyrow-action", row.action)); 
			text.appendChild(el("span", "gz-keyrow-plugin", row.plugin)); 
			if (row.help) 
			{
				text.appendChild(el("span", "gz-keyrow-help", row.help)); 
			}  
			if (clash) 
			{  
				text.appendChild(el("span", "gz-keyrow-warn", "This key is used by more than one action"));
			}  
			item.appendChild(text); 
			item.onclick = function()  
			{ 
				if (row.key == null)  
				{  
					menuTab = "client";
					renderMenu(); 
					return;  
				}  
				var info = boot.plugins.filter(function(p) { return p.key == row.key; })[0]; 
				expandedPlugin = row.key; 
				menuSearch = "";  
				menuFilter = "all";  
				collapsedGroups[pluginGroup(info)] = false;  
				renderMenu(); 
				var cards = menuRoot.querySelectorAll(".gz-card");  
				for(var c = 0;c<cards.length;c++)  
				{ 
					if (cards[c].dataset.key == row.key) 
					{ 
						cards[c].scrollIntoView({ block: "nearest" }); 
					}  
				} 
			};
			aside.appendChild(item);
		})(rows[i]);  
	}  
	return aside;
}  

var pluginGroups = [["gaziclient", "GaziClient", "GaziClient's own plugins"], ["blockyfish", "Blockyfish", "Plugins from the Blockyfish registry"]];  
var collapsedGroups = {}; 

// Custom plugins are ours; registry and dev-folder plugins are Blockyfish's.
function pluginGroup(info)  
{
	return info.source == "custom" || info.source == "builtin" ? "gaziclient" : "blockyfish"; 
}

function pluginMatches(info) 
{
	var entry = pluginData[info.key];  
	var enabled = entry != null && entry.enabled;  
	if (menuFilter == "enabled" && !enabled) 
	{  
		return false;
	} 
	if (menuFilter == "blockyfish" && pluginGroup(info) != "blockyfish") 
	{
		return false;  
	} 
	if (menuFilter == "gaziclient" && pluginGroup(info) != "gaziclient")
	{
		return false;  
	}
	if (menuSearch == "")  
	{ 
		return true;  
	} 
	var text = (info.name + " " + info.description + " " + pluginDescription(info) + " " + info.author + " " + info.tags.join(" ")).toLowerCase();
	return text.indexOf(menuSearch.toLowerCase()) != -1; 
}

function renderPluginsTab(body)
{  
	body.classList.add("gz-body-split"); 
	var outer = body; 
	body = el("div", "gz-plugins-main");  
	outer.appendChild(body); 
	outer.appendChild(buildKeyList()); 
	var tools = el("div", "gz-row gz-tools"); 
	var search = el("input", "gz-input gz-grow"); 
	search.placeholder = t("Search plugins...");
	search.value = menuSearch; 
	search.oninput = function() 
	{
		menuSearch = search.value;
		var list = body.querySelector(".gz-list");  
		if (list != null)  
		{
			list.replaceWith(buildPluginList()); 
		} 
	}; 
	tools.appendChild(search); 
	if (menuFilter == "official" || menuFilter == "custom")  
	{ 
		menuFilter = "all";  
	}  
	var filters = [["all", "All"], ["enabled", "Enabled"], ["gaziclient", "GaziClient"], ["blockyfish", "Blockyfish"]]; 
	for(var i = 0;i<filters.length;i++)
	{  
		(function(filter) 
		{  
			var chip = el("button", "gz-chip" + (menuFilter == filter[0] ? " gz-chip-on" : ""), filter[1]);  
			chip.onclick = function() 
			{
				menuFilter = filter[0];  
				renderMenu();
			};  
			tools.appendChild(chip); 
		})(filters[i]);
	} 
	buildPresetButtons(tools);  
	body.appendChild(tools);  
	if (pluginLayouts().length>0)  
	{ 
		body.appendChild(buildLayoutChips());  
	}  
	body.appendChild(buildPluginList()); 
	nativeSetTimeout(function() 
	{ 
		if (menuSearch != "")
		{
			search.focus(); 
			search.setSelectionRange(search.value.length, search.value.length);
		}  
	}, 0); 
}  

function buildPluginList()  
{  
	var list = el("div", "gz-list");  
	var shown = 0;
	for(var g = 0;g<pluginGroups.length;g++) 
	{  
		var group = pluginGroups[g]; 
		var members = boot.plugins.filter(function(info) 
		{  
			return pluginGroup(info) == group[0];  
		}); 
		var matching = members.filter(pluginMatches);
		if (matching.length == 0)  
		{ 
			continue; 
		}  
		var enabled = members.filter(function(info) 
		{  
			return pluginData[info.key] != null && pluginData[info.key].enabled;  
		}).length; 
		var searching = menuSearch != "";  
		var collapsed = collapsedGroups[group[0]] == true && !searching; 
		var head = el("button", "gz-group-head gz-group-" + group[0] + (collapsed ? " gz-group-collapsed" : "")); 
		head.appendChild(el("span", "gz-group-arrow", collapsed ? "▸" : "▾"));
		head.appendChild(el("span", "gz-group-name", group[1]));
		head.appendChild(el("span", "gz-group-desc", group[2]));  
		head.appendChild(el("span", "gz-group-count", t("{0} / {1} on", enabled, members.length)));
		(function(id) 
		{ 
			head.onclick = function()
			{  
				collapsedGroups[id] = !collapsedGroups[id]; 
				list.replaceWith(buildPluginList());
			};
		})(group[0]); 
		list.appendChild(head); 
		shown += matching.length; 
		if (collapsed) 
		{
			continue; 
		}
		for(var i = 0;i<matching.length;i++)  
		{  
			list.appendChild(buildPluginCard(matching[i])); 
		} 
	} 
	if (shown == 0) 
	{  
		list.appendChild(el("div", "gz-empty", "No plugins found."));
	} 
	return list;  
}  

function makeToggle(on, changed) 
{
	var toggle = el("button", "gz-toggle" + (on ? " gz-toggle-on" : ""));  
	toggle.appendChild(el("span", "gz-knob"));
	toggle.onclick = function(event)
	{ 
		event.stopPropagation();  
		on = !on;
		toggle.classList.toggle("gz-toggle-on", on);  
		changed(on); 
	};
	return toggle;  
}

function buildPluginCard(info)  
{ 
	var entry = pluginData[info.key]; 
	var enabled = entry != null && entry.enabled;  
	var card = el("div", "gz-card" + (enabled ? " gz-card-on" : ""));  
	card.dataset.key = info.key;  
	var top = el("div", "gz-card-top");
	var text = el("div", "gz-card-text"); 
	var title = el("div", "gz-card-title");
	title.appendChild(el("span", "", document.createTextNode(info.name)));  
	if (info.version)  
	{ 
		title.appendChild(el("span", "gz-badge", "v" + info.version)); 
	} 
	if (info.source == "custom") 
	{  
		title.appendChild(el("span", "gz-badge gz-badge-custom", "custom")); 
	}
	if (info.source == "dev")
	{
		title.appendChild(el("span", "gz-badge gz-badge-dev", "dev"));  
	}
	if (pluginErrors[info.key] != null)  
	{  
		title.appendChild(el("span", "gz-badge gz-badge-error", "error"));  
	} 
	text.appendChild(title);  
	if (info.description) 
	{ 
		text.appendChild(el("div", "gz-card-desc", document.createTextNode(pluginDescription(info))));
	}  
	var meta = el("div", "gz-card-meta");  
	if (info.author)
	{ 
		meta.appendChild(el("span", "", t("by {0}", info.author)));  
	} 
	for(var i = 0;i<info.tags.length;i++) 
	{  
		meta.appendChild(el("span", "gz-tag", info.tags[i])); 
	}  
	text.appendChild(meta);  
	top.appendChild(text); 
	var hasOptions = entry != null && (Object.keys(entry.settings || {}).length>0 || Object.keys(entry.keybinds || {}).length>0);
	if (hasOptions)  
	{
		var gear = el("button", "gz-icon-btn" + (expandedPlugin == info.key ? " gz-icon-on" : ""), "\u2699"); 
		gear.title = t("Settings"); 
		gear.onclick = function()  
		{ 
			expandedPlugin = expandedPlugin == info.key ? null : info.key; 
			renderMenu();
		};
		top.appendChild(gear);  
	}
	top.appendChild(makeToggle(enabled, function(on) 
	{
		var data = dataFor(info);
		data.enabled = on; 
		data.version = info.version; 
		data.official = info.source != "custom";
		saveData(info.key);
		syncPlugins();
		renderMenu(); 
	})); 
	card.appendChild(top); 
	if (pluginErrors[info.key] != null)  
	{  
		card.appendChild(el("div", "gz-error-text", pluginErrors[info.key])); 
	} 
	if (expandedPlugin == info.key && entry != null) 
	{ 
		card.appendChild(buildPluginOptions(info, entry));  
	} 
	return card;
}  

function buildPluginOptions(info, entry)  
{ 
	var box = el("div", "gz-options");  
	var keybindNames = Object.keys(entry.keybinds);
	for(var i = 0;i<keybindNames.length;i++) 
	{  
		(function(name)  
		{
			var row = el("div", "gz-option"); 
			row.appendChild(el("div", "gz-option-name", name));  
			var button = el("button", "gz-btn gz-key", keyLabel(entry.keybinds[name]));
			button.onclick = function()
			{  
				captureKey(button, function(code) 
				{ 
					if (code != null)  
					{  
						entry.keybinds[name] = code;  
						saveData(info.key); 
					}  
					renderMenu();  
				}); 
			}; 
			row.appendChild(button); 
			box.appendChild(row); 
		})(keybindNames[i]);
	}  
	var settingNames = Object.keys(entry.settings);
	for(var i = 0;i<settingNames.length;i++) 
	{  
		box.appendChild(buildSettingRow(info, entry, entry.settings[settingNames[i]]));
	}  
	return box;  
}  

function buildSettingRow(info, entry, setting) 
{  
	var row = el("div", "gz-option"); 
	var label = el("div", "gz-option-name"); 
	label.appendChild(el("div", "", setting.name));  
	if (setting.description)  
	{ 
		label.appendChild(el("div", "gz-option-desc", setting.description));  
	} 
	row.appendChild(label);
	function commit(value) 
	{  
		setting.value = value; 
		saveData(info.key);
	}  
	if (setting.type == "boolean")  
	{ 
		row.appendChild(makeToggle(setting.value == true, commit));  
	} 
	else if (setting.type == "list") 
	{  
		var select = el("select", "gz-input gz-select");
		for(var i = 0;i<setting.choices.length;i++)
		{ 
			var option = el("option", "", String(setting.choices[i])); 
			option.value = String(i);  
			if (setting.choices[i] == setting.value)
			{ 
				option.selected = true; 
			} 
			select.appendChild(option); 
		}
		select.onchange = function() 
		{ 
			commit(setting.choices[Number(select.value)]);  
		};  
		row.appendChild(select); 
	} 
	else
	{ 
		var input = el("input", "gz-input gz-field"); 
		input.type = setting.type == "number" ? "number" : "text";
		input.value = setting.value == null ? "" : String(setting.value);
		input.onchange = function()
		{  
			if (setting.type == "number") 
			{  
				var number = Number(input.value);  
				if (!isNaN(number))
				{ 
					commit(number);  
				} 
			}  
			else
			{  
				commit(input.value);
			} 
		};
		row.appendChild(input);  
	}  
	return row; 
} 

function reloadPluginList()  
{  
	return ipcCall("plugins").then(function(list)  
	{ 
		boot.plugins = list;  
		syncPlugins();  
		refreshMenuIfOpen();
	}); 
} 

function renderCustomTab(body) 
{ 
	var actions = el("div", "gz-row");  
	var openEditor = el("button", "gz-btn gz-btn-accent", "Open editor");
	openEditor.onclick = function() 
	{
		ipcCall("openEditor");  
	};
	actions.appendChild(openEditor);  
	var fromFile = el("button", "gz-btn", "Add from file");  
	var picker = el("input");
	picker.type = "file";
	picker.accept = ".js";  
	picker.multiple = true;
	picker.style.display = "none"; 
	picker.onchange = function()  
	{
		var files = Array.prototype.slice.call(picker.files);
		var jobs = files.map(function(file) 
		{ 
			return file.text().then(function(code)  
			{  
				return ipcCall("saveCustom", { name: file.name, code: code }); 
			});
		});  
		Promise.all(jobs).then(function()
		{
			ui.toast.success(t("{0} plugin(s) added", files.length)); 
			reloadPluginList(); 
		}, function(error)  
		{ 
			ui.toast.error(String(error));  
		});
	};
	fromFile.onclick = function()  
	{ 
		picker.click();  
	}; 
	actions.appendChild(fromFile); 
	actions.appendChild(picker);
	var folder = el("button", "gz-btn", "Open folder");  
	folder.onclick = function() 
	{ 
		ipcCall("openFolder", { which: "custom" });  
	}; 
	actions.appendChild(folder);
	var importButton = el("button", "gz-btn", "Import from Blockyfish"); 
	importButton.onclick = function() 
	{
		ipcCall("importBlockyfish").then(function(result) 
		{ 
			ui.toast.success(t("Imported {0} plugin(s) and {1} plugin data entries", result.plugins, result.data)); 
			ipcCall("boot").then(function(data)  
			{
				boot.plugins = data.plugins;  
				var keys = Object.keys(data.data);
				for(var i = 0;i<keys.length;i++)
				{
					if (pluginData[keys[i]] == null) 
					{ 
						pluginData[keys[i]] = data.data[keys[i]]; 
					} 
				}  
				syncPlugins();
				refreshMenuIfOpen(); 
			});  
		}, function(error)  
		{ 
			ui.toast.error(String(error));  
		}); 
	};  
	actions.appendChild(importButton);  
	body.appendChild(actions);

	var editor = el("div", "gz-section"); 
	editor.appendChild(el("div", "gz-section-title", "Paste plugin code"));  
	var name = el("input", "gz-input");  
	name.placeholder = t("file name, e.g. myplugin.js"); 
	var code = el("textarea", "gz-input gz-code"); 
	code.placeholder = t("// @name My plugin\n// @id myplugin\n// @description ...\n// @author ...\n// @tags ...");  
	code.spellcheck = false;  
	var save = el("button", "gz-btn gz-btn-accent", "Save plugin");  
	save.onclick = function() 
	{  
		if (code.value.trim() == "")  
		{
			return; 
		}
		ipcCall("saveCustom", { name: name.value || "plugin.js", code: code.value }).then(function()
		{ 
			ui.toast.success(t("Plugin saved")); 
			reloadPluginList(); 
		}, function(error)  
		{ 
			ui.toast.error(String(error));  
		});  
	};  
	editor.appendChild(name);  
	editor.appendChild(code); 
	editor.appendChild(save);  
	body.appendChild(editor); 

	var list = el("div", "gz-list");
	var count = 0; 
	for(var i = 0;i<boot.plugins.length;i++)  
	{  
		var info = boot.plugins[i]; 
		if (info.source != "custom")  
		{
			continue; 
		} 
		count++;  
		(function(info)
		{ 
			var row = el("div", "gz-card gz-row");  
			var text = el("div", "gz-grow");  
			text.appendChild(el("div", "gz-card-title", info.name)); 
			text.appendChild(el("div", "gz-card-meta", info.key.replace("custom-plugins/", "")));  
			row.appendChild(text); 
			var remove = el("button", "gz-btn gz-btn-danger gz-btn-small", "Delete");
			remove.onclick = function() 
			{  
				if (!confirm(t("Delete {0}?", info.name))) 
				{ 
					return;  
				}
				ipcCall("deleteCustom", { key: info.key }).then(function() 
				{ 
					delete pluginData[info.key]; 
					reloadPluginList(); 
				}); 
			};
			row.appendChild(remove); 
			list.appendChild(row);  
		})(info);  
	} 
	if (count == 0) 
	{
		list.appendChild(el("div", "gz-empty", "No custom plugins yet."));
	} 
	body.appendChild(list); 
}  

function configRow(body, title, description, control) 
{  
	var row = el("div", "gz-option");  
	var label = el("div", "gz-option-name"); 
	label.appendChild(el("div", "", title));  
	if (description)
	{
		label.appendChild(el("div", "gz-option-desc", description)); 
	}
	row.appendChild(label);  
	row.appendChild(control);  
	body.appendChild(row); 
}

function setConfig(patch)  
{  
	var keys = Object.keys(patch);
	for(var i = 0;i<keys.length;i++) 
	{ 
		boot.config[keys[i]] = patch[keys[i]];
	}  
	return ipcCall("setConfig", { config: patch });  
}

function renderClientTab(body)
{
	var general = el("div", "gz-section");  
	general.appendChild(el("div", "gz-section-title", "General")); 
	var keyButton = el("button", "gz-btn gz-key", keyLabel(boot.config.menuKey));  
	keyButton.onclick = function()  
	{ 
		captureKey(keyButton, function(code) 
		{ 
			if (code) 
			{  
				setConfig({ menuKey: code }); 
			}  
			renderMenu();  
		});  
	};  
	configRow(general, "Language", "Language of the GaziClient menus", buildLangSwitch()); 
	configRow(general, "Menu key", "Opens this menu", keyButton);  
	configRow(general, "Unlock FPS", "Removes the frame rate cap (needs restart)", makeToggle(boot.config.unlockFps == true, function(on) 
	{ 
		setConfig({ unlockFps: on });  
		showToast(t("Restart GaziClient to apply"), "info", { label: "Restart", run: function() { ipcCall("restart"); } });
	}));  
	configRow(general, "Ad blocker", "Blocks ads and trackers (needs restart)", makeToggle(boot.config.adblock != false, function(on)
	{ 
		setConfig({ adblock: on });  
		queueBranding(); 
		showToast(t("Restart GaziClient to apply"), "info", { label: "Restart", run: function() { ipcCall("restart"); } }); 
	}));  
	configRow(general, "GaziClient theme", "Pixel style for the whole site", makeToggle(boot.config.theme != false, function(on) 
	{  
		setConfig({ theme: on });  
		queueBranding(); 
	}));  
	configRow(general, "GaziClient logo", "Shows the GaziClient logo on the home page", makeToggle(boot.config.replaceLogo != false, function(on) 
	{ 
		setConfig({ replaceLogo: on });  
		if (!on) 
		{ 
			location.reload();
		}  
		queueBranding(); 
	})); 
	configRow(general, "Background photos", "Shows the photos from the backgrounds folder on the home page and changes them every few seconds. Can bug together with the Custom background plugin, so keep only one of them on.", makeToggle(boot.config.homeBackgrounds != false, function(on) 
	{
		setConfig({ homeBackgrounds: on }); 
		resetBackground(); 
		queueBranding(); 
	}));  
	var background = el("select", "gz-input gz-select");
	var backgroundChoice = boot.config.background || "random";  
	var backgroundOptions = [["off", "Off"], ["random", "Random"]]; 
	background.disabled = true;
	ipcCall("backgrounds").then(function(names) 
	{
		for(var i = 0;i<names.length;i++) 
		{ 
			backgroundOptions.push([names[i], names[i].replace(/\.[a-z]+$/i, "")]);  
		}
		for(var i = 0;i<backgroundOptions.length;i++)
		{ 
			var option = el("option", "", backgroundOptions[i][1]);  
			option.value = backgroundOptions[i][0];  
			if (backgroundOptions[i][0] == backgroundChoice)
			{ 
				option.selected = true;
			}
			background.appendChild(option);  
		}
		background.disabled = false; 
	});  
	background.onchange = function()  
	{ 
		setConfig({ background: background.value });
		resetBackground();  
	};  
	var backgroundRow = el("div", "gz-row"); 
	backgroundRow.appendChild(background); 
	var backgroundFolder = el("button", "gz-btn gz-btn-small", "Folder");  
	backgroundFolder.onclick = function()
	{  
		ipcCall("openFolder", { which: "backgrounds" });  
	};
	backgroundRow.appendChild(backgroundFolder); 
	configRow(general, "Background", "Home page photo from the backgrounds folder", backgroundRow);
	var opacityRow = el("div", "gz-row");  
	var opacity = el("input", "gz-range");  
	opacity.type = "range"; 
	opacity.min = "30"; 
	opacity.max = "100"; 
	opacity.step = "5"; 
	opacity.value = String(Math.round(menuOpacity() * 100));
	var opacityValue = el("span", "gz-range-value", opacity.value + "%");  
	opacity.oninput = function() 
	{  
		opacityValue.textContent = opacity.value + "%";  
		applyMenuOpacity(Number(opacity.value) / 100);  
	};  
	opacity.onchange = function()
	{ 
		setConfig({ menuOpacity: Number(opacity.value) / 100 });
	};
	opacityRow.appendChild(opacity);
	opacityRow.appendChild(opacityValue);  
	configRow(general, "Menu opacity", "Lower it to see the game through this menu", opacityRow); 
	var zoom = el("select", "gz-input gz-select"); 
	var zooms = [0.75, 0.9, 1, 1.1, 1.25, 1.5];  
	for(var i = 0;i<zooms.length;i++)
	{
		var option = el("option", "", Math.round(zooms[i] * 100) + "%");  
		option.value = String(zooms[i]); 
		if (Math.abs(zooms[i] - (boot.config.zoom || 1))<0.001)  
		{ 
			option.selected = true; 
		}  
		zoom.appendChild(option); 
	}  
	zoom.onchange = function()  
	{ 
		setConfig({ zoom: Number(zoom.value) });  
	}; 
	configRow(general, "Zoom", "Page zoom level", zoom); 
	body.appendChild(general);  
	if (gaziMobile) 
	{
		body.appendChild(buildMobileSettings());
		return; 
	}  


	var files = el("div", "gz-section"); 
	files.appendChild(el("div", "gz-section-title", "Files")); 
	var saveFolder = el("input", "gz-input"); 
	saveFolder.placeholder = boot.saveRoot; 
	saveFolder.value = boot.config.saveFolder || ""; 
	saveFolder.onchange = function() 
	{  
		setConfig({ saveFolder: saveFolder.value.trim() });  
	}; 
	files.appendChild(el("div", "gz-option-desc", "Where plugin.saveFile writes files"));
	files.appendChild(saveFolder); 
	var buttons = el("div", "gz-row");
	var openSaves = el("button", "gz-btn", "Open saves"); 
	openSaves.onclick = function() 
	{  
		ipcCall("openFolder", { which: "saves" }); 
	};  
	var openData = el("button", "gz-btn", "Open data folder");  
	openData.onclick = function() 
	{  
		ipcCall("openFolder", { which: "data" });
	}; 
	buttons.appendChild(openSaves);
	buttons.appendChild(openData);  
	files.appendChild(buttons);  
	body.appendChild(files); 


	var advanced = el("div", "gz-section");  
	advanced.appendChild(el("div", "gz-section-title", "Advanced"));  
	var row = el("div", "gz-row"); 
	var devtools = el("button", "gz-btn", "DevTools"); 
	devtools.onclick = function()  
	{  
		ipcCall("devtools");  
	}; 
	var restart = el("button", "gz-btn", "Restart");
	restart.onclick = function()  
	{  
		ipcCall("restart"); 
	}; 
	var clear = el("button", "gz-btn gz-btn-danger", "Clear site data"); 
	clear.onclick = function() 
	{  
		if (confirm(t("This logs you out of Deeeep.io and clears its cache. Continue?"))) 
		{  
			ipcCall("clearCache").then(function()
			{  
				location.reload();
			});
		}  
	};  
	row.appendChild(devtools); 
	row.appendChild(restart);  
	row.appendChild(clear); 
	advanced.appendChild(row); 
	body.appendChild(advanced);  
}

// Newest first. Add a line here for every release.
var gaziChangelog =
[
	{ version: "v0.1.0", text: "Fresh start!" }  
]; 

function renderAboutTab(body)  
{ 
	var box = el("div", "gz-about");
	var logo = el("img", "gz-about-logo"); 
	logo.src = boot.logoDark;  
	box.appendChild(logo); 
	box.appendChild(el("div", "gz-section-title", "GaziClient " + boot.version));  
	box.appendChild(el("div", "gz-option-desc", "GaziClient is an optimized Deeeep.io client with more plugins than any other client. Turn plugins on and off with no reload needed, edit them in a detailed plugin editor, save your own plugin layouts, see every key you use at a glance, and run every Blockyfish plugin too."));
	var features = el("div", "gz-about-features");
	var featureList = ["Light and fast: Rust + WebView2", "Plugins turn on and off live, no reload", "Detailed plugin editor with autocomplete", "Saved plugin layouts and Akgazi's recommended setup", "Key list that shows what every key does", "Works with every Blockyfish plugin"];  
	for(var i = 0;i<featureList.length;i++) 
	{
		features.appendChild(el("div", "gz-about-feature", featureList[i]));  
	} 
	box.appendChild(features); 
	var enabled = 0;  
	for(var key in pluginData)
	{ 
		if (pluginData[key] && pluginData[key].enabled) 
		{  
			enabled++; 
		} 
	} 
	box.appendChild(el("div", "gz-option-desc", t("{0} plugins installed, {1} enabled. Menu key: {2}", boot.plugins.length, enabled, keyLabel(boot.config.menuKey)))); 
	var author = el("div", "gz-author"); 
	var avatar = el("img", "gz-author-photo"); 
	avatar.src = boot.akgazi;  
	avatar.alt = "Akgazi";  
	author.appendChild(avatar);
	var authorText = el("div", "gz-author-text"); 
	authorText.appendChild(el("div", "gz-author-name", "Made by Akgazi")); 
	authorText.appendChild(el("div", "gz-option-desc", "Contact: Discord akgazii")); 
	var discordButton = el("button", "gz-btn gz-author-discord", "GaziClient Discord"); 
	discordButton.onclick = openDiscord;  
	authorText.appendChild(discordButton); 
	author.appendChild(authorText);  
	box.appendChild(author);
	body.appendChild(box);
}  

var windowState = { maximized: false, fullscreen: false };
var winBar = null; 
var resizeEdges = [];
var brandQueued = false;  

function svgIcon(path) 
{  
	return "<svg viewBox=\"0 0 12 12\" width=\"12\" height=\"12\"><path d=\"" + path + "\" stroke=\"currentColor\" stroke-width=\"1.4\" fill=\"none\" shape-rendering=\"crispEdges\"/></svg>";
}

function updateWindowButtons()  
{ 
	if (winBar == null)  
	{  
		return; 
	} 
	var max = winBar.querySelector(".gz-win-max");  
	max.innerHTML = windowState.maximized ? svgIcon("M2.5 4.5h5v5h-5zM4.5 4.5v-2h5v5h-2") : svgIcon("M2.5 2.5h7v7h-7z");
	max.title = windowState.maximized ? "Restore" : "Maximize";  
	var hidden = windowState.maximized || windowState.fullscreen;  
	for(var i = 0;i<resizeEdges.length;i++) 
	{  
		resizeEdges[i].style.display = hidden ? "none" : "block";  
	}
	document.documentElement.classList.toggle("gz-fullscreen", windowState.fullscreen); 
} 

function ensureWindowChrome() 
{ 
	if (winBar != null && winBar.isConnected)  
	{ 
		return;
	}  
	winBar = el("div", "gz-winbar");  
	var grip = el("div", "gz-win-grip");
	grip.title = t("Drag");
	grip.addEventListener("mousedown", function(event)  
	{
		if (event.button == 0)  
		{ 
			event.preventDefault();
			ipcCall("drag");
		}  
	});
	grip.addEventListener("dblclick", function() 
	{ 
		ipcCall("maximize");  
	});
	var buttons = [["gz-win-min", "Minimize", svgIcon("M2 6.5h8"), "minimize"], ["gz-win-max", "Maximize", "", "maximize"], ["gz-win-close", "Close", svgIcon("M2.5 2.5l7 7M9.5 2.5l-7 7"), "close"]];  
	winBar.appendChild(grip); 
	for(var i = 0;i<buttons.length;i++)
	{  
		(function(spec) 
		{ 
			var button = el("button", "gz-win-btn " + spec[0]);  
			button.title = t(spec[1]); 
			button.innerHTML = spec[2];  
			button.onclick = function()  
			{
				ipcCall(spec[3]); 
			};  
			winBar.appendChild(button); 
		})(buttons[i]); 
	}  
	stopEvents(winBar); 
	document.body.appendChild(winBar); 
	var edges = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];  
	for(var i = 0;i<resizeEdges.length;i++)
	{ 
		resizeEdges[i].remove(); 
	} 
	resizeEdges = []; 
	for(var i = 0;i<edges.length;i++) 
	{ 
		(function(dir)
		{  
			var edge = el("div", "gz-edge gz-edge-" + dir);  
			edge.addEventListener("mousedown", function(event) 
			{ 
				if (event.button == 0) 
				{ 
					event.preventDefault();  
					event.stopPropagation(); 
					ipcCall("resize", { dir: dir });
				}  
			});  
			document.body.appendChild(edge); 
			resizeEdges.push(edge);  
		})(edges[i]); 
	}  
	ipcCall("windowState").then(function(state)
	{  
		windowState = state; 
		updateWindowButtons();  
	});
	updateWindowButtons();
}  

function isDragArea(target) 
{ 
	if (target == null || target.closest == null)  
	{
		return false;
	}  
	var header = target.closest(".home-page > .header, .el-row.header");  
	if (header == null) 
	{  
		return false;  
	} 
	return target.closest("button, a, input, select, textarea, img, svg, [role=button], .el-dropdown, .el-select, .user-info, .avatar, .nice-button") == null; 
} 

document.addEventListener("mousedown", function(event) 
{  
	if (event.button == 0 && isDragArea(event.target)) 
	{
		event.preventDefault();
		ipcCall("drag");
	}  
}, true);

document.addEventListener("dblclick", function(event)
{  
	if (isDragArea(event.target))  
	{  
		ipcCall("maximize"); 
	}  
}, true); 

onEvent("windowState", function(state) 
{  
	windowState = state;  
	updateWindowButtons();
});

function ensureModeButton()
{
	var row = document.querySelector(".modes-row"); 
	if (row == null || row.querySelector(".gz-mode-btn") != null)  
	{ 
		return; 
	}  
	var button = el("button", "gz-mode-btn"); 
	button.title = t("GaziClient (") + keyLabel(boot.config.menuKey) + ")";  
	var image = el("img");  
	image.src = boot.logoDark; 
	button.appendChild(image);  
	button.onclick = function(event)
	{
		event.preventDefault(); 
		event.stopPropagation();
		openMenu();
	}; 
	row.appendChild(button);  
}

function applyBranding() 
{ 
	brandQueued = false;  
	if (document.body == null || boot == null) 
	{ 
		return;
	} 
	ensureStyle(); 
	if (!gaziMobile) 
	{ 
		ensureWindowChrome();  
	}  
	ensureModeButton(); 
	ensureRail(); 
	var modesRow = document.querySelector(".modes-row");
	var home = modesRow != null && modesRow.offsetParent != null; 
	document.documentElement.classList.toggle("gz-home", home); 
	document.documentElement.classList.toggle("gz-adblock", boot.config.adblock != false);  
	document.documentElement.classList.toggle("gz-theme", boot.config.theme != false); 
	document.documentElement.classList.toggle("gz-mobile", gaziMobile);  
	if (launcher == null || !launcher.isConnected)  
	{ 
		ensureLauncher();  
	}
	launcher.style.display = home ? "none" : "block"; 
	if (home)
	{
		snapToPixels();
	}
	applyBackground();  
	if (home)  
	{
		replaceHomeLinks();
	} 
	if (boot.config.replaceLogo != false)  
	{  
		var logos = document.querySelectorAll("img[src*=\"/img/logo/logo\"]"); 
		for(var i = 0;i<logos.length;i++) 
		{  
			logos[i].removeAttribute("srcset");  
			logos[i].src = boot.wordmark;  
			logos[i].classList.add("gz-logo"); 
		}  
		var versions = document.querySelectorAll(".client-version");  
		for(var i = 0;i<versions.length;i++) 
		{ 
			if (versions[i].querySelector(".gz-version") == null) 
			{
				var tag = el("span", "gz-version", " · GaziClient " + boot.version);
				versions[i].appendChild(tag); 
			}
		}  
	} 
}  

var gaziDiscord = "https://discord.gg/Vcv7aJ9Pv2";  

function openDiscord(event)  
{  
	if (event != null) 
	{  
		event.preventDefault(); 
		event.stopPropagation();
	}
	ipcCall("openUrl", { url: gaziDiscord }); 
}  

// Deeeep.io's Changelog, AI tools and .io games buttons make way for About GaziClient + Discord.
function replaceHomeLinks()  
{ 
	var anchor = null;  
	var candidates = document.querySelectorAll("button, a"); 
	for(var i = 0;i<candidates.length;i++) 
	{  
		var node = candidates[i];
		if (node.closest(".gz-home-links, .gz-back, .gz-rail") != null) 
		{  
			continue;  
		}
		var text = (node.textContent || "").replace(/\s+/g, " ").trim(); 
		if (!/^\W*(changelog|ai tools|\.io games)$/i.test(text))  
		{
			continue; 
		} 
		if (/changelog/i.test(text))  
		{ 
			anchor = node; 
		}  
		if (node.style.display != "none")
		{ 
			node.style.display = "none"; 
		}
	} 
	if (anchor == null || anchor.parentNode == null) 
	{ 
		return; 
	}  
	var existing = anchor.parentNode.querySelector(":scope > .gz-home-links");  
	if (existing != null) 
	{
		alignHomeChangelog();
		return; 
	} 
	var stale = document.querySelectorAll(".gz-home-links, .gz-home-changelog");
	for(var i = 0;i<stale.length;i++) 
	{
		stale[i].remove();  
	} 
	var about = el("button", anchor.className + " gz-home-about", "\u24D8 About GaziClient");  
	about.type = "button";  
	about.onclick = function(event)
	{ 
		event.preventDefault();
		event.stopPropagation();  
		menuTab = "about";
		if (menuOpen) 
		{  
			renderMenu();
		}  
		else
		{ 
			openMenu();  
		}  
	}; 
	var discord = el("button", anchor.className + " gz-home-discord", "GaziClient Discord");
	discord.type = "button"; 
	discord.onclick = openDiscord;  
	var links = el("div", "gz-home-links");  
	links.appendChild(about);  
	links.appendChild(discord); 
	var changelog = el("div", "gz-section gz-home-changelog");  
	changelog.appendChild(el("div", "gz-section-title", "Changelog"));  
	for(var i = 0;i<gaziChangelog.length;i++)
	{ 
		var item = el("div", "gz-changelog-item"); 
		item.appendChild(el("span", "gz-badge", gaziChangelog[i].version)); 
		item.appendChild(el("span", "", gaziChangelog[i].text)); 
		changelog.appendChild(item);
	}  
	stopEvents(changelog); 
	anchor.parentNode.insertBefore(changelog, anchor);  
	anchor.parentNode.insertBefore(links, anchor.nextSibling);  
	alignHomeChangelog();  
}  

// The changelog box takes the width of the About + Discord row and sits centred right above it.
function alignHomeChangelog() 
{  
	var about = document.querySelector(".gz-home-links");
	var changelog = document.querySelector(".gz-home-changelog"); 
	if (about == null || changelog == null || about.offsetWidth == 0)
	{
		return; 
	}  
	var width = about.offsetWidth + "px";  
	if (changelog.style.width != width) 
	{  
		changelog.style.width = width;
	} 
	changelog.style.marginLeft = "0"; 
	changelog.style.marginRight = "0";  
	var current = parseFloat((changelog.style.transform.match(/-?[\d.]+/) || ["0"])[0]) || 0; 
	var a = about.getBoundingClientRect();  
	var c = changelog.getBoundingClientRect();
	var shift = Math.round(current + (a.left + a.width / 2) - (c.left + c.width / 2));
	var transform = shift == 0 ? "" : "translateX(" + shift + "px)";  
	if (changelog.style.transform != transform)
	{ 
		changelog.style.transform = transform;  
	} 
}

function snapToPixels() 
{  
	var column = document.querySelector(".play-game");
	if (column == null)
	{
		return; 
	}
	var oldTop = parseFloat(column.style.top) || 0; 
	var oldLeft = parseFloat(column.style.left) || 0;  
	var rect = column.getBoundingClientRect();
	var top = rect.top - oldTop; 
	var left = rect.left - oldLeft; 
	var fixTop = Math.round(top) - top;
	var fixLeft = Math.round(left) - left; 
	if (Math.abs(fixTop - oldTop)<0.01 && Math.abs(fixLeft - oldLeft)<0.01) 
	{ 
		return; 
	}  
	column.style.position = "relative";
	column.style.top = fixTop + "px";  
	column.style.left = fixLeft + "px";
}

window.addEventListener("resize", function()
{ 
	nativeSetTimeout(snapToPixels, 50); 
}); 

var backgroundList = null; 
var backgroundCache = {};  
var backgroundCurrent = null; 
var backgroundListLoading = false;  
var backgroundPending = false;  
var backgroundTicking = false; 

function resetBackground()  
{ 
	backgroundCurrent = null;
	var home = document.querySelector(".home-bg");  
	if (home != null)  
	{ 
		home.removeAttribute("data-gz-bg");  
		var layers = home.querySelectorAll(":scope > .gz-bg-layer");  
		for(var i = 0;i<layers.length;i++) 
		{ 
			layers[i].classList.remove("gz-bg-on");  
		}  
	}  
	queueBranding(); 
}  

function loadBackgroundList()  
{
	backgroundListLoading = true; 
	ipcCall("backgrounds").then(function(names) 
	{
		backgroundListLoading = false; 
		backgroundList = names;
		queueBranding(); 
	}, function()
	{  
		backgroundListLoading = false; 
		backgroundList = [];  
	});
}  

function pickBackground()  
{
	var choice = boot.config.background || "random";  
	if (choice != "random") 
	{  
		return backgroundList.indexOf(choice) != -1 ? choice : null; 
	} 
	if (backgroundList.length == 0)
	{  
		return null;  
	}
	if (backgroundList.length == 1) 
	{  
		return backgroundList[0]; 
	} 
	var next = backgroundCurrent;  
	while (next == backgroundCurrent) 
	{  
		next = backgroundList[Math.floor(Math.random() * backgroundList.length)];  
	} 
	return next;  
} 

function showBackground(name) 
{  
	if (name == null || backgroundPending) 
	{ 
		return;  
	}
	if (backgroundCache[name] != null) 
	{ 
		backgroundCurrent = name; 
		queueBranding(); 
		return; 
	} 
	backgroundPending = true;  
	ipcCall("background", { name: name }).then(function(result)  
	{
		var image = new Image(); 
		image.src = result.url; 
		var done = function()
		{ 
			backgroundPending = false; 
			backgroundCache[result.name] = result.url;  
			backgroundCurrent = result.name;
			queueBranding(); 
		};  
		image.decode().then(done, done);
	}, function()
	{  
		backgroundPending = false; 
	});  
} 

function backgroundTick()  
{  
	var choice = boot.config.background || "random"; 
	if (boot.config.homeBackgrounds != false && choice == "random" && !document.hidden && backgroundList != null && document.documentElement.classList.contains("gz-home"))  
	{  
		showBackground(pickBackground()); 
	} 
	var seconds = Number(boot.config.backgroundInterval) || 10;  
	nativeSetTimeout(backgroundTick, Math.max(3, seconds) * 1000);
}  

function applyBackground()
{
	var choice = boot.config.background || "random";  
	var home = document.querySelector(".home-bg"); 
	if (home == null)  
	{
		return;  
	} 
	if (choice == "off" || boot.config.homeBackgrounds == false)
	{
		var old = home.querySelectorAll(":scope > .gz-bg-layer"); 
		for(var i = 0;i<old.length;i++) 
		{ 
			old[i].remove();  
		} 
		home.removeAttribute("data-gz-bg");
		return;  
	}  
	if (!backgroundTicking)
	{  
		backgroundTicking = true;
		var seconds = Number(boot.config.backgroundInterval) || 10;  
		nativeSetTimeout(backgroundTick, Math.max(3, seconds) * 1000); 
	}  
	if (backgroundList == null) 
	{ 
		if (!backgroundListLoading)  
		{  
			loadBackgroundList(); 
		}
		return;  
	}
	if (backgroundCurrent == null || (choice != "random" && backgroundCurrent != choice))
	{ 
		showBackground(pickBackground());
		return; 
	}  
	var url = backgroundCache[backgroundCurrent]; 
	if (url == null || home.getAttribute("data-gz-bg") == backgroundCurrent)  
	{
		return;  
	} 
	var layers = home.querySelectorAll(":scope > .gz-bg-layer");  
	if (layers.length<2) 
	{ 
		for(var i = 0;i<layers.length;i++)  
		{ 
			layers[i].remove(); 
		}  
		if (getComputedStyle(home).position == "static") 
		{ 
			home.style.position = "relative"; 
		} 
		home.appendChild(el("div", "gz-bg-layer"));
		home.appendChild(el("div", "gz-bg-layer")); 
		layers = home.querySelectorAll(":scope > .gz-bg-layer");
	} 
	var front = layers[0].classList.contains("gz-bg-on") ? layers[0] : layers[1];  
	var back = front == layers[0] ? layers[1] : layers[0];  
	home.setAttribute("data-gz-bg", backgroundCurrent); 
	back.style.backgroundImage = "linear-gradient(rgba(7, 9, 24, 0.30), rgba(7, 9, 24, 0.55)), url(\"" + url + "\")"; 
	back.getBoundingClientRect();
	back.classList.add("gz-bg-on"); 
	front.classList.remove("gz-bg-on");
} 

onEvent("backgroundsUpdated", function()  
{ 
	backgroundList = null;  
	queueBranding();  
}); 

function queueBranding()  
{ 
	if (brandQueued)
	{  
		return;  
	} 
	brandQueued = true;  
	nativeSetTimeout(applyBranding, 60);
}  

var frameScale = 2; 
var frameVariants =
{
	plum: ["#542240", "#2A152D"], 
	plum2: ["#5B3A56", "#2A152D"],  
	plum3: ["#794E6D", "#2A152D"],  
	plum4: ["#8E5F82", "#2A152D"],
	red: ["#813645", "#2A152D"],
	red2: ["#9D4343", "#2A152D"],  
	indigo: ["#3E4C7E", "#090F33"],
	indigo2: ["#495F94", "#090F33"], 
	blue: ["#5A78B2", "#091E4D"],
	sky: ["#7396D5", "#091E4D"],
	coal: ["#2E2E43", "#030206"],  
	ash: ["#4A4B5B", "#030206"],  
	wine: ["#2A152D", "#030206"], 
	wine2: ["#4F2D4D", "#030206"],
	night: ["rgba(9,15,51,0.9)", "#2A152D"],
	dusk: ["rgba(42,21,45,0.92)", "#542240"],
	light: ["#D9DDE8", "#2A152D"], 
	white: ["#FFFFFF", "#2A152D"],
	rimVoid: ["transparent", "#030206"], 
	rimWine: ["transparent", "#2A152D"],
	rimSky: ["transparent", "#7396D5"]
};

function parseColor(text) 
{  
	var probe = document.createElement("canvas").getContext("2d"); 
	probe.fillStyle = "#000";  
	probe.fillStyle = text;  
	probe.fillRect(0, 0, 1, 1);
	var data = probe.getImageData(0, 0, 1, 1).data;  
	if (text == "transparent")  
	{
		return [0, 0, 0, 0];
	} 
	return [data[0], data[1], data[2], data[3]];  
} 

function buildFrames(done) 
{  
	var image = new Image();  
	image.onload = function() 
	{  
		var canvas = document.createElement("canvas");
		canvas.width = image.width; 
		canvas.height = image.height; 
		var ctx = canvas.getContext("2d");
		ctx.drawImage(image, 0, 0);  
		var base = ctx.getImageData(0, 0, canvas.width, canvas.height);
		var cornerFill = [base.data[4 * (8 * canvas.width + 8)], base.data[4 * (8 * canvas.width + 8) + 1], base.data[4 * (8 * canvas.width + 8) + 2]];
		var root = document.documentElement.style; 
		for(var name in frameVariants)
		{  
			var fill = parseColor(frameVariants[name][0]);  
			var edge = parseColor(frameVariants[name][1]); 
			var out = ctx.createImageData(canvas.width, canvas.height);  
			for(var i = 0;i<base.data.length;i += 4)
			{ 
				if (base.data[i + 3] == 0)
				{
					continue; 
				}
				var isFill = base.data[i] == cornerFill[0] && base.data[i + 1] == cornerFill[1] && base.data[i + 2] == cornerFill[2];  
				var color = isFill ? fill : edge; 
				out.data[i] = color[0]; 
				out.data[i + 1] = color[1];  
				out.data[i + 2] = color[2];
				out.data[i + 3] = color[3]; 
			}
			var flat = document.createElement("canvas"); 
			flat.width = canvas.width; 
			flat.height = canvas.height; 
			flat.getContext("2d").putImageData(out, 0, 0); 
			var variant = document.createElement("canvas"); 
			variant.width = canvas.width * frameScale;  
			variant.height = canvas.height * frameScale;  
			var vctx = variant.getContext("2d");
			vctx.imageSmoothingEnabled = false; 
			vctx.drawImage(flat, 0, 0, variant.width, variant.height);
			root.setProperty("--gz-f-" + name, "url(" + variant.toDataURL() + ")"); 
		} 
		done(); 
	};  
	image.onerror = done;
	image.src = boot.frame; 
}  

function startBranding()  
{
	buildFrames(queueBranding);
	queueBranding(); 
	new MutationObserver(queueBranding).observe(document.documentElement, { childList: true, subtree: true });  
}

// These plugins used to be custom files; keep their settings and keys now that they ship built in.
function migrateBuiltinData()
{
	var oldNames = { "killcalc.js": "aefafe.js" }; 
	for(var i = 0;i<boot.plugins.length;i++)
	{  
		var info = boot.plugins[i];  
		if (info.source != "builtin")
		{ 
			continue;  
		}  
		var file = info.key.replace("gaziclient-plugins/", ""); 
		var oldKey = "custom-plugins/" + (oldNames[file] || file);
		if (pluginData[oldKey] == null) 
		{  
			continue;
		}  
		if (pluginData[info.key] == null)  
		{ 
			pluginData[info.key] = pluginData[oldKey];  
			pluginData[info.key].official = true;  
			ipcCall("setData", { key: info.key, value: pluginData[info.key] }).catch(function() {}); 
		}
		delete pluginData[oldKey]; 
		ipcCall("setData", { key: oldKey, value: null }).catch(function() {}); 
	} 
}  

function startPlugins() 
{  
	pluginsLive = true;
	for(var i = 0;i<boot.plugins.length;i++)  
	{  
		var info = boot.plugins[i];
		var entry = pluginData[info.key];  
		if (entry != null && entry.enabled) 
		{  
			runPlugin(info, true); 
		} 
	}  
}  

function watchGame() 
{  
	var game = currentGame();
	if (game != null && game != currentGameObject) 
	{ 
		currentGameObject = game;  
		hookDrawings(game);
		var retry = deferredPlugins; 
		deferredPlugins = [];  
		for(var i = 0;i<retry.length;i++)  
		{ 
			runPlugin(retry[i], false);  
		} 
		var event = new Event("gameInit"); 
		event.game = game;  
		blockyfishEvents.dispatchEvent(event); 
	} 
}  

function waitForGame() 
{ 
	var started = Date.now();
	var pluginsStarted = false; 
	var brandingStarted = false;
	function tick() 
	{
		if (!brandingStarted && document.body != null) 
		{
			brandingStarted = true; 
			startBranding();  
		}  
		var ready = findStores();
		if (!pluginsStarted && (ready || Date.now() - started>20000)) 
		{
			pluginsStarted = true;
			startPlugins(); 
		}
		if (pluginsStarted) 
		{ 
			watchGame();  
			queueBranding(); 
			announceFeatures();  
			updateMobilePad();  
		} 
		nativeSetTimeout(tick, pluginsStarted ? 500 : 100);  
	}
	tick(); 
}  

onEvent("pluginsChanged", function()  
{ 
	reloadPluginList();
});  

// ---- Mobile: on-screen buttons for every plugin key ----
// Each button presses its key while it is held, so plugins work the same as with a keyboard.
// Players drag the buttons where they want them; the layout is saved in config.mobileButtons.
var mobilePad = null;
var mobilePadSig = "";  
var mobileEditing = false; 
var mobileDraft = null; 

function keyFromCode(code)  
{  
	if (/^Key[A-Z]$/.test(code))  
	{ 
		return code.slice(3).toLowerCase();
	}  
	if (/^(Digit|Numpad)[0-9]$/.test(code))  
	{
		return code.slice(-1); 
	} 
	if (code == "Space")
	{
		return " ";
	} 
	return code.replace(/(Left|Right)$/, ""); 
}  

function pressKey(code, down) 
{  
	var target = document.body || document.documentElement;  
	target.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code: code, key: keyFromCode(code), bubbles: true, cancelable: true }));  
}

function mobileButtonList()  
{
	var list = [];
	for(var i = 0;i<boot.plugins.length;i++) 
	{  
		var info = boot.plugins[i]; 
		var entry = pluginData[info.key]; 
		if (entry == null || !entry.enabled || pluginRuntimes[info.key] == null)
		{  
			continue;  
		}
		var binds = activeKeybinds(info); 
		for(var name in binds)
		{  
			if (binds[name]) 
			{ 
				list.push({ id: info.key + "|" + name, code: binds[name], label: name.replace(/^Toggle /, "") });
			}
		}
	}  
	list.push({ id: "esc", code: "Escape", label: "Esc" }); 
	return list;  
}  

function mobileLayout() 
{  
	if (mobileDraft != null) 
	{ 
		return mobileDraft;  
	}
	var saved = boot.config.mobileButtons; 
	return saved != null && typeof saved == "object" ? saved : {}; 
}  

function mobileSpot(layout, id, index) 
{ 
	var spot = layout[id]; 
	if (spot != null && typeof spot.x == "number" && typeof spot.y == "number") 
	{ 
		return spot; 
	}  
	// default: columns of five on the right, away from the joystick side
	var col = Math.floor(index / 5);  
	var row = index % 5; 
	return { x: 0.94 - col * 0.08, y: 0.22 + row * 0.13, hidden: false }; 
} 

function inMatch()
{
	var game = currentGame();
	var scene = game != null ? game.currentScene : null; 
	return scene != null && scene.myAnimals != null && scene.myAnimals[0] != null;  
} 

function buildMobilePad(list, layout)  
{  
	if (mobilePad != null) 
	{  
		mobilePad.remove(); 
	}
	mobilePad = el("div", "gz-mobile-pad");  
	var size = Number(boot.config.mobileButtonSize) || 56;  
	mobilePad.style.setProperty("--gz-mbtn", size + "px"); 
	for(var i = 0;i<list.length;i++)  
	{  
		(function(item, index) 
		{ 
			var spot = mobileSpot(layout, item.id, index);
			if (spot.hidden && !mobileEditing)  
			{  
				return;  
			} 
			var button = el("div", "gz-btn gz-mbtn" + (spot.hidden ? " gz-mbtn-hidden" : ""));  
			button.appendChild(document.createTextNode(item.label));
			button.style.left = (spot.x * 100) + "%";
			button.style.top = (spot.y * 100) + "%";  
			var start = null;
			button.addEventListener("pointerdown", function(event) 
			{ 
				event.preventDefault(); 
				event.stopPropagation(); 
				button.setPointerCapture(event.pointerId);  
				start = { x: event.clientX, y: event.clientY, moved: false };
				button.classList.add("gz-mbtn-down"); 
				if (!mobileEditing)  
				{  
					pressKey(item.code, true);  
				}  
			}); 
			button.addEventListener("pointermove", function(event)  
			{ 
				if (!mobileEditing || start == null) 
				{
					return;  
				}  
				event.preventDefault(); 
				if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 8)
				{
					start.moved = true;
				}  
				if (start.moved) 
				{
					button.style.left = (event.clientX / window.innerWidth * 100) + "%"; 
					button.style.top = (event.clientY / window.innerHeight * 100) + "%";  
				} 
			});  
			var release = function(event)  
			{ 
				if (start == null)
				{  
					return; 
				} 
				event.stopPropagation();  
				button.classList.remove("gz-mbtn-down"); 
				if (!mobileEditing) 
				{  
					pressKey(item.code, false); 
				} 
				else
				{
					var next = mobileSpot(mobileDraft, item.id, index); 
					next = { x: next.x, y: next.y, hidden: next.hidden == true };
					if (start.moved) 
					{
						next.x = Math.min(Math.max(event.clientX / window.innerWidth, 0.03), 0.97); 
						next.y = Math.min(Math.max(event.clientY / window.innerHeight, 0.03), 0.97); 
					}
					else
					{  
						next.hidden = !next.hidden;  
					}
					mobileDraft[item.id] = next; 
					mobilePadSig = ""; 
					updateMobilePad(); 
				} 
				start = null;  
			}; 
			button.addEventListener("pointerup", release);  
			button.addEventListener("pointercancel", release);  
			mobilePad.appendChild(button); 
		})(list[i], i);  
	} 
	if (mobileEditing)  
	{  
		var bar = el("div", "gz-mobile-bar"); 
		bar.appendChild(el("div", "gz-mobile-hint", "Drag a button to move it, tap it to hide or show it"));
		var reset = el("button", "gz-btn gz-btn-small", "Reset");  
		reset.onclick = function()
		{  
			mobileDraft = {}; 
			mobilePadSig = ""; 
			updateMobilePad();
		};
		var done = el("button", "gz-btn gz-btn-small", "Done");  
		done.onclick = function()
		{  
			setConfig({ mobileButtons: mobileDraft });  
			mobileEditing = false;
			mobileDraft = null;
			mobilePadSig = ""; 
			updateMobilePad();
			showToast(t("Button layout saved"), "success");  
		};
		bar.appendChild(reset);  
		bar.appendChild(done);
		mobilePad.appendChild(bar); 
	}
	stopEvents(mobilePad); 
	document.body.appendChild(mobilePad); 
}

// Called from the game tick and whenever the layout changes.
function updateMobilePad() 
{  
	if (!gaziMobile || boot == null || document.body == null) 
	{  
		return;
	}  
	var show = mobileEditing || (inMatch() && !menuOpen);
	if (!show)  
	{  
		if (mobilePad != null) 
		{  
			mobilePad.style.display = "none"; 
		} 
		return;  
	}
	var list = mobileButtonList();  
	var layout = mobileLayout();
	var sig = JSON.stringify([list, layout, mobileEditing, boot.config.mobileButtonSize, gaziLang]); 
	if (sig != mobilePadSig || mobilePad == null || !mobilePad.isConnected)  
	{ 
		mobilePadSig = sig; 
		buildMobilePad(list, layout);  
	}
	mobilePad.style.display = "block"; 
}

function editMobileButtons()  
{  
	mobileDraft = JSON.parse(JSON.stringify(mobileLayout())); 
	mobileEditing = true;
	mobilePadSig = "";  
	closeMenu(); 
	updateMobilePad(); 
}  

function buildMobileSettings()
{
	var section = el("div", "gz-section"); 
	section.appendChild(el("div", "gz-section-title", "Mobile buttons")); 
	var edit = el("button", "gz-btn", "Edit button layout");  
	edit.onclick = editMobileButtons; 
	configRow(section, "Button layout", "Move the on-screen buttons where you want them and hide the ones you do not use. Every key of the plugins you have on gets a button.", edit); 
	var sizeRow = el("div", "gz-row"); 
	var size = el("input", "gz-range"); 
	size.type = "range";
	size.min = "40"; 
	size.max = "90"; 
	size.step = "2";  
	size.value = String(Number(boot.config.mobileButtonSize) || 56);
	var sizeValue = el("span", "gz-range-value", size.value + "px");
	size.oninput = function()
	{  
		sizeValue.textContent = size.value + "px"; 
	};
	size.onchange = function() 
	{ 
		setConfig({ mobileButtonSize: Number(size.value) });
		mobilePadSig = ""; 
	};  
	sizeRow.appendChild(size); 
	sizeRow.appendChild(sizeValue);  
	configRow(section, "Button size", "How big the on-screen buttons are", sizeRow);  
	return section; 
}  

window.gazi =
{
	version: null,
	get game() 
	{  
		return currentGame();  
	}, 
	get store()
	{  
		return gameStore;  
	}, 
	gameState: gameState, 
	blockyfish: blockyfish,  
	PIXI: PIXI,  
	ipc: ipcCall,
	openMenu: openMenu
};  

ipcCall("boot").then(function(data)
{ 
	boot = data;
	gaziLang = data.config.language == "tr" ? "tr" : "en";  
	pluginData = data.data || {};  
	migrateBuiltinData(); 
	window.gazi.version = data.version; 
	waitForGame(); 
}, function(error) 
{  
	console.error("[GaziClient] boot failed", error); 
});  
