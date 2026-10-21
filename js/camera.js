export class CameraController {
  constructor(video, onPose, onError) {
    this.video = video;
    this.onPose = onPose;
    this.onError = onError;
    this.running = false;
    this.generation = 0;
  }
  async start() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost. Open the hosted game or use the local server.');
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('This browser cannot run camera tracking. Try a current Chrome or Safari, or use the keyboard demo.');
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream;
    this.video.srcObject = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (this.stream === stream) this.onError(new Error('The camera disconnected. Reconnect it and start a new break, or try the keyboard demo.'));
    });
    try {
      await this.video.play();
      if (generation !== this.generation) return false;
      // MediaPipe's WASM loader uses importScripts; it needs a classic worker.
      this.worker = new Worker(new URL('./pose-worker.js', import.meta.url));
      await new Promise((resolve, reject) => {
        this.rejectInit = reject;
        this.initTimeout = setTimeout(() => reject(new Error('Camera tracking took too long to load. Check your connection and try again.')), 45000);
        this.worker.onerror = () => {
          const error = new Error('Camera tracking could not load. Check your connection, allow the model downloads, or try the keyboard demo.');
          if (!this.running) reject(error); else this.onError(error);
        };
        this.worker.onmessage = ({ data }) => {
          if (data.type === 'ready') resolve();
          else if (data.type === 'pose') { this.busy = false; this.onPose(data.points, data.timestamp); }
          else if (data.type === 'error') {
            const error = new Error('Pose tracking could not run. Check your connection or try a current Chrome or Safari.');
            if (!this.running) reject(error); else this.onError(error);
          }
        };
        this.worker.postMessage({ type: 'init' });
      });
      clearTimeout(this.initTimeout);
      this.rejectInit = null;
      if (generation !== this.generation) return false;
      this.running = true;
      this.busy = false;
      this.lastSent = -Infinity;
      this.lastVideoTime = -1;
      this.pump();
      return true;
    } catch (error) { if (generation === this.generation) this.stop(); throw error; }
  }
  pump = async () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.pump);
    const now = performance.now();
    if (this.busy || now - this.lastSent < 80 || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
    this.busy = true;
    this.lastSent = now;
    this.lastVideoTime = this.video.currentTime;
    const generation = this.generation;
    try {
      const bitmap = await createImageBitmap(this.video);
      if (!this.running || generation !== this.generation) { bitmap.close(); return; }
      this.worker.postMessage({ type: 'frame', frame: bitmap, timestamp: now }, [bitmap]);
    } catch {
      this.busy = false;
      if (this.running) this.onError(new Error('The camera frame could not be read. Restart the camera or try the keyboard demo.'));
    }
  };
  stop() {
    this.generation++;
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.initTimeout);
    this.rejectInit?.(new Error('Camera setup cancelled.'));
    this.rejectInit = null;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
