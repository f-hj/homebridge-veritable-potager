import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { Peripheral } from '@abandonware/noble';
import pLimit from 'p-limit';

import { VeritableHomebridgePlatform } from './platform';

export class VeritablePotagerAccessory {
  private peripheral: Peripheral;

  private serviceLight: Service;
  private sensorService: Service;

  private limit = pLimit(1);

  private state = {
    On: true,
    LightMode: 0,
    HasWater: true,
  };

  constructor(
    private readonly platform: VeritableHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly p: Peripheral,
  ) {

    this.peripheral = p;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Veritable Potager')
      .setCharacteristic(this.platform.Characteristic.Model, 'Unknown')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Unknown');

    this.serviceLight = this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    this.serviceLight.setCharacteristic(this.platform.Characteristic.Name, this.peripheral.advertisement.localName);

    this.serviceLight.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    this.serviceLight.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this))
      .onGet(this.getBrightness.bind(this));

    this.sensorService = this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    this.sensorService.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(this.getContactSensorState.bind(this));

    this.limit(() => {
      this.reload(true);
    });
    setInterval(() => {
      this.limit(() => {
        this.reload();
      });
    }, 60000);
  }

  async reload(firstStart = false) {
    this.platform.log.debug('Current status ->', this.state);
    const services = await this.peripheral.discoverServicesAsync([]);
    const service = services.find((s) => s.uuid === 'fabca1ea9cc34640bb586d8be824421c');

    const serviceCharacteristics = await service!.discoverCharacteristicsAsync([]);
    const statusCharacteristic = serviceCharacteristics.find((c) => c.uuid === 'a0e46546c5154eb5987e61394f91b560');
    const statusData: Buffer = await statusCharacteristic!.readAsync();
    const statusInt = statusData.readUInt8();
    const currentOn = (statusInt & 1) > 0;
    const currentHasWater = (statusInt & 64) > 0;

    if (firstStart || currentOn !== this.state.On) {
      this.state.On = currentOn;
      this.serviceLight.updateCharacteristic(this.platform.Characteristic.On, this.state.On);
      if (!this.state.On) {
        this.serviceLight.updateCharacteristic(this.platform.Characteristic.Brightness, 0);
      }
    }

    if (firstStart || currentHasWater !== this.state.HasWater) {
      this.state.HasWater = currentHasWater;
      this.sensorService.updateCharacteristic(
        this.platform.Characteristic.ContactSensorState,
        this.state.HasWater ?
          this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED :
          this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      );
    }

    const configCharacteristic = serviceCharacteristics.find((c) => c.uuid === 'f65d72680bef46dc85d0f64ffb2296af');
    const configData: Buffer = await configCharacteristic!.readAsync();
    const configInt = configData.readUInt8();

    const currentLightMode = (configInt & 63);
    if (currentLightMode !== this.state.LightMode && this.state.On) {
      this.state.LightMode = currentLightMode;
      switch (this.state.LightMode) {
        case 2:
          this.serviceLight.updateCharacteristic(this.platform.Characteristic.Brightness, 100);
          break;
        case 1:
          this.serviceLight.updateCharacteristic(this.platform.Characteristic.Brightness, 50);
          break;
      }
    }

    if (firstStart) {
      // write validation key to device (this is an hardcoded password without any challenge)
      const validationKeyCharacteristic = serviceCharacteristics.find((c) => c.uuid === 'f29e003d521e4388bc7c4de6741e8d04');
      await validationKeyCharacteristic!.writeAsync(Buffer.from([100, 25, 4, 39]), false);

      // get current date
      const currentTimeService = services.find((s) => s.uuid === '1805');
      const currentTimeCharacteristics = await currentTimeService!.discoverCharacteristicsAsync([]);
      const currentTimeCharacteristic = currentTimeCharacteristics.find((c) => c.uuid === '2a2b');
      const currentTimeData: Buffer = await currentTimeCharacteristic!.readAsync();
      this.platform.log.debug(`Current time -> ${currentTimeData.toString('hex')}`);

      const peripheralDate = new Date();
      peripheralDate.setFullYear(currentTimeData.readUInt16LE(0), currentTimeData.readUInt8(2) - 1, currentTimeData.readUInt8(3));
      peripheralDate.setHours(currentTimeData.readUInt8(4), currentTimeData.readUInt8(5), currentTimeData.readUInt8(6));

      const now = new Date();
      const nowBuffer = Buffer.alloc(10);
      nowBuffer.writeUInt16LE(now.getFullYear(), 0);
      nowBuffer.writeUInt8(now.getMonth() + 1, 2);
      nowBuffer.writeUInt8(now.getDate(), 3);
      nowBuffer.writeUInt8(now.getHours(), 4);
      nowBuffer.writeUInt8(now.getMinutes(), 5);
      nowBuffer.writeUInt8(now.getSeconds(), 6);

      this.platform.log.debug(`New time -> ${nowBuffer.toString('hex')}`);
      await currentTimeCharacteristic!.writeAsync(nowBuffer, false);
    }

    this.platform.log.debug('New status ->', this.state);
  }

  async setOn(value: CharacteristicValue) {
    const isOn = value as boolean;

    this.platform.log.debug('Will Set Characteristic On ->', value);

    await this.limit(async () => {
      const services = await this.peripheral.discoverServicesAsync([]);
      const service = services.find((s) => s.uuid === 'fabca1ea9cc34640bb586d8be824421c');
      const serviceCharacteristics = await service!.discoverCharacteristicsAsync([]);
      const configCharacteristic = serviceCharacteristics.find((c) => c.uuid === 'f65d72680bef46dc85d0f64ffb2296af');
      const configData: Buffer = await configCharacteristic!.readAsync();
      const configInt = configData.readUInt8();

      const currentLightMode = (configInt & 63);

      await configCharacteristic!.writeAsync(Buffer.from([currentLightMode + (isOn ? 64 : 128)]), false);

      this.platform.log.debug('Set Characteristic On ->', value);

      await this.reload();
    });
  }

  async getOn(): Promise<CharacteristicValue> {
    const isOn = this.state.On;

    this.platform.log.debug('Get Characteristic On ->', isOn);

    if (this.peripheral.state !== 'connected') {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    return isOn;
  }

  async setBrightness(value: CharacteristicValue) {
    const v = value as number;
    let currentLightMode = this.state.LightMode;
    if (v > 50) {
      currentLightMode = 2;
    }
    if (v <= 50) {
      currentLightMode = 1;
    }
    if (v === 0) {
      currentLightMode = 0;
    }

    this.platform.log.debug('Will Set Light Mode ->', currentLightMode);

    await this.limit(async () => {
      const services = await this.peripheral.discoverServicesAsync([]);
      const service = services.find((s) => s.uuid === 'fabca1ea9cc34640bb586d8be824421c');
      const serviceCharacteristics = await service!.discoverCharacteristicsAsync([]);
      const configCharacteristic = serviceCharacteristics.find((c) => c.uuid === 'f65d72680bef46dc85d0f64ffb2296af');

      await configCharacteristic!.writeAsync(Buffer.from([currentLightMode]), false);

      this.platform.log.debug('Set Light Mode -> ', currentLightMode);

      await this.reload();
    });
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const brightness = this.state.LightMode;

    this.platform.log.debug('Get Light Mode -> ', brightness);

    if (this.peripheral.state !== 'connected') {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    if (!this.state.On) {
      return 0;
    }

    switch (brightness) {
      case 1:
        return 50;
      case 2:
        return 100;
    }

    return 0;
  }

  async getContactSensorState(): Promise<CharacteristicValue> {
    const hasWater = this.state.HasWater;

    this.platform.log.debug('Get Contact Sensor State -> ', hasWater);

    if (this.peripheral.state !== 'connected') {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    return hasWater ?
      this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED :
      this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
  }

}
