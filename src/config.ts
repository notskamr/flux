export const config = {
    maxConnections: 10000, // Maximum number of connections allowed
    maxConnectionsPerFlux: 250, // Maximum number of connections per flux allowed
    heartbeatInterval: 30000, // Interval between heartbeat messages
    connectionTimeout: 300000, // Time after which a connection is considered stale
    maxPayloadSize: 2000, // Maximum size of a message payload
    rateLimitWindow: 60000, // Time window for rate limiting
    maxRequestsPerWindow: 100, // Maximum number of requests per rate limit window
};
