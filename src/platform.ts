import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import noble from '@abandonware/noble';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { VeritablePotagerAccessory } from './platformAccessory';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class VeritableHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories

      noble.on('discover', async (peripheral) => {
        this.discoverDevice(peripheral);
      });

      noble.on('stateChange', async (state) => {
        if (state === 'poweredOn') {
          await noble.startScanningAsync([], false);
        }
      });
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevice(peripheral: noble.Peripheral) {
    if (!peripheral.advertisement.localName || !peripheral.advertisement.localName.startsWith('VERITABLE')) {
      return;
    }

    await peripheral.connectAsync();
    const uuid = this.api.hap.uuid.generate(peripheral.address);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      new VeritablePotagerAccessory(this, existingAccessory, peripheral);
    } else {
      this.log.info('Adding new accessory:', peripheral.advertisement.localName);

      // create a new accessory
      const accessory = new this.api.platformAccessory(peripheral.advertisement.localName, uuid);

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new VeritablePotagerAccessory(this, accessory, peripheral);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

  }
}
