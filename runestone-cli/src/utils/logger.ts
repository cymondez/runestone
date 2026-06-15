import { cyan, green, red, yellow } from 'kleur';

const DEBUG = process.env.DEBUG === '1';

export const logger = {
  info(message: string): void {
    console.log(`${cyan('[info]')} ${message}`);
  },

  success(message: string): void {
    console.log(`${green('[ok]')} ${message}`);
  },

  warn(message: string): void {
    console.warn(`${yellow('[warn]')} ${message}`);
  },

  error(message: string): void {
    console.error(`${red('[error]')} ${message}`);
  },

  debug(message: string): void {
    if (DEBUG) {
      console.log(`${cyan('[debug]')} ${message}`);
    }
  }
};
