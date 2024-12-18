'use strict';

import Homey from 'homey';
import { IncomingHttpHeaders } from 'http';
import https from 'https';

const energyMeterCapabilitiesMap: { [key: string]: string } = {
  '2221_16': 'measure_power',
  '2221_22': 'meter_power',
  '2221_A': 'measure_current.l1',
  '2221_B': 'measure_current.l2',
  '2221_C': 'measure_current.l3',
  '2221_3': 'measure_voltage.l1',
  '2221_4': 'measure_voltage.l2',
  '2221_5': 'measure_voltage.l3',
  '2201_0': 'measure_temperature',
  '2129_0': 'measure_current.limit',
};

interface HttpsPromiseOptions {
  body?: string | Buffer;
  hostname: string;
  path: string;
  method: string;
  headers: { [key: string]: string };
  agent: https.Agent,
  rejectUnauthorized?: boolean; // Optional for SSL/TLS validation
}

interface HttpsPromiseResponse {
  body: string | object;
  headers: IncomingHttpHeaders;
}

interface DeviceSettings {
  address: string,
  username: string,
  password: string,
}

interface InfoResponse {
  id: string,
  access: number,
  type: number,
  len: number,
  cat: string,
  value: number,
}

interface ResponseBody {
  properties: InfoResponse[]; // Adjust based on actual response structure
}

module.exports = class MyDevice extends Homey.Device {

  deviceSettings: DeviceSettings = {
    address: '',
    username: 'admin',
    password: '',
  };

  refreshRate: number = 30;
  apiHeader: string = 'alfen/json; charset=utf-8';
  apiUrl: string = 'api';

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.homey.setInterval(this.refreshDevice.bind(this), this.refreshRate * 1000);
    this.log('MyDevice has been initialized');
    await this.refreshDevice();
  }

  async refreshDevice() {
    this.log('Refresh Device');

    const agent = new https.Agent({
      keepAlive: true, // Enable connection keep-alive
      maxSockets: 1, // Optionally limit the number of sockets (default is Infinity)
    });

    await this.apiLogin(agent);
    const result = await this.apiGetActualValues(agent);
    await this.apiLogout(agent);

    // Parse result values
    await this.updateCapabilities(result);
  }

  async apiLogin(agent: https.Agent) {
    const { address, username, password } = this.deviceSettings;
    const { apiUrl, apiHeader } = this;

    // Define the request body
    const body = JSON.stringify({
      username,
      password,
    });

    // Define the options for the HTTPS request
    const options = {
      hostname: address,
      path: `/${apiUrl}/login`,
      method: 'POST',
      headers: {
        'Content-Type': apiHeader,
        'Content-Length': Buffer.byteLength(body).toString(),
        Connection: 'keep-alive',
      },
      agent,
      rejectUnauthorized: false, // Disable SSL certificate validation if needed
    };

    try {
      // Make the HTTPS request using the httpsPromise method
      const response = await this.httpsPromise({ ...options, body });

      // Handle the response
      this.log('Login successful:', response.body);
    } catch (error) {
      this.error('Login failed:', error);
      throw new Error(`Login failed: ${error}`);
    }
  }

  async apiLogout(agent: https.Agent) {
    const { address } = this.deviceSettings;
    const { apiUrl, apiHeader } = this;

    // Define the options for the HTTPS request
    const options = {
      hostname: address,
      path: `/${apiUrl}/logout`,
      method: 'POST',
      headers: {
        'Content-Type': apiHeader,
      },
      agent,
      rejectUnauthorized: false, // Disable SSL certificate validation if needed
    };

    try {
      // Make the HTTPS request using the httpsPromise method
      const response = await this.httpsPromise(options);

      // Handle the response
      this.log('Logout successful:', response.body);
    } catch (error) {
      this.error('Logout failed:', error);
      throw new Error(`Logout failed: ${error}`);
    }
  }

  async apiGetActualValues(agent: https.Agent) {
    const { address } = this.deviceSettings;
    const { apiUrl, apiHeader } = this;

    // Define the 'ids' parameter
    const ids = '2060_0,2056_0,2221_3,2221_4,2221_5,2221_A,2221_B,2221_C,2221_16,2201_0,2501_2,2221_22,2129_0,2126_0';

    // Define the options for the HTTPS request (no body, just headers)
    const options: HttpsPromiseOptions = {
      hostname: address,
      path: `/${apiUrl}/prop?ids=${ids}`, // Add the 'ids' parameter to the path
      method: 'GET',
      headers: {
        'Content-Type': apiHeader,
        Connection: 'keep-alive',
      },
      agent,
      rejectUnauthorized: false, // Disable SSL certificate validation if needed
    };

    try {
      // Make the HTTPS request using the httpsPromise method
      const response = await this.httpsPromise(options);

      // Handle the response
      this.log('Properties retrieved successfully:', response.body);

      const bodyResult = <ResponseBody>response.body;
      const result = bodyResult.properties;
      const capabilitiesData = [];

      for (const prop of result) {
        const capabilityId = energyMeterCapabilitiesMap[prop.id];

        if (capabilityId) {
          let { value } = prop;

          // Handle specific rounding or transformation for certain properties
          switch (prop.id) {
            case '2221_3': // Ampere L1
            case '2221_4': // Ampere L2
            case '2221_5': // Ampere L3
              value = Math.round(prop.value); // rounding values, no decimal
              break;
            case '2201_0': // Temperature
            case '2221_16': // Power (watts)
              value = Math.round(prop.value * 10) / 10; // rounding values, one decimal
              break;
            case '2221_22': // Total energy
              value = Math.round(prop.value / 10) / 100; // rounding values, 2 decimal (but needs to be devided by 1000)
              break;
            default:
              break;
          }

          // Collect the mapped data
          capabilitiesData.push({ capabilityId, value });
        }
      }

      return capabilitiesData;
    } catch (error) {
      this.error('Request failed:', error);
      throw new Error(`Request failed: ${error}`);
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('MyDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('MyDevice settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('MyDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');
  }

  /** Helper Functions */
  async updateCapabilities(capabilitiesData: Array<{ capabilityId: string, value: number | string }>) {
    const deviceState = this.getState();

    for (const { capabilityId, value } of capabilitiesData) {
      try {
        const hasCapability = this.hasCapability(capabilityId);
        if (!hasCapability) await this.addCapability(capabilityId).catch(this.error);

        if (value === null || (typeof deviceState !== 'undefined' && typeof deviceState[capabilityId] !== 'undefined' && deviceState[capabilityId] === value)) continue;

        await this.setCapabilityValue(capabilityId, value)
          .catch(this.error)
          .then(() => this.log(`Update capability: ${capabilityId} with value ${value}`));
      } catch (error) {
        this.error(`Error updating capability ${capabilityId}:`, error);
      }
    }
  }

  httpsPromise(options: HttpsPromiseOptions): Promise<HttpsPromiseResponse> {
    const { body, ...requestOptions } = options;

    return new Promise((resolve, reject) => {
      const req = https.request(requestOptions, (res) => {
        const chunks: Uint8Array[] = [];
        res.on('data', (data: Uint8Array) => chunks.push(data));
        res.on('end', () => {
          if (res.statusCode && res.statusCode !== 200) {
            reject(new Error(`Request failed with status ${res.statusCode}`));
            return;
          }

          this.log(`Content-Length: ${res.headers['content-length']}`);
          this.log(`Content-Type: ${res.headers['content-type']}`);
          this.log(`Authorization: ${res.headers['Set-Cookie']}`);

          let resBody = Buffer.concat(chunks).toString();
          this.log(resBody);

          switch (res.headers['content-type']) {
            case 'application/json':
            case 'alfen/json':
              try {
                resBody = JSON.parse(resBody);
              } catch (error) {
                reject(new Error(`Exception parsing JSON: ${error}`));
                return;
              }
              break;
            default:
              try {
                resBody = JSON.parse(resBody);
              } catch (error) {
                resBody = resBody.toString();
              }
              break;
          }

          resolve({ body: resBody, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

};