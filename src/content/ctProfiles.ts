import type { CTFrame } from '../three/CTScanner';
import type { CTProfile } from '../three/ctImage';

export interface CTConfig {
  frame: CTFrame;
  profile: CTProfile;
}

/**
 * Contrast-enhanced cardiac CT look: blood pools bright (iodine contrast),
 * myocardium mid-grey, fat dark, lungs black, bone white.
 */
export const HEART_CT: CTConfig = {
  // Heart model: front = +z, patient's left = +x, head = +y.
  frame: { anterior: [0, 0, 1], left: [1, 0, 0], superior: [0, 1, 0] },
  profile: {
    context: 'chest',
    realSizeMm: 160,
    window: 'W 600  L 100',
    order: [
      'InferiorVenaCava', 'SuperiorVenaCava', 'PulmonaryVeins', 'Aorta', 'PulmonaryArtery',
      'RightAtrium', 'LeftAtrium', 'RightVentricle', 'LeftVentricle',
      'LigamentumArteriosum', 'CardiacVeins', 'CoronaryArteries',
    ],
    styles: {
      LeftVentricle: { fill: 0.86, edge: 0.46, edgeWidth: 0.03 },
      RightVentricle: { fill: 0.8, edge: 0.46, edgeWidth: 0.012 },
      LeftAtrium: { fill: 0.84, edge: 0.48, edgeWidth: 0.007 },
      RightAtrium: { fill: 0.76, edge: 0.48, edgeWidth: 0.007 },
      Aorta: { fill: 0.92, edge: 0.55, edgeWidth: 0.004 },
      PulmonaryArtery: { fill: 0.74, edge: 0.5, edgeWidth: 0.004 },
      SuperiorVenaCava: { fill: 0.62, edge: 0.45, edgeWidth: 0.003 },
      InferiorVenaCava: { fill: 0.58, edge: 0.45, edgeWidth: 0.003 },
      PulmonaryVeins: { fill: 0.86, edge: 0.5, edgeWidth: 0.003 },
      CoronaryArteries: { fill: 0.95 },
      CardiacVeins: { fill: 0.66 },
      LigamentumArteriosum: { fill: 0.5 },
    },
    // Epicardial fat is dark on CT even though it is listed with the coronary arteries.
    meshStyles: [[/_Fat\d*$/, { fill: 0.22 }]],
  },
};

/**
 * Non-contrast head CT look: grey matter slightly brighter than white matter,
 * CSF dark, skull bright.
 */
export const BRAIN_CT: CTConfig = {
  // Brain model: front = −x, patient's left = +z, head = +y.
  frame: { anterior: [-1, 0, 0], left: [0, 0, 1], superior: [0, 1, 0] },
  profile: {
    context: 'head',
    realSizeMm: 170,
    window: 'W 80  L 40',
    order: [
      'SpinalCord', 'Brainstem', 'Cerebellum',
      'FrontalLobe', 'ParietalLobe', 'TemporalLobe', 'OccipitalLobe',
      'CorpusCallosum', 'Thalamus', 'PituitaryGland', 'OlfactoryBulbs',
    ],
    styles: {
      // White matter core with a brighter grey-matter cortex rim.
      FrontalLobe: { fill: 0.5, edge: 0.62, edgeWidth: 0.014 },
      ParietalLobe: { fill: 0.5, edge: 0.62, edgeWidth: 0.014 },
      TemporalLobe: { fill: 0.5, edge: 0.62, edgeWidth: 0.014 },
      OccipitalLobe: { fill: 0.5, edge: 0.62, edgeWidth: 0.014 },
      Cerebellum: { fill: 0.56, edge: 0.64, edgeWidth: 0.01 },
      Brainstem: { fill: 0.52, edge: 0.58, edgeWidth: 0.006 },
      SpinalCord: { fill: 0.5, edge: 0.58, edgeWidth: 0.005 },
      CorpusCallosum: { fill: 0.44 },
      Thalamus: { fill: 0.6 },
      PituitaryGland: { fill: 0.66 },
      OlfactoryBulbs: { fill: 0.55 },
    },
    // The lobes are patches of each hemisphere's closed surface: fill each
    // hemisphere as white matter, then each lobe draws its own cortex rim.
    groups: [
      { match: /_LH$/, fill: 0.5 },
      { match: /_RH$/, fill: 0.5 },
    ],
  },
};
