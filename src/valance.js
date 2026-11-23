// The pelmet (the drape across the top) is cloth too: it hangs from the rod and
// sways a little where the cursor passes, exactly like the side curtains.
// A gathered velvet drape with a straight hem and only a thin line of gold.

const valance = document.querySelector('.valance');
const canvas = document.querySelector('.valance-canvas');

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

  const ROWS = 10;
  const COLW = 10; // mesh column width, px
  const REACH = 110;
  const STRIDE = 5; // x, y, u, v, shade

  const vertexSrc = `
    attribute vec2 aPos;
    attribute vec2 aUV;
    attribute float aShade;
    uniform vec2 uRes;
    varying vec2 vUV;
    varying float vShade;
    void main() {
      vec2 c = aPos / uRes * 2.0 - 1.0;
      gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
      vUV = aUV;
      vShade = aShade;
    }`;

  const fragmentSrc = `
    precision mediump float;
    varying vec2 vUV;
    varying float vShade;
    uniform float uS;
    const vec3 GOLD = vec3(0.80, 0.60, 0.26);
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      float u = vUV.x / uS;
      float v = vUV.y / uS;
      // straight hem that dips a little under every pleat
      float hem = 40.0 + 4.5 * sin(3.14159 * fract(u / 36.0));
      float d = v - hem;
      if (d > 0.0) { gl_FragColor = vec4(0.0); return; }

      // velvet pleats
      float l = fract(u / 36.0);
      float ridge = sin(3.14159 * l);
      float facing = cos(3.14159 * l);
      float diffuse = 0.60 + 0.30 * ridge + 0.20 * facing;
      float occlusion = mix(0.52, 1.0, smoothstep(0.0, 0.5, ridge));
      float sheen = pow(max(0.0, sin(3.14159 * clamp(l * 1.2 - 0.08, 0.0, 1.0))), 16.0) * 0.22;
      vec3 base = mix(vec3(0.66, 0.17, 0.18), vec3(0.42, 0.10, 0.12), smoothstep(0.0, hem, v));
      vec3 col = base * diffuse * occlusion + vec3(1.0, 0.78, 0.66) * sheen;
      col *= 1.0 + vShade;

      // shade under the rod and just above the hem gives it depth
      col *= 1.0 - 0.28 * smoothstep(hem - 12.0, hem, v);
      col *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 9.0, v));
      col *= 0.97 + hash(floor(gl_FragCoord.xy)) * 0.05;

      // one thin line of gold along the hem
      float trim = smoothstep(-1.9, -1.3, d);
      col = mix(col, GOLD * (0.8 + 0.2 * ridge), trim);

      float edge = clamp(0.5 - d * uS, 0.0, 1.0);
      gl_FragColor = vec4(col * edge, edge);
    }`;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const loc = {
    pos: gl.getAttribLocation(program, 'aPos'),
    uv: gl.getAttribLocation(program, 'aUV'),
    shade: gl.getAttribLocation(program, 'aShade'),
    res: gl.getUniformLocation(program, 'uRes'),
    scale: gl.getUniformLocation(program, 'uS'),
  };
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const buffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();

  let W = 0;
  let H = 0;
  let S = 1;
  let cols = 0;
  let dx = null;
  let v = null;
  let xs = null;
  let verts = null;
  let indexCount = 0;
  let running = false;
  let lastX = null;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    S = valance.offsetHeight / 40 || 1; // design units are drawn for a 40px tall pelmet
    const newCols = Math.ceil(W / COLW);
    if (newCols !== cols) {
      cols = newCols;
      const count = (cols + 1) * (ROWS + 1);
      dx = new Float32Array(count);
      v = new Float32Array(count);
      xs = new Float32Array(count);
      verts = new Float32Array(count * STRIDE);
      const indices = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < cols; c++) {
          const a = r * (cols + 1) + c;
          const d = a + cols + 1;
          indices.push(a, a + 1, d, a + 1, d + 1, d);
        }
      }
      indexCount = indices.length;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    }
    render();
  }

  // pinned at both walls, free in the middle
  const wallWeight = (u) => Math.pow(Math.sin((Math.PI * u) / W), 0.6);

  function render() {
    for (let r = 0; r <= ROWS; r++) {
      const y = (r / ROWS) * H;
      const wy = Math.pow(r / ROWS, 0.9);
      for (let i = 0; i <= cols; i++) {
        const k = r * (cols + 1) + i;
        const u = Math.min(i * COLW, W);
        xs[k] = u + dx[k] * wallWeight(u) * wy;
      }
      for (let i = 0; i <= cols; i++) {
        const k = r * (cols + 1) + i;
        const lo = xs[r * (cols + 1) + Math.max(0, i - 1)];
        const hi = xs[r * (cols + 1) + Math.min(cols, i + 1)];
        const span = (Math.min(cols, i + 1) - Math.max(0, i - 1)) * COLW;
        const stretch = (hi - lo) / span - 1;
        const o = k * STRIDE;
        verts[o] = xs[k];
        verts[o + 1] = y;
        verts[o + 2] = Math.min(i * COLW, W);
        verts[o + 3] = y;
        verts[o + 4] = Math.max(-0.3, Math.min(0.3, -stretch * 0.5));
      }
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(loc.res, W, H);
    gl.uniform1f(loc.scale, S);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(loc.uv);
    gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, bytes, 8);
    gl.enableVertexAttribArray(loc.shade);
    gl.vertexAttribPointer(loc.shade, 1, gl.FLOAT, false, bytes, 16);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
  }

  // same cloth physics as the side curtains: small, damped, quick to settle
  function step() {
    let peak = 0;
    for (let r = 1; r <= ROWS; r++) {
      for (let i = 1; i < cols; i++) {
        const k = r * (cols + 1) + i;
        const here = dx[k];
        const up = dx[k - (cols + 1)];
        const down = r < ROWS ? dx[k + cols + 1] : here;
        const lap = (up + down + dx[k - 1] + dx[k + 1]) * 0.25 - here;
        let vel = (v[k] + -0.06 * here + 0.34 * lap) * 0.86;
        if (vel > 3) vel = 3;
        if (vel < -3) vel = -3;
        v[k] = vel;
      }
    }
    for (let r = 1; r <= ROWS; r++) {
      for (let i = 1; i < cols; i++) {
        const k = r * (cols + 1) + i;
        let pos = dx[k] + v[k];
        if (pos > 14) pos = 14;
        if (pos < -14) pos = -14;
        dx[k] = pos;
        const a = Math.abs(v[k]) * 10 + Math.abs(pos);
        if (a > peak) peak = a;
      }
    }
    return peak;
  }

  function frame() {
    const peak = step();
    render();
    if (peak > 0.06) {
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

  function push(px, py, force) {
    let hit = 0;
    for (let r = 1; r <= ROWS; r++) {
      const dy = (r / ROWS) * H - py;
      if (Math.abs(dy) > REACH) continue;
      for (let i = 1; i < cols; i++) {
        const k = r * (cols + 1) + i;
        const d = Math.hypot(xs[k] - px, dy);
        if (d < REACH) {
          const f = 1 - d / REACH;
          v[k] += force * f * f;
          hit++;
        }
      }
    }
    return hit;
  }

  window.addEventListener('pointermove', (e) => {
    if (reduceMotion) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const vx = lastX === null ? 0 : Math.max(-30, Math.min(30, px - lastX));
    lastX = px;
    if (vx === 0) return;
    if (push(px, py, vx * 0.05) > 0) wake();
  });

  if (touchOnly && !reduceMotion) {
    setInterval(() => {
      push(Math.random() * W, H * 0.6, (Math.random() < 0.5 ? -1 : 1) * 1.2);
      wake();
    }, 3800);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
}

if (valance && canvas) {
  try {
    init();
  } catch (err) {
    valance.classList.add('no-gl');
    console.warn('Valance fallback:', err.message);
  }
}
