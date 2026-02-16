<p align="center">
  <img src="public/images/logo.png" alt="Root Access Granted" width="320" />
</p>

# Root Access Granted

**Root Access Granted** is a modern web dashboard for monitoring and controlling a device running the [garden-of-eden](https://github.com/abby-lewis/garden-of-eden) API. It provides a single interface for sensors, lights, pump, cameras, and schedule rules—with optional passkey (WebAuthn) authentication.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
  - [Sensors](#sensors)
  - [Lights](#lights)
  - [Pump](#pump)
  - [Schedule rules](#schedule-rules)
  - [Camera](#camera)
  - [Authentication](#authentication)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Development](#development)
- [Build & preview](#build--preview)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Time zone](#time-zone)
- [Tech stack](#tech-stack)
- [Related](#related)

---

## Overview

Root Access Granted is a React + TypeScript (Vite) single-page application that talks to the garden-of-eden Flask API on your Raspberry Pi (or other device). Use it to:

- View live sensor data (water level, humidity, air and PCB temperature)
- Control lights and pump (on/off, brightness, speed)
- Manage schedule rules that run on the device every minute
- View camera snapshots and save photos
- Sign in with a passkey when the API has auth enabled

The dashboard is **static** (HTML/JS/CSS after build) and can be served from any host (e.g. Netlify, Vercel, or the same Pi). The browser communicates directly with your device API; set `VITE_GARDYN_API_URL` at build time to point to that API.

---

## Features

### Sensors

- **Water level (distance)** — Ultrasonic distance in **centimeters** (sensor to water surface). Higher value = emptier tank. Hardware: DYP-A01-V2.0. The app shows raw cm; you interpret “full” vs “low” for your tank.
- **Humidity** — Relative humidity from the AM2320 (or compatible) sensor.
- **Air temperature** — Air temperature from the same sensor (displayed in °F; API returns Celsius).
- **PCB temperature** — Board temperature from the PCT2075 sensor (displayed in °F).

Values refresh when you click **Refresh** or on load. **Last update** is shown in Central Time.

---

### Lights

- **On / Off** — Turn the light on or off.
- **Brightness** — Slider from 0–100%. Current brightness is shown; changing the slider sends the new value to the device.

---

### Pump

- **On / Off** — Turn the pump on or off.
- **Speed** — Slider from 0–100%. Current speed is shown.
- **Power stats** — When the INA219 power monitor is present, current draw (and related stats) are displayed.

---

### Schedule rules

Rule-based scheduling runs **on the device** every minute (not in the dashboard). The dashboard is for creating, editing, and viewing rules.

- **Light rules**
  - **Start time** (required) and optional **end time** (time range). At start, light goes to the set brightness; at end, it turns off.
  - **Set and stay** — No end time: at start time the light is set to the chosen brightness and left there (use 0% to “turn off at this time”).
  - **Brightness** — 0–100%.
- **Pump rules**
  - **Time** — When to turn the pump on.
  - **Duration** — Minutes to run at 100%, then the device turns it off.

You can **create**, **edit**, **delete**, and **pause** / **resume** rules. All times are in **Central Time** (America/Chicago). The UI shows the current device time (Central) and formats times in 12-hour form.

---

### Camera

- **Upper / lower snapshots** — Two camera feeds. Each has a **Refresh** button to fetch a new snapshot from the API (`/camera/upper`, `/camera/lower`). Each also has **Capture & save** to take a picture and save it on the Pi (requires `CAMERA_PHOTOS_DIR` on the API).
- **Saved photos** — List of photos stored on the device. You can open in a new tab, download, or delete. Photos are loaded with the same auth token as the rest of the API.

Camera endpoints require the garden-of-eden camera stack (e.g. fswebcam and configured USB devices). If the Pi uses a separate camera add-on, see `pi-camera-addon/README.md` for alignment with the API.

---

### Authentication

When the garden-of-eden API has **AUTH_ENABLED=true**, the dashboard uses **passkey (WebAuthn)** sign-in:

- **Sign in** — Use a passkey (device biometrics or security key) registered for this app.
- **Register** — New users enter an email; registration is only allowed if that email is in the API’s `ALLOWED_EMAILS` (or the API allows a single user with no list).

The Pi must be configured with **WEBAUTHN_RP_ID** and **WEBAUTHN_ORIGIN** matching the **dashboard** origin (e.g. `localhost` and `http://localhost:5173` for local dev). See the [garden-of-eden README](https://github.com/abby-lewis/garden-of-eden#dashboard-deployment-and-passkey-auth) for the table of origins and settings.

---

## Prerequisites

- **Node.js** and **npm** (or equivalent). The project uses Vite 7 and React 19; a recent Node LTS is recommended.
- A **device running garden-of-eden** with the Flask API reachable from the machine where you run the dashboard (dev or production). For production, the API must be reachable from the **user’s browser** (same network, port-forward, or VPN).

---

## Setup

1. **Clone and install**
   ```bash
   git clone <your-repo-url>
   cd gardyn-dashboard
   npm install
   ```

2. **Configure the API URL (required)**  
   The app needs the device API base URL at build time. Copy the example env and set it:
   ```bash
   cp .env.example .env
   ```
   Edit `.env`:
   ```bash
   VITE_GARDYN_API_URL=http://192.168.1.181:5000
   ```
   Use your Pi’s IP or hostname and port. For HTTPS (e.g. behind Nginx), use `https://your-host:8444`. No trailing slash.  
   If this variable is missing or empty, the app will throw an error on load.

3. **Run the dev server**
   ```bash
   npm run dev
   ```
   Open **http://localhost:5173**.

---

## Development

- **Dev server** — `npm run dev` (Vite with HMR).
- **Lint** — `npm run lint` (ESLint).
- **Type check** — `npm run build` runs `tsc -b` before the Vite build.

Changing `.env` (e.g. switching API URL) requires restarting the dev server; Vite inlines env at startup.

---

## Build & preview

```bash
npm run build
```

Output is in **`dist/`**. To serve it locally:

```bash
npm run preview
```

---

## Deployment

The dashboard is **static**. Deploy the contents of **`dist/`** to any static host (Netlify, Vercel, S3, Nginx, etc.).

- **Environment** — Set **`VITE_GARDYN_API_URL`** in the **build** environment to your API URL. Vite bakes it into the bundle at build time.
- **CORS** — The garden-of-eden API has CORS enabled for the dashboard origin. If you deploy to a custom domain, ensure the API’s CORS config allows that origin.
- **Reachability** — The API must be reachable from the **user’s browser**. Use HTTPS and port-forward/VPN/DDNS as needed; see [garden-of-eden HTTPS setup](https://github.com/abby-lewis/garden-of-eden/blob/main/docs/HTTPS-Setup.md) for exposing the API securely.

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GARDYN_API_URL` | Yes | Base URL of the garden-of-eden API (e.g. `http://192.168.1.181:5000` or `https://your-host:8444`). No trailing slash. |

See **`.env.example`** for a template.

---

## Time zone

Schedule times and “Last update” are shown in **Central Time** (America/Chicago). The device (Pi) should have its timezone set to Central so rules run at the expected clock times.

---

## Tech stack

- **React 19** + **TypeScript**
- **Vite 7** — build and dev server
- **CSS** — plain CSS with variables (no framework)
- **Auth** — WebAuthn (passkey) via the garden-of-eden `/auth/*` endpoints; JWT sent on subsequent API calls

---

## Related

- **[garden-of-eden](https://github.com/abby-lewis/garden-of-eden)** — Flask API and device logic (sensors, light, pump, camera, schedule).
- **[REST API reference](https://github.com/abby-lewis/garden-of-eden/blob/main/docs/REST-API.md)** — Full endpoint documentation for the API.
- **[HTTPS setup](https://github.com/abby-lewis/garden-of-eden/blob/main/docs/HTTPS-Setup.md)** — Exposing the API over HTTPS (e.g. for remote access).
- **pi-camera-addon** — Optional camera add-on; see `pi-camera-addon/README.md` in this repo if you use it.
