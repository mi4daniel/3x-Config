(function(global) {
  const STORAGE_KEY = '3xlogicConfig';
  const DB_NAME = '3xlogicLayoutDB';
  const DB_VERSION = 1;
  const LAYOUT_STORE_NAME = 'layouts';
  const LAYOUT_KEY = 'cameraLayout';

  let dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(LAYOUT_STORE_NAME)) {
        db.createObjectStore(LAYOUT_STORE_NAME);
      }
    };
  });

  async function getFromDB(key) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(LAYOUT_STORE_NAME, 'readonly').objectStore(LAYOUT_STORE_NAME).get(key);
      transaction.onsuccess = () => resolve(transaction.result);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  const DEFAULT_CONFIGURATION = {
    projectName: '',
    racks: [],
    cloudServers: [],
    cloudCameras: [],
    allInOneCameras: [],
    accessControl: [],
    mounts: [],
    accessories: [],
    customParts: [],
    cameraLayout: null,
    layoutPlacements: [],
    layoutWalls: []
  };

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIGURATION));
  }

  function applyDefaults(target) {
    const base = typeof target === 'object' && target !== null ? target : {};
    const defaults = cloneDefaults();

    Object.keys(base).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
        delete base[key];
      }
    });

    return Object.assign(base, defaults);
  }

  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
  }

  function ensureCameraDefaults(camera) {
    if (!camera || typeof camera !== 'object') return;
    if (typeof camera.location === 'undefined') camera.location = '';
    if (typeof camera.quantity === 'undefined') camera.quantity = 1;
    if (camera.isCloud && typeof camera.selectedMounts === 'undefined') {
      camera.selectedMounts = [null];
    }
  }

  function normalizeConfiguration(configuration, { syncNvrLicenses } = {}) {
    configuration.projectName = configuration.projectName || '';
    configuration.cameraLayout = configuration.cameraLayout || null;

    configuration.racks = toArray(configuration.racks);
    configuration.cloudServers = toArray(configuration.cloudServers);
    configuration.cloudCameras = toArray(configuration.cloudCameras);
    configuration.allInOneCameras = toArray(configuration.allInOneCameras);
    configuration.accessControl = toArray(configuration.accessControl);
    configuration.mounts = toArray(configuration.mounts);
    configuration.accessories = toArray(configuration.accessories);
    configuration.customParts = toArray(configuration.customParts);
    configuration.layoutPlacements = toArray(configuration.layoutPlacements);
    configuration.layoutWalls = toArray(configuration.layoutWalls);

    configuration.racks.forEach((rack) => {
      rack.standaloneSwitches = toArray(rack.standaloneSwitches);
      rack.devices = toArray(rack.devices);

      rack.devices.forEach((device) => {
        device.assignedUps = toArray(device.assignedUps);
        device.cameras = toArray(device.cameras);
        device.storage = toArray(device.storage);
        device.licenses = toArray(device.licenses);
        device.poeSwitches = toArray(device.poeSwitches);
        device.doors = toArray(device.doors);

        if (device.product && device.product.deviceType === 'nvr' && typeof syncNvrLicenses === 'function') {
          syncNvrLicenses(device);
        }

        device.cameras.forEach(ensureCameraDefaults);
      });
    });

    const rackCameras = configuration.racks.flatMap((rack) =>
      rack.devices.flatMap((device) => device.cameras || [])
    );

    [configuration.cloudCameras, configuration.allInOneCameras, rackCameras].forEach((collection) => {
      collection.forEach(ensureCameraDefaults);
    });

    return configuration;
  }

  function createInitialConfiguration(existing) {
    const target = applyDefaults(existing);
    return normalizeConfiguration(target);
  }

  function resetConfiguration(configuration) {
    applyDefaults(configuration);
    normalizeConfiguration(configuration);
    return configuration;
  }

    }

  function persistConfiguration(configuration, storageKey = STORAGE_KEY) {
    return new Promise(async (resolve, reject) => {
      try {
        const db = await dbPromise;
        const configToStore = { ...configuration };
        const layoutData = configToStore.cameraLayout;
        delete configToStore.cameraLayout;

        const tx = db.transaction(LAYOUT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(LAYOUT_STORE_NAME);
        if (layoutData) {
          store.put(layoutData, LAYOUT_KEY);
        } else {
          store.delete(LAYOUT_KEY);
        }

        localStorage.setItem(storageKey, JSON.stringify(configToStore));
        resolve(true);
      } catch (error) {
        console.error('Failed to save to localStorage/IndexedDB', error);
        reject(false);
      }
    });
  }

  function restoreConfiguration(configuration, {
    storageKey = STORAGE_KEY,
    syncNvrLicenses,
    onSuccess,
    onError
  } = {}) {
    const promise = new Promise(async (resolve, reject) => {
      try {
        const configString = localStorage.getItem(storageKey);
        if (!configString) return resolve(false);

        const parsedConfig = JSON.parse(configString);
        if (!parsedConfig || typeof parsedConfig !== 'object') return resolve(false);

        const layoutData = await getFromDB(LAYOUT_KEY);

        applyDefaults(configuration);
        Object.assign(configuration, parsedConfig);
        if (layoutData) {
          configuration.cameraLayout = layoutData;
        }

        normalizeConfiguration(configuration, { syncNvrLicenses });

        if (typeof onSuccess === 'function') {
          onSuccess(configuration);
        }

        resolve(true);
      } catch (error) {
        localStorage.removeItem(storageKey);
        if (typeof onError === 'function') {
          onError(error);
        } else {
          console.error('Failed to load from localStorage/IndexedDB', error);
        }
        reject(error);
      }
    });
    return promise;
  }

  global.AppState = {
    STORAGE_KEY,
    DEFAULT_CONFIGURATION,
    createInitialConfiguration,
    resetConfiguration,
    persistConfiguration,
    restoreConfiguration,
    normalizeConfiguration,
    applyDefaults
  };
})(window);



