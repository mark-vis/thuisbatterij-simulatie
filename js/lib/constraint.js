/**
 * Returns a `Constraint` that specifies something should be less than or equal to `value`.
 * Equivalent to `{ max: value }`.
 */
export const lessEq = (value) => ({ max: value });
/**
 * Returns a `Constraint` that specifies something should be greater than or equal to `value`.
 * Equivalent to `{ min: value }`.
 */
export const greaterEq = (value) => ({ min: value });
/**
 * Returns a `Constraint` that specifies something should be exactly equal to `value`.
 * Equivalent to `{ equal: value }`.
 */
export const equalTo = (value) => ({ equal: value });
/**
 * Returns a `Constraint` that specifies something should be between `lower` and `upper` (both inclusive).
 * Equivalent to `{ min: lower, max: upper }`.
 */
export const inRange = (lower, upper) => ({ min: lower, max: upper });
