/* sales.jackkeuler.com: shared behaviour for the home and resume pages. Every part checks that its elements
   exist, so the same file runs on both pages. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(id) { return document.getElementById(id); }

  /* ---------- Pause animations (remembered per visitor) ---------- */
  var paused = false;
  try { paused = localStorage.getItem('paused') === '1'; } catch (e) {}
  var motionBtn = $('motionToggle');
  function applyPaused() {
    document.documentElement.classList.toggle('paused', paused);
    if (!motionBtn) return;
    motionBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    var label = paused ? 'Play animations' : 'Pause animations';
    motionBtn.setAttribute('aria-label', label); motionBtn.title = label;
  }
  if (motionBtn) motionBtn.addEventListener('click', function () {
    paused = !paused; applyPaused();
    try { localStorage.setItem('paused', paused ? '1' : '0'); } catch (e) {}
  });
  applyPaused();

  /* ---------- Nav border on scroll, smooth in-page jumps ---------- */
  var nav = $('nav');
  function onScroll() { if (nav) nav.classList.toggle('scrolled', window.scrollY > 8); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  document.querySelectorAll('section.block, .contact').forEach(function (s) { s.style.scrollMarginTop = '72px'; });
  document.querySelectorAll('[data-go]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var t = $(btn.getAttribute('data-go'));
      if (t) t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  });

  /* ---------- Role reels: hero eyebrow and contact headline switch together ---------- */
  var reels = [document.querySelectorAll('#cycler > span'), document.querySelectorAll('#hCycler > span')];
  var ri = 0;
  if (!reduce && (reels[0].length || reels[1].length)) setInterval(function () {
    if (paused) return;
    reels.forEach(function (list) {
      if (!list.length) return;
      list[ri % list.length].classList.remove('on'); list[(ri + 1) % list.length].classList.add('on');
    });
    ri++;
  }, 2400);

  /* ---------- Hero card: walks through the stages of a sale ---------- */
  var STAGES = [
    ['Prospect', 'Find and qualify the right people: leads, referrals and outreach.'],
    ['Discover', 'Ask before pitching: what they need, their budget, their timeline and who decides.'],
    ['Present', 'Recommend the right option and walk through the price in plain terms.'],
    ['Handle objections', 'Answer the real concern behind the question, honestly.'],
    ['Close', 'Agree the terms and ask for the business.'],
    ['Follow up', 'Onboard, check in and keep the relationship, so the customer stays and refers.']
  ];
  var stageNow = $('stageNow'), stageDesc = $('stageDesc'), stageNum = $('stageNum');
  var track = document.querySelectorAll('#stageTrack i');
  if (stageNow && track.length === STAGES.length) {
    var STAGE_MS = 2600, si = 0;
    document.documentElement.style.setProperty('--stage-ms', STAGE_MS + 'ms');
    function showStage(i) {
      stageNow.innerHTML = '<span>' + STAGES[i][0] + '</span>';
      stageDesc.textContent = STAGES[i][1];
      stageNum.textContent = '0' + (i + 1) + ' / 0' + STAGES.length;
      for (var k = 0; k < track.length; k++) {
        track[k].className = k < i ? 'done' : k === i ? 'on' : '';
        if (k === i) { void track[k].offsetWidth; }   // restart the fill animation
      }
    }
    showStage(0);
    if (reduce) { for (var k = 0; k < track.length; k++) track[k].className = 'done'; }
    else {
      // advance when the current stage's bar finishes filling (pauses with the page's pause button)
      track.forEach(function (bar) {
        bar.addEventListener('animationend', function () { si = (si + 1) % STAGES.length; showStage(si); });
      });
    }
  }

  /* ---------- Scroll reveal: only items below the fold, which stay readable ---------- */
  if (!reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    var vh = window.innerHeight;
    document.querySelectorAll('.reveal').forEach(function (el) {
      if (el.getBoundingClientRect().top > vh * 0.92) { el.classList.add('pre'); io.observe(el); }
    });
    var steps = $('steps');
    if (steps && steps.getBoundingClientRect().top > vh * 0.9) {
      steps.style.setProperty('--progress', '0');
      var so = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { steps.style.setProperty('--progress', '1'); so.disconnect(); }
      }, { threshold: 0.4 });
      so.observe(steps);
    }
  }

  /* ---------- Copy buttons ---------- */
  function copyText(text, onOk, onFail) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(onOk, onFail);
      else onFail();
    } catch (e) { onFail(); }
  }
  var live = $('liveMsg');
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      copyText(b.getAttribute('data-copy'), function () {
        b.textContent = 'Copied'; b.classList.add('done');
        if (live) live.textContent = 'Link copied to clipboard';
        setTimeout(function () { b.textContent = 'Copy'; b.classList.remove('done'); }, 1600);
      }, function () { b.textContent = 'Select to copy'; });
    });
  });

  /* ---------- Resume page: copy as text, print / save as PDF ---------- */
  var copyResume = $('copyResume'), status = $('copyStatus');
  if (copyResume) copyResume.addEventListener('click', function () {
    var text = $('resumeSheet').innerText.replace(/\n{3,}/g, '\n\n').trim();
    copyText(text, function () { status.textContent = 'Copied. Paste it into any application form.'; },
      function () { status.textContent = 'Your browser blocked copying. Select the resume text below instead.'; });
  });
  var printBtn = $('printResume');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
})();
