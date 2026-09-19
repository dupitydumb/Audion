// forwards webview console calls into the same tracing pipeline as the backend 
// (see commands/logs.rs::log_from_frontend),
// so a single exported log file covers both sides
// see the "Export logs" button in Settings > About

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '$lib/api/tauri';

let initialized = false;

// keep references to the real console methods before patching,
// so our own forwarding calls (and anything invoke() itself logs on failure)
// never re-enter the patched methods and loop
const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
};

function formatArgs(args: unknown[]): string {
    return args
        .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        })
        .join(' ');
}

function forward(level: 'info' | 'warn' | 'error' | 'debug', args: unknown[]) {
    // fire and forget: never let logging itself block or throw into the caller
    invoke('log_from_frontend', { level, message: formatArgs(args) }).catch(() => {});
}

/**
 * patch console.log/info/warn/error/debug to also forward into the backend log file
 * safe to call multiple times, only patches once
 */
export function initConsoleCapture() {
    if (initialized || !isTauri()) return;
    initialized = true;

    console.log = (...args: unknown[]) => {
        original.log(...args);
        forward('info', args);
    };
    console.info = (...args: unknown[]) => {
        original.info(...args);
        forward('info', args);
    };
    console.warn = (...args: unknown[]) => {
        original.warn(...args);
        forward('warn', args);
    };
    console.error = (...args: unknown[]) => {
        original.error(...args);
        forward('error', args);
    };
    console.debug = (...args: unknown[]) => {
        original.debug(...args);
        forward('debug', args);
    };

    window.addEventListener('error', (event) => {
        forward('error', [`Uncaught: ${event.message}`, event.error]);
    });
    window.addEventListener('unhandledrejection', (event) => {
        forward('error', [`Unhandled rejection:`, event.reason]);
    });
}