// sound-toggle.js — the HUD's sound on/off button. M2.
// Lives outside ui.js so the HUD layout and the audio settings can change independently.
// Sound starts muted (she plays with it off); the choice is remembered by audio.js.

import { unlockAudio, isMuted, setMuted, sfx } from "./audio.js";

const SPEAKER = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <g class="waves" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M16 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/></g>
  <g class="cross" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
    <path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></g></svg>`;

export function attachSoundToggle(hud) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hud-pill hud-sound";
  button.innerHTML = SPEAKER;
  const show = () => {
    const m = isMuted();
    button.classList.toggle("muted", m);
    button.setAttribute("aria-label", m ? "Sound off — tap to turn on" : "Sound on — tap to mute");
    button.setAttribute("aria-pressed", String(m));
  };
  button.addEventListener("click", () => {
    setMuted(!isMuted());
    unlockAudio();
    sfx.pop(1);
    show();
  });
  show();
  hud.append(button);
  return button;
}
