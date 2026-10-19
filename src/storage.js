// storage.js — progress in localStorage: current level, stars, bests, settings.
// Includes export/import (share code) so a new phone keeps her progress. M3.
//
// M1: just the current level. Every access is wrapped — private mode or blocked
// storage must never stop the game from starting.

const KEY = "purrfect-match:save";

export function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && Number.isInteger(saved.level) && saved.level >= 1) return { level: saved.level };
  } catch {
    // fall through to a fresh save
  }
  return { level: 1 };
}

export function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, level: progress.level }));
  } catch {
    // storage unavailable: progress lasts for this session only
  }
}
