export interface HeartPart {
  key: string;
  name: string;
  /** Colour cue used in the UI legend; matches the model material. */
  color: string;
  summary: string;
  fact: string;
}

/**
 * Educational content keyed by mesh-name prefix. A mesh named
 * `PulmonaryArtery_Left` maps to the `PulmonaryArtery` entry.
 * If you swap in a different GLB, rename its meshes to these keys
 * (or add new entries) to keep tap-to-learn working.
 */
export const HEART_PARTS: Record<string, HeartPart> = {
  LeftVentricle: {
    key: 'LeftVentricle',
    name: 'Left ventricle',
    color: '#b3302a',
    summary:
      'The strongest chamber. It pumps oxygen-rich blood through the aorta to the whole body.',
    fact: 'Its muscular wall is about three times thicker than the right ventricle’s.',
  },
  RightVentricle: {
    key: 'RightVentricle',
    name: 'Right ventricle',
    color: '#c43d33',
    summary: 'Pumps oxygen-poor blood through the pulmonary artery to the lungs.',
    fact: 'It only has to push blood to the lungs next door, so it works at much lower pressure.',
  },
  RightAtrium: {
    key: 'RightAtrium',
    name: 'Right atrium',
    color: '#cf4b3f',
    summary:
      'Receives oxygen-poor blood returning from the body through the venae cavae.',
    fact: 'The heart’s natural pacemaker, the sinoatrial (SA) node, sits in its wall.',
  },
  LeftAtrium: {
    key: 'LeftAtrium',
    name: 'Left atrium',
    color: '#a52a25',
    summary: 'Receives freshly oxygenated blood from the lungs via the pulmonary veins.',
    fact: 'It passes blood to the left ventricle through the mitral valve.',
  },
  Aorta: {
    key: 'Aorta',
    name: 'Aorta',
    color: '#e0473b',
    summary:
      'The body’s largest artery. It carries oxygen-rich blood from the left ventricle to every organ.',
    fact: 'The three branches on top of the arch supply the head, neck and arms.',
  },
  PulmonaryArtery: {
    key: 'PulmonaryArtery',
    name: 'Pulmonary artery',
    color: '#3d6fc2',
    summary:
      'Carries oxygen-poor blood from the right ventricle to the lungs. It splits into left and right branches.',
    fact: 'It is the only artery in an adult that carries oxygen-poor blood.',
  },
  SuperiorVenaCava: {
    key: 'SuperiorVenaCava',
    name: 'Superior vena cava',
    color: '#3d6fc2',
    summary: 'Returns oxygen-poor blood from the head, neck and arms to the right atrium.',
    fact: '“Vena cava” is Latin for “hollow vein”.',
  },
  InferiorVenaCava: {
    key: 'InferiorVenaCava',
    name: 'Inferior vena cava',
    color: '#3d6fc2',
    summary: 'Returns oxygen-poor blood from the lower body to the right atrium.',
    fact: 'It is the largest vein in the human body.',
  },
  PulmonaryVeins: {
    key: 'PulmonaryVeins',
    name: 'Pulmonary veins',
    color: '#8a3a8f',
    summary: 'Four veins that bring oxygen-rich blood from the lungs into the left atrium.',
    fact: 'They are the only veins in an adult that carry oxygen-rich blood.',
  },
  CoronaryArteries: {
    key: 'CoronaryArteries',
    name: 'Coronary arteries',
    color: '#f2c14e',
    summary: 'Small arteries on the heart’s surface that feed the heart muscle itself.',
    fact: 'A blockage here is what causes a heart attack.',
  },
};

export function partKeyFromMeshName(name: string): string {
  return name.split('_')[0];
}
