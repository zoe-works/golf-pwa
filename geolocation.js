import { haversineMeters } from './distance.js';

export class GeolocationTracker {
    constructor(onUpdate, onError) {
        this.watchId = null;
        this.onUpdate = onUpdate;
        this.onError = onError;

        // Tracking state for speed filter
        this.lastValidRec = null;
    }

    start() {
        if (!("geolocation" in navigator)) {
            this.onError(new Error("Geolocation not supported by this browser."));
            return;
        }

        const options = {
            enableHighAccuracy: true,
            maximumAge: 0, // A: Force fresh calculations, disable cache
            timeout: 15000
        };

        // Low-Pass Filter (EMA) parameters
        let smoothedLng = null;
        let smoothedLat = null;
        const alpha = 0.5; // D: Increased from 0.3 to 0.5 for slightly faster response

        this.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const rawLng = pos.coords.longitude;
                const rawLat = pos.coords.latitude;
                const accuracy = pos.coords.accuracy;
                const timestamp = pos.timestamp;

                // C: Accuracy Threshold (Ignore fixes worse than 30m for internal data, but notify UI)
                if (accuracy > 30) {
                    console.log(`[GPS] Ignored: Poor accuracy (${accuracy}m)`);
                    this.onUpdate({
                        status: 'low_accuracy',
                        accuracy: accuracy,
                        lng: rawLng,
                        lat: rawLat
                    });
                    return;
                }

                // B: Unrealistic Jump Filter (Speed check)
                if (this.lastValidRec) {
                    const timeDiffSec = (timestamp - this.lastValidRec.timestamp) / 1000;
                    if (timeDiffSec > 0) {
                        const distMeters = haversineMeters(
                            [this.lastValidRec.rawLng, this.lastValidRec.rawLat],
                            [rawLng, rawLat]
                        );

                        const speedMps = distMeters / timeDiffSec;
                        if (speedMps > 15) {
                            console.log(`[GPS] Ignored: Unrealistic speed jump (${Math.round(speedMps)}m/s)`);
                            this.onUpdate({
                                status: 'unstable',
                                accuracy: accuracy,
                                lng: rawLng,
                                lat: rawLat
                            });
                            return;
                        }
                    }
                }

                this.lastValidRec = { rawLng, rawLat, timestamp };

                // Apply EMA smoothing
                if (smoothedLng === null || smoothedLat === null) {
                    // First valid fix: initialize with raw values
                    smoothedLng = rawLng;
                    smoothedLat = rawLat;
                } else {
                    // Subsequent fixes: apply smoothing formula
                    smoothedLng = alpha * rawLng + (1 - alpha) * smoothedLng;
                    smoothedLat = alpha * rawLat + (1 - alpha) * smoothedLat;
                }

                this.onUpdate({
                    status: 'ok',
                    lng: smoothedLng,
                    lat: smoothedLat,
                    rawLng: rawLng,
                    rawLat: rawLat,
                    accuracy: accuracy, // meters
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
            this.lastValidRec = null; // Reset state
        }
    }
}
