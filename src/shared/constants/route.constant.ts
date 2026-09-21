import envConfig from '../config.js';

export const API_PREFIX = envConfig.API_PREFIX.replace(/^\/+|\/+$/g, '');
export const API_PREFIX_PATH = `/${API_PREFIX}`;
