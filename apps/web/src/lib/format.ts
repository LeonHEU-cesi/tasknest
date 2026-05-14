/**
 * Tiny utility kept here to validate the test pipeline of @tasknest/web.
 * Will be replaced by real i18n / date utilities in later sprints.
 */
export function greet(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? 'Hello, friend!' : `Hello, ${trimmed}!`;
}
