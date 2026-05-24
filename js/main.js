// CLUCKBOT — Tamagotchi orchestrator.
// Connects Pet (state), ChickenPet (renderer), PsyShader (background),
// PsyAudio (ambient), and the DOM UI.
(function(){
  'use strict';

  // ---- DOM ----
  const $ = (sel) => document.querySelector(sel);
  const naming   = $('#naming');
  const nameForm = $('#nameForm');
  const nameInput = $('#nameInput');
  const stage    = $('#stage');
  const rip      = $('#rip');
  const ripReset = $('#ripReset');
  const muteBtn  = $('#muteBtn');
  const habitat  = $('#habitat');
  const floatMsg = $('#floatMsg');

  // ---- bootstrap ----
  // If pet exists in storage, show stage immediately. Otherwise show naming.
  const existing = Pet.get() || (function(){
    // try silent load first
    const tmpName = null;
    Pet.init(tmpName);
    const p = Pet.get();
    if(p && p.name && p.name !== 'CLUCK') return p;
    // try localStorage detection
    try {
      const raw = localStorage.getItem('cluckbot.v1');
      if(raw) return JSON.parse(raw);
    } catch(e){}
    return null;
  })();

  const hasNamed = existing && existing.name && localStorage.getItem('cluckbot.named') === '1';

  if(hasNamed){
    Pet.init();
    showStage();
  } else {
    // first-time visit
    naming.classList.remove('hidden');
    naming.setAttribute('aria-hidden', 'false');
    setTimeout(() => nameInput.focus(), 100);
  }

  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (nameInput.value || 'CLUCK').toUpperCase().slice(0, 12);
    Pet.reset(name);
    localStorage.setItem('cluckbot.named', '1');
    naming.classList.add('hidden');
    naming.setAttribute('aria-hidden', 'true');
    showStage();
  });

  function showStage(){
    stage.classList.remove('hidden');
    stage.setAttribute('aria-hidden', 'false');
    ChickenPet.enable();
    PsyAudio.start();
    PsyAudio.setMuted(true);  // default muted; user can unmute
  }

  // ---- input plumbing ----
  window.addEventListener('mousemove', (e) => {
    ChickenPet.setMouse(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    PsyShader.setMouse(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
  }, { passive: true });

  // click the chicken/habitat = pet it
  habitat.addEventListener('click', () => doAction('pet'));

  // ---- actions ----
  const actionBtns = document.querySelectorAll('.action');
  actionBtns.forEach(b => {
    b.addEventListener('click', () => doAction(b.getAttribute('data-action')));
  });

  function doAction(action){
    const pet = Pet.get();
    if(!pet || pet.isDead) return;
    const now = performance.now();
    let ok = false; let msg = '';
    switch(action){
      case 'feed':
        ok = Pet.feed();
        if(ok){ ChickenPet.reactFeed(now); msg = `+35 hunger`; PsyAudio.pluckCluck(); }
        break;
      case 'play':
        ok = Pet.play();
        if(ok){ ChickenPet.reactPlay(now); msg = `+20 happiness`; PsyAudio.pluckCluck(); }
        else if(pet.energy < 10){ msg = 'too tired to play'; ok = true; }
        break;
      case 'pet':
        ok = Pet.pet();
        if(ok){ ChickenPet.reactPet(now); msg = `+bond`; }
        break;
      case 'clean':
        ok = Pet.clean();
        if(ok){ msg = pet.poops > 0 ? 'poop cleared' : 'tidied up'; PsyAudio.pluckCluck(); }
        break;
      case 'sleep':
        ok = Pet.sleep();
        if(ok){
          ChickenPet.setPose(pet.isSleeping ? 'sleeping' : 'idle');
          msg = pet.isSleeping ? 'good night' : 'woke up';
        }
        break;
      case 'medicate':
        ok = Pet.medicate();
        if(ok){ ChickenPet.reactMeds(now); msg = `+40 sanity`; PsyAudio.bigPulse(); }
        break;
    }
    if(ok) showFloat(msg);
  }

  let floatTimer = null;
  function showFloat(text){
    floatMsg.textContent = text;
    floatMsg.classList.add('show');
    clearTimeout(floatTimer);
    floatTimer = setTimeout(() => floatMsg.classList.remove('show'), 1100);
  }

  // ---- mute toggle ----
  muteBtn.addEventListener('click', () => {
    const m = !PsyAudio.isMuted();
    PsyAudio.setMuted(m);
    muteBtn.textContent = 'SOUND: ' + (m ? 'OFF' : 'ON');
  });

  // ---- RIP flow ----
  ripReset.addEventListener('click', () => {
    rip.classList.add('hidden');
    rip.setAttribute('aria-hidden', 'true');
    naming.classList.remove('hidden');
    naming.setAttribute('aria-hidden', 'false');
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 100);
  });

  function showRip(){
    const pet = Pet.get();
    if(!pet || !pet.isDead) return;
    $('#ripName').textContent = pet.name;
    $('#ripStage').textContent = Pet.stage();
    $('#ripAge').textContent = formatAge(Pet.ageSeconds());
    $('#ripCause').textContent = pet.causeOfDeath || 'unknown';
    $('#ripFeeds').textContent = pet.timesFed;
    $('#ripPlays').textContent = pet.timesPlayed;
    $('#ripEggs').textContent = pet.eggsLaid;
    rip.classList.remove('hidden');
    rip.setAttribute('aria-hidden', 'false');
  }

  function formatAge(secs){
    if(secs < 60) return secs + 's';
    if(secs < 3600) return Math.floor(secs/60) + 'm ' + (secs%60) + 's';
    return Math.floor(secs/3600) + 'h ' + Math.floor((secs%3600)/60) + 'm';
  }

  // ---- main loop ----
  let lastUiUpdate = 0;
  function loop(t){
    requestAnimationFrame(loop);

    // tick pet
    const now = Date.now();
    Pet.tick(now);
    const pet = Pet.get();

    // drive shader intensity from sanity (and a touch of mouse-over-chicken)
    if(pet){
      const insanity = (100 - pet.sanity) / 100;
      const intensity = insanity * 0.95;
      PsyShader.setIntensity(intensity);
      ChickenPet.setIntensity(intensity);
      PsyAudio.setIntensity(insanity * 0.6);

      // hue drifts slowly
      PsyShader.setHue((0.78 + Pet.ageSeconds() * 0.001) % 1);

      // egg + poop counts
      ChickenPet.setEggCount(Math.min(pet.eggsLaid, 12));
      ChickenPet.setPoopCount(pet.poops);

      // lay-egg reaction (transient flag)
      if(pet.onLayEgg){
        ChickenPet.reactLayEgg(t);
        showFloat('🥚 egg laid!');
        pet.onLayEgg = false;
      }

      // pose
      if(pet.isDead) ChickenPet.setPose('dead');
      else if(pet.isSleeping) ChickenPet.setPose('sleeping');
      else ChickenPet.setPose('idle');
    }

    // render
    PsyShader.tick(t);
    ChickenPet.render(t);

    // UI updates every ~150ms
    if(t - lastUiUpdate > 150){
      lastUiUpdate = t;
      updateUI();
    }

    // check death
    if(pet && pet.isDead && !rip.classList.contains('shown')){
      rip.classList.add('shown');
      showRip();
    }
  }
  requestAnimationFrame(loop);

  function updateUI(){
    const pet = Pet.get();
    if(!pet) return;

    $('#petName').textContent = pet.name;
    $('#petStage').textContent = Pet.stage();
    $('#petAge').textContent = formatAge(Pet.ageSeconds());
    $('#petVibe').textContent = Pet.vibe();

    setBar('hunger', pet.hunger);
    setBar('energy', pet.energy);
    setBar('happiness', pet.happiness);
    setBar('cleanliness', pet.cleanliness);
    setBar('sanity', pet.sanity);

    $('#stat-bond').textContent = Math.round(pet.bond);
    $('#stat-eggs').textContent = pet.eggsLaid;
    $('#stat-poops').textContent = pet.poops;
    $('#stat-meals').textContent = pet.timesFed;

    // toggle sleep button active state
    document.querySelector('.action[data-action="sleep"]').classList.toggle('active', pet.isSleeping);
    // disable play if too tired
    document.querySelector('.action[data-action="play"]').disabled = pet.energy < 10 || pet.isSleeping;
    document.querySelector('.action[data-action="feed"]').disabled = pet.isSleeping;
  }

  function setBar(name, value){
    const el = document.getElementById('bar-' + name);
    if(!el) return;
    el.style.width = Math.round(value) + '%';
    const parent = el.closest('.need');
    parent.classList.toggle('low', value < 30);
  }

})();
