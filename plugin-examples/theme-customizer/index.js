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
        },
        // ═══════════════════════════════════════════════════════════════════
        // CUSTOM THEME - User defined colors
        // ═══════════════════════════════════════════════════════════════════
        custom: {
            name: 'Custom',
            icon: '🎨',
            description: 'Design your own theme',
            vars: {}, // Dynamic
            customStyles: ''
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // THEME CUSTOMIZER CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════

    const CUSTOMIZABLE_VARS = [
        {
            group: 'Backgrounds',
            vars: [
                { key: '--bg-base', label: 'Base Layer', default: '#121212' },
                { key: '--bg-elevated', label: 'Elevated / Card', default: '#181818' },
                { key: '--bg-surface', label: 'Surface', default: '#282828' },
                { key: '--bg-highlight', label: 'Highlight', default: '#3e3e3e' },
                { key: '--bg-press', label: 'Press State', default: '#535353' }
            ]
        },
        {
            group: 'Accents',
            vars: [
                { key: '--accent-primary', label: 'Primary Accent', default: '#1DB954' },
                { key: '--accent-hover', label: 'Accent Hover', default: '#1ed760' },
                // { key: '--accent-subtle', label: 'Accent Subtle', default: 'rgba(29, 185, 84, 0.15)' } // handled via calc usually
            ]
        },
        {
            group: 'Text',
            vars: [
                { key: '--text-primary', label: 'Primary Text', default: '#ffffff' },
                { key: '--text-secondary', label: 'Secondary Text', default: '#b3b3b3' },
                { key: '--text-subdued', label: 'Subdued Text', default: '#6a6a6a' }
            ]
        },
        {
            group: 'UI Elements',
            vars: [
                { key: '--border-color', label: 'Borders', default: '#404040' },
                { key: '--error-color', label: 'Error State', default: '#f15e6c' }
            ]
        }
    ];

    // ═══════════════════════════════════════════════════════════════════════════
    // THEME CUSTOMIZER PLUGIN
    // ═══════════════════════════════════════════════════════════════════════════

    const ThemeCustomizer = {
        name: 'Theme Customizer',
        currentTheme: 'native',
        customColors: {}, // Populated from storage or defaults
        savedCustomThemes: {}, // Store multiple named custom themes
        importedThemes: {}, // Themes loaded from imported-theme folder
        themeFolderPath: null, // Will be set to the imported-theme folder path
        uiElement: null,
        isOpen: false,

        async init(api) {
            console.log('[ThemeCustomizer] Initializing...');
            this.api = api;

            // Initialize customColors with defaults if empty
            CUSTOMIZABLE_VARS.forEach(group => {
                group.vars.forEach(v => {
                    if (!this.customColors[v.key]) {
                        this.customColors[v.key] = v.default;
                    }
                });
            });

            // Load saved theme and custom colors
            this.loadSavedTheme();
            
            // Initialize theme folder and load imported themes
            await this.initThemeFolder();
            await this.loadImportedThemes();

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

                // Load custom colors
                const savedColors = await this.api.storage.get('customColors');
                if (savedColors) {
                    try {
                        const parsed = JSON.parse(savedColors);
                        this.customColors = { ...this.customColors, ...parsed };
                    } catch (e) {
                        console.error('[ThemeCustomizer] Failed to parse custom colors', e);
                    }
                }
                
                // Load saved custom themes
                const savedThemes = await this.api.storage.get('savedCustomThemes');
                if (savedThemes) {
                    try {
                        this.savedCustomThemes = JSON.parse(savedThemes);
                    } catch (e) {
                        console.error('[ThemeCustomizer] Failed to parse saved themes', e);
                    }
                }

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
        
        async initThemeFolder() {
            // Note: Plugins don't have direct file system access
            // We'll store imported themes in localStorage via api.storage instead
            console.log('[ThemeCustomizer] Using storage API for imported themes');
        },
        
        async loadImportedThemes() {
            if (!this.api?.storage?.get) return;
            
            try {
                const savedImported = await this.api.storage.get('importedThemes');
                if (savedImported) {
                    this.importedThemes = JSON.parse(savedImported);
                    console.log(`[ThemeCustomizer] Loaded ${Object.keys(this.importedThemes).length} imported themes`);
                }
            } catch (err) {
                console.error('[ThemeCustomizer] Failed to load imported themes:', err);
            }
        },

        async saveTheme(themeId) {
            if (!this.api?.storage?.set) return;

            try {
                await this.api.storage.set('selectedTheme', themeId);
                // Save custom colors if we are in custom mode or just generally
                await this.api.storage.set('customColors', JSON.stringify(this.customColors));
                // Save custom themes collection
                await this.api.storage.set('savedCustomThemes', JSON.stringify(this.savedCustomThemes));
                // Save imported themes collection
                await this.api.storage.set('importedThemes', JSON.stringify(this.importedThemes));
            } catch (err) {
                console.error('[ThemeCustomizer] Failed to save theme:', err);
            }
        },

        injectBaseStyles() {
            if (document.getElementById('theme-customizer-styles')) return;

            const style = document.createElement('style');
            style.id = 'theme-customizer-styles';
            style.textContent = `
                /* Mock Audion Player Preview */
                #mock-audion-preview {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: var(--bg-base);
                    z-index: 9999;
                    display: none;
                    flex-direction: column;
                }

                #mock-audion-preview.active {
                    display: flex;
                }

                .mock-player-container {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                }

                .mock-sidebar {
                    width: 240px;
                    background: var(--bg-elevated);
                    border-right: 1px solid var(--border-color);
                    padding: 20px;
                    overflow-y: auto;
                }

                .mock-sidebar-logo {
                    font-size: 24px;
                    font-weight: 700;
                    color: var(--text-primary);
                    margin-bottom: 30px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .mock-nav-item {
                    padding: 10px 12px;
                    border-radius: 8px;
                    color: var(--text-secondary);
                    margin-bottom: 4px;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 14px;
                }

                .mock-nav-item:hover {
                    background: var(--bg-surface);
                    color: var(--text-primary);
                }

                .mock-nav-item.active {
                    background: var(--bg-highlight);
                    color: var(--accent-primary);
                }

                .mock-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                .mock-content-header {
                    padding: 24px 32px;
                    background: var(--bg-elevated);
                    border-bottom: 1px solid var(--border-color);
                }

                .mock-content-title {
                    font-size: 32px;
                    font-weight: 700;
                    color: var(--text-primary);
                    margin-bottom: 8px;
                }

                .mock-content-subtitle {
                    color: var(--text-secondary);
                    font-size: 14px;
                }

                .mock-content-body {
                    flex: 1;
                    padding: 32px;
                    overflow-y: auto;
                }

                .mock-track-list {
                    background: var(--bg-surface);
                    border-radius: 8px;
                    overflow: hidden;
                }

                .mock-track {
                    padding: 12px 16px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    transition: background 0.2s;
                    cursor: pointer;
                    border-bottom: 1px solid var(--border-color);
                }

                .mock-track:last-child {
                    border-bottom: none;
                }

                .mock-track:hover {
                    background: var(--bg-highlight);
                }

                .mock-track-number {
                    color: var(--text-subdued);
                    font-size: 14px;
                    width: 30px;
                }

                .mock-track-info {
                    flex: 1;
                }

                .mock-track-title {
                    color: var(--text-primary);
                    font-weight: 500;
                    margin-bottom: 4px;
                }

                .mock-track-artist {
                    color: var(--text-secondary);
                    font-size: 13px;
                }

                .mock-track-duration {
                    color: var(--text-subdued);
                    font-size: 14px;
                }

                .mock-player-bar {
                    background: var(--bg-elevated);
                    border-top: 1px solid var(--border-color);
                    padding: 16px 20px;
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
                }

                .mock-player-controls {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .mock-player-btn {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: none;
                    background: transparent;
                    color: var(--text-secondary);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }

                .mock-player-btn:hover {
                    color: var(--text-primary);
                    background: var(--bg-surface);
                }

                .mock-player-btn.play {
                    width: 40px;
                    height: 40px;
                    background: var(--accent-primary);
                    color: white;
                }

                .mock-player-btn.play:hover {
                    background: var(--accent-hover);
                }

                .mock-player-progress {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .mock-progress-bar {
                    height: 4px;
                    background: var(--bg-surface);
                    border-radius: 2px;
                    overflow: hidden;
                    cursor: pointer;
                }

                .mock-progress-fill {
                    height: 100%;
                    background: var(--accent-primary);
                    width: 35%;
                    transition: width 0.1s;
                }

                .mock-progress-time {
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    color: var(--text-subdued);
                }

                .mock-player-volume {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 120px;
                }

                /* Theme Picker Panel - Split Pane */
                #theme-picker-panel {
                    position: fixed;
                    top: 4vh;
                    left: 3vw;
                    right: 3vw;
                    bottom: 4vh;
                    background: var(--bg-base);
                    z-index: 10001;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    display: flex;
                    flex-direction: column;
                    border-radius: 16px;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
                    border: 1px solid var(--border-color);
                    overflow: hidden;
                }

                #theme-picker-panel.open {
                    opacity: 1;
                    visibility: visible;
                }

                #theme-picker-backdrop {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(8px);
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
                    padding: 16px 24px;
                    background: var(--bg-elevated);
                    border-bottom: 1px solid var(--border-color);
                    flex-shrink: 0;
                }

                .theme-picker-actions {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .preview-toggle-btn {
                    padding: 8px 16px;
                    background: var(--accent-primary);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .preview-toggle-btn:hover {
                    background: var(--accent-hover);
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

                .theme-picker-body {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                    min-height: 0;
                }

                .theme-list-section {
                    flex: 0 0 580px;
                    padding: 16px;
                    overflow-y: auto;
                    background: var(--bg-elevated);
                    border-right: 1px solid var(--border-color);
                }

                @media (max-width: 1024px) {
                    .theme-picker-body {
                        flex-direction: column;
                    }
                    .theme-list-section {
                        flex: 0 0 300px;
                    }
                    .theme-grid,
                    .theme-grid.premade {
                        grid-template-columns: repeat(2, 1fr);
                    }
                }

                .theme-section-title {
                    font-size: 9px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 1.2px;
                    color: var(--accent-primary);
                    margin: 16px 0 10px 0;
                    padding-bottom: 6px;
                    border-bottom: 2px solid var(--accent-primary);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .theme-section-title:first-child {
                    margin-top: 0;
                }

                .theme-section-title::before {
                    content: '';
                    width: 3px;
                    height: 14px;
                    background: var(--accent-primary);
                    border-radius: 2px;
                }

                .theme-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 10px;
                    margin-bottom: 6px;
                }

                .theme-grid.premade {
                    grid-template-columns: repeat(3, 1fr);
                }

                .theme-card {
                    background: var(--bg-base);
                    border: 2px solid var(--border-color);
                    border-radius: 8px;
                    padding: 8px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    position: relative;
                    overflow: hidden;
                }

                .theme-card.custom {
                    background: linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-highlight) 100%);
                    border: 2px solid transparent;
                    background-clip: padding-box;
                    position: relative;
                }

                .theme-card.custom::before {
                    content: '';
                    position: absolute;
                    inset: -2px;
                    border-radius: 12px;
                    padding: 2px;
                    background: linear-gradient(135deg, #ff00ff, #00ffff, #ff00ff);
                    background-size: 200% 200%;
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    animation: shimmer 3s linear infinite;
                    z-index: -1;
                }

                .theme-card.custom .theme-card-title::after {
                    content: '✨';
                    margin-left: 4px;
                    font-size: 14px;
                }

                @keyframes shimmer {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }

                @keyframes slideIn {
                    from { transform: translateX(400px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(400px); opacity: 0; }
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
                    height: 32px;
                    border-radius: 6px;
                    margin-bottom: 6px;
                    display: flex;
                    align-items: flex-end;
                    padding: 3px;
                    gap: 2px;
                    position: relative;
                    overflow: hidden;
                }

                .theme-preview-bar {
                    flex: 1;
                    border-radius: 2px 2px 0 0;
                    min-height: 5px;
                }

                .theme-card-title {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-primary);
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }

                .theme-card-desc {
                    font-size: 10px;
                    color: var(--text-secondary);
                    margin-top: 2px;
                    line-height: 1.3;
                }

                .theme-card-icon {
                    font-size: 13px;
                }

                /* Custom Color Controls */
                .theme-editor-section {
                    flex: 1;
                    padding: 24px;
                    overflow-y: auto;
                    background: var(--bg-base);
                    position: relative;
                }

                .live-preview-indicator {
                    position: sticky;
                    top: 0;
                    background: var(--accent-subtle);
                    border: 1px solid var(--accent-primary);
                    border-radius: 8px;
                    padding: 12px 16px;
                    margin-bottom: 24px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 13px;
                    color: var(--text-primary);
                    z-index: 10;
                }

                .live-preview-indicator::before {
                    content: '👁️';
                    font-size: 18px;
                }

                .live-preview-indicator strong {
                    color: var(--accent-primary);
                }

                .editor-placeholder {
                    display: none;
                }

                .theme-details-panel {
                    display: none;
                    height: 100%;
                    flex-direction: column;
                }

                .theme-details-panel.visible {
                    display: flex;
                }

                .theme-details-header {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    margin-bottom: 24px;
                    padding-bottom: 20px;
                    border-bottom: 2px solid var(--border-color);
                }

                .theme-details-icon {
                    font-size: 48px;
                    width: 80px;
                    height: 80px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--bg-elevated);
                    border-radius: 16px;
                    border: 2px solid var(--border-color);
                }

                .theme-details-info {
                    flex: 1;
                }

                .theme-details-name {
                    font-size: 28px;
                    font-weight: 700;
                    color: var(--text-primary);
                    margin-bottom: 8px;
                }

                .theme-details-desc {
                    font-size: 14px;
                    color: var(--text-secondary);
                }

                .theme-details-body {
                    flex: 1;
                    overflow-y: auto;
                }

                .theme-palette-section {
                    margin-bottom: 32px;
                }

                .theme-palette-title {
                    font-size: 14px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: var(--text-subdued);
                    margin-bottom: 16px;
                    letter-spacing: 1px;
                }

                .theme-palette-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 12px;
                }

                .theme-color-item {
                    background: var(--bg-elevated);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .theme-color-swatch {
                    height: 50px;
                    border-radius: 6px;
                    border: 1px solid var(--border-color);
                }

                .theme-color-label {
                    font-size: 11px;
                    color: var(--text-subdued);
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .theme-color-value {
                    font-size: 12px;
                    color: var(--text-secondary);
                    font-family: monospace;
                }

                .theme-actions {
                    display: flex;
                    gap: 12px;
                    margin-top: 24px;
                    padding-top: 24px;
                    border-top: 1px solid var(--border-color);
                }

                .theme-action-btn {
                    flex: 1;
                    padding: 12px 20px;
                    background: var(--bg-elevated);
                    border: 2px solid var(--border-color);
                    border-radius: 8px;
                    color: var(--text-primary);
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }

                .theme-action-btn:hover {
                    background: var(--bg-highlight);
                    border-color: var(--accent-primary);
                    transform: translateY(-2px);
                }

                .theme-action-btn.primary {
                    background: var(--accent-primary);
                    border-color: var(--accent-primary);
                    color: white;
                }

                .theme-action-btn.primary:hover {
                    background: var(--accent-hover);
                    border-color: var(--accent-hover);
                }
                
                .theme-action-btn.danger {
                    background: transparent;
                    border-color: var(--error-color);
                    color: var(--error-color);
                }
                
                .theme-action-btn.danger:hover {
                    background: var(--error-color);
                    border-color: var(--error-color);
                    color: white;
                }

                #custom-theme-controls {
                    display: none;
                    height: 100%;
                }

                #custom-theme-controls.visible {
                    display: flex;
                    flex-direction: column;
                }

                .custom-theme-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                    padding-bottom: 20px;
                    border-bottom: 2px solid var(--border-color);
                    color: var(--text-primary);
                    flex-shrink: 0;
                }

                .custom-theme-header h3 {
                    margin: 0;
                    font-size: 28px;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .custom-theme-header h3::before {
                    font-size: 48px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 80px;
                    height: 80px;
                    background: var(--bg-elevated);
                    border-radius: 16px;
                    border: 2px solid var(--border-color);
                }
                
                .custom-theme-actions {
                    display: flex;
                    gap: 8px;
                }

                .action-btn {
                    padding: 8px 16px;
                    background: var(--bg-elevated);
                    border: 2px solid var(--border-color);
                    border-radius: 8px;
                    color: var(--text-primary);
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .action-btn:hover {
                    background: var(--bg-highlight);
                    border-color: var(--accent-primary);
                    transform: translateY(-2px);
                }

                .color-groups-container {
                    display: flex;
                    flex-direction: column;
                    gap: 32px;
                    overflow-y: auto;
                    flex: 1;
                    padding-right: 8px;
                }
                
                .color-group {
                    margin-bottom: 0;
                }

                .color-group-title {
                    font-size: 14px;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: var(--text-subdued);
                    margin-bottom: 16px;
                    letter-spacing: 1px;
                }

                .color-control-group {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 12px;
                }

                .color-input-wrapper {
                    background: var(--bg-elevated);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    transition: all 0.2s;
                }

                .color-input-wrapper:hover {
                    border-color: var(--accent-primary);
                    transform: translateY(-2px);
                }

                .color-label {
                    font-size: 11px;
                    color: var(--text-subdued);
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    order: 2;
                }

                .color-input-container {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    order: 1;
                }

                .color-swatch-preview {
                    height: 50px;
                    border-radius: 6px;
                    border: 1px solid var(--border-color);
                    cursor: pointer;
                    position: relative;
                    overflow: hidden;
                }

                input[type="color"] {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    opacity: 0;
                    cursor: pointer;
                }

                input[type="text"].color-text {
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    font-family: monospace;
                    font-size: 12px;
                    text-align: center;
                    order: 3;
                    padding: 0;
                }

                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-10px); }
                    to { opacity: 1; transform: translateY(0); }
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

            // Create mock Audion preview
            const mockPreview = document.createElement('div');
            mockPreview.id = 'mock-audion-preview';
            mockPreview.innerHTML = `
                <div class="mock-player-container">
                    <div class="mock-sidebar">
                        <div class="mock-sidebar-logo">🎵 Audion</div>
                        <div class="mock-nav-item active">🏠 Home</div>
                        <div class="mock-nav-item">🔍 Search</div>
                        <div class="mock-nav-item">📚 Library</div>
                        <div class="mock-nav-item">❤️ Liked Songs</div>
                        <div class="mock-nav-item">📋 Playlists</div>
                    </div>
                    <div class="mock-content">
                        <div class="mock-content-header">
                            <div class="mock-content-title">Your Music</div>
                            <div class="mock-content-subtitle">Recently played tracks</div>
                        </div>
                        <div class="mock-content-body">
                            <div class="mock-track-list">
                                <div class="mock-track">
                                    <div class="mock-track-number">1</div>
                                    <div class="mock-track-info">
                                        <div class="mock-track-title">Midnight Dreams</div>
                                        <div class="mock-track-artist">Luna Eclipse</div>
                                    </div>
                                    <div class="mock-track-duration">3:42</div>
                                </div>
                                <div class="mock-track">
                                    <div class="mock-track-number">2</div>
                                    <div class="mock-track-info">
                                        <div class="mock-track-title">Neon Lights</div>
                                        <div class="mock-track-artist">Synthwave Collective</div>
                                    </div>
                                    <div class="mock-track-duration">4:15</div>
                                </div>
                                <div class="mock-track">
                                    <div class="mock-track-number">3</div>
                                    <div class="mock-track-info">
                                        <div class="mock-track-title">Ocean Waves</div>
                                        <div class="mock-track-artist">Ambient Sounds</div>
                                    </div>
                                    <div class="mock-track-duration">5:23</div>
                                </div>
                                <div class="mock-track">
                                    <div class="mock-track-number">4</div>
                                    <div class="mock-track-info">
                                        <div class="mock-track-title">Cherry Blossom</div>
                                        <div class="mock-track-artist">Japanese Garden</div>
                                    </div>
                                    <div class="mock-track-duration">3:58</div>
                                </div>
                                <div class="mock-track">
                                    <div class="mock-track-number">5</div>
                                    <div class="mock-track-info">
                                        <div class="mock-track-title">Forest Path</div>
                                        <div class="mock-track-artist">Nature's Symphony</div>
                                    </div>
                                    <div class="mock-track-duration">4:32</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="mock-player-bar">
                    <div class="mock-player-controls">
                        <button class="mock-player-btn">⏮</button>
                        <button class="mock-player-btn play">▶</button>
                        <button class="mock-player-btn">⏭</button>
                    </div>
                    <div class="mock-player-progress">
                        <div class="mock-progress-bar">
                            <div class="mock-progress-fill"></div>
                        </div>
                        <div class="mock-progress-time">
                            <span>1:32</span>
                            <span>4:15</span>
                        </div>
                    </div>
                    <div class="mock-player-volume">
                        <span>🔊</span>
                        <div class="mock-progress-bar" style="flex:1">
                            <div class="mock-progress-fill" style="width:70%"></div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(mockPreview);

            // Create backdrop
            const backdrop = document.createElement('div');
            backdrop.id = 'theme-picker-backdrop';
            backdrop.addEventListener('click', () => this.closePanel());
            document.body.appendChild(backdrop);

            // Create panel
            const panel = document.createElement('div');
            panel.id = 'theme-picker-panel';

            // Generate theme cards
            const generateThemeCard = (id, theme) => {
                let bgColor, accentColor, surfaceColor;

                if (id === 'custom') {
                    bgColor = this.customColors['--bg-base'] || '#121212';
                    accentColor = this.customColors['--accent-primary'] || '#1DB954';
                    surfaceColor = this.customColors['--bg-surface'] || '#282828';
                } else {
                    bgColor = theme.vars['--bg-base'] || '#000';
                    accentColor = theme.vars['--accent-primary'] || '#fff';
                    surfaceColor = theme.vars['--bg-surface'] || '#222';
                }

                const customClass = id === 'custom' ? 'custom' : '';
                return `
                    <div class="theme-card ${customClass} ${this.currentTheme === id ? 'active' : ''}" data-theme="${id}">
                        <div class="theme-preview" style="background: ${bgColor}; --preview-bg: ${bgColor}">
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
            };

            // Separate custom and premade themes
            const customTheme = THEMES.custom;
            const premadeThemes = Object.entries(THEMES).filter(([id]) => id !== 'custom');

            // Group themes by category
            const systemThemes = premadeThemes.filter(([id]) => ['native', 'classic', 'light', 'monochrome'].includes(id));
            const vibrantThemes = premadeThemes.filter(([id]) => ['cyberpunk', 'aurora', 'midnight'].includes(id));
            const natureThemes = premadeThemes.filter(([id]) => ['sunset', 'ocean', 'sakura', 'forest'].includes(id));

            // Generate Custom Controls dynamically
            const generateCustomControls = () => {
                return CUSTOMIZABLE_VARS.map(group => `
                    <div class="color-group">
                        <div class="color-group-title">${group.group}</div>
                        <div class="color-control-group">
                            ${group.vars.map(v => `
                                <div class="color-input-wrapper">
                                    <div class="color-input-container">
                                        <div class="color-swatch-preview" style="background: ${this.customColors[v.key] || v.default}">
                                            <input type="color" id="custom-${v.key}" value="${this.customColors[v.key] || v.default}">
                                        </div>
                                    </div>
                                    <label class="color-label">${v.label}</label>
                                    <input type="text" class="color-text" value="${this.customColors[v.key] || v.default}" readonly>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('');
            };

            panel.innerHTML = `
                <div class="theme-picker-header">
                    <div class="theme-picker-title">Theme Studio</div>
                    <div class="theme-picker-actions">
                        <button class="theme-picker-close" id="theme-picker-close-btn">×</button>
                    </div>
                </div>
                <div class="theme-picker-body">
                    <div class="theme-list-section">
                        <div class="theme-section-title">✨ Custom</div>
                        <div class="theme-grid">
                            ${generateThemeCard('custom', customTheme)}
                        </div>
                        
                        ${Object.keys(this.savedCustomThemes).length > 0 ? `
                        <div class="theme-section-title">💾 Saved Themes</div>
                        <div class="theme-grid">
                            ${Object.entries(this.savedCustomThemes).map(([id, theme]) => {
                                const themeObj = {
                                    name: theme.name,
                                    icon: '🎨',
                                    description: new Date(theme.created).toLocaleDateString(),
                                    vars: theme.colors
                                };
                                return generateThemeCard(id, themeObj);
                            }).join('')}
                        </div>
                        ` : ''}
                        
                        ${Object.keys(this.importedThemes).length > 0 ? `
                        <div class="theme-section-title">📎 Imported Themes</div>
                        <div class="theme-grid">
                            ${Object.entries(this.importedThemes).map(([id, theme]) => {
                                const themeObj = {
                                    name: theme.name,
                                    icon: '🌈',
                                    description: new Date(theme.created).toLocaleDateString(),
                                    vars: theme.colors
                                };
                                return generateThemeCard(id, themeObj);
                            }).join('')}
                        </div>
                        ` : ''}
                        
                        <div class="theme-section-title">🖥️ System</div>
                        <div class="theme-grid premade">
                            ${systemThemes.map(([id, theme]) => generateThemeCard(id, theme)).join('')}
                        </div>

                        <div class="theme-section-title">⚡ Vibrant</div>
                        <div class="theme-grid premade">
                            ${vibrantThemes.map(([id, theme]) => generateThemeCard(id, theme)).join('')}
                        </div>

                        <div class="theme-section-title">🌿 Nature & Calm</div>
                        <div class="theme-grid premade">
                            ${natureThemes.map(([id, theme]) => generateThemeCard(id, theme)).join('')}
                        </div>
                    </div>
                    
                    <div class="theme-editor-section">
                        <div id="theme-details-panel" class="theme-details-panel ${this.currentTheme !== 'custom' ? 'visible' : ''}">
                            <!-- Theme details populated dynamically -->
                        </div>
                        
                        <div id="custom-theme-controls" class="${this.currentTheme === 'custom' ? 'visible' : ''}">
                            <div class="custom-theme-header">
                                <div style="display: flex; align-items: center; gap: 16px;">
                                    <div style="font-size: 48px; width: 80px; height: 80px; display: flex; align-items: center; justify-content: center; background: var(--bg-elevated); border-radius: 16px; border: 2px solid var(--border-color);">🎨</div>
                                    <h3 style="font-size: 28px; font-weight: 700; margin: 0;">Custom Colors</h3>
                                </div>
                                <div class="custom-theme-actions">
                                    <button class="action-btn" id="random-theme-btn">Random</button>
                                    <button class="action-btn" id="save-as-theme-btn">Save As</button>
                                    <button class="action-btn" id="import-theme-btn">Import</button>
                                    <input type="file" id="import-theme-input" accept=".json" style="display:none">
                                </div>
                            </div>
                            <div class="color-groups-container">
                                ${generateCustomControls()}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(panel);
            this.uiElement = panel;

            // Initialize theme details if not custom
            if (this.currentTheme !== 'custom') {
                this.updateThemeDetails(this.currentTheme);
            }

            // Add event listeners
            document.getElementById('theme-picker-close-btn').addEventListener('click', () => this.closePanel());

            panel.querySelectorAll('.theme-card').forEach(card => {
                card.addEventListener('click', () => {
                    const themeId = card.dataset.theme;
                    this.applyTheme(themeId, true);
                    this.updateActiveCard(themeId);

                    // Toggle between custom controls and theme details
                    const controls = document.getElementById('custom-theme-controls');
                    const details = document.getElementById('theme-details-panel');
                    
                    if (themeId === 'custom') {
                        controls.classList.add('visible');
                        details.classList.remove('visible');
                    } else {
                        controls.classList.remove('visible');
                        details.classList.add('visible');
                        this.updateThemeDetails(themeId);
                    }
                });
            });

            // Bind color pickers dynamically
            CUSTOMIZABLE_VARS.forEach(group => {
                group.vars.forEach(v => {
                    this.bindColorPicker(`custom-${v.key}`, v.key);
                });
            });

            // Bind Random/Save/Import
            document.getElementById('random-theme-btn').addEventListener('click', () => this.generateRandomTheme());
            document.getElementById('save-as-theme-btn').addEventListener('click', () => this.showSaveAsDialog());
            document.getElementById('import-theme-btn').addEventListener('click', () => {
                document.getElementById('import-theme-input').click();
            });
            document.getElementById('import-theme-input').addEventListener('change', (e) => this.importTheme(e));
        },
        
        refreshUI() {
            // Refresh the theme list without closing the panel
            if (!this.uiElement) return;
            
            const panel = this.uiElement;
            const themeListSection = panel.querySelector('.theme-list-section');
            if (!themeListSection) return;
            
            // Regenerate theme cards
            const customTheme = THEMES.custom;
            const premadeThemes = Object.entries(THEMES).filter(([id]) => id !== 'custom');
            const systemThemes = premadeThemes.filter(([id]) => ['native', 'classic', 'light', 'monochrome'].includes(id));
            const vibrantThemes = premadeThemes.filter(([id]) => ['cyberpunk', 'aurora', 'midnight'].includes(id));
            const natureThemes = premadeThemes.filter(([id]) => ['sunset', 'ocean', 'sakura', 'forest'].includes(id));
            
            const generateThemeCard = (id, theme) => {
                let bgColor, accentColor, surfaceColor;
                if (id === 'custom') {
                    bgColor = this.customColors['--bg-base'] || '#121212';
                    accentColor = this.customColors['--accent-primary'] || '#1DB954';
                    surfaceColor = this.customColors['--bg-surface'] || '#282828';
                } else {
                    bgColor = theme.vars['--bg-base'] || '#000';
                    accentColor = theme.vars['--accent-primary'] || '#fff';
                    surfaceColor = theme.vars['--bg-surface'] || '#222';
                }
                const customClass = id === 'custom' ? 'custom' : '';
                return `
                    <div class="theme-card ${customClass} ${this.currentTheme === id ? 'active' : ''}" data-theme="${id}">
                        <div class="theme-preview" style="background: ${bgColor}; --preview-bg: ${bgColor}">
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
            };
            
            themeListSection.innerHTML = `
                <div class="theme-section-title">✨ Custom</div>
                <div class="theme-grid">
                    ${generateThemeCard('custom', customTheme)}
                </div>
                
                ${Object.keys(this.savedCustomThemes).length > 0 ? `
                <div class="theme-section-title">💾 Saved Themes</div>
                <div class="theme-grid">
                    ${Object.entries(this.savedCustomThemes).map(([id, theme]) => {
                        const themeObj = {
                            name: theme.name,
                            icon: '🎨',
                            description: new Date(theme.created).toLocaleDateString(),
                            vars: theme.colors
                        };
                        return generateThemeCard(id, themeObj);
                    }).join('')}
                </div>
                ` : ''}
                
                ${Object.keys(this.importedThemes).length > 0 ? `
                <div class="theme-section-title">📎 Imported Themes</div>
                <div class="theme-grid">
                    ${Object.entries(this.importedThemes).map(([id, theme]) => {
                        const themeObj = {
                            name: theme.name,
                            icon: '🌈',
                            description: new Date(theme.created).toLocaleDateString(),
                            vars: theme.colors
                        };
                        return generateThemeCard(id, themeObj);
                    }).join('')}
                </div>
                ` : ''}
                
                <div class="theme-section-title">🖥️ System</div>
                <div class="theme-grid premade">
                    ${systemThemes.map(([id, theme]) => generateThemeCard(id, theme)).join('')}
                </div>

                <div class="theme-section-title">⚡ Vibrant</div>
                <div class="theme-grid premade">
                    ${vibrantThemes.map(([id, theme]) => generateThemeCard(id, theme)).join('')}
                </div>

                <div class="theme-section-title">🌿 Nature & Calm</div>
                <div class="theme-grid premade">
                    ${natureThemes.map(([id, theme]) => generateThemeCard(id, theme)).join('')}
                </div>
            `;
            
            // Re-bind theme card click events
            panel.querySelectorAll('.theme-card').forEach(card => {
                card.addEventListener('click', () => {
                    const themeId = card.dataset.theme;
                    this.applyTheme(themeId, true);
                    this.updateActiveCard(themeId);

                    const controls = document.getElementById('custom-theme-controls');
                    const details = document.getElementById('theme-details-panel');
                    
                    if (themeId === 'custom') {
                        controls.classList.add('visible');
                        details.classList.remove('visible');
                    } else {
                        controls.classList.remove('visible');
                        details.classList.add('visible');
                        this.updateThemeDetails(themeId);
                    }
                });
            });
        },

        generateRandomTheme() {
            // Generate base hue for color harmony
            const baseHue = Math.floor(Math.random() * 360);
            const isDarkTheme = Math.random() > 0.3; // 70% chance of dark theme
            
            // Helper to convert HSL to hex
            const hslToHex = (h, s, l) => {
                l /= 100;
                const a = s * Math.min(l, 1 - l) / 100;
                const f = n => {
                    const k = (n + h / 30) % 12;
                    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                    return Math.round(255 * color).toString(16).padStart(2, '0');
                };
                return `#${f(0)}${f(8)}${f(4)}`;
            };
            
            let newColors = {};
            
            if (isDarkTheme) {
                // Dark theme backgrounds (low saturation, low lightness)
                newColors['--bg-base'] = hslToHex(baseHue, 15, 7);
                newColors['--bg-elevated'] = hslToHex(baseHue, 15, 10);
                newColors['--bg-surface'] = hslToHex(baseHue, 15, 15);
                newColors['--bg-highlight'] = hslToHex(baseHue, 15, 22);
                newColors['--bg-press'] = hslToHex(baseHue, 15, 30);
                
                // Accent colors (complementary or analogous)
                const accentHue = (baseHue + 180 + (Math.random() * 60 - 30)) % 360;
                newColors['--accent-primary'] = hslToHex(accentHue, 70 + Math.random() * 20, 55 + Math.random() * 10);
                newColors['--accent-hover'] = hslToHex(accentHue, 75 + Math.random() * 20, 65 + Math.random() * 10);
                
                // Text colors (high lightness for dark backgrounds)
                newColors['--text-primary'] = hslToHex(baseHue, 5, 95);
                newColors['--text-secondary'] = hslToHex(baseHue, 10, 70);
                newColors['--text-subdued'] = hslToHex(baseHue, 10, 45);
            } else {
                // Light theme backgrounds (low saturation, high lightness)
                newColors['--bg-base'] = hslToHex(baseHue, 20, 97);
                newColors['--bg-elevated'] = hslToHex(baseHue, 20, 94);
                newColors['--bg-surface'] = hslToHex(baseHue, 20, 88);
                newColors['--bg-highlight'] = hslToHex(baseHue, 20, 80);
                newColors['--bg-press'] = hslToHex(baseHue, 20, 72);
                
                // Accent colors (vibrant for light backgrounds)
                const accentHue = (baseHue + 180 + (Math.random() * 60 - 30)) % 360;
                newColors['--accent-primary'] = hslToHex(accentHue, 65 + Math.random() * 25, 45 + Math.random() * 10);
                newColors['--accent-hover'] = hslToHex(accentHue, 70 + Math.random() * 25, 40 + Math.random() * 10);
                
                // Text colors (low lightness for light backgrounds)
                newColors['--text-primary'] = hslToHex(baseHue, 10, 10);
                newColors['--text-secondary'] = hslToHex(baseHue, 10, 35);
                newColors['--text-subdued'] = hslToHex(baseHue, 10, 55);
            }
            
            // UI elements
            newColors['--border-color'] = isDarkTheme ? hslToHex(baseHue, 15, 25) : hslToHex(baseHue, 15, 75);
            newColors['--error-color'] = hslToHex(0, 75, 60);
            
            // Apply the generated colors
            this.customColors = newColors;
            this.saveTheme('custom');
            
            // Update all color pickers
            CUSTOMIZABLE_VARS.forEach(group => {
                group.vars.forEach(v => {
                    const colorInput = document.getElementById(`custom-${v.key}`);
                    const textInput = colorInput?.parentElement?.parentElement?.parentElement?.querySelector('.color-text');
                    const swatchPreview = colorInput?.parentElement;
                    
                    if (colorInput && newColors[v.key]) {
                        colorInput.value = newColors[v.key];
                        if (textInput) textInput.value = newColors[v.key];
                        if (swatchPreview) swatchPreview.style.background = newColors[v.key];
                    }
                });
            });
            
            // Apply theme
            this.applyTheme('custom', true);
        },

        updateThemeDetails(themeId) {
            let theme = THEMES[themeId];
            
            // Check if it's a saved custom theme
            const isSavedCustom = themeId.startsWith('custom-');
            const isImported = themeId.startsWith('imported-');
            
            if (isSavedCustom && this.savedCustomThemes[themeId]) {
                theme = {
                    name: this.savedCustomThemes[themeId].name,
                    icon: '🎨',
                    description: new Date(this.savedCustomThemes[themeId].created).toLocaleDateString(),
                    vars: this.savedCustomThemes[themeId].colors
                };
            } else if (isImported && this.importedThemes[themeId]) {
                theme = {
                    name: this.importedThemes[themeId].name,
                    icon: '🌈',
                    description: new Date(this.importedThemes[themeId].created).toLocaleDateString(),
                    vars: this.importedThemes[themeId].colors
                };
            }
            
            if (!theme) return;

            const detailsPanel = document.getElementById('theme-details-panel');
            if (!detailsPanel) return;

            // Generate color palette
            const colorGroups = [
                { title: 'Backgrounds', colors: ['--bg-base', '--bg-elevated', '--bg-surface', '--bg-highlight', '--bg-press'] },
                { title: 'Accents', colors: ['--accent-primary', '--accent-hover', '--accent-subtle'] },
                { title: 'Text', colors: ['--text-primary', '--text-secondary', '--text-subdued'] },
                { title: 'UI Elements', colors: ['--border-color', '--error-color'] }
            ];

            const colorSections = colorGroups.map(group => {
                const colors = group.colors
                    .filter(colorKey => theme.vars[colorKey])
                    .map(colorKey => {
                        const label = colorKey.replace('--', '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                        return `
                            <div class="theme-color-item">
                                <div class="theme-color-swatch" style="background: ${theme.vars[colorKey]}"></div>
                                <div class="theme-color-label">${label}</div>
                                <div class="theme-color-value">${theme.vars[colorKey]}</div>
                            </div>
                        `;
                    }).join('');

                if (!colors) return '';

                return `
                    <div class="theme-palette-section">
                        <div class="theme-palette-title">${group.title}</div>
                        <div class="theme-palette-grid">
                            ${colors}
                        </div>
                    </div>
                `;
            }).join('');

            detailsPanel.innerHTML = `
                <div class="theme-details-header">
                    <div class="theme-details-icon">${theme.icon}</div>
                    <div class="theme-details-info">
                        <div class="theme-details-name">${theme.name}</div>
                        <div class="theme-details-desc">${theme.description}</div>
                    </div>
                </div>
                <div class="theme-details-body">
                    ${colorSections}
                    <div class="theme-actions">
                        <button class="theme-action-btn primary" id="clone-theme-btn">
                            Clone to Custom
                        </button>
                        <button class="theme-action-btn" id="apply-theme-btn">
                            Apply Theme
                        </button>
                        ${isSavedCustom || isImported ? `
                        <button class="theme-action-btn" id="rename-theme-btn">
                            Rename
                        </button>
                        <button class="theme-action-btn danger" id="delete-theme-btn">
                            Delete
                        </button>
                        ` : ''}
                    </div>
                </div>
            `;

            // Add clone button handler
            const cloneBtn = document.getElementById('clone-theme-btn');
            if (cloneBtn) {
                cloneBtn.addEventListener('click', () => {
                    // Copy theme colors to custom
                    Object.keys(theme.vars).forEach(key => {
                        if (this.customColors.hasOwnProperty(key) || CUSTOMIZABLE_VARS.some(g => g.vars.some(v => v.key === key))) {
                            this.customColors[key] = theme.vars[key];
                        }
                    });

                    // Update UI inputs
                    CUSTOMIZABLE_VARS.forEach(group => {
                        group.vars.forEach(v => {
                            const input = document.getElementById(`custom-${v.key}`);
                            if (input && this.customColors[v.key]) {
                                input.value = this.customColors[v.key];
                                input.nextElementSibling.value = this.customColors[v.key];
                            }
                        });
                    });

                    // Switch to custom theme
                    document.querySelector('.theme-card[data-theme="custom"]').click();
                    
                    // Show notification
                    this.showNotification(`✨ ${theme.name} cloned to Custom theme!`);
                });
            }

            // Apply button handler
            const applyBtn = document.getElementById('apply-theme-btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    this.applyTheme(themeId, true);
                    this.showNotification(`✓ ${theme.name} applied!`);
                });
            }
            
            // Rename button handler (for saved custom themes)
            const renameBtn = document.getElementById('rename-theme-btn');
            if (renameBtn) {
                renameBtn.addEventListener('click', () => {
                    const newName = prompt('Enter new name for this theme:', theme.name);
                    if (newName && newName.trim()) {
                        this.savedCustomThemes[themeId].name = newName.trim();
                        this.saveTheme(themeId);
                        this.updateThemeDetails(themeId);
                        
                        // Update the card title
                        const card = document.querySelector(`.theme-card[data-theme="${themeId}"]`);
                        if (card) {
                            const titleEl = card.querySelector('.theme-card-title');
                            if (titleEl) {
                                titleEl.innerHTML = `<span class="theme-card-icon">🎨</span>${newName.trim()}`;
                            }
                        }
                        
                        this.showNotification(`Theme renamed to "${newName.trim()}"!`);
                    }
                });
            }
            
            // Delete button handler (for saved custom themes and imported themes)
            const deleteBtn = document.getElementById('delete-theme-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async () => {
                    if (confirm(`Are you sure you want to delete "${theme.name}"?`)) {
                        // Handle imported themes
                        if (isImported) {
                            delete this.importedThemes[themeId];
                            await this.saveTheme('native');
                        } else if (isSavedCustom) {
                            delete this.savedCustomThemes[themeId];
                            await this.saveTheme('native');
                        }
                        
                        // If this was the active theme, switch to native
                        if (this.currentTheme === themeId) {
                            this.applyTheme('native', true);
                        }
                        
                        // Refresh UI
                        this.refreshUI();
                        
                        this.showNotification(`Theme "${theme.name}" deleted!`);
                    }
                });
            }
        },

        showNotification(message) {
            // Simple notification
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--accent-primary);
                color: white;
                padding: 16px 24px;
                border-radius: 8px;
                font-weight: 600;
                z-index: 10002;
                animation: slideIn 0.3s ease;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            `;
            notification.textContent = message;
            document.body.appendChild(notification);

            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, 2000);
        },

        bindColorPicker(elementId, varName) {
            const input = document.getElementById(elementId);
            if (!input) return;

            const wrapper = input.closest('.color-input-wrapper');
            const textInput = wrapper?.querySelector('.color-text');
            const swatchPreview = wrapper?.querySelector('.color-swatch-preview');

            input.addEventListener('input', (e) => {
                const color = e.target.value;
                
                // Update text display
                if (textInput) textInput.value = color;
                
                // Update swatch preview
                if (swatchPreview) swatchPreview.style.background = color;

                // Update state
                this.customColors[varName] = color;

                // If custom theme is active, apply immediately
                if (this.currentTheme === 'custom') {
                    this.applyTheme('custom', false); // Don't save on every drag
                }
            });

            input.addEventListener('change', () => {
                // Save on release
                if (this.currentTheme === 'custom') {
                    this.saveTheme('custom');
                }
            });
        },

        adjustColor(hex, percent) {
            try {
                let r = parseInt(hex.slice(1, 3), 16);
                let g = parseInt(hex.slice(3, 5), 16);
                let b = parseInt(hex.slice(5, 7), 16);

                r = Math.min(255, Math.floor(r * (100 + percent) / 100));
                g = Math.min(255, Math.floor(g * (100 + percent) / 100));
                b = Math.min(255, Math.floor(b * (100 + percent) / 100));

                return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            } catch (e) {
                return hex;
            }
        },

        showSaveAsDialog() {
            const themeName = prompt('Enter a name for this theme:', 'My Custom Theme');
            if (!themeName || !themeName.trim()) return;
            
            const themeId = 'custom-' + Date.now();
            
            // Save the current custom colors as a named theme
            this.savedCustomThemes[themeId] = {
                name: themeName.trim(),
                colors: { ...this.customColors },
                created: new Date().toISOString()
            };
            
            // Save to storage
            this.saveTheme(themeId);
            
            // Export as JSON file
            const themeData = {
                name: themeName.trim(),
                created: new Date().toISOString(),
                colors: { ...this.customColors }
            };
            
            const fileName = themeName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(themeData, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `theme-${fileName}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            
            // Show success notification with file location
            this.showNotification(`✓ Theme "${themeName.trim()}" saved!\nJSON file downloaded to your Downloads folder`);
            
            // Refresh UI to show new theme
            this.refreshUI();
            
            // Apply the newly saved theme
            this.applyTheme(themeId, true);
            
            // Update the right panel
            const controls = document.getElementById('custom-theme-controls');
            const details = document.getElementById('theme-details-panel');
            controls.classList.remove('visible');
            details.classList.add('visible');
            this.updateThemeDetails(themeId);
        },

        exportTheme() {
            const themeName = prompt('Enter a name for this theme:', 'My Custom Theme');
            if (!themeName) return;
            
            const themeData = {
                name: themeName,
                created: new Date().toISOString(),
                colors: this.customColors
            };

            const fileName = themeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(themeData, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `theme-${fileName}.json`);
            document.body.appendChild(downloadAnchorNode); // required for firefox
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        },

        importTheme(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    if (imported && imported.colors) {
                        const themeName = imported.name || 'Imported Theme';
                        const timestamp = Date.now();
                        const themeId = 'imported-' + timestamp;
                        
                        // Add to imported themes (stored in api.storage)
                        this.importedThemes[themeId] = {
                            name: themeName,
                            colors: imported.colors,
                            created: imported.created || new Date().toISOString()
                        };
                        
                        // Save to storage
                        await this.saveTheme(themeId);
                        
                        this.showNotification(`✓ Theme "${themeName}" imported and saved!`);
                        
                        // Refresh UI to show new theme
                        this.refreshUI();
                        
                        // Apply the imported theme
                        this.applyTheme(themeId, true);
                        
                        // Update the right panel
                        const controls = document.getElementById('custom-theme-controls');
                        const details = document.getElementById('theme-details-panel');
                        controls.classList.remove('visible');
                        details.classList.add('visible');
                        this.updateThemeDetails(themeId);

                        // Clear input
                        event.target.value = '';
                    } else {
                        alert('Invalid theme file format.');
                    }
                } catch (err) {
                    console.error('Error importing theme:', err);
                    alert('Failed to import theme. Check console for details.');
                }
            };
            reader.readAsText(file);
        },

        createPlayerBarButton() {
            if (document.getElementById('theme-picker-btn')) return;

            const button = document.createElement('button');
            button.id = 'theme-picker-btn';
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
            if (this.isOpen) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
                // Close mock preview too
                document.getElementById('mock-audion-preview')?.classList.remove('active');
            }
        },

        closePanel() {
            this.isOpen = false;
            document.getElementById('theme-picker-panel')?.classList.remove('open');
            document.getElementById('theme-picker-backdrop')?.classList.remove('open');
            document.getElementById('mock-audion-preview')?.classList.remove('active');
            document.body.style.overflow = '';
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

            const existingCustom = document.getElementById('theme-custom-styles');
            if (existingCustom) existingCustom.remove();
        },

        applyTheme(themeId, save = true) {
            let theme = THEMES[themeId];
            
            // Check if it's a saved custom theme
            if (!theme && themeId.startsWith('custom-')) {
                const savedTheme = this.savedCustomThemes[themeId];
                if (savedTheme) {
                    theme = {
                        name: savedTheme.name,
                        icon: '🎨',
                        description: 'Custom Theme',
                        vars: savedTheme.colors
                    };
                }
            }
            
            // Check if it's an imported theme
            if (!theme && themeId.startsWith('imported-')) {
                const importedTheme = this.importedThemes[themeId];
                if (importedTheme) {
                    theme = {
                        name: importedTheme.name,
                        icon: '🌈',
                        description: 'Imported Theme',
                        vars: importedTheme.colors
                    };
                }
            }
            
            if (!theme) return;

            console.log(`[ThemeCustomizer] Applying theme: ${theme.name}`);

            this.clearThemeOverrides();

            if (themeId !== 'native') {
                const root = document.documentElement;
                let varsToApply = theme.vars;

                if (themeId === 'custom') {
                    // Start with custom colors
                    varsToApply = { ...this.customColors };

                    // Basic derivatives if not explicitly set (though our schema covers most)
                    if (!varsToApply['--accent-hover']) {
                        varsToApply['--accent-hover'] = this.adjustColor(varsToApply['--accent-primary'], 10);
                    }
                    if (!varsToApply['--accent-subtle']) {
                        varsToApply['--accent-subtle'] = `${varsToApply['--accent-primary']}26`;
                    }
                } else if (themeId.startsWith('custom-') || themeId.startsWith('imported-')) {
                    // For saved custom themes and imported themes, apply their colors
                    varsToApply = { ...theme.vars };
                    
                    // Basic derivatives
                    if (!varsToApply['--accent-hover']) {
                        varsToApply['--accent-hover'] = this.adjustColor(varsToApply['--accent-primary'], 10);
                    }
                    if (!varsToApply['--accent-subtle']) {
                        varsToApply['--accent-subtle'] = `${varsToApply['--accent-primary']}26`;
                    }
                }

                Object.entries(varsToApply).forEach(([key, value]) => {
                    root.style.setProperty(key, value);
                });

                if (theme.customStyles) {
                    const customStyle = document.createElement('style');
                    customStyle.id = 'theme-custom-styles';
                    customStyle.textContent = theme.customStyles;
                    document.head.appendChild(customStyle);
                }
            } else {
                if (this.api && this.api.theme && this.api.theme.refresh) {
                    console.log('[ThemeCustomizer] Triggering app theme refresh...');
                    this.api.theme.refresh();
                }
            }

            this.currentTheme = themeId;
            this.updateActiveCard(themeId);

            if (save) {
                this.saveTheme(themeId);
            }
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
            document.getElementById('mock-audion-preview')?.remove();
            document.getElementById('theme-picker-btn')?.remove();
            document.getElementById('theme-customizer-styles')?.remove();
            document.getElementById('theme-custom-styles')?.remove();

            this.clearThemeOverrides();
            document.body.style.overflow = '';

            console.log('[ThemeCustomizer] Plugin destroyed');
        }
    };

    // Register plugin
    if (typeof Audion !== 'undefined' && Audion.register) {
        Audion.register(ThemeCustomizer);
    } else {
        window.ThemeCustomizer = ThemeCustomizer;
        window.AudionPlugin = ThemeCustomizer;
    }
})();
