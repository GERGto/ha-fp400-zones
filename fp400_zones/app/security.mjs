/** Keep credentials and device identifiers out of diagnostics and error replies. */
const secrets = new Set();
export function rememberSecret(value) {
    if (typeof value !== 'string' || !value) return;
    secrets.add(value);
    secrets.add(encodeURIComponent(value));
}

export function redact(value) {
    let text = String(value ?? '');
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[redacted]');
    return text.replace(/(?:mqtts?|wss?|https?):\/\/[^\s)]+/gi, '[endpoint]')
        .replace(/\b0x[\da-f]{16}\b/gi, '[device]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[address]');
}

export function sameOrigin(req) {
    try {
        const origin = new URL(req.headers.origin);
        return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host;
    } catch {
        return false;
    }
}

export function validRequest(req, actions) {
    return req !== null && typeof req === 'object' && !Array.isArray(req)
        && Number.isSafeInteger(req.id) && typeof req.op === 'string'
        && Object.hasOwn(actions, req.op) && typeof actions[req.op] === 'function';
}
