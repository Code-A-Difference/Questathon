// A pinned runtime keeps future CDN updates from changing tracking behavior.
const VERSION = '0.10.18';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
let detector;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const { FilesetResolver, PoseLandmarker } = await import(`${BASE}/vision_bundle.mjs`);
      detector = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(`${BASE}/wasm`), {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame' && detector) {
      try {
        const result = detector.detectForVideo(data.frame, data.timestamp);
        self.postMessage({ type: 'pose', points: result.landmarks[0] ?? [], timestamp: data.timestamp });
      } finally { data.frame.close(); }
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'Pose tracking could not start.' });
  }
};
