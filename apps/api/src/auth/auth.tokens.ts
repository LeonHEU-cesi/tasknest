// Jeton d'injection isolé : évite le cycle auth.module ↔ auth.guard
// (le module fournit le provider, le guard l'injecte — aucun ne doit
// dépendre de l'autre juste pour le symbole).
export const BETTER_AUTH = Symbol('BETTER_AUTH');
