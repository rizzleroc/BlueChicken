// CLUCKBOT orchestrator.
// Phases:
//   1. naming      → pick a name
//   2. egg         → warm / cool / turn / tap → grows hatchProgress
//   3. hatch       → ceremony + variant reveal
//   4. chicken     → tamagotchi care loop
//   5. RIP         → death modal
(function(){
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  // DOM refs
  const naming      = $('#naming');
  const nameForm    = $('#nameForm');
  const nameInput   = $('#nameInput');
  const stage       = $('#stage');
  const rip         = $('#rip');
  const ripReset    = $('#ripReset');
  const muteBtn     = $('#muteBtn');
  const habitat     = $('#habitat');
  const floatMsg    = $('#floatMsg');
  const hatchModal  = $('#hatch');
  const variantName = $('#variantName');
  const variantTag  = $('#variantTag');
  const variantSwatch = $('#variantSwatch');
  const hatchContinue = $('#hatchContinue');
  const eggNeeds    = $('#eggNeeds');
  const chickenNeeds= $('#chickenNeeds');
  const eggActions  = $('#eggActions');
  const chickenActions = $('#chickenActions');

  const state = {
    paintedHatch: false,
  };

  // ---- bootstrap ----
  Pet.init();   // loads from localStorage, applies offline decay
  const existing = Pet.get();
  const hasNamed = existing && existing.name && localStorage.getItem('cluckbot.named') === '1';

  if(hasNamed){
    showStage();
  } else {
    naming.classList.remove('hidden');
    naming.setAttribute('aria-hidden', 'false');
    setTimeout(() => nameInput.focus(), 100);
  }

  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (nameInput.value || 'EGG').toUpperCase().slice(0, 12);
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
    PsyAudio.setMuted(true);
    syncPhaseUI();
  }

  function syncPhaseUI(){
    const pet = Pet.get();
    if(!pet) return;
    const isEgg = !!pet.egg;
    eggNeeds.hidden     = !isEgg;
    eggActions.hidden   = !isEgg;
    chickenNeeds.hidden = isEgg;
    chickenActions.hidden = isEgg;
    ChickenPet.setEgg(pet.egg);
    ChickenPet.setVariant(variantFromPet(pet));
  }

  function variantFromPet(pet){
    if(!pet || !pet.variant) return null;
    return (Egg.VARIANTS || []).find(v => v.id === pet.variant) || null;
  }

  // ---- input ----
  window.addEventListener('mousemove', (e) => {
    ChickenPet.setMouse(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    PsyShader.setMouse(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
  }, { passive: true });

  habitat.addEventListener('click', () => {
    const pet = Pet.get();
    if(!pet) return;
    if(pet.egg) doEggAction('tap');
    else doChickenAction('pet');
  });

  // egg + chicken action buttons share .action selector
  document.querySelectorAll('.action').forEach(b => {
    b.addEventListener('click', () => {
      const pet = Pet.get();
      if(!pet) return;
      const act = b.getAttribute('data-action');
      if(pet.egg) doEggAction(act);
      else doChickenAction(act);
    });
  });

  function doEggAction(action){
    const t = performance.now();
    if(action === 'warm'){
      Pet.eggAction('warm');
      ChickenPet.reactWarm(t);
      showFloat('+warmth');
      PsyAudio.pluckCluck();
    } else if(action === 'cool'){
      Pet.eggAction('cool');
      ChickenPet.reactCool(t);
      showFloat('-warmth');
    } else if(action === 'turn'){
      Pet.eggAction('turn');
      ChickenPet.reactTurn(t);
      showFloat('turned');
      PsyAudio.pluckCluck();
    } else if(action === 'tap'){
      Pet.eggAction('tap');
      showFloat('tap');
    }
  }

  function doChickenAction(action){
    const pet = Pet.get();
    if(!pet || pet.isDead) return;
    const now = performance.now();
    let ok = false; let msg = '';
    switch(action){
      case 'feed':
        ok = Pet.feed();
        if(ok){ ChickenPet.reactFeed(now); msg = '+35 hunger'; PsyAudio.pluckCluck(); }
        break;
      case 'play':
        ok = Pet.play();
        if(ok){ ChickenPet.reactPlay(now); msg = '+20 happiness'; PsyAudio.pluckCluck(); }
        else if(pet.energy < 10){ msg = 'too tired to play'; ok = true; }
        break;
      case 'pet':
        ok = Pet.pet();
        if(ok){ ChickenPet.reactPet(now); msg = '+bond'; }
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
        if(ok){ ChickenPet.reactMeds(now); msg = '+40 sanity'; PsyAudio.bigPulse(); }
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

  // mute toggle
  muteBtn.addEventListener('click', () => {
    const m = !PsyAudio.isMuted();
    PsyAudio.setMuted(m);
    muteBtn.textContent = 'SOUND: ' + (m ? 'OFF' : 'ON');
  });

  // RIP flow
  ripReset.addEventListener('click', () => {
    rip.classList.add('hidden');
    rip.setAttribute('aria-hidden', 'true');
    naming.classList.remove('hidden');
    naming.setAttribute('aria-hidden', 'false');
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 100);
  });

  hatchContinue.addEventListener('click', () => {
    hatchModal.classList.add('hidden');
    hatchModal.setAttribute('aria-hidden', 'true');
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

  function showHatch(){
    const pet = Pet.get();
    if(!pet || !pet.variant) return;
    const v = (Egg.VARIANTS || []).find(x => x.id === pet.variant);
    if(!v) return;
    variantName.textContent = v.name;
    variantTag.textContent = v.tagline;
    // build a conic swatch from the variant colors
    const grad = `conic-gradient(${v.colors.concat(v.colors[0]).join(', ')})`;
    variantSwatch.style.setProperty('--swatch', grad);
    variantSwatch.style.background = grad;
    hatchModal.classList.remove('hidden');
    hatchModal.setAttribute('aria-hidden', 'false');
    ChickenPet.triggerHatchBurst();
  }

  function formatAge(secs){
    if(secs < 60) return secs + 's';
    if(secs < 3600) return Math.floor(secs/60) + 'm ' + (secs%60) + 's';
    return Math.floor(secs/3600) + 'h ' + Math.floor((secs%3600)/60) + 'm';
  }

  // ---- main loop ----
  let lastUiUpdate = 0;
  let lastTodUpdate = 0;
  let dayStartTime = Date.now();
  function loop(t){
    requestAnimationFrame(loop);

    Pet.tick(Date.now());
    const pet = Pet.get();
    if(!pet){ return; }

    // detect hatch transition
    if(pet.onHatch && !state.paintedHatch){
      state.paintedHatch = true;
      // sync UI panels to chicken phase
      syncPhaseUI();
      showHatch();
      pet.onHatch = false;
    }

    // ---- world: time of day cycles every ~6 minutes (compressed) ----
    // ALSO match real-world day/night roughly by mixing in clock hour
    const fakeDayPeriodSec = 360;        // 6 minutes per in-game day
    const tod = ((Date.now() - dayStartTime) / 1000 / fakeDayPeriodSec) % 1;
    if(window.World) {
      window.World.setTimeOfDay(tod);
      // weather follows mood: sad/dirty/low-sanity → storm
      const mood = pet.egg
        ? (pet.egg.warmth < 30 ? 0.5 : 0)
        : Math.max(0, (100 - pet.sanity)/200 + (100 - pet.happiness)/300 + (100 - pet.cleanliness)/400);
      window.World.setWeather(Math.min(1, mood));
    }

    // intensity driven by insanity (only chicken phase)
    let intensity = 0;
    if(!pet.egg){
      intensity = (100 - pet.sanity) / 100 * 0.95;
    }
    PsyShader.setIntensity(intensity);
    ChickenPet.setIntensity(intensity);
    PsyAudio.setIntensity(intensity * 0.6);
    PsyShader.setHue((0.78 + Pet.ageSeconds() * 0.001) % 1);

    // mirror egg + variant to renderer
    ChickenPet.setEgg(pet.egg || null);
    if(!pet.egg && pet.variant){
      ChickenPet.setVariant(variantFromPet(pet));
    }

    if(pet){
      ChickenPet.setEggCount(Math.min(pet.eggsLaid, 12));
      ChickenPet.setPoopCount(pet.poops);
      if(pet.onLayEgg){ ChickenPet.reactLayEgg(t); showFloat('🥚 egg laid!'); pet.onLayEgg = false; }
      if(pet.isDead) ChickenPet.setPose('dead');
      else if(pet.isSleeping) ChickenPet.setPose('sleeping');
      else ChickenPet.setPose('idle');
    }

    PsyShader.tick(t);
    ChickenPet.render(t);

    if(t - lastUiUpdate > 150){
      lastUiUpdate = t;
      updateUI();
    }

    if(pet.isDead && !rip.classList.contains('shown')){
      rip.classList.add('shown');
      showRip();
    }
  }
  requestAnimationFrame(loop);

  function updateUI(){
    const pet = Pet.get();
    if(!pet) return;

    $('#petName').textContent = pet.name;
    $('#petStage').textContent = pet.egg ? 'EGG' : Pet.stage();
    $('#petAge').textContent = formatAge(Pet.ageSeconds());
    $('#petVibe').textContent = pet.egg ? Pet.eggVibe() : Pet.vibe();

    if(pet.egg){
      setBar('warmth', pet.egg.warmth);
      setBar('hatch', pet.egg.hatchProgress);
      $('#egg-turns').textContent = pet.egg.turns;
      $('#egg-taps').textContent = pet.egg.taps;
      $('#egg-attention').textContent = pet.egg.attention;
    } else {
      setBar('hunger', pet.hunger);
      setBar('energy', pet.energy);
      setBar('happiness', pet.happiness);
      setBar('cleanliness', pet.cleanliness);
      setBar('sanity', pet.sanity);

      $('#stat-bond').textContent = Math.round(pet.bond);
      $('#stat-eggs').textContent = pet.eggsLaid;
      $('#stat-poops').textContent = pet.poops;
      $('#stat-meals').textContent = pet.timesFed;

      const sleepBtn = document.querySelector('#chickenActions .action[data-action="sleep"]');
      if(sleepBtn) sleepBtn.classList.toggle('active', pet.isSleeping);
      const playBtn = document.querySelector('#chickenActions .action[data-action="play"]');
      if(playBtn) playBtn.disabled = pet.energy < 10 || pet.isSleeping;
      const feedBtn = document.querySelector('#chickenActions .action[data-action="feed"]');
      if(feedBtn) feedBtn.disabled = pet.isSleeping;
    }
  }

  function setBar(name, value){
    const el = document.getElementById('bar-' + name);
    if(!el) return;
    el.style.width = Math.round(value) + '%';
    const parent = el.closest('.need');
    if(parent) parent.classList.toggle('low', value < 30);
  }

})();
