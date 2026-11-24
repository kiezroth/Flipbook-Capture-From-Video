/**
 * Enter that only confirms an IME composition (Vietnamese Telex, etc.) must not submit the field.
 * Takes the bits of a React keyboard event it needs, so it can be unit-tested.
 */
export function isCompositionEnter(e: { key: string; nativeEvent: { isComposing: boolean } }): boolean {
  return e.key === 'Enter' && e.nativeEvent.isComposing
}
