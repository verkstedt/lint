export const good: Array<number> = [1, 2, 3];

// eslint-disable-next-line @typescript-eslint/array-type -- EXPECTED
export const bad: number[] = [1, 2, 3];

// eslint-disable-next-line @typescript-eslint/no-floating-promises -- EXPECTED
Promise.resolve(42);

void Promise.resolve(42);
