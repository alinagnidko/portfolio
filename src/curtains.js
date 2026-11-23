// Velvet curtains rendered with WebGL as a soft, lit cloth.
//  - They hang closed across the stage, then part like real curtains: the fabric
//    gathers into deeper folds as it opens, and the bottom lags a little behind the top.
//  - Once open they are held back by a gold rope, so they are never straight.
//  - When the cursor moves close, only that patch of fabric stirs a little and settles fast.
//  - Touch screens have no cursor, so a very light breeze stirs a patch now and then.
//  - With "reduce motion" on in the system the curtains are simply drawn open.

const stage = document.querySelector('.stage');
const canvas = document.querySelector('.curtains-canvas');
const probe = document.querySelector('.curtain--left');

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function init() {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: true, alpha: true });
  if (!gl) throw new Error('no webgl');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touchOnly = window.matchMedia('(hover: none)').matches;

  const NC = 48; // mesh columns per curtain
  const ROWS = 44; // mesh rows
  const OPEN_DELAY = 300; // ms before the curtains start to part
  const OPEN_TIME = 2300; // ms the opening takes
  const LAG = 0.22; // how much the bottom of the fabric lags behind the top while opening
  const REACH = 170; // radius of the cursor's influence, px
  const SHADOW = 36; // width of the shadow cast by the free edge, px
  const STRIDE = 7; // floats per vertex

  const vertexSrc = `
    attribute vec2 aPos;
    attribute vec4 aA;
    attribute float aFade;
    uniform vec2 uRes;
    varying vec4 vA;
    varying float vFade;
    void main() {
      vec2 c = aPos / uRes * 2.0 - 1.0;
      gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
      vA = aA;
      vFade = aFade;
    }`;

  const fragmentSrc = `
    precision mediump float;
    varying vec4 vA;
    varying float vFade;
    uniform float uSide;
    const vec3 LIGHT = vec3(0.62, 0.165, 0.17);
    const vec3 DARK = vec3(0.47, 0.115, 0.13);
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      if (vA.w > 0.5) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.5 * vFade * vFade);
        return;
      }
      float f = vA.x;
      float band = floor(f);
      float l = fract(f);
      bool isLight = mod(band + uSide, 2.0) < 1.0;
      vec3 base = isLight ? LIGHT : DARK;

      // one pleat: ridge in the middle, valleys at the edges
      float ridge = sin(3.14159 * l);
      float dir = (uSide < 0.5) ? 1.0 : -1.0;
      float facing = cos(3.14159 * l) * dir;
      float diffuse = 0.60 + 0.30 * ridge + 0.20 * facing;
      float occlusion = mix(0.5, 1.0, smoothstep(0.0, 0.5, ridge));
      float sheen = pow(max(0.0, sin(3.14159 * clamp(l * 1.2 - 0.08, 0.0, 1.0))), 16.0) * 0.26;

      vec3 col = base * diffuse * occlusion + vec3(1.0, 0.78, 0.66) * sheen;
      col *= 1.0 + vA.z; // light and shade from how the cloth is bent right now

      // hanging cloth is darker at the top and at the floor
      float y = vA.y;
      col *= (1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.24, y))) * (1.0 - 0.55 * smoothstep(0.7, 1.0, y));

      // fabric texture: fine threads and grain
      col *= 0.97 + hash(floor(gl_FragCoord.xy)) * 0.05;
      col += sin(gl_FragCoord.x * 3.1) * 0.008;

      gl_FragColor = vec4(col, 1.0);
    }`;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const loc = {
    pos: gl.getAttribLocation(program, 'aPos'),
    a: gl.getAttribLocation(program, 'aA'),
    fade: gl.getAttribLocation(program, 'aFade'),
    res: gl.getUniformLocation(program, 'uRes'),
    side: gl.getUniformLocation(program, 'uSide'),
  };

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // ---- mesh -------------------------------------------------------------
  const clothCount = (NC + 1) * (ROWS + 1);
  const shadowCount = 2 * (ROWS + 1);
  const clothIndices = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < NC; c++) {
      const a = r * (NC + 1) + c;
      const b = a + 1;
      const d = a + NC + 1;
      clothIndices.push(a, b, d, b, d + 1, d);
    }
  }
  const shadowIndices = [];
  for (let r = 0; r < ROWS; r++) {
    const a = clothCount + r * 2;
    shadowIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const clothIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, clothIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(clothIndices), gl.STATIC_DRAW);
  const shadowIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shadowIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(shadowIndices), gl.STATIC_DRAW);

  const makeSide = (name, sign, bandShift) => ({
    name,
    sign,
    bandShift,
    dx: new Float32Array(clothCount),
    v: new Float32Array(clothCount),
    x: new Float32Array(clothCount), // current x of every cloth node, px
    verts: new Float32Array((clothCount + shadowCount) * STRIDE),
    buffer: gl.createBuffer(),
  });
  const sides = [makeSide('left', 1, 0), makeSide('right', -1, 1)];

  // ---- state ------------------------------------------------------------
  let W = 0;
  let H = 0;
  let finalW = 216;
  let folds = 6;
  const startTime = performance.now() + OPEN_DELAY;
  let progress = reduceMotion ? 1 : 0;
  let running = false;
  let lastX = null;

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  // the open curtains hang straight down, so the inner edge is a vertical line
  // (the folds, light and cursor sway still give them depth)
  function openShape() {
    return 1;
  }

  function widthAt(r) {
    const y = (r / ROWS) * H;
    const closed = W * 0.505;
    const open = finalW * openShape(y);
    const p = clamp01(progress * (1 + LAG) - LAG * (r / ROWS));
    return closed + (open - closed) * ease(p);
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = stage.clientWidth;
    H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    finalW = probe.offsetWidth || 216;
    folds = Math.max(2, Math.round(finalW / 36));
    render();
  }

  // ---- geometry ---------------------------------------------------------
  function build(s) {
    const { verts, x, dx } = s;
    const sign = s.sign;
    for (let r = 0; r <= ROWS; r++) {
      const width = widthAt(r);
      const wy = Math.pow(r / ROWS, 1.3);
      const y = (r / ROWS) * H;
      for (let i = 0; i <= NC; i++) {
        const t = i / NC;
        const k = r * (NC + 1) + i;
        const off = dx[k] * Math.pow(t, 1.15) * wy;
        x[k] = sign > 0 ? t * width + off : W - t * width - off;
      }
      for (let i = 0; i <= NC; i++) {
        const k = r * (NC + 1) + i;
        const lo = x[r * (NC + 1) + Math.max(0, i - 1)];
        const hi = x[r * (NC + 1) + Math.min(NC, i + 1)];
        const span = (Math.min(NC, i + 1) - Math.max(0, i - 1)) * (width / NC);
        const stretch = ((hi - lo) * sign) / span - 1;
        const o = k * STRIDE;
        verts[o] = x[k];
        verts[o + 1] = y;
        verts[o + 2] = (i / NC) * folds;
        verts[o + 3] = r / ROWS;
        verts[o + 4] = Math.max(-0.35, Math.min(0.35, -stretch * 0.5));
        verts[o + 5] = 0;
        verts[o + 6] = 1;
      }
      // soft shadow cast by the free edge
      const edge = x[r * (NC + 1) + NC];
      for (let j = 0; j < 2; j++) {
        const o = (clothCount + r * 2 + j) * STRIDE;
        verts[o] = edge + sign * SHADOW * j;
        verts[o + 1] = y;
        verts[o + 2] = 0;
        verts[o + 3] = r / ROWS;
        verts[o + 4] = 0;
        verts[o + 5] = 1;
        verts[o + 6] = 1 - j;
      }
    }
  }

  function render() {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(loc.res, W, H);

    for (const s of sides) {
      build(s);
      gl.uniform1f(loc.side, s.bandShift);
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, s.verts, gl.DYNAMIC_DRAW);
      const bytes = STRIDE * 4;
      gl.enableVertexAttribArray(loc.pos);
      gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, bytes, 0);
      gl.enableVertexAttribArray(loc.a);
      gl.vertexAttribPointer(loc.a, 4, gl.FLOAT, false, bytes, 8);
      gl.enableVertexAttribArray(loc.fade);
      gl.vertexAttribPointer(loc.fade, 1, gl.FLOAT, false, bytes, 24);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, clothIndexBuffer);
      gl.drawElements(gl.TRIANGLES, clothIndices.length, gl.UNSIGNED_SHORT, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shadowIndexBuffer);
      gl.drawElements(gl.TRIANGLES, shadowIndices.length, gl.UNSIGNED_SHORT, 0);
    }
  }

  // ---- cloth physics ----------------------------------------------------
  // Every node is pulled back to rest and shares motion with its neighbours.
  // Strong damping keeps the movement small and makes it settle quickly.
  function step() {
    let peak = 0;
    for (const s of sides) {
      const { dx, v } = s;
      // first update every velocity from the current positions, then move every node,
      // so the result does not depend on the order the nodes are visited in
      for (let r = 1; r <= ROWS; r++) {
        for (let i = 1; i <= NC; i++) {
          const k = r * (NC + 1) + i;
          const here = dx[k];
          const up = dx[k - (NC + 1)];
          const down = r < ROWS ? dx[k + NC + 1] : here;
          const left = dx[k - 1];
          const right = i < NC ? dx[k + 1] : here;
          const lap = (up + down + left + right) * 0.25 - here;
          let vel = (v[k] + -0.06 * here + 0.34 * lap) * 0.86;
          if (vel > 3) vel = 3;
          if (vel < -3) vel = -3;
          v[k] = vel;
        }
      }
      for (let r = 1; r <= ROWS; r++) {
        for (let i = 1; i <= NC; i++) {
          const k = r * (NC + 1) + i;
          let pos = dx[k] + v[k];
          if (pos > 16) pos = 16;
          if (pos < -16) pos = -16;
          dx[k] = pos;
          const a = Math.abs(v[k]) * 10 + Math.abs(pos);
          if (a > peak) peak = a;
        }
      }
    }
    return peak;
  }

  function frame(now) {
    let busy = false;
    if (!reduceMotion && progress < 1) {
      progress = clamp01((now - startTime) / OPEN_TIME);
      busy = true;
    }
    const peak = progress >= 1 ? step() : 0;
    render();
    if (busy || peak > 0.06) {
      requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  function wake() {
    if (running || reduceMotion) return;
    running = true;
    requestAnimationFrame(frame);
  }

  // a small push of air at one place on one curtain
  function push(s, px, py, force) {
    for (let r = 1; r <= ROWS; r++) {
      const dy = (r / ROWS) * H - py;
      if (Math.abs(dy) > REACH) continue;
      for (let i = 1; i <= NC; i++) {
        const k = r * (NC + 1) + i;
        const d = Math.hypot(s.x[k] - px, dy);
        if (d < REACH) {
          const f = 1 - d / REACH;
          s.v[k] += force * f * f;
        }
      }
    }
  }

  window.addEventListener('pointermove', (e) => {
    if (progress < 1 || reduceMotion) return;
    const rect = stage.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const vx = lastX === null ? 0 : Math.max(-30, Math.min(30, px - lastX));
    lastX = px;
    if (py < 0 || py > H || vx === 0) return;
    for (const s of sides) push(s, px, py, s.sign * vx * 0.035);
    wake();
  });

  if (touchOnly && !reduceMotion) {
    setInterval(() => {
      if (progress < 1) return;
      const s = sides[Math.floor(Math.random() * 2)];
      const px = s.sign > 0 ? Math.random() * finalW : W - Math.random() * finalW;
      push(s, px, H * (0.4 + Math.random() * 0.5), (Math.random() < 0.5 ? -1 : 1) * 1.1);
      wake();
    }, 3600);
  }

  new ResizeObserver(resize).observe(stage);
  resize();
  wake();
}

if (stage && canvas && probe) {
  try {
    init();
  } catch (err) {
    // no WebGL: show plain striped curtains instead
    stage.classList.add('no-gl');
    console.warn('Curtains fallback:', err.message);
  }
}
