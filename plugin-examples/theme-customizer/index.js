// Theme Customizer Plugin
// Transform Audion's visual experience with stunning themes

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // THEME DEFINITIONS - Each theme completely transforms the app's look
    // ═══════════════════════════════════════════════════════════════════════════

    const THEMES = {
        native: {
            name: 'Native (Follow App)',
            icon: '💻', // Laptop icon
            description: 'Use application Light/Dark mode settings',
            vars: {},
            customStyles: ''
        },
        classic: {
            name: 'Classic Dark',
            icon: '🎵',
            description: 'The classic dark theme',
            vars: {
                '--bg-base': '#121212',
                '--bg-elevated': '#181818',
                '--bg-surface': '#282828',
                '--bg-highlight': '#3e3e3e',
                '--bg-press': '#535353',
                '--accent-primary': '#1DB954',
                '--accent-hover': '#1ed760',
                '--accent-subtle': 'rgba(29, 185, 84, 0.15)',
                '--text-primary': '#ffffff',
                '--text-secondary': '#b3b3b3',
                '--text-subdued': '#6a6a6a',
                '--border-color': '#404040',
                '--error-color': '#f15e6c',
                '--shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.3)',
                '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)',
                '--shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.5)',
            },
            customStyles: ''
        },

        // ═══════════════════════════════════════════════════════════════════
        // CYBERPUNK NEON - Electric, futuristic vibes
        // ═══════════════════════════════════════════════════════════════════
        cyberpunk: {
            name: 'Cyberpunk Neon',
            icon: '⚡',
            description: 'Electric neon with futuristic vibes',
            vars: {
                '--bg-base': '#0a0a12',
                '--bg-elevated': '#12121f',
                '--bg-surface': '#1a1a2e',
                '--bg-highlight': '#25254a',
                '--bg-press': '#33336a',
                '--accent-primary': '#ff00ff',
                '--accent-hover': '#ff44ff',
                '--accent-subtle': 'rgba(255, 0, 255, 0.15)',
                '--text-primary': '#ffffff',
                '--text-secondary': '#00ffff',
                '--text-subdued': '#6b6b9a',
                '--border-color': 'rgba(255, 0, 255, 0.3)',
                '--error-color': '#ff3366',
                '--shadow-sm': '0 2px 8px rgba(255, 0, 255, 0.2)',
                '--shadow-md': '0 4px 16px rgba(255, 0, 255, 0.3)',
                '--shadow-lg': '0 8px 32px rgba(255, 0, 255, 0.4)',
            },
            customStyles: `
                /* Cyberpunk Glow Effects */
                .player-bar {
                    background: linear-gradient(180deg, rgba(255,0,255,0.05) 0%, #0a0a12 100%) !important;
                    border-top: 1px solid rgba(255,0,255,0.3) !important;
                    box-shadow: 0 -4px 30px rgba(255,0,255,0.2) !important;
                }
                
                .sidebar {
                    background: linear-gradient(135deg, #0a0a12 0%, #12121f 100%) !important;
                    border-right: 1px solid rgba(0,255,255,0.2) !important;
                }
                
                .btn-primary {
                    background: linear-gradient(135deg, #ff00ff 0%, #00ffff 100%) !important;
                    box-shadow: 0 0 20px rgba(255,0,255,0.5), 0 0 40px rgba(0,255,255,0.3) !important;
                    text-shadow: 0 0 10px rgba(0,0,0,0.5) !important;
                }
                
                .btn-primary:hover {
                    box-shadow: 0 0 30px rgba(255,0,255,0.7), 0 0 60px rgba(0,255,255,0.5) !important;
                }
                
                .icon-btn:hover {
                    background: rgba(255,0,255,0.2) !important;
                    box-shadow: 0 0 15px rgba(255,0,255,0.4) !important;
                }
                
                .icon-btn.active {
                    color: #00ffff !important;
                    text-shadow: 0 0 10px rgba(0,255,255,0.8) !important;
                }
                
                .progress-bar, .volume-bar {
                    background: rgba(255,0,255,0.2) !important;
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: linear-gradient(90deg, #ff00ff, #00ffff) !important;
                    box-shadow: 0 0 10px rgba(255,0,255,0.5) !important;
                }
                
                .track-item:hover {
                    background: linear-gradient(90deg, rgba(255,0,255,0.1), rgba(0,255,255,0.1)) !important;
                }
                
                .track-item.playing .track-title {
                    color: #00ffff !important;
                    text-shadow: 0 0 8px rgba(0,255,255,0.5) !important;
                }
                
                /* Animated scanlines */
                body::before {
                    content: '';
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    background: repeating-linear-gradient(
                        0deg,
                        transparent,
                        transparent 2px,
                        rgba(0,255,255,0.02) 2px,
                        rgba(0,255,255,0.02) 4px
                    );
                    z-index: 9998;
                }
            `
        },

        // ═══════════════════════════════════════════════════════════════════
        // AURORA BOREALIS - Beautiful northern lights inspired
        // ═══════════════════════════════════════════════════════════════════
        aurora: {
            name: 'Aurora Borealis',
            icon: '🌌',
            description: 'Mystical northern lights glow',
            vars: {
                '--bg-base': '#0c1222',
                '--bg-elevated': '#111827',
                '--bg-surface': '#1e293b',
                '--bg-highlight': '#334155',
                '--bg-press': '#475569',
                '--accent-primary': '#22d3ee',
                '--accent-hover': '#67e8f9',
                '--accent-subtle': 'rgba(34, 211, 238, 0.15)',
                '--text-primary': '#f8fafc',
                '--text-secondary': '#94a3b8',
                '--text-subdued': '#64748b',
                '--border-color': 'rgba(34, 211, 238, 0.2)',
                '--error-color': '#f87171',
                '--shadow-sm': '0 2px 8px rgba(34, 211, 238, 0.15)',
                '--shadow-md': '0 4px 16px rgba(34, 211, 238, 0.2)',
                '--shadow-lg': '0 8px 32px rgba(34, 211, 238, 0.25)',
            },
            customStyles: `
                /* Aurora Gradient Effects */
                .player-bar {
                    background: linear-gradient(180deg, 
                        rgba(34,211,238,0.05) 0%, 
                        rgba(168,85,247,0.03) 50%,
                        #0c1222 100%) !important;
                    border-top: 1px solid rgba(34,211,238,0.15) !important;
                }
                
                .sidebar {
                    background: linear-gradient(180deg, 
                        #0c1222 0%, 
                        rgba(168,85,247,0.08) 50%,
                        rgba(34,211,238,0.05) 100%) !important;
                }
                
                body::after {
                    content: '';
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    background: 
                        radial-gradient(ellipse at top left, rgba(34,211,238,0.08) 0%, transparent 50%),
                        radial-gradient(ellipse at top right, rgba(168,85,247,0.08) 0%, transparent 50%),
                        radial-gradient(ellipse at bottom, rgba(16,185,129,0.05) 0%, transparent 40%);
                    z-index: -1;
                }
                
                .btn-primary {
                    background: linear-gradient(135deg, #22d3ee 0%, #a855f7 50%, #10b981 100%) !important;
                    background-size: 200% 200% !important;
                    animation: aurora-shift 5s ease infinite !important;
                }
                
                @keyframes aurora-shift {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: linear-gradient(90deg, #22d3ee, #a855f7, #10b981) !important;
                    background-size: 200% !important;
                    animation: aurora-shift 3s linear infinite !important;
                }
                
                .track-item.playing {
                    background: linear-gradient(90deg, 
                        rgba(34,211,238,0.1) 0%, 
                        rgba(168,85,247,0.1) 100%) !important;
                }
                
                .track-item.playing .track-title {
                    background: linear-gradient(90deg, #22d3ee, #a855f7) !important;
                    -webkit-background-clip: text !important;
                    -webkit-text-fill-color: transparent !important;
                    background-clip: text !important;
                }
            `
        },

        // ═══════════════════════════════════════════════════════════════════
        // SUNSET WARMTH - Cozy orange and red tones
        // ═══════════════════════════════════════════════════════════════════
        sunset: {
            name: 'Sunset Warmth',
            icon: '🌅',
            description: 'Cozy warm vibes like a summer sunset',
            vars: {
                '--bg-base': '#1a1512',
                '--bg-elevated': '#231c17',
                '--bg-surface': '#2d2520',
                '--bg-highlight': '#3d332b',
                '--bg-press': '#4a3f35',
                '--accent-primary': '#f59e0b',
                '--accent-hover': '#fbbf24',
                '--accent-subtle': 'rgba(245, 158, 11, 0.15)',
                '--text-primary': '#fef3c7',
                '--text-secondary': '#d6c4a5',
                '--text-subdued': '#8b7355',
                '--border-color': 'rgba(245, 158, 11, 0.25)',
                '--error-color': '#ef4444',
                '--shadow-sm': '0 2px 8px rgba(245, 158, 11, 0.15)',
                '--shadow-md': '0 4px 16px rgba(245, 158, 11, 0.2)',
                '--shadow-lg': '0 8px 32px rgba(245, 158, 11, 0.25)',
            },
            customStyles: `
                /* Sunset Gradient Background */
                .sidebar {
                    background: linear-gradient(180deg, 
                        #1a1512 0%, 
                        rgba(245,158,11,0.08) 100%) !important;
                }
                
                .player-bar {
                    background: linear-gradient(180deg, 
                        rgba(239,68,68,0.05) 0%,
                        rgba(245,158,11,0.08) 50%,
                        #1a1512 100%) !important;
                    border-top: 1px solid rgba(245,158,11,0.2) !important;
                }
                
                body::after {
                    content: '';
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    height: 60%;
                    pointer-events: none;
                    background: linear-gradient(0deg, 
                        rgba(245,158,11,0.04) 0%, 
                        rgba(239,68,68,0.02) 40%,
                        transparent 100%);
                    z-index: -1;
                }
                
                .btn-primary {
                    background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%) !important;
                    box-shadow: 0 4px 20px rgba(245,158,11,0.3) !important;
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: linear-gradient(90deg, #ef4444, #f59e0b, #fbbf24) !important;
                }
                
                .track-item.playing .track-title {
                    color: #fbbf24 !important;
                }
                
                .icon-btn.active {
                    color: #f59e0b !important;
                }
            `
        },

        // ═══════════════════════════════════════════════════════════════════
        // OCEAN DEPTHS - Deep sea blues with bioluminescence
        // ═══════════════════════════════════════════════════════════════════
        ocean: {
            name: 'Ocean Depths',
            icon: '🌊',
            description: 'Deep sea blues with glowing accents',
            vars: {
                '--bg-base': '#0a1628',
                '--bg-elevated': '#0f1d32',
                '--bg-surface': '#162544',
                '--bg-highlight': '#1e3356',
                '--bg-press': '#274068',
                '--accent-primary': '#0ea5e9',
                '--accent-hover': '#38bdf8',
                '--accent-subtle': 'rgba(14, 165, 233, 0.15)',
                '--text-primary': '#e0f2fe',
                '--text-secondary': '#7dd3fc',
                '--text-subdued': '#4b7c9e',
                '--border-color': 'rgba(14, 165, 233, 0.25)',
                '--error-color': '#f87171',
                '--shadow-sm': '0 2px 8px rgba(14, 165, 233, 0.2)',
                '--shadow-md': '0 4px 16px rgba(14, 165, 233, 0.25)',
                '--shadow-lg': '0 8px 32px rgba(14, 165, 233, 0.3)',
            },
            customStyles: `
                /* Ocean Waves Effect */
                .sidebar {
                    background: 
                        linear-gradient(180deg, #0a1628 0%, #0f1d32 100%),
                        repeating-linear-gradient(
                            90deg,
                            transparent,
                            transparent 50px,
                            rgba(14,165,233,0.02) 50px,
                            rgba(14,165,233,0.02) 100px
                        ) !important;
                }
                
                .player-bar {
                    background: linear-gradient(180deg, 
                        rgba(14,165,233,0.08) 0%, 
                        #0a1628 100%) !important;
                    border-top: 1px solid rgba(14,165,233,0.3) !important;
                }
                
                /* Bubbles effect */
                body::before {
                    content: '';
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    background: 
                        radial-gradient(circle at 20% 80%, rgba(14,165,233,0.08) 0%, transparent 15%),
                        radial-gradient(circle at 80% 20%, rgba(14,165,233,0.06) 0%, transparent 12%),
                        radial-gradient(circle at 50% 50%, rgba(14,165,233,0.04) 0%, transparent 20%);
                    z-index: -1;
                }
                
                .btn-primary {
                    background: linear-gradient(135deg, #0284c7 0%, #0ea5e9 50%, #38bdf8 100%) !important;
                    box-shadow: 0 4px 25px rgba(14,165,233,0.4) !important;
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: linear-gradient(90deg, #0284c7, #0ea5e9, #38bdf8) !important;
                    box-shadow: 0 0 15px rgba(14,165,233,0.5) !important;
                }
                
                .track-item.playing .track-title {
                    color: #38bdf8 !important;
                    text-shadow: 0 0 8px rgba(56,189,248,0.5) !important;
                }
            `
        },

        // ═══════════════════════════════════════════════════════════════════
        // SAKURA BLOOM - Japanese cherry blossom inspired
        // ═══════════════════════════════════════════════════════════════════
        sakura: {
            name: 'Sakura Bloom',
            icon: '🌸',
            description: 'Elegant pink cherry blossom theme',
            vars: {
                '--bg-base': '#1a1520',
                '--bg-elevated': '#211c28',
                '--bg-surface': '#2a2433',
                '--bg-highlight': '#3a3245',
                '--bg-press': '#4a4055',
                '--accent-primary': '#f472b6',
                '--accent-hover': '#f9a8d4',
                '--accent-subtle': 'rgba(244, 114, 182, 0.15)',
                '--text-primary': '#fdf2f8',
                '--text-secondary': '#f9a8d4',
                '--text-subdued': '#9d7a8c',
                '--border-color': 'rgba(244, 114, 182, 0.25)',
                '--error-color': '#fb7185',
                '--shadow-sm': '0 2px 8px rgba(244, 114, 182, 0.15)',
                '--shadow-md': '0 4px 16px rgba(244, 114, 182, 0.2)',
                '--shadow-lg': '0 8px 32px rgba(244, 114, 182, 0.25)',
            },
            customStyles: `
                /* Sakura Petals Background */
                .sidebar {
                    background: linear-gradient(180deg, 
                        #1a1520 0%, 
                        rgba(244,114,182,0.05) 100%) !important;
                }
                
                .player-bar {
                    background: linear-gradient(180deg, 
                        rgba(244,114,182,0.08) 0%, 
                        #1a1520 100%) !important;
                    border-top: 1px solid rgba(244,114,182,0.2) !important;
                }
                
                body::after {
                    content: '';
                    position: fixed;
                    top: 0;
                    right: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    background: 
                        radial-gradient(ellipse at top right, rgba(244,114,182,0.08) 0%, transparent 40%),
                        radial-gradient(ellipse at bottom left, rgba(249,168,212,0.05) 0%, transparent 35%);
                    z-index: -1;
                }
                
                .btn-primary {
                    background: linear-gradient(135deg, #ec4899 0%, #f472b6 50%, #f9a8d4 100%) !important;
                    box-shadow: 0 4px 20px rgba(244,114,182,0.35) !important;
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: linear-gradient(90deg, #ec4899, #f472b6, #f9a8d4) !important;
                }
                
                .track-item.playing .track-title {
                    color: #f9a8d4 !important;
                }
                
                .icon-btn.active {
                    color: #f472b6 !important;
                }
                
                /* Subtle petal animation */
                @keyframes float {
                    0%, 100% { transform: translateY(0) rotate(0deg); }
                    50% { transform: translateY(-5px) rotate(3deg); }
                }
                
                .album-art, .track-artwork {
                    animation: float 4s ease-in-out infinite !important;
                }
            `
        },

        // ═══════════════════════════════════════════════════════════════════
        // MIDNIGHT PURPLE - Deep elegant purple theme
        // ═══════════════════════════════════════════════════════════════════
        midnight: {
            name: 'Midnight Purple',
            icon: '🔮',
            description: 'Elegant deep purple mystique',
            vars: {
                '--bg-base': '#0f0a1a',
                '--bg-elevated': '#150f24',
                '--bg-surface': '#1e1530',
                '--bg-highlight': '#2a1f42',
                '--bg-press': '#362a54',
                '--accent-primary': '#a855f7',
                '--accent-hover': '#c084fc',
                '--accent-subtle': 'rgba(168, 85, 247, 0.15)',
                '--text-primary': '#faf5ff',
                '--text-secondary': '#d8b4fe',
                '--text-subdued': '#7c5da0',
                '--border-color': 'rgba(168, 85, 247, 0.25)',
                '--error-color': '#fb7185',
                '--shadow-sm': '0 2px 8px rgba(168, 85, 247, 0.2)',
                '--shadow-md': '0 4px 16px rgba(168, 85, 247, 0.25)',
                '--shadow-lg': '0 8px 32px rgba(168, 85, 247, 0.3)',
            },
            customStyles: `
                /* Midnight Glow */
                .sidebar {
                    background: linear-gradient(180deg, 
                        #0f0a1a 0%, 
                        rgba(168,85,247,0.08) 100%) !important;
                }
                
                .player-bar {
                    background: linear-gradient(180deg, 
                        rgba(168,85,247,0.1) 0%, 
                        #0f0a1a 100%) !important;
                    border-top: 1px solid rgba(168,85,247,0.25) !important;
                }
                
                body::before {
                    content: '';
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    background: 
                        radial-gradient(ellipse at center, rgba(168,85,247,0.05) 0%, transparent 60%);
                    z-index: -1;
                }
                
                .btn-primary {
                    background: linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #c084fc 100%) !important;
                    box-shadow: 0 4px 25px rgba(168,85,247,0.4) !important;
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: linear-gradient(90deg, #7c3aed, #a855f7, #c084fc) !important;
                    box-shadow: 0 0 12px rgba(168,85,247,0.5) !important;
                }
                
                .track-item:hover {
                    background: linear-gradient(90deg, rgba(168,85,247,0.1), transparent) !important;
                }
                
                .track-item.playing .track-title {
                    color: #c084fc !important;
                    text-shadow: 0 0 8px rgba(192,132,252,0.4) !important;
                }
            `
        },

        // ═══════════════════════════════════════════════════════════════════
        // FOREST GREEN - Nature inspired calming green
        // ═══════════════════════════════════════════════════════════════════
        forest: {
            name: 'Forest Grove',
            icon: '🌲',
            description: 'Calming forest nature theme',
            vars: {
                '--bg-base': '#0a1410',
                '--bg-elevated': '#0f1c15',
                '--bg-surface': '#15261d',
                '--bg-highlight': '#1e3327',
                '--bg-press': '#274032',
                '--accent-primary': '#22c55e',
                '--accent-hover': '#4ade80',
                '--accent-subtle': 'rgba(34, 197, 94, 0.15)',
                '--text-primary': '#ecfdf5',
                '--text-secondary': '#86efac',
                '--text-subdued': '#4d7c5e',
                '--border-color': 'rgba(34, 197, 94, 0.25)',
                '--error-color': '#f87171',
                '--shadow-sm': '0 2px 8px rgba(34, 197, 94, 0.15)',
                '--shadow-md': '0 4px 16px rgba(34, 197, 94, 0.2)',
                '--shadow-lg': '0 8px 32px rgba(34, 197, 94, 0.25)',
            },
            customStyles: `
                /* Forest atmosphere */
                .sidebar {
                    background: linear-gradient(180deg, 
                        #0a1410 0%, 
                        rgba(34,197,94,0.05) 100%) !important;
                }
                
                .player-bar {
                    background: linear-gradient(180deg, 
                        rgba(34,197,94,0.08) 0%, 
                        #0a1410 100%) !important;
                    border-top: 1px solid rgba(34,197,94,0.2) !important;
                }
                
                body::after {
                    content: '';
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    height: 50%;
                    pointer-events: none;
                    background: linear-gradient(0deg, 
                        rgba(34,197,94,0.04) 0%, 
                        transparent 100%);
                    z-index: -1;
                }
                
                .btn-primary {
                    background: linear-gradient(135deg, #16a34a 0%, #22c55e 50%, #4ade80 100%) !important;
                    box-shadow: 0 4px 20px rgba(34,197,94,0.35) !important;
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: linear-gradient(90deg, #16a34a, #22c55e, #4ade80) !important;
                }
                
                .track-item.playing .track-title {
                    color: #4ade80 !important;
                }
            `
        },

        // ═══════════════════════════════════════════════════════════════════
        // LIGHT MODE - Clean white theme
        // ═══════════════════════════════════════════════════════════════════
        light: {
            name: 'Light Mode',
            icon: '☀️',
            description: 'Clean bright theme for daytime',
            vars: {
                '--bg-base': '#ffffff',
                '--bg-elevated': '#f8fafc',
                '--bg-surface': '#f1f5f9',
                '--bg-highlight': '#e2e8f0',
                '--bg-press': '#cbd5e1',
                '--accent-primary': '#3b82f6',
                '--accent-hover': '#60a5fa',
                '--accent-subtle': 'rgba(59, 130, 246, 0.1)',
                '--text-primary': '#0f172a',
                '--text-secondary': '#475569',
                '--text-subdued': '#94a3b8',
                '--border-color': '#e2e8f0',
                '--error-color': '#ef4444',
                '--shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.08)',
                '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.1)',
                '--shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.12)',
            },
            customStyles: `
                /* Light mode adjustments */
                .sidebar {
                    background: #f8fafc !important;
                    border-right: 1px solid #e2e8f0 !important;
                }
                
                .player-bar {
                    background: #ffffff !important;
                    border-top: 1px solid #e2e8f0 !important;
                    box-shadow: 0 -2px 10px rgba(0,0,0,0.05) !important;
                }
                
                .btn-primary {
                    color: #ffffff !important;
                }
                
                ::-webkit-scrollbar-thumb {
                    background: #cbd5e1 !important;
                }
                
                ::-webkit-scrollbar-thumb:hover {
                    background: #94a3b8 !important;
                }
                
                .progress-bar, .volume-bar {
                    background: #e2e8f0 !important;
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: linear-gradient(90deg, #3b82f6, #60a5fa) !important;
                }
            `
        },

        // ═══════════════════════════════════════════════════════════════════
        // MONOCHROME - Elegant grayscale
        // ═══════════════════════════════════════════════════════════════════
        monochrome: {
            name: 'Monochrome',
            icon: '⬛',
            description: 'Elegant grayscale aesthetic',
            vars: {
                '--bg-base': '#0a0a0a',
                '--bg-elevated': '#141414',
                '--bg-surface': '#1f1f1f',
                '--bg-highlight': '#2a2a2a',
                '--bg-press': '#3a3a3a',
                '--accent-primary': '#ffffff',
                '--accent-hover': '#e5e5e5',
                '--accent-subtle': 'rgba(255, 255, 255, 0.1)',
                '--text-primary': '#ffffff',
                '--text-secondary': '#a3a3a3',
                '--text-subdued': '#525252',
                '--border-color': '#2a2a2a',
                '--error-color': '#a3a3a3',
                '--shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.4)',
                '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.5)',
                '--shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.6)',
            },
            customStyles: `
                /* Monochrome minimal */
                .sidebar {
                    background: #0a0a0a !important;
                    border-right: 1px solid #1f1f1f !important;
                }
                
                .player-bar {
                    background: #0a0a0a !important;
                    border-top: 1px solid #1f1f1f !important;
                }
                
                .btn-primary {
                    background: #ffffff !important;
                    color: #0a0a0a !important;
                }
                
                .btn-primary:hover {
                    background: #e5e5e5 !important;
                }
                
                .progress-bar .progress, .volume-bar .progress {
                    background: #ffffff !important;
                }
                
                .icon-btn.active {
                    color: #ffffff !important;
                }
                
                .track-item.playing .track-title {
                    color: #ffffff !important;
                }
            `
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // THEME CUSTOMIZER PLUGIN
    // ═══════════════════════════════════════════════════════════════════════════

    const ThemeCustomizer = {
        name: 'Theme Customizer',
        currentTheme: 'native',
        uiElement: null,
        isOpen: false,

        init(api) {
            console.log('[ThemeCustomizer] Initializing...');
            this.api = api;

            // Load saved theme
            this.loadSavedTheme();

            // Inject styles
            this.injectBaseStyles();

            // Create UI
            this.createUI();
            this.createPlayerBarButton();

            // Retry for late DOM loading
            setTimeout(() => this.createPlayerBarButton(), 500);
            setTimeout(() => this.createPlayerBarButton(), 1500);

            console.log('[ThemeCustomizer] Plugin ready!');
        },

        async loadSavedTheme() {
            if (!this.api?.storage?.get) {
                console.error('[ThemeCustomizer] Storage API not available');
                return;
            }

            try {
                console.log('[ThemeCustomizer] Loading saved theme...');
                const savedTheme = await this.api.storage.get('selectedTheme');
                console.log(`[ThemeCustomizer] Retrieved saved theme: "${savedTheme}"`);

                let themeToLoad = savedTheme;
                // Migrate old 'default' to 'classic'
                if (themeToLoad === 'default') themeToLoad = 'classic';

                if (themeToLoad) {
                    if (THEMES[themeToLoad]) {
                        console.log(`[ThemeCustomizer] Theme "${themeToLoad}" found in definitions. Applying...`);
                        this.applyTheme(themeToLoad, false);
                    } else {
                        console.error(`[ThemeCustomizer] Theme "${themeToLoad}" NOT found in definitions.`);
                        console.log('Available themes:', Object.keys(THEMES));
                    }
                } else {
                    console.log('[ThemeCustomizer] No saved theme found.');
                }
            } catch (err) {
                console.error('[ThemeCustomizer] Failed to load saved theme:', err);
            }
        },

        async saveTheme(themeId) {
            if (!this.api?.storage?.set) return;

            try {
                await this.api.storage.set('selectedTheme', themeId);
            } catch (err) {
                console.error('[ThemeCustomizer] Failed to save theme:', err);
            }
        },

        injectBaseStyles() {
            if (document.getElementById('theme-customizer-styles')) return;

            const style = document.createElement('style');
            style.id = 'theme-customizer-styles';
            style.textContent = `
                /* Theme Picker Panel */
                #theme-picker-panel {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) scale(0.9);
                    background: var(--bg-elevated);
                    border: 1px solid var(--border-color);
                    border-radius: 16px;
                    padding: 24px;
                    width: 520px;
                    max-height: 80vh;
                    overflow-y: auto;
                    z-index: 10001;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                #theme-picker-panel.open {
                    opacity: 1;
                    visibility: visible;
                    transform: translate(-50%, -50%) scale(1);
                }

                #theme-picker-backdrop {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(4px);
                    z-index: 10000;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s ease;
                }

                #theme-picker-backdrop.open {
                    opacity: 1;
                    visibility: visible;
                }

                .theme-picker-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 20px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid var(--border-color);
                }

                .theme-picker-title {
                    font-size: 20px;
                    font-weight: 700;
                    color: var(--text-primary);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .theme-picker-title::before {
                    content: '🎨';
                    font-size: 24px;
                }

                .theme-picker-close {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: var(--bg-surface);
                    border: none;
                    color: var(--text-secondary);
                    font-size: 18px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                }

                .theme-picker-close:hover {
                    background: var(--bg-highlight);
                    color: var(--text-primary);
                    transform: rotate(90deg);
                }

                .theme-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                }

                .theme-card {
                    background: var(--bg-surface);
                    border: 2px solid transparent;
                    border-radius: 12px;
                    padding: 16px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    position: relative;
                    overflow: hidden;
                }

                .theme-card:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--shadow-md);
                    border-color: var(--border-color);
                }

                .theme-card.active {
                    border-color: var(--accent-primary);
                    box-shadow: 0 0 0 3px var(--accent-subtle);
                }

                .theme-card.active::after {
                    content: '✓';
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    width: 22px;
                    height: 22px;
                    background: var(--accent-primary);
                    color: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    font-weight: bold;
                }

                .theme-preview {
                    height: 48px;
                    border-radius: 8px;
                    margin-bottom: 12px;
                    display: flex;
                    align-items: flex-end;
                    padding: 6px;
                    gap: 4px;
                    position: relative;
                    overflow: hidden;
                }

                .theme-preview-bar {
                    flex: 1;
                    border-radius: 4px 4px 0 0;
                    min-height: 8px;
                }

                .theme-card-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-primary);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .theme-card-desc {
                    font-size: 12px;
                    color: var(--text-secondary);
                    margin-top: 4px;
                }

                .theme-card-icon {
                    font-size: 16px;
                }

                /* Player bar button */
                #theme-picker-btn {
                    margin-right: 4px;
                }

                #theme-picker-btn svg {
                    width: 20px;
                    height: 20px;
                }
            `;
            document.head.appendChild(style);
        },

        createUI() {
            if (document.getElementById('theme-picker-panel')) return;

            // Create backdrop
            const backdrop = document.createElement('div');
            backdrop.id = 'theme-picker-backdrop';
            backdrop.addEventListener('click', () => this.closePanel());
            document.body.appendChild(backdrop);

            // Create panel
            const panel = document.createElement('div');
            panel.id = 'theme-picker-panel';

            // Generate theme cards
            const themeCards = Object.entries(THEMES).map(([id, theme]) => {
                const bgColor = theme.vars['--bg-base'];
                const accentColor = theme.vars['--accent-primary'];
                const surfaceColor = theme.vars['--bg-surface'];

                return `
                    <div class="theme-card ${this.currentTheme === id ? 'active' : ''}" data-theme="${id}">
                        <div class="theme-preview" style="background: ${bgColor}">
                            <div class="theme-preview-bar" style="background: ${accentColor}; height: 70%"></div>
                            <div class="theme-preview-bar" style="background: ${surfaceColor}; height: 50%"></div>
                            <div class="theme-preview-bar" style="background: ${accentColor}; height: 85%"></div>
                            <div class="theme-preview-bar" style="background: ${surfaceColor}; height: 35%"></div>
                            <div class="theme-preview-bar" style="background: ${accentColor}; height: 60%"></div>
                        </div>
                        <div class="theme-card-title">
                            <span class="theme-card-icon">${theme.icon}</span>
                            ${theme.name}
                        </div>
                        <div class="theme-card-desc">${theme.description}</div>
                    </div>
                `;
            }).join('');

            panel.innerHTML = `
                <div class="theme-picker-header">
                    <div class="theme-picker-title">Choose Your Theme</div>
                    <button class="theme-picker-close" id="theme-picker-close-btn">×</button>
                </div>
                <div class="theme-grid">
                    ${themeCards}
                </div>
            `;

            document.body.appendChild(panel);
            this.uiElement = panel;

            // Add event listeners
            document.getElementById('theme-picker-close-btn').addEventListener('click', () => this.closePanel());

            panel.querySelectorAll('.theme-card').forEach(card => {
                card.addEventListener('click', () => {
                    const themeId = card.dataset.theme;
                    this.applyTheme(themeId, true);
                    this.updateActiveCard(themeId);
                });
            });
        },

        createPlayerBarButton() {
            if (document.getElementById('theme-picker-btn')) return;

            const button = document.createElement('button');
            button.id = 'theme-picker-btn';
            // Removed 'icon-btn'
            button.title = 'Change Theme';
            button.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
                </svg>
                <span>Change Theme</span>
            `;
            button.addEventListener('click', () => this.togglePanel());

            if (this.api && this.api.ui) {
                this.api.ui.registerSlot('playerbar:menu', button);
            } else {
                console.error('[ThemeCustomizer] UI API not available');
            }
        },

        togglePanel() {
            this.isOpen = !this.isOpen;
            document.getElementById('theme-picker-panel')?.classList.toggle('open', this.isOpen);
            document.getElementById('theme-picker-backdrop')?.classList.toggle('open', this.isOpen);
        },

        closePanel() {
            this.isOpen = false;
            document.getElementById('theme-picker-panel')?.classList.remove('open');
            document.getElementById('theme-picker-backdrop')?.classList.remove('open');
        },

        updateActiveCard(themeId) {
            document.querySelectorAll('.theme-card').forEach(card => {
                card.classList.toggle('active', card.dataset.theme === themeId);
            });
        },

        clearThemeOverrides() {
            const root = document.documentElement;
            // List of all vars used by themes (derived from classic theme)
            const vars = [
                '--bg-base', '--bg-elevated', '--bg-surface', '--bg-highlight', '--bg-press',
                '--accent-primary', '--accent-hover', '--accent-subtle',
                '--text-primary', '--text-secondary', '--text-subdued',
                '--border-color', '--error-color',
                '--shadow-sm', '--shadow-md', '--shadow-lg'
            ];
            vars.forEach(key => root.style.removeProperty(key));

            // Remove custom styles
            const existingCustom = document.getElementById('theme-custom-styles');
            if (existingCustom) existingCustom.remove();
        },

        applyTheme(themeId, save = true) {
            const theme = THEMES[themeId];
            if (!theme) return;

            console.log(`[ThemeCustomizer] Applying theme: ${theme.name}`);

            // Clear previous overrides first
            this.clearThemeOverrides();

            // If native, nothing more to do (overrides cleared)
            if (themeId !== 'native') {
                // Apply CSS variables
                const root = document.documentElement;
                Object.entries(theme.vars).forEach(([key, value]) => {
                    root.style.setProperty(key, value);
                });

                // Inject custom theme styles
                if (theme.customStyles) {
                    const customStyle = document.createElement('style');
                    customStyle.id = 'theme-custom-styles';
                    customStyle.textContent = theme.customStyles;
                    document.head.appendChild(customStyle);
                }
            } else {
                // Trigger app theme refresh to restore native theme
                if (this.api && this.api.theme && this.api.theme.refresh) {
                    console.log('[ThemeCustomizer] Triggering app theme refresh...');
                    this.api.theme.refresh();
                }
            }

            this.currentTheme = themeId;

            if (save) {
                this.saveTheme(themeId);
            }

            console.log(`[ThemeCustomizer] Theme "${theme.name}" applied successfully!`);
        },

        start() {
            console.log('[ThemeCustomizer] Plugin started');
            if (this.uiElement) {
                this.uiElement.style.display = '';
            }
        },

        stop() {
            console.log('[ThemeCustomizer] Plugin stopped');
            this.closePanel();
        },

        destroy() {
            // Remove all injected elements
            document.getElementById('theme-picker-panel')?.remove();
            document.getElementById('theme-picker-backdrop')?.remove();
            document.getElementById('theme-picker-btn')?.remove();
            document.getElementById('theme-customizer-styles')?.remove();
            document.getElementById('theme-custom-styles')?.remove();

            // Reset theme to default
            // Reset to native state (clear overrides)
            this.clearThemeOverrides();

            console.log('[ThemeCustomizer] Plugin destroyed');
        }
    };

    // Register plugin globally
    window.ThemeCustomizer = ThemeCustomizer;
    window.AudionPlugin = ThemeCustomizer;
})();
