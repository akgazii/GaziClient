
interface Blockyfish {
	/** EXAMPLE */
	// addEventListener(event: "eventName", listener: (event: Event) => void): void;

	/** Emitted when the game object is loaded */
	addEventListener(event: "gameInit", listener: (event: Event & { game: Game }) => void): void;

	/** Reloads evolution options in PD  */
	reloadEvolutionOptions: () => void;

	/** Sends a boost packet */
	boost: () => void;

	/** Sends a half charged boost packet. This activates a "yellow" charged boost */
	halfChargedBoost: () => void;

	/** Sends a charged boost packet. This activates a "red" charged boost */
	chargedBoost: () => void;

	/** Sends a special boost packet that makes most walking animals jump super high. Doesn't work on walking animals with red charged boost (e.g. coco, hermit, etc.) */
	superJump: () => void;

	/**
	 * Returns an encoded byte packet
	 *
	 * \`\`\`js
	 * // send a byte packet to send an emote
	 * game.socketManager.sendBytePacket(
	 *     blockyfish.encodeBytePacket(
	 *         gameState.token.value, // Packet token
	 *         ActionPacket.Emote, // Packet type
	 *         Emotes.HeartPenguin // Packet data
	 *     ),
	 * );
	 * \`\`\`
	 */
	encodeBytePacket: (token: string, packet: number, data?: string) => ArrayBuffer;

	/** Sends a custom scaling boost packet */
	scalingBoost: (amount: number) => void;

	/** Sends a custom boost packet */
	sendBoostPacket: (packetType: number, amount: number) => void;

	/**
	 * Used with byte packets
	 * \`\`\`js
	 * // send a byte packet to send an emote
	 * game.socketManager.sendBytePacket(
	 *     blockyfish.encodeBytePacket(
	 *         gameState.token.value, // Packet token
	 *         ActionPacket.Emote, // Packet type
	 *         Emotes.HeartPenguin // Packet data
	 *     ),
	 * );
	 * \`\`\`
	 */
	ActionPacket: {
		Boost: 1;
		Skill: 2;
		QuitRoom: 3;
		SecondaryAbility: 4;
		ScalingBoost: 5;
		IsChargingBoost: 6;
		StopChargingBoost: 7;
		HumpbackSong: 8;
		ChangeSkin: 9;
		LogOut: 10;
		ShowUser: 11;
		BlockedDamage: 12;
		ReturnedDamage: 13;
		MeleeAttack: 14;
		SpitBones: 15;
		BullsharkScar: 16;
		Emoji: 17;
		Emote: 18;
		Chat: 19;
		Request: 20;
		FiddlerScore: 21;
	};

	/**
	 * Used with string packets and as a doRequest response type
	 * \`\`\`js
	 * // send a string packet to evolve to crab
	 * game.socketManager.sendStringPacket(
	 *     stringify({
	 *         p: GeneralPacket.Evolution, // packet type
	 *         e: Animals.Crab // packet data
	 *     }),
	 * );
	 * \`\`\`
	 */
	GeneralPacket: {
		Play: 1;
		MoveToXY: 2;
		Action: 3;
		ChatMessage: 4;
		Login: 6;
		Evolution: 7;
		Ping: 8;
		SelectServer: 10;
		Request: 11;
		Click: 12;
		PointAngle: 14;
		CreateTribe: 15;
		QuitTribe: 16;
		RequestTribeInfo: 17;
		JoinTribeRequest: 18;
		AcceptTribeJoinRequest: 19;
		RefuseTribeJoinRequest: 20;
		TribeKick: 21;
		ReSelectServer: 22;
		ClientReady: 23;
		ClientGameSession: 24;
		VerifiedAction: 25;
		UpdateFish: 101;
		UpdateFood: 102;
		UpdateDamageableFood: 104;
		ChatMessages: 105;
		Terrains: 106;
		NewEntity: 107;
		UpdateHideSpaces: 108;
		PlayHistory: 110;
		Choices: 111;
		ServerMessage: 109;
		FishPositions: 112;
		Kills: 113;
		Ranking: 103;
		Response: 114;
		Attack: 115;
		LockOn: 116;
		Xp: 117;
		HealthDelta: 118;
		EntityAction: 119;
		TribeInfo: 120;
		MinimapPositions: 121;
		CPacket: 122;
		UpdateEntities: 123;
		HeatMap: 124;
		CustomAnimalData: 125;
		PDPlayers: 126;
		PDState: 127;
		PlayerData: 128;
		PDRanking: 129;
		OVOPlayers: 130;
		GameSession: 131;
		LocatedEvent: 132;
		RoomPlayers: 244;
		WinnerPlayer: 245;
		Message: 246;
		SimpleNotification: 247;
		PlayerStatus: 248;
		Room: 249;
		Welcome: 250;
		MapPacket: 251;
		RoomInfo: 252;
		ServerStats: 253;
		ServerInfo: 254;
		Servers: 255;
		Pong: 1020;
		Entities: 1030;
		PlayStats: 1110;
		Move: 3000;
		Key: 7000;
	};

	/**
	 * Used with doRequest
	 * \`\`\`js
	 * // send a request to create a team in TFFA
	 * game.socketManager.sendStringPacket(
	 *     RequestPacket.CreateTribe // Request type
	 *     "name", // Request data
	 *     GeneralPacket.TribeInfo // Response type
	 * );
	 * \`\`\`
	 */
	RequestPacket: {
		JoinRoom: 1;
		CreateRoom: 2;
		FindMatch: 3;
		GetServerInfo: 4;
		GetServerStats: 5;
		ClientReady: 6;
		Reconnect: 7;
		Play: 8;
		Ping: 9;
		AnimalAction: 10;
		ChangeSide: 11;
		ChooseAnimal: 12;
		GetPlayerData: 13;
		CreateTribe: 14;
		GetTribeInfo: 15;
		JoinTribe: 16;
		TribeKick: 17;
		TribeQuit: 18;
		CRequest: 19;
	};

	/** Animal IDs */
	Animals: {
		Clownfish: 0;
		Crab: 1;
		Jellyfish: 2;
		Squid: 3;
		Seagull: 4;
		Ray: 5;
		Beaver: 6;
		Penguin: 7;
		Hammerhead: 8;
		Dolphin: 9;
		Shark: 10;
		Orca: 11;
		Whale: 12;
		Worm: 13;
		Anglerfish: 14;
		LeopardSeal: 15;
		Blobfish: 16;
		KingCrab: 17;
		Pollock: 18;
		SeaTurtle: 19;
		Oarfish: 20;
		Octopus: 21;
		GiantSquid: 22;
		Narwhal: 23;
		Cachalot: 24;
		PolarBear: 25;
		Lamprey: 26;
		Pelican: 27;
		WhaleShark: 28;
		Remora: 29;
		Marlin: 30;
		Sunfish: 31;
		Stonefish: 32;
		Ghost: 33;
		Crocodile: 34;
		ElectricEel: 35;
		Frog: 36;
		Hippo: 37;
		Manatee: 38;
		SnappingTurtle: 39;
		Piranha: 40;
		Snake: 41;
		BaldEagle: 42;
		Lionfish: 43;
		Dragonfly: 44;
		MantaRay: 45;
		ElephantSeal: 46;
		Lanternfish: 47;
		SleeperShark: 48;
		GulperEel: 49;
		GiantIsopod: 51;
		BabyPenguin: 52;
		Seal: 53;
		Icefish: 54;
		Barreleye: 55;
		Dragonfish: 56;
		HumboldtSquid: 57;
		SeaLion: 58;
		FlyingFish: 59;
		Duck: 60;
		GoblinShark: 61;
		Catfish: 62;
		LittleAuk: 63;
		Pufferfish: 65;
		TigerShark: 66;
		LionsManeJellyfish: 67;
		Anaconda: 68;
		BobbitWorm: 69;
		MahiMahi: 70;
		Walrus: 71;
		FrilledShark: 72;
		SawFish: 73;
		MantisShrimp: 74;
		Axolotl: 75;
		Bat: 76;
		Firefly: 77;
		BlindCavefish: 78;
		Crayfish: 79;
		GoliathBullfrog: 80;
		GiantSalamander: 81;
		AlligatorSnappingTurtle: 82;
		GiantSoftshellTurtle: 84;
		Olm: 85;
		AlligatorGar: 86;
		HumpbackWhale: 87;
		Sardine: 88;
		HorseshoeCrab: 89;
		BaskingShark: 90;
		ColossalSquid: 91;
		ClimbingCaveFish: 92;
		Archerfish: 93;
		SeaOtter: 94;
		Lobster: 95;
		Barracuda: 96;
		Frogfish: 97;
		MorayEel: 98;
		WobbegongShark: 99;
		LeatherbackTurtle: 100;
		ThresherShark: 101;
		AtlanticTorpedo: 102;
		CoconutCrab: 103;
		BullShark: 104;
		HermitCrab: 105;
		GiantPacificOctopus: 106;
		BeakedWhale: 107;
		MegamouthShark: 108;
		BelugaWhale: 109;
		VampireSquid: 110;
		Halibut: 111;
		BowheadWhale: 112;
		JapaneseSpiderCrab: 113;
		CookiecutterShark: 114;
		SarcasticFringehead: 115;
		Parrotfish: 116;
		WolfEel: 117;
		GiantSinophore: 118;
		Coelacanth: 119;
		NapoleonWrasse: 120;
		FiddlerCrab: 121;
		Platypus: 122;
		Capybara: 123;
		Lungfish: 124;
		Arapaima: 125;
		GiantFreshwaterStingray: 126;
		WelsCatfish: 127;
	};

	/** Emote IDs */
	Emotes: {
		ArcherKiss: 1;
		BaskingPog: 2;
		ColdiceFish: 3;
		ConfuzzledLeatherback: 4;
		CoolOcto: 5;
		CoolSnapper: 6;
		CrossRedJelly: 7;
		DizzyLancetfish: 8;
		DroolSunfish: 9;
		EagleSob: 10;
		EpicSleeperPain: 11;
		EvilLaughSnapper: 12;
		FacepalmCsquid: 13;
		FearBull: 14;
		FlushedTorpedo: 15;
		FrogfishVomit: 16;
		GoblinGasp: 17;
		HappyClownfish: 18;
		HeartPenguin: 19;
		HolyMolaSunfish: 20;
		HugNarwhal: 21;
		JellyShrug: 22;
		JoyfulThresher: 23;
		LionfishLmp: 24;
		LmaoHumboldt: 25;
		MahiMadi: 26;
		MahiSadi: 27;
		MeGustaStonefish: 28;
		MindblownPuffer: 29;
		NaniShark: 30;
		OarfishSpook: 31;
		PartyOtter: 32;
		ProShark: 33;
		RelievedSeaturtle: 34;
		SadOrca: 35;
		SeaStarEyed: 37;
		SealOfApproval: 36;
		SleepyShark: 38;
		ThresherGrimace: 39;
		ThumbsUpWhale: 40;
		TrollerBear: 41;
		UwuSealion: 42;
		WalrusYawn: 43;
		WhoopsyDolphin: 44;
		WinkingSeaturtle: 45;
	};
}
interface BlockyfishPlugin {
	/**
	 * The name of the plugin
	 */
	name: string;

	/**
	 * Register a keybind to the Blockyfish keybinds system
	 */
	registerKeybind: (keybindName: string, defaultKey: string) => void;
	/**
	 * Get the key that a keybind is bound to
	 */
	getKeybind: (keybindName: string) => string;
	/**
	 * Check if a keybind is pressed
	 */
	isKeybindDown: (keybindName: string) => boolean;
	/**
	 * Register an event listener for when a keybind is pressed
	 */
	onKeybindDown: (keybindName: string, callback: Function) => void;
	/**
	 * Register an event listener for when a keybind is released
	 */
	onKeybindUp: (keybindName: string, callback: Function) => void;

	/**
	 * Register a setting
	 */
	registerSetting({ name, description, type, defaultValue }: { name: string; description: string; type: "string"; defaultValue: string }): void;
	registerSetting({ name, description, type, defaultValue }: { name: string; description: string; type: "number"; defaultValue: number }): void;
	registerSetting({ name, description, type, defaultValue }: { name: string; description: string; type: "boolean"; defaultValue: boolean }): void;
	registerSetting({
		name,
		description,
		type,
		defaultValue,
		choices,
	}: {
		name: string;
		description: string;
		type: "list";
		defaultValue: string | number;
		choices: (string | number)[];
	}): void;
	/**
	 * Get the value of a setting
	 */
	getSetting: (name: string) => string | number | boolean;
	/**
	 * Set the value of a setting
	 */
	setSetting: (name: string, value: string | number | boolean) => void;

	storage: {
		set: (key: string, value: any) => void;
		get: (key: string) => any;
	};

	/**
	 * Get the path of the folder that files will be saved to
	 */
	getSaveFolder(): string;
	/**
	 * Set the path of the folder that files will be saved to
	 */
	setSaveFolder(name: string): void;
	/**
	 * Save a file to the plugin's save folder
	 *
	 * Use \`plugin.setSaveFolder\` to set the name of the folder
	 */
	saveFile(fileName: string, content: string): Promise<boolean>;
}

declare const blockyfish: Blockyfish;
declare const plugin: BlockyfishPlugin;

interface Game {
	app: App;
	autoChangedSettings: boolean;
	fpsImprovementStage: number;
	gameContainer: Record<string, unknown>;
	gameMode: number;
	lastBackButton: number;
	lowFpsSec: number;
	performanceManager: Record<string, unknown>;
	renderer: Record<string, unknown>;
	secondTick: number;
	viewport: Record<string, unknown>;
	currentScene: GameScene;
	socketManager: SocketManager;
	inputManager: InputManager;
	_watchers: Array<Function>;
	// prototype
	changeResolution: Function;
	createGameScene: Function;
	destroy: Function;
	destroyStatics: Function;
	getMaxScreenSize: Function;
	handleWindowsBlur: Function;
	handleWindowsFocus: Function;
	init: Function;
	initPerformanceStatus: Function;
	initPixi: Function;
	initWatchers: Function;
	initializeViewport: Function;
	loaded: Function;
	recreateCanvas: Function;
	removeWatchers: Function;
	resize: Function;
	resizeBgImage: Function;
	setCordova: Function;
	setCurrentScene: Function;
	showToast: Function;
	update: Function;
	updateViewportClamp: Function;
}
// TODO: Finish GameScene and SocketManager
interface GameScene {
	aboveAnimalLayer: Record<string, unknown>;
	aboveBgPlatformsContainer: Record<string, unknown>;
	alpha: number;
	animalClasses: Record<string | number, string>;
	animalTextsContainer: Record<string, unknown>;
	belowAnimalsContainer: Record<string, unknown>;
	bgPlatformsContainer: Record<string, unknown>;
	canvasRecreateCallbacks: Array<Function>;
	children: Array<Record<string, unknown>>;
	cullArea: any;
	cullable: boolean;
	displayOrder: number;
	emotesLayer: Record<string, unknown>;
	filterArea: any;
	filters: any;
	foodClasses: Record<string | number, string>;
	game: Game;
	graphicsContainer: Record<string, unknown>;
	group: Record<string, unknown>;
	hideMessageTimeout: number;
	hideSpaceClasses: Record<string | number, string>;
	hideSpaces1Layer: Record<string, unknown>;
	hideSpaces2Layer: Record<string, unknown>;
	higherPropsContainer: Record<string, unknown>;
	insertChildrenAfterActive: boolean;
	insertChildrenBeforeActive: boolean;
	isLayer: boolean;
	isMask: boolean;
	isSprite: boolean;
	justAboveAnimalsContainer: Record<string, unknown>;
	levelMessage: Record<string, unknown>;
	lowPropsContainer: Record<string, unknown>;
	map: Record<string, unknown>;
	minimap: Record<string, unknown>;
	minimapCacheTimeout: any;
	myAnimals: Array<Animal>;
	parent: Record<string, unknown>;
	platformsContainer: Record<string, unknown>;
	playedFishLevels: Array<number>;
	propsContainer: Record<string, unknown>;
	radar: Record<string, unknown>;
	renderable: boolean;
	resizeCallbacks: Array<Function>;
	secondTick: number;
	shadowContainer: Record<string, unknown>;
	sortDirty: boolean;
	sortableChildren: boolean;
	subPlatformsContainer: Record<string, unknown>;
	subSubPlatformsContainer: Record<string, unknown>;
	tempDisplayObjectParent: any;
	topPlatformsContainer: Record<string, unknown>;
	transform: Record<string, unknown>;
	uiContainer: Record<string, unknown>;
	uiManager: UIManager;
	uncollidablePlatformsContainer: Record<string, unknown>;
	updateMessagesTick: number;
	updateOrder: number;
	viewedFishLevels: Record<string | number, boolean>;
	viewportSizeChangeCallbacks: Array<Function>;
	visible: boolean;
	worldAlpha: number;
	foodGlowContainer: Record<string, unknown>;
	foodContainer: Record<string, unknown>;
	animalsContainer: Record<string, unknown>;
	barsLayer: Record<string, unknown>;
	namesLayer: Record<string, unknown>;
	chatContainer: Record<string, unknown>;
	terrainManager: Record<string, unknown>;
	entityManager: EntityManager;
	ceilingsContainer: Record<string, unknown>;
	viewingGhosts: boolean;
	setFlash: (flash: boolean) => void;
	chatMessages: Array<Record<string, unknown>>;
	_activeChildren: Array<unknown>;
	_activeParentLayer: any;
	_activeStageParent: Record<string, unknown>;
	_areaLeadersEntityId: Record<string, unknown>;
	_bounds: Record<string, unknown>;
	_boundsID: number;
	_boundsRect: any;
	_destroyed: boolean;
	_enabledFilters: any;
	_events: Record<string, unknown>;
	_eventsCount: number;
	_flash: any;
	_flashed: boolean;
	_lastSortedIndex: number;
	_localBounds: any;
	_localBoundsRect: any;
	_mapMaximized: boolean;
	_mask: any;
	_maskRefCount: number;
	_rankingLeaderEntityId: any;
	_socketBindedPacketIds: Array<number>;
	_sortedChildren: Array<Record<string, unknown>>;
	_tempChildren: Array<Record<string, unknown>>;
	_tempLayerParent: any;
	_watchers: Array<Function>;
	_zIndex: number;
	__v_skip: boolean;
	eventMode: string;
	interactive: boolean;
	angle: number;
	cacheAsBitmap: boolean;
	cacheAsBitmapMultisample: any;
	cacheAsBitmapResolution: any;
	clearColor: any;
	destroyed: boolean;
	localTransform: Record<string, unknown>;
	mask: any;
	pivot: Record<string, unknown>;
	position: Record<string, unknown>;
	rotation: number;
	scale: Record<string, unknown>;
	skew: Record<string, unknown>;
	sortPriority: number;
	useDoubleBuffer: boolean;
	useRenderTexture: boolean;
	width: number;
	height: number;
	worldTransform: Record<string, unknown>;
	worldVisible: boolean;
	x: number;
	y: number;
	zIndex: number;
	_tempDisplayObjectParent: Record<string, unknown>;
	showMessagePopup: (message: string, duration: number, showclickiforinfoithink: number) => void;
	// prototype (finally)
	chatMessageBeforeAdd: Function;
	getNearbyTribes: Function;
	handleChatMessage: Function;
	handleRanking: Function;
	handleTribeInfo: Function;
	handleTribeJoinRequest: Function;
	setCurrentTribe: Function;
	setSocketBindings: Function;
	getMyPos: Function;
	getMap: Function;
	getPosition: Function;
	getCurrentArea: Function;
	// im not doing allat, you dont need this fuck documentation for anything
}

interface Vec2 {
	x: number;
	y: number;
}

interface Entity {
	gameScene: GameScene;
	actionBarRemoveLeft: number;
	alpha: number;
	bigDiffElapsed: number;
	body: Record<string, unknown>;
	bodySize: Vec2;
	chatMessagesLeft: number;
	children: Array<Record<string, unknown>>;
	config: Record<string, unknown>;
	cullArea: any;
	cullable: boolean;
	displayOrder: number;
	entityData: Record<string, unknown>;
	hpPercentage?: number;
	id: number;
	inner: Record<string, unknown>;
	interactiveChildren: boolean;
	isMask: boolean;
	isSprite: boolean;
	justSetPosition: boolean;
	mine: boolean;
	mustReducePosDifference: boolean;
	needsPositionCorrection: boolean;
	originalContainer: Record<string, unknown>;
	parent: Record<string, unknown>;
	parentEntity: any;
	placingEnabled: boolean;
	placingMode: boolean;
	propData: Record<string, unknown>;
	removed: boolean;
	renderable: boolean;
	secondTick: number;
	settings: Record<string, unknown>;
	size: Vec2;
	sortDirty: boolean;
	sortableChildren: boolean;
	sprite: Record<string, unknown>;
	stealth: any;
	targetAngle: number;
	targetPosition: Vec2;
	targetPositionSetElapsed: number;
	targetVelocity: Vec2;
	tmpDisplayObjectParent: any;
	text: Record<string, unknown>;
	texture: Record<string, unknown>;
	transform: Record<string, unknown>;
	type: number;
	updateOrder: number;
	visible: boolean;
	worldAlpha: number;
	_activeParentLayer: any;
	_attachAnchor: Vec2;
	_attachMode: any;
	_bounds: Record<string, unknown>;
	_boundsID: number;
	_boundsRect: any;
	_clearEmojiTimeout: any;
	_dead: boolean;
	_destroyed: boolean;
	_emoji: any;
	_emote: any;
	_enabledFilters: any;
	_events: Record<string, unknown>;
	_eventsCounts: number;
	_fixed: boolean;
	_fixedTo: any;
	_fixedToEntity: any;
	_holdedEntities: Array<any>;
	_lastSortedIndex: number;
	_localBounds: any;
	_localBoundsRect: any;
	_mask: any;
	_maskRefCount: any;
	_sleeping: boolean;
	_standing: boolean;
	_zIndex: number;
	eventMode: string;
	interactive: boolean;
	angle: number;
	attachAnchor: Vec2;
	attachMode: string;
	destroyed: boolean;
	fixed: boolean;
	fixedTo: any;
	width: number;
	height: number;
	localTransform: Record<string, unknown>;
	mask: any;
	pivot: Record<string, unknown>;
	position: Record<string, unknown>;
	rotation: number;
	scale: Record<string, unknown>;
	skew: Record<string, unknown>;
	sleeping: boolean;
	worldTransform: Record<string, unknown>;
	worldVisible: boolean;
	x: number;
	y: number;
	zIndex: number;
}

interface Animal extends Entity {
	aiType: number;
	baseAnimalSizeRation: Record<string, unknown>;
	deleteUserTimeout: any;
	entityName: string;
	fishData: Record<string, unknown>;
	fishLevelData: Record<string, unknown>;
	healthBar: Record<string, unknown>;
	hidingEase: any;
	hidingInId: number;
	hookSprite: any;
	isHiding: boolean;
	level: number;
	nameIcon: any;
	origScale: Vec2;
	originalContainer: Record<string, unknown>;
	parent: Record<string, unknown>;
	parentEntity: any;
	playerRoomId: number;
	scoreText: Record<string, unknown>;
	side: any;
	skin: any;
	skinId: any;
	spawnProtectionAnimation: Record<string, unknown>;
	stunSprite: any;
	team: any;
	teamId: number;
	tribeId: number;
	tribeInfo: any;
	tribeRole: any;
	userBox: any;
	xp: number;
	_ally: number;
	_bloodDropTick: number;
	_boosting: boolean;
	_bouncing: boolean;
	_currentArea: number;
	_currentInk: any;
	_effects: number;
	_emitBubbleTick: number;
	_grabbedEntityId: number;
	_grabbing: boolean;
	_holded: boolean;
	_holdedAnimalsHealthbarsContainer: Record<string, unknown>;
	_holdedEntities: Array<Entity | Animal>;
	_holdingSize: number;
	_inksTick: number;
	_oxygen: number;
	_preasure: number;
	_removeScarsTimeout: number;
	_rotationSpeedMultiplier: number;
	_salinity: number;
	_scars: Array<any>;
	_score: number;
	_silenced: boolean;
	_spawnProtected: boolean;
	_statFlags: number;
	_temperature: number;
	_usingSkill: boolean;
	_xpLeft: number;
	_xpPercentage: number;
	ally: boolean;
	boosting: boolean;
	bouncing: boolean;
	currentArea: number;
	destroyed: boolean;
	effects: number;
	grabbing: boolean;
	holdingSize: number;
	oxygen: number;
	preasure: number;
	holded: boolean;
	rotationSpeedMultiplier: number;
	salinity: number;
	score: number;
	silenced: boolean;
	spawnProtected: boolean;
	statFlags: number;
	temperature: number;
	usingSkill: boolean;
	visibleFishLevel: number;
	xpLeft: number;
	xpPercentage: number;
	// prototype
	affectedBy: Function;
	affectedByAny: Function;
	analyzeHoldedEntities: Function;
	boost: Function;
	calculateScale: Function;
	clearScars: Function;
	createName: Function;
	createSprite: Function;
	delete: Function;
	displayUser: Function;
	doAttack: Function;
	dropBlood: Function;
	emitBubble: Function;
	getAlphaWhenStealth: Function;
	getCachedSkinTexture: Function;
	getCurrentAssetName: Function;
	getDeepFov: Function;
	getEntityScale: Function;
	getSize: Function;
	setGrabbing: Function;
	setIsHiding: Function;
	setStanding: Function;
	showName: Function;
	// ok im done this is enough functions
}

interface UIManager {
	boosts: Record<string, unknown>;
	damageSplash: Record<string, unknown>;
	damageTween: any;
	findTargetTick: number;
	gameScene: GameScene;
	targetEntity?: Entity;
	targetId?: number;
	targetSprite?: any;
	// prototype
	destroy: Function;
	handleMyAnimalHealthDelta: Function;
	onResize: Function;
	setTargetId: Function;
	setUpDamageSplash: Function;
	update: Function;
	updateTarget: Function;
}

interface EntityManager {
	animalsByPlayerRoomId: Record<string | number, Array<Animal>>;
	ceilingsByFood: Map<any, any>;
	entitiesById: Record<string | number, Entity | Animal>;
	entitiesList: Array<Entity | Animal>;
	foodsByCeiling: Map<any, any>;
	gameScene: GameScene;
	animalsList: Array<Animal>;
	// prototype
	addEntity: Function;
	deleteEntity: Function;
	destroy: Function;
	getEntity: Function;
	getVisibleTribes: Function;
	handleHealthDelta: Function;
	hasEntity: Function;
	update: Function;
	updateEntity: Function;
}

interface SocketManager {
	sendStringPacket: Function;
	sendBytePacket: Function;
	getWs: Function;
	connect: Function;
	disconnect: Function;
	doRequest: Function;
	keepAlive: Function;
	ping: Function;
	removePacketCallback: Function;
	setPacketCallback: Function;
}

interface InputManager {
	chargingElapsed: number;
	game: Game;
	gameScene: GameScene;
	holdingShift: boolean;
	joystick: any;
	keyBindingsEnabled: boolean;
	keys: Array<Keybind>;
	lastBoostTime: number;
	lookAngle: number;
	mobileControlMode: number;
	mobileControlModeWatcher: Function;
	mobileControls: any;
	moveDirection: any;
	moveForce: any;
	oneTimeKeys: Array<Keybind>;
	pointerDown: boolean;
	pressElapsed: number;
	sentBoostElapsed: number;
	statusWatcher: Function;
	virtualPad: any;
	virtualPadScaleWatcher: Function;
	socketManager: SocketManager;
	// prototype
	addContinuosKey: Function;
	addOneTimeKey: Function;
	checkLookDirection: Function;
	destroy: Function;
	disableKeyBindings: Function;
	enableKeyBindings: Function;
	getLookAngle: Function;
	getMouseWorldPosition: Function;
	handleChatKey: Function;
	handleEmoteKey: Function;
	handleGhostSuicide: Function;
	handleJoystickMove: Function;
	handleJoystickUp: Function;
	handleMaximizeMap: Function;
	handleMutePress: Function;
	handleNumberPress: Function;
	handleShowLevelMessage: Function;
	handleShowMenu: Function;
	initializeJoystick: Function;
	initializeMobileControls: Function;
	initializeViewportEvents: Function;
	initializeVirtualPad: Function;
	resize: Function;
	sceneChanged: Function;
	sendBoost: Function;
	sendToServer: Function;
	setMobileControlMode: Function;
	setPointerDown: Function;
	shiftKeyDown: Function;
	shiftKeyUp: Function;
	spaceKeyDown: Function;
	spaceKeyUp: Function;
	update: Function;
	updateJoystick: Function;
	updateVirtualPad: Function;
	handleLongPress: Function;
}

interface Keybind {
	code: number;
	data: number;
	downHandler?: Function;
	enabled: boolean;
	isDown: boolean;
	isUp: boolean;
	pressCallback?: Function;
	releaseCallback?: Function;
	upHandler?: Function;
	// prototype
	destroy: Function;
	disable: Function;
	enable: Function;
	onDown: Function;
	onUp: Function;
}

interface App {
	cancelResize: Function;
	queueResize: Function;
	renderer: object;
	resize: Function;
	stage: object;
	start: Function;
	stop: Function;
	_resizeId: number;
	_resizeTo: number;
	_ticker: Function;
	screen: object;
	view: HTMLCanvasElement;
}

declare const game: Game;
interface Descriptor {
	get?: () => any;
	set?: (value: any) => void;
	value?: any;
	writable?: boolean;
	configurable: boolean;
	enumerable: boolean;
}

interface Reflect {
	defineProperty: (any: any, name: string, descriptor: Descriptor) => boolean;
	deleteProperty: (any: any, name: string) => boolean;
	apply: (func: Function, thisParam: any, args: Array<any>) => any;
	construct: (func: Function, args: Array<any>) => object;
	get: (any: any, name: string) => any;
	set: (any: any, name: string, value: any) => boolean;
	getOwnPropertyDescriptor: (any: any, name: string) => Descriptor;
	getPrototypeOf: (any: any) => object;
	has: (any: any, name: string) => boolean;
	isExtensible: (any: any) => boolean;
	ownKeys: (any: any) => Array<string>;
	preventExtensions: (any: any) => boolean;
	setPrototypeOf: (any: any, prototype: object) => boolean;
}

declare const hook: (object: object, name: string, handler: ProxyHandler<Function>) => void;
declare const getnative: (func: Function) => Function;
declare const ishooked: (func: Function) => boolean;
declare const restore: (object: object, name: string) => void;
declare const reflect: Reflect;

declare function hook(target: any, name: string, handler: ProxyHandler<any>): any;
declare function getnative<T extends Function>(fn: T): T;
declare function ishooked(fn: Function): boolean;
declare function restore(target: any, name: string): boolean;
declare const reflect: typeof Reflect;
declare const React: any;
declare const ReactDOM: any;
declare const PIXI: any;
declare const gameState: Record<string, { value: any; _value: any }>;
declare const ui: { toast: { success(text: string): void; error(text: string): void; info(text: string): void } };
declare const router: { getCurrent(): any; push(path: string): any };
declare const capturer: { screenshot(): string | null };
declare const DeeeepioButton: any;
declare const DeeeepioCustomButton: any;
declare const DeeeepioCheckbox: any;
declare const DeeeepioTextInput: any;
declare const DeeeepioDropdown: any;
declare const DeeeepioLoadingSpinner: any;
declare const Modal: any;
