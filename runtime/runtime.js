var nativeReflect = {};
var reflectNames = Object.getOwnPropertyNames(Reflect);
for(var i = 0;i<reflectNames.length;i++)
{
	nativeReflect[reflectNames[i]] = Reflect[reflectNames[i]];
}
var nativeSetTimeout = window.setTimeout.bind(window);
var nativeClearTimeout = window.clearTimeout.bind(window);
var nativePost = window.ipc ? window.ipc.postMessage.bind(window.ipc) : null;

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
			nativeSetTimeout(function()
			{
				listener(event);
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
				entry.keybinds[name] = defaultKey;
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

function runPlugin(info, canDefer)
{
	var plugin = makePlugin(info);
	if (/\bReact(DOM)?\b|\bDeeeepio|\bModal\b/.test(info.code))
	{
		loadReact();
	}
	var tools = { hook: hook, getnative: getnative, ishooked: ishooked, restore: restore, reflect: nativeReflect, Reflect: Reflect, Object: Object };
	var game = { PIXI: PIXI, gameState: gameState };
	try
	{
		var fn = Function.apply(null, pluginParams.concat([info.code + "\n//# sourceURL=gaziclient/" + info.key]));
		fn(blockyfish, plugin, tools, React, ReactDOM, game, reactComponents(), undefined, ui, router, capturer);
		delete pluginErrors[info.key];
	}
	catch (error)
	{
		if (canDefer && currentGame() == null)
		{
			deferredPlugins.push(info);
			console.warn("[GaziClient] plugin " + info.name + " deferred until the game starts:", error);
			return;
		}
		pluginErrors[info.key] = String(error && error.message ? error.message : error);
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
				try
				{
					list[i](event);
				}
				catch (error)
				{
					console.error("[GaziClient] keybind " + runtime.info.name + "/" + name, error);
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

function el(tag, className, text)
{
	var node = document.createElement(tag);
	if (className)
	{
		node.className = className;
	}
	if (text != null)
	{
		node.textContent = text;
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
	button.textContent = "Press a key...";
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
	launcher.title = "GaziClient (" + keyLabel(boot.config.menuKey) + ")";
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
	renderMenu();
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
var railTabs = [["plugins", "Plugins"], ["custom", "Custom"], ["editor", "Editor"], ["client", "Client"], ["about", "About"]];

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
	var oldBody = menuRoot.querySelector(".gz-body");
	if (oldBody != null)
	{
		scroll = oldBody.scrollTop;
	}
	menuRoot.textContent = "";
	var panel = el("div", "gz-panel");
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
	body.scrollTop = scroll;
	updateRail();
}

function pluginMatches(info)
{
	var entry = pluginData[info.key];
	var enabled = entry != null && entry.enabled;
	if (menuFilter == "enabled" && !enabled)
	{
		return false;
	}
	if (menuFilter == "official" && info.source == "custom")
	{
		return false;
	}
	if (menuFilter == "custom" && info.source != "custom")
	{
		return false;
	}
	if (menuSearch == "")
	{
		return true;
	}
	var text = (info.name + " " + info.description + " " + info.author + " " + info.tags.join(" ")).toLowerCase();
	return text.indexOf(menuSearch.toLowerCase()) != -1;
}

function renderPluginsTab(body)
{
	var tools = el("div", "gz-row gz-tools");
	var search = el("input", "gz-input gz-grow");
	search.placeholder = "Search plugins...";
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
	var filters = [["all", "All"], ["enabled", "Enabled"], ["official", "Official"], ["custom", "Custom"]];
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
	body.appendChild(tools);
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
	for(var i = 0;i<boot.plugins.length;i++)
	{
		var info = boot.plugins[i];
		if (!pluginMatches(info))
		{
			continue;
		}
		shown++;
		list.appendChild(buildPluginCard(info));
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
	var top = el("div", "gz-card-top");
	var text = el("div", "gz-card-text");
	var title = el("div", "gz-card-title");
	title.appendChild(el("span", "", info.name));
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
		text.appendChild(el("div", "gz-card-desc", info.description));
	}
	var meta = el("div", "gz-card-meta");
	if (info.author)
	{
		meta.appendChild(el("span", "", "by " + info.author));
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
		gear.title = "Settings";
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
		pendingReload = true;
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
			ui.toast.success(files.length + " plugin(s) added");
			pendingReload = true;
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
			ui.toast.success("Imported " + result.plugins + " plugin(s) and " + result.data + " plugin data entries");
			pendingReload = true;
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
	name.placeholder = "file name, e.g. myplugin.js";
	var code = el("textarea", "gz-input gz-code");
	code.placeholder = "// @name My plugin\n// @id myplugin\n// @description ...\n// @author ...\n// @tags ...";
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
			ui.toast.success("Plugin saved");
			pendingReload = true;
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
				if (!confirm("Delete " + info.name + "?"))
				{
					return;
				}
				ipcCall("deleteCustom", { key: info.key }).then(function()
				{
					delete pluginData[info.key];
					pendingReload = true;
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
	configRow(general, "Menu key", "Opens this menu", keyButton);
	configRow(general, "Auto update plugins", "Check the registry on every start", makeToggle(boot.config.autoUpdatePlugins == true, function(on)
	{
		setConfig({ autoUpdatePlugins: on });
	}));
	configRow(general, "Unlock FPS", "Removes the frame rate cap (needs restart)", makeToggle(boot.config.unlockFps == true, function(on)
	{
		setConfig({ unlockFps: on });
		showToast("Restart GaziClient to apply", "info", { label: "Restart", run: function() { ipcCall("restart"); } });
	}));
	configRow(general, "Ad blocker", "Blocks ads and trackers (needs restart)", makeToggle(boot.config.adblock != false, function(on)
	{
		setConfig({ adblock: on });
		queueBranding();
		showToast("Restart GaziClient to apply", "info", { label: "Restart", run: function() { ipcCall("restart"); } });
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

	var sources = el("div", "gz-section");
	sources.appendChild(el("div", "gz-section-title", "Plugin sources"));
	var registries = el("textarea", "gz-input gz-code gz-short");
	registries.value = (boot.config.registries || []).join("\n");
	registries.spellcheck = false;
	registries.onchange = function()
	{
		var list = registries.value.split("\n").map(function(line) { return line.trim(); }).filter(function(line) { return line != ""; });
		setConfig({ registries: list });
	};
	sources.appendChild(el("div", "gz-option-desc", "Registry base URLs, one per line (later ones override earlier ones)"));
	sources.appendChild(registries);
	var dev = el("input", "gz-input");
	dev.placeholder = "e.g. C:\\Users\\me\\blockyfish (folder with registry.json)";
	dev.value = boot.config.devPluginsPath || "";
	dev.onchange = function()
	{
		setConfig({ devPluginsPath: dev.value.trim() }).then(function()
		{
			pendingReload = true;
			reloadPluginList();
		});
	};
	sources.appendChild(el("div", "gz-option-desc", "Local plugin repo: loads plugins straight from disk, overrides the registry"));
	sources.appendChild(dev);
	var update = el("button", "gz-btn gz-btn-accent", "Update plugins now");
	update.onclick = function()
	{
		update.disabled = true;
		update.textContent = "Updating...";
		ipcCall("refresh").then(function(result)
		{
			ui.toast.success(result.updated.length + " updated, " + result.total + " in registry" + (result.failed.length>0 ? ", " + result.failed.length + " failed" : ""));
			if (result.updated.length>0)
			{
				pendingReload = true;
			}
			reloadPluginList();
		}, function(error)
		{
			ui.toast.error(String(error));
			renderMenu();
		});
	};
	sources.appendChild(update);
	body.appendChild(sources);

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
		if (confirm("This logs you out of Deeeep.io and clears its cache. Continue?"))
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

function renderAboutTab(body)
{
	var box = el("div", "gz-about");
	var logo = el("img", "gz-about-logo");
	logo.src = boot.logoDark;
	box.appendChild(logo);
	box.appendChild(el("div", "gz-section-title", "GaziClient " + boot.version));
	box.appendChild(el("div", "gz-option-desc", "Rust + WebView2 client for Deeeep.io, compatible with Blockyfish plugins."));
	var enabled = 0;
	for(var key in pluginData)
	{
		if (pluginData[key] && pluginData[key].enabled)
		{
			enabled++;
		}
	}
	box.appendChild(el("div", "gz-option-desc", boot.plugins.length + " plugins installed, " + enabled + " enabled. Menu key: " + keyLabel(boot.config.menuKey)));
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
	grip.title = "Drag";
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
			button.title = spec[1];
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
	button.title = "GaziClient (" + keyLabel(boot.config.menuKey) + ")";
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
	ensureWindowChrome();
	ensureModeButton();
	ensureRail();
	var modesRow = document.querySelector(".modes-row");
	var home = modesRow != null && modesRow.offsetParent != null;
	document.documentElement.classList.toggle("gz-home", home);
	document.documentElement.classList.toggle("gz-adblock", boot.config.adblock != false);
	document.documentElement.classList.toggle("gz-theme", boot.config.theme != false);
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
	if (choice == "random" && !document.hidden && backgroundList != null && document.documentElement.classList.contains("gz-home"))
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
	if (choice == "off" || home == null)
	{
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

function startPlugins()
{
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
		}
		nativeSetTimeout(tick, pluginsStarted ? 500 : 100);
	}
	tick();
}

onEvent("pluginsChanged", function()
{
	pendingReload = true;
	reloadPluginList();
});

onEvent("pluginsUpdated", function(result)
{
	if (result.updated.length == 0)
	{
		return;
	}
	reloadPluginList();
	showToast(result.updated.length + " plugin update(s) downloaded", "info", { label: "Reload", run: function() { location.reload(); } });
});

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
	pluginData = data.data || {};
	window.gazi.version = data.version;
	waitForGame();
}, function(error)
{
	console.error("[GaziClient] boot failed", error);
});
