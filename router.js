// router.js
// -----------------------------------------------------------------------------
// Top-level shell. Two responsibilities:
//   1. Toggle which iframe is visible (V1 Cluckbot main view <-> 3D Realm).
//   2. Bridge state between the two apps. V1 writes its pet to
//      localStorage("cluckbot.v1"); we poll its eggsLaid count and, when it
//      goes up, signal the Realm via "bluechicken/egg-pipeline/v1" so the
//      Realm spawns the next prize-hatchling egg.
//
// We chose iframes (rather than mounting both apps in the same document) so
// V1's globals (Pet, Chicken, Brain, ...) don't collide with the Realm's
// module-scoped state. localStorage is shared across same-origin iframes, so
// it's the cheapest IPC available.

(() => {
  const btnMain  = document.getElementById("btn-main");
  const btnRealm = document.getElementById("btn-realm");
  const frameMain  = document.getElementById("frame-main");
  const frameRealm = document.getElementById("frame-realm");
  const eggNotice  = document.getElementById("egg-notice");
  const eggNoticeText = document.getElementById("egg-notice-text");
  const eggNoticeGo   = document.getElementById("egg-notice-go");

  // ---- View toggle --------------------------------------------------------
  function showView(name) {
    if (name === "realm") {
      document.body.classList.add("show-realm");
      btnMain.classList.remove("active");
      btnRealm.classList.add("active");
    } else {
      document.body.classList.remove("show-realm");
      btnMain.classList.add("active");
      btnRealm.classList.remove("active");
    }
  }
  btnMain.onclick  = () => showView("main");
  btnRealm.onclick = () => showView("realm");

  // ---- V1 → Realm egg pipeline -------------------------------------------
  // V1 increments pet.eggsLaid whenever Cluckbot lays an egg (see
  // main/js/pet.js). We track how many we've already piped into the Realm
  // in localStorage under PIPE_KEY; whenever V1's count gets ahead, we
  // write a signal at SIGNAL_KEY that the Realm watches.
  const V1_KEY     = "cluckbot.v1";
  const PIPE_KEY   = "bluechicken/egg-pipeline/v1";  // { piped: <count> }
  const SIGNAL_KEY = "bluechicken/egg-pipeline/signal"; // { ts, delta }

  function readV1Eggs() {
    try {
      const raw = localStorage.getItem(V1_KEY);
      if (!raw) return 0;
      const pet = JSON.parse(raw);
      return pet && typeof pet.eggsLaid === "number" ? pet.eggsLaid : 0;
    } catch (_) { return 0; }
  }
  function readPiped() {
    try {
      const raw = localStorage.getItem(PIPE_KEY);
      if (!raw) return 0;
      return JSON.parse(raw).piped || 0;
    } catch (_) { return 0; }
  }
  function writePiped(n) {
    localStorage.setItem(PIPE_KEY, JSON.stringify({ piped: n }));
  }
  function signalRealm(delta) {
    localStorage.setItem(SIGNAL_KEY, JSON.stringify({ ts: Date.now(), delta }));
  }

  function flashNotice(text) {
    eggNoticeText.textContent = text;
    eggNotice.classList.add("show");
    clearTimeout(flashNotice._t);
    flashNotice._t = setTimeout(() => eggNotice.classList.remove("show"), 6500);
  }
  eggNoticeGo.onclick = () => {
    eggNotice.classList.remove("show");
    showView("realm");
  };

  // Poll every 2s. V1 only lays roughly once per real-time hour at its base
  // rate, so this is plenty responsive.
  function pollPipeline() {
    const eggs  = readV1Eggs();
    const piped = readPiped();
    const delta = eggs - piped;
    if (delta > 0) {
      signalRealm(delta);
      writePiped(eggs);
      flashNotice(
        delta === 1
          ? "Blue laid an egg — it's in the Realm."
          : `Blue laid ${delta} eggs — they're in the Realm.`
      );
    }
  }
  setInterval(pollPipeline, 2000);
  // First read on boot — if V1 already laid while the page was closed, we
  // still want the Realm to receive them. Don't flash the notice for the
  // initial reconciliation (that'd feel spammy on every reload).
  (function initialReconcile() {
    const eggs  = readV1Eggs();
    const piped = readPiped();
    if (eggs > piped) {
      signalRealm(eggs - piped);
      writePiped(eggs);
    }
  })();
})();
