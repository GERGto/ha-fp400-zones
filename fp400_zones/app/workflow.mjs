/** Device-scoped onboarding jobs and expiring viewer leases. */
export class Workflow {
    constructor({profiles, save, send, changed, log, now = Date.now}) {
        Object.assign(this, {profiles, save, send, changed, log, now});
        this.jobs = new Map();
        this.viewers = new Map();
        this.streams = new Map();
    }
    profile(id) { return this.profiles[id] || {}; }
    update(id, patch) {
        this.profiles[id] = {...this.profile(id), ...patch};
        this.save();
        this.changed();
        return this.profile(id);
    }
    watch(owner, id) {
        if (id) this.viewers.set(owner, {id, until: this.now() + 45000});
        else this.viewers.delete(owner);
    }
    startLearning(id) {
        const existing = this.jobs.get(id);
        if (existing && ['countdown', 'learning'].includes(existing.status)) throw new Error('Room learning is already in progress');
        const job = {status: 'countdown', started: this.now(), begins: this.now() + 10000, deadline: this.now() + 130000, sawRunning: false};
        this.jobs.set(id, job);
        this.log('info', 'Room learning scheduled: leave the room within 10 seconds');
        this.changed();
        return job;
    }
    cancelLearning(id) {
        const job = this.jobs.get(id);
        if (job?.status === 'learning') throw new Error('Learning has already started on the sensor. Wait for its result.');
        this.jobs.delete(id);
        this.changed();
    }
    observe(id, state) {
        const job = this.jobs.get(id);
        if (!job || job.status !== 'learning') return;
        const result = state.background_learning_result;
        if (result === 'running') job.sawRunning = true;
        if (!job.sawRunning || !result || result === 'running') return;
        job.status = result === 'success' ? 'complete' : 'error';
        job.error = result === 'success' ? null : `Sensor reported: ${result}`;
        if (job.status === 'complete') this.update(id, {learnedAt: this.now()});
        this.log(job.status === 'complete' ? 'info' : 'warn', `Room learning ${job.status}`);
        this.changed();
    }
    tick(devices) {
        const now = this.now();
        const ids = new Set(devices);
        for (const [owner, lease] of this.viewers) if (lease.until < now || !ids.has(lease.id)) this.viewers.delete(owner);
        for (const [id, job] of this.jobs) {
            if (!ids.has(id)) { this.jobs.delete(id); continue; }
            if (job.status === 'countdown' && now >= job.begins) {
                job.status = 'learning';
                try { this.send(id, {background_learning: 'start'}); }
                catch (err) { job.status = 'error'; job.error = err.message; }
                this.changed();
            }
            if (job.status === 'learning' && now >= job.deadline) {
                job.status = 'error';
                job.error = 'No confirmed learning result within 2 minutes. Check diagnostics and retry.';
                this.log('warn', job.error);
                this.changed();
            }
        }
        for (const id of devices) {
            const watched = [...this.viewers.values()].some((v) => v.id === id);
            const wanted = watched;
            const previous = this.streams.get(id);
            if (wanted && (!previous || now - previous.sent >= 30000)) {
                try {
                    this.send(id, {location_subscribe: 60});
                    this.streams.set(id, {sent: now, reason: 'visible editor'});
                    if (!previous) this.log('info', `Position stream requested for a visible editor (60-second lease)`);
                } catch { /* Retry while MQTT or the device is unavailable. */ }
            } else if (!wanted && previous) {
                this.streams.delete(id);
                this.log('info', 'Position stream renewal stopped; the last request expires within 60 seconds');
            }
        }
        for (const id of this.streams.keys()) if (!ids.has(id)) this.streams.delete(id);
    }
}

export function validateRoom(room) {
    if (!room || !Array.isArray(room.outline) || room.outline.length < 3 || room.outline.length > 1000) throw new Error('Walk the room boundary before continuing');
    if (!room.outline.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -400 && p.x <= 400 && p.y >= 0 && p.y <= 1000)) throw new Error('Room outline is outside the supported sensor grid');
    return {outline: room.outline.map(({x, y}) => ({x, y})), passes: 2};
}
