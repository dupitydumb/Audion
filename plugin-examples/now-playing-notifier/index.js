// Now Playing Notifier Plugin (Event-Driven Version)
// Shows system notifications when track changes

(function () {
    'use strict';

    const NowPlayingNotifier = {
        name: 'Now Playing Notifier',

        init(api) {
            console.log('[NowPlayingNotifier] Plugin initialized with event system');
            this.api = api;

            // Use event system instead of polling!
            api.on('trackChange', (data) => this.handleTrackChange(data));
            console.log('[NowPlayingNotifier] Event listener registered');
        },

        handleTrackChange(data) {
            const { track } = data;

            if (track) {
                console.log('[NowPlayingNotifier] Track changed:', track.title);
                this.showNotification(track);
            }
        },

        showNotification(track) {
            if ('Notification' in window) {
                if (Notification.permission === 'granted') {
                    new Notification('Now Playing', {
                        body: `${track.title || 'Unknown'} - ${track.artist || 'Unknown Artist'}`,
                        silent: true
                    });
                } else {
                    console.log('[NowPlayingNotifier] Notification permission:', Notification.permission);
                }
            }
        },

        start() {
            console.log('[NowPlayingNotifier] Plugin started');
            // Request notification permission
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    console.log('[NowPlayingNotifier] Permission result:', permission);
                });
            }
        },

        stop() {
            console.log('[NowPlayingNotifier] Plugin stopped');
        },

        destroy() {
            // No more intervals! Events are auto-cleaned by runtime
            console.log('[NowPlayingNotifier] Plugin destroyed');
        }
    };

    // Register plugin globally
    window.NowPlayingNotifier = NowPlayingNotifier;
    window.AudionPlugin = NowPlayingNotifier;
})();
