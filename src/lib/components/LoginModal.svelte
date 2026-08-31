<script lang="ts">
    import { _ } from "svelte-i18n";
    import { showLoginModal, startLogin, connectCustomServerPassword, testCustomServerConnection, loginModalMode } from "$lib/stores/sync";
    import { fade, scale, slide } from "svelte/transition";

    let isLoading = false;
    let isTesting = false;

    let serverUrl = "";
    let username = "";
    let password = "";
    let errorText = "";
    let successText = "";

    function close() {
        showLoginModal.set(false);
        // Reset state
        loginModalMode.set("oauth");
        serverUrl = "";
        username = "";
        password = "";
        errorText = "";
        successText = "";
        isTesting = false;
    }

    function clearMessages() {
        errorText = "";
        successText = "";
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

    async function handleTestConnection() {
        if (!serverUrl) {
            errorText = $_('auth.serverUrlRequired');
            return;
        }
        if (!username || !password) {
            errorText = $_('auth.usernamePasswordRequired');
            return;
        }

        isTesting = true;
        errorText = "";
        successText = "";
        try {
            await testCustomServerConnection(serverUrl, username, password);
            successText = $_('auth.connectionTestSuccess');
        } catch (err) {
            console.error("[Custom Server Test Connection] Failed:", err);
            errorText = String(err);
        } finally {
            isTesting = false;
        }
    }

    async function handleCustomConnect() {
        if (!serverUrl) {
            errorText = $_('auth.serverUrlRequired');
            return;
        }
        if (!username || !password) {
            errorText = $_('auth.usernamePasswordRequired');
            return;
        }

        isLoading = true;
        errorText = "";
        successText = "";
        try {
            await connectCustomServerPassword(serverUrl, username, password);
            close();
        } catch (err) {
            console.error("[Custom Server Connect] Failed:", err);
            errorText = String(err);
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
            aria-label={$loginModalMode === "oauth" ? "Sign in to Audion" : "Connect to Custom Server"}
        >
            <div class="modal-header">
                {#if $loginModalMode === "oauth"}
                    <h2>{$_('auth.signInTitle')}</h2>
                    <p class="subtitle">
                        {$_('auth.signInSubtitle')}
                    </p>
                {:else}
                    <h2>{$_('auth.customServerTitle')}</h2>
                    <p class="subtitle">
                        {$_('auth.customServerSubtitle')}
                    </p>
                {/if}
            </div>

            <div class="modal-body">
                {#if $loginModalMode === "oauth"}
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
                        <span>{$_('auth.continueWithGoogle')}</span>
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
                        <span>{$_('auth.continueWithGithub')}</span>
                    </button>

                    <button
                        class="btn-text secondary-action"
                        on:click={() => loginModalMode.set("custom_server")}
                        disabled={isLoading}
                    >
                        {$_('auth.connectCustomServerBtn')}
                    </button>
                {:else}
                    <form on:submit|preventDefault={handleCustomConnect} class="custom-server-form">
                        <div class="form-group">
                            <label for="server-url">{$_('auth.serverUrl')}</label>
                            <input
                                id="server-url"
                                type="url"
                                placeholder={$_('auth.serverUrlPlaceholder')}
                                bind:value={serverUrl}
                                on:input={clearMessages}
                                disabled={isLoading || isTesting}
                            />
                        </div>

                        <div class="form-group">
                            <label for="username">{$_('auth.username')}</label>
                            <input
                                id="username"
                                type="text"
                                placeholder={$_('auth.username')}
                                bind:value={username}
                                on:input={clearMessages}
                                disabled={isLoading || isTesting}
                            />
                        </div>

                        <div class="form-group">
                            <label for="password">{$_('auth.password')}</label>
                            <input
                                id="password"
                                type="password"
                                placeholder={$_('auth.password')}
                                bind:value={password}
                                on:input={clearMessages}
                                disabled={isLoading || isTesting}
                            />
                        </div>

                        {#if errorText}
                            <div class="error-text" transition:slide={{ duration: 150 }}>
                                {errorText}
                            </div>
                        {/if}

                        {#if successText}
                            <div class="success-text" transition:slide={{ duration: 150 }}>
                                {successText}
                            </div>
                        {/if}

                        <div class="docker-info-box">
                            <div class="docker-info-header">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="docker-info-icon" width="16" height="16">
                                    <path d="M22 12.5a8.25 8.25 0 0 1-16.5 0c0-2.5 1.5-4.5 4-5.5h2.5c2.5 1 4 3 4 5.5z" />
                                    <path d="M12 2v5" />
                                    <path d="M7.5 4.5l3.5 2.5" />
                                    <path d="M16.5 4.5L13 7" />
                                </svg>
                                <span>{$_('auth.selfHostingGuide')}</span>
                            </div>
                            <p class="docker-info-text">
                                {$_('auth.selfHostingGuideDesc')}
                            </p>
                            <a href="https://github.com/dupitydumb/audion-server-docker" target="_blank" rel="noreferrer" class="docker-info-link">
                                github.com/dupitydumb/audion-server-docker
                            </a>
                        </div>

                        <div class="form-actions">
                            <div class="form-actions-row">
                                <button
                                    type="button"
                                    class="btn-secondary"
                                    on:click={handleTestConnection}
                                    disabled={isLoading || isTesting}
                                >
                                    {isTesting ? $_('auth.testing') : $_('auth.testConnection')}
                                </button>
                                <button
                                    type="submit"
                                    class="btn-primary"
                                    disabled={isLoading || isTesting}
                                >
                                    {isLoading ? $_('auth.connecting') : $_('auth.connect')}
                                </button>
                            </div>
                            <button
                                type="button"
                                class="btn-text back-btn"
                                on:click={() => loginModalMode.set("oauth")}
                                disabled={isLoading || isTesting}
                            >
                                {$_('auth.back')}
                            </button>
                        </div>
                    </form>
                {/if}
            </div>

            <div class="modal-footer">
                {#if $loginModalMode === "oauth"}
                    <p class="privacy-note">
                        {$_('auth.privacyNote')}
                    </p>
                {/if}
                <button class="btn-text" on:click={close}>{$_('common.cancel')}</button>
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
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin-bottom: var(--spacing-sm);
    }

    .subtitle {
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        line-height: var(--line-height-normal);
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
        font-weight: var(--font-weight-medium);
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

    .custom-server-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .form-group label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
    }

    .form-group input {
        padding: 10px 14px;
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 0.9375rem;
        outline: none;
        transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .form-group input:focus {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary), transparent 85%);
    }

    .error-text {
        font-size: var(--font-size-sm);
        color: var(--error-color, #ff5c5c);
        margin-top: var(--spacing-xs);
        line-height: 1.4;
    }

    .success-text {
        font-size: var(--font-size-sm);
        color: #4ade80;
        margin-top: var(--spacing-xs);
        line-height: 1.4;
    }

    .form-actions {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-md);
    }

    .form-actions-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--spacing-sm);
        width: 100%;
    }

    .btn-secondary {
        background: rgba(255, 255, 255, 0.05);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
        padding: 12px;
        border-radius: var(--radius-md);
        font-size: 0.9375rem;
        font-weight: var(--font-weight-semibold);
        cursor: pointer;
        transition: background var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast);
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .btn-secondary:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
        border-color: var(--text-secondary);
        transform: translateY(-1px);
    }

    .btn-secondary:active:not(:disabled) {
        transform: translateY(0);
    }

    .btn-secondary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .back-btn {
        margin-top: var(--spacing-xs);
        align-self: center;
    }

    .btn-primary {
        background: var(--accent-primary);
        color: #000;
        border: none;
        padding: 12px;
        border-radius: var(--radius-md);
        font-size: 0.9375rem;
        font-weight: var(--font-weight-bold);
        cursor: pointer;
        transition: opacity var(--transition-fast), transform var(--transition-fast);
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .btn-primary:hover:not(:disabled) {
        opacity: 0.95;
        transform: translateY(-1px);
    }

    .btn-primary:active:not(:disabled) {
        transform: translateY(0);
    }

    .btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .secondary-action {
        margin-top: var(--spacing-sm);
        text-decoration: underline;
        font-size: var(--font-size-sm);
        align-self: center;
    }

    .modal-footer {
        padding: var(--spacing-md) var(--spacing-lg) var(--spacing-lg);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
    }

    .privacy-note {
        font-size: var(--font-size-xs);
        color: var(--text-subdued);
        text-align: center;
        line-height: var(--line-height-normal);
    }

    .btn-text {
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        cursor: pointer;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast);
    }

    .btn-text:hover {
        color: var(--text-primary);
    }

    .docker-info-box {
        margin-top: var(--spacing-sm);
        padding: var(--spacing-md);
        background: rgba(255, 255, 255, 0.02);
        border: 1px dashed var(--border-color);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
    }

    .docker-info-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin-bottom: 6px;
    }

    .docker-info-icon {
        color: var(--accent-primary);
    }

    .docker-info-text {
        color: var(--text-secondary);
        margin: 0 0 6px 0;
        line-height: 1.4;
    }

    .docker-info-link {
        color: var(--accent-primary);
        text-decoration: underline;
        font-weight: var(--font-weight-medium);
        display: inline-flex;
        align-items: center;
    }

    .docker-info-link:hover {
        opacity: 0.85;
    }
</style>
