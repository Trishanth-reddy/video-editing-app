// Do NOT use 'localhost'. Use your computer's IP found in Step 1.
// Make sure to include http:// (not https) and the port :8000
export const API_URL = 'http://192.168.0.7:8000';

export const TIMELINE_CONFIG = {
  PX_PER_SECOND: 100,           // Pixels per second (zoom level)
  TRACK_HEIGHT: 60,            // Height of each track
  SNAP_INTERVAL: 0.1,          // Snap to 100ms grid
  MIN_CLIP_DURATION: 0.5,       // Minimum clip length (seconds)
};

// Overlay Types
export const OVERLAY_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
};