/**
 * Lazy Three.js lab scenes with shading-motion principles:
 * temporal decay trails, thresholded deltas, directional smear.
 * Falls back to caller when WebGL / motion is unavailable.
 */
(function () {
  'use strict';

  var THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
  var LAB_IDS = {
    'gradient-descent': true,
    'kv-cache-sizer': true,
    'kv-cache': true,
    'softmax-temperature': true
  };

  var threePromise = null;
  var active = null;

  function prefersReduced() {
    return !!(window.AIFS_motion && window.AIFS_motion.prefersReduced
      ? window.AIFS_motion.prefersReduced()
      : window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function canUseWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) {
      return false;
    }
  }

  function canUseThree() {
    return !prefersReduced() && canUseWebGL();
  }

  function isLabFigure(id) {
    return !!LAB_IDS[id];
  }

  function loadThree() {
    if (threePromise) return threePromise;
    threePromise = import(THREE_CDN).catch(function (err) {
      threePromise = null;
      throw err;
    });
    return threePromise;
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function hexToThree(THREE, css, fallback) {
    var raw = (css || fallback || '#3553ff').trim();
    if (raw.charAt(0) !== '#') {
      var probe = document.createElement('div');
      probe.style.color = raw;
      document.body.appendChild(probe);
      var computed = getComputedStyle(probe).color;
      document.body.removeChild(probe);
      var m = computed && computed.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        return new THREE.Color(
          Number(m[1]) / 255,
          Number(m[2]) / 255,
          Number(m[3]) / 255
        );
      }
      raw = fallback || '#3553ff';
    }
    return new THREE.Color(raw);
  }

  function thresholdGate(delta, threshold) {
    if (window.AIFS_motion && window.AIFS_motion.shouldTrail) {
      return window.AIFS_motion.shouldTrail(delta, threshold);
    }
    return Math.abs(delta) >= (threshold == null ? 0.02 : threshold);
  }

  function disposeActive() {
    if (!active) return;
    try {
      if (active.raf) cancelAnimationFrame(active.raf);
      if (active.io) active.io.disconnect();
      if (active.onVis) document.removeEventListener('visibilitychange', active.onVis);
      if (active.onResize) window.removeEventListener('resize', active.onResize);
      if (active.renderer) {
        active.renderer.dispose();
        if (active.renderer.domElement && active.renderer.domElement.parentNode) {
          active.renderer.domElement.parentNode.removeChild(active.renderer.domElement);
        }
      }
      if (active.cleanup) active.cleanup();
    } catch (e) {}
    active = null;
  }

  function makeShell(host, title, hint, caption) {
    host.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'lf mt-lab';
    var head = document.createElement('div');
    head.className = 'lf-head';
    head.innerHTML = '<span class="lf-label">' + title + '</span><span>' + hint + '</span>';
    var body = document.createElement('div');
    body.className = 'lf-body';
    var controls = document.createElement('div');
    controls.className = 'lf-grid';
    var stage = document.createElement('div');
    stage.className = 'mt-stage';
    var out = document.createElement('div');
    out.className = 'lf-out';
    out.appendChild(stage);
    body.appendChild(controls);
    body.appendChild(out);
    var cap = document.createElement('div');
    cap.className = 'lf-cap';
    cap.textContent = caption;
    wrap.appendChild(head);
    wrap.appendChild(body);
    wrap.appendChild(cap);
    host.appendChild(wrap);
    return { controls: controls, stage: stage, out: out };
  }

  function addSlider(controls, label, min, max, step, value, onInput) {
    var row = document.createElement('div');
    row.className = 'lf-ctrl';
    var lab = document.createElement('label');
    var name = document.createTextNode(label);
    var bold = document.createElement('b');
    bold.textContent = String(value);
    lab.appendChild(name);
    lab.appendChild(bold);
    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', function () {
      var v = Number(input.value);
      bold.textContent = String(v);
      onInput(v);
    });
    row.appendChild(lab);
    row.appendChild(input);
    controls.appendChild(row);
    return input;
  }

  function setupRenderer(THREE, stage, width, height) {
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    stage.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = 'auto';
    return renderer;
  }

  function orthoCamera(THREE, w, h) {
    var cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 100);
    cam.position.z = 10;
    return cam;
  }

  function startLoop(handle, renderFn) {
    var running = true;
    var visible = true;
    handle.io = new IntersectionObserver(function (entries) {
      visible = entries[0] && entries[0].isIntersecting;
    }, { threshold: 0.05 });
    if (handle.stage) handle.io.observe(handle.stage);
    handle.onVis = function () {
      running = document.visibilityState !== 'hidden';
    };
    document.addEventListener('visibilitychange', handle.onVis);
    function tick() {
      handle.raf = requestAnimationFrame(tick);
      if (!running || !visible) return;
      renderFn();
    }
    handle.raf = requestAnimationFrame(tick);
  }

  // ── Gradient descent ──────────────────────────────────────────────────────
  function mountGradientDescent(THREE, host) {
    var shell = makeShell(
      host,
      'GRADIENT DESCENT',
      'drag the learning rate',
      'Each step moves downhill by the gradient times the learning rate. Too small and it crawls; too large and it overshoots and diverges. Trails show where the path recently was.'
    );
    var W = 560;
    var H = 240;
    var state = { lr: 0.1, steps: 12, x0: -2.6 };
    var renderer = setupRenderer(THREE, shell.stage, W, H);
    var camera = orthoCamera(THREE, W, H);
    var scene = new THREE.Scene();
    var blueprint = hexToThree(THREE, cssVar('--blueprint', '#3553ff'), '#3553ff');
    var mute = hexToThree(THREE, cssVar('--rule-soft', '#cccccc'), '#cccccc');
    var warn = hexToThree(THREE, cssVar('--warn', '#b8870f'), '#b8870f');

    var curvePts = [];
    for (var i = 0; i <= 120; i++) {
      var x = -3 + 6 * i / 120;
      var sx = (x / 3) * (W * 0.42);
      var sy = -(x * x / 9) * (H * 0.38);
      curvePts.push(new THREE.Vector3(sx, sy, 0));
    }
    var curveGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
    scene.add(new THREE.Line(curveGeo, new THREE.LineBasicMaterial({ color: mute, transparent: true, opacity: 0.55 })));

    var trailGroup = new THREE.Group();
    scene.add(trailGroup);
    var pathGroup = new THREE.Group();
    scene.add(pathGroup);
    var ghostMeshes = [];

    var status = document.createElement('span');
    status.className = 'lf-num';
    var meta = document.createElement('div');
    meta.className = 'lf-meta';
    var formula = document.createElement('div');
    formula.className = 'lf-formula';
    shell.out.appendChild(status);
    shell.out.appendChild(meta);
    shell.out.appendChild(formula);

    function mapX(x) { return (x / 3) * (W * 0.42); }
    function mapY(y) { return -(y / 9) * (H * 0.38); }

    function clearGroup(g) {
      while (g.children.length) {
        var c = g.children[0];
        g.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
    }

    function spawnGhosts(pts, diverged) {
      if (prefersReduced()) return;
      pts.forEach(function (p, idx) {
        if (idx % 2 && idx !== pts.length - 1) return;
        var geo = new THREE.CircleGeometry(idx === pts.length - 1 ? 5 : 3.2, 12);
        var mat = new THREE.MeshBasicMaterial({
          color: diverged ? warn : blueprint,
          transparent: true,
          opacity: 0.28
        });
        var m = new THREE.Mesh(geo, mat);
        m.position.set(mapX(p), mapY(p * p), 0);
        m.userData.age = 0;
        m.userData.life = 0.55 + idx * 0.02;
        trailGroup.add(m);
        ghostMeshes.push(m);
      });
    }

    var prevLr = state.lr;

    function rebuild() {
      clearGroup(pathGroup);
      var xc = state.x0;
      var diverged = false;
      var pts = [];
      for (var t = 0; t <= state.steps; t++) {
        pts.push(xc);
        xc = xc - state.lr * (2 * xc);
        if (Math.abs(xc) > 3.2) { diverged = true; break; }
      }
      var vectors = pts.map(function (xi) {
        return new THREE.Vector3(mapX(xi), mapY(xi * xi), 0);
      });
      if (vectors.length > 1) {
        var line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(vectors),
          new THREE.LineDashedMaterial({
            color: diverged ? warn : blueprint,
            dashSize: 6,
            gapSize: 4,
            transparent: true,
            opacity: 0.95
          })
        );
        line.computeLineDistances();
        pathGroup.add(line);
      }
      pts.forEach(function (xi, idx) {
        var geo = new THREE.CircleGeometry(idx === pts.length - 1 ? 5.5 : 3, 14);
        var mat = new THREE.MeshBasicMaterial({ color: diverged ? warn : blueprint });
        var m = new THREE.Mesh(geo, mat);
        m.position.set(mapX(xi), mapY(xi * xi), 0.1);
        pathGroup.add(m);
      });
      var last = pts[pts.length - 1];
      var conv = !diverged && Math.abs(last) < 0.05;
      status.textContent = diverged ? 'diverged' : (conv ? 'converged' : 'x = ' + last.toFixed(3));
      meta.textContent = diverged
        ? 'lr too large: each step overshoots the minimum and the loss explodes'
        : 'final loss f(x) = ' + (last * last).toFixed(4) + '  ·  ' + state.steps + ' steps';
      formula.textContent = 'x ← x − lr · 2x   (loss f(x) = x²,  diverges when lr > 1)';

      var dLr = state.lr - prevLr;
      if (thresholdGate(dLr, 0.03) || thresholdGate(state.steps, 0)) {
        spawnGhosts(pts, diverged);
      }
      prevLr = state.lr;
    }

    addSlider(shell.controls, 'learning rate', 0.01, 1.2, 0.01, state.lr, function (v) {
      state.lr = v;
      rebuild();
    });
    addSlider(shell.controls, 'steps', 1, 40, 1, state.steps, function (v) {
      state.steps = v;
      rebuild();
    });
    addSlider(shell.controls, 'start x', -2.9, 2.9, 0.1, state.x0, function (v) {
      state.x0 = v;
      rebuild();
    });

    rebuild();

    var handle = {
      renderer: renderer,
      stage: shell.stage,
      cleanup: function () {
        clearGroup(pathGroup);
        clearGroup(trailGroup);
        curveGeo.dispose();
      }
    };
    active = handle;

    var last = performance.now();
    startLoop(handle, function () {
      var now = performance.now();
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (var g = ghostMeshes.length - 1; g >= 0; g--) {
        var mesh = ghostMeshes[g];
        mesh.userData.age += dt;
        var t = mesh.userData.age / mesh.userData.life;
        if (t >= 1) {
          trailGroup.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          ghostMeshes.splice(g, 1);
        } else {
          mesh.material.opacity = 0.32 * (1 - t);
          mesh.scale.setScalar(1 + t * 0.35);
        }
      }
      renderer.render(scene, camera);
    });

    handle.onResize = function () {
      var rect = shell.stage.getBoundingClientRect();
      if (rect.width < 40) return;
      var nh = Math.round(rect.width * (H / W));
      renderer.setSize(rect.width, nh, false);
    };
    window.addEventListener('resize', handle.onResize);
    handle.onResize();
  }

  // ── KV cache ──────────────────────────────────────────────────────────────
  function mountKvCache(THREE, host) {
    var shell = makeShell(
      host,
      'KV-CACHE SIZER',
      'drag the dimensions',
      'The cache holds one key and one value per token, per layer, per kv-head. Ghost bars show the previous size as you drag — motion as the visual of growth.'
    );
    var W = 560;
    var H = 120;
    var GiB = Math.pow(1024, 3);
    var REF = 80;
    var state = { seq: 8192, batch: 8, layers: 32, kvHeads: 8, headDim: 128, dbytes: 2 };
    var renderer = setupRenderer(THREE, shell.stage, W, H);
    var camera = orthoCamera(THREE, W, H);
    var scene = new THREE.Scene();
    var blueprint = hexToThree(THREE, cssVar('--blueprint', '#3553ff'), '#3553ff');
    var warn = hexToThree(THREE, cssVar('--warn', '#b8870f'), '#b8870f');
    var trackCol = hexToThree(THREE, cssVar('--rule-soft', '#ddd'), '#dddddd');

    var track = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.86, 18),
      new THREE.MeshBasicMaterial({ color: trackCol, transparent: true, opacity: 0.35 })
    );
    scene.add(track);

    var barMat = new THREE.MeshBasicMaterial({ color: blueprint });
    var bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 14), barMat);
    bar.position.z = 0.1;
    scene.add(bar);

    var ghostMat = new THREE.MeshBasicMaterial({ color: blueprint, transparent: true, opacity: 0 });
    var ghost = new THREE.Mesh(new THREE.PlaneGeometry(1, 14), ghostMat);
    ghost.position.z = 0.05;
    scene.add(ghost);
    var ghostLife = 0;
    var prevScale = 0.01;

    var num = document.createElement('span');
    num.className = 'lf-num';
    var meta = document.createElement('div');
    meta.className = 'lf-meta';
    var formula = document.createElement('div');
    formula.className = 'lf-formula';
    shell.out.appendChild(num);
    shell.out.appendChild(meta);
    shell.out.appendChild(formula);

    function fmtSeq(n) { return n >= 1024 ? (n / 1024) + 'K' : String(n); }

    function applyBarScale(mesh, scale) {
      var full = W * 0.86;
      mesh.scale.x = Math.max(0.001, scale) * full;
      mesh.position.x = -full / 2 + mesh.scale.x / 2;
    }

    function rebuild() {
      var bytes = 2 * state.layers * state.kvHeads * state.headDim * state.seq * state.batch * state.dbytes;
      var gib = bytes / GiB;
      var pct = Math.min(1, gib / REF);
      var over = gib > REF;
      barMat.color.copy(over ? warn : blueprint);
      applyBarScale(bar, pct);
      if (thresholdGate(pct - prevScale, 0.015)) {
        ghostMat.color.copy(over ? warn : blueprint);
        applyBarScale(ghost, prevScale);
        ghostMat.opacity = 0.4;
        ghostLife = 0.55;
      }
      prevScale = pct;
      num.innerHTML = gib.toFixed(gib < 10 ? 2 : 1) + ' <small>GiB</small>';
      meta.textContent = (over ? 'exceeds ' : '') + Math.round(gib / REF * 100) + '% of one ' + REF + ' GiB GPU';
      formula.textContent = '2 · ' + state.layers + ' layers · ' + state.kvHeads + ' kv-heads · ' + state.headDim +
        ' head-dim · ' + state.seq.toLocaleString('en-US') + ' tokens · ' + state.batch + ' batch · ' + state.dbytes + ' B';
    }

    (function () {
      var row = document.createElement('div');
      row.className = 'lf-ctrl';
      var lab = document.createElement('label');
      lab.appendChild(document.createTextNode('sequence length'));
      var bold = document.createElement('b');
      bold.textContent = fmtSeq(state.seq);
      lab.appendChild(bold);
      var input = document.createElement('input');
      input.type = 'range';
      input.min = '256';
      input.max = '131072';
      input.step = '256';
      input.value = String(state.seq);
      input.addEventListener('input', function () {
        state.seq = Number(input.value);
        bold.textContent = fmtSeq(state.seq);
        rebuild();
      });
      row.appendChild(lab);
      row.appendChild(input);
      shell.controls.appendChild(row);
    })();

    addSlider(shell.controls, 'batch size', 1, 128, 1, state.batch, function (v) { state.batch = v; rebuild(); });
    addSlider(shell.controls, 'layers', 1, 128, 1, state.layers, function (v) { state.layers = v; rebuild(); });
    addSlider(shell.controls, 'kv heads (GQA)', 1, 128, 1, state.kvHeads, function (v) { state.kvHeads = v; rebuild(); });
    addSlider(shell.controls, 'head dim', 32, 256, 8, state.headDim, function (v) { state.headDim = v; rebuild(); });

    rebuild();

    var handle = {
      renderer: renderer,
      stage: shell.stage,
      cleanup: function () {
        track.geometry.dispose();
        track.material.dispose();
        bar.geometry.dispose();
        barMat.dispose();
        ghost.geometry.dispose();
        ghostMat.dispose();
      }
    };
    active = handle;

    var last = performance.now();
    startLoop(handle, function () {
      var now = performance.now();
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (ghostLife > 0) {
        ghostLife -= dt;
        ghostMat.opacity = Math.max(0, ghostLife / 0.55) * 0.4;
      }
      renderer.render(scene, camera);
    });

    handle.onResize = function () {
      var rect = shell.stage.getBoundingClientRect();
      if (rect.width < 40) return;
      renderer.setSize(rect.width, Math.round(rect.width * (H / W)), false);
    };
    window.addEventListener('resize', handle.onResize);
    handle.onResize();
  }

  // ── Softmax temperature ───────────────────────────────────────────────────
  function mountSoftmax(THREE, host) {
    var logits = [3.1, 2.2, 1.5, 0.8, 0.1];
    var labels = ['cat', 'dog', 'fox', 'owl', 'elk'];
    var shell = makeShell(
      host,
      'SOFTMAX TEMPERATURE',
      'drag T',
      'Temperature divides the logits before the exponential. Ghost bars encode the previous distribution so redistribution reads as flow, not a hard cut.'
    );
    var W = 560;
    var H = 200;
    var state = { T: 1.0 };
    var renderer = setupRenderer(THREE, shell.stage, W, H);
    var camera = orthoCamera(THREE, W, H);
    var scene = new THREE.Scene();
    var blueprint = hexToThree(THREE, cssVar('--blueprint', '#3553ff'), '#3553ff');
    var mute = hexToThree(THREE, cssVar('--rule-soft', '#ddd'), '#dddddd');

    var bars = [];
    var ghosts = [];
    var prevP = logits.map(function () { return 0; });
    var rowH = 22;
    var gap = 8;
    var left = -W * 0.42;
    var full = W * 0.78;

    for (var i = 0; i < logits.length; i++) {
      var y = (logits.length / 2 - i - 0.5) * (rowH + gap);
      var track = new THREE.Mesh(
        new THREE.PlaneGeometry(full, rowH),
        new THREE.MeshBasicMaterial({ color: mute, transparent: true, opacity: 0.28 })
      );
      track.position.set(left + full / 2, y, 0);
      scene.add(track);
      var ghostMat = new THREE.MeshBasicMaterial({ color: blueprint, transparent: true, opacity: 0 });
      var ghost = new THREE.Mesh(new THREE.PlaneGeometry(1, rowH - 4), ghostMat);
      ghost.position.set(left, y, 0.05);
      scene.add(ghost);
      ghosts.push({ mesh: ghost, mat: ghostMat, life: 0, y: y });
      var mat = new THREE.MeshBasicMaterial({ color: blueprint });
      var bar = new THREE.Mesh(new THREE.PlaneGeometry(1, rowH - 4), mat);
      bar.position.set(left, y, 0.1);
      scene.add(bar);
      bars.push({ mesh: bar, mat: mat, y: y });
    }

    var meta = document.createElement('div');
    meta.className = 'lf-meta';
    var formula = document.createElement('div');
    formula.className = 'lf-formula';
    var labelsEl = document.createElement('div');
    labelsEl.className = 'mt-softmax-labels';
    shell.out.appendChild(labelsEl);
    shell.out.appendChild(meta);
    shell.out.appendChild(formula);

    function setBarWidth(entry, p) {
      var w = Math.max(0.001, p) * full;
      entry.mesh.scale.x = w;
      entry.mesh.position.x = left + w / 2;
    }

    function rebuild() {
      var T = Math.max(0.05, state.T);
      var ex = logits.map(function (z) { return Math.exp(z / T); });
      var sum = ex.reduce(function (a, b) { return a + b; }, 0);
      var p = ex.map(function (e) { return e / sum; });
      var ent = -p.reduce(function (a, pi) { return a + (pi > 0 ? pi * Math.log2(pi) : 0); }, 0);
      labelsEl.innerHTML = '';
      p.forEach(function (pi, i) {
        if (thresholdGate(pi - prevP[i], 0.012)) {
          setBarWidth(ghosts[i], prevP[i]);
          ghosts[i].mat.opacity = 0.38;
          ghosts[i].life = 0.5;
        }
        setBarWidth(bars[i], pi);
        var row = document.createElement('div');
        row.className = 'mt-softmax-row';
        row.textContent = labels[i] + '  ' + (pi * 100).toFixed(1) + '%';
        labelsEl.appendChild(row);
      });
      prevP = p.slice();
      meta.textContent = 'entropy ' + ent.toFixed(2) + ' bits  ·  ' +
        (T < 0.6 ? 'sharp / confident' : T > 1.6 ? 'flat / random' : 'balanced');
      formula.textContent = 'softmax(zᵢ / T),  T = ' + T.toFixed(2) + '   ·   logits [' + logits.join(', ') + ']';
    }

    addSlider(shell.controls, 'temperature', 0.1, 3.0, 0.05, state.T, function (v) {
      state.T = v;
      rebuild();
    });
    rebuild();

    var handle = {
      renderer: renderer,
      stage: shell.stage,
      cleanup: function () {
        scene.traverse(function (obj) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
    };
    active = handle;

    var last = performance.now();
    startLoop(handle, function () {
      var now = performance.now();
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ghosts.forEach(function (g) {
        if (g.life > 0) {
          g.life -= dt;
          g.mat.opacity = Math.max(0, g.life / 0.5) * 0.38;
        }
      });
      renderer.render(scene, camera);
    });

    handle.onResize = function () {
      var rect = shell.stage.getBoundingClientRect();
      if (rect.width < 40) return;
      renderer.setSize(rect.width, Math.round(rect.width * (H / W)), false);
    };
    window.addEventListener('resize', handle.onResize);
    handle.onResize();
  }

  function mountScene(THREE, host, demoId) {
    disposeActive();
    if (demoId === 'gradient-descent') mountGradientDescent(THREE, host);
    else if (demoId === 'kv-cache-sizer' || demoId === 'kv-cache') mountKvCache(THREE, host);
    else if (demoId === 'softmax-temperature') mountSoftmax(THREE, host);
    else return false;
    host.dataset.lfMounted = '1';
    host.dataset.mtMounted = '1';
    return true;
  }

  function mountLabScene(host, demoId) {
    if (!host || !isLabFigure(demoId)) return Promise.resolve(false);
    if (!canUseThree()) return Promise.resolve(false);
    return loadThree().then(function (THREE) {
      try {
        return mountScene(THREE, host, demoId);
      } catch (e) {
        console.warn('motion-three mount failed:', e);
        disposeActive();
        return false;
      }
    }).catch(function (e) {
      console.warn('Three.js load failed:', e);
      return false;
    });
  }

  function ensureStyles() {
    if (document.getElementById('mt-styles')) return;
    var s = document.createElement('style');
    s.id = 'mt-styles';
    s.textContent = [
      '.mt-stage{position:relative;width:100%;min-height:120px;margin-top:8px}',
      '.mt-stage canvas{display:block;width:100%;height:auto}',
      '.mt-lab .lf-out .lf-num{display:block;margin-top:10px}',
      '.mt-softmax-labels{display:grid;gap:4px;margin-top:10px;font-family:var(--font-mono,monospace);font-size:.72rem;color:var(--ink-soft)}',
      '.lab-figure-host .mt-lab,.lab-figure-host .lf{margin:0;border:none}'
    ].join('\n');
    document.head.appendChild(s);
  }

  window.AIFS_motionThree = {
    canUseThree: canUseThree,
    isLabFigure: isLabFigure,
    loadThree: loadThree,
    mountLabScene: function (host, demoId) {
      ensureStyles();
      return mountLabScene(host, demoId);
    },
    dispose: disposeActive
  };
})();
