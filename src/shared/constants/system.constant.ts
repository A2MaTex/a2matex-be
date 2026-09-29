import envConfig from '../config.js';

export const API_PREFIX = envConfig.API_PREFIX.replace(/^\/+|\/+$/g, '');
export const API_PREFIX_PATH = `/${API_PREFIX}`;

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;

export const SUCCESS_RESPONSE_MESSAGE = 'Success';
