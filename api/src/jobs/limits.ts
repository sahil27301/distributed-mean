export const MIN_FILE_COUNT = 2;
export const MAX_FILE_COUNT = 99_999;
export const MIN_VALUES_PER_FILE = 2;
export const MAX_VALUES_PER_FILE = 999_999;

/** Generated values are integers in [0, MAX_VALUE]. */
export const MAX_VALUE = 999;

if (MAX_VALUE * MAX_FILE_COUNT >= 2 ** 31) {
  throw new Error("MAX_VALUE * MAX_FILE_COUNT must stay below 2^31 so int32 sums cannot overflow");
}
