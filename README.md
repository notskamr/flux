# Flux
A simple, data streaming service that takes advantage of <a href="https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events" target="_blank">Server-Sent Events (SSE)</a>.

## Docs
[Website](https://flux.vsahni.me/)

## Self-Hosting
To self-host, clone the repository:
```sh
git clone
```

Create Turso database:
[Turso](https://turso.tech/)

Create a `.env` file in the root directory and add the following:
```sh
TURSO_URL={libsql://your-turso-url.turso.io}
TURSO_AUTH_TOKEN={YOUR_AUTH_TOKEN}
```

Download Bun:
[BunJS](https://bun.sh/)

Push schema to Turso:
```sh
bunx drizzle-kit push:sqlite
```

Starting Flux:
```sh
bun install && bun run start
```




## Development
To install dependencies:
```sh
bun install
```

To run:
```sh
bun run dev
```

Open:
```
http://localhost:3000
```
