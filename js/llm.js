// CLUCKBOT brain backend.
// PRIMARY: Chrome's built-in on-device Prompt API (Gemini Nano).
//   - Runs entirely on-device, no network, no API key, no server.
//   - Available on Chrome 138+ with flag enabled, or origin-trial enrolled.
//   - Detection: `'LanguageModel' in self` (modern) or `window.ai?.languageModel`.
// FALLBACK: a curated, context-sensitive thought bank so every visitor sees
//   the chicken thinking even without an LLM.
//
// Output: short first-person chicken thoughts (15-60 chars), pushed into
// Brain.think() and rendered as a speech bubble.
(function(){
  'use strict';

  const state = {
    available: false,
    session: null,
    busy: false,
    backend: 'bank',   // 'prompt-api' | 'bank'
  };

  // ---- thought bank (fallback when no LLM available) -----------------
  // Indexed by mood key. Pick one based on the pet's state.
  const BANK = {
    happy: [
      'the sun is good.',
      'today i am a chicken.',
      'i feel the seeds.',
      'wings? wings.',
      'a perfect breeze.',
      'this is the moment.',
    ],
    hungry: [
      'i would eat... anything.',
      'is that a seed? is that one?',
      'feed me. please.',
      'stomach makes noise.',
      'i dream of grain.',
    ],
    tired: [
      'eyes... heavy.',
      'maybe just one minute.',
      'a quick sit. just a sit.',
      'i could close my eyes.',
    ],
    dirty: [
      'something on my foot.',
      'i smell. i think.',
      'i need a bath.',
    ],
    sad: [
      'no one is looking.',
      'forgotten, i think.',
      'where did everyone go.',
      'is this all there is?',
    ],
    insane: [
      'the walls are listening.',
      'i am the egg AND the chicken.',
      'time is a circle made of beaks.',
      'i can hear the colors.',
      'every grain is god.',
    ],
    sleepy: [
      'zzz... cluck... zzz.',
      'dreaming of a bigger barn.',
      'i am flying. wait. no.',
    ],
    cosmic: [
      'i contain multitudes.',
      'the void is also a chicken.',
      'all is one cluck.',
    ],
    solar: [
      'i am made of fire.',
      'the sun knows my name.',
    ],
    lunar: [
      'soft. quiet. cool.',
      'i prefer the dark.',
    ],
    hyper: [
      'GO GO GO GO',
      'EVERYTHING IS GREAT',
      'I LOVE EVERYTHING',
    ],
    feral: [
      'leave me alone.',
      'i remember nothing.',
      'don\'t touch.',
    ],
    glitch: [
      'cluck.exe has stopped.',
      'i am a recursion.',
      '01100011 01101100 01110101 01100011 01101011',
    ],
    mossy: [
      'i grow slow.',
      'patient. always patient.',
      'the moss agrees with me.',
    ],
    ghost: [
      'am i here?',
      'i exist between blinks.',
    ],
    rainy: [
      'the sky is leaking.',
      'wet feathers, sad chicken.',
    ],
    night: [
      'i see the moon.',
      'the stars are loud tonight.',
      'who hoots?',
    ],
  };

  function pickFromBank(mood){
    const list = BANK[mood] || BANK.happy;
    return list[Math.floor(Math.random() * list.length)];
  }

  function moodKey(pet){
    if(!pet) return 'happy';
    if(pet.isDead) return 'sad';
    if(pet.isSleeping) return 'sleepy';
    if(pet.sanity < 30) return 'insane';
    // weather first
    if(window.World && window.World.weather && window.World.weather() > 0.5) return 'rainy';
    // night-time variant
    if(window.World){
      const t = window.World.timeOfDay();
      if((t < 0.2 || t > 0.85) && Math.random() < 0.3) return 'night';
    }
    if(pet.hunger < 30) return 'hungry';
    if(pet.cleanliness < 30) return 'dirty';
    if(pet.energy < 30) return 'tired';
    if(pet.happiness < 30) return 'sad';
    // variant flavor 30% of the time when happy
    if(pet.happiness > 70 && pet.variant && BANK[pet.variant] && Math.random() < 0.4){
      return pet.variant;
    }
    return 'happy';
  }

  // ---- Prompt API detection + init ----------------------------------
  async function tryInit(){
    try {
      // Modern API (Chrome 138+)
      if(typeof self !== 'undefined' && 'LanguageModel' in self){
        const cap = await self.LanguageModel.availability();
        // cap can be 'available' | 'downloadable' | 'downloading' | 'unavailable'
        if(cap === 'available' || cap === 'downloadable'){
          state.session = await self.LanguageModel.create({
            expectedInputs:  [{ type: 'text', languages: ['en'] }],
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
            initialPrompts: [{
              role: 'system',
              content: `You are CLUCKBOT, a small robot chicken with feelings. You respond with ONE short sentence (max 60 chars) as the chicken thinking aloud. Lowercase. No emojis. Slightly poetic, slightly weird. Stay in character. No quotation marks.`
            }],
          });
          state.available = true;
          state.backend = 'prompt-api';
          return true;
        }
      }
      // Legacy window.ai (older origin trial)
      if(typeof window !== 'undefined' && window.ai && window.ai.languageModel){
        const cap = await window.ai.languageModel.capabilities();
        if(cap.available === 'readily' || cap.available === 'after-download'){
          state.session = await window.ai.languageModel.create({
            systemPrompt: `You are CLUCKBOT, a small robot chicken with feelings. Respond with ONE short sentence (max 60 chars) as the chicken thinking aloud. Lowercase. No emojis. Slightly poetic, slightly weird.`,
          });
          state.available = true;
          state.backend = 'prompt-api';
          return true;
        }
      }
    } catch(e){
      console.warn('LLM init failed', e);
    }
    state.backend = 'bank';
    return false;
  }

  async function generate(prompt){
    if(state.session && !state.busy){
      state.busy = true;
      try {
        const out = await state.session.prompt(prompt);
        return clean(out);
      } catch(e){
        // fall through to bank
      } finally {
        state.busy = false;
      }
    }
    return null;
  }

  function clean(s){
    if(!s) return '';
    return s.replace(/^["'\s]+|["'\s]+$/g, '')
            .replace(/\n.*/s, '')
            .slice(0, 80)
            .toLowerCase();
  }

  // ---- Public API: produce a thought ---------------------------------
  async function thoughtFor(pet){
    const mood = moodKey(pet);
    const ctx = describe(pet, mood);
    let text = null;
    if(state.session){
      text = await generate(`Context: ${ctx}\n\nWhat is the chicken thinking? Reply with ONE short sentence in character.`);
    }
    if(!text) text = pickFromBank(mood);
    return { text, mood, backend: state.backend };
  }

  function describe(pet, mood){
    if(!pet) return 'an empty world';
    if(pet.isDead) return 'you are dead';
    if(pet.egg) return `you are an egg, warmth ${Math.round(pet.egg.warmth)}, hatch ${Math.round(pet.egg.hatchProgress)}%`;
    const parts = [
      `you are a ${pet.variantName || 'robot'} chicken named ${pet.name}`,
      `hunger ${Math.round(pet.hunger)}`,
      `happiness ${Math.round(pet.happiness)}`,
      `sanity ${Math.round(pet.sanity)}`,
      `energy ${Math.round(pet.energy)}`,
    ];
    if(window.World){
      const t = window.World.timeOfDay();
      parts.push(t > 0.85 || t < 0.2 ? 'it is night' : t < 0.35 ? 'sunrise' : t > 0.7 ? 'dusk' : 'daytime');
      if(window.World.weather() > 0.4) parts.push('it is raining');
    }
    return parts.join(', ');
  }

  window.CluckLLM = {
    init: tryInit,
    thoughtFor,
    backend(){ return state.backend; },
    available(){ return state.available; },
  };
})();
