// The chicken's BRAIN: autonomous behavior driven by needs + personality
// + the world around it. The chicken walks, pecks, naps, waves at the
// mouse, dances when happy, cowers when scared, yawns when tired,
// stretches after sleeping, bows when greeted, sneezes randomly.
(function(){
  'use strict';

  // Pose list (rendered specially by chicken.js):
  //   idle, walking, pecking, looking, sitting, sleeping,
  //   preening, celebrating, yawning, stretching, waving, bowing,
  //   dancing, cowering, surprised, sneezing
  const brain = {
    x: 0.5,
    targetX: 0.5,
    facing: 1,
    pose: 'idle',
    poseUntil: 0,
    nextDecisionAt: 0,
    speed: 0.0007,
    walkPhase: 0,
    blink: { open: 1, nextBlinkAt: 0, until: 0 },
    headLook: { x: 0, y: 0 },
    headLookTarget: { x: 0, y: 0 },
    gazeLinger: 0,                  // 0..1 — lingers after eye contact
    thought: '',
    thoughtUntil: 0,
    mouseX: 0.5, mouseY: 0.5,
    lastMouseAt: 0,
    lastReactedToMouseAt: 0,
    // tab visibility tracking for greeting
    lastVisibleAt: Date.now(),
    pendingGreeting: false,
    // micro-life schedule (idle fidgets between decisions)
    nextMicroAt: 0,
  };

  // visibility listener — record the moment we go away
  document.addEventListener('visibilitychange', () => {
    if(document.hidden){
      brain.lastVisibleAt = Date.now();
    } else {
      const away = Date.now() - brain.lastVisibleAt;
      // 5+ seconds away → greeting; longer → bigger
      if(away > 5000){
        brain.pendingGreeting = away > 300000 ? 'big' : 'small';
      }
    }
  });

  function tick(t, pet){
    if(!pet || pet.egg || pet.isDead){
      brain.pose = pet && pet.isDead ? 'dead' : 'idle';
      return;
    }
    if(pet.isSleeping){
      brain.pose = 'sleeping';
      return;
    }

    // smooth head-look toward mouse with gaze-lingering.
    // when the mouse has been still for ~600ms, the chicken locks on for a
    // beat (gazeLinger ramps to 1), then deliberately drifts away (target
    // moves to a neutral resting spot for ~1.5s, then re-locks).
    const mouseStillFor = t - (brain.lastMouseAt || t);
    if(mouseStillFor < 400){
      // mouse moving — track immediately
      brain.headLookTarget.x = brain.mouseX - 0.5;
      brain.headLookTarget.y = brain.mouseY - 0.5;
      brain.gazeLinger = 0;
    } else if(brain.gazeLinger < 1){
      // mouse settled — lock on (recognition cue at threshold)
      const wasUnder = brain.gazeLinger < 0.05;
      brain.headLookTarget.x = brain.mouseX - 0.5;
      brain.headLookTarget.y = brain.mouseY - 0.5;
      brain.gazeLinger = Math.min(1, brain.gazeLinger + 0.005);
      if(wasUnder && brain.gazeLinger >= 0.05){
        if(window.MicroAudio) window.MicroAudio.recogTrill();
      }
    } else if(brain.gazeLinger < 2){
      // deliberately look away for a beat
      brain.headLookTarget.x = (brain.mouseX - 0.5) * 0.2;
      brain.headLookTarget.y = (brain.mouseY - 0.5) * 0.2;
      brain.gazeLinger += 0.004;
      if(brain.gazeLinger >= 2) brain.gazeLinger = 0;
    }
    brain.headLook.x += (brain.headLookTarget.x - brain.headLook.x) * 0.06;
    brain.headLook.y += (brain.headLookTarget.y - brain.headLook.y) * 0.06;

    // blink loop
    if(t > brain.blink.nextBlinkAt){
      brain.blink.until = t + 120;
      brain.blink.nextBlinkAt = t + 2400 + Math.random() * 3500;
      // tiny audible 'tk' for eye physicality
      if(window.MicroAudio) window.MicroAudio.blinkTick();
    }
    brain.blink.open = t < brain.blink.until ? 0 : 1;

    // react to mouse nearby — bold chickens approach, shy ones cower
    const dx = Math.abs(brain.mouseX - (0.15 + brain.x * 0.7));
    const mouseNearby = dx < 0.06 && brain.mouseY > 0.55;
    if(mouseNearby && t - brain.lastReactedToMouseAt > 4000){
      const p = pet.personality || {};
      brain.lastReactedToMouseAt = t;
      if((p.bold || 0) > 15){
        // bold chicken hops / bows
        brain.pose = (p.affection || 0) > 10 ? 'bowing' : 'waving';
        brain.poseUntil = t + 1100;
        brain.nextDecisionAt = brain.poseUntil + 200;
      } else if((p.bold || 0) < -15){
        // shy chicken cowers
        brain.pose = 'cowering';
        brain.poseUntil = t + 1300;
        brain.nextDecisionAt = brain.poseUntil + 400;
      } else {
        // neutral chicken surprised
        brain.pose = 'surprised';
        brain.poseUntil = t + 700;
        brain.nextDecisionAt = brain.poseUntil + 300;
      }
    }

    // walking toward target
    if(brain.pose === 'walking'){
      const d = brain.targetX - brain.x;
      const ad = Math.abs(d);
      if(ad < 0.01){
        brain.pose = 'idle';
        brain.poseUntil = t + 600 + Math.random() * 600;
      } else {
        const dt = brain._lastT ? (t - brain._lastT) : 16;
        const step = brain.speed * dt;
        brain.x += Math.sign(d) * Math.min(ad, step);
        brain.facing = d > 0 ? 1 : -1;
        brain.walkPhase += dt * 0.008;
      }
    }
    brain._lastT = t;

    // pending tab-return greeting
    if(brain.pendingGreeting && brain.pose === 'idle'){
      const big = brain.pendingGreeting === 'big';
      brain.pose = big ? 'celebrating' : 'waving';
      brain.poseUntil = t + (big ? 1600 : 900);
      brain.nextDecisionAt = brain.poseUntil + 200;
      brain.pendingGreeting = false;
      think(big ? 'you came back!' : 'oh, hello.', 3000);
      return;
    }

    // micro-life fidgets during long idle stretches
    if(brain.pose === 'idle' && t > brain.nextMicroAt){
      const fidgets = ['look-away', 'shoulder', 'breath-hold', 'toe-tap', 'wattle-swallow', 'aborted-step'];
      const pick = fidgets[Math.floor(Math.random() * fidgets.length)];
      doMicro(pick, t);
      // enforce silence gap (1.5s+ between micro-fidgets per design guidance)
      brain.nextMicroAt = t + 1800 + Math.random() * 2200;
    }

    if(t < brain.nextDecisionAt && brain.pose !== 'idle') return;
    if(brain.pose === 'idle' && t < brain.poseUntil) return;

    decideNext(t, pet);
  }

  // micro-fidgets — small idle behaviors, each <500ms
  function doMicro(kind, t){
    switch(kind){
      case 'look-away':
        brain.headLookTarget.x = (Math.random() - 0.5) * 0.6;
        brain.headLookTarget.y = -0.1 + Math.random() * 0.2;
        break;
      case 'shoulder':
        brain.pose = 'preening';
        brain.poseUntil = t + 450;
        brain.nextDecisionAt = brain.poseUntil + 100;
        break;
      case 'breath-hold':
        // (handled in chicken renderer via breath phase nudge — no op here,
        // but reserving the slot keeps the silence-gap pacing consistent.)
        break;
      case 'toe-tap':
        brain.facing = brain.facing;     // no-op; reserved for future leg cycle
        break;
      case 'wattle-swallow':
        // a small head bob — manipulate the head spring by nudging the
        // headLookTarget vertically and snapping back next frame.
        brain.headLookTarget.y -= 0.05;
        setTimeout(() => { brain.headLookTarget.y += 0.05; }, 120);
        break;
      case 'aborted-step':
        // pick a direction, take a tiny step, then snap back.
        const dir = Math.random() > 0.5 ? 1 : -1;
        brain.targetX = brain.x + dir * 0.02;
        brain.pose = 'walking';
        brain.facing = dir;
        brain.poseUntil = t + 300;
        brain.nextDecisionAt = brain.poseUntil + 150;
        if(window.MicroAudio) window.MicroAudio.unsure();
        break;
    }
  }

  function decideNext(t, pet){
    const p = pet.personality || {};
    const bold      = p.bold || 0;
    const affection = p.affection || 0;
    const playful   = p.playful || 0;
    const calm      = p.calm || 0;
    const cheer     = p.cheer || 0;

    // weights — needs + personality both matter
    const w = {
      wander:     3.5 + Math.max(0, bold) * 0.04 + (pet.energy > 50 ? 1 : 0),
      peck:       (pet.hunger < 50 ? 3 : 1.5) + Math.max(0, playful) * 0.02,
      look:       1.2 + Math.max(0, affection) * 0.04,
      sit:        (pet.energy < 35 ? 2 : 0.4) + Math.max(0, -playful) * 0.03,
      preen:      0.8 + Math.max(0, affection) * 0.02,
      celebrate:  (pet.happiness > 75 ? 1 : 0.2) + Math.max(0, cheer) * 0.04,
      yawn:       pet.energy < 50 ? 0.8 : 0.2,
      stretch:    pet.energy > 70 ? 0.7 : 0.3,
      dance:      Math.max(0, playful) * 0.05 + Math.max(0, cheer) * 0.03,
      bow:        Math.max(0, affection) * 0.04,
      sneeze:     0.25,
    };
    if(window.World){
      const tod = window.World.timeOfDay();
      if(tod < 0.18 || tod > 0.85) w.sit *= 2.5;
    }
    // anxious chickens look around more, dance less
    if(calm < -15){ w.look *= 2; w.dance *= 0.3; }
    // lazy chickens sit more, wander less
    if(playful < -15){ w.sit *= 2; w.wander *= 0.5; }
    // grumpy chickens preen more (turn inward)
    if(cheer < -15){ w.preen *= 2; w.celebrate *= 0.3; }

    const total = Object.values(w).reduce((a,b) => a + b, 0);
    let pick = Math.random() * total;
    let chosen = 'wander';
    for(const k in w){
      pick -= w[k];
      if(pick <= 0){ chosen = k; break; }
    }

    setPose(chosen, t);
  }

  function setPose(name, t){
    brain.pose = name;
    switch(name){
      case 'wander':
        brain.targetX = 0.18 + Math.random() * 0.64;
        brain.pose = 'walking';
        brain.nextDecisionAt = t + 6000;
        return;
      case 'peck':     brain.pose='pecking';   brain.poseUntil = t + 900 + Math.random()*600; break;
      case 'look':     brain.pose='looking';   brain.facing = Math.random()>0.5?1:-1;
                       brain.poseUntil = t + 1400 + Math.random()*1200; break;
      case 'sit':      brain.pose='sitting';   brain.poseUntil = t + 3000 + Math.random()*4000; break;
      case 'preen':    brain.pose='preening';  brain.poseUntil = t + 1600; break;
      case 'celebrate':brain.pose='celebrating';brain.poseUntil = t + 1200; break;
      case 'yawn':     brain.pose='yawning';   brain.poseUntil = t + 1200;
                       if(window.MicroAudio) window.MicroAudio.breath();
                       break;
      case 'stretch':  brain.pose='stretching';brain.poseUntil = t + 1400;
                       if(window.MicroAudio) window.MicroAudio.breath();
                       break;
      case 'dance':    brain.pose='dancing';   brain.poseUntil = t + 2200; break;
      case 'bow':      brain.pose='bowing';    brain.poseUntil = t + 1100; break;
      case 'sneeze':   brain.pose='sneezing';  brain.poseUntil = t + 500; break;
    }
    brain.nextDecisionAt = brain.poseUntil + 200;
  }

  function think(text, ms){
    brain.thought = text;
    brain.thoughtUntil = performance.now() + (ms || 5000);
  }

  function setMouse(x, y){
    // only count it as 'moved' if it actually moved
    if(Math.abs(brain.mouseX - x) > 0.001 || Math.abs(brain.mouseY - y) > 0.001){
      brain.lastMouseAt = performance.now();
    }
    brain.mouseX = x; brain.mouseY = y;
  }

  function react(name, t){
    // external nudges from actions
    if(name === 'pet')  setPose('bow', t || performance.now());
    if(name === 'feed') setPose('peck', t || performance.now());
    if(name === 'play') setPose('dance', t || performance.now());
    if(name === 'meds') setPose('surprised', t || performance.now());
    if(name === 'wake') setPose('stretch', t || performance.now());
  }

  window.Brain = {
    tick, think, setMouse, react,
    state(){ return brain; },
    x(){ return brain.x; },
    facing(){ return brain.facing; },
    pose(){ return brain.pose; },
    walkPhase(){ return brain.walkPhase; },
    thought(){ return performance.now() < brain.thoughtUntil ? brain.thought : ''; },
    blinkOpen(){ return brain.blink.open; },
    headLook(){ return brain.headLook; },
    clearThought(){ brain.thought = ''; brain.thoughtUntil = 0; },
  };
})();
