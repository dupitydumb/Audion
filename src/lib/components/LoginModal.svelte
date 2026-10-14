<script lang="ts">
    import { _ } from "svelte-i18n";
    import { showLoginModal, startLogin, connectCustomServerPassword, testCustomServerConnection, loginModalMode } from "$lib/stores/sync";
    import { fade, scale, slide } from "svelte/transition";
    import Icon from "$lib/components/Icon.svelte";

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
            aria-label={$_('auth.signInTitle', { default: 'Account & Sync' })}
        >
            <div class="modal-top-bar">
                <div class="modal-header-content">
                    <h2>{$_('auth.signInTitle', { default: 'Account & Sync' })}</h2>
                    <p class="subtitle">{$_('auth.signInSubtitle', { default: 'Choose your sync method: official Audion Cloud or self-hosted.' })}</p>
                </div>
                <button class="close-btn" on:click={close} aria-label="Close" title="Close (Esc)">
                    <Icon name="x" size={18} />
                </button>
            </div>

            <!-- Segmented Method Tabs -->
            <div class="segmented-tabs" role="tablist" aria-label="Sync Method">
                <button
                    type="button"
                    role="tab"
                    id="tab-oauth"
                    aria-selected={$loginModalMode === "oauth"}
                    aria-controls="panel-oauth"
                    class="tab-btn {$loginModalMode === 'oauth' ? 'active' : ''}"
                    on:click={() => { loginModalMode.set("oauth"); clearMessages(); }}
                >
                    <Icon name="cloud" size={15} />
                    <span class="tab-label">{$_('auth.tabCloud', { default: 'Audion Cloud' })}</span>
                    <span class="tab-badge">{$_('auth.cloudSyncBadge', { default: '7-Day Trial' })}</span>
                </button>

                <button
                    type="button"
                    role="tab"
                    id="tab-custom"
                    aria-selected={$loginModalMode === "custom_server"}
                    aria-controls="panel-custom"
                    class="tab-btn {$loginModalMode === 'custom_server' ? 'active' : ''}"
                    on:click={() => { loginModalMode.set("custom_server"); clearMessages(); }}
                >
                    <Icon name="server" size={15} />
                    <span class="tab-label">{$_('auth.tabCustom', { default: 'Self-Hosted Server' })}</span>
                </button>
            </div>

            <div class="modal-body">
                {#if $loginModalMode === "oauth"}
                    <!-- Audion Cloud Tab Content -->
                    <div id="panel-oauth" role="tabpanel" aria-labelledby="tab-oauth" class="tab-panel">
                        <!-- High Visibility 7-Day Free Trial Spotlight Card -->
                        <div class="trial-spotlight-card">
                            <div class="trial-card-header">
                                <span class="trial-pill-tag">
                                    <Icon name="zap" size={12} />
                                    {$_('auth.trialCardTitle', { default: '7-Day Free Trial for Eligible Accounts' })}
                                </span>
                            </div>
                            <h3 class="trial-headline">{$_('auth.trialCardHeadline', { default: 'Full sync access for 7 days' })}</h3>
                            <p class="trial-desc">
                                {$_('auth.trialCardDesc', { default: 'Sign in with Google or GitHub to activate full cloud sync across all your devices. No credit card required.' })}
                            </p>
                            <ul class="trial-checklist">
                                <li>
                                    <span class="check-icon"><Icon name="check" size={12} /></span>
                                    <span>{$_('auth.trialBenefit1', { default: 'Sync playlists and liked tracks across devices' })}</span>
                                </li>
                                <li>
                                    <span class="check-icon"><Icon name="check" size={12} /></span>
                                    <span>{$_('auth.trialBenefit2', { default: 'Cloud backup for preferences and listening history' })}</span>
                                </li>
                                <li>
                                    <span class="check-icon"><Icon name="check" size={12} /></span>
                                    <span>{$_('auth.trialBenefit3', { default: 'No payment needed to get started' })}</span>
                                </li>
                            </ul>
                        </div>

                        <!-- Provider Buttons -->
                        <div class="provider-buttons-group">
                            <span class="provider-group-label">{$_('auth.signInWithProvider', { default: 'Sign in with your account' })}</span>

                            <!-- Google Login Button -->
                            <button
                                class="provider-btn google"
                                on:click={() => loginWith("google")}
                                disabled={isLoading}
                                aria-label="Sign in with Google"
                            >
                                <div class="provider-icon">
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
                                </div>
                                <div class="provider-text">
                                    <span class="provider-title">{$_('auth.continueWithGoogle')}</span>
                                    <span class="provider-sub">{$_('auth.audionCloudCaption', { default: 'Official Audion Cloud' })}</span>
                                </div>
                            </button>

                            <!-- GitHub Login Button -->
                            <button
                                class="provider-btn github"
                                on:click={() => loginWith("github")}
                                disabled={isLoading}
                                aria-label="Sign in with GitHub"
                            >
                                <div class="provider-icon">
                                    <svg viewBox="0 0 24 24" width="20" height="20">
                                        <path
                                            fill="currentColor"
                                            d="M12 1C5.37 1 0 6.37 0 13c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 13c0-6.63-5.37-12-12-12z"
                                        />
                                    </svg>
                                </div>
                                <div class="provider-text">
                                    <span class="provider-title">{$_('auth.continueWithGithub')}</span>
                                    <span class="provider-sub">{$_('auth.audionCloudCaption', { default: 'Official Audion Cloud' })}</span>
                                </div>
                            </button>
                        </div>

                        <!-- Privacy assurance -->
                        <div class="privacy-guarantee">
                            <Icon name="shield" size={14} className="privacy-icon" />
                            <p class="privacy-note">{$_('auth.privacyNote')}</p>
                        </div>
                    </div>
                {:else}
                    <!-- Self-Hosted Server Tab Content -->
                    <div id="panel-custom" role="tabpanel" aria-labelledby="tab-custom" class="tab-panel">
                        <div class="self-hosted-intro">
                            <h3 class="self-hosted-title">{$_('auth.customServerTitle')}</h3>
                            <p class="self-hosted-desc">{$_('auth.customServerSubtitle')}</p>
                        </div>

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
                                    <Icon name="info" size={15} className="docker-info-icon" />
                                    <span>{$_('auth.selfHostingGuide')}</span>
                                </div>
                                <p class="docker-info-text">
                                    {$_('auth.selfHostingGuideDesc')}
                                </p>
                                <a href="https://github.com/dupitydumb/audion-server-docker" target="_blank" rel="noreferrer" class="docker-info-link">
                                    github.com/dupitydumb/audion-server-docker
                                    <Icon name="external-link" size={12} />
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
                            </div>
                        </form>
                    </div>
                {/if}
            </div>

            <div class="modal-footer">
                <button class="btn-text cancel-btn" on:click={close}>{$_('common.cancel')}</button>
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
        background: rgba(0, 0, 0, 0.65);
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
        max-width: 460px;
        box-shadow: var(--shadow-lg);
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .modal-top-bar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md);
        gap: var(--spacing-md);
    }

    .modal-header-content h2 {
        font-size: 1.25rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0 0 4px 0;
    }

    .subtitle {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        line-height: var(--line-height-normal);
        margin: 0;
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--text-subdued);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color var(--transition-fast), background var(--transition-fast);
        flex-shrink: 0;
    }

    .close-btn:hover {
        color: var(--text-primary);
        background: var(--bg-highlight);
    }

    .close-btn:focus-visible {
        outline: 2px solid var(--accent-primary);
    }

    /* Segmented Navigation Tabs */
    .segmented-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        padding: 4px;
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        margin: 0 var(--spacing-lg) var(--spacing-md);
    }

    .tab-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .tab-btn:hover:not(.active) {
        color: var(--text-primary);
        background: rgba(255, 255, 255, 0.04);
    }

    .tab-btn.active {
        background: var(--bg-elevated);
        color: var(--text-primary);
        font-weight: var(--font-weight-semibold);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    .tab-btn:focus-visible {
        outline: 2px solid var(--accent-primary);
    }

    .tab-badge {
        font-size: 0.625rem;
        font-weight: var(--font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
        color: var(--accent-primary);
        padding: 2px 6px;
        border-radius: var(--radius-full);
    }

    .modal-body {
        padding: 0 var(--spacing-lg);
        display: flex;
        flex-direction: column;
        max-height: 70vh;
        overflow-y: auto;
    }

    .tab-panel {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
    }

    /* 7-Day Free Trial Spotlight Card */
    .trial-spotlight-card {
        background: color-mix(in srgb, var(--accent-primary) 6%, var(--bg-surface));
        border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, var(--border-color));
        border-radius: var(--radius-md);
        padding: 14px 16px;
    }

    .trial-card-header {
        display: flex;
        align-items: center;
        margin-bottom: 6px;
    }

    .trial-pill-tag {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.6875rem;
        font-weight: var(--font-weight-bold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--accent-primary);
        background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
        padding: 3px 8px;
        border-radius: var(--radius-full);
    }

    .trial-headline {
        font-size: 0.9375rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0 0 4px 0;
    }

    .trial-desc {
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        line-height: 1.45;
        margin: 0 0 10px 0;
    }

    .trial-checklist {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .trial-checklist li {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--font-size-xs);
        color: var(--text-primary);
    }

    .check-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: var(--radius-full);
        background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
        color: var(--accent-primary);
        flex-shrink: 0;
    }

    /* Provider login buttons */
    .provider-buttons-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
    }

    .provider-group-label {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--text-subdued);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 2px;
    }

    .provider-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: 10px 14px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        color: var(--text-primary);
        cursor: pointer;
        width: 100%;
        text-align: left;
        transition: background var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast);
    }

    .provider-btn:hover:not(:disabled) {
        background: var(--bg-highlight);
        border-color: var(--text-subdued);
        transform: translateY(-1px);
    }

    .provider-btn:focus-visible {
        outline: 2px solid var(--accent-primary);
    }

    .provider-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .provider-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        flex-shrink: 0;
    }

    .provider-text {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .provider-title {
        font-size: 0.875rem;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
    }

    .provider-sub {
        font-size: 0.6875rem;
        color: var(--text-subdued);
    }

    /* Privacy Guarantee */
    .privacy-guarantee {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 12px;
        border-radius: var(--radius-md);
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid color-mix(in srgb, var(--border-color), transparent 50%);
        margin-top: 2px;
    }

    :global(.privacy-icon) {
        color: var(--text-subdued);
        flex-shrink: 0;
        margin-top: 2px;
    }

    .privacy-note {
        font-size: var(--font-size-xs);
        color: var(--text-subdued);
        line-height: 1.4;
        margin: 0;
    }

    /* Self-Hosted Server View */
    .self-hosted-intro {
        margin-bottom: 2px;
    }

    .self-hosted-title {
        font-size: 0.9375rem;
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0 0 2px 0;
    }

    .self-hosted-desc {
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        margin: 0;
    }

    .custom-server-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .form-group label {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
    }

    .form-group input {
        padding: 9px 12px;
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-size: 0.875rem;
        outline: none;
        transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .form-group input:focus {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary), transparent 85%);
    }

    .error-text {
        font-size: var(--font-size-xs);
        color: var(--error-color, #ff5c5c);
        line-height: 1.4;
    }

    .success-text {
        font-size: var(--font-size-xs);
        color: #4ade80;
        line-height: 1.4;
    }

    .docker-info-box {
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px dashed var(--border-color);
        border-radius: var(--radius-md);
        font-size: var(--font-size-xs);
    }

    .docker-info-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin-bottom: 4px;
    }

    :global(.docker-info-icon) {
        color: var(--accent-primary);
    }

    .docker-info-text {
        color: var(--text-secondary);
        margin: 0 0 4px 0;
        line-height: 1.35;
    }

    .docker-info-link {
        color: var(--accent-primary);
        text-decoration: underline;
        font-weight: var(--font-weight-medium);
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .docker-info-link:hover {
        opacity: 0.85;
    }

    .form-actions {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin-top: 4px;
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
        padding: 10px;
        border-radius: var(--radius-md);
        font-size: 0.875rem;
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

    .btn-secondary:focus-visible {
        outline: 2px solid var(--accent-primary);
    }

    .btn-secondary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .btn-primary {
        background: var(--accent-primary);
        color: #000;
        border: none;
        padding: 10px;
        border-radius: var(--radius-md);
        font-size: 0.875rem;
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

    .btn-primary:focus-visible {
        outline: 2px solid #fff;
    }

    .btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .modal-footer {
        padding: var(--spacing-sm) var(--spacing-lg) var(--spacing-md);
        display: flex;
        justify-content: flex-end;
    }

    .cancel-btn {
        background: none;
        border: none;
        color: var(--text-subdued);
        font-size: var(--font-size-sm);
        cursor: pointer;
        padding: 6px 12px;
        border-radius: var(--radius-sm);
        transition: color var(--transition-fast);
    }

    .cancel-btn:hover {
        color: var(--text-primary);
    }

    .cancel-btn:focus-visible {
        outline: 2px solid var(--accent-primary);
    }
</style>

