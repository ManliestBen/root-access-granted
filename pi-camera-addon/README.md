# Pi camera add-on for garden-of-eden

This add-on exposes HTTP endpoints for the Gardyn cameras, aligned with the **dev branch** of [garden-of-eden](https://github.com/abby-lewis/garden-of-eden). It uses `fswebcam` (and optionally OpenCV for live stream) so the dashboard can show snapshots, live MJPEG, and saved photos.

When copied into garden-of-eden, the addon uses the repo’s `config.CAMERA_PHOTOS_DIR_RESOLVED` and `app.lib.lib.check_sensor_guard` when available; otherwise it falls back to env-based resolution and a no-op guard so it can run standalone.

---

## What’s in this addon

- **Snapshot (backward compatible):** `GET /camera/upper` and `GET /camera/lower` — capture and return a JPEG from each camera.
- **Dev-style API:** devices list, POST capture (with optional save), MJPEG stream, list/serve saved photos.

**Dashboard:** Snapshot / Live toggle, Take picture, Capture & save (upper/lower), and a Saved photos section.

---

## 1. Copy files to your Pi

On the Pi, in your garden-of-eden repo, copy the `app/sensors/camera` folder so you have:

- `app/sensors/camera/__init__.py`
- `app/sensors/camera/routes.py`
- `app/sensors/camera/camera.py`

## 2. Register the blueprint

In `app/__init__.py`:

```python
from .sensors.camera.routes import camera_blueprint
# ...
app.register_blueprint(camera_blueprint, url_prefix='/camera')
```

## 3. Dependencies and permissions

- **fswebcam:** `sudo apt-get install fswebcam` (required for capture).
- **Live stream (optional):** `pip install opencv-python-headless` so `GET /camera/stream/<id>` works.
- The process running Flask must be able to read `/dev/video0` and `/dev/video2` (or whatever devices you set). Run as a user in the `video` group, or run the app with sufficient permissions; no `take-pictures.sh` or sudo needed for this addon.

## 4. Environment variables (optional)

Set in `.env` or the environment:

| Variable | Default | Description |
|----------|---------|-------------|
| `UPPER_CAMERA_DEVICE` | `/dev/video0` | Upper camera device path |
| `LOWER_CAMERA_DEVICE` | `/dev/video2` | Lower camera device path |
| `CAMERA_RESOLUTION` | `640x480` | e.g. `1280x720` |
| `UPPER_IMAGE_PATH` | `/tmp/upper_camera.jpg` | Temp path for upper capture |
| `LOWER_IMAGE_PATH` | `/tmp/lower_camera.jpg` | Temp path for lower capture |
| `CAMERA_PHOTOS_DIR` | `photos` | Where to save "Capture & save" photos. Relative paths are relative to **project root**; default is *project_root*/photos. Use an absolute path to override. |
| `GARDYN_PROJECT_ROOT` | current working directory | Project root for resolving `CAMERA_PHOTOS_DIR`. Set if you start the app from a different directory. |

## 5. Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/camera/upper` | Snapshot from upper camera (JPEG). |
| GET | `/camera/lower` | Snapshot from lower camera (JPEG). |
| GET | `/camera/devices` | List cameras (id, device path, name). |
| POST | `/camera/capture` | Take a picture. Body/query: `device` = `0`/`1` or `upper`/`lower`, `save` = `0`/`1`. Returns JPEG or JSON with `url`/`path` when `save=1` (saves to project_root/photos by default). |
| GET | `/camera/stream/0` | Live MJPEG from upper camera (for `<img src="...">`). |
| GET | `/camera/stream/1` | Live MJPEG from lower camera. |
| GET | `/camera/photos` | List saved photo filenames and URLs (from project_root/photos by default). |
| GET | `/camera/photos/<filename>` | Serve a saved photo. |

The dashboard uses these for Snapshot/Live, Take picture, Capture & save, and Saved photos.
