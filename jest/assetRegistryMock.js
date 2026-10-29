/**
 * WHAT:  Mocks React Native 0.88's private AssetRegistry with the same fake
 *        asset jest-expo gives `react-native/asset-registry`.
 * WHY:   RN 0.88 moved the registry: the asset transformer registers through
 *        the mocked `react-native/asset-registry` (id 1), but expo-asset reads
 *        `AssetRegistry` from 'react-native', i.e. the real, empty private
 *        registry, so every icon font threw "Module 1 is missing from the
 *        asset registry". jest-expo 58.0.13 only mocks the old entry point.
 *        shortcut: delete this file once jest-expo mocks the private path.
 * LINKS: package.json "jest.setupFiles"; node_modules/jest-expo/src/preset/setup.js.
 */

/* global jest */

const path = require('path');

// doMock, not mock: babel hoists jest.mock above the `path` require.
jest.doMock(
  path.join(path.dirname(require.resolve('react-native/package.json')), 'src/private/assets/AssetRegistry'),
  () => ({
    AssetRegistry: {
      registerAsset: jest.fn(() => 1),
      getAssetByID: jest.fn(() => ({
        fileSystemLocation: '/full/path/to/directory',
        httpServerLocation: '/assets/full/path/to/directory',
        scales: [1],
        fileHashes: ['md5'],
        name: 'name',
        exists: true,
        type: 'type',
        hash: 'md5',
        uri: 'uri',
        width: 1,
        height: 1,
      })),
    },
  }),
);
