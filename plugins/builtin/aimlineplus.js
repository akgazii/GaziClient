// @name Aim Line+
// @id aimlineplus
// @description Line added to Beaked. Thresher and GPO now has a unique line, Tresher's line it comes out from behind, And GPO have Circle for where it will land, it is always visible.
// @author Akgazi⁠​‌‌​​​​‌​‌‌​‌​‌‌​‌‌​​‌‌‌​‌‌​​​​‌​‌‌‌‌​‌​​‌‌​‌​​‌​‌‌​‌​​‌⁠

const geometry1 = new PIXI.Geometry()
    .addAttribute(
        'aVertexPosition', 
        [
            -2, 0,    // tl
            2, 0,    // tr
            2, -1000, // br
            -2, -1000,  // bl
        ],  
        2,  
    ) 
    .addAttribute(
        'aColor', 
        [
            121, 0, 0, // tl
            0, 13, 0,  // tr
            0, 0, 206, // br
            0, 0, 0,   // bl
        ],
        3, 
    ) 
    .addAttribute(
        'aAlpha',  
        [
            1, // tl
            1, // tr
            0, // br
            0, // bl
        ], 
        1,  
    )  
    .addIndex([
        2, 1, 0, // first triangle
        3, 2, 0, // second triangle
    ]); 

const geometry2 = new PIXI.Geometry()  
    .addAttribute(
        'aVertexPosition', 
        [
            2, 0,    // tl
            -2, 0,     // tr
            -2, 1000, // br
            2, 1000,// bl
        ],  
        2,
    )  
    .addAttribute(
        'aColor', 
        [
            121, 0, 0, // tl
            0, 13, 0,  // tr
            0, 0, 206, // br
            0, 0, 0,   // bl
        ],  
        3,
    )  
    .addAttribute(
        'aAlpha', 
        [
            1, // tl
            1, // tr
            0, // br
            0, // bl
        ], 
        1,  
    )
    .addIndex([
        2, 1, 0, // first triangle
        3, 2, 0, // second triangle
    ]);

const shader = PIXI.Shader.from(`
    precision mediump float;
    attribute vec2 aVertexPosition;
    attribute vec3 aColor;
    attribute float aAlpha;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    }
	`, `
	precision mediump float;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        gl_FragColor = vec4(vColor, 1.0) * vAlpha;
    }
`);

const includedAnimals = [0, 61, 93, 94, 96, 113, 101, 106, 10, 98, 42];  

let currentFishLevel = -1;  
let aimMarker; 
const createAimMarker = () => {  
    if (typeof game?.currentScene?.myAnimal?.visibleFishLevel === "undefined") {
        currentFishLevel = -1;  
        return; 
    } 
    if (game.currentScene.myAnimal.visibleFishLevel === currentFishLevel) return; 
    currentFishLevel = game.currentScene.myAnimal.visibleFishLevel; 
    if (!includedAnimals.includes(currentFishLevel)) return;  

    if (aimMarker) { 
        aimMarker.destroy();  
    }  

    if (currentFishLevel === 106 ) {
        const radius = 40;  
        const offsetY = -500;  
        const circleGraphics = new PIXI.Graphics(); 
        circleGraphics.beginFill(0xff0000, 0.5);  
        circleGraphics.drawCircle(0, offsetY, radius); 
        circleGraphics.endFill(); 
        aimMarker = circleGraphics;  
        aimMarker.renderable = true;  
    } else { 

        if (currentFishLevel === 101) {  
            aimMarker = new PIXI.Mesh(geometry2, shader); 
        }

        else { 
            aimMarker = new PIXI.Mesh(geometry1, shader);
        }  
        aimMarker.renderable = false;
    }

    game.currentScene.myAnimal.children[1].addChild(aimMarker); 
};  

let game;
blockyfish.addEventListener("gameInit", ({ game: _game }) => {  
    game = _game; 
});

setInterval(() => {  
    createAimMarker(); 
}, 500);

window.addEventListener(
    "keydown",
    (e) => {
        try {
            if (e.ctrlKey || e.metaKey) { 
                if (currentFishLevel !== 106) {
                    aimMarker.renderable = true;  
                } 
            } 
        } catch { }  
    }, 
    false
); 
window.addEventListener(
    "keyup",
    (e) => { 
        try { 
            if (!e.ctrlKey && !e.metaKey) {
                if (currentFishLevel !== 106) { 
                    aimMarker.renderable = false; 
                }  
            }
        } catch { }  
    },
    false
); 