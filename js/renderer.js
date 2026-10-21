function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${path}. Check that the assets folder was uploaded.`));
    image.src = new URL(`../${path}`, import.meta.url).href;
  });
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => { this.reducedMotion = media.matches || document.documentElement.dataset.motion === 'off'; };
    updateMotion();
    media.addEventListener('change', updateMotion);
    document.addEventListener('questathon:reading', updateMotion);
  }
  async load() {
    [this.background, this.hero, this.enemy] = await Promise.all([
      loadImage('assets/background.jpg'),
      Promise.all(Array.from({ length: 8 }, (_, i) => loadImage(`assets/character1/frame${i + 1}.png`))),
      Promise.all(Array.from({ length: 6 }, (_, i) => loadImage(`assets/enemies/design1/frame${i + 1}.png`))),
    ]);
  }
  draw(game) {
    if (!this.background) return;
    const ctx = this.ctx;
    const w = 960, h = 540;
    const distance = game?.distance ?? 0;
    const offset = this.reducedMotion ? 0 : distance * 20;
    const bgWidth = this.background.width * h / this.background.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    const scroll = offset * 0.28 % bgWidth;
    ctx.drawImage(this.background, -scroll, 0, bgWidth, h);
    ctx.drawImage(this.background, bgWidth - scroll, 0, bgWidth, h);
    const floor = 441;
    // Perspective markers give the foreground its own sense of speed.
    if (!this.reducedMotion) {
      ctx.fillStyle = '#c4a075';
      for (let x = -(offset % 140); x < w; x += 140) ctx.fillRect(x, 488, 25, 3);
    }
    const moving = game && game.speed > 8 && !game.paused && game.status === 'running';
    const heroFrame = moving && !this.reducedMotion ? Math.floor(distance * 2.5) % this.hero.length : 0;
    const heroX = 363;
    const heroH = 99;
    const heroW = this.hero[heroFrame].width * heroH / this.hero[heroFrame].height;
    ctx.fillStyle = '#183c4340';
    ctx.beginPath();ctx.ellipse(heroX + heroW / 2, floor + 1, 30, 5, 0, 0, Math.PI * 2);ctx.fill();
    ctx.drawImage(this.hero[heroFrame], heroX, floor - heroH, heroW, heroH);
    const enemyFrame = moving && !this.reducedMotion ? Math.floor((game.elapsed ?? 0) * 9) % this.enemy.length : 0;
    const enemyH = 92, enemyW = this.enemy[enemyFrame].width * enemyH / this.enemy[enemyFrame].height;
    const enemyX = heroX - (game?.gap ?? 230) - enemyW + 35;
    ctx.drawImage(this.enemy[enemyFrame], enemyX, floor - enemyH, enemyW, enemyH);
  }
}
