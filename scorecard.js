export class ScorecardManager {
    constructor() {
        this.roundData = this.loadRoundData() || this.createNewRound();

        // Restore state if available
        this.currentHole = this.roundData.currentHole || 1;
        this.currentShotNum = this.roundData.currentShotNum || 1;

        // Ensure UI elements exist before binding
        this.bindEvents();
    }

    createNewRound(holeSequence = [], companions = []) {
        return {
            round_id: 'Round_' + new Date().toISOString(),
            date: new Date().toISOString(),
            holeSequence: holeSequence,
            companions: companions,
            holes: {},
            lastShotStartPos: null, // Track the starting point of the current shot
            trackingState: null,    // null: Ready for S1, X: Currently tracking Shot X
            summary: {
                total_score: 0,
                total_putts: 0,
                total_penalties: 0
            },
            currentHole: 1,
            currentShotNum: 1
        };
    }

    setShotStartPos(lat, lng) {
        this.roundData.lastShotStartPos = { lat, lng };
        this.saveRoundData();
    }

    advanceTracking(lat, lng) {
        if (this.roundData.trackingState === null) {
            // Start tracking S1
            this.roundData.trackingState = 1;
            this.roundData.lastShotStartPos = { lat, lng };
        } else {
            // End current shot tracking, start next shot's start point
            const currentShotIdx = this.roundData.trackingState;
            // Mark end of current shot and start of next
            // (The calculation of distance will be done by app.js or we could provide a helper)
            this.roundData.trackingState = currentShotIdx + 1;
            this.roundData.lastShotStartPos = { lat, lng };
        }
        this.saveRoundData();
        return this.roundData.trackingState;
    }

    resetTracking() {
        this.roundData.trackingState = null;
        this.roundData.lastShotStartPos = null;
        this.saveRoundData();
    }

    clearShotStartPos() {
        this.roundData.trackingState = null;
        this.roundData.lastShotStartPos = null;
        this.saveRoundData();
    }

    loadRoundData() {
        const data = localStorage.getItem('golf_pwa_round_data');
        if (data) {
            const parsed = JSON.parse(data);
            return parsed;
        }
        return null;
    }

    saveRoundData() {
        // Persist current state into roundData before saving
        this.roundData.currentHole = this.currentHole;
        this.roundData.currentShotNum = this.currentShotNum;

        localStorage.setItem('golf_pwa_round_data', JSON.stringify(this.roundData));
        this.updateSummary();
    }

    startNewRound(courseName, holesArray, companions = []) {
        this.roundData = this.createNewRound(holesArray, companions);
        this.roundData.course_name = courseName;
        this.currentHole = holesArray[0] || 1;
        this.currentShotNum = 1;
        this.saveRoundData();
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

    saveShot(shotNum, club, score, memo, coords, extraIncrement = 0, fwKeep = false) {
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
                memo: memo,
                penalty_val: extraIncrement,
                fw_keep: fwKeep
            };

            // Calculate distance for the previous shot (landing point)
            if (shotNum > 1 && hole.shots.length >= shotNum - 1) {
                const prevShot = hole.shots[shotNum - 2];
                if (prevShot && !prevShot.end_coords) {
                    prevShot.end_coords = coords;
                }
            }

            hole.shots.push(shot);
            hole.shots.sort((a, b) => a.shot_num - b.shot_num);

            // Increment hole penalties
            hole.penalties = (hole.penalties || 0) + extraIncrement;

            if (shotNum >= this.currentShotNum) {
                this.currentShotNum = shotNum + 1 + extraIncrement;
            }
        } else {
            // Merge into existing shot (e.g. distance was already recorded)
            const oldPenalty = shot.penalty_val || 0;
            shot.club = club;
            shot.score = score;
            shot.memo = memo;
            shot.penalty_val = extraIncrement;
            shot.fw_keep = fwKeep;

            // Only update start_coords if missing
            if (!shot.start_coords && coords) {
                shot.start_coords = coords;
            }

            // Adjust hole penalties based on diff
            hole.penalties = (hole.penalties || 0) - oldPenalty + extraIncrement;
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

    finishHole(putts, penalties, overallMemo, compScores = {}) {
        const hole = this.roundData.holes[this.currentHole];
        hole.putts = putts;
        hole.penalties = penalties;
        hole.companionScores = compScores;

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

        this.clearShotStartPos();
        this.saveRoundData();
    }

    updateSummary() {
        let totalScore = 0;
        let totalPutts = 0;
        let totalPenalties = 0;

        for (const hNum of (this.roundData.holeSequence || [])) {
            if (this.roundData.holes[hNum]) {
                const h = this.roundData.holes[hNum];
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
        let text = `[Round Report: ${new Date(this.roundData.date).toLocaleDateString()}]\n`;
        text += `Total: ${this.roundData.summary.total_score} (Putts: ${this.roundData.summary.total_putts}, Penalties: ${this.roundData.summary.total_penalties})\n\n`;

        for (const hNum of (this.roundData.holeSequence || [])) {
            const h = this.roundData.holes[hNum];
            if (h) {
                text += `${hNum}H (Par ${h.par}): ${h.hole_score} (Putts: ${h.putts}, Pen: ${h.penalties})\n`;

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

    // --- History Management ---
    getHistory() {
        const historyData = localStorage.getItem('golf-round-history');
        return historyData ? JSON.parse(historyData) : [];
    }

    saveRoundToHistory(courseName) {
        this.updateSummary();
        this.roundData.course_name = courseName || this.roundData.course_name || "Unknown Course";
        let history = this.getHistory();

        // Check if this round already exists in history
        const existingIndex = history.findIndex(r => r.round_id === this.roundData.round_id);
        if (existingIndex !== -1) {
            history[existingIndex] = JSON.parse(JSON.stringify(this.roundData));
        } else {
            history.push(JSON.parse(JSON.stringify(this.roundData)));
        }

        // Sort descending by date
        history.sort((a, b) => new Date(b.date) - new Date(a.date));
        localStorage.setItem('golf-round-history', JSON.stringify(history));

        // Clear temporary ongoing round data
        this.clearTemporaryRound();
    }

    clearTemporaryRound() {
        localStorage.removeItem('golf_pwa_round_data');
        this.roundData = this.createNewRound();
        this.currentHole = 1;
        this.currentShotNum = 1;
    }

    updateHistoryRound(updatedRound) {
        let history = this.getHistory();
        const index = history.findIndex(r => r.round_id === updatedRound.round_id);
        if (index !== -1) {
            history[index] = updatedRound;
            localStorage.setItem('golf-round-history', JSON.stringify(history));
            return true;
        }
        return false;
    }

    deleteRoundFromHistory(roundId) {
        let history = this.getHistory();
        const newHistory = history.filter(r => r.round_id !== roundId);
        localStorage.setItem('golf-round-history', JSON.stringify(newHistory));
    }

    getBestScore(limit = null) {
        let history = this.getHistory();
        if (limit && history.length > 0) {
            history = history.slice(0, limit);
        }
        let best = Infinity;
        history.forEach(round => {
            const sequence = round.holeSequence || Array.from({ length: 18 }, (_, i) => i + 1);
            // Count holes played
            let holesPlayed = 0;
            for (const hNum of sequence) {
                if (round.holes[hNum] && round.holes[hNum].hole_score > 0) holesPlayed++;
            }
            if (holesPlayed === sequence.length && round.summary.total_score > 0) {
                if (round.summary.total_score < best) best = round.summary.total_score;
            }
        });
        return best === Infinity ? '--' : best;
    }

    getAverageScore(limit = null) {
        let history = this.getHistory();
        // Filter strictly 18-hole rounds
        const fullRounds = history.filter(round => {
            const sequence = round.holeSequence || Array.from({ length: 18 }, (_, i) => i + 1);
            let holesPlayed = 0;
            for (const hNum of sequence) {
                if (round.holes[hNum] && round.holes[hNum].hole_score > 0) holesPlayed++;
            }
            return holesPlayed === sequence.length && round.summary.total_score > 0;
        });

        if (fullRounds.length === 0) return '--';

        // Take limit if provided
        const recent = limit ? fullRounds.slice(0, limit) : fullRounds;
        const sum = recent.reduce((acc, r) => acc + r.summary.total_score, 0);
        return Math.round(sum / recent.length);
    }
}
