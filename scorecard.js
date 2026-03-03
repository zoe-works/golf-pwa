export class ScorecardManager {
    constructor() {
        this.roundData = this.loadRoundData() || this.createNewRound();
        this.currentHole = 1;
        this.currentShotNum = 1;

        // Ensure UI elements exist before binding
        this.bindEvents();
    }

    createNewRound() {
        return {
            round_id: 'Round_' + new Date().toISOString(),
            date: new Date().toISOString(),
            holes: {},
            summary: {
                total_score: 0,
                total_putts: 0,
                total_penalties: 0
            }
        };
    }

    loadRoundData() {
        const data = localStorage.getItem('golf_pwa_round_data');
        return data ? JSON.parse(data) : null;
    }

    saveRoundData() {
        localStorage.setItem('golf_pwa_round_data', JSON.stringify(this.roundData));
        this.updateSummary();
    }

    // --- State Management --- 

    setHole(holeNum, par) {
        this.currentHole = holeNum;
        if (!this.roundData.holes[holeNum]) {
            this.roundData.holes[holeNum] = {
                par: par,
                shots: [],
                putts: 0,
                penalties: 0,
                hole_score: 0,
                hole_memo: ""
            };
        }
        this.currentShotNum = this.roundData.holes[holeNum].shots.length + 1;
        this.saveRoundData();
    }

    getHoleData(holeNum = this.currentHole) {
        return this.roundData.holes[holeNum];
    }

    // --- Actions ---

    recordShot(club, coords) {
        const hole = this.roundData.holes[this.currentHole];
        const newShot = {
            shot_num: this.currentShotNum,
            club: club,
            start_coords: coords,
            end_coords: null,
            distance_yd: 0
        };

        // If not the first shot, calculate distance of previous shot
        if (this.currentShotNum > 1) {
            const prevShot = hole.shots[this.currentShotNum - 2];
            prevShot.end_coords = coords;
            // distance_yd will be calculated externally by app.js (haversine) and updated later, 
            // but we can just store the coords here.
        }

        hole.shots.push(newShot);
        this.currentShotNum++;
        this.saveRoundData();
        return newShot;
    }

    updatePreviousShotDistance(distanceYd) {
        const hole = this.roundData.holes[this.currentHole];
        if (this.currentShotNum > 1 && hole.shots.length > 0) {
            const prevShot = hole.shots[hole.shots.length - 1]; // Wait, if currentShotNum is 2, length is 1. prevShot is index 0.
            // Actually, if we just recorded shot 2, length is 2. prevShot is index 0.
            // Let's rely on app.js to pass the exact shot index if needed, or simply update the last shot BEFORE the current one.
            if (hole.shots.length >= 2) {
                hole.shots[hole.shots.length - 2].distance_yd = distanceYd;
                this.saveRoundData();
            }
        }
    }

    finishHole(putts, penalties, memo) {
        const hole = this.roundData.holes[this.currentHole];
        hole.putts = putts;
        hole.penalties = penalties;
        hole.memo = memo;
        hole.hole_score = hole.shots.length + putts + penalties;

        this.saveRoundData();
    }

    updateSummary() {
        let totalScore = 0;
        let totalPutts = 0;
        let totalPenalties = 0;

        for (let i = 1; i <= 18; i++) {
            if (this.roundData.holes[i]) {
                const h = this.roundData.holes[i];
                totalScore += (h.hole_score || 0);
                totalPutts += (h.putts || 0);
                totalPenalties += (h.penalties || 0);
            }
        }

        this.roundData.summary = {
            total_score: totalScore,
            total_putts: totalPutts,
            total_penalties: totalPenalties
        };
    }

    generateExportText() {
        let text = `【Round Report: ${new Date(this.roundData.date).toLocaleDateString()}】\n`;
        text += `Total: ${this.roundData.summary.total_score} (Putts: ${this.roundData.summary.total_putts}, Penalties: ${this.roundData.summary.total_penalties})\n\n`;

        for (let i = 1; i <= 18; i++) {
            const h = this.roundData.holes[i];
            if (h) {
                text += `${i}H (Par ${h.par}): ${h.hole_score} (Putts: ${h.putts}, Pen: ${h.penalties})\n`;

                const clubLog = h.shots.map(s => {
                    let d = s.distance_yd ? `${s.distance_yd}yd` : '';
                    return `${s.club}${d ? ' ' + d : ''}`;
                }).join(' -> ');

                if (clubLog) text += `  Shots: ${clubLog}\n`;
                if (h.memo) text += `  Memo: ${h.memo}\n`;
                text += '\n';
            }
        }
        return text;
    }

    // UI Bindings (Helper for standalone logic if needed, but app.js will drive mostly)
    bindEvents() {
        // Will be orchestrated by app.js to keep map context
    }
}
