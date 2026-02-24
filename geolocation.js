export class GeolocationTracker {
    constructor(onUpdate, onError) {
        this.watchId = null;
        this.onUpdate = onUpdate;
        this.onError = onError;
    }

    start() {
        if (!("geolocation" in navigator)) {
            this.onError(new Error("Geolocation not supported by this browser."));
            return;
        }

        const options = {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 15000
        };

        // Low-Pass Filter (EMA) parameters
        let smoothedLng = null;
        let smoothedLat = null;
        const alpha = 0.3; // Smoothing factor (0 to 1). Lower = more smooth/delay, Higher = more responsive/jitter.

        // Watch position gives continuous updates when device moves
        this.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const rawLng = pos.coords.longitude;
                const rawLat = pos.coords.latitude;

                // Apply EMA smoothing
                if (smoothedLng === null || smoothedLat === null) {
                    // First fix: initialize with raw values
                    smoothedLng = rawLng;
                    smoothedLat = rawLat;
                } else {
                    // Subsequent fixes: apply smoothing formula
                    smoothedLng = alpha * rawLng + (1 - alpha) * smoothedLng;
                    smoothedLat = alpha * rawLat + (1 - alpha) * smoothedLat;
                }

                this.onUpdate({
                    lng: smoothedLng,
                    lat: smoothedLat,
                    rawLng: rawLng,
                    rawLat: rawLat,
                    accuracy: pos.coords.accuracy, // meters
                });
            },
            (err) => {
                this.onError(err);
            },
            options
        );
    }

    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }
}
