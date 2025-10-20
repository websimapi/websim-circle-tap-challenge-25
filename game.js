import { hsl } from 'd3-color';
import { getHslStringForLevel, isAngleInArc, getComputedColors } from './utils.js';
import { initAudio, playSuccess, playFail, playStart, getAudioData } from './audio.js';

export const difficulties = {
    easy: { speed: 1.2 * Math.PI, size: 0.4, trackWidthFactor: 0.12 }, 
    medium: { speed: 1.5 * Math.PI, size: 0.25, trackWidthFactor: 0.07 },
    hard: { speed: 1.8 * Math.PI, size: 0.15, trackWidthFactor: 0.035 }
};

export class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.colors = getComputedColors();
        
        // Canvas/Drawing state
        this.devicePixelRatio = window.devicePixelRatio || 1;
        this.size = 0;
        this.radius = 0;
        this.lineWidth = 0;

        // Game state
        this.gameState = 'start';
        this.score = 0;
        this.angle = -Math.PI / 2;
        this.direction = 1;
        this.speed = 0;
        this.targetStartAngle = 0;
        this.targetSize = 0;
        this.lastFrameTime = 0;
        this.animationFrameId = null;
        this.currentDifficulty = 'easy';
        this.replayFrames = [];
        this.replayConfig = {};
        this.level = 0;
        this.tapsThisLevel = 0;
        this.tapsForNextLevel = 1;
        this.currentColorHsl = hsl(getHslStringForLevel(1));
        this.targetColorHsl = hsl(getHslStringForLevel(1));
        this.lastGameData = {};

        this.onGameOver = null;
        this.onScoreUpdate = null;
        this.onLevelUp = null;
    }

    resizeCanvas() {
        const parent = this.canvas.parentElement;
        const parentWidth = parent.offsetWidth;
        const parentHeight = parent.offsetHeight;

        let containerSize;

        // On landscape screens (like desktop), we want to simulate a portrait container
        // to keep the game feel consistent with mobile and fit for vertical video.
        if (parentWidth > parentHeight) {
            // Simulate a 9:16 aspect ratio container within the height of the screen.
            const simulatedWidth = parentHeight * (9 / 16);
            // If the simulated width is wider than the actual screen, just use the screen width.
            // Otherwise, use the simulated width. This creates a virtual "phone screen" area.
            containerSize = Math.min(simulatedWidth, parentWidth);
        } else {
            // On portrait screens (mobile), the width is the limiting factor.
            containerSize = parentWidth;
        }

        // Apply a scaling factor to the container size to determine the final canvas size.
        const canvasSize = containerSize * 0.9;
        
        this.canvas.style.width = `${canvasSize}px`;
        this.canvas.style.height = `${canvasSize}px`;

        this.size = canvasSize * this.devicePixelRatio;
        this.canvas.width = this.size;
        this.canvas.height = this.size;
        
        this.radius = this.size * 0.4;
        this.lineWidth = this.size * difficulties[this.currentDifficulty].trackWidthFactor;
        
        if (this.gameState !== 'playing') {
            this.draw();
        }
    }

    generateNewTarget() {
        this.targetStartAngle = Math.random() * Math.PI * 2;
    }

    start(difficulty) {
        this.currentDifficulty = difficulty;
        this.resizeCanvas();

        initAudio();
        playStart();
        
        const settings = difficulties[difficulty];
        this.speed = settings.speed;
        this.targetSize = settings.size;

        this.score = 0;
        this.angle = -Math.PI / 2;
        this.direction = 1;

        this.level = 1; // Start at level 1, not 0
        this.tapsThisLevel = 0;
        this.tapsForNextLevel = 1;
        
        this.currentColorHsl = hsl(getHslStringForLevel(1));
        this.targetColorHsl = hsl(getHslStringForLevel(1));

        this.generateNewTarget();
        
        this.gameState = 'playing';
        this.replayFrames = [];
        this.replayConfig = {
            difficulty: this.currentDifficulty,
            difficulties,
            colors: this.colors,
        };

        this.lastFrameTime = performance.now();
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));

        if (this.onScoreUpdate) this.onScoreUpdate(this.score);
        if (this.onLevelUp) this.onLevelUp(this.level, true); // Pass true to indicate initial level
    }

    gameOver() {
        playFail();
        this.gameState = 'gameover';
        
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        
        this.replayFrames.push({
            angle: this.angle,
            targetStartAngle: this.targetStartAngle,
            targetSize: this.targetSize,
            score: this.score,
            level: this.level, 
            targetColor: this.currentColorHsl.toString(),
            success: false,
            timestamp: performance.now(),
        });

        this.lastGameData = {
            score: this.score,
            level: this.level,
            difficulty: this.currentDifficulty,
            replayData: {
                frames: this.replayFrames,
                config: this.replayConfig,
            },
            timestamp: new Date().toISOString(),
        };

        if (this.onGameOver) this.onGameOver(this.lastGameData);
    }

    drawVisualizer() {
        const audioData = getAudioData();
        if (!audioData) return;

        const centerX = this.size / 2;
        const centerY = this.size / 2;
        const baseRadius = this.radius + this.lineWidth / 2;

        let bass = 0;
        // Average the first few bins for a bass/kick drum response
        for (let i = 0; i < 5; i++) {
            bass += audioData[i];
        }
        bass /= 5;

        const pulseAmount = (bass / 255); // Normalize to 0-1
        
        // Only draw if there's a noticeable beat
        if (pulseAmount > 0.1) {
            // Multiple expanding rings that bounce back
            const numRings = 3;
            const maxPulse = this.size * 0.4; // Extend much further into background
            
            for (let i = 0; i < numRings; i++) {
                const delay = i * 0.15; // Stagger the rings
                const adjustedPulse = Math.max(0, pulseAmount - delay);
                
                if (adjustedPulse > 0) {
                    // Create a bounce-back effect using a sine wave
                    const expandFactor = Math.sin(adjustedPulse * Math.PI);
                    const pulseRadius = baseRadius + (expandFactor * maxPulse * (1 - i * 0.2));
                    
                    this.ctx.beginPath();
                    this.ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
                    
                    // Create a gradient that fades from the circle outwards
                    const gradient = this.ctx.createRadialGradient(centerX, centerY, baseRadius, centerX, centerY, pulseRadius);
                    const opacity = adjustedPulse * (0.3 - i * 0.08); // Fade out outer rings
                    const pulseColor = this.currentColorHsl.copy({opacity: opacity});
                    
                    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
                    gradient.addColorStop(0.5, pulseColor.toString());
                    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    
                    this.ctx.fillStyle = gradient;
                    this.ctx.fill();
                }
            }
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.size, this.size);

        if (this.gameState === 'playing') {
            this.drawVisualizer();
        }

        this.ctx.save();
        this.ctx.translate(this.size / 2, this.size / 2);

        // Draw track
        this.ctx.beginPath();
        this.ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        this.ctx.strokeStyle = this.colors.secondary;
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.lineCap = 'butt';
        this.ctx.stroke();

        // Draw target zone
        if (this.targetSize > 0) {
            this.ctx.beginPath();
            this.ctx.arc(0, 0, this.radius, this.targetStartAngle, this.targetStartAngle + this.targetSize);
            this.ctx.strokeStyle = this.currentColorHsl.toString();
            this.ctx.lineWidth = this.lineWidth * 0.95;
            this.ctx.lineCap = 'round';
            this.ctx.stroke();
        }

        // Draw rotating line
        this.ctx.rotate(this.angle);
        this.ctx.beginPath();
        this.ctx.moveTo(this.radius - this.lineWidth / 2, 0);
        this.ctx.lineTo(this.radius + this.lineWidth / 2, 0);
        this.ctx.strokeStyle = this.colors.fail;
        this.ctx.lineWidth = this.lineWidth / 2.5;
        this.ctx.lineCap = 'butt';
        this.ctx.stroke();
        
        this.ctx.restore();
    }

    gameLoop(currentTime) {
        if (this.gameState !== 'playing') return;

        const deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;

        // Smooth color interpolation
        const lerpFactor = Math.min(deltaTime * 2.5, 1);
        this.currentColorHsl.h += (this.targetColorHsl.h - this.currentColorHsl.h) * lerpFactor;
        this.currentColorHsl.s += (this.targetColorHsl.s - this.currentColorHsl.s) * lerpFactor;
        this.currentColorHsl.l += (this.targetColorHsl.l - this.currentColorHsl.l) * lerpFactor;
        this.currentColorHsl.opacity += (this.targetColorHsl.opacity - this.currentColorHsl.opacity) * lerpFactor;

        this.angle += this.speed * this.direction * deltaTime;
        
        this.replayFrames.push({
            angle: this.angle,
            targetStartAngle: this.targetStartAngle,
            targetSize: this.targetSize,
            score: this.score,
            level: this.level,
            targetColor: this.currentColorHsl.toString(),
            timestamp: currentTime,
        });

        this.draw();
        this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
    }

    handleTap() {
        if (this.gameState !== 'playing') return;
        
        const angleTolerance = Math.atan2(this.lineWidth / 2.5, this.radius);
        const inZone = isAngleInArc(this.angle, this.targetStartAngle - angleTolerance, this.targetSize + 2 * angleTolerance);

        if (inZone) {
            playSuccess();
            this.score++;
            
            this.tapsThisLevel++;
            if (this.tapsThisLevel >= this.tapsForNextLevel) {
                this.levelUp();
            }

            this.direction *= -1;
            this.speed *= 1.04;

            const lastFrame = this.replayFrames[this.replayFrames.length - 1];
            if (lastFrame) {
                lastFrame.success = true;
                lastFrame.newTarget = {
                    start: this.targetStartAngle,
                    size: difficulties[this.currentDifficulty].size
                };
            }

            this.generateNewTarget();
            
            if (this.onScoreUpdate) this.onScoreUpdate(this.score);
        } else {
            this.gameOver();
        }
    }

    levelUp() {
        this.targetColorHsl = hsl(getHslStringForLevel(this.level + 1));
        
        this.level++;
        this.tapsThisLevel = 0;
        this.tapsForNextLevel = this.level;

        if (this.onLevelUp) this.onLevelUp(this.level);
    }

    reset() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.gameState = 'start';
        this.score = 0;
        this.level = 1;
        this.tapsThisLevel = 0;
        this.tapsForNextLevel = 1;
        this.currentColorHsl = hsl(getHslStringForLevel(1));
        this.targetSize = difficulties[this.currentDifficulty].size;
        this.targetStartAngle = Math.PI / 4;
        this.angle = -Math.PI / 2;
        this.resizeCanvas();
    }
}