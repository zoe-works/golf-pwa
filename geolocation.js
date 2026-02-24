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

        // Watch position gives continuous updates when device moves
        this.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                this.onUpdate({
                    lng: pos.coords.longitude,
                    lat: pos.coords.latitude,
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
