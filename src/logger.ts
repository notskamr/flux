const isProd = Bun.env.NODE_ENV === 'production';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
    level: LogLevel;
    event: string;
    [key: string]: unknown;
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
    const entry: LogEntry = { level, event, ...fields };

    if (isProd) {
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
        level === 'error' ? console.error(line) : console.log(line);
        return;
    }

    // nice human readable colors and dates
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const colors: Record<LogLevel, string> = {
        info: '\x1b[36m',  // cyan
        warn: '\x1b[33m',  // yellow
        error: '\x1b[31m',  // red
        debug: '\x1b[90m',  // gray
    };
    const reset = '\x1b[0m';

    // map fields to "key=value" with dimmed keys
    const parts = Object.entries(fields)
        .map(([k, v]) => `\x1b[2m${k}\x1b[0m=${JSON.stringify(v)}`)
        .join(' ');

    console.log(`${colors[level]}${ts} ${level.toUpperCase().padEnd(5)} ${event}${reset} ${parts}`);
}


export function _logger() {
    return async function logger(c: any, next: () => Promise<void>) {
        const start = Date.now();
        const method = c.req.method;
        const path = c.req.path;

        const rawBody = method !== 'GET' ? await c.req.text() : undefined;
        if (rawBody !== undefined) {
            c.req.bodyText = rawBody;
        }

        await next();

        const ms = Date.now() - start; // calc response time
        const status = c.res.status;
        const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

        log(level, 'http', {
            method,
            path,
            status,
            ms,
            ...(rawBody !== undefined && { bodyBytes: Buffer.byteLength(rawBody) }),
        });
    };
}