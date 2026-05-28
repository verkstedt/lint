import styles from './index.module.css';

export const good = styles.foo;
// eslint-disable-next-line css-modules/no-undef-class -- EXPECTED
export const bad = styles.bar;
