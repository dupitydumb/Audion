<script lang="ts">
    import { showLoginModal, startLogin } from "$lib/stores/sync";
    import { fade, scale } from "svelte/transition";

    let isLoading = false;

    function close() {
        showLoginModal.set(false);
    }

    async function loginWith(provider: "google" | "github") {
        isLoading = true;
        try {
            await startLogin(provider);
        } catch (err) {
            console.error("[Login] Failed:", err);
        } finally {
            isLoading = false;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") close();
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $showLoginModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="overlay" transition:fade={{ duration: 150 }} on:click={close}>
        <div
            class="modal"
            transition:scale={{ duration: 200, start: 0.95 }}
            on:click|stopPropagation
            role="dialog"
            aria-modal="true"
            aria-label="Sign in to Audion"
        >
            <div class="modal-header">
                <h2>Sign in to Audion</h2>
                <p class="subtitle">
                    Sync your playlists, liked songs, and settings across all
                    your devices.
                </p>
            </div>

            <div class="modal-body">
                <button
                    class="login-btn google"
                    on:click={() => loginWith("google")}
                    disabled={isLoading}
                >
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        />
                        <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                    </svg>
                    <span>Continue with Google</span>
                </button>

                <button
                    class="login-btn github"
                    on:click={() => loginWith("github")}
                    disabled={isLoading}
                >
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path
                            fill="currentColor"
                            d="M12 1C5.37 1 0 6.37 0 13c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 13c0-6.63-5.37-12-12-12z"
                        />
                    </svg>
                    <span>Continue with GitHub</span>
                </button>
            </div>

            <div class="modal-footer">
                <p class="privacy-note">
                    By signing in, you agree to sync your music data with
                    Audion's servers. We only store your playlists, liked songs,
                    and app settings — never your music files.
                </p>
                <button class="btn-text" on:click={close}>Cancel</button>
            </div>
        </div>
    </div>
{/if}

<style>
    .overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(4px);
    }

    .modal {
        background: var(--bg-elevated);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 420px;
        box-shadow: var(--shadow-lg);
        overflow: hidden;
    }

    .modal-header {
        padding: var(--spacing-lg);
        text-align: center;
    }

    .modal-header h2 {
        font-size: 1.375rem;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: var(--spacing-sm);
    }

    .subtitle {
        color: var(--text-secondary);
        font-size: 0.875rem;
        line-height: 1.5;
    }

    .modal-body {
        padding: 0 var(--spacing-lg) var(--spacing-lg);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .login-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        padding: 12px 16px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-size: 0.9375rem;
        font-weight: 500;
        cursor: pointer;
        transition:
            background var(--transition-fast),
            border-color var(--transition-fast);
        width: 100%;
    }

    .login-btn:hover:not(:disabled) {
        background: var(--bg-highlight);
        border-color: var(--text-subdued);
    }

    .login-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .login-btn svg {
        flex-shrink: 0;
    }

    .modal-footer {
        padding: var(--spacing-md) var(--spacing-lg) var(--spacing-lg);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .privacy-note {
        font-size: 0.75rem;
        color: var(--text-subdued);
        text-align: center;
        line-height: 1.5;
    }

    .btn-text {
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: 0.875rem;
        cursor: pointer;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast);
    }

    .btn-text:hover {
        color: var(--text-primary);
    }
</style>
