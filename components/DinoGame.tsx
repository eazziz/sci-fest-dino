/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState } from 'react';
import { ZONES } from './poseControls.mjs';
import { createPlayerSession, updatePlayerSession, PLAY_AREA, SESSION_TIMING } from './playerSession.mjs';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// --- TYPES & INTERFACES ---

interface ExtendedWindow extends Window {
    webkitAudioContext?: typeof AudioContext;
}

interface VisionState {
    poseLandmarker: any;
    lastVideoTime: number;
    results: any;
    session: ReturnType<typeof createPlayerSession>;
    lastPredictionTime: number;
    lastFrameTime: number;
    selectedLandmarks: any;
}

// Entity Interfaces for Pooling
interface GameObject {
    active: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    // Specific props
    color?: string;
}

interface GameEngineState {
    gameRunning: boolean;
    canRestart: boolean;
    score: number;
    gameSpeed: number;
    lastTime: number;
    // Pools
    obstaclePool: Cactus[];
    pterodactylPool: Pterodactyl[];
    groundPool: GroundDetail[];
    spawnTimer: number;
    groundSpawnTimer: number;
    animationId: number;
    visionAnimationId: number;
    dino: DinoEntity;
    hasStarted: boolean;
    cameraReady: boolean;
    playerTracked: boolean;
}

interface DinoEntity {
    x: number;
    y: number;
    width: number;
    height: number;
    dy: number;
    grounded: boolean;
    ducking: boolean;
    jumpTimer: number;
    legState: boolean;
    animTimer: number;
    jump: () => boolean;
    setDucking: (ducking: boolean) => void;
    getHitbox: () => { x: number; y: number; width: number; height: number };
    update: (dt: number, onStep?: () => void) => void;
    draw: (ctx: CanvasRenderingContext2D) => void;
    reset: () => void;
}

// --- CONSTANTS ---

const GAME_CONFIG = {
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 300,
    GROUND_Y: 242,
    GRAVITY: 4000,
    JUMP_FORCE: 1000,
    INITIAL_SPEED: 400,
    MAX_SPEED: 1200,
    SPEED_INCREMENT: 10,
    DINO_START_X: 50,
    DINO_GROUND_Y: 200,
    VISION_FPS: 30,
    COLORS: {
        PRIMARY: '#535353',
        ACCENT: '#ff5252',
        FOCUS: '#F59E0B',
        WHITE: '#ffffff',
    }
};

// --- AUDIO SYNTHESIS ---

const SoundSynth = {
    ctx: null as AudioContext | null,
    bufferCache: {} as Record<string, AudioBuffer>,
    
    init: () => {
        if (!SoundSynth.ctx) {
            const Win = window as ExtendedWindow;
            SoundSynth.ctx = new (window.AudioContext || Win.webkitAudioContext)();
        }
        if (SoundSynth.ctx.state === 'suspended') {
            SoundSynth.ctx.resume();
        }

        if (!SoundSynth.bufferCache['step']) {
            SoundSynth.bufferCache['step'] = SoundSynth.createNoiseBuffer(0.04);
        }
        if (!SoundSynth.bufferCache['roar']) {
            SoundSynth.bufferCache['roar'] = SoundSynth.createNoiseBuffer(0.8);
        }
    },

    createNoiseBuffer: (duration: number): AudioBuffer => {
        const ctx = SoundSynth.ctx!;
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    },

    playJump: () => {
        const ctx = SoundSynth.ctx;
        if (!ctx) return;
        
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.1);
        
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        
        osc.start(t);
        osc.stop(t + 0.1);
    },

    playStep: () => {
        const ctx = SoundSynth.ctx;
        if (!ctx || !SoundSynth.bufferCache['step']) return;
        
        const t = ctx.currentTime;
        const noise = ctx.createBufferSource();
        noise.buffer = SoundSynth.bufferCache['step'];
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, t);
        filter.frequency.exponentialRampToValueAtTime(100, t + 0.04);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.3, t); 
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.04);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        
        noise.start(t);
    },

    playRoar: () => {
        const ctx = SoundSynth.ctx;
        if (!ctx || !SoundSynth.bufferCache['roar']) return;
        
        const t = ctx.currentTime;
        
        const noise = ctx.createBufferSource();
        noise.buffer = SoundSynth.bufferCache['roar'];
        
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(800, t);
        noiseFilter.frequency.linearRampToValueAtTime(100, t + 0.6);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.08, t);
        noiseGain.gain.linearRampToValueAtTime(0, t + 0.6);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.linearRampToValueAtTime(50, t + 0.6);
        
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.08, t);
        oscGain.gain.linearRampToValueAtTime(0, t + 0.6);

        osc.connect(oscGain);
        oscGain.connect(ctx.destination);

        noise.start(t);
        osc.start(t);
        noise.stop(t + 0.6);
        osc.stop(t + 0.6);
    }
};

// --- GAME ENTITIES (POOLED) ---

class GroundDetail {
    active: boolean = false;
    x: number = 0;
    y: number = 0;
    width: number = 0;
    height: number = 2;

    spawn(startX: number) {
        this.x = startX;
        this.y = GAME_CONFIG.GROUND_Y + 3 + Math.random() * 45;
        this.width = Math.random() > 0.5 ? 3 : 7;
        this.active = true;
    }

    update(dt: number, speed: number) {
        if (!this.active) return;
        this.x -= speed * dt;
        if (this.x < -this.width) this.active = false;
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (!this.active) return;
        // Optimization: Assume context color is already set to PRIMARY
        ctx.fillRect(Math.floor(this.x), Math.floor(this.y), this.width, this.height);
    }
}

class Cactus {
    active: boolean = false;
    x: number = 0;
    y: number = 210;
    width: number = 0;
    height: number = 0;

    spawn(startX: number) {
        this.x = startX;
        this.width = 20 + Math.random() * 15;
        this.height = 30 + Math.random() * 20;
        this.active = true;
    }

    update(dt: number, speed: number) {
        if (!this.active) return;
        this.x -= speed * dt;
        if (this.x < -this.width) this.active = false;
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (!this.active) return;
        const ix = Math.floor(this.x);
        const iy = Math.floor(this.y);
        const w3 = Math.floor(this.width / 3);
        const h = Math.floor(this.height);
        
        // Main stem
        ctx.fillRect(ix + w3, iy, w3, h);
        // Left arm
        ctx.fillRect(ix, iy + 10, w3, 5); 
        ctx.fillRect(ix, iy + 5, 5, 10);
        // Right arm
        ctx.fillRect(ix + 2*w3, iy + 15, w3, 5);
        ctx.fillRect(ix + Math.floor(this.width) - 5, iy + 5, 5, 15);
    }
}

class Pterodactyl {
    active: boolean = false;
    x: number = 0;
    y: number = 186;
    width: number = 52;
    height: number = 27;
    wingUp: boolean = false;
    animTimer: number = 0;

    spawn(startX: number) {
        this.x = startX;
        this.wingUp = false;
        this.animTimer = 0;
        this.active = true;
    }

    update(dt: number, speed: number) {
        if (!this.active) return;
        this.x -= speed * dt;
        this.animTimer += dt;
        if (this.animTimer >= 0.14) {
            this.wingUp = !this.wingUp;
            this.animTimer = 0;
        }
        if (this.x < -this.width) this.active = false;
    }

    draw(ctx: CanvasRenderingContext2D) {
        if (!this.active) return;
        const ix = Math.floor(this.x);
        const iy = Math.floor(this.y);

        ctx.fillRect(ix + 10, iy + 9, 28, 10);
        ctx.fillRect(ix + 34, iy + 5, 12, 12);
        ctx.fillRect(ix + 46, iy + 9, 6, 3);
        ctx.fillRect(ix + 3, iy + 12, 10, 4);

        if (this.wingUp) {
            ctx.fillRect(ix + 16, iy, 7, 12);
            ctx.fillRect(ix + 21, iy + 3, 12, 6);
        } else {
            ctx.fillRect(ix + 17, iy + 16, 7, 11);
            ctx.fillRect(ix + 22, iy + 18, 12, 6);
        }

        ctx.fillStyle = GAME_CONFIG.COLORS.WHITE;
        ctx.fillRect(ix + 40, iy + 8, 2, 2);
        ctx.fillStyle = GAME_CONFIG.COLORS.PRIMARY;
    }
}

// Pool Helpers
const getFromPool = <T extends { active: boolean }>(pool: T[], factory: () => T): T => {
    const item = pool.find(p => !p.active);
    if (item) return item;
    const newItem = factory();
    pool.push(newItem);
    return newItem;
};

const createDino = (): DinoEntity => ({
    x: GAME_CONFIG.DINO_START_X,
    y: GAME_CONFIG.DINO_GROUND_Y,
    width: 40,
    height: 43,
    dy: 0,
    grounded: false,
    ducking: false,
    jumpTimer: 0,
    legState: false,
    animTimer: 0,
    
    reset() {
        this.y = GAME_CONFIG.DINO_GROUND_Y;
        this.dy = 0;
        this.grounded = true;
        this.ducking = false;
        this.jumpTimer = 0;
        this.legState = false;
        this.animTimer = 0;
    },

    draw(ctx: CanvasRenderingContext2D) {
        // Optimization: Use Math.floor for sharp pixels
        const ix = Math.floor(this.x);
        const iy = Math.floor(this.y);

        ctx.fillStyle = GAME_CONFIG.COLORS.PRIMARY;

        if (this.ducking && this.grounded) {
            ctx.fillRect(ix + 8, iy + 23, 30, 14);
            ctx.fillRect(ix + 30, iy + 16, 18, 16);
            ctx.fillRect(ix, iy + 26, 10, 5);
            ctx.fillRect(ix + 12, iy + 37, 7, 6);
            ctx.fillRect(ix + 31, iy + 37, 7, 6);
            ctx.fillStyle = GAME_CONFIG.COLORS.WHITE;
            ctx.fillRect(ix + 41, iy + 20, 3, 3);
            ctx.fillStyle = GAME_CONFIG.COLORS.PRIMARY;
            return;
        }

        // Body
        ctx.fillRect(ix + 10, iy, 20, 25);
        // Head
        ctx.fillRect(ix + 15, iy - 10, 25, 18);
        // Tail
        ctx.fillRect(ix, iy + 5, 10, 5);
        
        // Legs Animation
        if (!this.grounded) {
            ctx.fillRect(ix + 10, iy + 25, 5, 10);
            ctx.fillRect(ix + 25, iy + 25, 5, 10);
        } else if (this.legState) {
            ctx.fillRect(ix + 10, iy + 25, 5, 18);
            ctx.fillRect(ix + 25, iy + 25, 5, 10);
        } else {
            ctx.fillRect(ix + 10, iy + 25, 5, 10);
            ctx.fillRect(ix + 25, iy + 25, 5, 18);
        }

        ctx.fillStyle = GAME_CONFIG.COLORS.WHITE;
        ctx.fillRect(ix + 30, iy - 5, 3, 3); // Eye
        
        // Reset color to primary for next draw calls
        ctx.fillStyle = GAME_CONFIG.COLORS.PRIMARY;
    },

    jump() {
        if (this.grounded && this.jumpTimer <= 0) {
            this.ducking = false;
            this.dy = -GAME_CONFIG.JUMP_FORCE;
            this.grounded = false;
            this.jumpTimer = 0.1;
            return true;
        }
        return false;
    },

    setDucking(ducking: boolean) {
        this.ducking = ducking;
    },

    getHitbox() {
        if (this.ducking && this.grounded) {
            return { x: this.x + 4, y: this.y + 16, width: 44, height: 27 };
        }
        return { x: this.x + 3, y: this.y - 10, width: 37, height: 53 };
    },

    update(dt: number, onStep?: () => void) {
        if (this.jumpTimer > 0) this.jumpTimer -= dt;

        this.animTimer += dt;
        if (this.animTimer > 0.1) {
            this.legState = !this.legState;
            this.animTimer = 0;
            if (this.grounded && onStep) onStep();
        }

        this.dy += GAME_CONFIG.GRAVITY * dt;
        this.y += this.dy * dt;

        if (this.y > GAME_CONFIG.DINO_GROUND_Y) {
            this.y = GAME_CONFIG.DINO_GROUND_Y;
            this.dy = 0;
            this.grounded = true;
        } else {
            this.grounded = false;
        }
    }
});


const DinoGame: React.FC = () => {
    // --- REFS ---
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const outputCanvasRef = useRef<HTMLCanvasElement>(null);
    const jumpSignalRef = useRef<HTMLSpanElement>(null);
    const duckSignalRef = useRef<HTMLSpanElement>(null);
    
    // --- REACT STATE ---
    const [isLoading, setIsLoading] = useState(true);
    const [status, setStatus] = useState("Step into the middle to play");
    const [calibrated, setCalibrated] = useState(false);
    const [playerTracked, setPlayerTracked] = useState(false);
    const [sessionPhase, setSessionPhase] = useState('waiting');
    const [settleProgress, setSettleProgress] = useState(0);
    const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [gameRunning, setGameRunning] = useState(false);
    const [canRestart, setCanRestart] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);
    const [cameraStarting, setCameraStarting] = useState(false);
    const [isMuted, setIsMuted] = useState(false);

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [displayMessage, setDisplayMessage] = useState("");

    useEffect(() => {
        const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => document.removeEventListener('fullscreenchange', syncFullscreen);
    }, []);

    const toggleFullscreen = async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
            setDisplayMessage("");
        } catch {
            setDisplayMessage("Use your browser's View menu to enter full screen.");
        }
    };

    const mutedRef = useRef(false);

    // --- ENGINE STATE (Mutable) ---
    const engineRef = useRef<GameEngineState>({
        gameRunning: false,
        canRestart: false,
        score: 0,
        gameSpeed: GAME_CONFIG.INITIAL_SPEED,
        lastTime: 0,
        // Pre-allocate pools
        obstaclePool: Array.from({ length: 10 }, () => new Cactus()),
        pterodactylPool: Array.from({ length: 4 }, () => new Pterodactyl()),
        groundPool: Array.from({ length: 50 }, () => new GroundDetail()),
        spawnTimer: 0,
        groundSpawnTimer: 0,
        animationId: 0,
        visionAnimationId: 0,
        dino: createDino(),
        hasStarted: false,
        cameraReady: false,
        playerTracked: false
    });

    // --- VISION STATE (Mutable) ---
    const visionRef = useRef<VisionState>({
        poseLandmarker: null,
        lastVideoTime: -1,
        results: undefined,
        session: createPlayerSession(),
        lastPredictionTime: 0,
        lastFrameTime: 0,
        selectedLandmarks: null
    });

    useEffect(() => {
        mutedRef.current = isMuted;
    }, [isMuted]);

    // --- GAME LOGIC ---

    const spawnObstacle = (dt: number) => {
        const engine = engineRef.current;
        engine.spawnTimer -= dt;
        
        if (engine.spawnTimer <= 0) {
            const canSpawnPterodactyl = engine.score > 240;
            const spawnPterodactyl = canSpawnPterodactyl && Math.random() < 0.32;

            if (spawnPterodactyl) {
                const pterodactyl = getFromPool(engine.pterodactylPool, () => new Pterodactyl());
                pterodactyl.spawn(GAME_CONFIG.CANVAS_WIDTH);
                engine.spawnTimer = 1.4 + Math.random() * 1.1;
                if (engine.gameSpeed < GAME_CONFIG.MAX_SPEED) {
                    engine.gameSpeed += GAME_CONFIG.SPEED_INCREMENT;
                }
                return;
            }

            const r = Math.random();
            let count = r > 0.8 ? 3 : (r > 0.5 ? 2 : 1);

            let nextX = GAME_CONFIG.CANVAS_WIDTH; 

            for (let i = 0; i < count; i++) {
                const cactus = getFromPool(engine.obstaclePool, () => new Cactus());
                cactus.spawn(nextX);
                nextX += cactus.width + (5 + Math.random() * 20); 
            }
            
            engine.spawnTimer = 1.0 + (count * 0.4) + Math.random() * 1.2; 
            
            if(engine.gameSpeed < GAME_CONFIG.MAX_SPEED) {
                engine.gameSpeed += GAME_CONFIG.SPEED_INCREMENT; 
            }
        }
    };

    const spawnGroundDetails = (dt: number) => {
        const engine = engineRef.current;
        engine.groundSpawnTimer -= dt;
        if (engine.groundSpawnTimer <= 0) {
            const detail = getFromPool(engine.groundPool, () => new GroundDetail());
            detail.spawn(GAME_CONFIG.CANVAS_WIDTH);
            engine.groundSpawnTimer = 0.05 + Math.random() * 0.2; 
        }
    };

    const gameOver = () => {
        const engine = engineRef.current;
        if (!engine.gameRunning) return;
        engine.gameRunning = false;
        engine.canRestart = false;
        
        setGameRunning(false);
        setCanRestart(false); 
        
        if (!mutedRef.current) {
            SoundSynth.playRoar();
        }
        
        restartTimerRef.current = setTimeout(() => {
            engine.canRestart = true;
            setCanRestart(true);
        }, 1000);
    };

    const runGameLoop = (timestamp: number) => {
        const engine = engineRef.current;
        if (!engine.gameRunning) return;

        // Preserve the round through brief occlusion; never advance unseen hazards.
        if (!engine.playerTracked) {
            engine.lastTime = timestamp;
            engine.animationId = requestAnimationFrame(runGameLoop);
            return;
        }

        if (!engine.lastTime) engine.lastTime = timestamp;
        // Cap Delta Time to prevent huge jumps on frame drops (0.1s max)
        const dt = Math.min((timestamp - engine.lastTime) / 1000, 0.1); 
        engine.lastTime = timestamp;

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d', { alpha: false })!; // Optimize for no transparency

        // 1. Draw Background (Clear)
        ctx.fillStyle = GAME_CONFIG.COLORS.WHITE;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Set global styles for the frame
        ctx.strokeStyle = GAME_CONFIG.COLORS.PRIMARY;
        ctx.fillStyle = GAME_CONFIG.COLORS.PRIMARY;
        ctx.lineWidth = 2;

        // 2. Draw Ground Line
        ctx.beginPath();
        ctx.moveTo(0, GAME_CONFIG.GROUND_Y);
        ctx.lineTo(canvas.width, GAME_CONFIG.GROUND_Y);
        ctx.stroke();

        // 3. Logic & Draw Ground Details
        spawnGroundDetails(dt);
        // Using For loop instead of forEach for perf
        for(let i = 0; i < engine.groundPool.length; i++) {
            const detail = engine.groundPool[i];
            if (detail.active) {
                detail.update(dt, engine.gameSpeed);
                detail.draw(ctx);
            }
        }

        // 4. Logic & Draw Dino
        engine.dino.update(dt, () => {
            if (!mutedRef.current) SoundSynth.playStep();
        });
        engine.dino.draw(ctx);

        // 5. Logic & Draw Obstacles
        spawnObstacle(dt);
        const dino = engine.dino;
        const collidesWithDino = (obs: { x: number; y: number; width: number; height: number }, padding: number) => {
            const hitbox = dino.getHitbox();
            return (
                hitbox.x < obs.x + obs.width - padding &&
                hitbox.x + hitbox.width > obs.x + padding &&
                hitbox.y < obs.y + obs.height - padding &&
                hitbox.y + hitbox.height > obs.y + padding
            );
        };
        
        for(let i = 0; i < engine.obstaclePool.length; i++) {
            const obs = engine.obstaclePool[i];
            if (obs.active) {
                obs.update(dt, engine.gameSpeed);
                obs.draw(ctx);
                
                // Collision Detection (Active obstacles only)
                if (collidesWithDino(obs, 8)) {
                    gameOver();
                    // Don't return, let the frame finish drawing
                }
            }
        }

        for(let i = 0; i < engine.pterodactylPool.length; i++) {
            const pterodactyl = engine.pterodactylPool[i];
            if (pterodactyl.active) {
                pterodactyl.update(dt, engine.gameSpeed);
                pterodactyl.draw(ctx);
                if (collidesWithDino(pterodactyl, 3)) {
                    gameOver();
                }
            }
        }

        // 6. Draw Score
        if (engine.gameRunning) { // Double check in case of game over mid-loop
            engine.score += 60 * dt;
            const scoreStr = `HI ${Math.floor(engine.score/10)}`;
            // Font is set once ideally, but to be safe:
            ctx.font = "16px 'Press Start 2P'";
            ctx.textAlign = "right";
            ctx.fillText(scoreStr, canvas.width - 20, 30);
            
            engine.animationId = requestAnimationFrame(runGameLoop);
        }
    };

    const resetGame = (jumpOnStart = false) => {
        const engine = engineRef.current;
        if (!engine.playerTracked || !visionRef.current.session.controls.ready) return;
        if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
        
        // Deactivate all pool items
        engine.obstaclePool.forEach(p => p.active = false);
        engine.pterodactylPool.forEach(p => p.active = false);
        engine.groundPool.forEach(p => p.active = false);
        
        // Populate initial ground
        for (let x = 0; x < GAME_CONFIG.CANVAS_WIDTH; x += 30 + Math.random() * 60) {
            const detail = getFromPool(engine.groundPool, () => new GroundDetail());
            detail.spawn(x);
        }

        engine.score = 0;
        engine.canRestart = false;
        engine.gameSpeed = GAME_CONFIG.INITIAL_SPEED;
        engine.spawnTimer = 0;
        engine.groundSpawnTimer = 0;
        engine.dino.reset();
        engine.dino.setDucking(visionRef.current.session.controls.pose === 'duck');
        if (jumpOnStart && engine.dino.jump() && !mutedRef.current) SoundSynth.playJump();
        duckSignalRef.current?.classList.remove('active');
        engine.lastTime = 0;
        engine.gameRunning = true;
        
        setGameRunning(true);
        setCanRestart(false);
        
        runGameLoop(0);
    };

    const startFromJump = () => {
        if (!visionRef.current.session.controls.ready || !engineRef.current.playerTracked) return;
        SoundSynth.init();
        setHasStarted(true);
        engineRef.current.hasStarted = true;
        resetGame(true);
    };

    const handleJumpSignal = () => {
        if (jumpSignalRef.current) {
            jumpSignalRef.current.classList.add('active');
            setTimeout(() => jumpSignalRef.current?.classList.remove('active'), 200);
        }

        const engine = engineRef.current;
        if (engine.gameRunning) {
            const jumped = engine.dino.jump();
            if (jumped && !mutedRef.current) {
                SoundSynth.playJump();
            }
        } else if (!engine.gameRunning && engine.canRestart) {
            resetGame(true);
        } else if (!engine.hasStarted && engine.cameraReady) {
            startFromJump();
        }
    };

    const handleDuckSignal = (ducking: boolean) => {
        engineRef.current.dino.setDucking(ducking);
        duckSignalRef.current?.classList.toggle('active', ducking);
    };

    // --- VISION LOGIC ---

    const predictWebcam = () => {
        const video = videoRef.current;
        const outCanvas = outputCanvasRef.current;
        const engine = engineRef.current;
        
        if (!video || !outCanvas || !visionRef.current.poseLandmarker) {
            engine.visionAnimationId = requestAnimationFrame(predictWebcam);
            return;
        }

        const now = performance.now();
        const timeSinceLast = now - visionRef.current.lastPredictionTime;
        const frameInterval = 1000 / GAME_CONFIG.VISION_FPS;

        if (timeSinceLast < frameInterval) {
            engine.visionAnimationId = requestAnimationFrame(predictWebcam);
            return;
        }
        visionRef.current.lastPredictionTime = now;

        const state = visionRef.current;
        const { poseLandmarker } = state;

        if (video.videoWidth > 0 && video.videoHeight > 0) {
             if (outCanvas.width !== video.videoWidth || outCanvas.height !== video.videoHeight) {
                outCanvas.width = video.videoWidth;
                outCanvas.height = video.videoHeight;
             }
        }

        const outCtx = outCanvas.getContext('2d', { alpha: true })!;
        
        let didUpdate = false;
        if (video.readyState >= 2 && state.lastVideoTime !== video.currentTime) {
            state.lastVideoTime = video.currentTime;
            try {
                state.results = poseLandmarker.detectForVideo(video, now);
                state.lastFrameTime = now;
                didUpdate = true;
            } catch (error) {
                console.error('Pose tracking interrupted', error);
                state.results = null;
            }
        }

        if (didUpdate || now - state.lastFrameTime > SESSION_TIMING.frameGap) {
            const result = updatePlayerSession(
                state.session, didUpdate ? state.results?.landmarks ?? [] : [], now,
                video.videoWidth / video.videoHeight || 1, engine.gameRunning
            );
            if (result.departed) newPlayer();
            state.selectedLandmarks = result.landmarks;
            engine.playerTracked = result.tracked;
            setPlayerTracked(result.tracked);
            setCalibrated(state.session.controls.ready && result.tracked);
            setSessionPhase(result.phase);
            setSettleProgress(Math.round(result.progress * 20) / 20);
            setStatus(result.message);
            handleDuckSignal(result.duck);
            if (result.jump) handleJumpSignal();
        }

        outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
        drawPlayArea(outCtx, state.session.phase);
        if (state.selectedLandmarks) {
            const leftShoulder = state.selectedLandmarks[11];
            const rightShoulder = state.selectedLandmarks[12];
            outCtx.beginPath();
            outCtx.moveTo(leftShoulder.x * outCanvas.width, leftShoulder.y * outCanvas.height);
            outCtx.lineTo(rightShoulder.x * outCanvas.width, rightShoulder.y * outCanvas.height);
            outCtx.strokeStyle = GAME_CONFIG.COLORS.ACCENT;
            outCtx.lineWidth = 3 * outCanvas.height / 240;
            outCtx.stroke();
            outCtx.fillStyle = '#00FF00';
            for (const shoulder of [leftShoulder, rightShoulder]) {
                outCtx.beginPath();
                outCtx.arc(shoulder.x * outCanvas.width, shoulder.y * outCanvas.height,
                    5 * outCanvas.height / 240, 0, 2 * Math.PI);
                outCtx.fill();
            }
            drawDebugOverlay(outCtx, state);
        }

        engine.visionAnimationId = requestAnimationFrame(predictWebcam);
    };

    const drawPlayArea = (ctx: CanvasRenderingContext2D, phase: string) => {
        if (phase === 'playing') return;
        const { width: w, height: h } = ctx.canvas;
        ctx.save();
        ctx.strokeStyle = phase === 'ready' ? '#00cc88' : '#fbbf24';
        ctx.lineWidth = Math.max(2, h / 160);
        ctx.setLineDash([h / 45, h / 60]);
        ctx.strokeRect(PLAY_AREA.left * w, h * 0.08,
            (PLAY_AREA.right - PLAY_AREA.left) * w, h * 0.84);
        ctx.restore();
    };

    const drawDebugOverlay = (ctx: CanvasRenderingContext2D, state: VisionState) => {
        const c = state.session.controls;
        if (!c.ready) return;
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const labelScale = h / 240;
        const lines = [
            { offset: ZONES.jump, color: '#ff5252', label: 'JUMP ABOVE' },
            { offset: 0, color: '#00cc88', label: 'STAND' },
            { offset: ZONES.duck, color: '#f59e0b', label: 'DUCK BELOW' }
        ];
        for (const line of lines) {
            const y = (c.baseline + line.offset * c.width) * h;
            ctx.strokeStyle = line.color;
            ctx.lineWidth = 2 * labelScale;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            // The overlay canvas is mirrored by CSS; undo it for text.
            ctx.save();
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
            ctx.font = `bold ${11 * labelScale}px monospace`;
            ctx.fillStyle = '#000a';
            ctx.fillRect(3 * labelScale, y - 16 * labelScale, 85 * labelScale, 14 * labelScale);
            ctx.fillStyle = line.color;
            ctx.fillText(line.label, 6 * labelScale, y - 5 * labelScale);
            ctx.restore();
        }
    };

    const newPlayer = () => {
        const engine = engineRef.current;
        cancelAnimationFrame(engine.animationId);
        if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
        engine.gameRunning = false;
        engine.canRestart = false;
        engine.hasStarted = false;
        engine.dino.reset();
        engine.playerTracked = false;
        visionRef.current.session = createPlayerSession();
        visionRef.current.selectedLandmarks = null;
        jumpSignalRef.current?.classList.remove('active');
        handleDuckSignal(false);
        setGameRunning(false);
        setCanRestart(false);
        setHasStarted(false);
        setCalibrated(false);
        setPlayerTracked(false);
        setSessionPhase('waiting');
        setSettleProgress(0);
        setStatus("Step into the middle to play");
    };

    const enableCam = async () => {
        SoundSynth.init();
        if (!visionRef.current.poseLandmarker || cameraStarting || engineRef.current.cameraReady) return;
        setCameraStarting(true);

        newPlayer();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30, max: 30 } },
                audio: false
            });
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.addEventListener("loadeddata", () => {
                    predictWebcam();
                    setCameraReady(true);
                    engineRef.current.cameraReady = true;
                }, { once: true });
            } else {
                stream.getTracks().forEach(track => track.stop());
            }
        } catch(err) {
            console.error(err);
            alert("Please enable camera access to play!");
        } finally {
            setCameraStarting(false);
        }
    };

    useEffect(() => {
        let disposed = false;
        let landmarker: any = null;
        const initMediaPipe = async () => {
            try {
                const vision = await FilesetResolver.forVisionTasks(
                    "/wasm"
                );
                
                landmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: "/models/pose_landmarker_lite.task",
                        delegate: "GPU"
                    },
                    runningMode: "VIDEO",
                    numPoses: 3
                });
                if (disposed) {
                    landmarker.close();
                    return;
                }
                visionRef.current.poseLandmarker = landmarker;
                setIsLoading(false);
            } catch (err) {
                if (disposed) return;
                console.error(err);
                setStatus("Failed to load AI.");
            }
        };

        initMediaPipe();

        return () => {
            disposed = true;
            cancelAnimationFrame(engineRef.current.animationId);
            cancelAnimationFrame(engineRef.current.visionAnimationId);
            if (restartTimerRef.current !== null) clearTimeout(restartTimerRef.current);
            const stream = videoRef.current?.srcObject as MediaStream | null;
            stream?.getTracks().forEach(track => track.stop());
            landmarker?.close();
        };
    }, []);

    return (
        <div className="tv-layout">
          <section className="game-panel" aria-label="Dino game">
            <header className="game-header">
                <h1>DINO JUMP</h1>
                <div className="display-controls">
                    <button onClick={() => setIsMuted(!isMuted)} aria-pressed={isMuted}>
                        {isMuted ? "SOUND OFF" : "SOUND ON"}
                    </button>
                    <button onClick={toggleFullscreen}>
                        {isFullscreen ? "EXIT FULL SCREEN" : "FULL SCREEN"}
                    </button>
                </div>
            </header>
            {displayMessage && <p className="display-message" role="status">{displayMessage}</p>}
            <div className="game-stage">
                <canvas 
                    ref={canvasRef} 
                    width={GAME_CONFIG.CANVAS_WIDTH} 
                    height={GAME_CONFIG.CANVAS_HEIGHT}
                    className="game-canvas"
                />

                {/* START SCREEN */}
                {(!gameRunning && !canRestart && !hasStarted) && (
                    <div className="absolute top-0 left-0 w-full h-full bg-white/80 flex flex-col items-center justify-center z-10 rounded-lg">
                        {isLoading ? (
                            <>
                                <div className="w-8 h-8 border-4 border-[#f3f3f3] border-t-[#535353] rounded-full animate-spin mb-5"></div>
                                <p className="font-press-start text-xs text-[#535353]">Loading AI Model...</p>
                            </>
                        ) : (
                            <div className="flex flex-col items-center gap-4">
                                {!cameraReady ? (
                                    <button 
                                        onClick={enableCam} 
                                        disabled={cameraStarting}
                                        className="px-5 py-3 bg-transparent border-2 border-[#535353] text-[#535353] font-press-start text-base cursor-pointer hover:bg-[#535353] hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#F59E0B] focus:ring-offset-2"
                                    >
                                        {cameraStarting ? "OPENING CAMERA…" : "ENABLE CAMERA"}
                                    </button>
                                ) : (
                                    <>
                                        <div className="walk-up-prompt" role="status">
                                            <p className="walk-up-title">
                                                {calibrated ? "READY!" : sessionPhase === 'settling'
                                                    ? "GETTING READY…" : "STEP INTO THE MIDDLE"}
                                            </p>
                                            <p className="walk-up-hint">
                                                {calibrated ? "Jump to play" : "Face the screen. We'll do the rest."}
                                            </p>
                                            {sessionPhase === 'settling' && (
                                                <progress className="settle-progress" max={1} value={settleProgress}
                                                    aria-label="Getting ready" />
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {gameRunning && !playerTracked && (
                    <div className="tracking-pause" role="status">
                        <p>WAITING FOR YOU</p>
                        <span>Come back to the middle</span>
                    </div>
                )}

                {/* GAME OVER SCREEN */}
                {(hasStarted && !gameRunning) && (
                    <div className="absolute top-0 left-0 w-full h-full bg-black/50 flex flex-col items-center justify-center z-10 rounded-lg text-center p-2 md:p-4">
                        <div className="text-white text-xl md:text-3xl font-press-start mb-3 md:mb-6 drop-shadow-md">GAME OVER</div>
                        <div className="text-white text-xs md:text-sm font-press-start mb-2 md:mb-4 animate-pulse drop-shadow-md">
                            {canRestart && calibrated ? "JUMP TO RESTART" : status}
                        </div>
                        <div className="text-white/90 text-[8px] font-press-start bg-black/40 p-1 md:p-2 rounded">
                            Powered By <a href="https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker" target="_blank" rel="noopener noreferrer" className="text-[#F59E0B] no-underline hover:underline focus:outline-none focus:ring-2 focus:ring-[#F59E0B] rounded-sm">MediaPipe Pose Landmarker</a>
                        </div>
                    </div>
                )}
            </div>

            <p className="game-instructions">JUMP OVER CACTI · DUCK UNDER BIRDS</p>
          </section>

          <section className="camera-panel" aria-label="Live mirrored camera and pose tracking">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="camera-image"
                />
                <canvas ref={outputCanvasRef} className="camera-image camera-overlay" />
                {!cameraReady && (
                    <div className="camera-placeholder">
                        <span className="camera-symbol" aria-hidden="true">◎</span>
                        <p>YOUR CAMERA VIEW</p>
                        <span>Enable the camera above to see yourself here.</span>
                    </div>
                )}
                <div className="camera-heading">
                    <span className="camera-label">{cameraReady ? "LIVE CAMERA" : "CAMERA"}</span>
                    <p className="pose-status" role="status">{cameraReady ? status : "Get ready to jump!"}</p>
                </div>
                <div className="camera-footer">
                    <div className="pose-signals" aria-label="Movement indicators">
                        <span><span ref={jumpSignalRef} className="pose-light jump-light" />JUMP</span>
                        <span><span ref={duckSignalRef} className="pose-light duck-light" />DUCK</span>
                    </div>
                    <button onClick={newPlayer} disabled={!cameraReady} className="recalibrate-button">
                        RESET PLAYER
                    </button>
                </div>
          </section>
        </div>
    );
};

export default DinoGame;

