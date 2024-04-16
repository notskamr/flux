# Flux
A simple, data streaming service that takes advantage of <a href="https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events" target="_blank">Server-Sent Events (SSE)</a>.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/_RXeq1?referralCode=OutMii)

## Docs
[Website](https://flux.vsahni.me/)

## Self-Hosting
1. To self-host, clone the repository:
```sh
git clone
```

2. Create a Turso database:
[Turso](https://turso.tech/)

3. Create a `.env` file in the root directory and add the following:
    ```sh
    TURSO_URL={libsql://your-turso-url.turso.io}
    TURSO_AUTH_TOKEN={YOUR_AUTH_TOKEN}
    API_KEY={OPTIONAL_API_KEY}
    ```

4. Download Bun:
[BunJS](https://bun.sh/)

5. Push schema to Turso
   ```sh
    bunx drizzle-kit push:sqlite
    ```


### Hosting
Host on Vercel, Railway, a VPS with Docker, or any other hosting service that supports Bun.
Make sure to add the environment variables to the hosting service.


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
