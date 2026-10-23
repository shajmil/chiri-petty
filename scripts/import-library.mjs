// Builds the sound library from the clip list in this file.
// Each clip is downloaded from its GitHub repository (through the jsDelivr mirror) or Wikimedia Commons,
// or read from the local malayalam-memes/ folder, then
// trimmed to at most 4.5 seconds, converted to mono 22.05 kHz WAV and peak-normalized.
// Local clips are files the project owner saved themselves as malayalam-memes/<id>.mp3 (or .wav/.ogg/.m4a);
// this script never downloads from Myinstants, whose terms forbid downloading and redistribution.
// A local clip whose file is missing is skipped, and its world stays hidden until a file is added.
// src/game/library.json records every clip's source, declared repository licence and file hashes,
// so a clip can be traced and removed quickly if a rights holder asks.
// Run: node scripts/import-library.mjs   (needs network access and Edge or BROWSER_PATH)
// Finished files are kept, so a run interrupted by rate limits can simply be repeated.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const MAX_SECONDS = 4.5;
const SAMPLE_RATE = 22050;
const OUTPUT_FOLDER = 'public/audio/library';

const REPOSITORIES = {
  '3kh0': { repo: '3kh0/soundboard', branch: 'main' },
  pareekshith: { repo: 'PareekshithPalat/IDE-Error-Soundboard', branch: 'main' },
  evansuong: { repo: 'evansuong/Meme-Soundboard-Webpage', branch: 'master' },
  fazal: { repo: 'Fazalhasann/Fazals-Meme-SoundBoard', branch: 'master' },
  bytevictor: { repo: 'bytevictor/FAAAAH-meme-sound-multiplatform', branch: 'master' },
  jimmytop: { repo: 'jimmytop/soundmachine', branch: 'main' },
  emanuel: { repo: 'EmanuelJrc/WeeBoard', branch: 'main' },
};
const JIMMY = '/src/soundfiles/sounds';
const LOCAL_FOLDER = 'malayalam-memes';
const MYINSTANTS = 'https://www.myinstants.com/en/instant';

// [id, source, path, world, title, phrase to imitate, difficulty]
// For local clips the path is the page the file came from, recorded as its source.
// Left out for a family audience: fuckin-flavour, verpiss-dik, angela-merkel-du-fresse, canabis-reicht-nicht.
const CLIPS = [
  ['avante-montha', 'local', `${MYINSTANTS}/avante-montha-14511/`, 'malayalam-movies', 'Avante Montha', 'Avante montha', 'normal'],
  ['ayyo-enta-amma-damu', 'local', `${MYINSTANTS}/ayyo-enta-am-malayalam-damu-37333/`, 'malayalam-movies', 'Ayyo Enta Amma (Damu)', 'Ayyo enta amma!', 'easy'],
  ['namaskaar-damu', 'local', `${MYINSTANTS}/namaskaar-malayalam-damu-14192/`, 'malayalam-movies', 'Namaskaar (Damu)', 'Namaskaar', 'easy'],
  ['basil-joseph-laugh', 'local', `${MYINSTANTS}/basil-joseph-laughing-version-1-87451/`, 'malayalam-movies', 'Basil Joseph Laughing', 'ha-ha-ha-ha!', 'hard'],
  ['thorappa', 'local', `${MYINSTANTS}/thorappa-14541/`, 'malayalam-movies', 'Thorappa', 'Thorappa', 'normal'],
  ['manasilayo', 'local', `${MYINSTANTS}/manasilayo-28903/`, 'malayalam-movies', 'Manasilayo', 'Manasilayo?', 'normal'],
  ['malayalam-actor-lal', 'local', `${MYINSTANTS}/malayalam-actor-lal-56978/`, 'malayalam-movies', 'Malayalam Actor Lal', 'Lal dialogue', 'hard'],
  ['aadu-2-enganeadauve', 'local', `${MYINSTANTS}/aadu-2-enganeadauve-93646/`, 'malayalam-movies', 'Aadu 2 Enganeadauve', 'Enganeadauve', 'normal'],
  ['perfect-ok', 'local', `${MYINSTANTS}/perfect-ok-82608/`, 'malayalam-movies', 'Perfect OK', 'Perfect OK', 'easy'],
  ['damu-angane-paranjooda', 'local', `${MYINSTANTS}/dhamu-angane-paranjooda-22052/`, 'malayalam-movies', 'Damu: Angane Paranjooda', 'Angane paranjooda', 'normal'],
  ['vine-boom', '3kh0', '/sounds/vine-boom.mp3', 'meme-classics', 'Vine Boom', 'BWOMM', 'easy'],
  ['metal-pipe', '3kh0', '/sounds/metalpipe.mp3', 'meme-classics', 'Metal Pipe', 'CLANG-ang-ang', 'normal'],
  ['bruh', '3kh0', '/sounds/bruh.mp3', 'meme-classics', 'Bruh', 'bruh', 'easy'],
  ['emotional-damage', '3kh0', '/sounds/emotional-damage.mp3', 'meme-classics', 'Emotional Damage', 'EMOTIONAL DAMAGE!', 'hard'],
  ['bonk', '3kh0', '/sounds/bonk.mp3', 'meme-classics', 'Bonk', 'bonk!', 'easy'],
  ['oof', '3kh0', '/sounds/oof.mp3', 'meme-classics', 'Oof', 'oof', 'easy'],
  ['why-are-you-running', '3kh0', '/sounds/why-are-you-running.mp3', 'meme-classics', 'Why Are You Running?', 'Why are you running?', 'hard'],
  ['what-the-dog-doin', '3kh0', '/sounds/what-the-dog-doin.mp3', 'meme-classics', "What the Dog Doin'?", "What the dog doin'?", 'hard'],
  ['deez-nuts', '3kh0', '/sounds/deez-nutz.mp3', 'meme-classics', 'Deez Nuts', 'Deez nuts!', 'normal'],
  ['bababooey', '3kh0', '/sounds/bababooey.mp3', 'meme-classics', 'Bababooey', 'ba-ba-BOO-ey', 'normal'],
  ['nice', '3kh0', '/sounds/nice.mp3', 'meme-classics', 'Nice', 'nice', 'easy'],
  ['yeet', '3kh0', '/sounds/yeet.mp3', 'meme-classics', 'Yeet', 'YEEET!', 'normal'],
  ['airhorn', '3kh0', '/sounds/airhorn.mp3', 'meme-classics', 'Airhorn', 'BWAAP BWAAP', 'normal'],
  ['ba-dum-tss', '3kh0', '/sounds/badumtss.mp3', 'meme-classics', 'Ba Dum Tss', 'ba-dum-TSS', 'normal'],
  ['goofy-yell', '3kh0', '/sounds/goofy-yell.mp3', 'meme-classics', 'Goofy Yell', 'yaa-haa-hooey!', 'hard'],
  ['anime-wow', '3kh0', '/sounds/anime-wow.mp3', 'meme-classics', 'Anime Wow', 'woooOOOW', 'hard'],
  ['fbi-open-up', '3kh0', '/sounds/fbi-open-up.mp3', 'meme-classics', 'FBI Open Up', 'FBI, OPEN UP!', 'hard'],
  ['discord-ping', '3kh0', '/sounds/discord-notification.mp3', 'machine-room', 'Discord Ping', 'doo-DING', 'easy'],
  ['taco-bell-bong', '3kh0', '/sounds/taco-bell.mp3', 'machine-room', 'Taco Bell Bong', 'bong!', 'easy'],
  ['fart-with-reverb', '3kh0', '/sounds/fart-with-reverb.mp3', 'cartoon-chaos', 'Fart With Reverb', 'pfffrrrt', 'normal'],
  ['fahhh', 'pareekshith', '/sounds/faaahhh.wav', 'viral-reactions', 'FAHHH', 'FAAAHHH!', 'easy'],
  ['get-out', 'pareekshith', '/sounds/tuco-get-out.mp3', 'viral-reactions', 'Get Out', 'GET OUT!', 'easy'],
  ['apple-pay', 'pareekshith', '/sounds/apple-pay.mp3', 'viral-reactions', 'Apple Pay', 'tap... DING', 'normal'],
  ['rizz-effect', 'pareekshith', '/sounds/rizz-effect.mp3', 'viral-reactions', 'Rizz Effect', 'wuh-WAAAH', 'hard'],
  ['granny-bazooka', 'pareekshith', '/sounds/granny-bazooka.mp3', 'viral-reactions', 'Granny Bazooka', 'BAZOOKA!', 'hard'],
  ['chicken-scream', 'pareekshith', '/sounds/chicken-screaming.mp3', 'viral-reactions', 'Chicken Scream', 'bok-bok-AAAAH!', 'normal'],
  ['bone-crack', 'pareekshith', '/sounds/bone-crack.mp3', 'cartoon-chaos', 'Bone Crack', 'CRACK!', 'easy'],
  ['what-a-good-boy', 'pareekshith', '/sounds/what-a-good-boy.mp3', 'viral-reactions', 'What a Good Boy', 'What a good boy!', 'normal'],
  ['among-us-role', 'pareekshith', '/sounds/among-us-role.mp3', 'viral-reactions', 'Among Us Role Reveal', 'dum... DUM-dum', 'hard'],
  ['smoke-detector', 'pareekshith', '/sounds/smoke-detector-beep.mp3', 'machine-room', 'Smoke Detector Beep', 'BEEP!', 'easy'],
  ['cartoon-fail', 'pareekshith', '/sounds/spongebob-fail.mp3', 'viral-reactions', 'Cartoon Fail', 'wah-wah-WAAAH', 'normal'],
  ['lizard-button', 'pareekshith', '/sounds/lizard-button.mp3', 'viral-reactions', 'Lizard Button', 'lizard!', 'normal'],
  ['stop-the-cap', '3kh0', '/sounds/stop-the-cap.mp3', 'viral-reactions', 'Stop the Cap', 'Stop the cap!', 'easy'],
  ['let-him-cook', '3kh0', '/sounds/lethimcook.mp3', 'viral-reactions', 'Let Him Cook', 'Let him cook!', 'hard'],
  ['auughhh', '3kh0', '/sounds/AUUGHHH.mp3', 'viral-reactions', 'AUUGHHH', 'AUUUUGHHH', 'hard'],
  ['siuuu', '3kh0', '/sounds/sui.mp3', 'viral-reactions', 'Siuuu', 'SIIIIUUU!', 'hard'],
  ['watch-yo-jet', '3kh0', '/sounds/watchyojet.mp3', 'viral-reactions', 'Watch Yo Jet', 'Watch yo jet!', 'normal'],
  ['we-do-not-care', '3kh0', '/sounds/wedonotcare.mp3', 'viral-reactions', 'We Do Not Care', 'We do not care.', 'normal'],
  ['censor-beep', '3kh0', '/sounds/Censor-Beep-Sound-Effect.mp3', 'machine-room', 'Censor Beep', 'BEEEEEP', 'easy'],
  ['screaming-sheep', '3kh0', '/sounds/sheep.mp3', 'wild-calls', 'Screaming Sheep', 'BAA-AAAAH!', 'normal'],
  ['i-like-turtles', '3kh0', '/sounds/turtles.mp3', 'wild-calls', 'I Like Turtles', 'I like turtles!', 'easy'],
  ['hog-rider', '3kh0', '/sounds/hog-rider.mp3', 'wild-calls', 'Hog Rider', 'HOG RIDER!', 'normal'],
  ['talking-ben-ho', '3kh0', '/sounds/talking-ben-ho-ho-ho.mp3', 'wild-calls', 'Talking Ben Ho Ho Ho', 'ho-ho-ho!', 'normal'],
  ['talking-ben-yes', '3kh0', '/sounds/ben-yes.mp3', 'wild-calls', 'Talking Ben Yes', 'yes', 'easy'],
  ['woodpecker-laugh', '3kh0', '/sounds/woody-woodpecker-laugh.mp3', 'wild-calls', 'Woodpecker Laugh', 'ha-ha-ha-HA-ha!', 'hard'],
  ['cartoon-dog-slip', '3kh0', '/sounds/goofy-slip.mp3', 'wild-calls', 'Cartoon Dog Slip', 'whee-oo-WOOP!', 'hard'],
  ['dolphin-censor', '3kh0', '/sounds/spongebob-dolphin.mp3', 'wild-calls', 'Dolphin Censor', 'ee-ee-EEEEP!', 'hard'],
  ['noot-noot', '3kh0', '/sounds/nootnoot.mp3', 'wild-calls', 'Noot Noot', 'noot... NOOT!', 'easy'],
  ['biggest-bird', '3kh0', '/sounds/biggestbird.mp3', 'wild-calls', 'Biggest Bird', "I'm the biggest bird!", 'normal'],
  ['windows-error', '3kh0', '/sounds/WinError.mp3', 'machine-room', 'Windows Error', 'ding-DONG', 'easy'],
  ['android-notification', '3kh0', '/sounds/android-notif.mp3', 'machine-room', 'Android Notification', 'di-da-DING', 'normal'],
  ['radio-beep', '3kh0', '/sounds/radio-beep.mp3', 'machine-room', 'Radio Beep', 'bip-BEEP', 'easy'],
  ['pixel-anvil', '3kh0', '/sounds/mc-anvil.mp3', 'machine-room', 'Pixel Anvil', 'CLANK', 'easy'],
  ['telephone-dial', '3kh0', '/sounds/telephonedial.mp3', 'machine-room', 'Telephone Dial', 'beep-boop-beep-boop', 'hard'],
  ['computer-has-virus', '3kh0', '/sounds/helloyourcomputerhasvirus.mp3', 'machine-room', 'Computer Has Virus', 'Your computer has virus!', 'normal'],
  ['windows-shutdown', '3kh0', '/sounds/winxpshutdown.mp3', 'machine-room', 'Windows Shutdown', 'doo-dee-dum...', 'hard'],
  ['clan-intro', '3kh0', '/sounds/coc-intro.mp3', 'machine-room', 'Clan Intro', 'dum... da-da-DUM', 'hard'],
  ['royale-intro', '3kh0', '/sounds/cr-intro.mp3', 'machine-room', 'Royale Intro', 'ba-da-da-DUM', 'normal'],
  ['sega-startup', '3kh0', '/sounds/sega.mp3', 'machine-room', 'Sega Startup', 'SE-GA!', 'easy'],
  ['my-leg', '3kh0', '/sounds/myleg.mp3', 'cartoon-chaos', 'My Leg!', 'MY LEG!', 'easy'],
  ['its-a-me', '3kh0', '/sounds/mario.mp3', 'cartoon-chaos', "It's-a Me", "It's-a me, Mario!", 'normal'],
  ['hero-falling', '3kh0', '/sounds/mariofalling.mp3', 'cartoon-chaos', 'Hero Falling', 'waa-aa-AAAH!', 'hard'],
  ['a-few-moments-later', '3kh0', '/sounds/afewmomentslater.mp3', 'cartoon-chaos', 'A Few Moments Later', 'A few moments later...', 'normal'],
  ['num-num', '3kh0', '/sounds/roblox-num-num.mp3', 'cartoon-chaos', 'Num Num', 'num-num-num!', 'easy'],
  ['jumpscare', '3kh0', '/sounds/five-nights-at-freddys-full-scream.mp3', 'cartoon-chaos', 'Jumpscare', 'SKREEE-AAAH!', 'hard'],
  ['fatality', '3kh0', '/sounds/fatality.mp3', 'cartoon-chaos', 'Fatality', 'Fatality!', 'normal'],
  ['baller', '3kh0', '/sounds/roblox-baller.mp3', 'cartoon-chaos', 'Baller', 'baller!', 'easy'],
  ['wasted', '3kh0', '/sounds/gta5-wasted.mp3', 'cartoon-chaos', 'Wasted', 'wah-wah...', 'hard'],
  ['yummy', '3kh0', '/sounds/yummy.mp3', 'cartoon-chaos', 'Yummy', 'yummy-yummy!', 'normal'],
  ['rick-roll-intro', '3kh0', '/sounds/rick-roll.mp3', 'music', 'Rick Roll Intro', 'du-du-du, du-du-du', 'normal'],
  ['coffin-dance', '3kh0', '/sounds/coffin-dance.mp3', 'music', 'Coffin Dance', 'da-da, da-da-da-da', 'hard'],
  ['sad-violin', '3kh0', '/sounds/sad-violin.mp3', 'music', 'Sad Violin', 'nee-yaa... nee-yaa...', 'hard'],
  ['tetris-theme', '3kh0', '/sounds/tetristheme.mp3', 'music', 'Tetris Theme', 'da-da-da, da-da-da-da', 'hard'],
  ['wii-theme', '3kh0', '/sounds/wiimusic.mp3', 'music', 'Wii Theme', 'bum... ba-dum... bum', 'normal'],
  ['hey-ya', '3kh0', '/sounds/hey-ya.mp3', 'music', 'Hey Ya', 'one-two-three, hey!', 'easy'],
  ['bad-to-the-bone', '3kh0', '/sounds/badtothebone.mp3', 'music', 'Bad to the Bone', 'da-da-da-da-DUM', 'normal'],
  ['guess-whos-back', '3kh0', '/sounds/guess-who-back.mp3', 'music', "Guess Who's Back", "guess who's back", 'easy'],
  ['tiny-sad-song', '3kh0', '/sounds/sad_song.mp3', 'music', 'Tiny Sad Song', 'doo... doo-doo...', 'normal'],
  ['witch-doctor', '3kh0', '/sounds/witchdoctor.mp3', 'music', 'Witch Doctor', 'oo-ee-oo-ah-ah', 'easy'],
  ['i-love-refrigerators', '3kh0', '/sounds/i_love_refrigerators.mp3', 'daily-drama', 'I Love Refrigerators', 'I love refrigerators!', 'easy'],
  ['our-table-is-broken', '3kh0', '/sounds/ohno-table-broken.mp3', 'daily-drama', 'Our Table Is Broken', "Oh no! Our table! It's broken!", 'hard'],
  ['who-touched-my-spaghet', '3kh0', '/sounds/who-touch-my.mp3', 'daily-drama', 'Who Touched My Spaghet', 'Who touched my spaghet?!', 'hard'],
  ['its-corn', '3kh0', '/sounds/itscorn.mp3', 'daily-drama', "It's Corn", "It's corn!", 'normal'],
  ['mayonnaise-escalator', '3kh0', '/sounds/mayonnaise.mp3', 'daily-drama', 'Mayonnaise on an Escalator', 'Mayonnaise on an escalator!', 'hard'],
  ['exploding-toilet', '3kh0', '/sounds/explodingtoilet.mp3', 'daily-drama', 'Exploding Toilet', 'fwoosh-KABOOM!', 'normal'],
  ['crunch', '3kh0', '/sounds/nestle-crunch.mp3', 'daily-drama', 'Crunch', 'krrr-CHOMP!', 'normal'],
  ['cranberry-time', '3kh0', '/sounds/sprite-cranberry.mp3', 'daily-drama', 'Cranberry Time', 'Want a Sprite Cranberry?', 'easy'],
  ['diabetes', '3kh0', '/sounds/diabetes.mp3', 'daily-drama', 'Diabetes', 'diabeetus', 'easy'],
  ['finally-good-food', '3kh0', '/sounds/kitchennightmares.mp3', 'daily-drama', 'Finally, Good Food', 'Finally, some good food', 'normal'],
  ['we-will-be-right-back', 'fazal', '/Sounds/we will be right back.wav', 'music', 'We Will Be Right Back', 'da-da-da-DAAA', 'normal'],
  ['chilis', 'evansuong', '/sounds/chilis.mp3', 'daily-drama', "Chili's", "Hi, welcome to Chili's", 'normal'],
  ['fart-fazal', 'fazal', '/Sounds/Fart.wav', 'cartoon-chaos', 'Fart', 'pfft!', 'easy'],
  ['roblox-damage', 'evansuong', '/sounds/roblox_damage.mp3', 'cartoon-chaos', 'Roblox Damage', 'oof', 'easy'],
  ['ugandan-knuckles', 'evansuong', '/sounds/ugandan_knuckles.mp3', 'wild-calls', 'Ugandan Knuckles', 'click-click-click', 'hard'],
  ['fresh-avocado', 'evansuong', '/sounds/fre_shavacado.mp3', 'daily-drama', 'Fre Shavacado', 'fre-sha-vaca-do', 'normal'],
  ['faaaah', 'bytevictor', '/FAAAAH.wav', 'machine-room', 'FAAAAH', 'FAAAAH', 'easy'],
  ['bruh-fazal', 'fazal', '/Sounds/Bruh.wav', 'machine-room', 'Bruh (machine)', 'Bruh', 'normal'],
  ['peanut-butter-baby', 'evansuong', '/sounds/peanut_butter_baby.mp3', 'daily-drama', 'Peanut Butter Baby', 'peanut butter baby!', 'normal'],
  ['movie-bruh', 'pareekshith', '/sounds/movie-bruh.mp3', 'meme-classics', 'Movie Bruh', 'bruuuh', 'easy'],
  ['aayein', 'pareekshith', '/sounds/aayein-meme.mp3', 'viral-reactions', 'Aayein', 'aayein?', 'easy'],
  ['click-nice', 'jimmytop', `${JIMMY}/misc/click-nice.mp3`, 'meme-classics', 'Click Nice', 'click... nice', 'easy'],
  ['a-few-moments-later-2', 'jimmytop', `${JIMMY}/misc/a-few-moments-later.mp3`, 'cartoon-chaos', 'A Few Moments Later (again)', 'A few moments later...', 'normal'],
  ['fahhh-alt', 'pareekshith', '/sounds/fahhh-alt.mp3', 'cartoon-chaos', 'Fahhh (alt)', 'fahhh-alt', 'easy'],
  ['ernste-lage', 'jimmytop', `${JIMMY}/robert-geiss/ernste-lage.mp3`, 'cartoon-chaos', 'Ernste Lage', 'ernste Lage', 'normal'],
  ['ich-bin-der-uwe', 'jimmytop', `${JIMMY}/misc/ich-bin-der-uwe-ich-bin-auch-dabei.mp3`, 'cartoon-chaos', 'Ich bin der Uwe', 'Ich bin der Uwe, ich bin auch dabei', 'hard'],
  ['ive-got-this-faaah', 'pareekshith', '/sounds/ive-got-this-faaaaaah.mp3', 'cartoon-chaos', "I've Got This... FAAAH", "I've got this... FAAAAAH", 'normal'],
  ['besser-zu-hause', 'jimmytop', `${JIMMY}/lkw-ali/besser-zu-hause.mp3`, 'daily-drama', 'Besser zu Hause', 'besser zu Hause', 'normal'],
  ['metal-pipe-clang', 'pareekshith', '/sounds/metal-pipe-clang.mp3', 'meme-classics', 'Metal Pipe Clang', 'CLANG!', 'easy'],
  ['wer-wird-millionar', 'jimmytop', `${JIMMY}/jingles/wer-wird-millionar.mp3`, 'music', 'Wer wird Millionär', 'da-da-DAAA', 'normal'],
  ['teamspeak-disconnect', 'jimmytop', `${JIMMY}/misc/teamspeak-disconnect.mp3`, 'machine-room', 'TeamSpeak Disconnect', 'user disconnected', 'normal'],
  ['ich-muss-raus', 'jimmytop', `${JIMMY}/misc/ich-muss-raus.mp3`, 'daily-drama', 'Ich muss raus', 'Ich muss raus!', 'normal'],
  ['gold-experience', 'emanuel', '/sounds/gold-experience.mp3', 'music', 'Gold Experience', 'da-da-DAAA', 'normal'],
  ['faaah', 'pareekshith', '/sounds/faaah.mp3', 'viral-reactions', 'Faaah', 'FAAAH', 'easy'],
  ['fahhhhhhh', 'pareekshith', '/sounds/fahhhhhhh.mp3', 'viral-reactions', 'Fahhhhhhh', 'FAHHHHHHH', 'easy'],
  ['goku-ahh', 'emanuel', '/sounds/goku-ahh.mp3', 'cartoon-chaos', 'Goku Ahh', 'AAAAAHHH!', 'hard'],
  ['regeln-befolgen', 'jimmytop', `${JIMMY}/robert-geiss/regeln-befolgen.mp3`, 'daily-drama', 'Regeln befolgen', 'Regeln befolgen', 'normal'],
  ['ende-aus-nikolaus', 'jimmytop', `${JIMMY}/robert-geiss/ende-aus-nikolaus.mp3`, 'daily-drama', 'Ende aus, Nikolaus', 'Ende aus, Nikolaus!', 'normal'],
  ['nein-doch-ohh', 'jimmytop', `${JIMMY}/misc/nein-doch-ohh.mp3`, 'viral-reactions', 'Nein! Doch! Ohh!', 'Nein! Doch! Ohh!', 'normal'],
  ['computer-sagt-nein', 'jimmytop', `${JIMMY}/misc/computer-sagt-nein.mp3`, 'machine-room', 'Computer sagt nein', 'Computer sagt nein', 'normal'],
  ['warum-strasse', 'jimmytop', `${JIMMY}/lkw-ali/warum-strasse.mp3`, 'daily-drama', 'Warum Straße', 'warum Straße?', 'normal'],
  ['wallah-krise', 'jimmytop', `${JIMMY}/misc/wallah-krise.mp3`, 'viral-reactions', 'Wallah Krise', 'Wallah Krise!', 'normal'],
  ['fart-button', 'pareekshith', '/sounds/fart-button.mp3', 'cartoon-chaos', 'Fart Button', 'prrrt', 'easy'],
  ['fart', 'pareekshith', '/sounds/fart.mp3', 'cartoon-chaos', 'Fart', 'pfffft', 'easy'],
  ['cm-wilhelm', 'commons', 'File:Wilhelm Scream.ogg', 'cartoon-chaos', 'Wilhelm Scream', 'AAAAHHH-ah!', 'normal'],
  ['cm-scream-c', 'commons', 'File:Scream-c.wav', 'cartoon-chaos', 'Scream (C)', 'aah!', 'easy'],
  ['cm-scream-d', 'commons', 'File:Scream-d.wav', 'cartoon-chaos', 'Scream (D)', 'aah!', 'easy'],
  ['cm-scream-e', 'commons', 'File:Scream-e.wav', 'cartoon-chaos', 'Scream (E)', 'aah!', 'easy'],
  ['cm-laufroboter', 'commons', 'File:De-Laufroboter.ogg', 'machine-room', 'Laufroboter', 'Laufroboter', 'normal'],
  ['cm-industrieroboter', 'commons', 'File:De-Industrieroboter.ogg', 'machine-room', 'Industrieroboter', 'Industrieroboter', 'normal'],
  ['cm-wagtail', 'commons', 'File:White wagtail flight call recorded in December 2012 at Sangli.wav', 'wild-calls', 'White Wagtail Flight Call', 'tsee-tsee', 'hard'],
  ['cm-munia', 'commons', 'File:White-rumped munia call recorded in January 2013 at Ratnagiri.wav', 'wild-calls', 'White-rumped Munia Call', 'chirp-chirp', 'normal'],
  ['cm-roboters', 'commons', 'File:De-Roboters.ogg', 'machine-room', 'Roboters', 'Roboters', 'easy'],
  ['cm-robotes', 'commons', 'File:De-Robotes.ogg', 'machine-room', 'Robotes', 'Robotes', 'easy'],
  ['cm-roboter', 'commons', 'File:De-Roboter.ogg', 'machine-room', 'Roboter', 'Roboter', 'easy'],
];

const headers = { 'User-Agent': 'ChiriPartyLibraryImport/1.0 (browser party game sound library)' };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url) {
  let response = await fetch(url, { headers });
  for (let retry = 1; !response.ok && retry <= 3; retry++) {
    await sleep(retry * 10000);
    response = await fetch(url, { headers });
  }
  return response;
}

async function repositoryDetails() {
  const details = {};
  for (const [key, { repo, branch }] of Object.entries(REPOSITORIES)) {
    const listing = await (await fetchWithRetry(`https://data.jsdelivr.com/v1/packages/gh/${repo}@${branch}?structure=flat`)).json();
    const files = new Set(listing.files.map(file => file.name));
    const licenseFile = [...files].find(name => /^\/(LICEN[SC]E|COPYING)(\.\w+)?$/i.test(name));
    let license = 'No licence file in repository';
    if (licenseFile) {
      const text = await (await fetchWithRetry(`https://cdn.jsdelivr.net/gh/${repo}@${branch}${licenseFile}`)).text();
      license = `${text.split('\n').map(line => line.trim()).find(Boolean)} (repository licence file)`;
    }
    details[key] = { files, license };
  }
  return details;
}

async function commonsDetails(file) {
  const query = new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata', format: 'json', titles: file });
  const metadata = await (await fetchWithRetry(`https://commons.wikimedia.org/w/api.php?${query}`)).json();
  const info = Object.values(metadata.query.pages)[0].imageinfo[0];
  const author = (info.extmetadata.Artist?.value ?? 'Unknown').replace(/<[^>]+>/g, '').trim();
  return { url: info.url, license: `${info.extmetadata.LicenseShortName.value} · ${author}` };
}

function findLocalFile(id) {
  const extension = ['mp3', 'wav', 'ogg', 'm4a'].find(type => existsSync(`${LOCAL_FOLDER}/${id}.${type}`));
  return extension ? `${LOCAL_FOLDER}/${id}.${extension}` : null;
}

function describeSource(source, path, commons) {
  if (source === 'local')
    return { source: `Saved by the project owner from ${path}`, sourceUrl: path, license: 'No licence (film audio uploaded by a Myinstants user)' };
  if (source === 'commons')
    return {
      source: `Wikimedia Commons · ${path}`,
      sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(path.replaceAll(' ', '_'))}`,
      license: commons.license,
    };
  const { repo, branch } = REPOSITORIES[source];
  return {
    source: `${repo} · ${path.slice(1)}`,
    sourceUrl: `https://github.com/${repo}/blob/${branch}${path.split('/').map(encodeURIComponent).join('/')}`,
    license: repositories[source].license,
  };
}

async function download(id, source, path, commons) {
  let url = commons?.url;
  if (source === 'commons') await sleep(3000);
  else {
    const { repo, branch } = REPOSITORIES[source];
    url = `https://cdn.jsdelivr.net/gh/${repo}@${branch}${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    console.warn(`${id}: download failed (${response.status}), skipped. Run again later to add it.`);
    return null;
  }
  return Buffer.from(await response.arrayBuffer());
}

function wavFile(samples) {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2));
  return wav;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

await mkdir(OUTPUT_FOLDER, { recursive: true });
const repositories = await repositoryDetails();
const missing = CLIPS.filter(([, source, path]) => REPOSITORIES[source] && !repositories[source].files.has(path));
if (missing.length) throw new Error(`Not found in their repositories: ${missing.map(([id]) => id).join(', ')}`);

const previous = existsSync('src/game/library.json') ? JSON.parse(await readFile('src/game/library.json', 'utf8')) : [];
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage();
const library = [];
try {
  for (const [id, source, path, world, title, phrase, difficulty] of CLIPS) {
    const outputPath = `${OUTPUT_FOLDER}/${id}.wav`;
    const localFile = source === 'local' ? findLocalFile(id) : null;
    if (source === 'local' && !localFile) {
      console.log(`${id}: no file in ${LOCAL_FOLDER}/ yet, skipped`);
      continue;
    }
    const commons = source === 'commons' ? await commonsDetails(path) : null;
    const entry = { id, world, title, phrase, difficulty, ...describeSource(source, path, commons) };
    if (existsSync(outputPath)) {
      const earlier = previous.find(clip => clip.id === id);
      const wav = await readFile(outputPath);
      const duration = (wav.length - 44) / 2 / wav.readUInt32LE(24);
      library.push({ ...entry, duration, sourceSha256: earlier?.sourceSha256 ?? null, fileSha256: sha256(wav) });
      continue;
    }
    const sourceBytes = localFile ? await readFile(localFile) : await download(id, source, path, commons);
    if (!sourceBytes) continue;
    const samples = await page.evaluate(async ({ encoded, maxSeconds, sampleRate }) => {
      const context = new OfflineAudioContext(1, 1, 44100);
      const decoded = await context.decodeAudioData(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
      const player = offline.createBufferSource();
      player.buffer = decoded;
      player.connect(offline.destination);
      player.start();
      const mono = (await offline.startRendering()).getChannelData(0);
      let peak = 0;
      for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
      if (peak < 0.01) throw new Error('Silent source');
      const padding = Math.round(sampleRate * 0.08);
      const start = Math.max(0, mono.findIndex(sample => Math.abs(sample) > peak * 0.04) - padding);
      let end = mono.length - 1;
      while (end > start && Math.abs(mono[end]) < peak * 0.04) end--;
      const clip = mono.slice(start, Math.min(mono.length, end + padding, start + maxSeconds * sampleRate));
      let clipPeak = 0;
      for (const sample of clip) clipPeak = Math.max(clipPeak, Math.abs(sample));
      const fadeLength = sampleRate * 0.01;
      for (let i = 0; i < clip.length; i++) {
        const fade = Math.min(1, i / fadeLength, (clip.length - 1 - i) / fadeLength);
        clip[i] *= (fade * 0.89) / clipPeak;
      }
      return Array.from(clip);
    }, { encoded: sourceBytes.toString('base64'), maxSeconds: MAX_SECONDS, sampleRate: SAMPLE_RATE }).catch(error => {
      console.warn(`${id}: could not decode (${error.message.split('\n')[0]}), skipped.`);
      return null;
    });
    if (!samples) continue;
    const wav = wavFile(samples);
    await writeFile(outputPath, wav);
    library.push({ ...entry, duration: samples.length / SAMPLE_RATE, sourceSha256: sha256(sourceBytes), fileSha256: sha256(wav) });
    console.log(`${id}: ${(samples.length / SAMPLE_RATE).toFixed(2)}s`);
  }
  await writeFile('src/game/library.json', JSON.stringify(library, null, 2) + '\n');
  const changes = `Mono ${SAMPLE_RATE} Hz WAV, leading/trailing silence trimmed, cut to at most ${MAX_SECONDS} s, 10 ms fades, peak-normalized.`;
  await writeFile(`${OUTPUT_FOLDER}/CREDITS.json`, JSON.stringify(library.map(clip => ({ ...clip, changes })), null, 2) + '\n');
  console.log(`${library.length} of ${CLIPS.length} clips in the library.`);
} finally { await browser.close(); }
