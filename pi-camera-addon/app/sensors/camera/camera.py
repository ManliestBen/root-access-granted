"""
Camera capture using fswebcam (USB cameras at /dev/video0, /dev/video1 or /dev/video2).
Uses env for device paths and resolution; supports capture to bytes or to disk.
"""
import logging
import os
import subprocess
import time
from typing import Optional, Tuple, List, Dict

UPPER_CAMERA_DEVICE = os.getenv("UPPER_CAMERA_DEVICE", "/dev/video0")
LOWER_CAMERA_DEVICE = os.getenv("LOWER_CAMERA_DEVICE", "/dev/video2")
CAMERA_RESOLUTION = os.getenv("CAMERA_RESOLUTION", "640x480")
UPPER_IMAGE_PATH = os.getenv("UPPER_IMAGE_PATH", "/tmp/upper_camera.jpg")
LOWER_IMAGE_PATH = os.getenv("LOWER_IMAGE_PATH", "/tmp/lower_camera.jpg")

logger = logging.getLogger(__name__)

DEVICE_MAP = {
    0: (UPPER_CAMERA_DEVICE, UPPER_IMAGE_PATH),
    1: (LOWER_CAMERA_DEVICE, LOWER_IMAGE_PATH),
}


class CameraError(Exception):
    """Raised when capture or device access fails."""
    pass


class Camera:
    """Control for USB cameras via fswebcam."""

    def __init__(
        self,
        resolution: Optional[str] = None,
        skip_frames: int = 2,
        frame_interval: int = 2,
    ):
        self.resolution = resolution or CAMERA_RESOLUTION
        self.skip_frames = skip_frames
        self.frame_interval = frame_interval
        self._stream_cap = None

    def list_devices(self) -> List[Dict]:
        """Return list of configured camera devices (id, device path, name)."""
        return [
            {"id": 0, "device": UPPER_CAMERA_DEVICE, "name": "upper"},
            {"id": 1, "device": LOWER_CAMERA_DEVICE, "name": "lower"},
        ]

    def _device_for_id(self, device_id: int) -> Tuple[str, str]:
        device_id = int(device_id)
        if device_id not in DEVICE_MAP:
            raise ValueError(f"device must be 0 or 1, got {device_id}")
        return DEVICE_MAP[device_id]

    def capture(
        self,
        device_id: int = 0,
        save_dir: Optional[str] = None,
    ) -> Tuple[bytes, Optional[str]]:
        """
        Capture a single frame from the given camera.

        Args:
            device_id: 0 = upper camera, 1 = lower camera.
            save_dir: If set, save image here with a timestamped filename and return path.

        Returns:
            (jpeg_bytes, saved_path_or_none)

        Raises:
            CameraError: If fswebcam fails or device is unavailable.
        """
        device_path, default_path = self._device_for_id(device_id)
        out_path = default_path
        if save_dir:
            os.makedirs(save_dir, exist_ok=True)
            out_path = os.path.join(
                save_dir,
                f"camera_{device_id}_{int(time.time())}.jpg"
            )
        cmd = [
            "fswebcam",
            "-d", device_path,
            "-r", self.resolution,
            "-S", str(self.skip_frames),
            "-F", str(self.frame_interval),
            "--no-banner",
            out_path,
        ]
        try:
            subprocess.check_call(cmd, timeout=30)
        except subprocess.CalledProcessError as e:
            logger.exception("fswebcam capture failed: %s", e)
            raise CameraError(f"Capture failed: {e}") from e
        except FileNotFoundError:
            raise CameraError("fswebcam not installed (apt install fswebcam)") from None
        except subprocess.TimeoutExpired:
            raise CameraError("Capture timed out") from None

        with open(out_path, "rb") as f:
            data = f.read()

        return data, out_path if save_dir else None

    def capture_to_bytes(self, device_id: int = 0) -> bytes:
        """Capture and return JPEG bytes only (no save)."""
        data, _ = self.capture(device_id=device_id, save_dir=None)
        return data

    def stream_frames(self, device_id: int = 0):
        """
        Generator that yields MJPEG frames for live streaming.
        Requires opencv-python-headless; yields bytes chunks for multipart response.
        """
        try:
            import cv2
        except ImportError:
            raise CameraError(
                "Live stream requires opencv-python-headless: pip install opencv-python-headless"
            ) from None
        device_path, _ = self._device_for_id(device_id)
        cap = cv2.VideoCapture(device_path)
        if not cap.isOpened():
            raise CameraError(f"Cannot open camera at {device_path}")
        try:
            w, h = 640, 480
            if "x" in self.resolution:
                parts = self.resolution.lower().split("x")
                if len(parts) == 2:
                    w, h = int(parts[0]), int(parts[1])
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                _, buf = cv2.imencode(".jpg", frame)
                yield buf.tobytes()
        finally:
            cap.release()

    def close(self):
        """Release any streaming resources."""
        if self._stream_cap is not None:
            try:
                self._stream_cap.release()
            except Exception:
                pass
            self._stream_cap = None
