import { describe, it, expect } from 'vitest';
import { greet } from './format';

describe('greet', () => {
  it('greets by name when one is provided', () => {
    expect(greet('Léon')).toBe('Hello, Léon!');
  });

  it('falls back to a friendly default when the name is blank', () => {
    expect(greet('   ')).toBe('Hello, friend!');
    expect(greet('')).toBe('Hello, friend!');
  });
});
