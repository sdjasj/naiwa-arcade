import { FROG_SKINS, drawFrog, setFrogSkin, getFrogSkin, ensureSkinReady } from './frog.js?v=8fb8b395f3ed';

const VOICE_NAMES = { kakatte: '刚刚跌落水', andy: '安迪' };

/** Cosmetic preferences never restart a game or change its leaderboard context. */
export function createCastUI({ audio, read, write, isSoundEnabled, getHostState, pause, onSkinChanged }) {
  const $ = id => document.getElementById(id);
  const choices = new Map(FROG_SKINS.map(skin => [skin.id, skin]));
  const roster = $('cast-choices'), skinStatus = $('cast-status'), voiceStatus = $('voice-preview-status');
  const previewButtons = [...document.querySelectorAll('[data-voice-preview]')];
  let skinEpoch = 0, previewEpoch = 0, previewBusy = false;
  let voicePack = audio.setVoicePack(read('naiwa:voice-pack', 'meme'));
  $('voice-pack-select').value = voicePack;

  function drawPortrait(id) {
    const canvas = roster.querySelector(`[data-skin-preview="${id}"]`);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 80, 80);
    drawFrog(ctx, 40, 43, 36, { skin: id, pose: 'idle', animation: 'idle', animationTime: .3 });
  }

  function showSelection() {
    const skin = choices.get(getFrogSkin()) || choices.get('naiwa');
    for (const button of roster.querySelectorAll('[data-skin]')) {
      button.setAttribute('aria-pressed', String(button.dataset.skin === skin.id));
    }
    $('cast-current-name').textContent = skin.name;
    $('hero-cast-name').textContent = skin.name;
    $('hero-description-name').textContent = skin.name;
    $('hero-sticker-name').textContent = skin.name;
    $('cast-ready-name').textContent = skin.name;
    document.querySelector('.hero-art').setAttribute('aria-label', `${skin.name}拍着小翅膀，笑着来陪你摸鱼。`);
  }

  function selectSkin(id, persist = true) {
    const selected = choices.has(id) ? id : 'naiwa';
    setFrogSkin(selected);
    if (persist) write('naiwa:skin', selected);
    showSelection();
    onSkinChanged();
    const epoch = ++skinEpoch;
    skinStatus.textContent = persist ? `${choices.get(selected).name}来陪你玩啦。` : '全站换装，随时切换。';
    Promise.resolve(ensureSkinReady(selected)).then(ready => {
      drawPortrait(selected);
      if (epoch === skinEpoch && getFrogSkin() === selected) {
        onSkinChanged();
        if (ready === false) skinStatus.textContent = '外观暂未加载完成，点头像可以再试。';
      }
    }).catch(() => {
      if (epoch === skinEpoch) skinStatus.textContent = '外观正在休息，稍后再试一次。';
    });
  }

  roster.replaceChildren(...FROG_SKINS.map(skin => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'cast-choice'; button.dataset.skin = skin.id;
    button.setAttribute('aria-label', `换装为${skin.name}`); button.setAttribute('aria-pressed', 'false');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 160; canvas.dataset.skinPreview = skin.id; canvas.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.textContent = skin.name;
    button.append(canvas, name);
    button.addEventListener('click', () => selectSkin(skin.id));
    return button;
  }));
  selectSkin(read('naiwa:skin', 'naiwa'), false);
  for (const { id } of FROG_SKINS) {
    drawPortrait(id);
    Promise.resolve(ensureSkinReady(id)).then(() => { drawPortrait(id); onSkinChanged(); }).catch(() => {});
  }

  function setBusy(value) {
    previewBusy = value;
    $('voice-previews').setAttribute('aria-busy', String(value));
    for (const button of previewButtons) button.disabled = value;
  }
  function updateSound() {
    if (!isSoundEnabled()) {
      previewEpoch++; setBusy(false);
      voiceStatus.textContent = '音效已关闭，请先开启音效再试听。';
    } else if (!previewBusy) voiceStatus.textContent = '点击试听；游戏中试听会先暂停。';
  }
  $('voice-pack-select').addEventListener('change', event => {
    previewEpoch++; setBusy(false);
    voicePack = audio.setVoicePack(event.target.value);
    event.target.value = voicePack;
    write('naiwa:voice-pack', voicePack);
    voiceStatus.textContent = !isSoundEnabled() ? '偏好已保存，请先开启音效再试听。'
      : voicePack === 'classic' ? '已切换经典笑声。' : '开局、出招和受击时穿插梗语音。';
  });
  for (const button of previewButtons) button.addEventListener('click', async () => {
    pause();
    if (!isSoundEnabled()) { voiceStatus.textContent = '请先开启右上角音效，再试听。'; return; }
    const id = button.dataset.voicePreview, epoch = ++previewEpoch, host = getHostState();
    setBusy(true); voiceStatus.textContent = `正在准备「${VOICE_NAMES[id]}」…`;
    function currentPreview() {
      if (epoch !== previewEpoch || !isSoundEnabled()) return false;
      if (getHostState() !== host) { voiceStatus.textContent = '已取消试听，可以继续玩。'; return false; }
      return true;
    }
    try {
      // Capture the audio request in this click, before waiting on resume/load.
      // A game switch can then cancel it even when both games are still ready.
      audio.unlock();
      const played = await audio.previewVoice(id);
      if (!currentPreview()) return;
      voiceStatus.textContent = played ? `试听「${VOICE_NAMES[id]}」${host === 'paused' ? '，游戏保持暂停。' : '。'}`
        : '暂时无法播放，再点一次试试。';
    } catch {
      if (epoch === previewEpoch && isSoundEnabled()) voiceStatus.textContent = '暂时无法播放，再点一次试试。';
    } finally {
      if (epoch === previewEpoch) setBusy(false);
    }
  });
  updateSound();
  return { updateSound, getState: () => ({ skin: getFrogSkin(), voicePack, previewBusy }) };
}
