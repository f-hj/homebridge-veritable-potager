import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { VeritableHomebridgePlatform } from './platform';

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  console.log('register');
  api.registerPlatform(PLATFORM_NAME, VeritableHomebridgePlatform);
};
