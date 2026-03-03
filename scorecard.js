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

    saveShot(shotNum, club, score, memo, coords) {
        const hole = this.roundData.holes[this.currentHole];
        let shot = hole.shots.find(s => s.shot_num === shotNum);

        if (!shot) {
            // New shot
            shot = {
                shot_num: shotNum,
                club: club,
                start_coords: coords,
                end_coords: null,
                distance_yd: 0,
                score: score,
                memo: memo
            };

            // Calculate distance for the previous shot if it exists and hasn't been closed
            if (shotNum > 1 && hole.shots.length >= shotNum - 1) {
                const prevShot = hole.shots[shotNum - 2];
                // Only set end_coords if not already set, to prevent overwriting distance if editing
                if (!prevShot.end_coords) {
                    prevShot.end_coords = coords;
                    // distance_yd will be updated by app.js shortly after
                }
            }

            hole.shots.push(shot);
            // Ensure array is sorted by shot_num
            hole.shots.sort((a, b) => a.shot_num - b.shot_num);

            if (shotNum >= this.currentShotNum) {
                this.currentShotNum = shotNum + 1;
            }
        } else {
            // Edit existing shot (coords remain unchanged)
            shot.club = club;
            shot.score = score;
            shot.memo = memo;
        }

        this.saveRoundData();
        return shot;
    }

    updatePreviousShotDistance(distanceYd, shotIndex) {
        const hole = this.roundData.holes[this.currentHole];
        if (hole && hole.shots[shotIndex]) {
            hole.shots[shotIndex].distance_yd = distanceYd;
            this.saveRoundData();
        }
    }

    finishHole(putts, penalties, overallMemo) {
        const hole = this.roundData.holes[this.currentHole];
        hole.putts = putts;
        hole.penalties = penalties;

        let combinedMemo = "";
        hole.shots.forEach(s => {
            if (s.memo && s.memo.trim() !== "") {
                combinedMemo += `[Shot ${s.shot_num}] ${s.memo}\n`;
            }
        });
        if (overallMemo && overallMemo.trim() !== "") {
            combinedMemo += overallMemo;
        }

        hole.memo = combinedMemo.trim();
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
                    let sc = s.score !== undefined ? `[${s.score}]` : '';
                    return `${s.club}${d ? ' ' + d : ''}${sc}`;
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
