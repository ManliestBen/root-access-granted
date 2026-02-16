"""
Camera REST API (aligned with garden-of-eden dev branch):
- GET /upper, /lower: snapshot (backward compatible).
- GET /devices: list cameras.
- POST /capture: take picture (return image or save to project_root/photos).
- GET /stream/<int:device_id>: live MJPEG (requires opencv-python-headless).
- GET /photos: list saved photos; GET /photos/<filename>: serve a photo.

When used inside garden-of-eden, uses config.CAMERA_PHOTOS_DIR_RESOLVED and app.lib.lib.check_sensor_guard if available.
"""
import os
from functools import wraps
from flask import Blueprint, request, jsonify, Response, send_from_directory

from .camera import Camera, CameraError

# Prefer garden-of-eden config when running inside that repo
try:
    from config import CAMERA_PHOTOS_DIR_RESOLVED
    def _get_photos_dir() -> str:
        return CAMERA_PHOTOS_DIR_RESOLVED
except ImportError:
    _PROJECT_ROOT = os.getenv("GARDYN_PROJECT_ROOT", os.getcwd())
    _photos_dir_raw = os.getenv("CAMERA_PHOTOS_DIR", "photos").strip()

    def _get_photos_dir() -> str:
        if not _photos_dir_raw:
            return os.path.join(_PROJECT_ROOT, "photos")
        if os.path.isabs(_photos_dir_raw):
            return _photos_dir_raw
        return os.path.abspath(os.path.join(_PROJECT_ROOT, _photos_dir_raw))

camera_blueprint = Blueprint("camera", __name__)
camera_control = Camera()

# Use garden-of-eden sensor guard when available (app.lib.lib)
try:
    from app.lib.lib import check_sensor_guard
    check_sensor = check_sensor_guard(sensor=camera_control, sensor_name="Camera")
except ImportError:
    def check_sensor(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
        return wrapper


def _device_id_from_request() -> int:
    """Parse device from query or JSON body; default 0."""
    device = request.args.get("device")
    if device is None and request.is_json:
        body = request.get_json(silent=True) or {}
        device = body.get("device", 0)
    if device in ("upper", "0"):
        return 0
    if device in ("lower", "1"):
        return 1
    try:
        return int(device) if device is not None else 0
    except (TypeError, ValueError):
        return 0


# ----- Backward-compatible snapshot routes (GET /upper, /lower) -----

@camera_blueprint.route("/upper", methods=["GET"])
@check_sensor
def get_upper():
    """Snapshot from upper camera (JPEG). Backward compatible."""
    try:
        jpeg_bytes, _ = camera_control.capture(device_id=0, save_dir=None)
        return Response(jpeg_bytes, mimetype="image/jpeg", max_age=0)
    except CameraError as e:
        return jsonify(error=str(e)), 503


@camera_blueprint.route("/lower", methods=["GET"])
@check_sensor
def get_lower():
    """Snapshot from lower camera (JPEG). Backward compatible."""
    try:
        jpeg_bytes, _ = camera_control.capture(device_id=1, save_dir=None)
        return Response(jpeg_bytes, mimetype="image/jpeg", max_age=0)
    except CameraError as e:
        return jsonify(error=str(e)), 503


# ----- Dev-branch API -----

@camera_blueprint.route("/devices", methods=["GET"])
@check_sensor
def list_devices():
    """List configured cameras (id, device path, name)."""
    return jsonify(devices=camera_control.list_devices()), 200


@camera_blueprint.route("/capture", methods=["POST"])
@check_sensor
def capture():
    """
    Take a picture from the specified camera.
    Query/body: device=0|1|upper|lower (default 0), save=0|1 (default 0).
    save=1: save to CAMERA_PHOTOS_DIR and return JSON with url and path.
    """
    device_id = _device_id_from_request()
    save = request.args.get("save", "0").strip().lower() in ("1", "true", "yes")
    if not save and request.is_json:
        body = request.get_json(silent=True) or {}
        save = body.get("save", False) in (True, 1, "1", "true", "yes")

    save_dir = _get_photos_dir() if save else None
    try:
        jpeg_bytes, saved_path = camera_control.capture(device_id=device_id, save_dir=save_dir)
    except CameraError as e:
        return jsonify(error=str(e)), 503
    except ValueError as e:
        return jsonify(error=str(e)), 400

    if save and saved_path:
        filename = os.path.basename(saved_path)
        return jsonify(
            message="Photo saved",
            path=saved_path,
            filename=filename,
            url=f"/camera/photos/{filename}",
        ), 200

    return Response(jpeg_bytes, mimetype="image/jpeg")


@camera_blueprint.route("/stream/<int:device_id>", methods=["GET"])
@check_sensor
def stream(device_id):
    """Live MJPEG feed from the given camera (0 or 1). Use in <img src="...">."""
    if device_id not in (0, 1):
        return jsonify(error="device must be 0 or 1"), 400
    try:
        def generate():
            for frame in camera_control.stream_frames(device_id):
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        return Response(
            generate(),
            mimetype="multipart/x-mixed-replace; boundary=frame",
        )
    except CameraError as e:
        return jsonify(error=str(e)), 503


@camera_blueprint.route("/photos", methods=["GET"])
@check_sensor
def list_photos():
    """List saved photo filenames (photos dir defaults to project_root/photos)."""
    photos_dir = _get_photos_dir()
    if not os.path.isdir(photos_dir):
        return jsonify(photos=[], message="Photo directory not found (default: project_root/photos)"), 200
    try:
        files = [
            f for f in os.listdir(photos_dir)
            if f.lower().endswith((".jpg", ".jpeg"))
        ]
        files.sort(reverse=True)
        photos = [{"filename": f, "url": f"/camera/photos/{f}"} for f in files]
        return jsonify(photos=photos), 200
    except OSError as e:
        return jsonify(error=str(e)), 503


@camera_blueprint.route("/photos/<path:filename>", methods=["GET"])
@check_sensor
def get_photo(filename):
    """Serve a saved photo by filename (from project_root/photos or CAMERA_PHOTOS_DIR)."""
    photos_dir = _get_photos_dir()
    if not os.path.isdir(photos_dir):
        return jsonify(error="Photo directory not found"), 404
    if ".." in filename or os.path.sep in filename:
        return jsonify(error="Invalid filename"), 400
    try:
        return send_from_directory(photos_dir, filename, mimetype="image/jpeg")
    except OSError:
        return jsonify(error="Not found"), 404
