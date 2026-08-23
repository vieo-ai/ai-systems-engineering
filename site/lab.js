(function () {
  'use strict';

  var DEMOS = [
    { id: 'gradient-descent', label: 'Gradient descent', sub: 'drag the learning rate' },
    { id: 'kv-cache-sizer', label: 'KV cache', sub: 'size a GPU cache' },
    { id: 'softmax-temperature', label: 'Softmax', sub: 'temperature vs entropy' }
  ];

  var DAILY = [
    {
      q: 'What does backpropagation compute?',
      options: ['Gradients of the loss w.r.t. each parameter', 'The final softmax probabilities', 'A random initialization seed', 'The batch size for the next epoch'],
      correct: 0,
      explain: 'Backprop applies the chain rule to propagate loss gradients backward through the network.'
    },
    {
      q: 'In scaled dot-product attention, why divide by sqrt(d_k)?',
      options: ['To normalize gradients during backprop', 'To keep dot products from growing too large as dimension increases', 'To convert logits to probabilities', 'To reduce KV cache size'],
      correct: 1,
      explain: 'Without scaling, large d_k makes dot products spike and softmax saturate into one-hot vectors.'
    },
    {
      q: 'A KV cache stores what during autoregressive decoding?',
      options: ['Only the final layer weights', 'Key and value tensors for past tokens so they are not recomputed', 'The entire training dataset', 'Gradient checkpoints from the optimizer'],
      correct: 1,
      explain: 'Each new token attends over cached K/V from prior tokens instead of re-running the full prefix.'
    },
    {
      q: 'What is the main purpose of tokenization?',
      options: ['Compress model weights to int8', 'Split text into discrete units the model can embed', 'Parallelize matrix multiplication on GPU', 'Validate JSON tool schemas'],
      correct: 1,
      explain: 'Tokenizers map raw text to integer IDs that feed the embedding lookup table.'
    },
    {
      q: 'LoRA fine-tunes a model by updating what?',
      options: ['Every weight in every layer', 'Low-rank adapter matrices while freezing base weights', 'Only the tokenizer vocabulary', 'The learning rate schedule'],
      correct: 1,
      explain: 'LoRA injects trainable rank-decomposition matrices alongside frozen pretrained weights.'
    },
    {
      q: 'In an agent loop, what closes the cycle after a tool call?',
      options: ['The user refreshes the browser', 'The model receives tool output and decides the next action', 'The KV cache is flushed', 'The tokenizer re-encodes the system prompt'],
      correct: 1,
      explain: 'Tool results are appended to context; the model reads them and chooses the next step or final answer.'
    },
    {
      q: 'Cross-entropy loss compares what two distributions?',
      options: ['Predicted class probabilities vs one-hot labels', 'Two random Gaussian samples', 'Train vs validation accuracy', 'Embedding cosine similarity scores'],
      correct: 0,
      explain: 'Classification training minimizes the gap between softmax outputs and the true label distribution.'
    },
    {
      q: 'Speculative decoding speeds up inference by doing what?',
      options: ['Skipping attention entirely', 'A small draft model proposes tokens verified in parallel by the target model', 'Quantizing weights to 4-bit at load time', 'Caching the entire prompt in CPU RAM'],
      correct: 1,
      explain: 'Draft tokens are checked in bulk; accepted prefixes skip expensive target-model steps.'
    },
    {
      q: 'RAG retrieval augments generation by injecting what into the prompt?',
      options: ['Random noise for regularization', 'Relevant document chunks from an external index', 'Additional model layers at runtime', 'A second tokenizer pass'],
      correct: 1,
      explain: 'Retrieved passages give the model grounded context it was not trained to memorize.'
    },
    {
      q: 'Why does a learning rate that is too high cause divergence?',
      options: ['The GPU runs out of VRAM', 'Gradient steps overshoot minima and loss oscillates or explodes', 'Softmax returns NaN on the first forward pass', 'The batch norm layers freeze'],
      correct: 1,
      explain: 'Large steps jump past the basin; try it in the lab slider above and watch the path blow up.'
    },
    {
      q: 'GQA (grouped-query attention) reduces memory by doing what?',
      options: ['Sharing fewer KV heads across query heads', 'Removing the softmax entirely', 'Storing weights in fp32 only', 'Batching prompts of unequal length'],
      correct: 0,
      explain: 'Multiple query heads read from the same KV head group, shrinking cache footprint.'
    },
    {
      q: 'MCP (Model Context Protocol) standardizes what for agents?',
      options: ['GPU kernel fusion rules', 'How tools, resources, and prompts are exposed to models', 'Transformer layer ordering', 'Dataset licensing terms'],
      correct: 1,
      explain: 'MCP gives agents a consistent wire format for discovering and calling external capabilities.'
    },
    {
      q: 'Temperature in softmax sampling controls what?',
      options: ['GPU clock speed', 'How peaked or flat the next-token distribution is', 'The number of attention heads', 'Embedding dimension size'],
      correct: 1,
      explain: 'Low temperature sharpens the distribution; high temperature flattens it toward uniform randomness.'
    },
    {
      q: 'The bias-variance tradeoff says that as model complexity rises, what typically happens?',
      options: ['Bias increases and variance decreases', 'Bias decreases but variance may increase', 'Both bias and variance always decrease', 'Neither metric is affected'],
      correct: 1,
      explain: 'Flexible models fit training data tighter (lower bias) but may overfit noise (higher variance).'
    }
  ];

  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function skipLabSwapAnim() {
    return prefersReduced || (window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  }

  function dayIndex() {
    var now = new Date();
    var start = Date.UTC(now.getUTCFullYear(), 0, 0);
    return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - start) / 86400000);
  }

  function mountSvgDemo(host, demoId) {
    if (!host || !window.mountLessonFigures) return;
    if (window.AIFS_motionThree && window.AIFS_motionThree.dispose) {
      window.AIFS_motionThree.dispose();
    }
    host.innerHTML = '';
    host.dataset.figure = demoId;
    host.dataset.mtSkip = '1';
    delete host.dataset.lfMounted;
    delete host.dataset.mtMounted;
    host.removeAttribute('data-lab-error');
    window.mountLessonFigures(host);
    if (!host.dataset.lfMounted) {
      host.setAttribute('data-lab-error', '1');
      host.textContent = 'Could not load the ' + demoId + ' demo. Refresh the page.';
    }
  }

  function mountDemo(host, demoId) {
    if (!host) return;
    delete host.dataset.mtSkip;
    var mt = window.AIFS_motionThree;
    if (mt && mt.canUseThree && mt.canUseThree() && mt.isLabFigure(demoId)) {
      host.innerHTML = '';
      host.dataset.figure = demoId;
      delete host.dataset.lfMounted;
      delete host.dataset.mtMounted;
      host.removeAttribute('data-lab-error');
      mt.mountLabScene(host, demoId).then(function (ok) {
        if (!ok) mountSvgDemo(host, demoId);
      });
      return;
    }
    mountSvgDemo(host, demoId);
  }

  function spawnTabGhost(tabs, buttons, prevIdx) {
    if (!tabs || prefersReduced || skipLabSwapAnim()) return;
    var btn = buttons[prevIdx];
    var indicator = document.getElementById('labTabIndicator');
    if (!btn || !indicator || !window.AIFS_motion || !window.AIFS_motion.spawnTrail) return;
    var ghost = document.createElement('span');
    ghost.className = 'lab-tab-indicator-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = btn.offsetWidth + 'px';
    ghost.style.transform = 'translateX(' + (btn.offsetLeft - tabs.offsetLeft) + 'px)';
    tabs.appendChild(ghost);
    requestAnimationFrame(function () {
      ghost.style.opacity = '0';
    });
    window.setTimeout(function () {
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    }, 520);
  }

  function updateTabIndicator(tabs, buttons, idx) {
    var indicator = document.getElementById('labTabIndicator');
    var btn = buttons[idx];
    if (!indicator || !btn || !tabs) return;
    indicator.style.width = btn.offsetWidth + 'px';
    indicator.style.transform = 'translateX(' + (btn.offsetLeft - tabs.offsetLeft) + 'px)';
  }

  function initSandbox() {
    var host = document.getElementById('labFigureHost');
    var tabs = document.getElementById('labTabs');
    if (!host || !tabs) return;

    var active = 0;
    var html = '<span class="lab-tab-indicator" id="labTabIndicator" aria-hidden="true"></span>';
    for (var i = 0; i < DEMOS.length; i++) {
      html += '<button type="button" class="lab-tab' + (i === 0 ? ' is-active' : '') + '" data-demo="' + i + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">';
      html += '<span class="lab-tab-label">' + DEMOS[i].label + '</span>';
      html += '<span class="lab-tab-sub">' + DEMOS[i].sub + '</span>';
      html += '</button>';
    }
    tabs.innerHTML = html;

    function select(idx, animate) {
      if (idx < 0 || idx >= DEMOS.length) return;
      var buttons = tabs.querySelectorAll('.lab-tab');
      var prev = active;
      var dir = idx > prev ? 1 : idx < prev ? -1 : 0;
      active = idx;

      for (var b = 0; b < buttons.length; b++) {
        var on = b === idx;
        buttons[b].classList.toggle('is-active', on);
        buttons[b].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (animate && dir !== 0) spawnTabGhost(tabs, buttons, prev);
      updateTabIndicator(tabs, buttons, idx);

      if (buttons[idx] && buttons[idx].scrollIntoView) {
        buttons[idx].scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: prefersReduced ? 'auto' : 'smooth' });
      }

      if (!animate || dir === 0 || skipLabSwapAnim()) {
        host.classList.remove('lab-swap-out', 'lab-swap-in', 'lab-swap-in-active', 'lab-swap-smear');
        host.style.removeProperty('--lab-dir');
        mountDemo(host, DEMOS[idx].id);
        return;
      }

      host.style.setProperty('--lab-dir', String(dir));
      host.classList.remove('lab-swap-in', 'lab-swap-in-active');
      host.classList.add('lab-swap-out', 'lab-swap-smear');

      window.setTimeout(function () {
        mountDemo(host, DEMOS[idx].id);
        host.classList.remove('lab-swap-out');
        host.classList.add('lab-swap-in');
        requestAnimationFrame(function () {
          host.classList.add('lab-swap-in-active');
          host.classList.remove('lab-swap-smear');
        });
        window.setTimeout(function () {
          host.classList.remove('lab-swap-in', 'lab-swap-in-active');
        }, 280);
      }, 160);
    }

    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.lab-tab');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-demo'), 10);
      if (isNaN(idx) || idx === active) return;
      select(idx, true);
    });

    window.addEventListener('resize', function () {
      var buttons = tabs.querySelectorAll('.lab-tab');
      updateTabIndicator(tabs, buttons, active);
    });

    select(0, false);
    requestAnimationFrame(function () {
      var buttons = tabs.querySelectorAll('.lab-tab');
      updateTabIndicator(tabs, buttons, 0);
    });
  }

  function initDaily() {
    var root = document.getElementById('dailyChallenge');
    if (!root) return;

    var item = DAILY[dayIndex() % DAILY.length];
    var answered = false;

    var meta = document.createElement('div');
    meta.className = 'daily-meta';
    meta.textContent = '#' + (dayIndex() % DAILY.length + 1) + ' · resets at midnight UTC';

    var question = document.createElement('p');
    question.className = 'daily-q';
    question.textContent = item.q;

    var opts = document.createElement('div');
    opts.className = 'daily-opts';
    opts.setAttribute('role', 'group');
    opts.setAttribute('aria-label', 'Answer choices');

    var feedback = document.createElement('div');
    feedback.className = 'daily-feedback';
    feedback.setAttribute('aria-live', 'polite');

    function reveal(correct) {
      if (answered) return;
      answered = true;
      var buttons = opts.querySelectorAll('.daily-opt');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].disabled = true;
        if (i === item.correct) {
          buttons[i].classList.add('is-correct', 'daily-heat');
          if (window.AIFS_motion && window.AIFS_motion.spawnTrail) {
            window.AIFS_motion.spawnTrail(buttons[i], { dx: 0, dy: -4, opacity: 0.4 });
          }
        } else if (i === correct && correct !== item.correct) {
          buttons[i].classList.add('is-wrong', 'daily-residual');
          if (window.AIFS_motion && window.AIFS_motion.spawnTrail) {
            window.AIFS_motion.spawnTrail(buttons[i], { dx: -6, dy: 0, opacity: 0.3 });
          }
        }
      }
      feedback.textContent = item.explain;
      feedback.classList.add('is-visible');
    }

    for (var o = 0; o < item.options.length; o++) {
      (function (idx) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'daily-opt';
        btn.textContent = item.options[idx];
        btn.addEventListener('click', function () { reveal(idx); });
        opts.appendChild(btn);
      })(o);
    }

    root.appendChild(meta);
    root.appendChild(question);
    root.appendChild(opts);
    root.appendChild(feedback);
  }

  function init() {
    initSandbox();
    initDaily();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
